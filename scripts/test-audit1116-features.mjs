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

// A03. SRD 5.1, Lay on Hands: "you can touch a creature and draw power from
// the pool to restore a number of hit points to that creature", and hit
// points never rise past the maximum. The pool paid whatever the call named:
// 20 drawn for an ally 5 short spent 20 and told the table 20 were healed,
// and a touch on an ally at full hit points spent 5 for nothing.
await test("A03: Lay on Hands draws from the pool only the hit points it restores", async () => {
  await kit.endFight();
  const paladin = world.addHero({ class: "paladin", level: 5, proficiencies: { ...TRAINED }, features: [{ name: "Lay on Hands", source: "class", classId: "paladin" }] });
  const ally = world.addHero({ class: "fighter", level: 5, maxHp: 30 });
  world.patch(ally.id, { currentHp: 25 });
  const pool = () => world.sheet(paladin.id).resources.lay_on_hands;
  const touch = await world.invoke("use_resource", { characterId: paladin.id, resource: "Lay on Hands", targetCharacterId: ally.id, amount: 20 });
  assert.equal(touch.ok, true, touch.error);
  assert.equal(world.sheet(ally.id).currentHp, 30, "the ally is healed to full");
  assert.equal(pool().used, 5, `the pool pays the 5 restored, not the 20 asked (used ${pool().used})`);
  assert.doesNotMatch(JSON.stringify(touch.result), /"healed":20/, "the result tells the table 20 were healed");
  const full = await world.invoke("use_resource", { characterId: paladin.id, resource: "Lay on Hands", targetCharacterId: ally.id, amount: 5 });
  assert.equal(full.ok, false, "a touch on an ally at full hit points restores nothing and spends nothing");
  assert.equal(pool().used, 5, "nothing more is drawn");
  // A druid in a beast form is healed in the beast's hit points.
  const druid = world.addHero({ class: "druid", level: 4, maxHp: 30 });
  world.patch(druid.id, { wildShape: { form: "Wolf", beastHp: 9, beastMaxHp: 11, beastAc: 13 } });
  const beast = await world.invoke("use_resource", { characterId: paladin.id, resource: "Lay on Hands", targetCharacterId: druid.id, amount: 10 });
  assert.equal(beast.ok, true, beast.error);
  assert.equal(world.sheet(druid.id).wildShape?.beastHp, 11, "the wolf is healed to its 11");
  assert.equal(pool().used, 7, `the wolf's 2 missing hit points are what the pool pays (used ${pool().used})`);
});

// A04. SRD 5.1, Rage: "If you are able to cast spells, you can't cast them
// or concentrate on them while raging." Wild Shape: "You can't cast spells".
// Magic Items, Wands: the wand lets its holder "cast" its spell. The cast
// tools refused both, but use_item on a Wand of Magic Missiles spent a
// charge for a raging barbarian and for a druid in a wolf's body, and sent
// the GM to deal the missiles.
await test("A04: a raging barbarian or a druid in beast form casts nothing from a wand, and no charge is spent", async () => {
  await kit.endFight();
  const wand = () => ({ name: "Wand of Magic Missiles", qty: 1, charges: 7 });
  const raging = world.addHero({ class: "barbarian", level: 5, proficiencies: { ...TRAINED }, equipment: [wand()], features: [{ name: "Rage", source: "class", classId: "barbarian" }] });
  const druid = world.addHero({ class: "druid", level: 4, proficiencies: { ...TRAINED }, equipment: [wand()], spellcasting: { ability: "wis", slots: { 1: { max: 3, used: 0 }, 2: { max: 2, used: 0 } }, prepared: ["Cure Wounds"], known: [], cantrips: [] } });
  const charges = (id) => world.sheet(id).equipment.find((item) => /wand of magic missiles/i.test(item.name))?.charges;
  await kit.fight(1);
  const [foe] = world.enemies();
  kit.giveTurn(raging.id);
  const rage = await world.invoke("use_resource", { characterId: raging.id, resource: "Rage" });
  assert.equal(rage.ok, true, rage.error);
  const zapped = await world.invoke("use_item", { characterId: raging.id, item: "Wand of Magic Missiles", targetEnemyId: foe.id });
  assert.equal(zapped.ok, false, "a raging barbarian let a wand's spell loose");
  assert.match(String(zapped.error), /raging/);
  assert.equal(charges(raging.id), 7, "no charge is spent on a spell that cannot be cast");
  kit.giveTurn(druid.id);
  world.patch(druid.id, { wildShape: { form: "Wolf", beastHp: 11, beastMaxHp: 11, beastAc: 13 } });
  const wolf = await world.invoke("use_item", { characterId: druid.id, item: "Wand of Magic Missiles", targetEnemyId: foe.id });
  assert.equal(wolf.ok, false, "a druid in a wolf's body let a wand's spell loose");
  assert.equal(charges(druid.id), 7, "no charge is spent");
  // Nor is a scroll read in the wolf's body: it stays in the pack.
  world.patch(druid.id, { equipment: [...world.sheet(druid.id).equipment, { name: "Spell Scroll (Cure Wounds)", qty: 1, spell: "Cure Wounds" }] });
  const read = await world.invoke("use_item", { characterId: druid.id, item: "Spell Scroll (Cure Wounds)" });
  assert.equal(read.ok, false, "a druid in a wolf's body read a scroll");
  assert.ok(world.sheet(druid.id).equipment.some((item) => /spell scroll/i.test(item.name)), "the scroll stays in the pack");
  // Out of the rage and the form, the wand works as it should.
  world.patch(druid.id, { wildShape: null });
  kit.giveTurn(druid.id);
  const freed = await world.invoke("use_item", { characterId: druid.id, item: "Wand of Magic Missiles", targetEnemyId: foe.id });
  assert.equal(freed.ok, true, freed.error);
  assert.equal(charges(druid.id), 6, "the staging: the druid in their own body spends a charge");
  await kit.endFight();
});

// A05. SRD 5.1, Deflect Missiles: "you can use your reaction to deflect or
// catch the missile when you are hit by a ranged weapon attack." A spell's
// ranged attack (a flameskull's Fire Ray, "Ranged Spell Attack") throws no
// missile, and the monk turned its 16 fire damage away all the same.
await test("A05: Deflect Missiles answers a ranged weapon attack, never a ranged spell attack", async () => {
  await kit.endFight();
  const monk = world.addHero({ class: "monk", level: 5, maxHp: 40, abilities: { dex: 16, wis: 14 }, proficiencies: { ...TRAINED }, features: [{ name: "Ki", source: "class", classId: "monk" }, { name: "Deflect Missiles", source: "class", classId: "monk" }] });
  const struckBy = async (attack) => {
    await kit.endFight();
    world.patch(monk.id, { currentHp: 40 });
    await kit.fight(1);
    const [foe] = world.enemies();
    kit.place(monk.id, 5, 5);
    kit.place(foe.id, 5, 9);
    kit.setEnemy(foe.id, { stats: { attacks: [attack] } });
    foesTurn(foe);
    world.clearDice();
    world.dice(18, 8, 8);
    const hit = await world.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: monk.id });
    world.clearDice();
    assert.equal(hit.ok, true, hit.error);
    const hurt = world.sheet(monk.id).currentHp;
    world.dice(10);
    const deflect = await world.invoke("use_reaction", { characterId: monk.id, feature: "Deflect Missiles" });
    world.clearDice();
    return { hurt, deflect, after: world.sheet(monk.id).currentHp };
  };
  const arrow = await struckBy({ name: "Shortbow", toHit: 6, damage: "1d6+2", type: "piercing", ranged: true, range: "80/320 ft." });
  assert.equal(arrow.deflect.ok, true, `the staging: an arrow is deflected (${arrow.deflect.error})`);
  assert.ok(arrow.after > arrow.hurt, "the arrow's damage is cut");
  const ray = await struckBy({ name: "Fire Ray", toHit: 6, damage: "2d10", type: "fire", ranged: true, range: "60 ft.", spellAttack: true });
  assert.equal(ray.deflect.ok, false, "a ranged spell attack was deflected as a missile");
  assert.equal(ray.after, ray.hurt, "the fire ray's damage stands");
  await kit.endFight();
});

finish();
