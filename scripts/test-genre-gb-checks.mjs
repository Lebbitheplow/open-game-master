// The genre features of the horror, post-apocalyptic and steampunk classes
// that give a check advantage about a circumstance or against a kind of
// creature (cc1113 genre-b pass, GB04): each is read from what the GM's call
// names (request_roll's `about` and `creature`, src/lib/dm/roll-about.ts), and
// each case fails without its row in src/lib/srd/authored-effects-genre-gb.ts.
// The clause ledgers (scripts/clauses/genre-*.json) point here.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const { test, finish } = suite("test-genre-gb-checks");
const rig = await clausesRig();
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });

// [class, feature, level, skill, the call's field, the value that answers, a value that does not]
const CASES = [
  ["scavenger", "Trap Eye", 6, "perception", "about", "traps", "tracking"],
  ["scavenger", "Trap Eye", 6, "investigation", "about", "traps", "tracking"],
  ["scavenger", "Silent Salvage", 3, "stealth", "about", "ruins", "tracking"],
  ["road_warrior", "Reaver's Toll", 3, "intimidation", "creature", "trader", "orc"],
  ["aberrant", "Predator Senses", 3, "perception", "about", "smell", "tracking"],
  ["waste_preacher", "Shepherd's Stare", 7, "intimidation", "creature", "raider", "elf"],
  ["waste_preacher", "Shepherd's Stare", 7, "persuasion", "creature", "cultist", "elf"],
  ["aeronaut", "Sky Legs", 1, "athletics", "about", "footing", "tracking"],
  ["aeronaut", "Sky Legs", 1, "acrobatics", "about", "footing", "tracking"],
  ["aeronaut", "Corsair's Swagger", 3, "persuasion", "about", "ships", "tracking"],
  ["aeronaut", "Corsair's Swagger", 3, "intimidation", "about", "ships", "tracking"],
  ["parapsychologist", "Automatic Writing", 3, "investigation", "about", "violent_death", "tracking"],
];

for (const [classId, name, level, skill, field, yes, no] of CASES) {
  await test(`${name}: a ${skill} check with ${field} ${yes} throws two d20, with ${field} ${no} one, and without the feature one`, async () => {
    try {
      const row = feature(classId, name, level);
      const hero = rig.holder(row, { skills: [skill] });
      const roll = (value) => rig.d20sOf(hero, { kind: "skill_check", skill, [field]: value });
      const { on, off } = await rig.both(hero, row, () => roll(yes));
      assert.deepEqual([on, off], [2, 1], `with ${field} ${yes}: ${on} d20 with ${name}, ${off} without it`);
      assert.equal(await roll(no), 1, `with ${field} ${no} the check threw two d20`);
    } finally {
      rig.reset();
    }
  });
}

rig.world.close();
finish();
