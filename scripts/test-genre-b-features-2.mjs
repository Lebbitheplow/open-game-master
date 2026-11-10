// The mystery, post-apocalyptic and steampunk classes' features, second suite
// (WAVE2 D5): the shared mechanisms built for the handoff of the first pass.
// Each case fails without its mechanism; the clause ledgers
// (scripts/clauses/genre-*.json) point here for the clauses they hold.
//
//   auras        src/lib/dm/genre-b-auras.ts (saves through forced-save.ts
//                rollExtrasFor, AC through ac-effects.ts acWithEffects) and
//                the aura_resist row's types (authored-saves.ts)
//
// Dice forced; every check reads a sheet, a roll's total or a refusal.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice, diceLog } from "./lib/enforce-world.mjs";

const SRC = new URL("../src/", import.meta.url);
const { acWithEffects } = await import(new URL("lib/dm/ac-effects.ts", SRC).href);

const { test, finish } = suite("test-genre-b-features-2");
const rig = await clausesRig();
const { world, kit, ally } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};

// The ally's WIS save against fear on an 11: its total, and how many d20s it threw.
async function allyFearSave(faces = [11, 3]) {
  clearDice();
  diceLog();
  dice(...faces);
  const out = rig.must(await world.invoke("request_roll", { characterId: ally.id, kind: "saving_throw", ability: "wis", against: "frightened", dc: 10, reason: "test" }), "request_roll");
  const d20s = diceLog().filter((die) => die.sides === 20).length;
  clearDice();
  return { total: out.total, d20s };
}

// The holder beside the ally (the rig's fight puts them adjacent), then 50 feet off.
async function nearThenFar(hero, read) {
  await rig.fight(hero);
  const near = await read();
  kit.place(hero.id, 15, 12);
  const far = await read();
  return { near, far };
}

// ---- auras ----

for (const [classId, name, level] of [["alienist", "Steadying Presence", 5], ["road_warrior", "Fear No Rust", 6]]) {
  await run(`${name}: an ally within 10 ft adds +1d4 to a save against fear, and one 50 ft off does not`, async () => {
    const hero = rig.holder(feature(classId, name, level));
    const { near, far } = await nearThenFar(hero, () => allyFearSave());
    // WIS 16 (+3), the fighter untrained in WIS saves: 11 + 3, and the d4's 3.
    assert.equal(near.total, 17, `beside the holder the save totalled ${near.total}`);
    assert.equal(far.total, 14, `50 ft off the save totalled ${far.total}`);
  });
}

await run("Steadying Presence: the die rides only a save against fear", async () => {
  const hero = rig.holder(feature("alienist", "Steadying Presence", 5));
  await rig.fight(hero);
  clearDice();
  dice(11, 3);
  const out = rig.must(await world.invoke("request_roll", { characterId: ally.id, kind: "saving_throw", ability: "dex", against: "poisoned", dc: 10, reason: "test" }), "request_roll");
  clearDice();
  assert.equal(out.total, 14, `a save against poison totalled ${out.total}`);
});

await run("Fear No Rust: an unconscious road warrior steadies nobody", async () => {
  const hero = rig.holder(feature("road_warrior", "Fear No Rust", 6));
  await rig.fight(hero);
  world.patch(hero.id, { currentHp: 0 });
  const { total } = await allyFearSave();
  assert.equal(total, 14, `with the road warrior down the save totalled ${total}`);
});

await run("Group Therapy: Steadying Presence reaches 30 ft", async () => {
  const hero = rig.holder(feature("alienist", "Group Therapy", 15));
  await rig.fight(hero);
  kit.place(hero.id, 5, 8);
  const { total } = await allyFearSave();
  assert.equal(total, 17, `25 ft off the save totalled ${total}`);
  kit.place(hero.id, 5, 12);
  assert.equal((await allyFearSave()).total, 14, "45 ft off the die still rode");
});

await run("Walk Through the Valley: allies within 10 ft resist necrotic and save against fear with advantage", async () => {
  const hero = rig.holder(feature("waste_preacher", "Walk Through the Valley", 15));
  const { near, far } = await nearThenFar(hero, async () => ({ save: (await allyFearSave([11, 11])).d20s, lost: await rig.damageLost(ally, "necrotic") }));
  assert.deepEqual(near, { save: 2, lost: 10 }, `beside the preacher: ${JSON.stringify(near)}`);
  assert.deepEqual(far, { save: 1, lost: 20 }, `50 ft off: ${JSON.stringify(far)}`);
});

// The ally's AC as an attack on them reads it (ac-effects.ts acWithEffects).
const allyAc = () => acWithEffects(world.campaignId, world.sheet(ally.id));

await run("Guardian's Instinct: allies within 10 ft gain +1 AC while the enforcer is conscious", async () => {
  const hero = rig.holder(feature("enforcer", "Guardian's Instinct", 15));
  await rig.fight(hero);
  const beside = allyAc();
  world.patch(hero.id, { currentHp: 0 });
  const down = allyAc();
  world.patch(hero.id, { currentHp: 100 });
  kit.place(hero.id, 15, 12);
  const far = allyAc();
  assert.deepEqual([beside - far, down], [1, far], `beside ${beside}, the enforcer down ${down}, 50 ft off ${far}`);
});

await run("Shield Coupling: an adjacent ally gains +1 AC only while the steam knight holds a shield", async () => {
  const hero = rig.holder(feature("steam_knight", "Shield Coupling", 3), { gear: "shield" });
  await rig.fight(hero);
  const adjacent = allyAc();
  kit.place(hero.id, 5, 5);
  const off = allyAc();
  kit.place(hero.id, 5, 2);
  world.patch(hero.id, { equipment: world.sheet(hero.id).equipment.filter((item) => item.name !== "Shield") });
  const bare = allyAc();
  assert.deepEqual([adjacent - off, bare], [1, off], `adjacent ${adjacent}, 10 ft off ${off}, no shield ${bare}`);
});

rig.world.close();
finish();
