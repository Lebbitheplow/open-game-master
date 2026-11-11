// The clause ledger's Spellcasting probes for every SRD 5.1 caster: the
// sentences of each class's Spellcasting (or Pact Magic) section that say
// which ability casts, that a cast leaves the prepared list alone, how
// rituals are cast, which focus serves, and how many slots each level has.
// scripts/clauses/srd-classes.json names the probes, "casting.<class>.<what>";
// one table below says what each class's text promises, and every probe
// reads it.
import "./lib/enforce-world.mjs";
import { probesNamedIn } from "./lib/sweep-clauses-srd.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const cast = await import("../src/lib/dm/cast-materials.ts");

// The SRD 5.1 slot tables, at the levels where a column changes.
const FULL = {
  1: { 1: 2 }, 2: { 1: 3 }, 3: { 1: 4, 2: 2 }, 5: { 1: 4, 2: 3, 3: 2 }, 9: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 },
  11: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, 17: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, 20: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1 },
};
const HALF = { 1: {}, 2: { 1: 2 }, 3: { 1: 3 }, 5: { 1: 4, 2: 2 }, 9: { 1: 4, 2: 3, 3: 2 }, 17: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, 20: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 } };
const PACT = { 1: { 1: 1 }, 2: { 1: 2 }, 3: { 2: 2 }, 5: { 3: 2 }, 7: { 4: 2 }, 9: { 5: 2 }, 11: { 5: 3 }, 17: { 5: 4 } };

// What each class's Spellcasting text promises. `ritual`: how it casts a
// ritual ("prepared": a prepared one; "known": any it knows; "book": any in
// its spellbook, unprepared; "none": it has no ritual casting).
const CASTERS = {
  bard: { ability: "cha", focus: "instrument", other: "holy_symbol", table: FULL, ritual: "known", spell: "Detect Magic", plain: "Healing Word" },
  cleric: { ability: "wis", focus: "holy_symbol", other: "instrument", table: FULL, ritual: "prepared", spell: "Detect Magic", plain: "Bless" },
  druid: { ability: "wis", focus: "druidic_focus", other: "holy_symbol", table: FULL, ritual: "prepared", spell: "Detect Magic", plain: "Healing Word" },
  paladin: { ability: "cha", focus: "holy_symbol", other: "instrument", table: HALF, ritual: "none", spell: "Detect Magic", plain: "Bless" },
  ranger: { ability: "wis", table: HALF, ritual: "none", spell: "Detect Magic", plain: "Cure Wounds" },
  sorcerer: { ability: "cha", focus: "arcane_focus", other: "holy_symbol", table: FULL, ritual: "none", spell: "Detect Magic", plain: "Magic Missile" },
  warlock: { ability: "cha", focus: "arcane_focus", other: "holy_symbol", table: PACT, ritual: "none", spell: "Comprehend Languages", plain: "Hex" },
  wizard: { ability: "int", focus: "arcane_focus", other: "holy_symbol", table: FULL, ritual: "book", spell: "Detect Magic", plain: "Magic Missile" },
};
const MOD = 4;
const SCORES = (ability) => ({ str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10, [ability]: 18 });
const P = {};

for (const [cls, row] of Object.entries(CASTERS)) {
  const caster = (t, level, spellcasting = {}) =>
    t.hero({
      class: cls, level, abilities: SCORES(row.ability),
      spellcasting: { ability: row.ability, slots: slots(4, 3, 3), prepared: [row.plain], known: [row.plain], cantrips: [], ...spellcasting },
    });

  P[`casting.${cls}.ability`] = async () => {
    const t = await rig.table();
    for (const level of [1, 5, 9, 17]) {
      const who = caster(t, Math.max(level, row.table === HALF ? 2 : 1));
      const derived = t.derived(who);
      const pb = 2 + Math.floor((t.sheet(who).level - 1) / 4);
      assert.deepEqual([derived.spellSaveDc, derived.spellAttack], [8 + pb + MOD, pb + MOD], `${cls} ${t.sheet(who).level}: DC and attack with ${row.ability.toUpperCase()} 18`);
    }
  };

  P[`casting.${cls}.prepared-stays`] = async () => {
    const t = await rig.table();
    const who = caster(t, 5);
    const before = JSON.stringify(t.sheet(who).spellcasting.prepared ?? []);
    const out = await t.invoke("use_spell_slot", { characterId: who.id, level: 1, spell: row.plain });
    assert.equal(out.ok, true, out.error);
    assert.equal(JSON.stringify(t.sheet(who).spellcasting.prepared ?? []), before, "the cast changed the prepared list");
  };

  P[`casting.${cls}.ritual-${row.ritual}`] = async () => {
    const t = await rig.table();
    const without = caster(t, 5);
    const listed = row.ritual === "known" ? { known: [row.plain, row.spell] } : row.ritual === "book" ? { known: [row.plain, row.spell], prepared: [row.plain] } : { prepared: [row.plain, row.spell], known: [row.plain, row.spell] };
    const holder = caster(t, 5, listed);
    const held = await t.invoke("use_spell_slot", { characterId: holder.id, level: 1, spell: row.spell, ritual: true });
    if (row.ritual === "none") {
      assert.equal(held.ok, false, `a ${cls} cast ${row.spell} as a ritual, which the class's Spellcasting does not allow`);
      return;
    }
    assert.equal(held.ok, true, `a ${cls} holding ${row.spell} (${row.ritual}) cannot cast it as a ritual: ${held.error}`);
    const missing = await t.invoke("use_spell_slot", { characterId: without.id, level: 1, spell: row.spell, ritual: true });
    assert.equal(missing.ok, false, `a ${cls} without ${row.spell} cast it as a ritual`);
  };

  P[`casting.${cls}.focus`] = async () => {
    const t = await rig.table();
    const who = caster(t, 5);
    const facts = { name: row.plain, material: "a pinch of dust" };
    const sheetWith = (tag) => ({ ...t.sheet(who), equipment: [{ name: "Focus", qty: 1, tags: [tag], gear: { tags: [tag] } }] });
    if (row.focus) {
      assert.equal(cast.focusProblem(sheetWith(row.focus), facts), null, `a ${cls}'s ${row.focus} does not serve as the focus`);
      assert.notEqual(cast.focusProblem(sheetWith(row.other), facts), null, `a ${cls}'s ${row.other} served as the focus`);
    }
  };

  P[`casting.${cls}.slots`] = async () => {
    const { srd } = rig;
    for (const [level, wanted] of Object.entries(row.table)) {
      const got = Object.fromEntries(Object.entries(srd.spellSlotsFor(cls, Number(level))).filter(([, count]) => count > 0).map(([slot, count]) => [Number(slot), count]));
      assert.deepEqual(got, wanted, `${cls} ${level}`);
    }
  };
}

// The Cantrips Known, Spells Known and prepared counts of the SRD 5.1 class
// tables, by class level, as src/lib/srd/spell-prep.ts reads them for the
// builder's caps and the server's check of a sheet's lists.
const prep = await import("../src/lib/srd/spell-prep.ts");
const CANTRIPS = {
  bard: [[1, 2], [4, 3], [10, 4]], druid: [[1, 2], [4, 3], [10, 4]], warlock: [[1, 2], [4, 3], [10, 4]],
  sorcerer: [[1, 4], [4, 5], [10, 6]], wizard: [[1, 3], [4, 4], [10, 5]],
};
const KNOWN = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
};
// A 2nd-level spell of each list, for a slot below the spell's level.
const SECOND = { bard: "Hold Person", druid: "Barkskin", sorcerer: "Blur", wizard: "Blur", ranger: "Barkskin" };
const viewOf = (cls, level) => ({ classId: cls, level, subclass: "", ability: CASTERS[cls].ability });
for (const [cls, steps] of Object.entries(CANTRIPS)) {
  P[`casting.${cls}.cantrips-known`] = () => {
    for (const [level, count] of steps) {
      for (const at of [level, level + 1]) assert.equal(prep.cantripCapOf(viewOf(cls, at)), count, `${cls} ${at}`);
    }
  };
}
for (const [cls, column] of Object.entries(KNOWN)) {
  P[`casting.${cls}.spells-known`] = () => {
    const got = column.map((_, at) => prep.spellCapOf(viewOf(cls, at + 1), SCORES(CASTERS[cls].ability))?.count ?? 0);
    assert.deepEqual(got, column, `${cls}: the Spells Known column, levels 1 to 20`);
  };
}
for (const cls of ["druid", "wizard"]) {
  // "a number of spells equal to your modifier + your level (minimum of one)".
  P[`casting.${cls}.prepared-count`] = () => {
    for (const [score, level, count] of [[16, 3, 6], [18, 5, 9], [8, 1, 1], [10, 20, 20]]) {
      const abilities = { ...SCORES(CASTERS[cls].ability), [CASTERS[cls].ability]: score };
      assert.equal(prep.spellCapOf(viewOf(cls, level), abilities)?.count, count, `${cls} ${level} with ${score}`);
    }
  };
}
for (const [cls, second] of Object.entries(SECOND)) {
  const row = CASTERS[cls];
  const caster = (t, level) =>
    t.hero({ class: cls, level, abilities: SCORES(row.ability), spellcasting: { ability: row.ability, slots: slots(4, 3, 3), prepared: [row.plain, second], known: [row.plain, second], cantrips: [] } });
  P[`casting.${cls}.slot-or-higher`] = async () => {
    const t = await rig.table();
    const who = caster(t, 9);
    const low = await t.invoke("use_spell_slot", { characterId: who.id, level: 1, spell: second });
    assert.equal(low.ok, false, `a 1st-level slot cast the 2nd-level ${second}`);
    const high = await t.invoke("use_spell_slot", { characterId: who.id, level: 2, spell: row.plain });
    assert.equal(high.ok, true, `a 2nd-level slot did not cast the 1st-level ${row.plain}: ${high.error}`);
    assert.equal(t.sheet(who).spellcasting.slots["2"].used, 1, "and spent the 2nd-level slot");
  };
  P[`casting.${cls}.long-rest-slots`] = async () => {
    const t = await rig.table();
    const who = caster(t, 9);
    t.patch(who, { spellcasting: { ...t.sheet(who).spellcasting, slots: { 1: { max: 4, used: 4 }, 2: { max: 3, used: 2 }, 3: { max: 3, used: 3 } } } });
    const out = await t.rest("long");
    assert.equal(out.ok, true, out.error);
    const used = Object.values(t.sheet(who).spellcasting.slots).reduce((sum, slot) => sum + slot.used, 0);
    assert.equal(used, 0, "a long rest left slots spent");
  };
}

// Every probe the table above makes, by name: the ledger's probe check
// finds a probe by its name in this file, and the run below holds the table
// to this list.
const NAMES = [
  "casting.bard.ability",
  "casting.bard.prepared-stays",
  "casting.bard.ritual-known",
  "casting.bard.focus",
  "casting.bard.slots",
  "casting.cleric.ability",
  "casting.cleric.prepared-stays",
  "casting.cleric.ritual-prepared",
  "casting.cleric.focus",
  "casting.cleric.slots",
  "casting.druid.ability",
  "casting.druid.prepared-stays",
  "casting.druid.ritual-prepared",
  "casting.druid.focus",
  "casting.druid.slots",
  "casting.paladin.ability",
  "casting.paladin.prepared-stays",
  "casting.paladin.ritual-none",
  "casting.paladin.focus",
  "casting.paladin.slots",
  "casting.ranger.ability",
  "casting.ranger.prepared-stays",
  "casting.ranger.ritual-none",
  "casting.ranger.focus",
  "casting.ranger.slots",
  "casting.sorcerer.ability",
  "casting.sorcerer.prepared-stays",
  "casting.sorcerer.ritual-none",
  "casting.sorcerer.focus",
  "casting.sorcerer.slots",
  "casting.warlock.ability",
  "casting.warlock.prepared-stays",
  "casting.warlock.ritual-none",
  "casting.warlock.focus",
  "casting.warlock.slots",
  "casting.wizard.ability",
  "casting.wizard.prepared-stays",
  "casting.wizard.ritual-book",
  "casting.wizard.focus",
  "casting.wizard.slots",
  "casting.bard.cantrips-known",
  "casting.druid.cantrips-known",
  "casting.warlock.cantrips-known",
  "casting.sorcerer.cantrips-known",
  "casting.wizard.cantrips-known",
  "casting.bard.spells-known",
  "casting.sorcerer.spells-known",
  "casting.ranger.spells-known",
  "casting.warlock.spells-known",
  "casting.druid.prepared-count",
  "casting.wizard.prepared-count",
  "casting.bard.slot-or-higher",
  "casting.bard.long-rest-slots",
  "casting.druid.slot-or-higher",
  "casting.druid.long-rest-slots",
  "casting.sorcerer.slot-or-higher",
  "casting.sorcerer.long-rest-slots",
  "casting.wizard.slot-or-higher",
  "casting.wizard.long-rest-slots",
  "casting.ranger.slot-or-higher",
  "casting.ranger.long-rest-slots",
];
assert.deepEqual(Object.keys(P).sort(), [...NAMES].sort(), "the table makes other probes than NAMES lists");

// A probe the table makes for a class whose ledger entry names no such
// clause (the paladin's text says nothing of rituals) is not run: it is
// counted and named here, never dropped unseen.
const FILE = "scripts/test-enforce-sweep-clauses-srd-casting.mjs";
const named = probesNamedIn(FILE);
const unnamed = Object.keys(P).filter((id) => !named.has(id));
if (!process.env.SWEEP_CLAUSES_SURVEY) for (const id of unnamed) delete P[id];
if (unnamed.length) console.log(`srd-casting: ${unnamed.length} table probes no clause names, not run: ${unnamed.join(", ")}`);

await runOrSurvey(FILE, P);
