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
const world = await openWorld({ campaign: { maxPlayers: 12 }, gameSettings: { ttsEnabled: false } });
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
const { sideOf, standingOn } = await import("../src/lib/dm/combatant.ts");
const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const { blocksMove, tileAt } = await import("../src/lib/battlemap/types.ts");
const { gateAiCall } = await import("../src/lib/dm/ai-gate.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { markSheetAsCompanion } = await import("../src/lib/db/sheets.ts");
const { FULL_CASTER_SLOTS, slotsOf } = await import("./lib/enforce-spells.mjs");
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { EMPTY_TEMPLATE_MAP } = await import("../src/lib/dm/encounter-template-logic.ts");
const { spawnSummons } = await import("../src/lib/dm/summon-store.ts");
const { summonRecord } = await import("../src/lib/dm/summon-rules.ts");
const { findSummonForm } = await import("../src/lib/srd/summon-forms.ts");
const klass = (classId, ...names) => names.map((name) => ({ name, source: "class", classId }));

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

// A fight with Cora away, the turn on Bram, and what is on her sheet right now.
async function coraAway(extra = {}) {
  await kit.endFight();
  opensWithout({ absent: [cora.name], ...extra });
  const encounter = world.encounter();
  encounter.turnIndex = encounter.order.findIndex((entry) => entry.characterId === bram.id);
  saveEncounter(encounter);
  return world.enemies()[0];
}
const rollCount = () => listRecentRolls(world.campaignId, 500).length;
const sheetOf = (id) => JSON.stringify(world.sheet(id));

await test("Reach does not cross the edge of the fight: each call naming someone away, from the fight or to it, is refused at both doors with nothing rolled or spent.", async () => {
  const enemy = await coraAway();
  const cases = [
    ["aoe_damage by id", "aoe_damage", { characterIds: [cora.id], damage: "2d6", saveAbility: "dex", dc: 12 }],
    ["aoe_damage by name", "aoe_damage", { targets: cora.name, damage: "2d6", saveAbility: "dex", dc: 12 }],
    ["aoe_damage beside someone present", "aoe_damage", { characterIds: [bram.id, cora.id], damage: "2d6", saveAbility: "dex", dc: 12 }],
    ["aoe_damage by an enemy", "aoe_damage", { casterEnemyId: enemy.id, enemyAbility: "Blast", characterIds: [cora.id], damage: "2d6" }],
    ["aoe_damage cast by one away", "aoe_damage", { casterCharacterId: cora.id, enemyIds: [enemy.id], spell: "Fireball", level: 3 }],
    ["legendary_action", "legendary_action", { enemyId: enemy.id, action: "Tail", targetCharacterId: cora.id }],
    ["declare_intent", "declare_intent", { actor: enemy.id, verb: "Scimitar", target: cora.id }],
    ["cast_at_player by an enemy", "cast_at_player", { characterId: cora.id, casterEnemyId: enemy.id, source: "a hex", saveAbility: "wis", dc: 12, condition: "frightened" }],
    ["set_condition from an enemy", "set_condition", { characterId: cora.id, condition: "frightened", sourceEnemyId: enemy.id, reason: "a roar" }],
    ["set_condition from one at the fight", "set_condition", { characterId: cora.id, condition: "charmed", sourceCharacterId: bram.id, reason: "a word" }],
    ["cast_buff on one away", "cast_buff", { characterId: bram.id, spell: "Bless", targetCharacterIds: [cora.id] }],
    ["heal by a caster at the fight", "heal", { characterId: cora.id, casterId: bram.id, spell: "Cure Wounds", reason: "a touch" }],
    ["heal among several", "heal", { casterId: bram.id, spell: "Mass Cure Wounds", targets: [{ characterId: alice.id, amount: 3 }, { characterId: cora.id, amount: 3 }], reason: "a wave" }],
    ["stabilize by a healer at the fight", "stabilize", { characterId: cora.id, healerId: bram.id, reason: "a kit" }],
    ["use_item fed to one away", "use_item", { characterId: bram.id, item: "Potion of Healing", targetCharacterId: cora.id }],
    ["use_resource on one away", "use_resource", { characterId: bram.id, resource: "Lay on Hands", targetCharacterId: cora.id }],
    ["take_action help for one away", "take_action", { characterId: bram.id, action: "help", targetCharacterId: cora.id }],
    ["use_reaction for one away", "use_reaction", { characterId: bram.id, feature: "Protection", targetCharacterId: cora.id }],
    ["handle_item handed to one away", "handle_item", { characterId: bram.id, action: "hand", item: "Rope", toCharacterId: cora.id }],
    ["pc_attack by one away", "pc_attack", { characterId: cora.id, enemyId: enemy.id, targetEnemyId: enemy.id }],
    ["cast_at_enemy by one away", "cast_at_enemy", { characterId: cora.id, spell: "Fire Bolt", targetEnemyId: enemy.id }],
    ["pet_attack by one away", "pet_attack", { characterId: cora.id, targetEnemyId: enemy.id }],
    ["cast_buff by one away on an enemy", "cast_buff", { characterId: cora.id, spell: "Hunter's Mark", targetEnemyId: enemy.id }],
    ["cast_buff by one away on one at the fight", "cast_buff", { characterId: cora.id, spell: "Bless", targetCharacterIds: [bram.id] }],
    ["use_resource by one away on an enemy", "use_resource", { characterId: cora.id, resource: "Favored Foe", targetEnemyId: enemy.id }],
    ["take_action by one away on an enemy", "take_action", { characterId: cora.id, action: "shove", targetEnemyId: enemy.id }],
    ["use_reaction by one away on an enemy", "use_reaction", { characterId: cora.id, feature: "Hellish Rebuke", targetEnemyId: enemy.id }],
  ];
  const sheetsById = new Map(world.sheets().map((sheet) => [sheet.id, sheet]));
  for (const [what, name, args] of cases) {
    const before = [rollCount(), sheetOf(cora.id), sheetOf(bram.id), JSON.stringify(world.enemies()[0])];
    const out = await world.invoke(name, args);
    assert.equal(out.ok, false, what + " went through");
    assert.match(out.error, /Cora Vale (is|are) not at this fight/, what + ": " + out.error);
    assert.equal(out.retry, true, what);
    assert.deepEqual([rollCount(), sheetOf(cora.id), sheetOf(bram.id), JSON.stringify(world.enemies()[0])], before, what + " rolled or spent something");
    const turn = createDmTurn(world.campaignId, [], "ai");
    const gated = gateAiCall(name, JSON.stringify(args), { campaign: world.campaign(), turn, sheetsById });
    assert.match(gated.result?.error ?? "", /Cora Vale (is|are) not at this fight/, what + " passed the AI's door");
  }
});

await test("The same calls at someone present are not refused for it, and once they arrive nor is the one away.", async () => {
  const enemy = await coraAway();
  const notRefused = async (what, name, args) => {
    const out = await world.invoke(name, args);
    assert.doesNotMatch(out.error ?? "", /not at this fight/, what);
  };
  await notRefused("a blast at Bram", "aoe_damage", { characterIds: [bram.id], damage: "1", saveAbility: "dex", dc: 1 });
  await notRefused("Bram helped", "take_action", { characterId: alice.id, action: "help", targetCharacterId: bram.id });
  await notRefused("Bram's own attack", "pc_attack", { characterId: bram.id, enemyId: enemy.id, targetEnemyId: enemy.id });
  await arrive(cora.id);
  await notRefused("a blast at Cora once here", "aoe_damage", { characterIds: [cora.id], damage: "1", saveAbility: "dex", dc: 1 });
  await notRefused("a mark by Cora once here", "cast_buff", { characterId: cora.id, spell: "Hunter's Mark", targetEnemyId: enemy.id });
});

await test("Kept open on purpose: what the story does where they are, with nobody at the fight behind it, and what one away does for themselves or for another away.", async () => {
  await coraAway({ absent: [cora.name, alice.name] });
  const open = [
    ["a condition with no source", "set_condition", { characterId: cora.id, condition: "poisoned", rounds: 2, reason: "a bad well" }],
    ["a story effect", "set_effect", { characterId: cora.id, name: "Shrine's Blessing", modifiers: [{ target: "ac", value: 1 }], source: "a roadside shrine" }],
    ["a trap by apply_hazard", "apply_hazard", { type: "generic", characterIds: [cora.id], damage: "1d4", dc: 1, reason: "a snare" }],
    ["a hazard's save with no enemy", "cast_at_player", { characterId: cora.id, source: "a trap's needle", saveAbility: "con", dc: 1, damage: "1" }],
    ["an affliction", "afflict", { characterId: cora.id, kind: "madness", duration: "short", save: false, reason: "what they saw" }],
    ["a potion or rest's healing", "heal", { characterId: cora.id, dice: "1d4", reason: "a potion on the road" }],
    ["tended where they lie", "stabilize", { characterId: cora.id, reason: "a passing healer" }],
    ["two who are away together", "cast_buff", { characterId: alice.id, spell: "Bless", targetCharacterIds: [cora.id] }],
    ["a check where they are", "request_roll", { characterId: cora.id, kind: "skill_check", skill: "perception", reason: "the road", dc: 5 }],
    ["a rockfall by apply_damage", "apply_damage", { characterId: cora.id, dice: "1d4", type: "bludgeoning", reason: "a rockfall on the scout's road" }],
  ];
  for (const [what, name, args] of open) {
    const out = await world.invoke(name, args);
    assert.doesNotMatch(out.error ?? "", /not at this fight/, what);
  }
  const hurt = world.sheet(cora.id);
  await kit.endFight();
  assert.ok(hurt.currentHp < hurt.maxHp, "the rockfall did not land");
  assert.ok(hurt.conditions.some((name) => /poisoned/i.test(name)), "the bad well did not land");
});

await test("lair_action names nobody, so it has no path to someone away.", () => {
  const offered = dmTurnTools(world.campaign(), true, true, false).find((tool) => tool.function.name === "lair_action");
  assert.deepEqual(Object.keys(offered.function.parameters.properties), ["action"]);
});

await test("Preserve Life heals who is in reach: a named target away is refused, and one away is passed over when it spreads.", async () => {
  const life = world.addHero({ name: "Lena", class: "cleric", level: 2, subclass: "Life Domain", maxHp: 30, features: klass("cleric", "Channel Divinity (1/rest)", "Channel Divinity: Preserve Life") });
  await coraAway();
  const encounter = world.encounter();
  encounter.turnIndex = encounter.order.findIndex((entry) => entry.characterId === life.id);
  saveEncounter(encounter);
  world.patch(cora.id, { currentHp: 5 });
  world.patch(bram.id, { currentHp: 5 });
  kit.place(life.id, 5, 5);
  kit.place(bram.id, 5, 6);
  const named = await world.invoke("use_resource", { characterId: life.id, resource: "Channel Divinity", variant: "preserve life", targetCharacterId: cora.id });
  assert.match(named.error ?? "", /Cora Vale is not at this fight/);
  assert.equal(world.sheet(life.id).resources?.channel_divinity?.used ?? 0, 0, "the use was spent");
  const spread = await world.invoke("use_resource", { characterId: life.id, resource: "Channel Divinity", variant: "preserve life" });
  assert.equal(spread.ok, true, spread.error);
  assert.equal(world.sheet(cora.id).currentHp, 5, "it reached one who is away");
  assert.ok(world.sheet(bram.id).currentHp > 5, "it did not reach who is beside them");
  await kit.endFight();
  deleteSheetById(world.campaignId, life.userId, life.id);
});

await test("A creature a spell made goes with its maker: no slot and no token while they are away, and it arrives with them on their count.", async () => {
  await kit.endFight();
  const moss = world.addHero({ name: "Moss", class: "druid", level: 5, maxHp: 30, abilities: { wis: 16, con: 14 }, spellcasting: { ability: "wis", slots: slotsOf(FULL_CASTER_SLOTS[4]), known: [], prepared: ["Conjure Animals"], cantrips: [] } });
  const cast = await world.invoke("cast_buff", { characterId: moss.id, spell: "Conjure Animals", variant: "wolf", count: 2 });
  assert.equal(cast.ok, true, cast.error);
  const wolves = () => world.sheets().filter((sheet) => sheet.summon?.casterId === moss.id);
  assert.equal(wolves().length, 2);
  opensWithout({ absent: ["Moss"] });
  const ids = wolves().map((sheet) => sheet.id);
  assert.deepEqual([...world.encounter().awayIds].sort(), [moss.id, ...ids].sort());
  for (const id of [moss.id, ...ids]) {
    assert.equal(orderIds().includes(id), false);
    assert.equal(tokenOf(id), null);
  }
  await arrive(moss.id);
  assert.deepEqual(world.encounter().awayIds, []);
  const slot = (id) => world.encounter().order.find((entry) => entry.characterId === id);
  for (const id of ids) {
    assert.ok(slot(id), "a wolf did not come");
    assert.equal(slot(id).initiative, slot(moss.id).initiative);
    assert.ok(tokenOf(id), "a wolf has no token");
  }
  await kit.endFight();
  for (const sheet of [...wolves(), moss]) {
    deleteSheetById(world.campaignId, sheet.userId, sheet.id);
  }
});

await test("A party companion has a sheet of its own and stays in the fight unless named, even when the player who commands it has a character away. A pet stays on its owner's sheet and cannot be sent from afar.", async () => {
  await kit.endFight();
  const pal = world.addHero({ name: "Tam Hollis", level: 3, maxHp: 30 });
  markSheetAsCompanion(pal.id, "party", "Steady.");
  world.patch(pal.id, { commandedBy: cora.userId });
  world.patch(cora.id, { pets: [{ name: "Rex", kind: "other", form: "wolf", hp: 11, maxHp: 11, ac: 13, speed: 40, attacks: [], notes: "" }] });
  opensWithout({ absent: [cora.name] });
  assert.ok(orderIds().includes(pal.id), "the companion left with the one who commands it");
  assert.ok(tokenOf(pal.id));
  const [enemy] = world.enemies();
  const bite = await world.invoke("pet_attack", { characterId: cora.id, targetEnemyId: enemy.id });
  assert.match(bite.error ?? "", /Cora Vale is not at this fight/);
  await kit.endFight();
  opensWithout({ absent: [pal.name] });
  assert.equal(orderIds().includes(pal.id), false, "named, the companion stays away");
  await kit.endFight();
  world.patch(cora.id, { pets: [] });
  deleteSheetById(world.campaignId, pal.userId, pal.id);
});

await test("Reverting the turn that brought someone in sends them away again: off the order, off the board, and back on the list, so their next roll brings a token again.", async () => {
  await kit.endFight();
  opensWithout({ absent: [cora.name] });
  const rolled = await world.invoke("request_roll", { characterId: cora.id, kind: "initiative", reason: "initiative" });
  assert.equal(rolled.ok, true, rolled.error);
  assert.ok(tokenOf(cora.id));
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  const revert = (confirm) =>
    handler.POST(new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId: rolled.turnId, ...(confirm ? { confirm: true } : {}) }) }), {
      params: Promise.resolve({ campaignId: world.campaignId }),
    });
  let response = await revert(false);
  if (response.status === 409) {
    response = await revert(true);
  }
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json().catch(() => ({}))));
  assert.equal(orderIds().includes(cora.id), false, "still in the order");
  assert.equal(tokenOf(cora.id), null, "still on the board");
  assert.deepEqual(world.encounter().awayIds, [cora.id], "neither away nor at the fight");
  assert.deepEqual(buildEncounterState(world.campaignId, world.sheets()).away, ["Cora Vale"], "the GM is no longer told they can be brought in");
  await arrive(cora.id);
  assert.ok(tokenOf(cora.id), "the second arrival has no token");
});

await test("A creature one who is away calls up during the fight is with them: no slot and no token until they arrive, and then it comes with them.", async () => {
  await kit.endFight();
  const moss = world.addHero({ name: "Moss", class: "druid", level: 5, maxHp: 30, abilities: { wis: 16, con: 14 }, spellcasting: { ability: "wis", slots: slotsOf(FULL_CASTER_SLOTS[4]), known: [], prepared: ["Conjure Animals"], cantrips: [] } });
  opensWithout({ absent: ["Moss"] });
  // Its own turn never comes while it is away, so nothing a tool casts reaches
  // here today; the store is what any later path that calls one up goes
  // through.
  const form = findSummonForm("wolf");
  const record = summonRecord(form, { spell: "Conjure Animals", casterId: moss.id, casterName: "Moss", concentration: true, castId: "away1" });
  spawnSummons(world.campaign(), world.sheet(moss.id), { form, count: 2, record, rounds: 600, slotLevel: 3, initiative: "group" });
  const ids = world.sheets().filter((sheet) => sheet.summon?.casterId === moss.id).map((sheet) => sheet.id);
  assert.equal(ids.length, 2);
  for (const id of ids) {
    assert.equal(orderIds().includes(id), false, "a wolf took a slot at a fight its maker is not at");
    assert.equal(tokenOf(id), null, "a wolf stands on the board of a fight its maker is not at");
    assert.ok(world.encounter().awayIds.includes(id), "a wolf is not with its maker");
  }
  await arrive(moss.id);
  for (const id of ids) {
    assert.ok(orderIds().includes(id), "a wolf did not come with its maker");
    assert.ok(tokenOf(id), "a wolf came with no token");
  }
  await kit.endFight();
  for (const sheet of world.sheets().filter((entry) => entry.summon?.casterId === moss.id || entry.id === moss.id)) {
    deleteSheetById(world.campaignId, sheet.userId, sheet.id);
  }
});

await test("One who is away and turns on the party does so where they are: no slot, no token, still away until their roll brings them in on that side.", async () => {
  await coraAway();
  const moved = moveToSide(world.campaign(), cora.id, "foe", { quiet: true });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(orderIds().includes(cora.id), false, "a change of side rolled them into the order");
  assert.equal(tokenOf(cora.id), null, "a change of side put them on the board");
  assert.deepEqual(world.encounter().awayIds, [cora.id]);
  await arrive(cora.id);
  assert.ok(orderIds().includes(cora.id));
  assert.equal(sideOf(world.encounter(), "sheet", cora.id), "foe", "they did not arrive on the side they turned to");
  await kit.endFight();
});

await test("A prepared fight takes absent too, and is fitted to who is there: one too big for them alone runs cut down rather than refused.", async () => {
  await kit.endFight();
  insertEncounterTemplate({ campaignId: world.campaignId, name: "Goblin pack", enemies: [{ monster: "goblin", count: 8 }], battlefield: "", map: EMPTY_TEMPLATE_MAP, notes: "", createdByUserId: world.owner.id });
  const ran = ai("run_prepared_encounter", { name: "Goblin pack", absent: [alice.name, cora.name] });
  assert.equal(ran.ok, true, ran.error);
  assert.deepEqual([...world.encounter().awayIds].sort(), [alice.id, cora.id].sort(), "the prepared fight staged those who are away");
  assert.deepEqual(orderIds(), [bram.id]);
  assert.match(String(ran.result.scaled ?? ""), /runs without/, "fitted to the whole party, not to who is there");
  await kit.endFight();
  const wrong = ai("run_prepared_encounter", { name: "Goblin pack", absent: ["Nobody"] });
  assert.match(wrong.error ?? "", /"Nobody"/);
  assert.equal(world.encounter(), null);
});

await test("What the GM reads says who is absent and who is not, with someone behind a door as the case who still rolls.", () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const rule = read("../src/lib/dm/prompt-rules.ts");
  const tool = read("../src/lib/dm/encounter-tool-defs.ts");
  for (const text of [rule, tool]) {
    assert.match(text, /[Tt]oo far (away )?to reach (it|the fight) (within|in) a few rounds, or unaware of it/);
    assert.match(text, /behind a door[^.]*?(is )?NOT absent/);
    assert.doesNotMatch(text, /questioning a prisoner/);
  }
  const field = adjudication("start_encounter").fields.find((entry) => entry.name === "absent");
  assert.ok(field, "the console cannot say it");
  assert.equal(field.host.feature, "fightAbsent");
  assert.match(field.help, /behind a door is still in the fight/);
});

finish();
