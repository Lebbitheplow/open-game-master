// The limited-use reactions a hit calls for worked when named, and their cards sat
// in the Hand on the holder's own turn and never came up when the hit did. Each is
// now a card when a hit comes, played as the card sends it, and none on their turn.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-hit-reaction-cards");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { intentRefusal } = await import("../src/lib/dm/intent-check.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

const hero = (extra) =>
  world.addHero({
    user: world.owner, level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 },
    portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    ...extra,
  });
const friend = hero({ class: "fighter", subclass: "Champion" });

async function stage(who, hp = 50) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [who.id]: 3, [friend.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(who.id, 5, 5);
  kit.place(friend.id, 4, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  world.patch(who.id, { currentHp: hp, conditions: [], conditionMeta: {} });
  world.patch(friend.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  return enemy;
}
const strike = async (enemy, target) => {
  world.dice(16, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const offered = (who, name, feet) =>
  reactionCards(
    world.sheet(who.id),
    { ...FRESH_TURN, myTurn: false },
    activePublicEncounter(world.campaignId)?.lastHits ?? [],
    // As the Hand passes it: every sheet, the holder among them.
    world.sheets(),
    "you",
    feet,
  ).filter((card) => card.name === name);
// The board's distances from the holder to each hero, as PlayerMapView.feet
// measures them for the Hand (view.ts): tilesApart on the stored tokens.
const { tilesApart } = await import("../src/lib/dm/board-reach.ts");
const feetFrom = (who) => {
  const me = kit.token(who.id);
  return Object.fromEntries(world.sheets().filter((sheet) => sheet.id !== who.id && kit.token(sheet.id)).map((sheet) => [sheet.id, tilesApart(me, kit.token(sheet.id)) * 5]));
};
const play = (who, card) =>
  world.invoke("use_reaction", { characterId: who.id, feature: card.intent.feature, ...(card.intent.hit ? { hit: card.intent.hit } : {}), ...(card.answers?.characterId && card.answers.characterId !== who.id ? { targetCharacterId: card.answers.characterId } : {}) });
const onOwnTurn = (who, name) => deriveHand(world.sheet(who.id), FRESH_TURN, {}).some((card) => card.name === name);

const CARDS = [
  ["Swarming Dispersal", { class: "ranger", subclass: "Swarmkeeper" }, "sub_swarming_dispersal"],
  ["Warding Maneuver", { class: "fighter", subclass: "Cavalier" }, "sub_warding_maneuver"],
];
for (const [name, build, counter] of CARDS) {
  const who = hero(build);
  await test(`${name}: no card before a hit or on the holder's turn, a card when hit, and the card works.`, async () => {
    const enemy = await stage(who);
    assert.equal(onOwnTurn(who, name), false, "own turn");
    assert.equal(offered(who, name).length, 0, "no hit yet");
    await strike(enemy, who);
    const [card] = offered(who, name);
    assert.ok(card, "the hit offers it");
    assert.equal(card.disabled, null);
    const out = await play(who, card);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(who.id).resources[counter].used, 1);
    assert.equal(offered(who, name).length, 0, "the hit is answered");
    world.patch(who.id, { resources: { ...world.sheet(who.id).resources, [counter]: { ...world.sheet(who.id).resources[counter], used: world.sheet(who.id).resources[counter].max } } });
    assert.equal(offered(who, name).length, 0, "no use left");
    world.patch(who.id, { resources: { ...world.sheet(who.id).resources, [counter]: { ...world.sheet(who.id).resources[counter], used: 0 } } });
  });
}

await test("Lucky comes up on a hit against its holder, costs no reaction, stays open once the reaction is spent, and plays.", async () => {
  const rogue = hero({ class: "rogue", feats: ["Lucky"] });
  const enemy = await stage(rogue);
  assert.equal(offered(rogue, "Lucky").length, 0, "no hit yet");
  await strike(enemy, rogue);
  const dodge = await play(rogue, offered(rogue, "Uncanny Dodge")[0]);
  assert.equal(dodge.ok, true, dodge.error);
  const [card] = reactionCards(world.sheet(rogue.id), { ...FRESH_TURN, myTurn: false, reactionUsed: true }, activePublicEncounter(world.campaignId)?.lastHits ?? [], world.sheets(), "you").filter((entry) => entry.name === "Lucky");
  assert.ok(card, "the hit offers Lucky");
  assert.equal(card.cost, "free");
  assert.equal(card.disabled, null, "a spent reaction does not bar it");
  assert.equal(intentRefusal(getCampaignById(world.campaignId), world.sheet(rogue.id), card.intent), null, "nor does the card's own check, as the Hand plays it");
  world.dice(2);
  const out = await play(rogue, card);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(rogue.id).resources.luck_points.used, 1);
  assert.equal(offered(rogue, "Lucky").length, 0, "the hit is answered");
});

await test("A hit on the holder deals one card, not one more as their own ally.", async () => {
  const cavalier = hero({ class: "fighter", subclass: "Cavalier" });
  const enemy = await stage(cavalier);
  await strike(enemy, cavalier);
  assert.equal(offered(cavalier, "Warding Maneuver").length, 1);
});

// "A reaction on taking damage": the damage on record, a hit's or a save's
// (src/lib/dm/last-save.ts keeps what a creature dealt through a save), so the
// card waits for it and never sits open on the warlock's own turn.
await test("Misty Escape comes up on a hit and has no card with nothing to answer.", async () => {
  const fey = hero({ class: "warlock", subclass: "The Archfey" });
  const enemy = await stage(fey);
  assert.equal(onOwnTurn(fey, "Misty Escape"), false);
  await strike(enemy, fey);
  const [card] = offered(fey, "Misty Escape");
  assert.ok(card);
  const out = await play(fey, card);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(fey.id).conditions.includes("invisible"), true);
});

await test("Stone's Endurance, a race trait, comes up on a hit, and takes the blow.", async () => {
  const goliath = hero({ class: "fighter", race: "Goliath" });
  assert.ok(world.sheet(goliath.id).resources.race_stones_endurance);
  const enemy = await stage(goliath);
  assert.equal(onOwnTurn(goliath, "Stone's Endurance"), false);
  await strike(enemy, goliath);
  const hurt = world.sheet(goliath.id).currentHp;
  const [card] = offered(goliath, "Stone's Endurance");
  assert.ok(card);
  const out = await play(goliath, card);
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(goliath.id).currentHp > hurt);
});

await test("A reaction that acts on the hit is open to a holder that hit dropped, and not to the dead.", async () => {
  const swarm = hero({ class: "ranger", subclass: "Swarmkeeper" });
  const enemy = await stage(swarm, 1);
  await strike(enemy, swarm);
  assert.equal(world.sheet(swarm.id).currentHp, 0);
  const [card] = offered(swarm, "Swarming Dispersal");
  assert.equal(card?.disabled, null);
  world.patch(swarm.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  assert.equal(offered(swarm, "Swarming Dispersal").length, 0);
  world.patch(swarm.id, { deathSaves: null, currentHp: 50, conditions: [], conditionMeta: {} });
});

await test("Warding Maneuver comes up for an ally's hit, and Swarming Dispersal does not.", async () => {
  const cavalier = hero({ class: "fighter", subclass: "Cavalier" });
  const swarm = hero({ class: "ranger", subclass: "Swarmkeeper" });
  const enemy = await stage(cavalier);
  kit.place(swarm.id, 3, 3);
  await strike(enemy, friend);
  const [card] = offered(cavalier, "Warding Maneuver");
  assert.ok(card);
  const out = await play(cavalier, card);
  assert.equal(out.ok, true, out.error);
  // 6 from the club: turned aside if the 1d8 beats it, halved if it still hits.
  assert.ok(world.sheet(friend.id).currentHp >= 47, String(world.sheet(friend.id).currentHp));
  assert.equal(offered(swarm, "Swarming Dispersal").length, 0);
});

await test("One with the Word comes up only while the Manifest Mind is out.", async () => {
  const scribe = hero({ class: "wizard", subclass: "Order of Scribes" });
  const enemy = await stage(scribe);
  assert.equal(onOwnTurn(scribe, "One with the Word"), false);
  await strike(enemy, scribe);
  assert.equal(offered(scribe, "One with the Word").length, 0);
  world.patch(scribe.id, { conditions: ["manifest mind"], conditionMeta: { "manifest mind": { rounds: 100 } } });
  assert.equal(offered(scribe, "One with the Word").length, 1);
});

for (const [name, build, counter] of [
  ["Necrotic Husk", { class: "warlock", subclass: "The Undead" }, "sub_necrotic_husk"],
  ["Strength before Death", { class: "fighter", subclass: "Samurai" }, "sub_strength_before_death"],
]) {
  const who = hero(build);
  await test(`${name} comes up only for the hit that drops the holder, open to them at 0.`, async () => {
    const enemy = await stage(who);
    assert.equal(onOwnTurn(who, name), false, "own turn");
    await strike(enemy, who);
    assert.equal(offered(who, name).length, 0, "still standing");
    const again = await stage(who, 1);
    await strike(again, who);
    assert.equal(world.sheet(who.id).currentHp, 0);
    const [card] = offered(who, name);
    assert.ok(card, "the fall offers it");
    assert.equal(card.disabled, null);
    // The actions route asks the card first (intent-check.ts), as the engine
    // would: open to the hero at 0, not refused for being down.
    assert.equal(intentRefusal(getCampaignById(world.campaignId), world.sheet(who.id), card.intent), null);
    const out = await play(who, card);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(who.id).resources[counter].used, 1);
    world.patch(who.id, { resources: { ...world.sheet(who.id).resources, [counter]: { ...world.sheet(who.id).resources[counter], used: 0 } }, deathSaves: null, conditions: [], conditionMeta: {}, exhaustion: 0 });
  });
}

await test("A holder stunned before the hit that dropped them gets the card shut, as the engine refuses it.", async () => {
  const husk = hero({ class: "warlock", subclass: "The Undead" });
  const enemy = await stage(husk, 1);
  world.patch(husk.id, { conditions: ["stunned"], conditionMeta: { stunned: { rounds: 10 } } });
  // Advantage against the stunned: two d20s.
  world.dice(16, 16, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: husk.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(husk.id).currentHp, 0);
  const [card] = offered(husk, "Necrotic Husk");
  assert.match(card?.disabled ?? "", /stunned/);
  assert.match(intentRefusal(getCampaignById(world.campaignId), world.sheet(husk.id), card.intent) ?? "", /stunned/);
  const played = await play(husk, card);
  assert.equal(played.ok, false);
  assert.equal(world.sheet(husk.id).resources.sub_necrotic_husk.used, 0);
});

await test("A blow that finds the holder already down offers no card for the fall, which the engine refuses.", async () => {
  const husk = hero({ class: "warlock", subclass: "The Undead" });
  const enemy = await stage(husk, 1);
  await strike(enemy, husk);
  assert.equal(world.sheet(husk.id).currentHp, 0);
  // Down and within 5 feet: advantage, and a critical. The open hit is now
  // this one, which did not drop them.
  kit.freshRound();
  world.dice(16, 16, 4, 4);
  const again = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: husk.id });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
  const open = (activePublicEncounter(world.campaignId)?.lastHits ?? []).filter((hit) => hit.characterId === husk.id);
  assert.ok(open.length >= 1 && open.every((hit) => hit.stood && !hit.stood.up), JSON.stringify(open.map((hit) => hit.stood)));
  assert.equal(offered(husk, "Necrotic Husk").length, 0);
  const refused = await world.invoke("use_reaction", { characterId: husk.id, feature: "Necrotic Husk", hit: open[0].id });
  assert.equal(refused.ok, false);
  assert.equal(world.sheet(husk.id).resources.sub_necrotic_husk.used, 0);
});

await test("A hero in the order twice (an extra turn, Thief's Reflexes) still gets each open hit once, with one card.", async () => {
  const swarm = hero({ class: "ranger", subclass: "Swarmkeeper" });
  const enemy = await stage(swarm);
  await strike(enemy, swarm);
  const encounter = world.encounter();
  const own = encounter.order.find((entry) => entry.characterId === swarm.id);
  kit.saveEncounter({ ...encounter, order: [...encounter.order, { ...own, reflex: true, extra: "Strength before Death" }] });
  const hits = activePublicEncounter(world.campaignId)?.lastHits ?? [];
  assert.equal(hits.filter((hit) => hit.characterId === swarm.id).length, 1, JSON.stringify(hits.map((hit) => hit.id)));
  assert.equal(offered(swarm, "Swarming Dispersal").length, 1);
});

await test("Warding Maneuver's card for an ally beyond 5 feet is not dealt, and one without a melee weapon or shield says why.", async () => {
  const cavalier = hero({ class: "fighter", subclass: "Cavalier" });
  const enemy = await stage(cavalier);
  kit.place(friend.id, 5, 9);
  kit.place(enemy.id, 5, 10);
  await strike(enemy, friend);
  assert.equal(offered(cavalier, "Warding Maneuver", feetFrom(cavalier)).length, 0);
  kit.place(friend.id, 4, 5);
  assert.equal(offered(cavalier, "Warding Maneuver", feetFrom(cavalier))[0]?.disabled, null);
  world.patch(cavalier.id, { equipment: [] });
  assert.match(offered(cavalier, "Warding Maneuver", feetFrom(cavalier))[0]?.disabled ?? "", /melee weapon or a shield/);
  const refused = await play(cavalier, offered(cavalier, "Warding Maneuver")[0]);
  assert.equal(refused.ok, false);
});

world.close();
finish();
