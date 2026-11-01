// A dying hero's death save waits its place in the initiative order, and the
// round turns over only when the order wraps (issue 713). SRD 5.1: a
// creature at 0 hit points makes its death saving throw at the start of each
// of its turns, and a round ends when everyone in the order has had a turn.
//
// The play-test: Vesper (24) dying, Vyrrath Stormclaw, Tamsin (14) ending
// her turn, Goblin 1 and Thug 1 (11) and Thug 2 (4) still to act. The engine
// rolled Vesper's save at once, said the three act before Vyrrath, and the
// round header already showed the next round. Right: the enemies act first
// (together, before the next hero who can act), then the order wraps, the
// round goes up, and Vesper's save rolls at her place, then Vyrrath's turn.
//
// Every path that passes a turn is walked here: the End Turn button, the GM
// console's end_turn, pc_attack's endTurn, the lead's skip, the DM's step
// forward, the AI's end_turn, the server playing the enemies at an AI table
// after a DM turn, and a person's table where the GM plays the enemies'
// cards and hands the turn on. Every die that matters is forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { allocateSeq, setDmMode } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createDmTurn, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { editInitiative } = await import("../src/lib/dm/initiative.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { freshLastHit } = await import("../src/lib/dm/last-hit.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
// Loaded before the waker below, which takes its place in the registry.
await import("../src/lib/dm/loop.ts");

const { test, finish } = suite("test-enforce-dying-turn-order");

registerDmWaker(() => {});

// ---- staging ----

const ALIVE = { successes: 0, failures: 0, stable: false, dead: false };

// The play-test's table. `order` lists [name, initiative] from the top; a
// hero's name is a hero, anything else one of the dummies, renamed. The turn
// is `turn`'s, in `round`. `dying` are at 0 hit points, neither stable nor
// dead. `human`: a person runs the story (the test fight's "You run it").
async function stage({
  order = [["Vesper", 24], ["Vyrrath Stormclaw", 18], ["Tamsin", 14], ["Goblin 1", 11], ["Thug 1", 11], ["Thug 2", 4]],
  heroes = ["Vesper", "Vyrrath Stormclaw", "Tamsin"],
  turn = "Tamsin",
  round = 2,
  dying = ["Vesper"],
  human = true,
} = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const sheets = new Map(heroes.map((name) => [name, world.addHero({ name, abilities: { dex: 10, con: 10, wis: 10 } })]));
  const foes = order.filter(([name]) => !sheets.has(name));
  await kit.fight(foes.length);
  if (human) {
    assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the GM's seat");
  }
  const enemies = new Map(world.enemies().map((enemy, index) => [foes[index][0], enemy]));
  for (const [name, initiative] of foes) {
    getDatabase().prepare(`UPDATE encounter_enemies SET display_name = ?, initiative = ? WHERE id = ?`).run(name, initiative, enemies.get(name).id);
  }
  const entries = order.map(([name, initiative]) => {
    const sheet = sheets.get(name);
    return sheet
      ? { kind: "pc", characterId: sheet.id, userId: sheet.userId, name, initiative }
      : { kind: "enemy", enemyId: enemies.get(name).id, name, initiative };
  });
  kit.saveEncounter({ ...world.encounter(), order: entries, turnIndex: order.findIndex(([name]) => name === turn), round, surprisedIds: [], turnBudget: null });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  for (const name of dying) {
    world.patch(sheets.get(name).id, { currentHp: 0, deathSaves: { ...ALIVE } });
  }
  // The heroes in one corner and the enemies out of reach in the other, so
  // an enemy the server plays walks and stands: no die but the save's.
  const board = kit.map();
  [...sheets.values()].forEach((sheet, index) => kit.place(sheet.id, 0, index));
  [...enemies.values()].forEach((enemy, index) => kit.place(enemy.id, board.width - 1, board.height - 1 - index));
  return { world, kit, hero: (name) => sheets.get(name), enemy: (name) => enemies.get(name) };
}

const currentName = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex]?.name ?? null : null;
};
const due = (world) => world.encounter().legendary.due ?? [];
const savesOf = (world, sheetId) =>
  listRecentRolls(world.campaignId, 200).filter((roll) => roll.characterId === sheetId && /death save/.test(roll.detail ?? ""));
const transcript = (world) => listRecentMessages(world.campaignId, 200).map((message) => message.content);
const cues = (world) => listRecentMessages(world.campaignId, 200).filter((message) => message.glyph === "cue-battle").map((message) => message.content);
const roundShown = (world) => activePublicEncounter(world.campaignId).round;

// The DM turn that just finished, as finalize() runs it: its narration is
// posted, then the turn order is settled (the backstop plays the enemies the
// model left).
function dmTurnEnds(world, turn = createDmTurn(world.campaignId, [], "ai")) {
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "The fight goes on." });
  tools.advanceAfterTurn(world.campaign(), turn);
  return turn;
}

// What every pass from Tamsin owes the table before the enemies have gone:
// they are due, the round is the one they act in, and Vesper has not rolled.
function enemiesFirst(world, { hero, enemy }, label) {
  assert.deepEqual(due(world), [enemy("Goblin 1").id, enemy("Thug 1").id, enemy("Thug 2").id], `${label}: the three enemies are due`);
  assert.equal(savesOf(world, hero("Vesper").id).length, 0, `${label}: Vesper's save waits for her place, after the enemies`);
  assert.equal(world.encounter().round, 2, `${label}: round 2's enemies are still to act, so the order has not wrapped`);
  assert.equal(roundShown(world), 2, `${label}: and the round header says so`);
  assert.equal(currentName(world), "Vyrrath Stormclaw", `${label}: Vyrrath is up next`);
}

// Once the enemies have gone: the order wrapped, the round went up, Vesper
// rolled once, and the turn is Vyrrath's.
function thenTheSave(world, { hero }, label) {
  assert.equal(world.encounter().round, 3, `${label}: the order wrapped once the enemies had gone`);
  assert.equal(roundShown(world), 3, `${label}: the round header follows`);
  assert.equal(savesOf(world, hero("Vesper").id).length, 1, `${label}: Vesper's turn, a death save, came at her place`);
  assert.equal(currentName(world), "Vyrrath Stormclaw", `${label}: then Vyrrath's turn`);
  assert.deepEqual(due(world), [], `${label}: nobody is due`);
}

// ---- the play-test, at a table a person runs ----

await test("End Turn at a person's table: the three enemies act first, then the round turns over and Vesper's save rolls, then Vyrrath", async () => {
  const table = await stage();
  const { world, kit, hero } = table;
  world.dice(10);
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true, "Tamsin ends her turn");
  enemiesFirst(world, table, "after End Turn");
  const passed = cues(world).at(-1);
  assert.equal(passed, "Tamsin ends their turn. It is now Vyrrath Stormclaw's turn. Goblin 1 and Thug 1 and Thug 2 act before Vyrrath Stormclaw.", "the enemies are named together, as before; Vesper is not, yet");
  const before = transcript(world).length;
  kit.handOnEnemies();
  world.clearDice();
  thenTheSave(world, table, "after the hand-on");
  const after = transcript(world).slice(before);
  assert.equal(after[0], "Vesper is dying: their turn is a death save. It is now Vyrrath Stormclaw's turn (round 3).", "the table is told where the turn went");
  assert.match(after[1], /^Vesper death save/, "then the save that is her turn");
});

await test("The GM console's end_turn and pc_attack's endTurn wait the same way", async () => {
  for (const [label, end] of [
    ["end_turn", (world, table) => world.invoke("end_turn", { characterId: table.hero("Tamsin").id })],
    ["pc_attack endTurn", async (world, table) => {
      const { kit, hero, enemy } = table;
      kit.place(enemy("Goblin 1").id, 5, 5);
      kit.place(hero("Tamsin").id, 5, 6);
      world.dice(1);
      const swung = await kit.attack(hero("Tamsin").id, enemy("Goblin 1").id, { endTurn: true });
      world.clearDice();
      assert.ok(swung.result?.turnEnded, `the attack ended the turn: ${swung.error ?? JSON.stringify(swung.result?.turnNotEnded ?? "")}`);
      return swung;
    }],
  ]) {
    const table = await stage();
    const { world, kit } = table;
    const ended = await end(world, table);
    assert.equal(ended.ok, true, `${label}: ${ended.error ?? ""}`);
    enemiesFirst(world, table, label);
    world.dice(10);
    kit.handOnEnemies();
    world.clearDice();
    thenTheSave(world, table, label);
  }
});

await test("The GM's own enemy cards, then Hand on: the enemies' rolls come before Vesper's save", async () => {
  const table = await stage();
  const { world, kit, hero, enemy } = table;
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  enemiesFirst(world, table, "after End Turn");
  // The GM plays each one from the monsters' Hand: a swing at Tamsin, a miss.
  kit.place(hero("Tamsin").id, 5, 5);
  for (const [name, x] of [["Goblin 1", 4], ["Thug 1", 6], ["Thug 2", 5]]) {
    kit.place(enemy(name).id, x, name === "Thug 2" ? 6 : 4);
    world.dice(1);
    const swung = await world.invoke("enemy_attack", { enemyId: enemy(name).id, targetCharacterId: hero("Tamsin").id });
    world.clearDice();
    assert.equal(swung.ok, true, `${name}: ${swung.error ?? ""}`);
  }
  assert.equal(savesOf(world, hero("Vesper").id).length, 0, "the enemies have gone, but the turn is not handed on yet");
  assert.equal(world.encounter().round, 2);
  world.dice(10);
  kit.handOnEnemies();
  world.clearDice();
  thenTheSave(world, table, "after Hand on");
  const rolls = listRecentRolls(world.campaignId, 200);
  const save = rolls.findIndex((roll) => roll.characterId === hero("Vesper").id && /death save/.test(roll.detail ?? ""));
  const lastSwing = rolls.findLastIndex((roll) => roll.attacker?.kind === "enemy");
  assert.ok(save >= 0 && lastSwing >= 0 && save > lastSwing, "the save is rolled after every enemy's swing");
});

await test("The lead's skip and the DM's step forward wait the same way", async () => {
  for (const [label, pass] of [
    ["the lead's skip", (world) => assert.equal(tools.skipCurrentTurn(world.campaignId), true)],
    ["the DM's step forward", (world) => assert.equal(editInitiative(world.campaign(), { op: "step", direction: "forward" }).ok, true)],
  ]) {
    const table = await stage();
    const { world, kit } = table;
    pass(world);
    enemiesFirst(world, table, label);
    world.dice(10);
    kit.handOnEnemies();
    world.clearDice();
    thenTheSave(world, table, label);
  }
});

// ---- at an AI table ----

await test("End Turn at an AI table: the DM turn it wakes plays the enemies, and only then does the round turn over and Vesper roll", async () => {
  const table = await stage({ human: false });
  const { world, hero } = table;
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  enemiesFirst(world, table, "after End Turn");
  world.dice(10);
  dmTurnEnds(world);
  world.clearDice();
  thenTheSave(world, table, "after the DM turn");
  const lines = transcript(world);
  const backstop = lines.findIndex((line) => /^Skipped enemy turns resolve automatically/.test(line));
  const save = lines.findIndex((line) => /^Vesper death save/.test(line));
  assert.ok(backstop >= 0 && save > backstop, "the enemies' turns are said before Vesper's save");
});

await test("The AI's own end_turn: it is told the enemies act first and the next turn is round 3's; the save rolls after the enemies, once its turn is done", async () => {
  const table = await stage({ human: false });
  const { world, hero } = table;
  const turn = createDmTurn(world.campaignId, [], "ai");
  world.say("player", "That's my turn.", world.sheet(hero("Tamsin").id));
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId: hero("Tamsin").id } });
  assert.equal(ended.ok, true, ended.error);
  assert.match(ended.result.note, /Goblin 1 and Thug 1 and Thug 2 act before Vyrrath Stormclaw\..* It is now Vyrrath Stormclaw's turn \(round 3\)\.$/);
  assert.equal(ended.result.round, 3, "the round the next turn is in");
  assert.equal(savesOf(world, hero("Vesper").id).length, 0, "no save while the model still has the enemies to play");
  assert.equal(world.encounter().round, 2);
  world.dice(10);
  dmTurnEnds(world, getDmTurn(turn.id));
  world.clearDice();
  thenTheSave(world, table, "after its turn");
  const lines = transcript(world);
  const backstop = lines.findIndex((line) => /^Skipped enemy turns resolve automatically/.test(line));
  const save = lines.findIndex((line) => /^Vesper death save/.test(line));
  assert.ok(backstop >= 0 && save > backstop, "the enemies' turns are said before Vesper's save");
});

await test("The model plays the enemies, then ends the next turn in the same reply: each acts once a round, and the round still turns over in between", async () => {
  const table = await stage({ human: false });
  const { world, hero, enemy } = table;
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  const turn = createDmTurn(world.campaignId, [], "ai");
  table.kit.place(hero("Tamsin").id, 5, 5);
  for (const [name, x, y] of [["Goblin 1", 4, 4], ["Thug 1", 6, 4], ["Thug 2", 5, 6]]) {
    table.kit.place(enemy(name).id, x, y);
    world.dice(1);
    const played = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "enemy_attack", args: { enemyId: enemy(name).id, targetCharacterId: hero("Tamsin").id } });
    world.clearDice();
    assert.equal(played.ok, true, `${name}: ${played.error ?? ""}`);
  }
  assert.equal(world.encounter().round, 2, "round 2's enemies acted in round 2");
  assert.equal(savesOf(world, hero("Vesper").id).length, 0, "nor has Vesper's turn come");
  world.say("player", "Vyrrath is done.", world.sheet(hero("Vyrrath Stormclaw").id));
  world.dice(10);
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId: hero("Vyrrath Stormclaw").id } });
  world.clearDice();
  assert.equal(ended.ok, true, ended.error);
  assert.equal(world.encounter().round, 3, "the order wrapped before Vyrrath's turn, which then ended");
  assert.equal(savesOf(world, hero("Vesper").id).length, 1, "Vesper's turn came between: one save");
  assert.equal(currentName(world), "Tamsin");
  assert.equal(ended.result.enemiesToAct, undefined, "no enemy between Vyrrath and Tamsin");
});

// ---- where the save does not wait ----

await test("A dying hero whose place comes before the enemies rolls at once; the round still waits for them", async () => {
  const table = await stage({
    order: [["Vyrrath Stormclaw", 20], ["Tamsin", 14], ["Vesper", 12], ["Goblin 1", 11], ["Thug 1", 11], ["Thug 2", 4]],
  });
  const { world, kit, hero } = table;
  world.dice(10);
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  world.clearDice();
  assert.equal(savesOf(world, hero("Vesper").id).length, 1, "Vesper's place is before the goblin's: her save is now");
  assert.equal(world.encounter().round, 2, "the enemies after her are still round 2's");
  assert.match(cues(world).at(-1), /^Tamsin ends their turn\. Vesper is dying: their turn is a death save\. It is now Vyrrath Stormclaw's turn\./);
  kit.handOnEnemies();
  assert.equal(world.encounter().round, 3);
  assert.equal(savesOf(world, hero("Vesper").id).length, 1, "no second save for the same turn");
  assert.equal(currentName(world), "Vyrrath Stormclaw");
});

await test("A hero who is stable, and one who is dead, are passed as before: no save, and the round turns over after the enemies", async () => {
  const table = await stage({ dying: [] });
  const { world, kit, hero } = table;
  world.patch(hero("Vesper").id, { currentHp: 0, deathSaves: { successes: 3, failures: 0, stable: true, dead: false } });
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  assert.equal(world.encounter().round, 2);
  kit.handOnEnemies();
  assert.equal(world.encounter().round, 3);
  assert.equal(savesOf(world, hero("Vesper").id).length, 0, "stable: no save");
  assert.equal(currentName(world), "Vyrrath Stormclaw");
  assert.equal(cues(world).at(-1), "It is now Vyrrath Stormclaw's turn (round 3).");
});

await test("A dying hero between two enemies of the same round rolls after both: the enemies act together before the next hero", async () => {
  const table = await stage({
    order: [["Vyrrath Stormclaw", 20], ["Tamsin", 14], ["Goblin 1", 12], ["Vesper", 11], ["Thug 1", 10], ["Thug 2", 4]],
  });
  const { world, kit, hero, enemy } = table;
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  assert.deepEqual(due(world), [enemy("Goblin 1").id, enemy("Thug 1").id, enemy("Thug 2").id], "one group, as before");
  assert.equal(savesOf(world, hero("Vesper").id).length, 0, "Goblin 1 acts before her");
  world.dice(10);
  kit.handOnEnemies();
  world.clearDice();
  assert.equal(savesOf(world, hero("Vesper").id).length, 1);
  assert.equal(world.encounter().round, 3);
});

await test("An enemy after the wrap acts in the new round, after the save before it, and its own round's action is not refused", async () => {
  const table = await stage({
    order: [["Vesper", 24], ["Goblin 1", 22], ["Vyrrath Stormclaw", 18], ["Tamsin", 14], ["Thug 1", 4]],
    human: false,
  });
  const { world, kit, hero, enemy } = table;
  // Goblin 1 took its round-2 action at its place.
  const staged = world.encounter();
  kit.saveEncounter({ ...staged, legendary: { ...staged.legendary, acted: { round: 2, ids: [enemy("Goblin 1").id] } } });
  const turn = createDmTurn(world.campaignId, [], "ai");
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  assert.deepEqual(due(world), [enemy("Thug 1").id], "only round 2's thug is due before the wrap");
  assert.equal(world.encounter().round, 2);
  world.dice(10);
  dmTurnEnds(world, turn);
  world.clearDice();
  assert.equal(world.encounter().round, 3, "the thug went, the order wrapped");
  assert.equal(savesOf(world, hero("Vesper").id).length, 1, "Vesper rolled at her place");
  const live = world.encounter();
  const acted = live.legendary.acted;
  const goblinActed = acted?.round === 3 && acted.ids.includes(enemy("Goblin 1").id);
  assert.ok(due(world).includes(enemy("Goblin 1").id) || goblinActed, "Goblin 1 has its round-3 turn, not lost to its round-2 one");
});

// ---- a reaction answers the hit, until somebody acts ----
// The same root cause: the pointer rests on the hero up next while the
// enemies before them take their turns, so a hit stayed answerable through
// the other enemies' attacks and the next hero's whole turn. SRD 5.1: a
// reaction is taken right after its trigger, and it comes back at the start
// of its owner's turn. The hit stays answerable until the next attack on
// anyone or the next turn's creature's first thing (an action, a step,
// ending the turn); the enemies' turns ending alone closes nothing, so the
// player hit has time to read it.

// An enemy's swing at a hero, from the console (`actor` "human") or the
// model's own turn, with dice that hit for 5. Both go back to their corners.
async function swingAt(world, kit, enemy, hero, actor) {
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  world.dice(15, 3);
  const args = { enemyId: enemy.id, targetCharacterId: hero.id };
  const out = actor.kind === "human" ? await world.invoke("enemy_attack", args) : await invokeEngine(world.campaign(), actor, { name: "enemy_attack", args });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  kit.place(hero.id, 0, ["Vesper", "Vyrrath Stormclaw", "Tamsin"].indexOf(hero.name));
  kit.place(enemy.id, kit.map().width - 1, 0);
}
const answerable = (world, hero) => {
  const shown = (activePublicEncounter(world.campaignId).lastHits ?? []).some((hit) => hit.characterId === hero.id);
  assert.equal(shown, Boolean(freshLastHit(world.campaignId, hero.id)), "the Hand offers what the engine would take");
  return shown;
};
const upNow = (world) => world.sheet(world.encounter().order[world.encounter().turnIndex].characterId);
// A player's own step on the board, through the route their drag calls.
async function step(world, hero, x, y) {
  world.signIn({ id: hero.userId });
  const handler = await world.route("campaigns/[campaignId]/battle-map/move");
  const response = await handler.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ x, y }) }), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  assert.equal(response.status, 200, JSON.stringify(await response.json().catch(() => ({}))));
}

await test("At a person's table a hit is answerable until the next attack, through the GM's Hand on, until the next hero's first action", async () => {
  const table = await stage({ dying: [] });
  const { world, kit, hero, enemy } = table;
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  const gm = { kind: "human" };
  await swingAt(world, kit, enemy("Goblin 1"), hero("Vyrrath Stormclaw"), gm);
  assert.equal(answerable(world, hero("Vyrrath Stormclaw")), true, "open on the hit");
  await swingAt(world, kit, enemy("Thug 1"), hero("Tamsin"), gm);
  assert.equal(answerable(world, hero("Vyrrath Stormclaw")), false, "closed once the next enemy attacked");
  assert.equal(answerable(world, hero("Tamsin")), true);
  kit.handOnEnemies();
  assert.equal(answerable(world, hero("Tamsin")), true, "handing the turn on closes nothing: Tamsin's player still has time to answer");
  const next = upNow(world);
  const dodged = await world.invoke("take_action", { characterId: next.id, action: "dodge" });
  assert.equal(dodged.ok, true, dodged.error);
  assert.equal(answerable(world, hero("Tamsin")), false, `${next.name}'s first action closed it`);
});

await test("Mid-round, a hit in the enemies' turns stays open into the hero's turn and closes at their first step, or at their End Turn", async () => {
  for (const first of ["step", "End Turn"]) {
    const table = await stage({
      order: [["Tamsin", 20], ["Goblin 1", 15], ["Vyrrath Stormclaw", 10], ["Vesper", 5]],
      dying: [],
    });
    const { world, kit, hero, enemy } = table;
    kit.openField();
    assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
    await swingAt(world, kit, enemy("Goblin 1"), hero("Vyrrath Stormclaw"), { kind: "human" });
    kit.handOnEnemies();
    assert.equal(currentName(world), "Vyrrath Stormclaw");
    assert.equal(answerable(world, hero("Vyrrath Stormclaw")), true, `${first}: his turn began, and he has done nothing with it yet`);
    if (first === "step") {
      await step(world, hero("Vyrrath Stormclaw"), 1, 1);
    } else {
      assert.equal(tools.endOwnTurn(world.campaignId, hero("Vyrrath Stormclaw").userId), true);
    }
    assert.equal(answerable(world, hero("Vyrrath Stormclaw")), false, `${first}: past answering once he acted`);
  }
});

await test("At an AI table a hit the model's reply dealt is still answerable after the reply ends, and closes at the next hero's first step", async () => {
  const table = await stage({ human: false, dying: [] });
  const { world, kit, hero, enemy } = table;
  kit.openField();
  const turn = createDmTurn(world.campaignId, [], "ai");
  world.say("player", "That's my turn.", world.sheet(hero("Tamsin").id));
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId: hero("Tamsin").id } });
  assert.equal(ended.ok, true, ended.error);
  const ai = { kind: "ai", turnId: turn.id };
  await swingAt(world, kit, enemy("Goblin 1"), hero("Vyrrath Stormclaw"), ai);
  assert.equal(answerable(world, hero("Vyrrath Stormclaw")), true, "open on the hit");
  await swingAt(world, kit, enemy("Thug 1"), hero("Tamsin"), ai);
  assert.equal(answerable(world, hero("Vyrrath Stormclaw")), false, "closed once the next enemy attacked");
  dmTurnEnds(world, getDmTurn(turn.id));
  assert.equal(answerable(world, hero("Tamsin")), true, "the reply is over and Tamsin's player can still read the hit and answer it");
  const next = upNow(world);
  await step(world, next, 1, ["Vesper", "Vyrrath Stormclaw", "Tamsin"].indexOf(next.name));
  assert.equal(answerable(world, hero("Tamsin")), false, `${next.name}'s first step closed it`);
});

await test("A hit in the hero's own turn stays answerable through the rest of it and the enemies after, until the next hero acts", async () => {
  const table = await stage({ dying: [] });
  const { world, kit, hero, enemy } = table;
  await swingAt(world, kit, enemy("Goblin 1"), hero("Tamsin"), { kind: "human" });
  assert.equal(answerable(world, hero("Tamsin")), true, "an attack in her own turn (an opportunity attack, a readied one)");
  const dodged = await world.invoke("take_action", { characterId: hero("Tamsin").id, action: "dodge" });
  assert.equal(dodged.ok, true, dodged.error);
  assert.equal(answerable(world, hero("Tamsin")), true, "what she does with her own turn does not close it");
  assert.equal(tools.endOwnTurn(world.campaignId, hero("Tamsin").userId), true);
  assert.equal(answerable(world, hero("Tamsin")), true, "nor does ending it");
  kit.handOnEnemies();
  assert.equal(answerable(world, hero("Tamsin")), true, "nor the enemies' turns, which attacked nobody");
  const next = upNow(world);
  assert.equal(tools.endOwnTurn(world.campaignId, next.userId), true);
  assert.equal(answerable(world, hero("Tamsin")), false, `${next.name} ending their turn closed it`);
});

finish();
