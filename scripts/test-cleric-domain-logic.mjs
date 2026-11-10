// The pure readers behind the cleric domains the divine clause ledger's
// second wave built: Emboldening Bond's d4, once a turn and only beside
// another bonded creature (src/lib/dm/emboldening-bond-logic.ts); Read
// Thoughts' free Suggestion (src/lib/dm/read-thoughts.ts); and the cantrips
// and spells the Nature, Arcana and Death domains teach on top of the
// cleric's counts (src/lib/srd/class-spell-grants.ts).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { BOND, BOND_SPEND, bondRiderFor, bondSpentMeta } = await import("../src/lib/dm/emboldening-bond-logic.ts");
const { READ_THOUGHTS, READING_THOUGHTS, isSuggestion, readsThoughts, thoughtsReadBy } = await import("../src/lib/dm/read-thoughts.ts");
const { classSpellGrants } = await import("../src/lib/srd/class-spell-grants.ts");

// ---- Emboldening Bond ----
const bonded = { conditions: [BOND], conditionMeta: { [BOND]: { rounds: 100, source: "cleric" } } };
const rider = bondRiderFor(bonded, true, "fight:1:hero");
assert.equal(rider?.dice, "1d4", "a bonded creature beside another adds a d4");
assert.equal(rider.spend, BOND_SPEND);
assert.equal(bondRiderFor(bonded, false, "fight:1:hero"), null, "alone, more than 30 feet from another bonded creature, it adds none");
assert.equal(bondRiderFor({ conditions: [], conditionMeta: {} }, true, "fight:1:hero"), null, "an unbonded creature adds none");
const spent = { ...bonded, conditionMeta: bondSpentMeta(bonded, "fight:1:hero") };
assert.equal(spent.conditionMeta[BOND].usedTurn, "fight:1:hero");
assert.equal(spent.conditionMeta[BOND].source, "cleric", "the stamp keeps the bond's own meta");
assert.equal(bondRiderFor(spent, true, "fight:1:hero"), null, "once per turn: the second roll of the turn goes without it");
assert.equal(bondRiderFor(spent, true, "fight:1:ally")?.dice, "1d4", "the next turn it rides again");
assert.equal(bondSpentMeta(bonded, null), null, "out of a fight no turn is counted");

// ---- Read Thoughts ----
assert.equal(isSuggestion("Suggestion"), true);
assert.equal(isSuggestion("Mass Suggestion"), false);
assert.equal(readsThoughts({ conditions: [READING_THOUGHTS] }), true);
assert.equal(readsThoughts({ conditions: [] }), false);
const read = { conditions: [READ_THOUGHTS], conditionMeta: { [READ_THOUGHTS]: { rounds: 10, source: "cleric" } } };
assert.equal(thoughtsReadBy(read, "cleric"), true, "the creature the cleric reads fails the save");
assert.equal(thoughtsReadBy(read, "another"), false, "another caster's Suggestion is saved against");

// ---- the cantrips and spells a domain teaches ----
const grants = (subclass, level) => classSpellGrants({ classId: "cleric", level, subclass, features: [] });
assert.deepEqual([grants("Nature Domain", 1).extraCantrips, grants("Nature Domain", 1).anyList], [1, 1], "Acolyte of Nature: one druid cantrip");
assert.deepEqual([grants("Arcana Domain", 1).extraCantrips, grants("Arcana Domain", 1).anyList], [2, 2], "Arcane Initiate: two wizard cantrips");
assert.deepEqual([grants("Death Domain", 1).extraCantrips, grants("Death Domain", 1).anyList], [1, 1], "Reaper: a necromancy cantrip");
const mastery = grants("Arcana Domain", 17);
assert.deepEqual([mastery.anyList, mastery.extraSpells, mastery.anyListSpells], [6, 4, true], "Arcane Mastery: four wizard spells on top of the two cantrips");
assert.equal(grants("Arcana Domain", 16).extraSpells, 0, "Arcane Mastery arrives at 17th level");
assert.equal(grants("Life Domain", 20).anyList, 0, "a Life cleric learns nothing off the list");
assert.equal(classSpellGrants({ classId: "cleric", level: 1, subclass: "", features: [{ name: "Reaper" }] }).extraCantrips, 1, "a workshop domain that borrows Reaper by name");

console.log("test-cleric-domain-logic: ok");
