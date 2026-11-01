// Issue 713 (3): at a table a person runs, the chronicle carries the rolls
// and what they changed, as it does at a table the AI runs.
//
// The cause: an AI turn's rolls ride on the narration it writes when it
// ends (src/lib/dm/turn.ts places a "[roll:<id>]" marker for each), and the
// narration tells the table what they did. A person's turn
// (src/lib/dm/invoke.ts) closed with nothing written, so at a test fight its
// author ran, the Hand's card rolls, the kills and the GM console's damage
// and healing reached the table only as toasts. Every person's call now
// leaves one table note (src/lib/dm/persons-record.ts): its rolls in the
// note's rollIds, which the chronicle draws as roll cards, and words that
// stand alone (who rolled what, and what changed) for a screen built before
// the field, which draws the words only.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";

const { latestSeq, setDmMode, setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { listRollsVisibleTo } = await import("../src/lib/db/rolls.ts");
const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
const { handOnEnemyTurns } = await import("../src/lib/dm/encounter-tools.ts");
const { changesLine, personsRecord, rollsSentence } = await import("../src/lib/dm/persons-record-logic.ts");
const { forEachEventSince } = await import("../src/lib/events.ts");

const { saveEncounter } = await import("../src/lib/db/encounters.ts");

const { test, finish } = suite("test-persons-record");

const ids = (message) => message?.rollIds ?? [];
// Words a screen that knows nothing of rollIds can show as they are: no
// marker, no id, never empty.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
function readsClean(content) {
  assert.ok(content.trim(), "the note has words");
  assert.ok(!content.includes("[roll:") && !UUID.test(content), `no marker or id in the words: ${content}`);
}

// A table whose owner holds the GM's seat, two heroes of other players, and
// (with `fight`) one dummy beside the fighter, the fighter up.
async function personsTable({ fight = true, person = true } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 6, startingLevel: 3 } });
  const fighter = world.addHero({
    user: world.addUser(),
    name: "Brom",
    class: "fighter",
    level: 3,
    abilities: { str: 16, dex: 12, con: 14 },
    maxHp: 28,
    proficiencies: { ...TRAINED, saves: ["str", "con"] },
    equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Chain Mail", qty: 1, equipped: true }],
  });
  const ally = world.addHero({ user: world.addUser(), name: "Vesper", class: "fighter", level: 3, maxHp: 24 });
  if (person) {
    assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "the owner takes the GM's seat");
  }
  const kit = await combatKit(world);
  if (fight) {
    await kit.fight(1, { heroFaces: { [fighter.id]: 19, [ally.id]: 17 }, enemyFace: 2 });
    const [goblin] = world.enemies();
    kit.place(fighter.id, 5, 5);
    kit.place(ally.id, 4, 5);
    kit.place(goblin.id, 5, 6);
    kit.giveTurn(fighter.id);
  }
  const notes = () => listRecentMessages(world.campaignId, 100).filter((message) => message.authorType === "system");
  return { world, kit, fighter, ally, notes, last: () => notes().at(-1) ?? null };
}

await test("the note's words: damage, a drop to 0, healing, and the foes who fell or ran", () => {
  assert.equal(changesLine([], []), null);
  assert.equal(
    changesLine([{ name: "Vesper", damage: 9, healed: 0, hp: 0, down: "dying" }], []),
    "Vesper takes 9 damage and drops to 0 hit points, dying.",
  );
  assert.equal(changesLine([{ name: "Brom", damage: 4, healed: 0, hp: 20, down: null }], []), "Brom takes 4 damage (20 HP).");
  assert.equal(changesLine([{ name: "Brom", damage: 0, healed: 6, hp: 26, down: null }], []), "Brom regains 6 hit points (26 HP).");
  assert.equal(
    changesLine([], [{ name: "Goblin 1", status: "dead" }, { name: "Goblin 2", status: "dead" }, { name: "Thug", status: "fled" }]),
    "Goblin 1 and Goblin 2 fall. Thug flees.",
  );
  const id = "0f8f2a52-6a43-4c55-9d0b-4f3c1d7d2e10";
  const swing = [
    { id, kind: "attack", detail: "Longsword vs Goblin 1", who: "Rowan" },
    { id: "1f8f2a52-6a43-4c55-9d0b-4f3c1d7d2e10", kind: "damage", detail: "Longsword vs Goblin 1", who: "Rowan" },
  ];
  const record = personsRecord(swing, [], [{ name: "Goblin 1", status: "dead" }]);
  assert.deepEqual(record, {
    content: "Rowan rolls to hit and damage (Longsword vs Goblin 1). Goblin 1 falls.",
    glyph: "cue-battle",
    rollIds: swing.map((roll) => roll.id),
  });
  assert.equal(personsRecord([], [], []), null, "a call that rolled and changed nothing leaves nothing");
  assert.equal(
    rollsSentence([
      { id, kind: "initiative", detail: "initiative", who: "The GM" },
      { id, kind: "initiative", detail: "initiative", who: "The GM" },
      { id, kind: "ability_check", detail: "a stuck door", who: "Bree" },
    ]),
    "The GM rolls initiative. Bree rolls a check (a stuck door).",
  );
});

await test("a person's attack from the console: both dice in the chronicle, in the order rolled", async () => {
  const { world, kit, fighter, notes, last } = await personsTable();
  const [goblin] = world.enemies();
  const before = notes().length;
  const swing = await kit.swing(fighter.id, goblin.id, [18, 5]);
  assert.ok(swing.ok, JSON.stringify(swing.out));
  assert.ok(swing.toHit && swing.damage, "a hit and its damage were rolled");
  assert.equal(notes().length, before + 1, "one note for the call");
  assert.deepEqual(ids(last()), [swing.toHit.id, swing.damage.id]);
  assert.equal(last().glyph, "die-d20", "a blow on a foe with hit points to spare names no number of theirs");
  assert.match(last().content, /^Brom rolls to hit and damage \(.+\)\.$/);
  assert.ok(!/HP|= /.test(last().content), `no hit points or totals in the words: ${last().content}`);
  readsClean(last().content);
  world.close();
});

await test("a kill from the console says the foe falls, under the dice that felled it", async () => {
  const { world, kit, fighter } = await personsTable();
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { currentHp: 1 });
  const swing = await kit.swing(fighter.id, goblin.id, [18, 6]);
  assert.ok(swing.ok, JSON.stringify(swing.out));
  const note = listRecentMessages(world.campaignId, 100).find((message) => ids(message).includes(swing.toHit.id));
  assert.ok(note, "the attack's roll rides on a note");
  assert.match(note.content, new RegExp(`${goblin.displayName} falls\\.`));
  assert.deepEqual(ids(note), [swing.toHit.id, swing.damage.id]);
  readsClean(note.content);
  world.close();
});

await test("the GM console's damage drops a hero to 0, and its healing brings them back, each said in a line", async () => {
  const { world, ally, last } = await personsTable({ fight: false });
  const hurt = await world.invoke("apply_damage", { characterId: ally.id, amount: 30, type: "slashing", reason: "a falling beam" });
  assert.ok(hurt.ok, JSON.stringify(hurt));
  assert.equal(last().content, "Vesper takes 30 damage and drops to 0 hit points, dying.");
  assert.equal(last().glyph, "cue-death");
  const healed = await world.invoke("heal", { characterId: ally.id, amount: 5, reason: "a potion" });
  assert.ok(healed.ok, JSON.stringify(healed));
  assert.equal(last().content, "Vesper regains 5 hit points (5 HP).");
  assert.equal(last().glyph, "cue-heal");
  world.close();
});

await test("a death the blow causes lands below the record of the blow, as under an AI turn's narration", async () => {
  const { world, ally, notes } = await personsTable({ fight: false });
  world.patch(ally.id, { currentHp: 0, deathSaves: { successes: 0, failures: 2, stable: false, dead: false } });
  const hurt = await world.invoke("apply_damage", { characterId: ally.id, amount: 3, type: "slashing", reason: "a knife" });
  assert.ok(hurt.ok, JSON.stringify(hurt));
  const death = notes().find((message) => /has died of their wounds/.test(message.content));
  const record = notes().find((message) => /Vesper takes 3 damage/.test(message.content));
  assert.ok(death && record, JSON.stringify(notes().map((message) => message.content)));
  assert.ok(record.seq < death.seq, `the record (${record.seq}) sits above the death it caused (${death.seq})`);
  world.close();
});

await test("a roll the GM makes behind the screen stays off the note, as it stays off every other seat's stream; a blind one is named", async () => {
  const { world, fighter, notes, last } = await personsTable({ fight: false });
  const before = notes().length;
  const hidden = await world.invoke("request_roll", {
    characterId: fighter.id, kind: "ability_check", ability: "wis", dc: 12, reason: "a sound in the dark", visibility: "dm",
  });
  assert.ok(hidden.ok, JSON.stringify(hidden));
  assert.equal(notes().length, before, "nothing the players may not read, not even that a roll was made");
  const blind = await world.invoke("request_roll", {
    characterId: fighter.id, kind: "ability_check", ability: "wis", dc: 12, reason: "a second sound", visibility: "blind",
  });
  assert.ok(blind.ok, JSON.stringify(blind));
  const [id] = ids(last());
  readsClean(last().content);
  const player = listRollsVisibleTo(world.campaignId, { adjudicates: false, steersStory: false }, [], 50).find((roll) => roll.id === id);
  assert.ok(player, "every seat holds the blind roll the note names");
  assert.equal(player.total, null, "without its number");
  world.close();
});

await test("the monsters the server plays for the person: their dice above the turn's own line, no second telling", async () => {
  const { world, kit, notes } = await personsTable();
  const [goblin] = world.enemies();
  kit.freshRound();
  const encounter = world.encounter();
  // The enemy is due: the person hands it to the server to play.
  saveEncounter({ ...encounter, legendary: { ...encounter.legendary, due: [goblin.id] } });
  const before = notes().length;
  const campaign = world.campaign();
  world.dice(15, 3);
  onPersonsTurn(campaign, (turn) => handOnEnemyTurns(campaign, turn, true));
  world.clearDice();
  const fresh = notes().slice(before);
  const record = fresh.find((message) => ids(message).length);
  const played = fresh.find((message) => /resolve automatically/.test(message.content));
  assert.ok(record && played, JSON.stringify(fresh.map((message) => message.content)));
  assert.ok(record.seq < played.seq, "the dice sit above the line that tells them");
  assert.match(record.content, /rolls to hit/);
  assert.ok(!/takes \d+ damage/.test(record.content), `the played turn's line says the blow; the record adds no second one: ${record.content}`);
  world.close();
});

await test("dice a player enters for a roll the person asked for reach the chronicle as they land", async () => {
  const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
  const player = world.addUser("roller");
  const hero = world.addHero({ user: player, name: "Tamsin", class: "fighter", level: 2, proficiencies: TRAINED });
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "the owner takes the GM's seat");
  setMemberRealDice(world.campaignId, player.id, true);
  const asked = await world.invoke("request_roll", { characterId: hero.id, kind: "ability_check", ability: "str", dc: 10, reason: "a stuck door" });
  assert.ok(asked.ok, JSON.stringify(asked));
  const [pending] = listOpenPendingRolls(world.campaignId);
  assert.ok(pending, "the roll waits for the player's dice");
  const submit = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  world.signIn(player);
  const out = await callRoute(submit, "POST", { dice: [14] }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const note = listRecentMessages(world.campaignId, 50).filter((message) => message.authorType === "system").at(-1);
  assert.deepEqual(ids(note), [out.json.roll.id]);
  assert.match(note.content, /^Tamsin rolls a check/);
  world.close();
});

await test("a screen built before rollIds reads a clean sentence, live and on reload; the newer one gets the rolls beside it", async () => {
  const { world, kit, fighter } = await personsTable();
  const [goblin] = world.enemies();
  const from = latestSeq(world.campaignId);
  const swing = await kit.swing(fighter.id, goblin.id, [18, 5]);
  assert.ok(swing.ok, JSON.stringify(swing.out));
  const sent = [];
  forEachEventSince(world.campaignId, from, (event) => sent.push(event), 500, world.owner.id);
  const live = sent.find((event) => event.type === "message_added" && ids(event.payload.message).length)?.payload.message;
  assert.ok(live, "the note went out on the stream");
  readsClean(live.content);
  assert.equal(live.content, `Brom rolls to hit and damage (${swing.toHit.detail}).`);
  assert.deepEqual(live.rollIds, [swing.toHit.id, swing.damage.id]);
  const reloaded = listRecentMessages(world.campaignId, 100).find((message) => message.id === live.id);
  assert.deepEqual(reloaded.rollIds, live.rollIds, "the snapshot carries the same rolls");
  assert.equal(reloaded.content, live.content);
  world.close();
});

await test("a table the AI runs keeps its record in the AI's narration: the script's person leaves no note", async () => {
  const { world, kit, fighter, notes } = await personsTable({ person: false });
  const [goblin] = world.enemies();
  const before = notes().length;
  const swing = await kit.swing(fighter.id, goblin.id, [18, 5]);
  assert.ok(swing.ok, JSON.stringify(swing.out));
  assert.equal(notes().length, before);
  world.close();
});

finish();
