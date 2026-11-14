// The horror classes' features wired in the genre-b completeness pass
// (cc1113, ids GB..): each case fails without its mechanism, and the clause
// ledger (scripts/clauses/genre-horror.json) points here for the clauses it
// holds.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const { characterSenses } = await load("lib/dm/attack-light.ts");

const { test, finish } = suite("test-genre-gb-horror");
const rig = await clausesRig();
const { world } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};

// ---- GB09: Light Against the Dark ----

await run("Light Against the Dark: an exorcist carrying a lit torch sees invisible and ethereal creatures within 10 feet; without a light, or without the feature, they do not", async () => {
  const row = feature("exorcist", "Light Against the Dark", 7);
  const hero = rig.holder(row);
  const sight = () => characterSenses(world.sheet(hero.id)).truesight;
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Torch", qty: 1, equipped: true }] });
  const { on, off } = await rig.both(hero, row, async () => sight());
  assert.deepEqual([on, off], [2, 0], `truesight ${on} squares with the feature and a torch, ${off} without the feature`);
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  assert.equal(sight(), 0, "with no light the exorcist saw the invisible");
});

rig.world.close();
finish();
