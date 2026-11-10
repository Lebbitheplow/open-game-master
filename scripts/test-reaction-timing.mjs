// When a character the triggering hit dropped may still react, and the
// limited-use reactions that act on that hit (issue 233, section 1), with the
// uses and recharges corrected to the books (section 5).
//
//   - A reaction that answers the hit (Shield, Stone's Endurance) is judged as
//     the character stood before it, by every tool that spends one.
//   - One triggered by dropping to 0 (Strength before Death, Necrotic Husk)
//     is allowed exactly then and refused otherwise.
//   - One that follows the damage (Misty Escape, Hellish Rebuke) is refused to
//     a character the damage dropped: they are unconscious.
//
// Dice forced; every check reads a sheet, the encounter or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-reaction-timing");
const world = await openWorld();
const kit = await combatKit(world);
const { reactionTimingOf } = await import("../src/lib/dm/reaction-kinds.ts");
const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");
const { resourceDef } = await import("../src/lib/srd/class-resources.ts");
const lastHit = await import("../src/lib/dm/last-hit.ts");

const slots = (max) => ({ 1: { max, used: 0 } });
const goliath = world.addHero({
  class: "fighter", level: 5, maxHp: 40, race: "Goliath", abilities: { str: 16, con: 14 }, proficiencies: TRAINED,
  features: [{ name: "Stone's Endurance" }], equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const samurai = world.addHero({
  class: "fighter", subclass: "Samurai", level: 18, maxHp: 120, abilities: { str: 18 }, proficiencies: TRAINED,
  features: [{ name: "Strength before Death", classId: "fighter" }], equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const undead = world.addHero({
  class: "warlock", subclass: "The Undead", level: 10, maxHp: 60, abilities: { cha: 18 }, proficiencies: TRAINED,
  features: [{ name: "Necrotic Husk", classId: "warlock" }, { name: "Misty Escape", classId: "warlock" }],
  spellcasting: { ability: "cha", slots: { 5: { max: 2, used: 0 } }, prepared: [], known: ["Hellish Rebuke"], cantrips: [] },
});
const wizard = world.addHero({
  class: "wizard", level: 5, maxHp: 30, abilities: { int: 18, dex: 14 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: slots(4), prepared: ["Shield"], known: [], cantrips: [] },
});
const monk = world.addHero({
  class: "monk", subclass: "Way of the Ascendant Dragon", level: 5, maxHp: 38, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED,
  features: [{ name: "Breath of the Dragon", classId: "monk" }, { name: "Ki", classId: "monk" }],
});
const soul = world.addHero({
  class: "sorcerer", subclass: "Divine Soul", level: 18, maxHp: 100, abilities: { cha: 18 }, proficiencies: TRAINED,
  features: [{ name: "Unearthly Recovery", classId: "sorcerer" }],
});

const RESOURCES = {
  [goliath.id]: { race_stones_endurance: { max: 1, used: 0 } },
  [samurai.id]: { sub_strength_before_death: { max: 1, used: 0 } },
  [undead.id]: { sub_necrotic_husk: { max: 1, used: 0 }, sub_misty_escape: { max: 1, used: 0 } },
  [monk.id]: { sub_breath_of_the_dragon: { max: 3, used: 0 }, ki: { max: 5, used: 0 } },
  [soul.id]: { sub_unearthly_recovery: { max: 1, used: 0 } },
};

async function stage() {
  await kit.endFight();
  await kit.fight(1);
  for (const hero of [goliath, samurai, undead, wizard, monk, soul]) {
    const sheet = world.sheet(hero.id);
    world.patch(hero.id, {
      currentHp: sheet.maxHp, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, exhaustion: 0,
      ac: 12, acOverride: true, resources: RESOURCES[hero.id] ?? sheet.resources,
    });
  }
  world.patch(wizard.id, { spellcasting: { ...world.sheet(wizard.id).spellcasting, slots: slots(4) } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  return enemy;
}

// A hit of `raw` on the character, recorded as the engine records one, and
// its damage applied: to 0 when it is at least their hit points.
async function struck(hero, raw, enemy) {
  await world.hitBy(hero.id, { enemyId: enemy?.id ?? null, raw, total: 18, vsAc: 12 });
  const sheet = world.sheet(hero.id);
  const hp = Math.max(0, sheet.currentHp - raw);
  world.patch(hero.id, { currentHp: hp, conditions: hp === 0 ? ["unconscious", "prone"] : sheet.conditions });
  const record = lastHit.freshLastHit(world.campaign().id, hero.id);
  lastHit.writeLastHit(world.campaign().id, { ...record, after: { currentHp: hp, tempHp: 0, beastHp: null } });
}

const spend = (hero, resource, extra = {}) => world.invoke("use_resource", { characterId: hero.id, resource, ...extra });
const used = (hero, id) => world.sheet(hero.id).resources[id]?.used ?? 0;

await test("Every reaction has one timing: answers the hit, triggered at 0, or follows the damage.", () => {
  assert.equal(reactionTimingOf("Shield"), "answers");
  assert.equal(reactionTimingOf("Stone's Endurance"), "answers");
  assert.equal(reactionTimingOf("Uncanny Dodge"), "answers");
  assert.equal(reactionTimingOf("Strength before Death"), "at_zero");
  assert.equal(reactionTimingOf("Necrotic Husk"), "at_zero");
  assert.equal(reactionTimingOf("Hellish Rebuke"), "after");
  assert.equal(reactionTimingOf("Misty Escape"), "after");
  assert.equal(reactionTimingOf("Wrath of the Storm"), "after");
});

await test("Stone's Endurance after a hit that dropped the goliath is taken as they stood, and the roll comes off the blow.", async () => {
  const enemy = await stage();
  await struck(goliath, 45, enemy);
  assert.equal(world.sheet(goliath.id).currentHp, 0);
  world.dice(10);
  const out = await spend(goliath, "Stone's Endurance");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // 1d12 (10) + Con 2 = 12 off a 45-point blow on 40 hit points: 33 taken, 7 left.
  const after = world.sheet(goliath.id);
  assert.equal(after.currentHp, 7, JSON.stringify(out.result));
  assert.equal(used(goliath, "race_stones_endurance"), 1);
  assert.ok(world.encounter().reactionsUsed.includes(goliath.id));
});

await test("Stone's Endurance with no damage on record is refused, and nothing is spent.", async () => {
  await stage();
  const out = await spend(goliath, "Stone's Endurance");
  assert.equal(out.ok, false);
  assert.equal(used(goliath, "race_stones_endurance"), 0);
  assert.equal(world.encounter().reactionsUsed.includes(goliath.id), false);
});

await test("Misty Escape and Hellish Rebuke follow the damage: a warlock the hit dropped is unconscious and cannot take them.", async () => {
  const enemy = await stage();
  await struck(undead, 70, enemy);
  const out = await spend(undead, "Misty Escape");
  assert.equal(out.ok, false, "Misty Escape was taken at 0 hit points");
  assert.match(out.error, /follows the damage/);
  assert.equal(used(undead, "sub_misty_escape"), 0);
  // Hellish Rebuke, cast "in response to being damaged", the same.
  const rebuke = await world.invoke("use_spell_slot", { characterId: undead.id, spell: "Hellish Rebuke", level: 5 });
  assert.equal(rebuke.ok, false, "Hellish Rebuke was cast at 0 hit points");
  assert.equal(world.sheet(undead.id).spellcasting.slots["5"].used, 0);
});

await test("Shield after a dropping hit is cast through use_reaction, judged as the caster stood before it; a cast tool is pointed there and spends nothing.", async () => {
  const enemy = await stage();
  await struck(wizard, 31, enemy);
  const viaSlot = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Shield", level: 1 });
  assert.equal(viaSlot.ok, false);
  assert.match(String(viaSlot.error), /Shield is cast as a reaction: use_reaction/);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 0);
  const viaReaction = await world.invoke("use_reaction", { characterId: wizard.id, feature: "Shield" });
  assert.equal(viaReaction.ok, true, viaReaction.error);
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 1);
});

await test("Strength before Death is refused to a samurai who is not down, and costs nothing.", async () => {
  await stage();
  const out = await spend(samurai, "Strength before Death");
  assert.equal(out.ok, false);
  assert.match(out.error, /not down/);
  assert.equal(used(samurai, "sub_strength_before_death"), 0);
});

await test("Strength before Death at the dropping hit puts the fall off for an extra turn taken now, and the fall comes at its end.", async () => {
  const enemy = await stage();
  // Struck on the goliath's turn; the extra turn is the next to begin.
  kit.giveTurn(goliath.id);
  await struck(samurai, 130, enemy);
  const out = await spend(samurai, "Strength before Death");
  assert.equal(out.ok, true, out.error);
  const held = world.sheet(samurai.id);
  assert.equal(held.currentHp, 0);
  assert.equal(held.conditions.includes("unconscious"), false, held.conditions.join(", "));
  assert.ok(held.conditions.includes("strength before death"), held.conditions.join(", "));
  const encounter = world.encounter();
  const extra = encounter.order[encounter.turnIndex + 1];
  assert.equal(extra.characterId, samurai.id);
  assert.equal(extra.extra, "Strength before Death");
  // The goliath's turn ends and the extra one begins: they act at 0, and
  // when it ends they fall.
  const passed = await world.invoke("end_turn", { characterId: goliath.id });
  assert.equal(passed.ok, true, passed.error);
  assert.equal(world.encounter().order[world.encounter().turnIndex].extra, "Strength before Death");
  const during = world.sheet(samurai.id);
  assert.equal(during.conditions.includes("unconscious"), false, "they fell as the extra turn began");
  const ended = await world.invoke("end_turn", { characterId: samurai.id });
  assert.equal(ended.ok, true, ended.error);
  const fallen = world.sheet(samurai.id);
  assert.ok(fallen.conditions.includes("unconscious"), fallen.conditions.join(", "));
  assert.equal(fallen.conditions.includes("strength before death"), false);
});

await test("Necrotic Husk at the dropping hit: 1 hit point, a level of exhaustion, and back only after its long rests.", async () => {
  const enemy = await stage();
  kit.place(undead.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  await struck(undead, 70, enemy);
  world.dice(4, 3, 2);
  const out = await spend(undead, "Necrotic Husk");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const after = world.sheet(undead.id);
  assert.equal(after.currentHp, 1);
  assert.equal(after.conditions.includes("unconscious"), false, after.conditions.join(", "));
  assert.equal(after.exhaustion, 1);
  const marker = after.conditions.find((entry) => entry.startsWith("necrotic husk recovering"));
  assert.ok(marker, after.conditions.join(", "));
  const rests = Number(/\((\d+)\)/.exec(marker)[1]);
  // Each long rest counts the marker down; the use stays spent until it is gone.
  let sheet = { ...after, currentHp: after.maxHp };
  for (let left = rests; left > 1; left -= 1) {
    sheet = { ...sheet, ...longRestPatch(sheet) };
    assert.equal(sheet.resources.sub_necrotic_husk.used, 1, `back after ${rests - left + 1} of ${rests} rests`);
  }
  sheet = { ...sheet, ...longRestPatch(sheet) };
  assert.equal(sheet.resources.sub_necrotic_husk.used, 0);
  assert.equal(sheet.conditions.some((entry) => entry.startsWith("necrotic husk recovering")), false);
});

await test("Breath of the Dragon has proficiency-bonus uses, and 2 ki buys one more when they are gone.", async () => {
  await stage();
  assert.equal(resourceDef("sub_breath_of_the_dragon").maxFor(5, { wis: 2 }), 3);
  world.patch(monk.id, { resources: { sub_breath_of_the_dragon: { max: 3, used: 3 }, ki: { max: 5, used: 0 } } });
  kit.giveTurn(monk.id);
  // The breath rolls the creatures it catches in the spend (counter-saves.ts),
  // within its 30 feet: the goblin is set beside the monk.
  const [goblin] = world.enemies();
  kit.place(monk.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  const out = await spend(monk, "Breath of the Dragon", { targetEnemyId: goblin.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(used(monk, "ki"), 2);
  assert.equal(used(monk, "sub_breath_of_the_dragon"), 3);
});

await test("Unearthly Recovery works only below half hit points.", async () => {
  await stage();
  kit.giveTurn(soul.id);
  world.patch(soul.id, { currentHp: 50 });
  const refused = await spend(soul, "Unearthly Recovery");
  assert.equal(refused.ok, false, "healed at exactly half");
  assert.equal(used(soul, "sub_unearthly_recovery"), 0);
  world.patch(soul.id, { currentHp: 49 });
  const out = await spend(soul, "Unearthly Recovery");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(soul.id).currentHp, 99);
});

await test("Call the Hunt and Infectious Fury have proficiency-bonus uses, and Wind Soul returns on a short rest.", () => {
  assert.equal(resourceDef("sub_call_the_hunt").maxFor(14, { con: 4 }), 5);
  assert.equal(resourceDef("sub_infectious_fury").maxFor(10, { con: 2 }), 4);
  assert.equal(resourceDef("sub_wind_soul").recharge, "short");
});

world.close();
finish();
