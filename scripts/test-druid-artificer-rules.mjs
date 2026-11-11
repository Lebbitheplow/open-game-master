// The pure pieces of the druid and artificer fixes of the divine package's
// second wave (scripts/clauses/divine.json), each failing without its fix:
//   an Experimental Elixir's flight is a 10-foot flying speed, not the Fly
//   spell's 60 (battlemap/types.ts flyingSpeedOf);
//   a spell slot pays for one more elixir or cannon, the lowest left
//   (authored-spend-divine-dra.ts lowestSlotLeft, spendSlotOf);
//   Starry Form's Dragon floors every Intelligence and Wisdom check at 10
//   (authored-effects-more.ts authoredCheckFloor);
//   two effects under one feature name both reach the feature table
//   (authored-feature-defs.ts: Powered Steps beside the launcher's 1d6);
//   Alchemical Savant adds nothing without alchemist's supplies
//   (authored-effects-more.ts authoredSpellDice);
//   Hearth of Moonlight and Shadow ends with a short rest
//   (rest-logic.ts shortRestResourcePatch).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");
const { authoredCheckFloor, authoredSpellDice } = await import("../src/lib/srd/authored-effects-more.ts");
const { authoredFeatureDefs } = await import("../src/lib/srd/authored-feature-defs.ts");
const { shortRestResourcePatch } = await import("../src/lib/dm/rest-logic.ts");

// The slot helpers are pure but live beside the spend door; import them by path.
const { lowestSlotLeft, spendSlotOf } = await import("../src/lib/dm/authored-spend-divine-dra.ts");

assert.equal(flyingSpeedOf({ conditions: ["flying (10 ft)"] }), 10, "an elixir of flight flies 10 feet");
assert.equal(flyingSpeedOf({ conditions: ["flying"] }), 60, "the Fly spell's flight is still 60");

const casting = { ability: "int", slots: { "1": { max: 2, used: 2 }, "2": { max: 2, used: 1 }, "3": { max: 0, used: 0 } }, prepared: [], known: [], cantrips: [] };
assert.equal(lowestSlotLeft({ spellcasting: casting }), 2, "the 1st-level slots are spent: the 2nd pays");
assert.equal(lowestSlotLeft({ spellcasting: { ...casting, slots: { "1": { max: 1, used: 1 } } } }), null, "no slot left, none pays");
assert.deepEqual(spendSlotOf(casting, 2).slots["2"], { max: 2, used: 2 });

const druid = (conditions) => ({
  class: "druid",
  subclass: "Circle of Stars",
  level: 2,
  classes: [{ id: "druid", level: 2, subclass: "Circle of Stars" }],
  features: [{ name: "Starry Form", classId: "druid", source: "class" }],
  conditions,
});
assert.equal(authoredCheckFloor(druid(["starry form: dragon"]), "arcana", "int"), 10, "the Dragon floors an Intelligence check");
assert.equal(authoredCheckFloor(druid(["starry form: dragon"]), "insight", "wis"), 10, "and a Wisdom check");
assert.equal(authoredCheckFloor(druid(["starry form: dragon"]), "athletics", "str"), 0, "not a Strength check");
assert.equal(authoredCheckFloor(druid(["starry form: archer"]), "arcana", "int"), 0, "not in another form");

const infiltrator = authoredFeatureDefs().filter((entry) => entry.match.includes("armor model infiltrator"));
assert.equal(infiltrator.length, 1, "one entry for the Infiltrator's name");
assert.deepEqual(infiltrator[0].effects.map((effect) => effect.kind).sort(), ["speed_bonus", "weapon_damage_rider"], "Powered Steps and the launcher's 1d6 both reach the table");

const alchemist = (equipment) => ({
  class: "artificer",
  subclass: "Alchemist",
  level: 5,
  classes: [{ id: "artificer", level: 5, subclass: "Alchemist" }],
  features: [{ name: "Alchemical Savant", classId: "artificer", source: "class" }],
  conditions: [],
  equipment,
});
const fire = { damageType: "fire", level: 0 };
assert.deepEqual(authoredSpellDice(alchemist([]), fire, { int: 5 }).dice, [], "no supplies, no bonus");
assert.deepEqual(authoredSpellDice(alchemist([{ name: "Alchemist's Supplies", qty: 1, equipped: true }]), fire, { int: 5 }).dice, ["5"], "through the supplies, +Intelligence");

const resting = {
  resources: {},
  conditions: ["hearth of moonlight and shadow", "blessed"],
  conditionMeta: { "hearth of moonlight and shadow": { rounds: 4800, untilRestEnds: true }, blessed: { rounds: 10 } },
  spellcasting: null,
  class: "druid",
};
const patch = shortRestResourcePatch(resting);
assert.deepEqual(patch?.conditions, ["blessed"], "the sphere ends with the short rest it was raised for");

console.log("test-druid-artificer-rules: ok");
