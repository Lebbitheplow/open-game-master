// A fight that goes on without someone (issue 740): start_encounter staged
// every party character, so one the story had far away, or who knew nothing
// of it, rolled initiative and stood on the board. `absent` names them.
//   - they roll nothing, hold no slot and no token, and the order closes
//     without them; with no `absent` every character is staged as before;
//   - a name is whole or one word of a name; a name that fits nobody or
//     several, everyone absent, and any other shape refuse with no fight;
//   - their initiative roll brings them in, with a token on a free square;
//   - the budget, enemy targets, an aura, XP and the after-fight card count
//     who is there, and the party's lists outside the fight do not change;
//   - someone behind a door is not absent, in what the GM reads.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-fight-away");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const { resolveAwayNames, atTheFight } = await import("../src/lib/dm/fight-away-logic.ts");
const { applyEncounterCall, ensureInitiativeProgress } = await import("../src/lib/dm/encounter-tools.ts");
const { applyExtraEncounterCall } = await import("../src/lib/dm/encounter-tools-extra.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { getBattleMapForEncounter, getTokenByRef, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { getEncounter, getLatestEndedEncounter, listEnemies, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { deleteSheetById, listSheets } = await import("../src/lib/db/sheets.ts");
const { fieldedSheets } = await import("../src/lib/dm/roster.ts");
const { allySaveAura } = await import("../src/lib/dm/aura.ts");
const { standingOn } = await import("../src/lib/dm/combatant.ts");
const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const { blocksMove, tileAt } = await import("../src/lib/battlemap/types.ts");

const alice = world.addHero({ name: "Alice Smith", level: 3, maxHp: 30 });
const bram = world.addHero({ name: "Bram", level: 3, maxHp: 30 });
const cora = world.addHero({ name: "Cora Vale", level: 3, maxHp: 30 });

// A call the AI GM makes, the way the turn loop runs it, arguments as sent.
function ai(name, args, actor = "ai") {
  const turn = createDmTurn(world.campaignId, [], actor);
  const sheets = listSheets(world.campaignId);
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const raw = JSON.stringify(args);
  const result =
    applyExtraEncounterCall(world.campaign(), turn, name, raw, sheets, byId)?.result ??
    applyEncounterCall(world.campaign(), turn, name, raw, sheets, byId, { realDiceUserIds: new Set(), toolCallId: null }).result;
  return result.error ? { ok: false, ...result } : { ok: true, result };
}

const GOBLIN = [{ monster: "goblin", count: 1 }];
const orderIds = () => world.encounter().order.filter((entry) => entry.kind === "pc").map((entry) => entry.characterId);
const tokenOf = (id) => getTokenByRef(getBattleMapForEncounter(world.encounter().id).id, id);
const opensWithout = (args) => {
  const out = ai("start_encounter", { enemies: GOBLIN, ...args });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.encounter().orderReady, true, "the order did not close on who is there");
  return out.result;
};
const arrive = async (id) => {
  const rolled = await world.invoke("request_roll", { characterId: id, kind: "initiative", reason: "initiative" });
  assert.equal(rolled.ok, true, rolled.error);
};

await test("Names: a whole name or one word of it, the whole name first; a string of several; a comma inside a whole name.", () => {
  const roster = [{ id: "a", name: "Alice Smith" }, { id: "b", name: "Bram" }, { id: "c", name: "Alice" }, { id: "d", name: "Sir Tom" }, { id: "e", name: "Sir Hal" }, { id: "f", name: "Vex, the Brave" }];
  assert.deepEqual(resolveAwayNames(["Smith"], roster), { ids: ["a"] });
  assert.deepEqual(resolveAwayNames(["alice smith"], roster), { ids: ["a"] });
  assert.deepEqual(resolveAwayNames(["Alice"], roster), { ids: ["c"] }, "the whole name wins over a word of another");
  assert.deepEqual(resolveAwayNames(["Bram, Smith"], roster), { ids: ["b", "a"] });
  assert.deepEqual(resolveAwayNames(["Bram; Smith"], roster), { ids: ["b", "a"] });
  assert.deepEqual(resolveAwayNames(["Vex, the Brave"], roster), { ids: ["f"] });
  assert.deepEqual(resolveAwayNames(["b"], roster), { ids: ["b"] }, "a sheet's id names it");
  assert.deepEqual(resolveAwayNames(["Bram", "bram"], roster), { ids: ["b"] });
  assert.match(resolveAwayNames(["Sir"], roster).error, /"Sir" could be Sir Tom or Sir Hal.*whole name/);
  assert.match(resolveAwayNames(["Nobody"], roster).error, /"Nobody".*The party is: Alice Smith, Bram/);
  assert.match(resolveAwayNames(["Bram, Nobody"], roster).error, /"Nobody"/, "one wrong name refuses the list");
  assert.match(resolveAwayNames(["Bra"], roster).error, /"Bra"/, "a part of a word names nobody");
});

await test("With no absent every character is staged, as before: the order, the board, nobody away.", async () => {
  await kit.endFight();
  const result = opensWithout({});
  assert.deepEqual(orderIds().sort(), [alice.id, bram.id, cora.id].sort());
  for (const hero of [alice, bram, cora]) {
    assert.ok(tokenOf(hero.id), `${hero.name} has no token`);
  }
  assert.deepEqual(world.encounter().awayIds, []);
  assert.equal(result.absent, undefined);
  assert.equal(buildEncounterState(world.campaignId, world.sheets()).away, undefined);
});

await test("One absent: the order closes without them, the board has no token for them, and the GM is told.", async () => {
  await kit.endFight();
  const result = opensWithout({ absent: ["Cora Vale"] });
  assert.deepEqual(orderIds().sort(), [alice.id, bram.id].sort());
  assert.equal(tokenOf(cora.id), null);
  assert.deepEqual(world.encounter().awayIds, [cora.id]);
  assert.match(result.absent, /Cora Vale: not at this fight.*request_roll kind=initiative/);
  const state = buildEncounterState(world.campaignId, world.sheets());
  assert.deepEqual(state.away, ["Cora Vale"]);
});

await test("One word of a name, and a single string, count.", async () => {
  await kit.endFight();
  opensWithout({ absent: "Vale" });
  assert.deepEqual(world.encounter().awayIds, [cora.id]);
  await kit.endFight();
  opensWithout({ absent: "Vale, Smith" });
  assert.deepEqual([...world.encounter().awayIds].sort(), [alice.id, cora.id].sort());
  assert.deepEqual(orderIds(), [bram.id]);
  await kit.endFight();
  // A flat call from a weak model keeps it too.
  const flat = ai("start_encounter", { monster: "goblin", absent: ["Vale"] });
  assert.equal(flat.ok, true, flat.error);
  assert.deepEqual(world.encounter().awayIds, [cora.id]);
});

await test("A wrong name, an ambiguous one, everyone absent or a wrong shape refuse, and no fight or board is left behind.", async () => {
  const twin = world.addHero({ name: "Bram Oak", level: 3, maxHp: 30 });
  const other = world.addHero({ name: "Dov Oak", level: 3, maxHp: 30 });
  await kit.endFight();
  const before = getLatestEndedEncounter(world.campaignId)?.id;
  const refusals = [
    [{ absent: ["Nobody"] }, /"Nobody".*The party is:/],
    [{ absent: "Oak" }, /"Oak" could be Bram Oak or Dov Oak/],
    [{ absent: [alice.name, bram.name, cora.name, twin.name, other.name] }, /nobody is at this fight.*behind a door/],
    [{ absent: 5 }, /absent is a list of character names/],
    [{ absent: [1] }, /absent is a list of character names/],
    [{ absent: { name: "Bram" } }, /absent is a list of character names/],
  ];
  for (const [args, pattern] of refusals) {
    const out = ai("start_encounter", { enemies: GOBLIN, ...args });
    assert.equal(out.ok, false, `${JSON.stringify(args)} started a fight`);
    assert.equal(out.retry, true);
    assert.match(out.error, pattern);
    assert.equal(world.encounter(), null, `${JSON.stringify(args)} left a fight`);
    assert.equal(getLatestEndedEncounter(world.campaignId)?.id, before);
  }
  // The dead are nobody to fight: naming the living is everyone absent.
  world.patch(twin.id, { deathSaves: { successes: 0, failures: 3, dead: true } });
  world.patch(other.id, { deathSaves: { successes: 0, failures: 3, dead: true } });
  const out = ai("start_encounter", { enemies: GOBLIN, absent: [alice.name, bram.name, cora.name] });
  assert.match(out.error ?? "", /nobody is at this fight/);
  assert.equal(world.encounter(), null);
  deleteSheetById(world.campaignId, twin.userId, twin.id);
  deleteSheetById(world.campaignId, other.userId, other.id);
});

await test("Arriving after the order closed: a place by their roll, the turn stays where it was, and a token on a walkable, free square.", async () => {
  await kit.endFight();
  opensWithout({ absent: [cora.name] });
  const acting = world.encounter().order[world.encounter().turnIndex];
  const map = getBattleMapForEncounter(world.encounter().id);
  const others = listTokens(map.id).map((token) => `${token.x},${token.y}`);
  await arrive(cora.id);
  const encounter = world.encounter();
  assert.ok(orderIds().includes(cora.id));
  assert.equal(encounter.order[encounter.turnIndex].name, acting.name, "the arrival moved the turn");
  assert.deepEqual(encounter.awayIds, [], "still listed as away");
  const token = tokenOf(cora.id);
  assert.ok(token, "the arrival has no token");
  assert.equal(token.kind, "pc");
  assert.ok(!others.includes(`${token.x},${token.y}`), "the arrival stands on someone");
  assert.equal(blocksMove(tileAt(map.terrain, map.width, token.x, token.y)), false, "the arrival stands in a wall");
  assert.equal(buildEncounterState(world.campaignId, world.sheets()).away, undefined);
});

await test("Arriving while the order is still collected: the order then waits on them too, and they have a token.", async () => {
  await kit.endFight();
  // A person's fight opens with its rolls still to ask for.
  const started = ai("start_encounter", { enemies: GOBLIN, absent: cora.name }, "human_dm");
  assert.equal(started.ok, true, started.error);
  assert.equal(world.encounter().orderReady, false);
  assert.deepEqual(world.encounter().awayIds, [cora.id]);
  await arrive(cora.id);
  assert.deepEqual(world.encounter().awayIds, []);
  assert.ok(tokenOf(cora.id));
  assert.equal(world.encounter().orderReady, false);
  await arrive(alice.id);
  assert.equal(world.encounter().orderReady, false);
  await arrive(bram.id);
  assert.equal(world.encounter().orderReady, true);
  assert.equal(orderIds().length, 3);
});

await test("A person's fight: neither the console's ask, the state's list nor the deadlock guard rolls for one who is away.", async () => {
  await kit.endFight();
  const asked = await world.invoke("start_encounter", { enemies: "goblin", absent: cora.name });
  assert.equal(asked.ok, true, asked.error);
  assert.deepEqual(world.encounter().awayIds, [cora.id], "the console's string did not name them");
  assert.equal(orderIds().includes(cora.id), false, "the console asked for their roll");
  assert.equal(tokenOf(cora.id), null);

  await kit.endFight();
  const started = ai("start_encounter", { enemies: GOBLIN, absent: cora.name }, "human_dm");
  assert.equal(started.ok, true, started.error);
  assert.equal(String(started.result.next).includes(cora.id), false, "the result asked for their roll");
  const state = buildEncounterState(world.campaignId, world.sheets());
  assert.equal(state.awaitingInitiative.includes("Cora Vale"), false);
  ensureInitiativeProgress(world.campaign());
  assert.equal(world.encounter().orderReady, true);
  assert.deepEqual(world.encounter().awayIds, [cora.id], "the guard brought them in");
  assert.equal(orderIds().includes(cora.id), false);
  assert.equal(tokenOf(cora.id), null);
});

await test("The budget: a fight is measured against who is there, at the start and for reinforcements, and those who arrive count again.", async () => {
  await kit.endFight();
  const ROSTER = [{ monster: "goblin", count: 8 }];
  const alone = ai("start_encounter", { enemies: ROSTER, absent: [alice.name, cora.name] });
  assert.equal(alone.ok, false, "one character was measured as three");
  assert.match(alone.error, /Too deadly/);
  assert.equal(world.encounter(), null);
  const whole = ai("start_encounter", { enemies: ROSTER });
  assert.equal(whole.ok, true, whole.error);
  await kit.endFight();
  const all = ai("start_encounter", { enemies: [{ monster: "goblin", count: 2 }], absent: [alice.name, cora.name] });
  assert.equal(all.ok, true, all.error);
  const more = ai("add_enemies", { enemies: [{ monster: "goblin", count: 6 }] });
  assert.equal(more.ok, false, "reinforcements were measured against someone who is not there");
  assert.match(more.error, /Too deadly/);
  await arrive(alice.id);
  await arrive(cora.id);
  const now = ai("add_enemies", { enemies: [{ monster: "goblin", count: 6 }] });
  assert.equal(now.ok, true, now.error);
});

await test("An enemy attacks who is there: the server's pick never finds one who is away, and a named attack is refused with nothing rolled.", async () => {
  await kit.endFight();
  opensWithout({ absent: [cora.name] });
  const encounter = world.encounter();
  assert.equal(standingOn(world.campaignId, encounter, "party").some((foe) => foe.id === cora.id), false);
  const [enemy] = world.enemies();
  // Its own turn, or whose turn it is answers first.
  encounter.turnIndex = encounter.order.findIndex((entry) => entry.kind === "enemy");
  saveEncounter(encounter);
  const hp = world.sheet(cora.id).currentHp;
  const out = ai("enemy_attack", { enemyId: enemy.id, targetCharacterId: cora.id }, "human_dm");
  assert.equal(out.ok, false);
  assert.equal(out.retry, true);
  assert.match(out.error, /Cora Vale is not at this fight/);
  assert.equal(world.sheet(cora.id).currentHp, hp);
});

await test("A paladin who is away shields nobody, and shields those beside them once they arrive.", async () => {
  await kit.endFight();
  const paladin = world.addHero({ name: "Pell", class: "paladin", level: 6, maxHp: 40, abilities: { cha: 18 } });
  const out = ai("start_encounter", { enemies: GOBLIN, absent: ["Pell"] });
  assert.equal(out.ok, true, out.error);
  assert.equal(allySaveAura(world.campaignId, world.sheet(bram.id)), null, "an aura reached from off the board");
  await arrive(paladin.id);
  kit.place(bram.id, 5, 5);
  kit.place(paladin.id, 5, 6);
  assert.ok(allySaveAura(world.campaignId, world.sheet(bram.id))?.bonus > 0, "the arrival's aura does not reach beside them");
  await kit.endFight();
  deleteSheetById(world.campaignId, paladin.userId, paladin.id);
});

await test("After the fight: one who never came earns no XP and has no line on the card, and is not read as a fighter who left. One who arrived has both.", async () => {
  await kit.endFight();
  opensWithout({ absent: [cora.name] });
  const fightId = world.encounter().id;
  const xpBefore = world.sheet(cora.id).xp ?? 0;
  // A roll of theirs during the fight, off wherever they are.
  const rolled = await world.invoke("request_roll", { characterId: cora.id, kind: "skill_check", skill: "perception", reason: "scouting", dc: 10 });
  assert.equal(rolled.ok, true, rolled.error);
  const aliceBefore = world.sheet(alice.id).xp ?? 0;
  const [enemy] = listEnemies(fightId);
  kit.setEnemy(enemy.id, { xp: 100 });
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(world.sheet(cora.id).xp ?? 0, xpBefore, "XP went to someone who never came");
  assert.ok((world.sheet(alice.id).xp ?? 0) > aliceBefore, "those who fought earned nothing");
  const names = getEncounter(fightId).summaryCard.fighters.map((line) => line.name);
  assert.equal(names.includes("Cora Vale"), false, "on the card of a fight they never came to");
  assert.ok(names.includes("Bram"));

  opensWithout({ absent: [cora.name] });
  const second = world.encounter().id;
  await arrive(cora.id);
  const coraBefore = world.sheet(cora.id).xp ?? 0;
  kit.setEnemy(listEnemies(second)[0].id, { xp: 100 });
  await world.invoke("end_encounter", { outcome: "victory" });
  assert.ok((world.sheet(cora.id).xp ?? 0) > coraBefore, "one who arrived earned nothing");
  assert.ok(getEncounter(second).summaryCard.fighters.some((line) => line.name === "Cora Vale"));
});

await test("Nothing outlives the fight: the next one stages them again.", async () => {
  await kit.endFight();
  opensWithout({ absent: [cora.name] });
  await kit.endFight();
  opensWithout({});
  assert.ok(orderIds().includes(cora.id));
  assert.ok(tokenOf(cora.id));
});

await test("The party outside the fight's own questions does not change: fieldedSheets still lists one who is away, so an arrival, a bond and a test table's script still find them.", async () => {
  await kit.endFight();
  opensWithout({ absent: [cora.name] });
  assert.ok(fieldedSheets(world.campaign()).some((sheet) => sheet.id === cora.id));
  assert.equal(atTheFight(world.encounter(), world.sheets()).some((sheet) => sheet.id === cora.id), false);
  const none = world.sheets();
  assert.equal(atTheFight({ awayIds: [] }, none), none, "no list is copied when nobody is away");
});

await test("What the GM reads says who is absent and who is not, with someone behind a door as the case who still rolls.", () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const rule = read("../src/lib/dm/prompt-rules.ts");
  const tool = read("../src/lib/dm/encounter-tool-defs.ts");
  for (const text of [rule, tool]) {
    assert.match(text, /too far away to reach (it|the fight) (within|in) a few rounds, or unaware of it/);
    assert.match(text, /behind a door[^.]*?(is )?NOT absent/);
    assert.doesNotMatch(text, /questioning a prisoner/);
  }
  const field = adjudication("start_encounter").fields.find((entry) => entry.name === "absent");
  assert.ok(field, "the console cannot say it");
  assert.equal(field.host.feature, "fightAbsent");
  assert.match(field.help, /behind a door is still in the fight/);
});

finish();
