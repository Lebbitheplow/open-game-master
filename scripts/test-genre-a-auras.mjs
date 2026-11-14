// The genre classes' auras on the party's saves (src/lib/dm/genre-a-auras.ts):
// an ally within the reach on the board is lent the die or the advantage, an
// ally beyond it is not, and a holder at 0 hit points lends nothing. Fails
// without the aura reader: before it, Flinchless and Combat Calm covered the
// holder alone.
import assert from "node:assert/strict";
import { openClauseRig, must } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
// The ally's WIS save against fear: the d20s and d4s it threw.
async function allySave(scene, against = "frightened") {
  t.world.clearDice();
  t.world.diceLog();
  t.world.dice(10, 17, 3);
  must(await t.world.invoke("request_roll", { characterId: scene.ally.id, kind: "saving_throw", ability: "wis", dc: 10, against, reason: "a probe" }), "the ally's save");
  t.world.clearDice();
  const log = t.world.diceLog();
  return { d20: log.filter((die) => die.sides === 20).length, d4: log.filter((die) => die.sides === 4).length };
}

await test("Flinchless lends +1d4 to an ally 5 feet away, not one 20 feet away", async () => {
  const scene = await t.stage({ classId: "slayer", level: 9 });
  assert.equal((await allySave(scene)).d4, 1);
  t.kit.place(scene.ally.id, 9, 5);
  assert.equal((await allySave(scene)).d4, 0);
});
await test("Flinchless lends nothing to a save that is not against fear", async () => {
  const scene = await t.stage({ classId: "slayer", level: 9 });
  assert.equal((await allySave(scene, "charmed")).d4, 0);
});
await test("Combat Calm: an ally within 10 feet has advantage against being frightened; a holder at 0 hit points lends none", async () => {
  const scene = await t.stage({ classId: "trauma_doc", level: 14 });
  assert.equal((await allySave(scene)).d20, 2);
  t.world.patch(scene.holder.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
  assert.equal((await allySave(scene)).d20, 1);
});
await test("Candlelight Vigil lends its die only while the vigil burns", async () => {
  const scene = await t.stage({ classId: "exorcist", level: 3 });
  assert.equal((await allySave(scene)).d4, 0);
  must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Candlelight Vigil" }), "Candlelight Vigil");
  assert.equal((await allySave(scene)).d4, 1);
});
t.close();
console.log(`test-genre-a-auras: ${passed} passed`);
