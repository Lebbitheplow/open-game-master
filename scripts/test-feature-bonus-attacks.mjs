// The bonus actions a feature grants, charged and resolved by the tools
// (issue 233, section 3):
//
//   - War Priest, Unwavering Mark and Hungry Jaws: pc_attack's bonusAttack
//     "feature" takes them, spends their use and carries their extras; the
//     lizardfolk bites with the trait's 1d6 piercing.
//   - Curving Shot: a reroll of an arrow that missed, at another creature.
//   - The attack that comes with an activation (Tentacle of the Deep) costs
//     no second bonus action; the later ones do.
//   - Eldritch Cannon and Spirit Totem's bonus actions are charged.
//   - Mantle of Majesty's Command, Elder Champion's paladin spells,
//     Embodiment of the Law and the genre surges move a cast to the bonus
//     action.
//
// Dice forced; every check reads a sheet, the turn budget or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-feature-bonus-attacks");
const world = await openWorld();
const kit = await combatKit(world);
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");

const LONGSWORD = [{ name: "Longsword", qty: 1, equipped: true }];
const slots = (level, max) => ({ [level]: { max, used: 0 } });
const priest = world.addHero({
  class: "cleric", subclass: "War Domain", level: 5, maxHp: 40, abilities: { str: 16, wis: 16 }, proficiencies: TRAINED, equipment: LONGSWORD,
  features: [{ name: "War Priest", classId: "cleric" }],
});
const cavalier = world.addHero({
  class: "fighter", subclass: "Cavalier", level: 6, maxHp: 50, abilities: { str: 16 }, proficiencies: TRAINED, equipment: LONGSWORD,
  features: [{ name: "Unwavering Mark", classId: "fighter" }],
});
const lizard = world.addHero({
  class: "fighter", level: 3, maxHp: 30, race: "Lizardfolk", abilities: { str: 14, con: 16 }, proficiencies: TRAINED, equipment: LONGSWORD,
  features: [{ name: "Bite (1d6 piercing unarmed strike)" }, { name: "Hungry Jaws (a bonus-action bite granting temporary hit points, 1/short rest)" }],
});
const archer = world.addHero({
  class: "fighter", subclass: "Arcane Archer", level: 7, maxHp: 50, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longbow", qty: 1, equipped: true }], features: [{ name: "Curving Shot", classId: "fighter" }],
});
const warlock = world.addHero({
  class: "warlock", subclass: "The Fathomless", level: 3, maxHp: 24, abilities: { cha: 16 }, proficiencies: TRAINED,
  features: [{ name: "Tentacle of the Deep", classId: "warlock" }],
  spellcasting: { ability: "cha", slots: slots(1, 2), prepared: [], known: [], cantrips: [] },
});
const artillerist = world.addHero({
  class: "artificer", subclass: "Artillerist", level: 3, maxHp: 24, abilities: { int: 16 }, proficiencies: TRAINED,
  features: [{ name: "Eldritch Cannon", classId: "artificer" }],
});
// A second table: one campaign seats six.
const casters = await openWorld();
const casterKit = await combatKit(casters);
const bard = casters.addHero({
  class: "bard", subclass: "College of Glamour", level: 6, maxHp: 36, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: slots(1, 4), prepared: [], known: ["Command"], cantrips: [] },
});
const champion = casters.addHero({
  class: "paladin", level: 20, maxHp: 150, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: slots(1, 4), prepared: ["Bless", "Cure Wounds"], known: [], cantrips: [] },
});
const artificer = casters.addHero({
  class: "artificer", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  features: [{ name: "Surge Casting" }],
  spellcasting: { ability: "int", slots: slots(1, 4), prepared: ["Cure Wounds"], known: [], cantrips: ["Fire Bolt"] },
});

const POOLS = {
  [priest.id]: { sub_war_priest: { max: 3, used: 0 } },
  [cavalier.id]: { sub_unwavering_mark: { max: 3, used: 0 } },
  [lizard.id]: { race_hungry_jaws: { max: 1, used: 0 } },
  [warlock.id]: { sub_tentacle_of_the_deep: { max: 3, used: 0 } },
  [artillerist.id]: { sub_eldritch_cannon: { max: 1, used: 0 } },
  [artificer.id]: { steampunk_surge_casting: { max: 2, used: 0 } },
};

async function stage(first) {
  await kit.endFight();
  await kit.fight(1);
  for (const hero of [priest, cavalier, lizard, archer, warlock, artillerist]) {
    world.patch(hero.id, { currentHp: world.sheet(hero.id).maxHp, tempHp: 0, conditions: [], conditionMeta: {}, ac: 12, acOverride: true, resources: POOLS[hero.id] ?? {} });
  }
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200, ac: 10 });
  kit.place(enemy.id, 6, 5);
  if (first) {
    kit.place(first.id, 5, 5);
    kit.giveTurn(first.id);
  }
  return enemy;
}

const budget = () => world.encounter().turnBudget ?? {};
const castBudget = () => casters.encounter().turnBudget ?? {};

async function castStage(first) {
  await casterKit.endFight();
  await casterKit.fight(1);
  for (const hero of [bard, champion, artificer]) {
    casters.patch(hero.id, { currentHp: casters.sheet(hero.id).maxHp, conditions: [], conditionMeta: {}, resources: POOLS[hero.id] ?? {} });
  }
  casterKit.giveTurn(first.id);
}
const used = (hero, id) => world.sheet(hero.id).resources[id]?.used ?? 0;
const bonus = { bonusAttack: "feature" };

await test("War Priest's bonus attack follows the Attack action and spends a use; a plain spend is refused.", async () => {
  const enemy = await stage(priest);
  const early = await kit.swing(priest.id, enemy.id, [15, 4], bonus);
  assert.equal(early.ok, false, "the bonus attack came before the Attack action");
  const plain = await world.invoke("use_resource", { characterId: priest.id, resource: "War Priest" });
  assert.equal(plain.ok, false);
  assert.equal(used(priest, "sub_war_priest"), 0);
  assert.equal((await kit.swing(priest.id, enemy.id, [15, 4])).ok, true);
  const out = await kit.swing(priest.id, enemy.id, [15, 4], bonus);
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(used(priest, "sub_war_priest"), 1);
});

await test("Unwavering Mark: a marked creature that hits someone else opens the cavalier's bonus attack, with advantage and half the fighter level.", async () => {
  const enemy = await stage(cavalier);
  // The mark lands on the cavalier's melee hit.
  assert.equal((await kit.swing(cavalier.id, enemy.id, [15, 4])).ok, true);
  assert.ok(kit.enemy(enemy.id).conditions.includes("unwavering mark"), kit.enemy(enemy.id).conditions.join(", "));
  const refused = await kit.swing(cavalier.id, enemy.id, [15, 4], bonus);
  assert.equal(refused.ok, false, "the bonus attack came before the marked creature struck anyone");
  // It strikes the priest.
  kit.place(priest.id, 7, 5);
  // The mark makes it attack anyone else at disadvantage: both dice hit.
  world.dice(15, 15, 3);
  const hit = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: priest.id });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  assert.ok(world.sheet(cavalier.id).conditions.includes("unwavering strike"), JSON.stringify({ hit: hit.result, meta: kit.enemy(enemy.id).conditionMeta, conds: kit.enemy(enemy.id).conditions }).slice(0, 1500));
  // The cavalier's next turn.
  kit.giveTurn(cavalier.id);
  const before = kit.enemy(enemy.id).currentHp;
  const out = await kit.swing(cavalier.id, enemy.id, [3, 15, 4], bonus);
  assert.equal(out.ok, true, out.error);
  assert.match(out.toHit.expression, /^2d20kh1/);
  // Longsword 4 + Str 3 + half of fighter 6.
  assert.equal(before - kit.enemy(enemy.id).currentHp, 10);
  assert.equal(used(cavalier, "sub_unwavering_mark"), 1);
  assert.equal(world.sheet(cavalier.id).conditions.includes("unwavering strike"), false);
});

await test("A lizardfolk bites for the trait's 1d6 piercing, and Hungry Jaws' bonus bite gives Constitution in temporary hit points.", async () => {
  const enemy = await stage(lizard);
  const bite = await kit.swing(lizard.id, enemy.id, [15, 4], { weapon: "bite" });
  assert.equal(bite.ok, true, bite.error);
  assert.equal(bite.damage.expression.startsWith("1d6"), true, bite.damage.expression);
  assert.equal(bite.result.damageType ?? "piercing", "piercing");
  const jaws = await kit.swing(lizard.id, enemy.id, [15, 4], { weapon: "bite", ...bonus });
  assert.equal(jaws.ok, true, jaws.error);
  assert.equal(world.sheet(lizard.id).tempHp, 3);
  assert.equal(used(lizard, "race_hungry_jaws"), 1);
  assert.equal(budget().bonusUsed, true);
});

await test("Curving Shot rerolls a missed arrow at a different creature, with the bonus action and no second arrow.", async () => {
  await kit.endFight();
  await kit.fight(2);
  for (const hero of [archer]) world.patch(hero.id, { conditions: [], conditionMeta: {}, resources: {} });
  const [first, second] = world.enemies();
  kit.setEnemy(first.id, { maxHp: 200, ac: 15 });
  kit.setEnemy(second.id, { maxHp: 200, ac: 10 });
  kit.place(archer.id, 2, 2);
  kit.place(first.id, 8, 2);
  kit.place(second.id, 9, 2);
  kit.giveTurn(archer.id);
  const early = await kit.swing(archer.id, second.id, [15, 4], bonus);
  assert.equal(early.ok, false, "Curving Shot came before any arrow missed");
  const miss = await kit.swing(archer.id, first.id, [2]);
  assert.equal(miss.result.hit, false);
  const same = await kit.swing(archer.id, first.id, [15, 4], bonus);
  assert.equal(same.ok, false, "Curving Shot rerolled at the creature it missed");
  const curved = await kit.swing(archer.id, second.id, [15, 4], bonus);
  assert.equal(curved.ok, true, curved.error);
  assert.equal(budget().bonusUsed, true);
});

await test("Tentacle of the Deep's first strike comes with the summoning; the next turn's costs the bonus action.", async () => {
  const enemy = await stage(warlock);
  kit.place(enemy.id, 6, 5);
  const summon = await world.invoke("use_resource", { characterId: warlock.id, resource: "Tentacle of the Deep" });
  assert.equal(summon.ok, true, summon.error);
  assert.equal(budget().bonusUsed, true);
  const first = await kit.swing(warlock.id, enemy.id, [15, 4], { weapon: "Tentacle of the Deep" });
  assert.equal(first.ok, true, first.error);
  const second = await kit.swing(warlock.id, enemy.id, [15, 4], { weapon: "Tentacle of the Deep" });
  assert.equal(second.ok, false, "a second free strike on the summoning turn");
  // A later turn: the tentacle has ticked, and the strike is the bonus action.
  const meta = world.sheet(warlock.id).conditionMeta;
  world.patch(warlock.id, { conditionMeta: { ...meta, "tentacle of the deep": { ...meta["tentacle of the deep"], rounds: 8 } } });
  kit.giveTurn(warlock.id);
  const later = await kit.swing(warlock.id, enemy.id, [15, 4], { weapon: "Tentacle of the Deep" });
  assert.equal(later.ok, true, later.error);
  assert.equal(budget().bonusUsed, true);
});

await test("Eldritch Cannon: creating it is an action, activating it a bonus action.", async () => {
  await stage(artillerist);
  const made = await world.invoke("use_resource", { characterId: artillerist.id, resource: "Eldritch Cannon" });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(budget().actionUsed, true, JSON.stringify({ made, budget: budget() }));
  // The flamethrower rolls the creatures it catches in the spend (counter-saves.ts).
  const fired = await world.invoke("use_resource", { characterId: artillerist.id, resource: "Activate Cannon", variant: "flamethrower", targetEnemyId: world.enemies()[0].id });
  assert.equal(fired.ok, true, fired.error);
  assert.equal(budget().bonusUsed, true);
});

await test("Mantle of Majesty's Command is a bonus action with no slot; Elder Champion's paladin spell takes the bonus action once the action is gone.", async () => {
  await castStage(bard);
  casters.patch(bard.id, { conditions: ["mantle of majesty"], conditionMeta: { "mantle of majesty": { rounds: 10 } } });
  const command = await casters.invoke("use_spell_slot", { characterId: bard.id, spell: "Command", level: 1 });
  assert.equal(command.ok, true, command.error);
  assert.equal(castBudget().bonusUsed, true);
  assert.equal(castBudget().actionUsed, false);
  assert.equal(casters.sheet(bard.id).spellcasting.slots["1"].used, 0);
  await castStage(champion);
  casters.patch(champion.id, { conditions: ["elder champion"], conditionMeta: { "elder champion": { rounds: 10 } } });
  assert.equal((await casters.invoke("take_action", { characterId: champion.id, action: "dodge" })).ok, true);
  const blessed = await casters.invoke("use_spell_slot", { characterId: champion.id, spell: "Bless", level: 1 });
  assert.equal(blessed.ok, true, blessed.error);
  assert.equal(castBudget().bonusUsed, true);
});

await test("Surge Casting casts a cantrip as the bonus action after a levelled spell, and wants the levelled spell first.", async () => {
  await castStage(artificer);
  const early = await casters.invoke("use_resource", { characterId: artificer.id, resource: "Surge Casting" });
  assert.equal(early.ok, false, "the surge came before any levelled spell");
  assert.equal((casters.sheet(artificer.id).resources.steampunk_surge_casting?.used ?? 0), 0);
  assert.equal((await casters.invoke("use_spell_slot", { characterId: artificer.id, spell: "Cure Wounds", level: 1 })).ok, true);
  const surge = await casters.invoke("use_resource", { characterId: artificer.id, resource: "Surge Casting" });
  assert.equal(surge.ok, true, surge.error);
  const [enemy] = casters.enemies();
  const bolt = await casterKit.swing(artificer.id, enemy.id, [15, 4], { spell: "Fire Bolt" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(castBudget().bonusUsed, true);
});

// ---- the Hand ----

const TURN = { myTurn: true, actionUsed: false, bonusUsed: false, reactionUsed: false, attacksMade: 0 };

await test("The Hand deals the lizardfolk's bite, the bonus attacks, and no use_resource card for a counter the attack spends.", async () => {
  await stage();
  const hand = deriveHand(world.sheet(lizard.id), TURN);
  assert.ok(hand.some((card) => card.id === "attack:bite"), hand.map((card) => card.id).join(", "));
  assert.ok(hand.some((card) => card.name === "Hungry Jaws attack"));
  assert.equal(hand.some((card) => card.id === "feature:race_hungry_jaws"), false);
  const priestHand = deriveHand(world.sheet(priest.id), TURN);
  const card = priestHand.find((entry) => entry.name === "War Priest attack");
  assert.ok(card);
  assert.ok(card.disabled, "the War Priest card is open before the Attack action");
});

casters.close();
world.close();
finish();
