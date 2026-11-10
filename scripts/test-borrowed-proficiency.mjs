// A proficiency lent for a while (Channel Divinity: Knowledge of the Ages,
// "Gain proficiency with one skill or tool of your choice for 10 minutes")
// counts at the skill check and the tool check while its condition is worn,
// and not after (src/lib/srd/borrowed-proficiency.ts).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { borrowedProficiencies, BORROWED_VARIANTS } = await import("../src/lib/srd/borrowed-proficiency.ts");
const { toolProficiencyBonus } = await import("../src/lib/dm/roll-riders.ts");

const blank = { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] };

assert.deepEqual(borrowedProficiencies(["knowledge of the ages (stealth)", "blessed"]), { skills: ["stealth"], tools: [] });
assert.deepEqual(borrowedProficiencies(["Knowledge of the Ages (Thieves' Tools)"]), { skills: [], tools: ["Thieves' Tools"] });
assert.deepEqual(borrowedProficiencies(["stealth"]), { skills: [], tools: [] }, "a condition of another name lends nothing");

// Every choice the row offers lays a condition the reader reads back.
for (const [choice, condition] of Object.entries(BORROWED_VARIANTS)) {
  const read = borrowedProficiencies([condition]);
  assert.equal(read.skills.length + read.tools.length, 1, `${choice} lends nothing back`);
}

assert.equal(toolProficiencyBonus({ proficiencies: blank, conditions: [] }, "thieves' tools", 2), null);
assert.equal(toolProficiencyBonus({ proficiencies: blank, conditions: ["knowledge of the ages (thieves' tools)"] }, "thieves' tools", 2)?.bonus, 2);

console.log("test-borrowed-proficiency: ok");
