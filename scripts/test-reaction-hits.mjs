// Three reaction gaps of issue 685 (the audit's 4.G):
//
// - A second hit replaced the first. The engine kept one record per
//   character, so when two enemies hit the same hero in one AI reply only
//   the second could be answered. Every hit still open is kept now, each with
//   its id; a reaction answers the one its player picks (use_reaction's
//   `hit`, the Hand's card, the console's "Attack answered"). SRD 5.1,
//   Shield: +5 AC "including against the triggering attack" until the start
//   of the caster's next turn, so Shield taken against the first hit also
//   re-checks every open hit after it; Uncanny Dodge halves one attack's
//   damage.
// - A companion had no reaction card. Its commander, or the GM seat for a
//   companion nobody commands at a table a person runs, is offered its
//   reactions now, and the actions route takes them off its turn; at a table
//   the AI runs, the narrator is told it may answer for one nobody commands.
// - A typed reaction spoke for the hero on turn. The composer's Speaking as
//   names another of the person's heroes with a hit to answer, and the
//   actions route takes the words as that hero's (`reaction`).
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { listMembers, setDmMode } = await import("../src/lib/db/campaigns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { openHits, snapshotVitals } = await import("../src/lib/dm/last-hit.ts");
const { describeIntent, directCardCall, intentNeedsTool } = await import("../src/lib/dm/intent-logic.ts");
const { characterAwaitingPlayer, declaredThisTurn } = await import("../src/lib/dm/player-word.ts");
const { offTurnReactionCards, reactionAim, reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { companionReactors, typedReactors } = await import("../src/lib/player-characters.ts");
const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
const { buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
// Loaded before the waker below, which takes its place in the registry.
await import("../src/lib/dm/loop.ts");

const { test, finish } = suite("test-reaction-hits");

registerDmWaker(() => {});

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

async function route(world, name, body, user) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const response = await handler.POST(
    new Request(`http://odm.test/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

// One person's two heroes at a table the AI runs, AC 12 and 30 hit points
// each: Poppy (a rogue with Uncanny Dodge) at 20, Mira (a wizard with
// Shield) at 18, then two goblins (the harness's dummies: +4 to hit, 1d6+2).
// The turn is Mira's, in round 2; the goblins stand beside the hero they hit.
async function stage() {
  const world = await openWorld({ gameSettings: { multiCharacter: "all_active" }, campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const poppy = world.addHero({ name: "Poppy", class: "rogue", level: 5, maxHp: 30, proficiencies: TRAINED });
  const mira = world.addHero({
    name: "Mira", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED, user: world.owner,
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [] },
  });
  world.patch(poppy.id, { features: [{ name: "Uncanny Dodge", source: "class" }] });
  await kit.fight(2);
  const [g1, g2] = world.enemies();
  const entries = [
    { kind: "pc", characterId: poppy.id, userId: poppy.userId, name: "Poppy", initiative: 20 },
    { kind: "pc", characterId: mira.id, userId: mira.userId, name: "Mira", initiative: 18 },
    { kind: "enemy", enemyId: g1.id, name: g1.displayName, initiative: 11 },
    { kind: "enemy", enemyId: g2.id, name: g2.displayName, initiative: 10 },
  ];
  kit.saveEncounter({ ...world.encounter(), order: entries, turnIndex: 1, round: 2, surprisedIds: [], turnBudget: null, reactionsUsed: [] });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  for (const hero of [poppy, mira]) {
    world.patch(hero.id, { ac: 12, acOverride: true, currentHp: 30, tempHp: 0 });
  }
  return { world, kit, poppy: world.sheet(poppy.id), mira: world.sheet(mira.id), g1, g2 };
}

// The AI's reply ends Mira's turn and plays both goblins at `target`: one GM
// turn. Each pair of faces is a goblin's d20 and its d6.
async function oneReply(table, target, [first, second]) {
  const { world, kit, mira, g1, g2 } = table;
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(mira.id));
  const ended = await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: mira.id } });
  assert.equal(ended.ok, true, ended.error);
  kit.place(target.id, 5, 5);
  kit.place(g1.id, 5, 6);
  kit.place(g2.id, 4, 5);
  for (const [enemy, faces] of [[g1, first], [g2, second]]) {
    world.dice(...faces);
    const out = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: enemy.id, targetCharacterId: target.id } });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  return turn;
}

const hp = (world, hero) => world.sheet(hero.id).currentHp;
const hitsOn = (world, hero) => (activePublicEncounter(world.campaignId).lastHits ?? []).filter((hit) => hit.characterId === hero.id);
const react = (world, hero, feature, args = {}) => world.invoke("use_reaction", { characterId: hero.id, feature, ...args });

// ---- every open hit is kept ----

await test("Two goblins hitting one hero in one AI reply leave two open hits, each with its id, and the Hand offers a card for each", async () => {
  const table = await stage();
  const { world, poppy, g1, g2 } = table;
  // 15 + 4 and 16 + 4 against AC 12: 3 + 2 and 5 + 2.
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  assert.equal(hp(world, poppy), 18);
  const hits = hitsOn(world, poppy);
  assert.equal(hits.length, 2, "the second goblin's hit replaced the first");
  assert.deepEqual(hits.map((hit) => hit.attackerId), [g1.id, g2.id], "oldest first");
  assert.ok(hits[0].id && hits[1].id && hits[0].id !== hits[1].id, JSON.stringify(hits));
  assert.equal(openHits(world.campaignId, poppy.id).length, 2);

  const encounter = activePublicEncounter(world.campaignId);
  const cards = reactionCards(poppy, turnFromEncounter(encounter, poppy, { myTurn: false }), encounter.lastHits, world.sheets());
  const dodges = cards.filter((card) => card.name === "Uncanny Dodge");
  assert.equal(dodges.length, 2, "one Uncanny Dodge card per hit");
  assert.deepEqual(dodges.map((card) => card.intent.hit), [hits[0].id, hits[1].id], "each card sends the hit it answers");
  assert.notEqual(dodges[0].id, dodges[1].id);
  assert.match(dodges[0].prompt, new RegExp(`${g1.displayName}'s .* for 5`));
  assert.match(dodges[1].prompt, new RegExp(`${g2.displayName}'s .* for 7`));
  // A card that answers a hit sends it on as use_reaction's own `hit`.
  assert.equal(directCardCall(dodges[0].intent, poppy.id).args.hit, hits[0].id);
});

await test("Uncanny Dodge answers the hit its player picked, and the other stays open", async () => {
  const table = await stage();
  const { world, poppy } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const [first, second] = hitsOn(world, poppy);
  const out = await react(world, poppy, "Uncanny Dodge", { hit: first.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, poppy), 21, "the first hit's 5 is halved to 2; the 7 was halved instead");
  const left = hitsOn(world, poppy);
  assert.deepEqual(left.find((hit) => hit.id === second.id)?.answered, [], "the second hit is untouched and still open");
  assert.deepEqual(left.find((hit) => hit.id === first.id)?.answered, ["uncanny dodge"]);
});

await test("The console names the attack answered by the creature that made it", async () => {
  const table = await stage();
  const { world, poppy, g1 } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  // Unnamed, Uncanny Dodge takes the heaviest blow (the 7); named by the
  // first goblin's id, it takes that goblin's 5.
  const out = await react(world, poppy, "Uncanny Dodge", { hit: g1.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, poppy), 21);
});

await test("Unnamed, Uncanny Dodge halves the heaviest open blow", async () => {
  const table = await stage();
  const { world, poppy } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const out = await react(world, poppy, "Uncanny Dodge");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, poppy), 22, "the 7 is halved to 3");
});

await test("Shield taken against the first hit re-checks every open hit after it (SRD 5.1: including against the triggering attack)", async () => {
  const table = await stage();
  const { world, mira } = table;
  // 10 + 4 = 14 and 12 + 4 = 16 hit AC 12; both miss AC 17.
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  assert.equal(hp(world, mira), 19);
  const encounter = activePublicEncounter(world.campaignId);
  const shields = reactionCards(mira, turnFromEncounter(encounter, mira, { myTurn: false }), encounter.lastHits, world.sheets()).filter((card) => card.name === "Shield");
  assert.equal(shields.length, 1, "Shield is offered once, against the first hit");
  assert.equal(shields[0].intent.hit, hitsOn(world, mira)[0].id);
  assert.match(shields[0].prompt, /, then /, "its prompt names the later hit it covers too");
  const out = await react(world, mira, "Shield", { hit: shields[0].intent.hit });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 30, "both hits now miss: the second stood before");
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 1, "one slot");
  assert.ok(hitsOn(world, mira).every((hit) => hit.answered.includes("shield")));
});

await test("Shield taken against the later hit leaves the earlier one standing", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const [, second] = hitsOn(world, mira);
  const out = await react(world, mira, "Shield", { hit: second.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 25, "the first goblin's 5 stands");
});

await test("A hit named that is no longer open is refused, and nothing is spent", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const out = await react(world, mira, "Shield", { hit: "hgone000" });
  assert.equal(out.ok, false);
  assert.match(out.error, /No attack still open to a reaction matches/, JSON.stringify(out));
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 0);
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false);
});

await test("A later GM turn's attack on the same hero closes the hits of the reply before it", async () => {
  const table = await stage();
  const { world, kit, poppy, g1 } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  kit.freshRound();
  world.dice(15, 1);
  const later = await world.invoke("enemy_attack", { enemyId: g1.id, targetCharacterId: poppy.id });
  world.clearDice();
  assert.equal(later.ok, true, later.error);
  const open = hitsOn(world, poppy);
  assert.equal(open.length, 1, "the console's attack is a later go: the reply's two hits are past answering");
  assert.equal(open[0].damage, 3);
});

await test("A row stored before hits had ids (one record) still reads, answers and is kept as a list", async () => {
  const table = await stage();
  const { world, mira, g1 } = table;
  const encounter = world.encounter();
  const before = snapshotVitals(world.campaignId, world.sheet(mira.id));
  world.patch(mira.id, { currentHp: 25 });
  const at = new Date().toISOString();
  const old = {
    characterId: mira.id,
    encounterId: encounter.id,
    turn: (await import("../src/lib/db/encounters.ts")).turnKey(encounter),
    attacker: { kind: "enemy", id: g1.id, name: g1.displayName },
    attack: "Club",
    type: "bludgeoning",
    ranged: false,
    source: "attack",
    swings: [{ total: 14, faces: [10], natural: 10, advantage: "none", vsAc: 12, hit: true, crit: false, raw: 5 }],
    before,
    after: { currentHp: 25, tempHp: 0, beastHp: null },
    answered: [],
    startedAt: at,
    at,
  };
  getDatabase()
    .prepare(`INSERT INTO last_hits (campaign_id, character_id, payload_json, created_at) VALUES (?, ?, ?, ?)`)
    .run(world.campaignId, mira.id, JSON.stringify(old), at);
  const [shown] = hitsOn(world, mira);
  assert.equal(shown?.id, at, "an old record's id is the moment it was recorded");
  const out = await react(world, mira, "Shield", { hit: at });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 30);
  const row = getDatabase().prepare(`SELECT payload_json FROM last_hits WHERE campaign_id = ? AND character_id = ?`).get(world.campaignId, mira.id);
  assert.ok(Array.isArray(JSON.parse(row.payload_json)), "written back as the list it now is");
});

await test("The narrator is told every open hit with the id use_reaction takes", async () => {
  const table = await stage();
  const { world, poppy, g1, g2 } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const [first, second] = hitsOn(world, poppy);
  const block = buildGameStateBlock({
    campaign: world.campaign(),
    members: listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    encounter: buildEncounterState(world.campaignId, world.sheets()),
  });
  assert.match(block, /Open hits a reaction may still answer/);
  // A line for the 16K profile too: it is there only while hits are open.
  const line = block.split("\n").find((entry) => entry.startsWith("Open hits a reaction may still answer")) ?? "";
  assert.ok(line.length < 800, `the open-hits line is ${line.length} characters`);
  assert.ok(block.includes(`hitId=${first.id} ${g1.displayName}'s Club, 5 bludgeoning`), block);
  assert.ok(block.includes(`hitId=${second.id} ${g2.displayName}'s Club, 7 bludgeoning`), block);
  assert.doesNotMatch(block, /Poppy \[characterId=[^\]]*yours to react for/, "a player's hero reacts when their player says so");
});

// ---- a companion's reactions ----

// Kara and a companion, Pip (a rogue with Uncanny Dodge), against a goblin.
async function withCompanion({ commandedBy = null, human = false } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", proficiencies: TRAINED });
  const bot = createCompanionUser("Pip");
  const made = createSheet(world.campaignId, bot.id, 1, { ...world.sheet(kara.id), name: "Pip" });
  markSheetAsCompanion(made.id, "party", "cheerful");
  setCompanionCommander(made.id, commandedBy === "owner" ? world.owner.id : commandedBy);
  world.patch(made.id, { class: "rogue", level: 5, maxHp: 30, currentHp: 30, ac: 12, acOverride: true, features: [{ name: "Uncanny Dodge", source: "class" }] });
  if (human) {
    setDmMode(world.campaignId, "human", world.owner.id);
  }
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  return { world, kit, kara: world.sheet(kara.id), pip: world.sheet(made.id), goblin: world.enemies()[0] };
}

await test("A companion's commander is offered its reaction, and the actions route takes it off its turn", async () => {
  const { world, kara, pip, goblin } = await withCompanion({ commandedBy: "owner" });
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, kara.id, "Kara acts");
  await world.hitBy(pip.id, { enemyId: goblin.id, name: goblin.displayName, total: 18, vsAc: 12, raw: 6, attack: "Club" });
  const sheets = world.sheets();
  assert.deepEqual(companionReactors(sheets, world.owner.id, kara.id, false).map((sheet) => sheet.id), [pip.id]);
  const stranger = world.addUser("guest");
  assert.deepEqual(companionReactors(sheets, stranger.id, undefined, false), [], "nobody else's");
  const encounter = activePublicEncounter(world.campaignId);
  const [dodge] = offTurnReactionCards(
    companionReactors(sheets, world.owner.id, kara.id, false).map((sheet) => ({ sheet, turn: turnFromEncounter(encounter, sheet, { myTurn: false }) })),
    encounter.lastHits,
    sheets,
  );
  assert.equal(dodge?.name, "Uncanny Dodge");
  assert.deepEqual(dodge.actor, { id: pip.id, name: "Pip" });
  const posted = await route(world, "actions", { kind: "do", content: "Pip twists away.", characterId: pip.id, intent: dodge.intent }, world.owner);
  assert.equal(posted.status, 202, JSON.stringify(posted.body));
  assert.equal(listRecentMessages(world.campaignId, 1)[0].characterId, pip.id, "posted as Pip");
  // Only a reaction: its commander's plain move off its turn is refused.
  const move = await route(world, "actions", { kind: "do", content: "Pip runs.", characterId: pip.id }, world.owner);
  assert.equal(move.status, 409, JSON.stringify(move.body));
});

await test("At a table a person runs, the GM seat plays a companion nobody commands: its reaction card resolves at once", async () => {
  const { world, kit, pip, goblin } = await withCompanion({ human: true });
  assert.deepEqual(companionReactors(world.sheets(), world.owner.id, undefined, true).map((sheet) => sheet.id), [pip.id]);
  assert.deepEqual(companionReactors(world.sheets(), world.owner.id, undefined, false), [], "only from the seat that runs the table");
  kit.place(pip.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  world.dice(15, 4);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: pip.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(world.sheet(pip.id).currentHp, 24);
  const encounter = activePublicEncounter(world.campaignId, { enemyNumbers: true });
  const [dodge] = reactionCards(world.sheet(pip.id), turnFromEncounter(encounter, world.sheet(pip.id), { myTurn: false }), encounter.lastHits, world.sheets(), "Pip");
  assert.equal(dodge?.name, "Uncanny Dodge");
  // A player is not the GM seat.
  const player = world.addHero({ name: "Brom" });
  const refused = await route(world, "actions", { kind: "do", content: "Pip dodges.", characterId: pip.id, intent: dodge.intent }, { id: player.userId });
  assert.ok(refused.status >= 400, JSON.stringify(refused.body));
  assert.equal(world.encounter().reactionsUsed.includes(pip.id), false);
  const played = await route(world, "actions", { kind: "do", content: "Pip twists away.", characterId: pip.id, intent: dodge.intent }, world.owner);
  assert.equal(played.status, 200, JSON.stringify(played.body));
  assert.equal(played.body.resolved, true);
  assert.equal(world.sheet(pip.id).currentHp, 27, "the 6 is halved to 3");
});

await test("At a table the AI runs, the narrator is told a companion nobody commands is its to react for", async () => {
  const { world, pip, goblin } = await withCompanion();
  await world.hitBy(pip.id, { enemyId: goblin.id, name: goblin.displayName, total: 18, vsAc: 12, raw: 6, attack: "Club" });
  const block = buildGameStateBlock({
    campaign: world.campaign(),
    members: listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    encounter: buildEncounterState(world.campaignId, world.sheets()),
  });
  assert.match(block, new RegExp(`Pip \\[characterId=${pip.id}, yours to react for\\]`), block);
  assert.match(block, /you may take it with use_reaction and its characterId/);
  setCompanionCommander(pip.id, world.owner.id);
  const commanded = buildGameStateBlock({
    campaign: world.campaign(),
    members: listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    encounter: buildEncounterState(world.campaignId, world.sheets()),
  });
  assert.doesNotMatch(commanded, /, yours to react for\]/, "a commanded companion reacts when its player says so");
});

// ---- typed words for another hero's reaction ----

await test("Words typed for another hero's reaction go out as that hero, only while they have a hit to answer", async () => {
  const table = await stage();
  const { world, poppy, mira, g1 } = table;
  // Before any hit, there is nothing to answer.
  const early = await route(world, "actions", { kind: "do", content: "Poppy rolls aside.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(early.status, 409, JSON.stringify(early.body));
  // Mira's turn; Poppy is hit (an opportunity attack, say).
  await world.hitBy(poppy.id, { enemyId: g1.id, name: g1.displayName, total: 18, vsAc: 12, raw: 6, attack: "Club" });
  const encounter = activePublicEncounter(world.campaignId);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", encounter), [{ id: poppy.id, name: "Poppy" }]);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "one_active", encounter), [], "one hero fielded at a time");
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, undefined, "all_active", encounter), [], "not on their turn: the box is shut");

  // Without Speaking as, the words are Mira's turn's or refused as Poppy's.
  const plain = await route(world, "actions", { kind: "do", content: "Poppy rolls aside.", characterId: poppy.id }, world.owner);
  assert.equal(plain.status, 409, JSON.stringify(plain.body));
  // A hero handed a card for an ally's hit (Protection) is offered too.
  const third = world.addHero({ name: "Bram", user: world.owner });
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", encounter, third.id).map((entry) => entry.name), ["Poppy", "Bram"]);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", encounter).map((entry) => entry.name), ["Poppy"], "but not unasked: Bram was not hit");

  const typed = await route(world, "actions", { kind: "do", content: "Poppy rolls aside.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(typed.status, 202, JSON.stringify(typed.body));
  assert.equal(listRecentMessages(world.campaignId, 1)[0].characterId, poppy.id, "posted as Poppy, not as Mira");
  assert.equal(declaredThisTurn(world.campaignId, mira.id), false, "and no word on Mira's turn");

  // Once Poppy's reaction is spent, the choice goes and the route refuses.
  const live = world.encounter();
  table.kit.saveEncounter({ ...live, reactionsUsed: [...live.reactionsUsed, poppy.id] });
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", activePublicEncounter(world.campaignId)), []);
  const spent = await route(world, "actions", { kind: "do", content: "Poppy rolls aside again.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(spent.status, 409, JSON.stringify(spent.body));
});

await test("A reaction typed by the hero up next, hit in the enemies' pass, is marked as one and leaves their own turn waiting on their word", async () => {
  const table = await stage();
  const { world, poppy } = table;
  // The reply ends Mira's turn and the goblins hit Poppy, who is up next.
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, poppy.id, "Poppy's turn waits on her player");
  const encounter = activePublicEncounter(world.campaignId);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, poppy.id, "all_active", encounter), [{ id: poppy.id, name: "Poppy" }], "her own reaction is offered beside her turn");

  const typed = await route(world, "actions", { kind: "do", content: "Poppy twists away from the second club.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(typed.status, 202, JSON.stringify(typed.body));
  const [line] = listRecentMessages(world.campaignId, 1);
  assert.equal(line.characterId, poppy.id);
  assert.deepEqual(line.intent, { card: "reaction" }, "marked as a reaction, as a card is");
  assert.equal(declaredThisTurn(world.campaignId, poppy.id), false, "a reaction is no word on her turn");
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, poppy.id, "the AI still waits on Poppy's player for her turn");
  // The narrator reads it as her words to answer with use_reaction; nothing
  // chases it as a card or hands it back.
  assert.match(describeIntent(line.intent, poppy.id), /A reaction for characterId=.*use_reaction.*no action on their own turn/);
  assert.equal(intentNeedsTool(line.intent), false);
  // Her next plain line is her turn's word, as before.
  const move = await route(world, "actions", { kind: "do", content: "Poppy stabs the nearer goblin.", characterId: poppy.id }, world.owner);
  assert.ok(move.status < 400, JSON.stringify(move.body));
  assert.equal(declaredThisTurn(world.campaignId, poppy.id), true);
});

// ---- Shield and a hit on a hero at 0 ----
// Mira at 6 of 30. The first goblin's club drops her; the second hits her at
// 0 from beside her, a critical hit (SRD 5.1: a hit within 5 feet of an
// unconscious creature), and two death-save failures. Shield, cast as the
// first hit lands, re-checks both with +5 AC.

async function downedTwice(table, first, second) {
  const { world, mira } = table;
  world.patch(mira.id, { currentHp: 6 });
  await oneReply(table, mira, [first, second]);
  const [h1, h2] = openHits(world.campaignId, mira.id);
  assert.equal(h1.swings[0].hit, true, JSON.stringify(h1.swings));
  assert.equal(h1.before.currentHp, 6);
  assert.equal(h2.before.currentHp, 0, "the second blow found her down");
  assert.equal(h2.swings[0].hit, true, JSON.stringify(h2.swings));
  assert.equal(h2.swings[0].crit, true, "a hit beside an unconscious creature is critical");
  assert.equal(world.sheet(mira.id).deathSaves?.failures, 2, "two failures on a critical hit");
  return { h1, h2 };
}

const track = (world, hero) => world.sheet(hero.id).deathSaves;
const down = (world, hero) => world.sheet(hero.id).conditions.map((entry) => entry.toLowerCase());

await test("Shield turning both hits into misses gives back the drop and the second hit's failures", async () => {
  const table = await stage();
  const { world, mira } = table;
  // 10 + 4 = 14 and 12 + 4 = 16: both miss AC 17.
  await downedTwice(table, [10, 5], [12, 12, 3, 3]);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).currentHp, 6);
  assert.equal(track(world, mira)?.failures ?? 0, 0);
  assert.ok(!down(world, mira).includes("unconscious"), down(world, mira).join(", "));
});

await test("Shield that leaves the first hit standing still takes back the later hit's failures", async () => {
  const table = await stage();
  const { world, mira } = table;
  // 15 + 4 = 19 still hits AC 17; the second's 16 now misses.
  await downedTwice(table, [15, 5], [12, 12, 3, 3]);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).currentHp, 0, "the first club still drops her");
  assert.equal(track(world, mira)?.failures, 0, "the second club's two failures are taken back");
  assert.equal(track(world, mira)?.dead, false);
  assert.ok(down(world, mira).includes("unconscious"));
});

await test("Shield that turns the first hit away makes the later hit land on her standing: hit point damage, no failures", async () => {
  const table = await stage();
  const { world, mira } = table;
  // The first's 14 now misses; the second's 19 still hits, for 1 + 1 + 2.
  await downedTwice(table, [10, 5], [15, 15, 1, 1]);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).currentHp, 2, "the second club's 4 comes off the 6 she kept");
  assert.equal(track(world, mira)?.failures ?? 0, 0);
  assert.ok(!down(world, mira).includes("unconscious"), down(world, mira).join(", "));
});

await test("A hero at 0 when a hit lands cannot react to it, and nothing is spent", async () => {
  const table = await stage();
  const { world, mira } = table;
  const { h2 } = await downedTwice(table, [15, 5], [12, 12, 3, 3]);
  const out = await react(world, mira, "Shield", { hit: h2.id });
  assert.equal(out.ok, false, "Shield against the blow that found her down");
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 0);
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false);
  assert.equal(track(world, mira)?.failures, 2);
});

await test("Her earlier Shield still counts against a later attack on her at 0", async () => {
  const table = await stage();
  const { world, mira, g2 } = table;
  world.patch(mira.id, { currentHp: 6 });
  // Only the first goblin swings in the reply: 19 still hits AC 17.
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(mira.id));
  assert.equal((await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: mira.id } })).ok, true);
  table.kit.place(mira.id, 5, 5);
  table.kit.place(table.g1.id, 5, 6);
  table.kit.place(g2.id, 4, 5);
  world.dice(15, 5);
  assert.equal((await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: table.g1.id, targetCharacterId: mira.id } })).ok, true);
  world.clearDice();
  const shield = await react(world, mira, "Shield");
  assert.equal(shield.ok, true, shield.error);
  assert.equal(world.sheet(mira.id).currentHp, 0, "the club still drops her");
  // The second goblin's 16 meets the shielded 17 and misses: no failure.
  world.dice(12, 12, 3, 3);
  const later = await world.invoke("enemy_attack", { enemyId: g2.id, targetCharacterId: mira.id });
  world.clearDice();
  assert.equal(later.ok, true, later.error);
  assert.equal(track(world, mira)?.failures ?? 0, 0, JSON.stringify(later.result));
});

await test("The screens wire it: Speaking as on its host flag, Edit in chat names the card's hero, and the companions' reactions in the Hand", () => {
  const view = read("app/campaigns/[campaignId]/SessionView.tsx");
  assert.match(view, /hostOffers\(capabilities, "typedReactions"\)/);
  assert.match(view, /kind === "do" && speakingAs/);
  assert.match(view, /characterId: speakingAs\.id, reaction: true/);
  assert.match(view, /setReactAs\(null\)/, "back on the hero whose turn it is after a send");
  const composer = read("app/campaigns/[campaignId]/Composer.tsx");
  assert.match(composer, /<ReactAsPicker /);
  assert.match(composer, /kind === "do" && speakingAs\?\.reactors\.length/, "in Do: a reaction is something done");
  assert.match(composer, /onComposeAs=\{speakingAs\?\.onChange\}/);
  const picker = read("app/campaigns/[campaignId]/ReactAsPicker.tsx");
  assert.match(picker, /label="Speaking as"/, "named for screen readers");
  assert.match(picker, /size="sm"/, "the kit's small select: 40 px on a touch screen");
  const hand = read("app/campaigns/[campaignId]/Hand.tsx");
  assert.match(hand, /hostOffers\(capabilities, "companionReactions"\)/);
  assert.match(hand, /companionReactors\(sheets, meUserId, sheet\.id, runsTable\)/);
  assert.match(hand, /onComposeAs\?\.\(picked\?\.actor\?\.id \?\? null\)/);
  assert.match(hand, /hostOffers\(capabilities, "reactionHits"\)/);
});

await test("A card from another hero aims at its own hit's attacker", () => {
  const card = { id: "reaction:hellish-rebuke~h2@m", target: "enemy", answers: { characterId: "m", hitId: "h2", attackerId: "g2", attacker: "Goblin 2" } };
  const hits = [
    { characterId: "m", attackerId: "g1", attacker: "Goblin 1" },
    { characterId: "m", attackerId: "g2", attacker: "Goblin 2" },
  ];
  assert.deepEqual(reactionAim(card, hits, "m", []), { id: "g2", name: "Goblin 2", kind: "enemy" }, "the first hit's attacker was every card's aim");
});

finish();
