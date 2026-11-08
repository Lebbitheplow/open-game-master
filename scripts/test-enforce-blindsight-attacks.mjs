// Blindsight perceives without eyes, and truesight sees the invisible (SRD
// 5.1, Senses). The attack roll read only See Invisibility and True Seeing
// among the conditions: a goblin with blindsight swung at an invisible
// fighter beside it at disadvantage, the invisible fighter's own swing at it
// kept advantage, a blinded creature with blindsight swung blind, and an
// invisible fighter walking out of its reach provoked nothing. Each now reads
// the senses that reach the other side (attack-light.ts sensesReaching), the
// rule "a creature you can see" reads too; a sense that falls short of the
// distance sees nothing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-blindsight-attacks");
const world = await openWorld();
const kit = await combatKit(world);
const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");

const fighter = world.addHero({
  class: "fighter", level: 5, maxHp: 200, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const features = world.sheet(fighter.id).features;
const SWORD = [{ name: "Longsword", qty: 1, equipped: true }];
const BOW = [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }];

async function stage({ heroConditions = [], goblinConditions = [], blindsight = 0, heroSenses = false, at = { x: 5, y: 6 }, bow = false } = {}) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 19 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 300, currentHp: 300, conditions: goblinConditions, conditionMeta: {}, stats: { ...goblin.stats, senses: blindsight ? { blindsight } : {} } });
  kit.place(fighter.id, 5, 5);
  kit.place(goblin.id, at.x, at.y);
  world.patch(fighter.id, {
    conditions: heroConditions, conditionMeta: {}, ac: 12, acOverride: true, currentHp: 200,
    features: heroSenses ? [...features, { name: "Blindsight 10 ft", source: "race" }] : features,
    equipment: bow ? BOW : SWORD,
  });
  return goblin;
}

async function goblinSwing(goblin) {
  kit.freshRound();
  world.dice(10, 10, 4, 4);
  const out = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: fighter.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return kit.lastRolls(5).find((roll) => roll.kind === "attack")?.advantage ?? "none";
}

async function heroSwing(goblin, weapon = "Longsword") {
  kit.giveTurn(fighter.id);
  kit.freshTurn();
  const out = await kit.swing(fighter.id, goblin.id, [10, 10, 4, 4, 4], { weapon });
  assert.equal(out.ok, true, out.error);
  return out.toHit.advantage ?? "none";
}

await test("a goblin with blindsight swings at the invisible fighter beside it with no disadvantage; without it, at disadvantage", async () => {
  assert.equal(await goblinSwing(await stage({ heroConditions: ["invisible"], blindsight: 30 })), "none");
  assert.equal(await goblinSwing(await stage({ heroConditions: ["invisible"] })), "disadvantage");
});

await test("the invisible fighter's own swing at a goblin with blindsight has no advantage from it", async () => {
  assert.equal(await heroSwing(await stage({ heroConditions: ["invisible"], blindsight: 30 })), "none");
  assert.equal(await heroSwing(await stage({ heroConditions: ["invisible"] })), "advantage");
});

await test("a fighter's blindsight sees the invisible goblin beside them, and falls short of one 30 feet off", async () => {
  assert.equal(await heroSwing(await stage({ goblinConditions: ["invisible"], heroSenses: true })), "none");
  assert.equal(await goblinSwing(await stage({ goblinConditions: ["invisible"], heroSenses: true })), "none");
  assert.equal(await heroSwing(await stage({ goblinConditions: ["invisible"], heroSenses: true, at: { x: 5, y: 11 }, bow: true }), "Longbow"), "disadvantage");
});

await test("a blinded goblin with blindsight does not swing blind, and the blinded fighter's blindsight keeps the goblin from swinging at advantage", async () => {
  assert.equal(await goblinSwing(await stage({ goblinConditions: ["blinded"], blindsight: 30 })), "none");
  assert.equal(await goblinSwing(await stage({ goblinConditions: ["blinded"] })), "disadvantage");
  assert.equal(await goblinSwing(await stage({ heroConditions: ["blinded"], heroSenses: true })), "none");
});

await test("an invisible fighter leaving a blindsight goblin's reach provokes its opportunity attack; one without blindsight lets them go", async () => {
  const seer = await stage({ heroConditions: ["invisible"], blindsight: 30 });
  kit.freshRound();
  world.dice(10, 10, 4, 4);
  resolveOpportunityAttacks(world.campaign(), fighter.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  assert.ok(world.encounter().reactionsUsed.includes(seer.id), "the goblin's blindsight saw the fighter leave");
  const blind = await stage({ heroConditions: ["invisible"] });
  kit.freshRound();
  resolveOpportunityAttacks(world.campaign(), fighter.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  assert.equal(world.encounter().reactionsUsed.includes(blind.id), false);
});

// The Hand's hit preview reads the board view's edge for each target
// (view-tactics.ts), so it says what the roll will meet.
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { attackContext, mergeAdvantage } = await import("../src/lib/dm/condition-logic.ts");
await test("the board view carries the fighter's blindsight to the Hand's preview, which then shows no disadvantage on the invisible goblin", async () => {
  const goblin = await stage({ goblinConditions: ["invisible"], heroSenses: true });
  kit.giveTurn(fighter.id);
  const edge = buildPlayerMapView(world.campaignId, world.owner.id).edges[goblin.id];
  assert.equal(edge?.senses?.attacker?.blindsight, true, JSON.stringify(edge));
  const preview = attackContext({ attackerConditions: [], targetConditions: ["invisible"], melee: true, adjacent: true, requested: "none", attackerSenses: edge.senses.attacker, targetSenses: edge.senses.target });
  assert.equal(mergeAdvantage(preview.sources), "none");
});

finish();
