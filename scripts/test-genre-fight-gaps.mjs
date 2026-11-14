// The genre classes' features that come up in every fight and were still
// sentences in the GM's prompt after wave 2 (the clause ledgers,
// scripts/clauses/genre-*.json, point here for the clauses these hold).
// Each case fails without its mechanism.
//
// Dice forced; every check reads the d20s a roll threw, hit points or a
// condition.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { d20Faces } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-genre-fight-gaps");
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
const holds = (hero, name) => world.sheet(hero.id).conditions.some((entry) => entry.toLowerCase() === name);
// The advantage the enemy's attack on the hero was rolled with.
async function attackedWith(enemy, hero) {
  kit.handOnEnemies();
  kit.freshRound();
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  world.clearDice();
  world.dice(5, 5, 1);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return kit.lastRolls(60).find((roll) => roll.kind === "attack" && !before.has(roll.id))?.advantage ?? "none";
}

// ---- Death or Glory (road warrior 1) and Ride Eternal (20) ----

await run("Death or Glory: a road warrior attacks recklessly with advantage, on any melee attack, and attacks against them have advantage until their next turn", async () => {
  const hero = rig.holder(feature("road_warrior", "Death or Glory", 1));
  const { near } = await rig.fight(hero);
  const swing = await kit.swing(hero.id, near.id, [3, 15, 4], { weapon: "Longsword", reckless: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, "the reckless swing rolled one d20");
  assert.ok(holds(hero, "death or glory"), "the road warrior carries no reckless opening");
  assert.equal(await attackedWith(near, hero), "advantage", "the enemy's attack on the reckless road warrior had no advantage");
});

await run("Ride Eternal: Death or Glory still gives the road warrior advantage, and grants the enemy nothing", async () => {
  const hero = rig.holder(feature("road_warrior", "Ride Eternal", 20));
  const { near } = await rig.fight(hero);
  const swing = await kit.swing(hero.id, near.id, [3, 15, 4], { weapon: "Longsword", reckless: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, "the reckless swing rolled one d20");
  assert.notEqual(await attackedWith(near, hero), "advantage", "Ride Eternal's road warrior still opened an advantage to the enemy");
});

// ---- runs at a creature (mt-fb-charge.ts) ----

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
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
// A Longsword swing at the far creature, ran at from 25 feet off or struck
// standing beside it; the dice forced, so the two differ only by the run.
async function strike(hero, ran, faces) {
  const { far } = await rig.fight(hero);
  kit.place(far.id, 13, 6);
  if (ran) {
    kit.place(hero.id, 7, 6);
    await walk(hero, 12, 6);
  } else {
    kit.place(hero.id, 12, 6);
  }
  const swing = await kit.swing(hero.id, far.id, faces, { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  return { far: kit.enemy(far.id), lost: lost(far), swing };
}

await run("Ram Speed: a road warrior's melee hit after a 20-foot run straight at the creature deals 2d6 more and shoves it 10 feet; standing still, neither", async () => {
  const hero = rig.holder(feature("road_warrior", "Ram Speed", 7));
  const still = await strike(hero, false, [15, 4, 3, 3]);
  const ran = await strike(hero, true, [15, 4, 3, 3]);
  assert.equal(ran.lost - still.lost, 6, `the run added ${ran.lost - still.lost} damage, not the 2d6 (3 + 3)`);
  assert.equal(kit.token(ran.far.id).x, 15, `the rammed creature stands at x ${kit.token(ran.far.id).x}, not shoved 10 feet`);
});

await run("Locomotive Charge: a steam knight's hit after a 15-foot run knocks the creature prone on a failed STR save; standing still, no save", async () => {
  const hero = rig.holder(feature("steam_knight", "Locomotive Charge", 7));
  // The hit (15), the longsword (4), Piston Strike's d6 (2) and, after a run,
  // the creature's STR save (1). Without the save's face the save was thrown
  // unseeded, and the creature held about half the time.
  const still = await strike(hero, false, [15, 4, 2, 1]);
  assert.ok(!still.far.conditions.includes("prone"), "a hit with no run knocked the creature prone");
  const ran = await strike(hero, true, [15, 4, 2, 1]);
  assert.ok(ran.far.conditions.includes("prone"), `${JSON.stringify(ran.swing).slice(0, 1500)} the charged creature carries ${JSON.stringify(ran.far.conditions)}, not prone`);
});

await run("Daring Maneuver: an aeronaut's hit after a 15-foot run deals 1d6 more, once a turn; standing still, nothing", async () => {
  const hero = rig.holder(feature("aeronaut", "Daring Maneuver", 1));
  const still = await strike(hero, false, [15, 4, 5]);
  const ran = await strike(hero, true, [15, 4, 5]);
  assert.equal(ran.lost - still.lost, 5, `the run added ${ran.lost - still.lost} damage, not the 1d6 (5)`);
});

await run("Greater Daring: at 11th level the aeronaut's Daring Maneuver after a run deals 2d6 more", async () => {
  const hero = rig.holder(feature("aeronaut", "Greater Daring", 11));
  const still = await strike(hero, false, [15, 4, 5, 5]);
  const ran = await strike(hero, true, [15, 4, 5, 5]);
  assert.equal(ran.lost - still.lost, 10, `the run added ${ran.lost - still.lost} damage, not the 2d6 (5 + 5)`);
});

// ---- Blessed Ammunition (witch hunter, Order of the Silver Flame 3) ----

await run("Blessed Ammunition: a witch hunter's pistol shot passes a werewolf's immunity to nonmagical blows that aren't silvered; without it, nothing lands", async () => {
  const row = feature("witch_hunter", "Blessed Ammunition", 3);
  const hero = rig.holder(row, { gear: "firearm" });
  const shoot = async () => {
    const { far } = await rig.fight(hero);
    kit.setEnemy(far.id, { stats: { ...kit.enemy(far.id).stats, immune: "bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered" } });
    kit.place(hero.id, 12, 2);
    const swing = await kit.swing(hero.id, far.id, [15, 6], { weapon: "Pistol" });
    assert.equal(swing.ok, true, swing.error);
    return lost(far);
  };
  const { on, off } = await rig.both(hero, row, shoot);
  assert.equal(off, 0, "a plain pistol shot hurt the werewolf");
  assert.ok(on > 0, "the blessed shot did not pass the werewolf's immunity");
});

rig.world.close();
finish();
