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
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const revertRoute = await world.route("campaigns/[campaignId]/audit/revert-turn");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");

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
const knight2 = hero("fighter", "Rune Knight");
const bard2 = hero("bard", "College of Lore");
// A knight of their own player, whose board view measures from them.
const seer = world.addHero({
  class: "fighter", subclass: "Rune Knight", level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
  abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
});
const lucky = hero("fighter", "Champion", 5, { feats: ["Lucky"], resources: { luck_points: { max: 3, used: 0 } } });
const everyone = [cleric, knight, bard, rogue, ally, knight2, bard2, seer, lucky];

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

await test("Two Rune Knights each answer the same hit once: the second still has a card after the first, and neither answers twice.", async () => {
  const enemy = await stage();
  world.dice(16, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(hp(ally), 44);
  const first = await react(knight, "Runic Shield", ally, [15]);
  assert.equal(first.ok, true, first.error);
  assert.match(first.result.applied, /still hits/);
  assert.equal(cards(knight, "Runic Shield").length, 0, "the first knight has answered it");
  assert.equal(cards(knight2, "Runic Shield").length, 1, "the second knight still may");
  const again = await react(knight, "Runic Shield", ally, [2]);
  assert.equal(again.ok, false, "the first knight cannot answer the same hit twice");
  const second = await react(knight2, "Runic Shield", ally, [2]);
  assert.equal(second.ok, true, second.error);
  assert.equal(hp(ally), 50, "the second reroll misses");
});

await test("Two Lore bards each take Cutting Words off the same hit.", async () => {
  const enemy = await stage();
  world.dice(20, 6, 6);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(hp(ally), 36, "6 + 6 + 2, a critical");
  const first = await react(bard, "Cutting Words", ally, [3]);
  assert.equal(first.ok, true, first.error);
  assert.equal(cards(bard2, "Cutting Words").length, 1, "the second bard still has a card");
  const second = await react(bard2, "Cutting Words", ally, [4]);
  assert.equal(second.ok, true, second.error);
  assert.equal(hp(ally), 43);
  const twice = await react(bard, "Cutting Words", ally, [4]);
  assert.equal(twice.ok, false);
});

// A reaction played in a GM turn of its own, then that turn reverted.
async function reactInTurn(holder, feature, target, faces) {
  const turnId = createDmTurn(world.campaignId, [], "ai").id;
  world.dice(...faces);
  const out = await invokeEngine(world.campaign(), { kind: "ai", turnId }, { name: "use_reaction", args: { characterId: holder.id, feature, ...(target ? { targetCharacterId: target.id } : {}) } });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return turnId;
}
async function revert(turnId) {
  world.signIn(world.owner);
  const response = await revertRoute.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
}
const reacted = (who) => world.encounter().reactionsUsed.includes(who.id);

for (const { name, holder, target, faces, resource, struck } of [
  { name: "Runic Shield", holder: knight, target: ally, faces: [2], resource: "sub_runic_shield", struck: () => ally },
  { name: "Uncanny Dodge", holder: rogue, target: null, faces: [], resource: null, struck: () => rogue },
  { name: "Cutting Words", holder: bard, target: ally, faces: [3], resource: "bardic_inspiration", struck: () => ally },
]) {
  await test(`Reverting the turn that played ${name} takes back its hit points, its use and the reaction, and the hit is open to it again.`, async () => {
    const enemy = await stage();
    const victim = struck();
    world.dice(16, 4);
    await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: victim.id });
    world.clearDice();
    assert.equal(hp(victim), 44);
    const usedBefore = resource ? world.sheet(holder.id).resources[resource].used : 0;
    const turnId = await reactInTurn(holder, name, target, faces);
    assert.notEqual(hp(victim), 44, "the reaction gave something back");
    assert.ok(reacted(holder));
    await revert(turnId);
    assert.equal(hp(victim), 44, "the hit points it gave back are taken back");
    if (resource) assert.equal(world.sheet(holder.id).resources[resource].used, usedBefore, "the use is given back");
    assert.equal(reacted(holder), false, "the reaction is given back");
    assert.equal(cards(holder, name).length, 1, "the hit offers the card again");
    const again = await react(holder, name, target, faces);
    assert.equal(again.ok, true, again.error);
    assert.notEqual(hp(victim), 44);
  });
}

// A wall along row 5 between the holders above it and the ally below it.
async function walled() {
  const enemy = await stage();
  kit.openField(Array.from({ length: 12 }, (_, x) => [x, 5, "#"]));
  for (const [who, x] of [[seer, 1], [knight, 2], [bard, 3], [cleric, 4]]) kit.place(who.id, x, 3);
  kit.place(ally.id, 2, 8);
  kit.place(enemy.id, 3, 8);
  world.dice(20, 4, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(ally), 41);
  return enemy;
}

await test("Behind a wall, the reactions that need their creature seen are not dealt and are refused with nothing spent.", async () => {
  const enemy = await walled();
  const view = buildPlayerMapView(world.campaignId, seer.userId);
  assert.ok(view?.unseen?.includes(ally.id), "the board says the knight cannot see the ally");
  assert.equal(view?.feet?.[enemy.id], undefined, "nor the goblin, which the board does not show at all");
  const unseen = new Set(view.unseen);
  const dealt = (who, name) => reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets(), "you", view.feet, [], undefined, unseen).filter((card) => card.name === name);
  assert.equal(dealt(seer, "Runic Shield").length, 0, "no Runic Shield for an ally out of sight");
  assert.equal(dealt(bard, "Cutting Words").length, 0, "no Cutting Words against an attacker out of sight");
  assert.equal(dealt(cleric, "Sentinel at Death's Door").length, 0, "no Sentinel for a critical out of sight");
  for (const [who, name, faces] of [[knight, "Runic Shield", [2]], [bard, "Cutting Words", [5]], [cleric, "Sentinel at Death's Door", []]]) {
    const out = await react(who, name, ally, faces);
    assert.equal(out.ok, false, `${name} went through behind a wall`);
    assert.match(out.error, /line of sight/);
  }
  assert.equal(hp(ally), 41);
  assert.equal(world.sheet(knight.id).resources.sub_runic_shield.used, 0);
  assert.equal(world.sheet(bard.id).resources.bardic_inspiration.used, 0);
  assert.equal(world.encounter().reactionsUsed.length, 0);
});

await test("With the wall gone the same reaction is taken.", async () => {
  await walled();
  kit.openField();
  const view = buildPlayerMapView(world.campaignId, seer.userId);
  assert.equal(view?.unseen?.includes(ally.id), false);
  const out = await react(knight, "Runic Shield", ally, [2]);
  assert.equal(out.ok, true, out.error);
});

await test("Runic Shield's natural 20 makes a hit a critical, which Sentinel can turn back; a hit that kept no roll stays as it was.", async () => {
  let enemy = await stage();
  world.dice(16, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(hp(ally), 44);
  const rune = await react(knight, "Runic Shield", ally, [20, 6]);
  assert.equal(rune.ok, true, rune.error);
  assert.equal(hp(ally), 38, "4 + 6 + 2, a critical");
  assert.equal(cards(cleric, "Sentinel at Death's Door").length, 1, "a critical now, Sentinel answers it");
  const sentinel = await react(cleric, "Sentinel at Death's Door", ally);
  assert.equal(sentinel.ok, true, sentinel.error);
  assert.equal(hp(ally), 44, "back to the normal 4 + 2");

  // A record written before the roll was kept: the damage stands, and it says so.
  enemy = await stage();
  world.dice(16, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  const { openHits, writeLastHit } = await import("../src/lib/dm/last-hit.ts");
  for (const record of openHits(world.campaignId, ally.id)) {
    writeLastHit(world.campaignId, { ...record, swings: record.swings.map((swing) => { const kept = { ...swing }; delete kept.critical; return kept; }) });
  }
  const old = await react(knight, "Runic Shield", ally, [20]);
  assert.equal(old.ok, true, old.error);
  assert.match(old.result.applied, /not raised to a critical/);
  assert.equal(hp(ally), 44);
});

await test("A downed ally a ranged hit found: Runic Shield's natural 20 makes it a critical, two death-save failures.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, { stats: { ...enemy.stats, attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.place(enemy.id, 8, 12);
  world.patch(ally.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false }, conditions: ["unconscious", "prone"], conditionMeta: {} });
  world.dice(15, 3, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(world.sheet(ally.id).deathSaves.failures, 1);
  const rune = await react(knight, "Runic Shield", ally, [20, 5]);
  assert.equal(rune.ok, true, rune.error);
  assert.equal(world.sheet(ally.id).deathSaves.failures, 2, "a critical on someone at 0 is two failures");
});

// Beside the goblin: the line of heroes stage() lays out ends out of its reach.
const beside = async (who) => {
  const enemy = await stage();
  kit.place(who.id, 8, 7);
  return enemy;
};

await test("Lucky rolls a natural 20 away and it still hits: the plain 6 lands, not the critical 9, and the point is spent.", async () => {
  const enemy = await beside(lucky);
  await crit(enemy, lucky);
  assert.equal(hp(lucky), 41);
  const out = await react(lucky, "Lucky", null, [15]);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /still hits, no longer a critical: 3 hit points come back/);
  assert.equal(hp(lucky), 44);
  assert.equal(world.sheet(lucky.id).resources.luck_points.used, 1);
});

await test("Uncanny Dodge on the critical 9, then Lucky rolls the 20 away: half the plain 6.", async () => {
  const enemy = await beside(lucky);
  world.patch(lucky.id, { features: [{ name: "Uncanny Dodge", source: "class" }] });
  await crit(enemy, lucky);
  const dodge = await react(lucky, "Uncanny Dodge");
  assert.equal(dodge.ok, true, dodge.error);
  assert.equal(hp(lucky), 46);
  const out = await react(lucky, "Lucky", null, [15]);
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(lucky), 47);
  world.patch(lucky.id, { features: [] });
});

await test("Lucky rolls another 20: still the critical, and nothing comes back.", async () => {
  const enemy = await beside(lucky);
  await crit(enemy, lucky);
  const out = await react(lucky, "Lucky", null, [20]);
  assert.equal(out.ok, true, out.error);
  assert.doesNotMatch(out.result.applied, /no longer a critical/);
  assert.equal(hp(lucky), 41);
});

await test("On a routine Lucky goes to the natural 20 it can make ordinary, not a lighter swing that may miss.", async () => {
  const enemy = await beside(lucky);
  kit.setEnemy(enemy.id, { stats: { ...enemy.stats, attacks: [{ name: "Bite", toHit: 10, damage: "1d6+2", type: "piercing" }, { name: "Claw", toHit: 4, damage: "1d4", type: "slashing" }], routines: [[{ attack: "Bite", count: 1 }, { attack: "Claw", count: 1 }]] } });
  world.dice(20, 4, 3, 15, 2);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: lucky.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(lucky), 39);
  const answer = await react(lucky, "Lucky", null, [15]);
  assert.equal(answer.ok, true, answer.error);
  assert.match(answer.result.applied, /Bite rolled again/);
  assert.equal(hp(lucky), 42);
});

await test("A downed hero's Lucky on a ranged critical: one failure comes off, and the reply says so.", async () => {
  const enemy = await beside(lucky);
  kit.setEnemy(enemy.id, { stats: { ...enemy.stats, attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.place(enemy.id, 8, 13);
  world.patch(lucky.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  await crit(enemy, lucky);
  assert.equal(world.sheet(lucky.id).deathSaves.failures, 2);
  const out = await react(lucky, "Lucky", null, [15]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(lucky.id).deathSaves.failures, 1);
  assert.ok(out.result.notes?.length, "the reply carries what was taken back");
});

await test("Runic Shield's natural 20 raised the hit to a critical, then Lucky rolls that 20 away: the blow it was before.", async () => {
  const enemy = await beside(lucky);
  world.dice(16, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: lucky.id });
  world.clearDice();
  assert.equal(hp(lucky), 44);
  const rune = await react(knight, "Runic Shield", lucky, [20, 3]);
  assert.equal(rune.ok, true, rune.error);
  assert.equal(hp(lucky), 41);
  const out = await react(lucky, "Lucky", null, [15]);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /no longer a critical/);
  assert.equal(hp(lucky), 44);
});

await test("Lucky on a roll with advantage leaves the roll's dice as they were, so Shadowy Dodge still reads it as advantage.", async () => {
  const enemy = await beside(lucky);
  const { freshLastHit } = await import("../src/lib/dm/last-hit.ts");
  // Restrained: the goblin rolls with advantage, a 20 and a 5.
  world.patch(lucky.id, { conditions: ["restrained"] });
  world.dice(20, 5, 4, 3);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: lucky.id });
  world.clearDice();
  const before = freshLastHit(world.campaignId, lucky.id).swings[0];
  await react(lucky, "Lucky", null, [15]);
  const after = freshLastHit(world.campaignId, lucky.id).swings[0];
  assert.equal(before.advantage, "advantage");
  assert.deepEqual(after.faces, before.faces);
  assert.equal(after.advantage, before.advantage);
  assert.equal(after.crit, false);
  assert.equal(after.natural, 15);
});

world.close();
finish();
