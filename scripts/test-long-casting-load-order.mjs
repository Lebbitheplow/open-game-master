// A route that reaches long-casting.ts before cast-guard.ts loads (the
// encounter route, whose first import is finishCastingsAtFightEnd) threw as
// it loaded: long-casting.ts's own imports come round to cast-guard.ts, which
// registers the cast door while long-casting.ts has not yet run its body,
// and the `let` that held the door could not be written yet ("Cannot access
// 'completion' before initialization"). A `next build` worker that collected
// that route first failed the build, and a server whose first request went
// to it would have failed it the same way. The order is the test, so the
// route is the first app module loaded here: enforce-world.mjs only points
// the database at a scratch folder, and node:assert reaches no app module.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";

const route = await import("../src/app/api/campaigns/[campaignId]/encounter/route.ts");
assert.equal(typeof route.GET, "function", "the encounter route loaded");

// The door cast-guard.ts registered while long-casting.ts was still loading
// is the one a held casting completes through: after ten rounds the spell
// takes effect and only then spends its slot (test-enforce-srd-spells.mjs
// SPL-10 walks the same rounds in the usual load order).
const { caster, closeTables, table } = await import("./lib/enforce-spell-kit.mjs");
const { handOnDue } = await import("./lib/enforce-zones.mjs");
const { nextTurn } = await import("./lib/enforce-spell-tail.mjs");
const { listMessagesBefore } = await import("../src/lib/db/messages.ts");

const SAGE = caster("wizard", "int", ["Identify", "Magic Missile"], [], 5, { equipment: [{ name: "Pearl", qty: 1, worth: 100 }] });
const slotsUsed = (world, id) => world.sheet(id).spellcasting.slots["1"].used;

const { world, sheets: [mage] } = await table([SAGE]);
const before = slotsUsed(world, mage.id);
const begun = await world.invokeAsIs("use_spell_slot", { characterId: mage.id, spell: "Identify", level: 1 });
assert.equal(begun.ok, true, begun.error);
for (let round = 1; round <= 10; round += 1) {
  nextTurn(world);
  handOnDue(world);
}
assert.equal(slotsUsed(world, mage.id), before + 1, "the slot was not spent as the spell took effect");
const lines = listMessagesBefore(world.campaignId, null, 8).messages.map((entry) => entry.content).join(" ");
assert.match(lines, /finishes casting Identify: it takes effect now/, "the casting did not complete through the cast door");
closeTables();
console.log("the encounter route loads first, and a held casting still completes through the cast door");
