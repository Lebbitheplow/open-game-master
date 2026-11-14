// The genre companions as allies with the text's stats (src/lib/dm/genre-a-summons.ts):
// the rigger's drone (AC 13, HP 5 + level; Combat Chassis' 1d8 + INT force;
// a second with Drone Swarm; AC 16, HP 15 + twice the level with Improved
// Chassis), the vermin lord's dire rat (AC 13, HP 3 x level, bite 1d6 + DEX;
// 5 x level and 2d6 with Grey Tide Rising) and King Below the Streets' four
// giant rats. Fails without them: no companion feature made any creature.
import assert from "node:assert/strict";
import { openClauseRig, must } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const spend = (scene, resource) => t.world.invoke("use_resource", { characterId: scene.holder.id, resource });
const made = (out) => out.result?.result?.summoned ?? out.result?.summoned ?? [];
const outOfFight = async () => must(await t.world.invoke("end_encounter", { outcome: "truce" }), "the truce");

await test("Drone Companion at 1st level: one drone, AC 13, 5 + level hit points, built out of a fight only", async () => {
  const scene = await t.stage({ classId: "rigger", level: 1 });
  assert.equal((await spend(scene, "Drone Companion")).ok, false, "refused in a fight");
  await outOfFight();
  const out = must(await spend(scene, "Drone Companion"), "Drone Companion");
  const drones = made(out);
  assert.equal(drones.length, 1, JSON.stringify(out).slice(0, 300));
  assert.equal(drones[0].ac, 13);
  assert.equal(drones[0].hp, "6/6");
});

await test("Drone Companion at 11th level: two drones at AC 16 and 15 + twice the level, the first with its mounted weapon", async () => {
  const scene = await t.stage({ classId: "rigger", level: 11 });
  await outOfFight();
  const out = must(await spend(scene, "Drone Companion"), "Drone Companion");
  const drones = made(out);
  assert.equal(drones.length, 2);
  assert.ok(drones.every((drone) => drone.ac === 16 && drone.hp === "37/37"), JSON.stringify(drones));
  assert.match(String(out.result?.creature ?? out.result?.result?.creature), /Mounted Weapon \+\d+ \(1d8\+\d+ force\)/);
});

await test("Drone Companion at 15th level: three drones, the primary's hit points doubled and its weapon 2d8, the others striking too (Twinned Strike) with INT (Overclocked Servos)", async () => {
  const scene = await t.stage({ classId: "rigger", level: 15 });
  await outOfFight();
  const out = must(await spend(scene, "Drone Companion"), "Drone Companion");
  const drones = made(out);
  assert.equal(drones.length, 3);
  assert.equal(drones[0].hp, "90/90");
  assert.equal(drones[1].hp, "45/45");
  const creature = String(out.result?.creature ?? out.result?.result?.creature);
  assert.match(creature, /^Drone: 90 HP, AC 16, Mounted Weapon \+\d+ \(2d8\+\d+ force\)/);
  assert.match(creature.split("; ")[1], /Mounted Weapon \+\d+ \(1d8\+\d+ force\)/);
});

await test("Favored of the Swarm: a dire rat of 3 x level hit points, 5 x level and a 2d6 bite at 11th", async () => {
  const scene = await t.stage({ classId: "vermin_lord", level: 3 });
  await outOfFight();
  assert.equal(made(must(await spend(scene, "Favored of the Swarm"), "Favored of the Swarm"))[0].hp, "9/9");
  const grown = await t.stage({ classId: "vermin_lord", level: 11 });
  await outOfFight();
  const out = must(await spend(grown, "Favored of the Swarm"), "Favored of the Swarm");
  assert.equal(made(out)[0].hp, "55/55");
  assert.match(String(out.result?.creature ?? out.result?.result?.creature), /Bite \+\d+ \(2d6\+\d+ piercing\)/);
});

await test("King Below the Streets: four giant rats, once a long rest", async () => {
  const scene = await t.stage({ classId: "vermin_lord", level: 18 });
  const out = must(await spend(scene, "dark_fantasy_king_below_the_streets"), "King Below the Streets");
  assert.equal(made(out).length, 4, JSON.stringify(out).slice(0, 300));
  assert.equal(t.world.sheet(scene.holder.id).resources.dark_fantasy_king_below_the_streets.used, 1);
});

t.close();
console.log(`test-genre-a-summons: ${passed} passed`);
