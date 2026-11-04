// Reactions that change a critical (Sentinel at Death's Door, Runic Shield's
// reroll, a reroll at disadvantage) taken with others on the same blow. What a
// reaction took off the blow came off the normal or plain blow by a guess: in
// proportion for Sentinel, which left a flat cut too small (Cutting Words of 5
// on a 9 then Sentinel dealt 3 of the normal 6), and as a flat amount for a
// reroll, which left a halving too big (Uncanny Dodge then Runic Shield dealt 1
// of the plain 6). An ordinary blow (a critical only for lying at 0) lost a cut
// taken before the correction that left the target standing. Each cut is now
// kept with the swing and taken off whichever blow it becomes.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-reaction-crit-interplay");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
const { handleEnemyAttack } = await import("../src/lib/dm/enemy-attack.ts");

const hero = (classId, subclass, level = 20, more = {}) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" }, ...more,
  });
const cleric = hero("cleric", "Grave Domain");
const knight = hero("fighter", "Rune Knight");
const bard = hero("bard", "College of Lore");
const rogue = hero("rogue", "Thief", 5, { features: [{ name: "Uncanny Dodge", source: "class" }] });
const ally = hero("fighter", "Champion", 1);
const everyone = [cleric, knight, bard, rogue, ally];

async function stage(foes = 1) {
  await kit.endFight();
  await kit.fight(foes, { heroFaces: { [cleric.id]: 3 } });
  const [enemy] = world.enemies();
  for (const foe of world.enemies()) kit.setEnemy(foe.id, { maxHp: 300, currentHp: 300 });
  everyone.forEach((who, at) => kit.place(who.id, 4 + at, 5));
  kit.place(enemy.id, 8, 6);
  kit.freshRound();
  for (const who of everyone) {
    const resources = Object.fromEntries(Object.entries(world.sheet(who.id).resources).map(([id, state]) => [id, { ...state, used: 0 }]));
    world.patch(who.id, { currentHp: 50, conditions: [], conditionMeta: {}, deathSaves: null, resources });
  }
  return enemy;
}
// A club at +4, 1d6+2: a natural 20 with 4 and 3 is 9; the normal blow is 6.
const crit = async (enemy, target) => {
  world.dice(20, 4, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const react = async (holder, feature, target, faces = [], hit) => {
  if (faces.length) world.dice(...faces);
  const out = await world.invoke("use_reaction", { characterId: holder.id, feature, ...(target ? { targetCharacterId: target.id } : {}), ...(hit ? { hit } : {}) });
  world.clearDice();
  return out;
};
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
const cards = (who, name) => reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets()).filter((card) => card.name === name);
const hp = (who) => world.sheet(who.id).currentHp;

await test("Sentinel, then Runic Shield: a reroll that still hits leaves the normal hit as it is.", async () => {
  const enemy = await stage();
  await crit(enemy, ally);
  assert.equal(hp(ally), 41);
  const sentinel = await react(cleric, "Sentinel at Death's Door", ally);
  assert.equal(sentinel.ok, true, sentinel.error);
  assert.equal(hp(ally), 44);
  const rune = await react(knight, "Runic Shield", ally, [15]);
  assert.equal(rune.ok, true, rune.error);
  assert.match(rune.result.applied, /still hits/);
  assert.equal(hp(ally), 44);
});

await test("Runic Shield, then Sentinel: a critical already rolled away offers no card and spends nothing.", async () => {
  const enemy = await stage();
  await crit(enemy, ally);
  const rune = await react(knight, "Runic Shield", ally, [15]);
  assert.equal(rune.ok, true, rune.error);
  assert.equal(hp(ally), 44);
  assert.equal(cards(cleric, "Sentinel at Death's Door").length, 0);
  const sentinel = await react(cleric, "Sentinel at Death's Door", ally);
  assert.equal(sentinel.ok, false);
  assert.equal(world.sheet(cleric.id).resources.sub_sentinel_at_deaths_door.used, 0);
  assert.equal(hp(ally), 44);
});

await test("Cutting Words of 5 on the critical 9, then Sentinel: the normal 6 less the same 5.", async () => {
  const enemy = await stage();
  await crit(enemy, ally);
  const words = await react(bard, "Cutting Words", ally, [5]);
  assert.equal(words.ok, true, words.error);
  assert.equal(hp(ally), 46);
  const sentinel = await react(cleric, "Sentinel at Death's Door", ally);
  assert.equal(sentinel.ok, true, sentinel.error);
  assert.equal(hp(ally), 49);
});

await test("Uncanny Dodge on the critical 9, then Sentinel: half the normal 6.", async () => {
  const enemy = await stage();
  await crit(enemy, rogue);
  const dodge = await react(rogue, "Uncanny Dodge");
  assert.equal(dodge.ok, true, dodge.error);
  assert.equal(hp(rogue), 46);
  const sentinel = await react(cleric, "Sentinel at Death's Door", rogue);
  assert.equal(sentinel.ok, true, sentinel.error);
  assert.equal(hp(rogue), 47);
});

await test("Uncanny Dodge on the critical 9, then Runic Shield rolls the 20 away: half the plain 6.", async () => {
  const enemy = await stage();
  await crit(enemy, rogue);
  const dodge = await react(rogue, "Uncanny Dodge");
  assert.equal(dodge.ok, true, dodge.error);
  assert.equal(hp(rogue), 46);
  const rune = await react(knight, "Runic Shield", rogue, [15]);
  assert.equal(rune.ok, true, rune.error);
  assert.match(rune.result.applied, /no longer a critical/i);
  assert.equal(hp(rogue), 47);
});

await test("A critical made by lying at 0, cut by Cutting Words, then the hit that dropped them undone: the ordinary blow keeps the cut.", async () => {
  await stage(2);
  const [first, second] = world.enemies();
  kit.place(first.id, 9, 6);
  kit.place(second.id, 9, 4);
  world.patch(ally.id, { currentHp: 5 });
  const campaign = world.campaign();
  onPersonsTurn(campaign, (turn) => {
    // The first drops the ally (6 of 5); the second, beside them at 0, is a
    // critical on an 18: 4 + 3 + 2 = 9, the ordinary blow 6.
    for (const [enemy, faces] of [[first, [16, 4]], [second, [18, 2, 4, 3]]]) {
      world.dice(...faces);
      const sheets = world.sheets();
      const out = handleEnemyAttack(campaign, turn, JSON.stringify({ enemyId: enemy.id, targetCharacterId: ally.id }), sheets, new Map(sheets.map((entry) => [entry.id, entry])));
      world.clearDice();
      assert.equal(typeof out.error, "undefined", out.error);
    }
  });
  const open = hits().filter((hit) => hit.characterId === ally.id);
  const later = open.find((hit) => hit.attackerId === second.id);
  const earlier = open.find((hit) => hit.attackerId === first.id);
  const words = await react(bard, "Cutting Words", ally, [3], later.id);
  assert.equal(words.ok, true, words.error);
  const rune = await react(knight, "Runic Shield", ally, [2], earlier.id);
  assert.equal(rune.ok, true, rune.error);
  assert.equal(hp(ally), 2, "5 less the ordinary 6 less the words' 3");
});

world.close();
finish();
