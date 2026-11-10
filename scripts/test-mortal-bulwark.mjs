// Mortal Bulwark (XGtE, Oath of the Watchers 20) on a hit, through pc_attack
// (src/lib/dm/mortal-bulwark.ts): "When you hit a creature with an attack and
// deal damage to it, you can also force it to make a Charisma saving throw
// against your spell save DC. On a failed save, the creature is magically
// banished to its native plane of existence if it isn't there already. On a
// successful save, the creature can't be banished by this feature for 24
// hours." Only the five types the feature names; and its truesight to 120
// feet (src/lib/dm/attack-light.ts characterSenses).
import { assert, openClauseRig } from "./lib/sweep-clauses-divine.mjs";

const rig = await openClauseRig();
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    rig.close();
    throw error;
  }
}

// What one swing asked: the saving throws it recorded, and the creature after.
async function swing(who, foe, faces) {
  const before = new Set(rig.lastRolls(40).map((roll) => roll.id));
  const out = await rig.kit.swing(who.id, foe.id, faces);
  const saves = rig.lastRolls(40).filter((roll) => !before.has(roll.id) && roll.kind === "saving_throw");
  return { out, saves, after: rig.enemy(foe.id) };
}

// A 20th-level Watchers paladin (Charisma 20, proficiency +6: spell save DC
// 19) beside a creature of `type`, Mortal Bulwark spent or not.
async function scene(type, bulwark = true) {
  rig.reset("mortal bulwark");
  const who = rig.hero("paladin", "Oath of the Watchers", 20);
  const [foe] = await rig.fight(who);
  if (type) rig.kit.setEnemy(foe.id, { stats: { type } });
  if (bulwark) {
    const spent = await rig.spend(who, "Mortal Bulwark");
    assert.equal(spent.ok, true, spent.error);
  }
  return { who, foe };
}

const light = await rig.load("lib/dm/attack-light.ts");

await test("while it runs the paladin has truesight to 120 feet, and none before", async () => {
  rig.reset("truesight");
  const who = rig.hero("paladin", "Oath of the Watchers", 20);
  await rig.fight(who);
  assert.equal(light.characterSenses(rig.world.sheet(who.id)).truesight, 0);
  await rig.spend(who, "Mortal Bulwark");
  assert.equal(light.characterSenses(rig.world.sheet(who.id)).truesight * 5, 120);
});

await test("a fiend that fails its Charisma save against DC 19 is banished out of the fight", async () => {
  const { who, foe } = await scene("fiend");
  const { out, saves, after } = await swing(who, foe, [15, 15, 4, 4, 1]);
  assert.equal(out.ok, true, out.error);
  assert.equal(saves.length, 1, "one Charisma save");
  assert.equal(saves[0].dc, 19);
  assert.match(saves[0].detail, /CHA save against .*Mortal Bulwark/);
  assert.equal(after.status, "fled");
  assert.ok((out.result.subclassFeatures ?? []).some((line) => /home plane/.test(line)), JSON.stringify(out.result.subclassFeatures));
});

await test("a fey that makes the save stays, and this paladin's Mortal Bulwark cannot banish it for 24 hours", async () => {
  const { who, foe } = await scene("fey");
  const first = await swing(who, foe, [15, 15, 4, 4, 20]);
  assert.equal(first.saves.length, 1);
  assert.equal(first.after.status, "alive");
  assert.ok(first.after.conditions.includes("withstood mortal bulwark"), JSON.stringify(first.after.conditions));
  assert.deepEqual(first.after.conditionMeta["withstood mortal bulwark"], { source: who.id, rounds: 14400 });
  rig.kit.freshTurn();
  const again = await swing(who, foe, [15, 15, 4, 4, 1]);
  assert.equal(again.out.ok, true, again.out.error);
  assert.equal(again.saves.length, 0, "no second save against the same paladin");
  assert.equal(again.after.status, "alive");
});

await test("a creature of another type is asked nothing", async () => {
  const { who, foe } = await scene("humanoid");
  const { out, saves, after } = await swing(who, foe, [15, 4, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(saves.length, 0);
  assert.equal(after.status, "alive");
});

await test("without Mortal Bulwark running a hit on a fiend asks nothing", async () => {
  const { who, foe } = await scene("fiend", false);
  const { out, saves, after } = await swing(who, foe, [15, 4, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(saves.length, 0);
  assert.equal(after.status, "alive");
});

rig.close();
console.log(`test-mortal-bulwark: ${passed} passed`);
