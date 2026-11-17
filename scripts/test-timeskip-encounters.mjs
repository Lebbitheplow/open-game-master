// Something finding the party while time passes over it (world-tick-logic.ts
// timeskipDisturbance): a long rest, a long wait and a journey each roll
// their four-hour stretches, the narrator gets the note in the same tool
// result, and a journey of days stops at the night or the leg it happened.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-timeskip-encounters");
const world = await openWorld({ gameSettings: { ttsEnabled: false, worldSimulation: true } });
const quiet = await openWorld({ gameSettings: { ttsEnabled: false, worldSimulation: false } });
world.addHero({ class: "fighter", level: 3, maxHp: 30 });
quiet.addHero({ class: "fighter", level: 3, maxHp: 30 });

// The hours roll Math.random; pinned for one call so the result is known.
async function rolled(value, run) {
  const real = Math.random;
  Math.random = () => value;
  try {
    const out = await run();
    return out?.result ?? out;
  } finally {
    Math.random = real;
  }
}

await test("a long rest whose night rolls an encounter says so in its result; a quiet night says nothing", async () => {
  const found = await rolled(0, () => world.invoke("take_rest", { kind: "long" }));
  assert.equal(found.ok, true, JSON.stringify(found).slice(0, 300));
  assert.match(String(found.disturbed), /While the party rested/);
  const calm = await rolled(0.999, () => world.invoke("pass_time", { amount: 1, unit: "days" }).then(() => world.invoke("take_rest", { kind: "long" })));
  assert.equal(calm.ok, true);
  assert.equal(calm.disturbed, undefined);
});

await test("a short rest rolls nothing: an hour is not a stretch", async () => {
  const short = await rolled(0, () => world.invoke("take_rest", { kind: "short" }));
  assert.equal(short.disturbed, undefined);
});

await test("a long wait rolls its stretches; a short one does not", async () => {
  const long = await rolled(0, () => world.invoke("pass_time", { amount: 8, unit: "hours" }));
  assert.match(String(long.disturbed), /While the party waited/);
  const brief = await rolled(0, () => world.invoke("pass_time", { amount: 2, unit: "hours" }));
  assert.equal(brief.disturbed, undefined);
});

await test("a journey of days stops where something found the party", async () => {
  const trip = await rolled(0, () => world.invoke("travel", { days: 3 }));
  assert.equal(trip.ok, true, JSON.stringify(trip).slice(0, 300));
  assert.match(String(trip.disturbed), /On the road/);
  assert.equal(trip.days, 1, "the first day's road found them: the journey stopped there");
  assert.match(trip.note, /journey stopped after 1 of 3 days/);
  const calm = await rolled(0.999, () => world.invoke("travel", { days: 2 }));
  assert.equal(calm.days, 2);
  assert.equal(calm.disturbed, undefined);
});

await test("without the living world, time passes quietly as before", async () => {
  const night = await rolled(0, () => quiet.invoke("take_rest", { kind: "long" }));
  assert.equal(night.ok, true);
  assert.equal(night.disturbed, undefined);
});

finish();
