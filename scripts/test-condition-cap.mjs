// The ten-condition cap on a creature's row drops the oldest free mark,
// never the condition just laid (src/lib/dm/condition-cap-logic.ts;
// L822-shield-lost-to-condition-cap: Shield's +5 AC was the one cut).
import assert from "node:assert/strict";

const { keptConditions, MAX_CREATURE_CONDITIONS } = await import("../src/lib/dm/condition-cap-logic.ts");

const ten = ["muddy", "singed", "ringing ears", "soaked", "ink-stained", "winded", "dusty", "chilled", "itching", "smoky"];

// A laid condition past the cap stays; the oldest free mark goes.
const shielded = keptConditions([...ten, "shielded"], { shielded: { untilTurnOf: "goblin" } });
assert.equal(shielded.length, MAX_CREATURE_CONDITIONS);
assert.ok(shielded.includes("shielded"));
assert.ok(!shielded.includes("muddy"));
// A laid condition already held is kept over newer free marks.
const held = keptConditions(["restrained", ...ten], { restrained: { spell: "Web", source: "mage" } });
assert.ok(held.includes("restrained"));
assert.ok(!held.includes("muddy"));
// Free marks alone: the newest ten stay, in their order.
assert.deepEqual(keptConditions([...ten, "late"], {}), [...ten.slice(1), "late"]);
// At or under the cap nothing moves.
assert.deepEqual(keptConditions(ten, null), ten);
console.log("ok: the cap keeps what the engine laid");
