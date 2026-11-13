// The character creator's spells, audited class by class and spell by spell
// (the creator completeness audit, 2026-11-13): every spell a caster's book
// prints is one the player can pick, every count the class table gives is the
// count the builder, the saved sheet and the level-up hold, and no feature's
// spell is lost or counted twice.
//
// Pure: the spell lists, the counts and the checks are read straight from
// the modules the builder and the server share. With the content pack
// installed the pack's served rows are checked too; without it that half is
// skipped and the bundled checklist answers alone.
import assert from "node:assert/strict";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-creator-spells");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { bundledSpellFacts } = await import("../src/lib/srd/spell-facts.ts");
const { allPackSpells } = await import("../src/lib/content/index.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { spellMechFor, parseSpellMech, authoredSpellRow } = await import("../src/lib/srd/spell-mechanics.ts");
const { conditionEffectsFor } = await import("../src/lib/srd/condition-effects.ts");

const packRows = allPackSpells();
const packRow = (name) => packRows.find((row) => textKey(row.name) === textKey(name)) ?? null;

// ---- P03: four popular spells answered by another book's namesake ----
//
// Xanathar's Frostbite and Thunderclap are cantrips, Catapult a 1st level
// spell and Power Word Pain a 7th. No open document carries them, but Deep
// Magic prints different spells under the same four names, and the checklist
// had copied those rows' numbers: a sorcerer looking for the Frostbite
// cantrip was offered a 5th level spell, and a wizard's Catapult was a 6th.
// ODM restates the four (src/lib/srd/authored-spells.json), which outrank
// any third party row of the same name.
const NAMESAKES = [
  { name: "Frostbite", level: 0, school: "evocation", classes: ["artificer", "druid", "sorcerer", "warlock", "wizard"] },
  { name: "Thunderclap", level: 0, school: "evocation", classes: ["artificer", "bard", "druid", "sorcerer", "warlock", "wizard"] },
  { name: "Catapult", level: 1, school: "transmutation", classes: ["artificer", "sorcerer", "wizard"] },
  { name: "Power Word Pain", level: 7, school: "enchantment", classes: ["sorcerer", "warlock", "wizard"] },
];

await test("P03: Frostbite, Thunderclap, Catapult and Power Word Pain are the spells players know by those names", () => {
  const wrong = [];
  for (const want of NAMESAKES) {
    const listed = checklistSpell(want.name);
    const facts = bundledSpellFacts(want.name);
    const said = (where, level, school, classes) => {
      const got = { level, school, classes: [...(classes ?? [])].map((entry) => entry.toLowerCase()).sort() };
      if (got.level !== want.level || (school !== undefined && got.school !== want.school) || got.classes.join() !== want.classes.join()) {
        wrong.push(`${want.name} (${where}): level ${got.level}, ${got.school}, ${got.classes.join("/")}`);
      }
    };
    said("checklist", listed?.level, listed?.school, listed?.classes);
    said("engine", facts?.level, undefined, facts?.classes);
    const row = packRow(want.name);
    if (packRows.length) {
      said(`pack ${row?.documentSlug}`, row?.level, row?.school, row?.classes);
    }
  }
  assert.deepEqual(wrong, []);
});

await test("P03: the four resolve in play as their own spells: the save, the damage and Power Word Pain's hold", () => {
  const mechOf = (name) => spellMechFor([name]) ?? parseSpellMech({ desc: authoredSpellRow(name)?.desc ?? "", higherLevel: authoredSpellRow(name)?.higher_level ?? "" });
  const brief = (name) => {
    const mech = mechOf(name);
    return [mech?.resolution, mech?.save, mech?.damageType ?? mech?.condition?.name ?? null].join(" ");
  };
  assert.deepEqual(
    NAMESAKES.map((want) => `${want.name}: ${brief(want.name)}`),
    ["Frostbite: save con cold", "Thunderclap: save con thunder", "Catapult: save dex bludgeoning", "Power Word Pain: save con racked with pain"],
  );
  assert.equal(mechOf("Power Word Pain").condition.hpAtMost, 100);
  const pain = conditionEffectsFor("racked with pain");
  assert.ok(pain?.attackDisadvantage && pain.speedSet === 10, "racked with pain slows and spoils attacks");
  assert.ok(!pain.disadvantageOn.some((entry) => entry.kind === "save" && entry.ability === "con"), "its Constitution saves are untouched");
});

finish();
