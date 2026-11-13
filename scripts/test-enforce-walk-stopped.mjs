// A walk an opportunity attack ends, on move_token. A hit that leaves the
// walker's speed at 0 (Sentinel, Hold the Line: both the pack's, not SRD
// 5.1) or drops it ends the walk on the square the swing was taken on, the
// last one inside the reach it was leaving (SRD 5.1, Opportunity Attacks:
// the attack "occurs right before the creature leaves your reach").
// move_token used to move the token the whole way before the swing, so a
// goblin a Sentinel stopped still stood at the far end with movement to
// spare, dragging whoever it held there, and the squares it never reached
// still asked their questions (test-enforce-zones.mjs holds the areas).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-walk-stopped");
const world = await openWorld({ campaign: { maxPlayers: 4 } });
const kit = await combatKit(world);

const kara = world.addHero({
  name: "Kara", class: "fighter", level: 5, maxHp: 80, proficiencies: TRAINED,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const orin = world.addHero({
  name: "Orin", class: "fighter", level: 4, maxHp: 40, proficiencies: TRAINED, feats: ["Sentinel"],
  abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
});
const ana = world.addHero({
  name: "Ana", class: "rogue", level: 3, maxHp: 30, proficiencies: TRAINED,
  abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Dagger", qty: 1, equipped: true }],
});

// One goblin (30 ft, AC 13) at (5,7); the heroes far off until a test
// stands one somewhere.
async function stage(patch = {}) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 20, [orin.id]: 18, [ana.id]: 16 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { stats: { ...DUMMY }, maxHp: 40, ...patch });
  kit.place(kara.id, 19, 0);
  kit.place(orin.id, 19, 14);
  kit.place(ana.id, 19, 7);
  kit.place(goblin.id, 5, 7);
  return kit.enemy(goblin.id);
}
const walk = (goblin, x, y, extra = {}) => world.invoke("move_token", { token: goblin.id, x, y, ...extra });
const at = (id) => {
  const token = kit.token(id);
  return token ? { x: token.x, y: token.y } : null;
};

await test("A Sentinel's hit stops the walk where the swing was taken: the token ends there, and the result says so, with no feet left.", async () => {
  const goblin = await stage();
  kit.place(orin.id, 6, 7);
  kit.dice(15, 3);
  const out = await walk(goblin, 2, 7);
  assert.equal(out.ok, true, out.error);
  assert.match(String(out.result.opportunityAttacks), /Sentinel/, JSON.stringify(out.result));
  assert.deepEqual(at(goblin.id), { x: 5, y: 7 }, "the stopped goblin walked on");
  assert.equal(out.result.at, "(5,7)");
  assert.match(out.result.note, /stopped at \(5,7\), where the opportunity attack was taken, short of \(2,7\)/);
  assert.match(out.result.movementLeft, /: 0 ft/, out.result.movementLeft);
});

await test("A walk that goes some way inside the reach first stops on the last square inside it.", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 8, 8);
  kit.place(orin.id, 6, 7);
  kit.dice(15, 3);
  const out = await walk(goblin, 2, 8);
  assert.equal(out.ok, true, out.error);
  const now = at(goblin.id);
  assert.ok(Math.max(Math.abs(now.x - 6), Math.abs(now.y - 7)) === 1, `it stopped at (${now.x},${now.y}), not on the last square in Orin's reach`);
  assert.ok(now.x < 8, "it did not move at all");
});

await test("A miss lets it walk on to where it was going.", async () => {
  const goblin = await stage();
  kit.place(orin.id, 6, 7);
  kit.dice(2);
  const out = await walk(goblin, 2, 7);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(at(goblin.id), { x: 2, y: 7 });
  assert.equal(out.result.note, undefined, JSON.stringify(out.result));
});

await test("A creature cut down as it breaks away falls where the swing was taken.", async () => {
  const goblin = await stage({ currentHp: 2 });
  kit.place(kara.id, 6, 7);
  kit.dice(15, 6);
  const out = await walk(goblin, 2, 7);
  assert.equal(out.ok, true, out.error);
  assert.notEqual(kit.enemy(goblin.id).status, "alive");
  const now = at(goblin.id);
  if (now) {
    assert.deepEqual(now, { x: 5, y: 7 }, "the body lies at the far end of a walk it never finished");
  }
  assert.match(out.result.note, /fell at \(5,7\)/);
});

await test("Whoever it drags stays with it: stopped where it began, the held character is not carried off.", async () => {
  const goblin = await stage();
  kit.place(orin.id, 6, 7);
  kit.place(ana.id, 5, 8);
  world.patch(ana.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: goblin.id } } });
  kit.dice(15, 3);
  const out = await walk(goblin, 2, 7, { drag: true });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(at(goblin.id), { x: 5, y: 7 });
  assert.deepEqual(at(ana.id), { x: 5, y: 8 }, "the held character was dragged to where the goblin never got");
  world.patch(ana.id, { conditions: [], conditionMeta: {} });
});

await finish();
