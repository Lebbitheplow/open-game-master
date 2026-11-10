// The rest of a turn's actions and who may act off their own turn
// (src/lib/dm/action-tools.ts take_action, src/lib/dm/object-actions.ts,
// src/lib/dm/improvise.ts, src/lib/dm/grapple.ts, the use_item handler in
// src/lib/dm/mutations.ts,
// src/lib/dm/pet-tools.ts pet_attack, the off-turn block of
// src/lib/dm/pc-attack-plan.ts).
//
// SRD 5.1:
//   - Use an Object: drinking a potion or feeding one to another creature
//     is an action; the unconscious cannot act. A wand, a weapon or armor is
//     not used up.
//   - Ready: the action is spent on the turn, and the readied response
//     uses the reaction when its trigger comes. Off their own turn a
//     character attacks only as an opportunity attack or a readied action.
//   - Search: an action, a Perception or Investigation check.
//   - Actions in Combat: an action the character improvises is their
//     action, the GM choosing the roll it needs; against a creature, a
//     contest of checks appropriate to each side's effort (Contests).
//   - Help: an ally's attack against a creature within 5 feet of the helper.
//   - Hide and the grapple contest are ability checks like any other.
//   - A grappled creature escapes with its action; a grapple ends when the
//     grappler is incapacitated or the two are moved apart.
//   - A Beast Master's companion attacks on the ranger's action, a drake on
//     the bonus action, a Pact of the Chain familiar in place of one of the
//     warlock's attacks.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-turn-actions");
const world = await openWorld();
const kit = await combatKit(world);

const fighter = world.addHero({
  class: "fighter", level: 1, maxHp: 30, abilities: { str: 16 },
  proficiencies: { ...TRAINED, skills: ["athletics"] },
  equipment: [
    { name: "Longsword", qty: 1 },
    { name: "Potion of Healing", qty: 3 },
    { name: "Wand of Magic Missiles", qty: 1 },
    { name: "Bag of Holding", qty: 1 },
  ],
});
const ally = world.addHero({
  class: "rogue", level: 11, maxHp: 30, abilities: { dex: 16 },
  proficiencies: { ...TRAINED, skills: ["stealth", "perception"] },
  equipment: [{ name: "Shortsword", qty: 1 }],
});
const ranger = world.addHero({
  class: "ranger", subclass: "Beast Master", level: 3, maxHp: 30, abilities: { dex: 16, wis: 14 },
  proficiencies: TRAINED, equipment: [{ name: "Longbow", qty: 1 }],
});
const heroes = [fighter, ally, ranger];

// The fighter's pack as each test starts it. Written straight to the sheet:
// a wand and a Bag of Holding are not what a new character is built with.
const PACK = [
  { name: "Longsword", qty: 1 },
  { name: "Potion of Healing", qty: 3 },
  { name: "Wand of Magic Missiles", qty: 1 },
  { name: "Bag of Holding", qty: 1 },
];

async function stage(hero) {
  await kit.endFight();
  for (const entry of heroes) {
    world.patch(entry.id, { currentHp: 30, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  world.patch(fighter.id, { equipment: PACK });
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 3]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemy;
}

const act = (hero, action, args = {}) =>
  world.invoke("take_action", { characterId: hero.id, action, ...args });
const use = (hero, item, args = {}) => world.invoke("use_item", { characterId: hero.id, item, ...args });
const qty = (hero, name) => world.sheet(hero.id).equipment.find((item) => item.name === name)?.qty ?? 0;
const budget = () => world.encounter().turnBudget;

// ---- Use an Object ----

await test("Drinking a potion in a fight is the action: a second potion, or an attack after it, is refused.", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { currentHp: 10 });
  world.dice(1, 1);
  const first = await use(fighter, "Potion of Healing");
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(budget().actionUsed, true);
  const second = await use(fighter, "Potion of Healing");
  assert.equal(second.ok, false);
  assert.equal(qty(fighter, "Potion of Healing"), 2);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, false);
});

await test("Off their own turn a character cannot drink a potion.", async () => {
  await stage(ally);
  world.patch(fighter.id, { currentHp: 10 });
  const out = await use(fighter, "Potion of Healing");
  assert.equal(out.ok, false);
  assert.equal(qty(fighter, "Potion of Healing"), 3);
  assert.equal(world.sheet(fighter.id).currentHp, 10);
});

await test("A character at 0 hit points cannot drink their own potion.", async () => {
  await kit.endFight();
  world.patch(fighter.id, { equipment: PACK, currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const out = await use(fighter, "Potion of Healing");
  assert.equal(out.ok, false);
  assert.equal(qty(fighter, "Potion of Healing"), 3);
  assert.equal(world.sheet(fighter.id).currentHp, 0);
  world.patch(fighter.id, { currentHp: 30, conditions: [], deathSaves: null });
});

await test("use_item uses up consumables only: a wand, a Bag of Holding and a weapon stay in the pack.", async () => {
  await kit.endFight();
  world.patch(fighter.id, { equipment: PACK, currentHp: 30, conditions: [], deathSaves: null });
  for (const item of ["Bag of Holding", "Longsword"]) {
    const out = await use(fighter, item);
    assert.equal(out.ok, false, item);
    assert.equal(qty(fighter, item), 1, item);
  }
  // A wand spends a charge and stays (src/lib/dm/item-use.ts).
  await use(fighter, "Wand of Magic Missiles");
  assert.equal(qty(fighter, "Wand of Magic Missiles"), 1);
});

await test("Feeding a potion to another creature needs them within reach.", async () => {
  await stage(fighter);
  kit.place(ally.id, 15, 15);
  world.patch(ally.id, { currentHp: 5 });
  const out = await use(fighter, "Potion of Healing", { targetCharacterId: ally.id });
  assert.equal(out.ok, false, "fed from across the board");
  assert.equal(world.sheet(ally.id).currentHp, 5);
  kit.place(ally.id, 6, 5);
  world.dice(1, 1);
  const fed = await use(fighter, "Potion of Healing", { targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(fed.ok, true, fed.error);
  assert.equal(world.sheet(ally.id).currentHp, 9);
});

await test("Use an Object is an action take_action spends.", async () => {
  await stage(fighter);
  const out = await act(fighter, "use_object", { reason: "pulls the lever" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
});

// ---- An improvised action ----
//
// One call decides it and lands it (src/lib/dm/improvise.ts). The dummy has
// no ability scores, so its checks are +0; the fighter's Athletics is +5.

const conditionsOf = (enemyId) => kit.enemy(enemyId).conditions;

await test("An improvised action is the turn's action: a win in the contest lays its condition and the damage the server rolls, and an attack after it is refused.", async () => {
  const enemy = await stage(fighter);
  const hp = kit.enemy(enemy.id).currentHp;
  // The goblin's Athletics 2, the fighter's 15 + 5, the d10 a 7.
  world.dice(2, 15, 7);
  const out = await act(fighter, "improvise", {
    reason: "cuts the guy ropes so the tent falls on the goblin", targetEnemyId: enemy.id, skill: "athletics", condition: "prone", damage: "1d10", damageType: "bludgeoning",
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.equal(budget().actionUsed, true);
  assert.ok(conditionsOf(enemy.id).includes("prone"));
  assert.equal(kit.enemy(enemy.id).currentHp, hp - 7);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, false, "an attack followed the improvised action");
});

await test("A lost contest lays nothing, and the action is still spent.", async () => {
  const enemy = await stage(fighter);
  const hp = kit.enemy(enemy.id).currentHp;
  world.dice(19, 2);
  const out = await act(fighter, "improvise", { reason: "topples the shelf onto the goblin", targetEnemyId: enemy.id, skill: "athletics", condition: "prone", damage: "1d10", damageType: "bludgeoning" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, false);
  assert.equal(budget().actionUsed, true);
  assert.ok(!conditionsOf(enemy.id).includes("prone"));
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
});

await test("A tie leaves things as they were: the creature holds.", async () => {
  const enemy = await stage(fighter);
  // 15 + 0 against 10 + 5.
  world.dice(15, 10);
  const out = await act(fighter, "improvise", { reason: "yanks the rug from under the goblin", targetEnemyId: enemy.id, skill: "athletics", condition: "prone" });
  world.clearDice();
  assert.equal(out.result.success, false, out.result.contest);
  assert.ok(!conditionsOf(enemy.id).includes("prone"));
});

await test("Each side rolls the check its effort calls for: a bluff meets Insight, and contestSkill names another.", async () => {
  const enemy = await stage(ally);
  world.dice(2, 15);
  const bluff = await act(ally, "improvise", { reason: "feints left and sends the goblin stumbling into the brazier", targetEnemyId: enemy.id, skill: "deception", condition: "prone" });
  world.clearDice();
  assert.equal(bluff.ok, true, bluff.error);
  assert.match(bluff.result.contest, /Deception \d+ vs .*Insight \d+/);
  await stage(ally);
  const [goblin] = world.enemies();
  world.dice(2, 15);
  const tumble = await act(ally, "improvise", { reason: "trips the goblin with a rope", targetEnemyId: goblin.id, skill: "sleight_of_hand", contestSkill: "acrobatics", condition: "prone" });
  world.clearDice();
  assert.match(tumble.result.contest, /Sleight of Hand \d+ vs .*Acrobatics \d+/);
});

await test("contestSkill may name a bare ability: the creature rolls that ability with its own modifier.", async () => {
  const enemy = await stage(ally);
  const stats = kit.enemy(enemy.id).stats;
  kit.setEnemy(enemy.id, { stats: { ...stats, abilities: { ...stats.abilities, str: 8, dex: 20 } } });
  world.dice(10, 10);
  const slip = await act(ally, "improvise", { reason: "pulls the rug from under the goblin", targetEnemyId: enemy.id, skill: "sleight_of_hand", contestSkill: "dex", condition: "prone" });
  world.clearDice();
  assert.equal(slip.ok, true, slip.error);
  assert.match(slip.result.contest, /vs .*DEX 15$/);
});

await test("The GM says whether an action is possible before any roll: a DC past the best the character's check can total is refused, nothing spent and nothing rolled.", async () => {
  const enemy = await stage(fighter);
  const hp = kit.enemy(enemy.id).currentHp;
  const before = kit.lastRolls(1)[0]?.id;
  // Athletics +5 totals 25 at best: DC 30 leaves the dice nothing to decide.
  const boulder = await act(fighter, "improvise", { reason: "lifts the house-sized boulder and hurls it at the goblin", targetEnemyId: enemy.id, skill: "athletics", difficulty: "nearly_impossible", damage: "24d10", damageType: "bludgeoning" });
  assert.equal(boulder.ok, false);
  assert.match(boulder.error, /Impossible for .*25 at best.*DC 30.*Nothing was spent.*without numbers/);
  assert.equal(budget()?.actionUsed ?? false, false);
  assert.equal(kit.lastRolls(1)[0]?.id, before, "a die was rolled for the impossible");
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
  // Within reach of a natural 20, the attempt is rolled.
  const { checkCeiling } = await import("../src/lib/dm/contest-roll.ts");
  assert.equal(checkCeiling(world.campaign(), world.sheet(fighter.id), { skill: "athletics" }), 25);
});

await test("The attempt's difficulty holds against a creature too: one check must meet the DC and beat the creature's.", async () => {
  const enemy = await stage(fighter);
  // 15 + 5 beats the goblin's 1 but misses DC 25.
  world.dice(1, 15);
  const hurl = await act(fighter, "improvise", { reason: "heaves the cart onto the goblin", targetEnemyId: enemy.id, skill: "athletics", difficulty: "very_hard", condition: "prone" });
  world.clearDice();
  assert.equal(hurl.result.success, false, hurl.result.contest);
  assert.match(hurl.result.contest, /Athletics 20 vs DC 25 and Goblin's/);
  assert.ok(!conditionsOf(enemy.id).includes("prone"));
  await stage(fighter);
  const [goblin] = world.enemies();
  // 10 + 5 meets DC 15 and beats the goblin's 2.
  world.dice(2, 10);
  const tent = await act(fighter, "improvise", { reason: "cuts the guy ropes so the tent falls on the goblin", targetEnemyId: goblin.id, skill: "athletics", difficulty: "moderate", condition: "prone" });
  world.clearDice();
  assert.equal(tent.result.success, true, tent.result.contest);
  assert.ok(conditionsOf(goblin.id).includes("prone"));
});

await test("A helpless creature makes no effort, but the attempt's difficulty still holds.", async () => {
  const enemy = await stage(fighter);
  kit.setEnemy(enemy.id, { conditions: ["paralyzed"] });
  world.dice(5);
  const out = await act(fighter, "improvise", { reason: "drags the cart onto the goblin", targetEnemyId: enemy.id, skill: "athletics", difficulty: "hard", condition: "prone" });
  world.clearDice();
  assert.equal(out.result.success, false, out.result.contest);
  assert.match(out.result.contest, /Athletics 10 vs DC 20 and no contest/);
});

await test("A creature that cannot act makes no effort: no contest, and the effect lands.", async () => {
  const enemy = await stage(fighter);
  kit.setEnemy(enemy.id, { conditions: ["paralyzed"] });
  const out = await act(fighter, "improvise", { reason: "throws a net of vines over the goblin", targetEnemyId: enemy.id, skill: "athletics", condition: "restrained" });
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.contest, /no contest/);
  assert.ok(conditionsOf(enemy.id).includes("restrained"));
});

await test("How long each condition lasts: restrained as a net (the GM clears it), blinded to the end of the creature's next turn, frightened of the one who scared it.", async () => {
  const { improvisedHold } = await import("../src/lib/dm/improvise-logic.ts");
  assert.equal(improvisedHold("restrained", "e1", "c1"), undefined);
  assert.equal(improvisedHold("prone", "e1", "c1"), undefined);
  assert.deepEqual(improvisedHold("blinded", "e1", "c1"), { untilTurnEndOf: "e1" });
  assert.deepEqual(improvisedHold("frightened", "e1", "c1"), { untilTurnEndOf: "e1", source: "c1" });
  const enemy = await stage(fighter);
  world.dice(2, 15);
  const out = await act(fighter, "improvise", { reason: "kicks sand in the goblin's eyes", targetEnemyId: enemy.id, skill: "athletics", condition: "blinded" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(kit.enemy(enemy.id).conditionMeta.blinded, { untilTurnEndOf: enemy.id });
  // The tool's schema names the conditions alone: the result says how long.
  assert.match(out.result.applied, /blinded until the end of its next turn/);
});

await test("Restrained as a net holds a creature no larger than Large, as the net does (SRD 5.1, Net): a Huge one is not tangled, and the result never says it stays restrained.", async () => {
  const enemy = await stage(fighter);
  kit.setEnemy(enemy.id, { stats: { ...kit.enemy(enemy.id).stats, size: "Huge" } });
  world.dice(2, 15);
  const out = await act(fighter, "improvise", { reason: "drops the tent canvas over the giant", targetEnemyId: enemy.id, skill: "athletics", condition: "restrained" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(!conditionsOf(enemy.id).includes("restrained"), "a Huge creature was tangled");
  assert.match(out.result.applied, /Large or smaller/);
  assert.doesNotMatch(out.result.applied, /stays restrained|The server applied it/);
});

await test("A creature immune to the condition takes none.", async () => {
  const enemy = await stage(fighter);
  kit.setEnemy(enemy.id, { stats: { ...kit.enemy(enemy.id).stats, conditionImmune: "blinded" } });
  world.dice(2, 15);
  const out = await act(fighter, "improvise", { reason: "kicks sand in its eyes", targetEnemyId: enemy.id, skill: "athletics", condition: "blinded" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(!conditionsOf(enemy.id).includes("blinded"));
  assert.match(out.result.applied, /immune/);
});

await test("An action that reaches no creature is the character's check against a DC.", async () => {
  await stage(fighter);
  world.dice(6);
  const out = await act(fighter, "improvise", { reason: "forces the rusted portcullis lever", skill: "athletics", difficulty: "easy" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true, out.result.check);
  assert.match(out.result.check, /Athletics 11 vs DC 10/);
});

await test("What it needs is asked before anything is spent: a reason, a check, a creature for an effect, a difficulty without one.", async () => {
  const enemy = await stage(fighter);
  const cases = [
    [{}, /reason/],
    [{ reason: "topples the shelf", targetEnemyId: enemy.id, condition: "prone" }, /skill/],
    [{ reason: "topples the shelf", skill: "athletics", condition: "prone" }, /targetEnemyId/],
    [{ reason: "forces the lever", skill: "athletics" }, /difficulty/],
    [{ reason: "drops the beam", targetEnemyId: enemy.id, skill: "athletics", damage: "1d10" }, /damageType/],
  ];
  for (const [args, wanted] of cases) {
    const out = await act(fighter, "improvise", args);
    assert.equal(out.ok, false, JSON.stringify(args));
    assert.match(out.error, wanted);
  }
  assert.equal(budget()?.actionUsed ?? false, false);
});

await test("An improvised action is never a bonus action.", async () => {
  await stage(ally);
  const out = await act(ally, "improvise", { bonus: true, reason: "kicks sand in the goblin's eyes" });
  assert.equal(out.ok, false);
  assert.equal(budget()?.bonusUsed ?? false, false);
});

// The model's improvised action uses only what the story put in the scene,
// within the character's reach: the GM's narration and the fight's opening
// line, never a player's words.
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { unshownWords } = await import("../src/lib/dm/improvise-logic.ts");
const { allocateSeq, latestSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { claimNarrationSeq, narrationShown, takeNarrationSlot } = await import("../src/lib/dm/narration-slot.ts");
const { handleLocationCall } = await import("../src/lib/dm/turn.ts");
const { listEventsSince } = await import("../src/lib/events.ts");
const aiAct = (sheet, args) =>
  invokeEngine(world.campaign(), { kind: "ai", turnId: createDmTurn(world.campaignId, []).id }, { name: "take_action", args: { characterId: sheet.id, action: "improvise", ...args } });
const TENT = { reason: "cuts the guy ropes so the tent falls on the goblin", skill: "athletics", condition: "prone" };

await test("The model's improvised action names what it uses in the narration's words: without them it is refused and spends nothing.", async () => {
  const enemy = await stage(fighter);
  world.say("player", "I drop the chandelier on the goblin.", fighter);
  const out = await aiAct(fighter, { ...TENT, reason: "drops the chandelier on the goblin", targetEnemyId: enemy.id, distanceFt: 5 });
  assert.equal(out.ok, false);
  assert.match(out.error, /scene/);
  assert.equal(budget()?.actionUsed ?? false, false);
});

await test("A thing the narration never showed is not there: a tent on a bare riverbank is refused, a player naming it is not the story, and nothing is spent.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "The goblin stands in the open on the bare riverbank; around you there is nothing but mud and reeds.");
  world.say("player", "I cut the guy ropes so the tent collapses on the goblin.", fighter);
  const out = await aiAct(fighter, { ...TENT, targetEnemyId: enemy.id, scene: "the tent's guy ropes", distanceFt: 5 });
  assert.equal(out.ok, false);
  assert.match(out.error, /"tent's"/);
  assert.match(out.error, /not there/);
  // The model stood "nothing but mud and reeds" in for the refused tent and
  // dealt its damage: the refusal says never to.
  assert.match(out.error, /never stand other words of the scene in for it/);
  assert.match(out.error, /"ropes"/, "the player's words counted as the scene's");
  assert.equal(budget()?.actionUsed ?? false, false);
});

await test("What the narration showed is used, whatever ending the model gives it, and the action is spent.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "The goblin ducks into the half-collapsed tent beside you; its guy ropes are stretched taut right at your feet.");
  world.say("player", "I cut the guy ropes so the tent collapses on the goblin.", fighter);
  const out = await aiAct(fighter, { ...TENT, targetEnemyId: enemy.id, scene: "the guy rope of the tent", distanceFt: 5 });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
});

await test("A field of the model's take_action the server cannot read is named in the refusal, with its fault, and nothing is spent.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "A heavy shelf of jars leans right beside the goblin.");
  world.say("player", "I topple the shelf onto the goblin.", fighter);
  // The DM loop hands take_action straight to its handler (no console form).
  const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
  const sheets = world.sheets();
  const raw = JSON.stringify({ characterId: fighter.id, action: "improvise", reason: "topples the shelf", scene: "the shelf", distanceFt: 5, targetEnemyId: enemy.id, ability: "athletics", condition: "prone" });
  const { result } = applyEncounterCall(world.campaign(), createDmTurn(world.campaignId, []), "take_action", raw, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
  assert.match(String(result.error), /field ability: .*str/);
  const misspelt = applyEncounterCall(world.campaign(), createDmTurn(world.campaignId, []), "take_action", JSON.stringify({ ...JSON.parse(raw), ability: undefined, skill: "athletic" }), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
  assert.match(String(misspelt.result.error), /field skill: .*athletics/);
  assert.equal(budget()?.actionUsed ?? false, false);
});

await test("On the battle map the model says how far the thing is, and one beyond the character's movement left plus 5 feet is out of reach: refused, nothing spent.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "Sixty feet across the camp a tent sags on its guy ropes; the goblin stands right in front of you.");
  world.say("player", "I cut the guy ropes so the tent collapses on the goblin.", fighter);
  const unsaid = await aiAct(fighter, { ...TENT, targetEnemyId: enemy.id, scene: "the tent's guy ropes" });
  assert.equal(unsaid.ok, false);
  assert.match(unsaid.error, /distanceFt/);
  const far = await aiAct(fighter, { ...TENT, targetEnemyId: enemy.id, scene: "the tent's guy ropes", distanceFt: 60 });
  assert.equal(far.ok, false);
  assert.match(far.error, /60 ft .*reach 35 ft/);
  assert.equal(budget()?.actionUsed ?? false, false);
  world.dice(2, 15);
  const near = await aiAct(fighter, { ...TENT, targetEnemyId: enemy.id, scene: "the tent's guy ropes", distanceFt: 35 });
  world.clearDice();
  assert.equal(near.ok, true, near.error);
  assert.equal(kit.token(fighter.id).movedThisRound, 6, "the 30 feet walked to stand next to the ropes are spent");
});

await test("A distance the model sends empty (null or \"\") is no distance: the action still asks for one and spends nothing, never reading it as 0 feet away.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "Sixty feet across the camp a tent sags on its guy ropes; the goblin stands right in front of you.");
  world.say("player", "I cut the guy ropes so the tent collapses on the goblin.", fighter);
  const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
  const sheets = world.sheets();
  for (const distanceFt of [null, ""]) {
    const raw = JSON.stringify({ characterId: fighter.id, action: "improvise", ...TENT, targetEnemyId: enemy.id, scene: "the tent's guy ropes", distanceFt });
    world.dice(2, 15);
    const { result } = applyEncounterCall(world.campaign(), createDmTurn(world.campaignId, []), "take_action", raw, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
    world.clearDice();
    assert.match(String(result.error), /needs distanceFt/, `distanceFt ${JSON.stringify(distanceFt)} read as a distance`);
  }
  assert.equal(budget()?.actionUsed ?? false, false);
});

await test("An ability the model writes by its rules name (\"Strength\", \"DEX\") is the ability, as every other tool reads one.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "A heavy cart stands right beside the goblin.");
  world.say("player", "I heave the cart onto the goblin.", fighter);
  const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
  const sheets = world.sheets();
  const raw = JSON.stringify({ characterId: fighter.id, action: "improvise", reason: "heaves the cart onto the goblin", ability: "Strength", contestSkill: "DEX", targetEnemyId: enemy.id, condition: "prone", scene: "the cart", distanceFt: 5 });
  world.dice(2, 15);
  const { result } = applyEncounterCall(world.campaign(), createDmTurn(world.campaignId, []), "take_action", raw, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
  world.clearDice();
  assert.equal(result.ok, true, result.error);
  assert.match(result.contest, /^Strength \d+ vs .*DEX \d+$/);
  // The schema offers no skill list, so a skill by its name is its id too.
  await stage(fighter);
  const [goblin] = world.enemies();
  world.say("dm", "A heavy cart stands right beside the goblin.");
  world.say("player", "I slip the cart's brake under the goblin's feet.", fighter);
  const named = JSON.stringify({ characterId: fighter.id, action: "improvise", reason: "slips the cart's brake loose", skill: "Sleight of Hand", contestSkill: "Perception", targetEnemyId: goblin.id, condition: "prone", scene: "the cart", distanceFt: 5 });
  world.dice(2, 15);
  const slipped = applyEncounterCall(world.campaign(), createDmTurn(world.campaignId, []), "take_action", named, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
  world.clearDice();
  assert.equal(slipped.result.ok, true, slipped.result.error);
  assert.match(slipped.result.contest, /^Sleight of Hand \d+ vs .*Perception \d+$/);
});

await test("A prone character's walk to the thing used is priced as the board prices it: standing up first when that fits, else crawling at double cost.", async () => {
  const SHELF = { reason: "topples the shelf onto the goblin", skill: "athletics", condition: "prone", scene: "the shelf" };
  let enemy = await stage(fighter);
  world.say("dm", "A shelf of jars stands behind you, the goblin right in front of you.");
  world.say("player", "I topple the shelf onto the goblin.", fighter);
  world.patch(fighter.id, { conditions: ["prone"] });
  // 30 feet: standing costs 15, so 15 feet of walk, plus the 5 feet reached.
  const far = await aiAct(fighter, { ...SHELF, targetEnemyId: enemy.id, distanceFt: 25 });
  assert.equal(far.ok, false);
  assert.match(far.error, /25 ft .*reach 20 ft/);
  world.dice(2, 15);
  const stood = await aiAct(fighter, { ...SHELF, targetEnemyId: enemy.id, distanceFt: 20 });
  world.clearDice();
  assert.equal(stood.ok, true, stood.error);
  assert.equal(kit.token(fighter.id).movedThisRound, 6, "15 feet to stand and 15 walked");
  assert.deepEqual(world.sheet(fighter.id).conditions, [], "the character stood up");

  enemy = await stage(fighter);
  world.say("dm", "A shelf of jars stands behind you, the goblin right in front of you.");
  world.say("player", "I topple the shelf onto the goblin.", fighter);
  world.patch(fighter.id, { conditions: ["prone"] });
  // 10 feet already moved: 20 left, too little to stand and walk 10, enough to crawl them.
  kit.place(fighter.id, 5, 5, 2);
  world.dice(2, 15);
  const crawled = await aiAct(fighter, { ...SHELF, targetEnemyId: enemy.id, distanceFt: 15 });
  world.clearDice();
  assert.equal(crawled.ok, true, crawled.error);
  assert.equal(kit.token(fighter.id).movedThisRound, 6, "10 feet crawled cost 20 feet of movement");
  assert.deepEqual(world.sheet(fighter.id).conditions, ["prone"], "a crawl leaves the character prone");
});

await test("A condition typed loosely ('Prone.') is read as the board reads it: the walk is priced as the move route prices it, and nothing breaks after the action is spent.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "A shelf of jars stands behind you, the goblin right in front of you.");
  world.say("player", "I topple the shelf onto the goblin.", fighter);
  world.patch(fighter.id, { conditions: ["Prone."] });
  world.dice(2, 15);
  const out = await aiAct(fighter, { reason: "topples the shelf onto the goblin", skill: "athletics", condition: "prone", scene: "the shelf", targetEnemyId: enemy.id, distanceFt: 35 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.token(fighter.id).movedThisRound, 6, "30 feet walked, as the board charges a character it does not read as prone");
});

await test("Standing up for the walk keeps what the action ended: One with Shadows' invisibility stays gone, and the stood sheet is published.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "A shelf of jars stands behind you, the goblin right in front of you.");
  world.say("player", "I topple the shelf onto the goblin.", fighter);
  world.patch(fighter.id, { conditions: ["prone", "invisible"], conditionMeta: { invisible: { source: "One with Shadows" } } });
  const from = latestSeq(world.campaignId);
  world.dice(2, 15);
  const out = await aiAct(fighter, { reason: "topples the shelf onto the goblin", skill: "athletics", condition: "prone", scene: "the shelf", targetEnemyId: enemy.id, distanceFt: 20 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.sheet(fighter.id).conditions, [], "the action ends the invisibility and standing ends prone");
  const published = listEventsSince(world.campaignId, from, 500).filter((event) => event.type === "sheet_updated" && event.payload.sheet.id === fighter.id);
  assert.deepEqual(published.at(-1)?.payload.sheet.conditions, [], "the last sheet published is the stood one");
});

await test("Out of a fight an improvised action is refused for request_roll: nothing is rationed there, and nothing is spent or rolled.", async () => {
  await kit.endFight();
  world.say("dm", "A shelf of jars stands against the wall.");
  const rolls = kit.lastRolls(50).length;
  const out = await aiAct(fighter, { reason: "topples the shelf", skill: "athletics", difficulty: "moderate", scene: "the shelf" });
  assert.equal(out.refused, "rules");
  assert.match(out.error, /request_roll/);
  assert.equal(kit.lastRolls(50).length, rolls);
});

await test("What an improvised action does lands beside the thing it uses: a creature farther than the thing plus 5 feet is refused, and nothing is spent.", async () => {
  const enemy = await stage(fighter);
  kit.place(enemy.id, 5, 12);
  world.say("dm", "A shelf of jars stands beside you; across the hall the goblin waits by a second shelf.");
  world.say("player", "I topple the shelf onto the goblin.", fighter);
  const near = await aiAct(fighter, { reason: "topples the shelf onto the goblin", skill: "athletics", condition: "prone", scene: "the shelf", targetEnemyId: enemy.id, distanceFt: 5 });
  assert.equal(near.refused, "rules");
  assert.match(near.error, /35 ft .*within 5 ft of the thing/);
  assert.equal(budget()?.actionUsed ?? false, false);
  world.dice(2, 15);
  const far = await aiAct(fighter, { reason: "topples the second shelf onto the goblin", skill: "athletics", condition: "prone", scene: "a second shelf", targetEnemyId: enemy.id, distanceFt: 30 });
  world.clearDice();
  assert.equal(far.ok, true, far.error);
});

await test("The scene is the narration since the party came to this place, the arrival's own narration included when a player's message made it take its seq early; moving to where the party stands keeps it.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "A brazier glows by the city gate.");
  // The turn that moves the party: a player posts while it runs, so its
  // narration claims the seq before theirs, ahead of move_party.
  const turn = createDmTurn(world.campaignId, []);
  narrationShown(world.campaignId, turn.id);
  const slot = claimNarrationSeq(world.campaignId);
  world.say("player", "Wait for me!", ally);
  assert.equal(handleLocationCall(world.campaign(), "move_party", JSON.stringify({ name: "The Market" }), false).ok, true);
  insertCampaignMessage({ campaignId: world.campaignId, seq: slot, authorType: "dm", content: "Stalls and crates crowd the market square; the goblin stands right in front of you.", speech: [] });
  takeNarrationSlot(world.campaignId, turn.id);
  assert.equal(handleLocationCall(world.campaign(), "move_party", JSON.stringify({ name: "The Market" }), false).ok, true);
  world.say("player", "I kick the brazier onto the goblin.", fighter);
  const gone = await aiAct(fighter, { reason: "kicks the brazier onto the goblin", skill: "athletics", damage: "1d10", damageType: "fire", scene: "the brazier", targetEnemyId: enemy.id, distanceFt: 5 });
  assert.equal(gone.ok, false);
  assert.match(gone.error, /never shows "brazier"/);
  world.dice(2, 15);
  const here = await aiAct(fighter, { reason: "topples the crates onto the goblin", skill: "athletics", condition: "prone", scene: "the crates", targetEnemyId: enemy.id, distanceFt: 5 });
  world.clearDice();
  assert.equal(here.ok, true, here.error);
});

await test("Every table compares the scene's words by its own stems: corda finds corde, and a tenda no one narrated is not there.", () => {
  const riva = ["Il goblin si infila nella tenda mezza crollata; le corde di tensione sono tese ai tuoi piedi."];
  assert.deepEqual(unshownWords("la corda della tenda", riva, "italian"), []);
  assert.deepEqual(unshownWords("la tenda", ["Il goblin è sulla riva spoglia: solo fango e canne."], "italian"), ["tenda"]);
  assert.deepEqual(unshownWords("the", riva, "english"), ["the"], "stop words alone name nothing");
});

await test("The scene is the GM's own lines however many table notes a long fight posts between them: the place's first description still counts.", async () => {
  const enemy = await stage(fighter);
  world.say("dm", "A rack of spears leans against the wall beside you; the goblin snarls right in front of you.");
  // Rounds of a long fight: whose turn it is, a hit, a fall, each a note.
  for (let round = 0; round < 120; round += 1) {
    insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "system", glyph: "cue-battle", content: `Round ${round}: the goblin's turn.` });
  }
  world.say("player", "I topple the spear rack onto the goblin.", fighter);
  world.dice(2, 15);
  const out = await aiAct(fighter, { reason: "topples the spear rack onto the goblin", skill: "athletics", condition: "prone", scene: "the rack of spears", targetEnemyId: enemy.id, distanceFt: 5 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
});

await test("The layout move_party gave the place is part of the scene: GAME STATE shows it to the model and the battle map is drawn from it.", async () => {
  const enemy = await stage(fighter);
  assert.equal(handleLocationCall(world.campaign(), "move_party", JSON.stringify({ name: "The Smithy", layoutDescription: "A forge glows at the back; a water trough stands by the door." }), false).ok, true);
  world.say("dm", "The goblin bursts in after you, blade raised.");
  world.say("player", "I tip the trough onto the goblin.", fighter);
  const never = await aiAct(fighter, { reason: "drops the chandelier on the goblin", skill: "athletics", condition: "prone", scene: "the chandelier", targetEnemyId: enemy.id, distanceFt: 5 });
  assert.match(never.error ?? "", /never shows "chandelier"/, "a thing neither the layout nor the narration names is still refused");
  world.dice(2, 15);
  const out = await aiAct(fighter, { reason: "tips the water trough onto the goblin", skill: "athletics", condition: "prone", scene: "the water trough", targetEnemyId: enemy.id, distanceFt: 5 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
});

// ---- Search ----

await test("Search is an action and a Perception check the server rolls.", async () => {
  await stage(ally);
  world.dice(12);
  const out = await act(ally, "search");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
  const roll = kit.lastRolls(1)[0];
  assert.equal(roll.kind, "skill_check");
  // Perception, proficient: 12 + 1 + 4.
  assert.equal(roll.total, 12 + abilityMod(10) + proficiencyBonus(11));
});

await test("Search is a Perception or an Investigation check: another skill is refused and spends nothing.", async () => {
  await stage(ally);
  const out = await act(ally, "search", { skill: "stealth" });
  assert.equal(out.ok, false);
  assert.match(out.error, /Perception or an Investigation/);
  assert.equal(budget()?.actionUsed ?? false, false);
});

// ---- Ready and off-turn attacks ----

await test("Ready spends the action; the readied attack resolves off turn with the reaction, once.", async () => {
  const enemy = await stage(fighter);
  const out = await act(fighter, "ready", { trigger: "when the goblin steps into reach", reason: "sword up" });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().actionUsed, true);
  assert.ok(world.sheet(fighter.id).conditions.includes("readied"));
  assert.equal(kit.endTurn(fighter.userId), true);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.ok(world.encounter().reactionsUsed.includes(fighter.id));
  assert.ok(!world.sheet(fighter.id).conditions.includes("readied"));
});

await test("Off their own turn a character attacks only as an opportunity attack or a readied action.", async () => {
  const enemy = await stage(ally);
  kit.place(fighter.id, 5, 7);
  const hp = kit.enemy(enemy.id).currentHp;
  const swing = await kit.swing(fighter.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
  assert.equal(world.encounter().reactionsUsed.includes(fighter.id), false);
});

// ---- Help ----

await test("Help on an attack counts against the creature the helper named, within 5 feet of the helper; another target rolls straight and the help is kept.", async () => {
  await kit.endFight();
  const heroFaces = { [fighter.id]: 19, [ally.id]: 10, [ranger.id]: 3 };
  await kit.fight(2, { heroFaces });
  const [enemy, other] = world.enemies();
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(ally.id, 4, 6);
  kit.place(other.id, 3, 6);
  const out = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: enemy.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).conditionMeta.helped?.source, enemy.id);
  assert.equal(kit.endTurn(fighter.userId), true);
  assert.equal(kit.current().characterId, ally.id);
  // Against the other goblin: one d20, and the help is still held.
  const wide = await kit.swing(ally.id, other.id, [15, 3, 4, 4, 4, 4]);
  assert.equal(wide.ok, true, wide.error);
  assert.equal(wide.toHit.advantage ?? "none", "none");
  assert.ok(world.sheet(ally.id).conditions.includes("helped"));
});

await test("The helper must be within 5 feet of the creature the ally attacks.", async () => {
  const enemy = await stage(fighter);
  kit.place(enemy.id, 15, 15);
  const out = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: enemy.id });
  assert.equal(out.ok, false);
  assert.ok(!world.sheet(ally.id).conditions.includes("helped"));
});

// SRD 5.1, Help: "You can lend your aid to another creature in the completion
// of a task" names no range; "you can aid a friendly creature in attacking a
// creature within 5 feet of you" holds only the foe to the helper.
await test("Help with a task reaches an ally anywhere in a fight; Help on an attack still needs its foe within 5 feet of the helper, wherever the ally stands.", async () => {
  const enemy = await stage(fighter);
  kit.place(fighter.id, 2, 2);
  kit.place(ally.id, 14, 2);
  kit.place(enemy.id, 14, 3);
  const task = await act(fighter, "help", { targetCharacterId: ally.id });
  assert.equal(task.ok, true, task.error);
  assert.ok(world.sheet(ally.id).conditions.includes("helped"));
  const attack = await stage(fighter);
  kit.place(fighter.id, 2, 2);
  kit.place(ally.id, 14, 2);
  kit.place(attack.id, 14, 3);
  const far = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: attack.id });
  assert.equal(far.ok, false);
  kit.place(attack.id, 2, 3);
  const near = await act(fighter, "help", { targetCharacterId: ally.id, targetEnemyId: attack.id });
  assert.equal(near.ok, true, near.error);
  assert.equal(world.sheet(ally.id).conditionMeta.helped?.source, attack.id);
});

// ---- Hide and contests through the roll resolver ----

await test("Hide is a Stealth check like any other: Reliable Talent floors the die at 10.", async () => {
  const enemy = await stage(ally);
  const board = kit.map();
  const wall = [];
  for (let x = 0; x < board.width; x += 1) {
    wall.push([x, 7, "#"]);
  }
  kit.openField(wall);
  kit.place(ally.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  world.dice(2);
  const out = await act(ally, "hide");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.stealth, 10 + abilityMod(16) + proficiencyBonus(11));
});

await test("A held Bardic Inspiration die rides the Hide check and is spent by it.", async () => {
  const enemy = await stage(ally);
  const board = kit.map();
  const wall = [];
  for (let x = 0; x < board.width; x += 1) {
    wall.push([x, 7, "#"]);
  }
  kit.openField(wall);
  kit.place(ally.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  world.patch(ally.id, { conditions: ["bardic inspiration (d6)"], conditionMeta: { "bardic inspiration (d6)": { rounds: 100 } } });
  world.dice(15, 4);
  const out = await act(ally, "hide");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.stealth, 15 + abilityMod(16) + proficiencyBonus(11) + 4);
  assert.ok(!world.sheet(ally.id).conditions.includes("bardic inspiration (d6)"));
});

await test("Out of a fight take_action hide is refused and points to a Stealth check against the watchers.", async () => {
  await kit.endFight();
  const out = await act(ally, "hide");
  assert.equal(out.ok, false);
  assert.ok(!world.sheet(ally.id).conditions.includes("hidden"));
});

await test("The grapple contest is an Athletics check: a held Bardic Inspiration die rides it and is spent.", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { conditions: ["bardic inspiration (d6)"], conditionMeta: { "bardic inspiration (d6)": { rounds: 100 } } });
  // 5 + 5 + d6 of 3 = 13 against 10 + 1.
  world.dice(5, 3, 10);
  const out = await act(fighter, "grapple", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.ok(!world.sheet(fighter.id).conditions.includes("bardic inspiration (d6)"));
});

// ---- the grapple's lifecycle ----

await test("A grappled character escapes with their action: Athletics or Acrobatics against the grappler's Athletics.", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: enemy.id } } });
  world.dice(20, 1);
  const out = await act(fighter, "escape");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.ok(!world.sheet(fighter.id).conditions.includes("grappled"));
  assert.equal(budget().actionUsed, true);
});

await test("A grapple ends when the grappler is moved out of reach of the grappled creature.", async () => {
  const enemy = await stage(fighter);
  world.dice(20, 1);
  assert.equal((await act(fighter, "grapple", { targetEnemyId: enemy.id })).ok, true);
  world.clearDice();
  assert.deepEqual(kit.enemy(enemy.id).conditions, ["grappled"]);
  // Carried off on someone else's turn: forced movement.
  assert.equal(kit.endTurn(fighter.userId), true);
  const moved = await world.invoke("move_token", { token: fighter.id, x: 5, y: 1, forced: true });
  assert.equal(moved.ok, true, moved.error);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
});

await test("A grapple ends when the grappler drops to 0 hit points.", async () => {
  const enemy = await stage(fighter);
  world.dice(20, 1);
  assert.equal((await act(fighter, "grapple", { targetEnemyId: enemy.id })).ok, true);
  world.clearDice();
  const out = await world.invoke("apply_damage", { characterId: fighter.id, amount: 30 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
});

// ---- pets ----

async function summonWolf() {
  const out = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(out.ok, true, out.error);
}

await test("A Beast Master's companion attacks on the ranger's action: once a turn, and the ranger's own Attack action is gone.", async () => {
  await summonWolf();
  const enemy = await stage(ranger);
  world.dice(15, 3, 3);
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(budget().actionUsed, true);
  const again = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  assert.equal(again.ok, false);
  const shot = await kit.swing(ranger.id, enemy.id, [15, 4]);
  assert.equal(shot.ok, false);
});

await test("A pet commanded by its owner acts on the owner's turn, not off it.", async () => {
  const enemy = await stage(fighter);
  const hp = kit.enemy(enemy.id).currentHp;
  world.dice(15, 3, 3);
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, hp);
});

await test("A pet is not commanded by an owner at 0 hit points.", async () => {
  const enemy = await stage(ranger);
  world.patch(ranger.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: "Wolf", targetEnemyId: enemy.id });
  assert.equal(bite.ok, false);
});


// ---- more of the same rules, from the other side ----

await test("a grapple holds on a tie: the escaper has to beat the grappler", async () => {
  const enemy = await stage(fighter);
  world.patch(fighter.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: enemy.id } } });
  // 10 + 5 against 14 + 1.
  world.dice(10, 14);
  const out = await act(fighter, "escape");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, false);
  assert.ok(world.sheet(fighter.id).conditions.includes("grappled"));
});

await test("an enemy escapes a character's grapple with its action, and then it has acted", async () => {
  const enemy = await stage(fighter);
  world.dice(20, 1);
  assert.equal((await act(fighter, "grapple", { targetEnemyId: enemy.id })).ok, true);
  world.clearDice();
  kit.freshRound();
  // enemyId is the enemy taking the action (issue #621); the older name
  // escapingEnemyId still reaches it (tool-merge-logic.ts RENAMED_ARGS).
  const stray = await world.invoke("take_action", { action: "escape", enemyId: "no-such-enemy" });
  assert.match(stray.error, /Unknown enemyId/, "the refusal names the field the call sent");
  world.dice(20, 1);
  const out = await world.invoke("take_action", { action: "escape", escapingEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true);
  assert.deepEqual(kit.enemy(enemy.id).conditions, []);
  const swing = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id });
  assert.equal(swing.ok, false, "the enemy attacked after spending its action on the escape");
});

await test("Use an Object with a consumable points to use_item and spends nothing", async () => {
  await stage(fighter);
  const out = await act(fighter, "use_object", { item: "Potion of Healing" });
  assert.equal(out.ok, false);
  assert.notEqual(budget()?.actionUsed, true);
  assert.equal(qty(fighter, "Potion of Healing"), 3);
});

await test("Search with Investigation rolls Intelligence (Investigation)", async () => {
  await stage(ally);
  world.dice(9);
  const out = await act(ally, "search", { skill: "investigation" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.lastRolls(1)[0].total, 9 + abilityMod(10));
});

await test("a readied action ends at the start of its owner's next turn", async () => {
  await stage(fighter);
  assert.equal((await act(fighter, "ready", { trigger: "when it moves" })).ok, true);
  while (kit.current().characterId !== fighter.id || world.encounter().round === 1) {
    const current = kit.current();
    if (current.kind === "pc") {
      assert.equal(kit.endTurn(current.userId), true);
    } else {
      await world.invoke("end_turn", {});
    }
    if (world.encounter().round > 2) {
      break;
    }
  }
  assert.equal(kit.current().characterId, fighter.id);
  assert.ok(!world.sheet(fighter.id).conditions.includes("readied"));
});

await test("a Help given for an ability check does not ride an attack", async () => {
  const enemy = await stage(fighter);
  assert.equal((await act(fighter, "help", { targetCharacterId: ally.id })).ok, true);
  assert.equal(kit.endTurn(fighter.userId), true);
  kit.place(ally.id, 6, 6);
  const swing = await kit.swing(ally.id, enemy.id, [15, 3, 4, 4, 4, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.advantage ?? "none", "none");
  assert.ok(world.sheet(ally.id).conditions.includes("helped"));
});

await test("a drake attacks on the ranger's bonus action, once", async () => {
  const warden = world.addHero({
    class: "ranger", subclass: "Drakewarden", level: 3, maxHp: 30, abilities: { dex: 16 }, proficiencies: TRAINED,
    equipment: [{ name: "Longbow", qty: 1 }],
  });
  heroes.push(warden);
  assert.equal((await world.invoke("summon_pet", { characterId: warden.id, kind: "drake", form: "drake", essence: "fire" })).ok, true);
  const enemy = await stage(warden);
  world.dice(15, 3);
  const bite = await world.invoke("pet_attack", { characterId: warden.id, petName: "Drake", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
  const again = await world.invoke("pet_attack", { characterId: warden.id, petName: "Drake", targetEnemyId: enemy.id });
  assert.equal(again.ok, false);
  heroes.pop();
});

await kit.endFight();
world.close();
finish();
