// Class and race features and the action economy, from the 2026-11-16 rules
// audit (the features lens, findings A01..). Each test names its finding and
// the SRD 5.1 rule it holds the engine to.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-features");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);

// A fight against one dummy standing next to the hero, the hero's turn.
async function besideOne(heroId) {
  await kit.endFight();
  await kit.fight(1);
  const [foe] = world.enemies();
  kit.giveTurn(heroId);
  kit.place(heroId, 5, 5);
  kit.place(foe.id, 5, 6);
  return foe;
}

// The enemy holds the floor, its turn begun, as end_turn's hand-off leaves it.
function foesTurn(foe) {
  const fight = world.encounter();
  kit.saveEncounter({ ...fight, turnIndex: Math.max(0, fight.order.findIndex((entry) => entry.kind !== "pc")), turnBudget: null });
  kit.enemyTurn(foe.id);
}

// A1 d20s an enemy's swing threw, and the notes it gave.
async function enemySwing(foe, heroId) {
  world.clearDice();
  world.diceLog();
  world.dice(12, 12, 3);
  const out = await world.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: heroId });
  const d20s = world.diceLog().filter((die) => die.sides === 20).length;
  world.clearDice();
  return { out, d20s, notes: (out.result?.conditionEffects ?? []).join(" | ") };
}

// A01. SRD 5.1, Dodge: "You lose this benefit if you are incapacitated (as
// explained in the appendix) or if your speed drops to 0." A grapple or a
// restraint takes the speed to 0, and the Dodge went on: a grappled dodger
// still made the goblin roll at disadvantage, a restrained one cancelled the
// advantage restraint gives, and both kept advantage on Dexterity saves.
await test("A01: a dodger whose speed drops to 0 (grappled, restrained) loses the Dodge", async () => {
  const hero = world.addHero({ class: "fighter", level: 3, proficiencies: { ...TRAINED } });
  const foe = await besideOne(hero.id);
  const dodge = await world.invoke("take_action", { characterId: hero.id, action: "dodge" });
  assert.equal(dodge.ok, true, dodge.error);
  foesTurn(foe);
  const free = await enemySwing(foe, hero.id);
  assert.equal(free.d20s, 2, `the staging: a free dodger is struck at disadvantage (${free.notes})`);
  assert.match(free.notes, /dodging/);
  for (const [held, d20s, why] of [["grappled", 1, "a grappled dodger's speed is 0: a straight roll"], ["restrained", 2, "a restrained dodger is struck at advantage"]]) {
    kit.freshRound();
    const fresh = world.sheet(hero.id);
    world.patch(hero.id, { conditions: [...fresh.conditions.filter((entry) => entry === "dodging"), held], conditionMeta: { ...fresh.conditionMeta, [held]: { source: foe.id } } });
    const swing = await enemySwing(foe, hero.id);
    assert.equal(swing.out.ok, true, swing.out.error);
    assert.doesNotMatch(swing.notes, /dodging/, `${held}: ${swing.notes}`);
    assert.equal(swing.d20s, d20s, `${why} (${swing.notes})`);
  }
  // The other half: advantage on Dexterity saves goes with it.
  const { resolveRollExpression } = await import("../src/lib/dm/rolls.ts");
  const { rollExtrasFor } = await import("../src/lib/dm/forced-save.ts");
  const save = () => {
    const sheet = world.sheet(hero.id);
    return resolveRollExpression({ characterId: hero.id, kind: "saving_throw", ability: "dex" }, sheet, rollExtrasFor(world.campaign(), sheet, "saving_throw")).expression;
  };
  world.patch(hero.id, { conditions: ["dodging"], conditionMeta: { dodging: { untilTurnOf: hero.id } } });
  assert.match(save(), /^2d20kh1/, "the staging: a dodger has advantage on a Dexterity save");
  world.patch(hero.id, { conditions: ["dodging", "grappled"], conditionMeta: { dodging: { untilTurnOf: hero.id }, grappled: { source: foe.id } } });
  assert.match(save(), /^1d20/, "a grappled dodger has no advantage on a Dexterity save");
  // A hero's own swing at a dodging goblin the party holds in a grapple.
  world.patch(hero.id, { conditions: [], conditionMeta: {}, equipment: [{ name: "Longsword", qty: 1 }] });
  kit.setEnemy(foe.id, { conditions: ["dodging", "grappled"], conditionMeta: { dodging: { untilTurnOf: foe.id }, grappled: { source: hero.id } } });
  kit.giveTurn(hero.id);
  const swing = await kit.swing(hero.id, foe.id, [12, 12, 3], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.match(String(swing.toHit?.expression), /^1d20\+/, "a grappled goblin's Dodge is gone: a straight roll");
  await kit.endFight();
});

// The dice of one size a damage roll threw.
const diceOf = (roll, sides) => (roll?.breakdown?.terms ?? []).filter((term) => term.kind === "dice" && term.sides === sides).reduce((sum, term) => sum + term.count, 0);

// A02. SRD 5.1, Hunter's Mark: "If the target drops to 0 hit points before
// this spell ends, you can use a bonus action on a subsequent turn of yours
// to mark a new creature." Hex reads the same. A ranger with Extra Attack
// who dropped the marked goblin with the first swing moved the mark to the
// second goblin with the second swing of the same turn, and its 1d6 rode it.
await test("A02: a mark whose creature falls moves only on a later turn of its holder", async () => {
  const ranger = world.addHero({
    class: "ranger",
    level: 5,
    abilities: { str: 16 },
    proficiencies: { ...TRAINED },
    equipment: [{ name: "Longsword", qty: 1 }],
    features: [{ name: "Extra Attack", source: "class", classId: "ranger" }],
  });
  await kit.endFight();
  await kit.fight(2);
  const [first, second] = world.enemies();
  kit.giveTurn(ranger.id);
  kit.place(ranger.id, 5, 5);
  kit.place(first.id, 5, 6);
  kit.place(second.id, 6, 6);
  kit.setEnemy(first.id, { currentHp: 1 });
  world.patch(ranger.id, { conditions: ["hunter's mark"], conditionMeta: { "hunter's mark": { quarry: first.id, spell: "Hunter's Mark", source: ranger.id } } });
  const kill = await kit.swing(ranger.id, first.id, [15, 4, 4], { weapon: "Longsword" });
  assert.equal(kill.ok, true, kill.error);
  assert.equal(diceOf(kill.damage, 6), 1, "the staging: the marked goblin takes the mark's 1d6");
  assert.notEqual(kit.enemy(first.id).status, "alive", "the staging: the marked goblin falls");
  const next = await kit.swing(ranger.id, second.id, [15, 4, 4], { weapon: "Longsword" });
  assert.equal(next.ok, true, next.error);
  assert.equal(diceOf(next.damage, 6), 0, "the mark moved and rode a swing on the turn its creature fell");
  assert.equal(world.encounter().turnBudget?.bonusUsed, false, "the bonus action went on a move the rules do not allow yet");
  // The ranger's next turn: the mark moves with the bonus action.
  kit.giveTurn(ranger.id);
  const later = await kit.swing(ranger.id, second.id, [15, 4, 4], { weapon: "Longsword" });
  assert.equal(later.ok, true, later.error);
  assert.equal(diceOf(later.damage, 6), 1, "on a later turn the mark moves to the second goblin");
  assert.equal(world.encounter().turnBudget?.bonusUsed, true, "moving the mark is the bonus action");
  await kit.endFight();
});

finish();
