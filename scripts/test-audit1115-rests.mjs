// Rests, resources, time and progression (rules audit 2026-11-15, lens R):
// each test pins one finding, R01 onward, against SRD 5.1. The pure rules are
// imported directly; the ones that live in a handler run through a table.
//
// The table helpers come first: they point the database at a scratch
// directory before anything from src/ loads.
import assert from "node:assert/strict";
import { clockOf, openTable, rolled } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-audit1115-rests");
const { populateResources } = await import("../src/lib/srd/class-resources.ts");

const mods = { str: 0, dex: 2, con: 1, int: 3, wis: 0, cha: 0 };
const shortRest = (table, spend) => table.invoke("take_rest", { kind: "short", ...(spend ? { spend } : {}) });

await test("R01 a counter sized by the proficiency bonus reads the total level on a multiclass sheet", () => {
  // SRD 5.1, Multiclassing: "Your proficiency bonus is always based on your
  // total character level, not your level in a particular class." A wizard 2
  // / fighter 5 is 7th level, proficiency +3, so Bladesong's uses are 3.
  const classes = [{ id: "wizard", level: 2 }, { id: "fighter", level: 5 }];
  const bladesong = populateResources([{ name: "Bladesong", classId: "wizard" }], 7, mods, undefined, classes);
  assert.equal(bladesong.sub_bladesong?.max, 3);
  // Twice the bonus (a Psi Warrior's psionic dice): fighter 3 / rogue 6 is
  // 9th level, proficiency +4, eight dice.
  const psionic = populateResources(
    [{ name: "Psionic Power (Psi Warrior)", classId: "fighter" }],
    9,
    mods,
    undefined,
    [{ id: "fighter", level: 3 }, { id: "rogue", level: 6 }],
  );
  assert.equal(psionic.sub_psionic_energy?.max, 8);
  // A single-class sheet reads as it always did.
  assert.equal(populateResources([{ name: "Bladesong", classId: "wizard" }], 9, mods, undefined)?.sub_bladesong?.max, 4);
});

await test("R02 Durable floors each hit die at twice the Constitution modifier, not the dice together", async () => {
  // Durable: "When you roll a Hit Die to regain hit points, the minimum
  // number of hit points you regain from the roll equals twice your
  // Constitution modifier (minimum of 2)." CON 16 (+3): each die heals at
  // least 6. A 1 and a 10 on two d10s heal 6 + 13 = 19, not max(17, 12).
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 16 }, feats: ["Durable"], hitDice: { die: "d10", total: 5, spent: 0 } });
  table.patch(fighter.id, { currentHp: 10 });
  table.diceLog();
  table.dice(1, 10);
  const rest = await shortRest(table, [{ characterId: fighter.id, dice: 2 }]);
  assert.equal(rest.ok, true, rest.error);
  rolled(table);
  assert.equal(table.sheet(fighter.id).currentHp, 10 + 6 + 13);
});

await test("R03 a worn, attuned Periapt of Wound Closure doubles what each hit die heals and stabilizes its dying wearer", async () => {
  // SRD 5.1, Periapt of Wound Closure: "While you wear this pendant, you
  // stabilize whenever you are dying at the start of your turn. In
  // addition, whenever you roll a Hit Die to regain hit points, double the
  // number of hit points it restores."
  const { rollDeathSave } = await import("../src/lib/dm/death.ts");
  const table = await openTable();
  const periapt = { name: "Periapt of Wound Closure", qty: 1, attuned: true, equipped: true };
  const wearer = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 14 }, equipment: [periapt], hitDice: { die: "d10", total: 5, spent: 0 } });
  const bare = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 14 }, equipment: [{ ...periapt, attuned: false }], hitDice: { die: "d10", total: 5, spent: 0 } });
  assert.equal(table.sheet(wearer.id).equipment[0]?.attuned, true, "the periapt is stored attuned");
  table.patch(wearer.id, { currentHp: 10 });
  table.patch(bare.id, { currentHp: 10 });
  table.diceLog();
  // 4 + 2 doubled is 12; the unattuned pendant does nothing (4 + 2).
  table.dice(4, 4);
  const rest = await shortRest(table, [{ characterId: wearer.id, dice: 1 }, { characterId: bare.id, dice: 1 }]);
  assert.equal(rest.ok, true, rest.error);
  rolled(table);
  assert.equal(table.sheet(wearer.id).currentHp, 10 + 12);
  assert.equal(table.sheet(bare.id).currentHp, 10 + 6);

  // Dying at the start of their turn, the wearer stabilizes: no save is
  // rolled, and the track reads stable.
  table.patch(wearer.id, { currentHp: 0, deathSaves: { successes: 0, failures: 2, stable: false, dead: false } });
  table.clearDice();
  table.diceLog();
  table.dice(1, 3);
  rollDeathSave(table.campaign(), wearer.id);
  const track = table.sheet(wearer.id).deathSaves;
  assert.equal(track?.stable, true, JSON.stringify(track));
  assert.equal(track?.dead, false);
  assert.equal(track?.failures, 0);
  assert.equal(table.sheet(wearer.id).currentHp, 0, "stable is not healed");
  table.clearDice();
});

await test("R04 for 24 hours after a Potion of Vitality every hit die spent heals its maximum", async () => {
  // SRD 5.1, Potion of Vitality: "For the next 24 hours, you regain the
  // maximum number of hit points for any Hit Die you spend."
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 14 }, hitDice: { die: "d10", total: 5, spent: 0 } });
  table.patch(fighter.id, { currentHp: 10, equipment: [{ name: "Potion of Vitality", qty: 1 }] });
  const drunk = await table.invoke("use_item", { characterId: fighter.id, item: "Potion of Vitality" });
  assert.equal(drunk.ok, true, drunk.error);
  table.clearDice();
  table.diceLog();
  table.dice(1, 2);
  const rest = await shortRest(table, [{ characterId: fighter.id, dice: 2 }]);
  assert.equal(rest.ok, true, rest.error);
  table.clearDice();
  // Two d10s at their maximum, each with the +2: 24, whatever the faces.
  assert.equal(table.sheet(fighter.id).currentHp, 10 + 24);
  // A day later the potion is spent: the dice heal as rolled again.
  await table.invoke("pass_time", { amount: 1, unit: "days" });
  table.patch(fighter.id, { currentHp: 10 });
  table.dice(1);
  await shortRest(table, [{ characterId: fighter.id, dice: 1 }]);
  table.clearDice();
  assert.equal(table.sheet(fighter.id).currentHp, 10 + 3);
});

await test("R05 a character brought back from death is no longer attuned to anything", async () => {
  // SRD 5.1, Attunement: "A creature's attunement to an item ends if ...
  // the creature dies." Back from the dead, a hero attunes again with a
  // short rest; the cloak's +1 does not come back with them.
  const table = await openTable();
  const cleric = table.addHero({
    name: "Brother Tam", class: "cleric", level: 5, abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 3: { max: 2, used: 0 } }, prepared: ["Revivify"], known: [], cantrips: [] },
    equipment: [{ name: "Diamond", qty: 1, worth: 300 }, { name: "Component pouch", qty: 1 }],
  });
  const fallen = table.addHero({ name: "Lyra", equipment: [{ name: "Cloak of Protection", qty: 1, attuned: true, equipped: true }] });
  assert.equal(table.sheet(fallen.id).equipment[0]?.attuned, true, "the cloak is stored attuned");
  table.patch(fallen.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true }, currentHp: 0 });
  table.dice(4, 4);
  const raised = await table.invoke("heal", { characterId: fallen.id, casterId: cleric.id, spell: "Revivify", level: 3 });
  assert.equal(raised.ok, true, raised.error);
  table.clearDice();
  const cloak = table.sheet(fallen.id).equipment.find((item) => item.name === "Cloak of Protection");
  assert.ok(cloak, "the cloak is still carried");
  assert.equal(Boolean(cloak.attuned), false);
});

await test("R06 a worn, attuned Ring of Regeneration heals 1d6 every 10 minutes the clock moves, from 1 hit point up", async () => {
  // SRD 5.1, Ring of Regeneration: "While wearing this ring, you regain 1d6
  // hit points every 10 minutes, provided that you have at least 1 hit
  // point."
  const table = await openTable();
  const ring = { name: "Ring of Regeneration", qty: 1, attuned: true, equipped: true };
  const wearer = table.addHero({ class: "fighter", level: 5, maxHp: 60, equipment: [ring], hitDice: { die: "d10", total: 5, spent: 5 } });
  const down = table.addHero({ class: "fighter", level: 5, maxHp: 60, equipment: [ring], hitDice: { die: "d10", total: 5, spent: 5 } });
  table.patch(wearer.id, { currentHp: 10 });
  table.patch(down.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  table.clearDice();
  table.diceLog();
  // Half an hour: three ten-minute marks, 3d6.
  table.dice(1, 2, 3);
  await table.invoke("pass_time", { amount: 30, unit: "minutes" });
  table.clearDice();
  assert.equal(table.sheet(wearer.id).currentHp, 10 + 6);
  // At 0 hit points the ring does nothing.
  assert.equal(table.sheet(down.id).currentHp, 0);
  // Never past the maximum.
  table.dice(6, 6, 6, 6, 6, 6);
  await table.invoke("pass_time", { amount: 60, unit: "minutes" });
  table.clearDice();
  assert.equal(table.sheet(wearer.id).currentHp, 16 + 36);
  table.dice(6, 6, 6, 6, 6, 6);
  await table.invoke("pass_time", { amount: 60, unit: "minutes" });
  table.clearDice();
  assert.equal(table.sheet(wearer.id).currentHp, 60);
});

await test("R07 a barbarian or monk with Draconic Resilience stands at the better of the two unarmored armor classes", async () => {
  // SRD 5.1: Draconic Resilience, "when you aren't wearing armor, your AC
  // equals 13 + your Dexterity modifier"; Unarmored Defense, 10 + DEX + CON
  // (barbarian) or + WIS (monk). Two ways to figure the AC are not added:
  // the character uses one, and the better one is the one they choose.
  const { acBreakdownFor } = await import("../src/lib/srd/index.ts");
  const base = { proficiencies: { armor: [] }, equipment: [] };
  const barbarian = acBreakdownFor({
    ...base,
    class: "barbarian",
    level: 2,
    classes: [{ id: "barbarian", level: 1 }, { id: "sorcerer", level: 1 }],
    abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 14 },
    features: [{ name: "Unarmored Defense", classId: "barbarian" }, { name: "Draconic Resilience", classId: "sorcerer" }],
  });
  // 10 + 2 + 1 = 13 against 13 + 2 = 15.
  assert.equal(barbarian.ac, 15, barbarian.parts.join(", "));
  const monk = acBreakdownFor({
    ...base,
    class: "monk",
    level: 2,
    classes: [{ id: "monk", level: 1 }, { id: "sorcerer", level: 1 }],
    abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 14 },
    features: [{ name: "Unarmored Defense", classId: "monk" }, { name: "Draconic Resilience", classId: "sorcerer" }],
  });
  // 10 + 3 + 1 = 14 against 13 + 3 = 16.
  assert.equal(monk.ac, 16, monk.parts.join(", "));
  // Where Unarmored Defense is the better, it stands: CON 18 is 10 + 2 + 4.
  const tough = acBreakdownFor({
    ...base,
    class: "barbarian",
    level: 2,
    classes: [{ id: "barbarian", level: 1 }, { id: "sorcerer", level: 1 }],
    abilities: { str: 14, dex: 14, con: 18, int: 10, wis: 10, cha: 14 },
    features: [{ name: "Unarmored Defense", classId: "barbarian" }, { name: "Draconic Resilience", classId: "sorcerer" }],
  });
  assert.equal(tough.ac, 16, tough.parts.join(", "));
});

await test("R08 Fiendish Resilience's damage type is chosen as a rest ends, not whenever the warlock likes", async () => {
  // SRD 5.1, The Fiend, Fiendish Resilience: "you can choose one damage
  // type when you finish a short or long rest. You gain resistance to that
  // damage type until you choose a different one with this feature."
  const table = await openTable();
  const fiend = table.addHero({
    class: "warlock", subclass: "The Fiend", level: 10, abilities: { cha: 16 },
    features: [{ name: "Fiendish Resilience", classId: "warlock" }],
    hitDice: { die: "d8", total: 10, spent: 10 },
  });
  const choose = (type) => table.invoke("use_resource", { characterId: fiend.id, resource: "Fiendish Resilience", variant: type });
  const early = await choose("fire");
  assert.notEqual(early.ok, true, `no rest has ended: nothing to choose yet ${JSON.stringify(early)}`);
  assert.equal(early.refused, "rules");
  const rest = await shortRest(table);
  assert.equal(rest.ok, true, rest.error);
  const chosen = await choose("fire");
  assert.equal(chosen.ok, true, chosen.error);
  // An hour on, the choice is set until the next rest ends.
  await table.invoke("pass_time", { amount: 1, unit: "hours" });
  const swapped = await choose("cold");
  assert.equal(swapped.refused, "rules");
  assert.ok(table.sheet(fiend.id).features.some((feature) => feature.name === "Fiendish Resilience (fire)"));
});

await test("R09 from bard 5 the GM, the spend's result and the Hand say Bardic Inspiration comes back on any rest", async () => {
  // SRD 5.1, Bard, Font of Inspiration: "Beginning when you reach 5th
  // level, you regain all of your expended uses of Bardic Inspiration when
  // you finish a short or long rest." The rest already refilled it; GAME
  // STATE, use_resource and the Hand read the 1st-level rule and said a
  // long rest, so the GM held a 5th-level bard to one night's uses.
  const { describeSheet } = await import("../src/lib/dm/prompt.ts");
  const table = await openTable();
  const bard = table.addHero({ class: "bard", level: 5, abilities: { cha: 16 }, features: [{ name: "Bardic Inspiration (d8)", classId: "bard" }, { name: "Font of Inspiration", classId: "bard" }] });
  const ally = table.addHero({ class: "fighter", level: 5 });
  assert.ok(table.sheet(bard.id).resources.bardic_inspiration, "the bard holds the counter");
  assert.match(describeSheet(table.sheet(bard.id), "bard", false, {}), /Bardic Inspiration 3\/3 \(refills on any rest\)/);
  const spent = await table.invoke("use_resource", { characterId: bard.id, resource: "Bardic Inspiration", targetCharacterId: ally.id });
  assert.equal(spent.ok, true, spent.error);
  assert.equal(spent.result?.refills ?? spent.refills, "on any rest");
  // A 4th-level bard still waits for the night.
  const novice = table.addHero({ class: "bard", level: 4, abilities: { cha: 16 }, features: [{ name: "Bardic Inspiration (d6)", classId: "bard" }] });
  assert.doesNotMatch(describeSheet(table.sheet(novice.id), "novice", false, {}), /Bardic Inspiration 3\/3 \(refills on any rest\)/);
});

await test("R10 a Potion of Heroism's temporary hit points end with its hour, as its bless does", async () => {
  // SRD 5.1, Potion of Heroism: "you gain 10 temporary hit points that last
  // for 1 hour. For the same duration, you are under the effect of the
  // bless spell."
  const table = await openTable();
  const drinker = table.addHero({ class: "fighter", level: 5, maxHp: 44 });
  table.patch(drinker.id, { equipment: [{ name: "Potion of Heroism", qty: 1 }] });
  const drunk = await table.invoke("use_item", { characterId: drinker.id, item: "Potion of Heroism" });
  assert.equal(drunk.ok, true, drunk.error);
  assert.equal(table.sheet(drinker.id).tempHp, 10);
  // Half an hour on, a blow takes 4 of them; the rest still hold.
  await table.invoke("pass_time", { amount: 30, unit: "minutes" });
  await table.invoke("apply_damage", { characterId: drinker.id, amount: 4, reason: "a falling stone" });
  assert.equal(table.sheet(drinker.id).tempHp, 6);
  // Past the hour, bless and what is left of the pool are gone together.
  await table.invoke("pass_time", { amount: 31, unit: "minutes" });
  assert.equal(table.sheet(drinker.id).conditions.includes("blessed"), false, "bless ran out");
  assert.equal(table.sheet(drinker.id).tempHp, 0);
});

await test("R11 the SRD items whose text counts their uses in its own words are in the item table, spend those uses and refill them as the text says", async () => {
  // SRD 5.1: Chime of Opening, "The chime can be used ten times. After the
  // tenth time, it cracks and becomes useless"; Bag of Tricks, "Once three
  // fuzzy objects have been pulled from the bag, the bag can't be used again
  // until the next dawn"; Horn of Valhalla, "Once you use the horn, it can't
  // be used again until 7 days have passed"; Restorative Ointment "contains
  // 1d4 + 1 doses"; Dust of Dryness "contains 1d6 + 4 pinches"; Bag of Beans
  // "3d4 dry beans"; Robe of Useful Items, two each of six patches and 4d4
  // others; Rod of Security "can't be used again until ten days have
  // passed". None of them was in the table, so nothing counted a use.
  const { chargeRuleOf } = await import("../src/lib/srd/item-charge-rules.ts");
  const { magicItemNamed } = await import("../src/lib/srd/magic-items.ts");
  const rule = (name) => chargeRuleOf({ name });
  assert.deepEqual(rule("Chime of Opening"), { max: 10, spentAway: true });
  assert.deepEqual(rule("Bag of Tricks"), { max: 3, regain: "all" });
  assert.deepEqual(rule("Horn of Valhalla"), { max: 1, regainDays: 7 });
  assert.deepEqual(rule("Rod of Security"), { max: 1, regainDays: 10 });
  assert.deepEqual(rule("Restorative Ointment"), { max: "1d4+1", spentAway: true });
  assert.deepEqual(rule("Dust of Dryness"), { max: "1d6+4", spentAway: true });
  assert.deepEqual(rule("Bag of Beans"), { max: "3d4", spentAway: true });
  assert.deepEqual(rule("Robe of Useful Items"), { max: "4d4+12", spentAway: true });
  // SRD 5.1, Ioun Stone: every stone asks for attunement, and each is named
  // for its kind. Absorption: "Once the stone has canceled 20 levels of
  // spells, it burns out" (50 for the greater stone).
  for (const stone of ["Absorption", "Greater Absorption", "Awareness", "Mastery", "Regeneration", "Reserve", "Sustenance"]) {
    assert.equal(magicItemNamed(`Ioun Stone of ${stone}`)?.requiresAttunement, true, stone);
    assert.equal(magicItemNamed(`Ioun Stone (${stone})`)?.name, `Ioun Stone of ${stone}`, stone);
  }
  assert.deepEqual(rule("Ioun Stone of Absorption"), { max: 20, spentAway: true });
  assert.deepEqual(rule("Ioun Stone of Greater Absorption"), { max: 50, spentAway: true });

  const table = await openTable();
  const hero = table.addHero({
    class: "fighter", level: 5, maxHp: 40,
    equipment: [{ name: "Bag of Tricks", qty: 1 }, { name: "Horn of Valhalla", qty: 1 }, { name: "Chime of Opening", qty: 1 }],
  });
  const use = (item) => table.invoke("use_item", { characterId: hero.id, item });
  for (let pull = 1; pull <= 3; pull += 1) {
    const out = await use("Bag of Tricks");
    assert.equal(out.ok, true, `pull ${pull}: ${out.error}`);
  }
  const fourth = await use("Bag of Tricks");
  assert.equal(fourth.refused, "rules", "a fourth pull waits for dawn");
  assert.match(fourth.error, /dawn/);
  const blown = await use("Horn of Valhalla");
  assert.equal(blown.ok, true, blown.error);
  const again = await use("Horn of Valhalla");
  assert.equal(again.refused, "rules", "the horn waits 7 days");
  assert.match(again.error, /7 days/);
  await table.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal((await use("Bag of Tricks")).ok, true, "the bag is back at dawn");
  assert.equal((await use("Horn of Valhalla")).refused, "rules", "a day is not 7");
  await table.invoke("pass_time", { amount: 6, unit: "days" });
  const week = await use("Horn of Valhalla");
  assert.equal(week.ok, true, `7 days on: ${week.error}`);
  for (let strike = 1; strike <= 10; strike += 1) {
    const out = await use("Chime of Opening");
    assert.equal(out.ok, true, `strike ${strike}: ${out.error}`);
  }
  assert.equal(table.sheet(hero.id).equipment.some((item) => item.name === "Chime of Opening"), false, "the tenth strike cracks it");
});

await test("R11 a worn, attuned Ioun Stone of Regeneration heals 15 at the end of every hour, from 1 hit point up", async () => {
  // SRD 5.1, Ioun Stone, Regeneration: "You regain 15 hit points at the end
  // of each hour this pearly white spindle orbits your head, provided that
  // you have at least 1 hit point." A stone "is considered to be an object
  // that is being worn while it orbits your head."
  const table = await openTable();
  const stone = { name: "Ioun Stone of Regeneration", qty: 1, attuned: true, equipped: true };
  const wearer = table.addHero({ class: "fighter", level: 5, maxHp: 60, equipment: [stone] });
  const down = table.addHero({ class: "fighter", level: 5, maxHp: 60, equipment: [stone] });
  const loose = table.addHero({ class: "fighter", level: 5, maxHp: 60, equipment: [{ ...stone, attuned: false }] });
  assert.equal(table.sheet(wearer.id).equipment[0]?.attuned, true, "the stone is stored attuned");
  table.patch(wearer.id, { currentHp: 10 });
  table.patch(loose.id, { currentHp: 10 });
  table.patch(down.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  // From the top of an hour: 59 minutes end no hour; 121 more end three, 45.
  const past = clockOf(table) % 60;
  if (past) {
    await table.invoke("pass_time", { amount: 60 - past, unit: "minutes" });
    table.patch(wearer.id, { currentHp: 10 });
    table.patch(loose.id, { currentHp: 10 });
  }
  await table.invoke("pass_time", { amount: 59, unit: "minutes" });
  assert.equal(table.sheet(wearer.id).currentHp, 10, "no hour has ended");
  await table.invoke("pass_time", { amount: 121, unit: "minutes" });
  assert.equal(table.sheet(wearer.id).currentHp, 10 + 45);
  assert.equal(table.sheet(loose.id).currentHp, 10, "an unattuned stone does nothing");
  assert.equal(table.sheet(down.id).currentHp, 0, "at 0 hit points the stone does nothing");
  await table.invoke("pass_time", { amount: 2, unit: "hours" });
  assert.equal(table.sheet(wearer.id).currentHp, 60, "never past the maximum");
});

finish();
