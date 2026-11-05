// Issue 685: a test table's dice script, the pure rules
// (src/lib/dice-script-logic.ts). A forced face is aimed by roller, kind and
// name and spent by the first roll it fits, never on a die that cannot show
// it; a seed rolls the same faces every time and carries on from where it
// stopped; the schema holds the limits; and the script reads back in plain
// words. Pure: no database, no server.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const logic = await import("../src/lib/dice-script-logic.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { suite } = await import("./lib/enforce-harness.mjs");

const { test, finish } = suite("test-dice-script-logic");

const enemyAttack = (who) => ({ roller: "enemy", kind: "attack", sides: 20, ...(who ? { who } : {}) });

await test("a forced face is spent by the first queued roll it fits, in queue order, and others wait", () => {
  const queue = [
    { roller: "hero", kind: "death_save", face: 1 },
    { roller: "enemy", kind: "attack", face: 20 },
    { roller: "enemy", kind: "attack", face: 3 },
  ];
  assert.equal(logic.matchForced(queue, enemyAttack("Goblin 1")), 1);
  assert.equal(logic.matchForced(queue, { roller: "hero", kind: "death_save", sides: 20, who: "Ash" }), 0);
  assert.equal(logic.matchForced(queue, { roller: "hero", kind: "attack", sides: 20 }), -1);
  // A die nobody tagged takes only an "any" face.
  assert.equal(logic.matchForced(queue, { sides: 20 }), -1);
  assert.equal(logic.matchForced([{ roller: "any", kind: "any", face: 7 }], { sides: 20 }), 0);
});

await test("a face never lands on a die that cannot show it, and the d20 kinds never take a damage die", () => {
  const twenty = { roller: "any", kind: "damage", face: 20 };
  assert.equal(logic.forcedFits(twenty, { roller: "enemy", kind: "damage", sides: 8 }), false);
  assert.equal(logic.forcedFits(twenty, { roller: "enemy", kind: "damage", sides: 20 }), true);
  const nat1 = { roller: "any", kind: "any", face: 1 };
  assert.equal(logic.forcedFits(nat1, { roller: "enemy", kind: "damage", sides: 6 }), false, "an any-roll face is a d20's, never damage");
  assert.equal(logic.forcedFits(nat1, { roller: "enemy", kind: "attack", sides: 4 }), false, "a rider's d4 on an attack is not the d20");
  assert.equal(logic.forcedFits({ roller: "any", kind: "save", face: 5 }, { roller: "hero", kind: "save", sides: 20 }), true);
  assert.equal(logic.forcedFits({ roller: "any", kind: "save", face: 5 }, { roller: "hero", kind: "death_save", sides: 20 }), false, "a death save is its own kind");
});

await test("a named face takes only that creature's roll, matched whole, and a group's roll is each member's", () => {
  const aimed = { roller: "enemy", kind: "attack", face: 20, who: "Goblin 2" };
  assert.equal(logic.forcedFits(aimed, enemyAttack("Goblin 2")), true);
  assert.equal(logic.forcedFits(aimed, enemyAttack("goblin  2")), true, "case and spacing do not split one name");
  assert.equal(logic.forcedFits(aimed, enemyAttack("Goblin 1")), false);
  assert.equal(logic.forcedFits({ ...aimed, who: "Goblin" }, enemyAttack("Goblin 2")), false, "a part of a name is not the name");
  assert.equal(logic.forcedFits(aimed, enemyAttack()), false, "a roll that names nobody is not Goblin 2's");
  const init = { roller: "enemy", kind: "initiative", face: 18, who: "Goblin 3" };
  assert.equal(logic.forcedFits(init, { roller: "enemy", kind: "initiative", sides: 20, who: ["Goblin 1", "Goblin 2", "Goblin 3"] }), true);
});

await test("the seed is mulberry32: the same seed gives the same faces, and its stored state carries the sequence on", () => {
  const roll = (state, count, sides = 20) => {
    const faces = [];
    for (let index = 0; index < count; index += 1) {
      const next = logic.seededFace(state, sides);
      faces.push(next.face);
      state = next.state;
    }
    return { faces, state };
  };
  const once = roll(logic.seedState(42), 8);
  const again = roll(logic.seedState(42), 8);
  assert.deepEqual(once.faces, again.faces);
  assert.ok(once.faces.every((face) => face >= 1 && face <= 20));
  // Four, then four more from the stored state, are the same eight.
  const first = roll(logic.seedState(42), 4);
  const rest = roll(first.state, 4);
  assert.deepEqual([...first.faces, ...rest.faces], once.faces);
  assert.notDeepEqual(roll(logic.seedState(43), 8).faces, once.faces);
  // The same generator the test harness's seedDice uses (scripts/lib/enforce-world.mjs).
  assert.equal(logic.seededFace(logic.seedState(1), 20).face, 1 + Math.floor(((() => {
    let t = (1 + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  })()) * 20));
});

await test("the schema holds the limits: forty faces, d20 kinds to 20, damage to 100, a 32-bit seed, nothing unknown", () => {
  const ok = (script) => logic.diceScriptSchema.safeParse(script).success;
  assert.equal(ok({ seed: null, queue: [] }), true);
  assert.equal(ok({ seed: 4294967295, queue: [] }), true);
  assert.equal(ok({ seed: 4294967296, queue: [] }), false);
  assert.equal(ok({ seed: -1, queue: [] }), false);
  assert.equal(ok({ seed: 1.5, queue: [] }), false);
  const face = { roller: "enemy", kind: "attack", face: 20 };
  assert.equal(ok({ seed: null, queue: new Array(40).fill(face) }), true);
  assert.equal(ok({ seed: null, queue: new Array(41).fill(face) }), false);
  assert.equal(ok({ seed: null, queue: [{ ...face, face: 21 }] }), false);
  assert.equal(ok({ seed: null, queue: [{ ...face, face: 0 }] }), false);
  assert.equal(ok({ seed: null, queue: [{ roller: "hero", kind: "damage", face: 100 }] }), true);
  assert.equal(ok({ seed: null, queue: [{ roller: "hero", kind: "damage", face: 101 }] }), false);
  assert.equal(ok({ seed: null, queue: [{ ...face, roller: "ally" }] }), false);
  assert.equal(ok({ seed: null, queue: [{ ...face, kind: "parry" }] }), false);
  assert.equal(ok({ seed: null, queue: [{ ...face, extra: 1 }] }), false);
  assert.equal(ok({ seed: null, queue: [], extra: 1 }), false);
  assert.equal(ok({ seed: null, queue: [{ ...face, who: "x".repeat(81) }] }), false);
  // A blank name is no aim at all.
  assert.deepEqual(logic.diceScriptSchema.parse({ seed: null, queue: [{ ...face, who: "  " }] }).queue[0], face);
  const refused = logic.diceScriptSchema.safeParse({ seed: null, queue: [{ ...face, face: 30 }] });
  assert.match(refused.error.issues[0].message, /Only a damage die can show more than 20/);
});

await test("the script, a forced face and a spent one read in plain words", () => {
  assert.equal(logic.describeDiceScript({ seed: null, queue: [] }), "Ordinary dice: no seed and nothing forced.");
  const line = logic.describeDiceScript({
    seed: 7,
    queue: [
      { roller: "enemy", kind: "attack", face: 20, who: "Goblin 1" },
      { roller: "any", kind: "death_save", face: 1 },
      { roller: "hero", kind: "damage", face: 6 },
    ],
  });
  assert.equal(
    line,
    "Seed 7: the same dice each time the fight is played the same way. Forced next: Goblin 1's attack roll: 20; the next death save: 1; a hero's damage die: 6.",
  );
  const used = logic.usedFace({ roller: "enemy", kind: "attack", face: 20 }, enemyAttack("Goblin 1"), "2026-11-01T00:00:00.000Z");
  assert.equal(logic.describeUsed(used), "Enemy attack roll, d20 = 20 (Goblin 1)");
  assert.equal(logic.describeUsed(logic.usedFace({ roller: "any", kind: "any", face: 4 }, { sides: 20 }, "")), "A roll, d20 = 4");
});

await test("the spent list keeps the newest forty", () => {
  let used = [];
  for (let index = 0; index < 45; index += 1) {
    used = logic.withUsed(used, { roller: null, kind: null, who: null, sides: 20, face: (index % 20) + 1, at: String(index) });
  }
  assert.equal(used.length, 40);
  assert.equal(used[0].at, "5");
  assert.equal(used.at(-1).at, "44");
});

await test("a stored roll's kind becomes the script's, and a custom roll is aimed at only by any", () => {
  assert.deepEqual(logic.heroRollTag("saving_throw", "Ash"), { roller: "hero", kind: "save", who: "Ash" });
  assert.deepEqual(logic.heroRollTag("skill_check"), { roller: "hero", kind: "check" });
  assert.equal(logic.heroRollTag("custom", "Ash"), undefined);
});

await test("with no script registered, a purpose on a roll changes nothing about the dice", () => {
  // The browser bundle and a suite with no database never register the hook.
  const faces = [];
  const outcome = rollExpression("1d20+2", (sides) => {
    faces.push(sides);
    return 11;
  }, { purpose: { roller: "enemy", kind: "attack", who: "Goblin 1" } });
  assert.equal(outcome.total, 13);
  assert.deepEqual(faces, [20]);
});

finish();
