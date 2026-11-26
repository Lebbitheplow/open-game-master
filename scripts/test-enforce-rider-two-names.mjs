// A mounted pair is two creatures on one token, and the table says which one
// it means (issue 1055, ruling 5): "Two names on the token, no default ...
// That includes the opportunity attack prompt as the pair rides past."
//
// SRD 5.1, Mounted Combat: "If the mount provokes an opportunity attack
// while you're on it, the attacker can target you or the mount."
//
// Before this, the card before a character's opportunity attack named the
// mount alone, and the swing was always at the mount: the creature whose
// move_token walks the pair (enemy-riders.ts). And nothing a player's page
// was sent said that one enemy rode another, so a tap on the pair's token
// could only ever mean its rider.
//
// Dice forced; every check reads the card, the two enemy rows, the board or
// what the player's page is sent.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { settleQueue } from "./lib/enforce-narrator.mjs";
import { layMap } from "./lib/enforce-spells.mjs";
import { OPEN } from "./lib/enforce-zones.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-rider-two-names");
const { listOpenPendingRolls, getPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { saveEncounter, listEnemies } = await import("../src/lib/db/encounters.ts");
const { publicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { getTokenByRef, getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { askLine, chosenOfPair, smiteChoiceLine } = await import("../src/lib/dm/opportunity-ask-logic.ts");

// A fighter beside a goblin on a wolf, on the wolf's turn, her player at the
// table. Both creatures sturdy, so what each lost can be read.
async function pair({ mounted = true, riderHp = 60, paladin = false } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const user = world.addUser("kara");
  const hero = world.addHero({
    user, name: "Kara", class: paladin ? "paladin" : "fighter", level: 5, maxHp: 80, proficiencies: TRAINED,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: paladin ? 14 : 10 },
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    ...(paladin ? { spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: [] } } : {}),
  });
  await world.beginFight([mounted ? { monster: "goblin", mount: "wolf" } : { monster: "wolf" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId) ?? null;
  const mount = mounted ? world.enemies().find((enemy) => enemy.id === rider?.ridesEnemyId) : world.enemies()[0];
  assert.ok(mount && (rider || !mounted), "setup: the fight has no rider on a mount");
  const kit = await combatKit(world);
  kit.setEnemy(mount.id, { maxHp: 60, currentHp: 60 });
  if (rider) kit.setEnemy(rider.id, { maxHp: 60, currentHp: riderHp });
  await layMap(world, OPEN(), { [hero.id]: { x: 6, y: 4 }, [(rider ?? mount).id]: { x: 5, y: 4 } });
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === mount.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [mount.id], acted: null } });
  const gone = subscribe(world.campaignId, () => {}, user.id);
  world.clearDice();
  const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/opportunity");
  const asks = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "opportunity");
  const answer = async (ask, body) => {
    world.signIn(user);
    const out = await call(route, "POST", body, { campaignId: world.campaignId, pendingRollId: ask.id });
    await settleQueue(world.campaignId);
    return out;
  };
  const hp = (enemy) => listEnemies(world.encounter().id).find((row) => row.id === enemy.id);
  const reacted = () => world.encounter().reactionsUsed.some((key) => key.includes(hero.id));
  const walk = () => world.invoke("move_token", { token: mount.id, x: 1, y: 4 });
  const at = (enemy) => {
    const token = getTokenByRef(getBattleMapForEncounter(world.encounter().id).id, enemy.id);
    return token ? [token.x, token.y] : null;
  };
  return { world, user, hero, rider, mount, asks, answer, hp, reacted, walk, at, gone };
}

await test("The card for a mount walking out of reach with a rider on its back names both, and nothing is rolled or spent before the player picks.", async () => {
  const { rider, mount, asks, hp, reacted, walk, at, gone } = await pair();
  const out = await walk();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.parked, true, `the walk took the swing for the player: ${JSON.stringify(out.result)}`);
  const [ask] = asks();
  assert.ok(ask, "no card asked Kara's player");
  assert.equal(ask.carry?.ask?.walkerId, mount.id);
  assert.deepEqual(ask.carry?.ask?.rider, { id: rider.id, name: rider.displayName }, "the card does not offer the rider");
  const line = askLine(ask.carry.ask);
  assert.ok(line.includes(rider.displayName) && line.includes(mount.displayName), `the card's words name one creature: ${line}`);
  assert.match(line, /which of them/);
  assert.deepEqual(at(mount), [5, 4], "the pair walked on before the player answered");
  assert.equal(reacted(), false);
  assert.equal(hp(rider).currentHp, 60);
  assert.equal(hp(mount).currentHp, 60);
  gone();
});

await test("Strike the rider: the swing lands on the rider alone, the reaction is spent, and the mount carries the pair on.", async () => {
  const { world, rider, mount, asks, answer, hp, reacted, walk, at, gone } = await pair();
  await walk();
  const [ask] = asks();
  assert.ok(ask, "no card asked Kara's player");
  world.dice(15, 3);
  const out = await answer(ask, { strike: true, target: rider.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.ok(hp(rider).currentHp < 60, "the rider the player named lost nothing");
  assert.equal(hp(mount).currentHp, 60, "the swing aimed at the rider hurt the mount");
  assert.equal(reacted(), true);
  assert.deepEqual(at(mount), [1, 4], "the walk did not go on after the swing");
  assert.equal(hp(rider).ridesEnemyId, mount.id, "the rider struck came off its mount");
  assert.equal(getPendingRoll(ask.id)?.carry?.ask?.target, rider.id);
  gone();
});

await test("A paladin's card offers the smite on each of the pair by name, and a smite at the rider lands on the rider alone and spends the slot.", async () => {
  const { world, hero, rider, mount, asks, answer, hp, walk, gone } = await pair({ paladin: true });
  await walk();
  const [ask] = asks();
  assert.equal(ask?.carry?.ask?.smiteSlot, 1, `the card offered no smite: ${JSON.stringify(ask?.carry?.ask)}`);
  assert.equal(smiteChoiceLine(1, rider.displayName), `Strike ${rider.displayName} and smite (1st-level slot)`);
  assert.equal(smiteChoiceLine(1), "Strike and smite (1st-level slot)", "the plain card's smite words changed");
  // 15 + 3 + 3 hits; the longsword's d8 of 3 (+3), the smite's 2d8 of 4s.
  world.dice(15, 3, 4, 4);
  const out = await answer(ask, { strike: true, smite: true, target: rider.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(60 - hp(rider).currentHp, 3 + 3 + 8, "the smite's dice did not land on the rider");
  assert.equal(hp(mount).currentHp, 60, "the smite aimed at the rider hurt the mount");
  assert.equal(world.sheet(hero.id).spellcasting.slots[1].used, 1, "the smite spent no slot");
  gone();
});

await test("Strike the mount: the swing lands on the mount alone.", async () => {
  const { world, rider, mount, asks, answer, hp, walk, gone } = await pair();
  await walk();
  const [ask] = asks();
  world.dice(15, 3);
  const out = await answer(ask, { strike: true, target: mount.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.ok(hp(mount).currentHp < 60, "the mount the player named lost nothing");
  assert.equal(hp(rider).currentHp, 60, "the swing aimed at the mount hurt the rider");
  gone();
});

await test("A Strike that names nobody (an older screen, the clock, whoever sends the card on) is at the mount, the creature whose move provoked it.", async () => {
  const { world, rider, mount, asks, answer, hp, walk, gone } = await pair();
  await walk();
  const [ask] = asks();
  world.dice(15, 3);
  const out = await answer(ask, { strike: true });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.ok(hp(mount).currentHp < 60);
  assert.equal(hp(rider).currentHp, 60);
  gone();
});

await test("Let it go on a pair's card spends nothing and hurts neither.", async () => {
  const { rider, mount, asks, answer, hp, reacted, walk, at, gone } = await pair();
  await walk();
  const [ask] = asks();
  const out = await answer(ask, { strike: false });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(reacted(), false);
  assert.equal(hp(rider).currentHp, 60);
  assert.equal(hp(mount).currentHp, 60);
  assert.deepEqual(at(mount), [1, 4]);
  gone();
});

await test("A rider struck down as the pair rides past leaves the mount walking on, on a token of its own.", async () => {
  const { world, rider, mount, asks, answer, hp, walk, at, gone } = await pair({ riderHp: 1 });
  await walk();
  const [ask] = asks();
  world.dice(15, 3);
  const out = await answer(ask, { strike: true, target: rider.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.notEqual(hp(rider).status, "alive", "the rider at 1 hit point lived through the hit");
  assert.equal(hp(mount).status, "alive");
  assert.equal(hp(mount).currentHp, 60);
  assert.deepEqual(at(mount), [1, 4], "the mount did not finish its walk");
  const tokens = listTokens(getBattleMapForEncounter(world.encounter().id).id);
  assert.ok(tokens.some((token) => token.refId === mount.id), "the mount has no token of its own after its rider fell");
  gone();
});

await test("A target that is neither of the pair is refused, and so is any target on a card that offered no rider.", async () => {
  const mounted = await pair();
  await mounted.walk();
  const [ask] = mounted.asks();
  const stranger = await mounted.answer(ask, { strike: true, target: "enemy-nobody" });
  assert.equal(stranger.status, 400, JSON.stringify(stranger.json));
  const letGo = await mounted.answer(ask, { strike: false, target: mounted.rider.id });
  assert.equal(letGo.status, 400, JSON.stringify(letGo.json));
  assert.equal(mounted.asks().length, 1, "a refused answer took the card down");
  mounted.gone();

  const alone = await pair({ mounted: false });
  await alone.walk();
  const [plain] = alone.asks();
  assert.ok(plain, "no card asked about a wolf on its own");
  assert.equal(plain.carry?.ask?.rider, undefined, "a wolf with nobody on it offers a rider");
  assert.doesNotMatch(askLine(plain.carry.ask), /which of them/);
  const named = await alone.answer(plain, { strike: true, target: alone.mount.id });
  assert.equal(named.status, 400, JSON.stringify(named.json));
  alone.gone();
});

await test("Only the rider the card offered can be chosen from it.", () => {
  const ask = { rider: { id: "r1", name: "Goblin" } };
  assert.equal(chosenOfPair(ask, "r1"), "r1");
  assert.equal(chosenOfPair(ask, "m1"), undefined);
  assert.equal(chosenOfPair(ask, undefined), undefined);
  assert.equal(chosenOfPair({}, "r1"), undefined);
});

await test("A player's page is told who rides whom, so a tap on the pair's token can offer both names; a mount kept off the board is not named.", async () => {
  const { world, rider, mount, gone } = await pair();
  const rows = (options) => publicEncounter(world.encounter(), listEnemies(world.encounter().id), options).enemies;
  const seen = rows({});
  assert.equal(seen.find((enemy) => enemy.id === rider.id)?.ridesEnemyId, mount.id, "the rider's row does not name its mount");
  assert.equal(seen.find((enemy) => enemy.id === mount.id)?.ridesEnemyId, undefined);
  const mountHidden = rows({ hiddenRefIds: [mount.id] });
  assert.equal(mountHidden.some((enemy) => enemy.id === mount.id), false);
  assert.equal(mountHidden.find((enemy) => enemy.id === rider.id)?.ridesEnemyId, undefined, "a player is told the id of a mount they cannot see");
  const gm = rows({ enemyNumbers: true, hiddenRefIds: [mount.id] });
  assert.equal(gm.find((enemy) => enemy.id === rider.id)?.ridesEnemyId, mount.id, "the GM's own page lost the link");
  gone();
});

finish();
