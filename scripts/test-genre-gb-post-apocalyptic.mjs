// The post-apocalyptic classes' features wired in the genre-b completeness
// pass (cc1113, ids GB..): each case fails without its mechanism, and the
// clause ledger (scripts/clauses/genre-post-apocalyptic.json) points here for
// the clauses it holds.
//
// Dice forced; every check reads what landed on a creature, a sheet or the
// turn's budget.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);

const { test, finish } = suite("test-genre-gb-post-apocalyptic");
const rig = await clausesRig();
const { world, kit } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;

const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
// The player's own move on the board, as their click sends it.
async function walk(hero, x, y) {
  world.signIn({ id: world.sheet(hero.id).userId });
  world.clearDice();
  world.dice(...new Array(20).fill(15));
  try {
    const response = await moveRoute.POST(
      new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x, y }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    assert.equal(response.status, 200, `the walk to (${x},${y}) was refused`);
  } finally {
    world.clearDice();
  }
}
// The road warrior runs 25 feet straight at the far creature, or stands beside it.
async function rammed(hero, ran) {
  const { near, far } = await rig.fight(hero);
  kit.openField();
  kit.place(far.id, 13, 6);
  kit.place(near.id, 12, 7);
  kit.place(rig.ally.id, 1, 1);
  if (ran) {
    kit.place(hero.id, 7, 6);
    await walk(hero, 12, 6);
  } else {
    kit.place(hero.id, 12, 6);
  }
  return { near, far };
}
const swing = (hero, enemy) => kit.swing(hero.id, enemy.id, [15, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3], { weapon: "Longsword" });

// ---- GB05: Gore Drift, Last Ride of the Reaver ----

await run("Gore Drift: a Ram Speed hit grants one more attack this turn, which must go to a creature other than the one rammed; a hit with no run grants none", async () => {
  const row = feature("road_warrior", "Gore Drift", 11);
  const hero = rig.holder(row);
  // Standing still, the hit is no Ram Speed hit: the Attack action's own count.
  const { far: still } = await rammed(hero, false);
  rig.myTurn(hero);
  assert.ok((await swing(hero, still)).ok);
  const base = rig.budget().attacksAllowed;
  const { near, far } = await rammed(hero, true);
  const first = await swing(hero, far);
  assert.ok(first.ok, `the Ram Speed swing: ${first.error}`);
  assert.equal(rig.budget().attacksAllowed, base + 1, `the turn holds ${rig.budget().attacksAllowed} attacks after the Ram Speed hit, ${base} without the run`);
  // Ram Speed shoved it 10 feet: it is brought back beside the road warrior.
  for (let index = 2; index <= base; index += 1) {
    kit.place(far.id, 13, 6);
    const next = await swing(hero, far);
    assert.ok(next.ok, `the Attack action's swing ${index} at the rammed creature: ${next.error}`);
  }
  kit.place(far.id, 13, 6);
  const last = await swing(hero, far);
  assert.ok(!last.ok && /Gore Drift/.test(last.error), `the drift's attack at the rammed creature: ${last.error ?? "accepted"}`);
  const elsewhere = await swing(hero, near);
  assert.ok(elsewhere.ok, `the drift's attack at another creature: ${elsewhere.error}`);
  assert.ok(!(await swing(hero, near)).ok, "one more attack than the drift's went off");
  const off = await rig.without(hero, row, async () => {
    const { far: target } = await rammed(hero, true);
    await swing(hero, target);
    return rig.budget().attacksAllowed;
  });
  assert.equal(off, base, "without Gore Drift the Ram Speed hit granted an attack");
});

await run("Last Ride of the Reaver: the spend lays a minute in which speed doubles, a Ram Speed hit rolls 4d6 more and every damage type is resisted; without the ride, none of it", async () => {
  const row = feature("road_warrior", "Last Ride of the Reaver", 15);
  const hero = rig.holder(row);
  const { far } = await rammed(hero, false);
  const { pcMoveBudget, getActiveBattleMap } = await load("lib/battlemap/view.ts");
  const speed = () => pcMoveBudget(world.campaignId, world.encounter(), getActiveBattleMap(world.campaignId), world.sheet(hero.id), kit.token(hero.id)).speed;
  const before = speed();
  assert.equal(await rig.damageLost(hero, "fire"), 20, "fire was resisted before the ride");
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Last Ride of the Reaver", reason: "test" }), "the ride");
  assert.equal(used(hero, "post_apocalyptic_last_ride_of_the_reaver"), 1, "the use was not spent");
  const meta = world.sheet(hero.id).conditionMeta?.["last ride of the reaver"];
  assert.equal(meta?.rounds, 10, `the ride's record is ${JSON.stringify(meta)}`);
  assert.equal(speed(), before * 2, `speed is ${speed()} riding, ${before} before`);
  assert.equal(await rig.damageLost(hero, "fire"), 10, "fire was not resisted riding");
  assert.equal(await rig.damageLost(hero, "slashing"), 10, "slashing was not resisted riding");
  const ride = await rammed(hero, true);
  // A new fight: the ride is laid again on the turn of the run.
  rig.world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, post_apocalyptic_last_ride_of_the_reaver: { max: 1, used: 0 } } });
  if (!world.sheet(hero.id).conditions.includes("last ride of the reaver")) rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Last Ride of the Reaver", reason: "test" }), "the ride again");
  const hit = await swing(hero, ride.far);
  assert.ok(hit.ok && hit.damage?.expression.includes("4d6"), `the Ram Speed hit riding rolled ${hit.damage?.expression ?? hit.error}`);
  rig.myTurn(hero);
  kit.place(ride.far.id, 13, 6);
  const plain = await swing(hero, ride.far);
  assert.ok(plain.ok && !plain.damage?.expression.includes("4d6"), `a hit with no run rolled ${plain.damage?.expression}`);
});

rig.world.close();
finish();
