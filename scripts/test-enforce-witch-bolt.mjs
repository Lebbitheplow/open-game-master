// Witch Bolt's beam, as the table's own text gives it, restating the 2014
// Player's Handbook spell (it is not in SRD 5.1,
// src/lib/srd/authored-spells.json): "on a hit the target takes 1d12 lightning
// damage and the beam remains connected. On each of your later turns you can
// use your action to deal 1d12 lightning damage automatically. The spell ends
// if you spend your action on anything else, if the target moves more than 30
// feet away, or if it gains total cover." Only the initial damage rises with
// the slot.
import assert from "node:assert/strict";
import { clearDice, dice, openWorld } from "./lib/enforce-world.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { field } from "./lib/enforce-spell-kit.mjs";
import { nextTurn } from "./lib/enforce-spell-tail.mjs";
import { handOnDue, place } from "./lib/enforce-zones.mjs";
import { fightDummies, layMap, wizard } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-witch-bolt");
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { grantActionSurge } = await import("../src/lib/dm/turn-budget.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
const { directContextFor } = await import("../src/lib/dm/direct-context.ts");

const SPELL = "Witch Bolt";
const hero = () => wizard(5, { name: "Mage", spellcasting: { prepared: [SPELL] } });
const payload = (out) => out.result ?? out;
const nextRound = (world) => {
  nextTurn(world);
  handOnDue(world);
};
// A fight that keeps its turn budget, on an open field, the mage first in the
// order. The beam's range is 6 tiles.
async function fight(count = 1, options = {}) {
  const world = await openWorld(options);
  const mage = world.addHero(hero());
  const enemies = await fightDummies(world, count, { heroFaces: { [mage.id]: 20 } });
  const positions = { [mage.id]: { x: 2, y: 2 } };
  enemies.forEach((enemy, index) => {
    positions[enemy.id] = { x: 6 + index, y: 2 };
  });
  await layMap(world, field(20), positions);
  return { world, mage, enemies };
}
const bolt = (world, mage, enemy, faces, level) => {
  dice(...faces);
  const out = world.invoke("pc_attack", { characterId: mage.id, attacks: [{ targetEnemyId: enemy.id, spell: SPELL, ...(level ? { level } : {}) }] });
  return out.finally(clearDice);
};
const beam = (world, mage, enemy) => world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: SPELL });
const used = (world, mage, level) => world.sheet(mage.id).spellcasting.slots[String(level)].used;
const handCard = (world, mage, turn = FRESH_TURN) => deriveHand(world.sheet(mage.id), turn).find((card) => card.name === SPELL);
const played = (world, mage, enemy, slotLevel = null) => {
  const intent = { card: "spell", spell: SPELL, slotLevel, targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName };
  return directCardCalls(intent, mage.id, directContextFor(world.campaignId, intent, [], mage.id));
};
const connected = (world, enemy) => world.enemies().find((entry) => entry.id === enemy.id).conditions.includes("witch bolt");

await test("A hit connects the beam, and the next turn's action deals 1d12 automatically: no slot and no attack roll", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  const first = await bolt(world, mage, goblin, [15, 5]);
  assert.equal(payload(first).hit, true, JSON.stringify(first));
  assert.equal(used(world, mage, 1), 1);
  assert.equal(world.sheet(mage.id).concentratingOn, SPELL);
  nextRound(world);
  dice(7);
  const next = await beam(world, mage, goblin);
  clearDice();
  assert.notEqual(next.ok, false, JSON.stringify(next));
  assert.equal(payload(next).damage, 7, JSON.stringify(next));
  assert.equal(payload(next).autoHit, true);
  assert.equal(used(world, mage, 1), 1, "no slot for the beam");
  assert.equal(world.encounter().turnBudget?.actionUsed, true, "the beam takes the action");
  const again = await beam(world, mage, goblin);
  assert.equal(again.ok, false, "one action, one strike");
  nextRound(world);
  dice(3);
  const third = await beam(world, mage, goblin);
  clearDice();
  assert.equal(payload(third).damage, 3, "and again on each later turn");
  assert.equal(used(world, mage, 1), 1);
});

await test("Only the first hit rises with the slot: a level 2 casting rolls 2d12, and its beam 1d12", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  const first = await bolt(world, mage, goblin, [15, 5, 5], 2);
  assert.equal(payload(first).damage, 10, JSON.stringify(first));
  nextRound(world);
  dice(7, 7);
  const next = await beam(world, mage, goblin);
  clearDice();
  assert.equal(payload(next).damage, 7, JSON.stringify(next));
});

await test("A miss connects nothing: the spell ends and no beam follows", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  const first = await bolt(world, mage, goblin, [2]);
  assert.equal(payload(first).hit, false, JSON.stringify(first));
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null, "the spell ended on the miss");
  assert.equal(connected(world, goblin), false);
  nextRound(world);
  const next = await beam(world, mage, goblin);
  assert.equal(next.ok, false, JSON.stringify(next));
  assert.match(next.error, /pc_attack/);
});

await test("The beam strikes only what it is connected to, and nothing is spent on another creature", async () => {
  const { world, mage, enemies: [goblin, other] } = await fight(2);
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  const out = await beam(world, mage, other);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.match(out.error, /not connected/);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false);
  assert.equal(world.sheet(mage.id).concentratingOn, SPELL, "the beam still holds");
});

await test("A target more than 30 feet away ends the spell, spending nothing", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  place(world, goblin.id, 12, 2);
  const out = await beam(world, mage, goblin);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.match(out.error, /ends/);
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false);
});

await test("At exactly 30 feet the beam holds", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  place(world, goblin.id, 8, 2);
  dice(4);
  const out = await beam(world, mage, goblin);
  clearDice();
  assert.equal(payload(out).damage, 4, JSON.stringify(out));
});

await test("Total cover ends the spell, spending nothing", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  const walled = field(20).map((row) => `${row.slice(0, 4)}#${row.slice(5)}`);
  await layMap(world, walled, { [mage.id]: { x: 3, y: 2 }, [goblin.id]: { x: 5, y: 2 } });
  const out = await beam(world, mage, goblin);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.match(out.error, /total cover/);
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null);
  assert.equal(connected(world, goblin), false, "the connection ends with the spell");
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false);
});

await test("Walls at a corner do not part creatures side by side, as any spell's reach reads them", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  const rows = field(20).map((row, y) => (y === 2 ? `${row.slice(0, 4)}#${row.slice(5)}` : y === 3 ? `${row.slice(0, 3)}#${row.slice(4)}` : row));
  await layMap(world, rows, { [mage.id]: { x: 3, y: 2 }, [goblin.id]: { x: 4, y: 3 } });
  dice(4);
  const out = await beam(world, mage, goblin);
  clearDice();
  assert.equal(payload(out).damage, 4, JSON.stringify(out));
});

await test("Losing concentration takes the connection with it", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  assert.equal(connected(world, goblin), true);
  await world.invoke("clear_condition", { characterId: mage.id, condition: "concentration" });
  assert.equal(connected(world, goblin), false);
  nextRound(world);
  const out = await beam(world, mage, goblin);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(used(world, mage, 1), 1, "nothing more was spent");
});

await test("Casting it at another creature moves the beam there", async () => {
  const { world, mage, enemies: [first, second] } = await fight(2);
  await bolt(world, mage, first, [15, 5]);
  nextRound(world);
  await bolt(world, mage, second, [15, 5]);
  assert.equal(connected(world, first), false, "the first casting ended");
  assert.equal(connected(world, second), true);
  nextRound(world);
  const old = await beam(world, mage, first);
  assert.equal(old.ok, false, JSON.stringify(old));
  dice(6);
  const next = await beam(world, mage, second);
  clearDice();
  assert.equal(payload(next).damage, 6, JSON.stringify(next));
});

await test("It connects to a character fighting on the other side", async () => {
  const world = await openWorld();
  const mage = world.addHero(hero());
  const turncoat = world.addHero({ class: "fighter", level: 5, name: "Turncoat" });
  await fightDummies(world, 1, { heroFaces: { [mage.id]: 20, [turncoat.id]: 2 } });
  moveToSide(world.campaign(), turncoat.id, "foe", { quiet: true });
  await layMap(world, field(20), { [mage.id]: { x: 2, y: 2 }, [turncoat.id]: { x: 6, y: 2 } });
  const first = await bolt(world, mage, turncoat, [19, 5]);
  assert.equal(payload(first).hit, true, JSON.stringify(first));
  assert.ok(world.sheet(turncoat.id).conditions.includes("witch bolt"), "the sheet holds the connection");
  do {
    nextRound(world);
  } while (world.encounter().order[world.encounter().turnIndex]?.characterId !== mage.id);
  dice(7);
  const next = await beam(world, mage, turncoat);
  clearDice();
  assert.equal(payload(next).damage, 7, JSON.stringify(next));
  await world.invoke("clear_condition", { characterId: mage.id, condition: "concentration" });
  assert.equal(world.sheet(turncoat.id).conditions.includes("witch bolt"), false);
});

await test("With real dice the parked roll connects on a hit and ends the spell on a miss", async () => {
  const { world, mage, enemies: [goblin] } = await fight(1, { gameSettings: { dicePolicy: "real_allowed" } });
  const pendingRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  setMemberRealDice(world.campaignId, mage.userId, true);
  const answer = async (kind, faces) => {
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === kind);
    assert.ok(pending, `no ${kind} roll was parked`);
    world.signIn({ id: mage.userId });
    const out = await call(pendingRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
    assert.equal(out.status, 200, JSON.stringify(out.json));
  };
  const parked = await world.invoke("pc_attack", { characterId: mage.id, attacks: [{ targetEnemyId: goblin.id, spell: SPELL }] });
  assert.equal(parked.ok, true, parked.error);
  await answer("attack", [18]);
  assert.equal(connected(world, goblin), true, "the player's hit connects it");
  assert.equal(world.sheet(mage.id).concentratingOn, SPELL);
  await answer("damage", [5]);
  nextRound(world);
  const again = await world.invoke("pc_attack", { characterId: mage.id, attacks: [{ targetEnemyId: goblin.id, spell: SPELL }] });
  assert.equal(again.ok, true, again.error);
  await answer("attack", [2]);
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null, "the player's miss ends it");
  assert.equal(connected(world, goblin), false);
});

await test("An action spent on anything else ends the spell as the turn ends", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  const dodged = await world.invoke("take_action", { characterId: mage.id, action: "dodge" });
  assert.notEqual(dodged.ok, false, JSON.stringify(dodged));
  assert.equal(world.sheet(mage.id).concentratingOn, SPELL, "held until the turn ends");
  nextRound(world);
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null);
  assert.equal(connected(world, goblin), false);
  const out = await beam(world, mage, goblin);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.match(out.error, /pc_attack/);
});

await test("A turn that spends no action keeps the beam: only another use of the action ends it", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  nextRound(world);
  assert.equal(world.sheet(mage.id).concentratingOn, SPELL);
  dice(4);
  const out = await beam(world, mage, goblin);
  clearDice();
  assert.equal(payload(out).damage, 4, JSON.stringify(out));
});

await test("It holds the same as the round turns over on the caster's turn", async () => {
  const world = await openWorld();
  const mage = world.addHero(hero());
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [mage.id]: 2 }, enemyFace: 19 });
  await layMap(world, field(20), { [mage.id]: { x: 2, y: 2 }, [goblin.id]: { x: 6, y: 2 } });
  const myTurn = () => world.encounter().order[world.encounter().turnIndex]?.characterId === mage.id;
  while (!myTurn()) nextRound(world);
  await bolt(world, mage, goblin, [15, 5]);
  const round = world.encounter().round;
  do nextRound(world); while (!myTurn());
  assert.ok(world.encounter().round > round, "the order wrapped");
  assert.equal(world.sheet(mage.id).concentratingOn, SPELL, "the casting's own action keeps it");
  await world.invoke("take_action", { characterId: mage.id, action: "dodge" });
  do nextRound(world); while (!myTurn());
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null, "the Dodge ended it");
});

await test("Action Surge: two strikes hold, a strike and something else ends it, and something else first leaves no strike", async () => {
  const twoStrikes = await fight();
  await bolt(twoStrikes.world, twoStrikes.mage, twoStrikes.enemies[0], [15, 5]);
  nextRound(twoStrikes.world);
  await beam(twoStrikes.world, twoStrikes.mage, twoStrikes.enemies[0]);
  grantActionSurge(twoStrikes.world.campaignId, twoStrikes.world.sheet(twoStrikes.mage.id));
  const second = await beam(twoStrikes.world, twoStrikes.mage, twoStrikes.enemies[0]);
  assert.notEqual(second.ok, false, JSON.stringify(second));
  nextRound(twoStrikes.world);
  assert.equal(twoStrikes.world.sheet(twoStrikes.mage.id).concentratingOn, SPELL);

  const strikeThenDodge = await fight();
  await bolt(strikeThenDodge.world, strikeThenDodge.mage, strikeThenDodge.enemies[0], [15, 5]);
  nextRound(strikeThenDodge.world);
  await beam(strikeThenDodge.world, strikeThenDodge.mage, strikeThenDodge.enemies[0]);
  grantActionSurge(strikeThenDodge.world.campaignId, strikeThenDodge.world.sheet(strikeThenDodge.mage.id));
  await strikeThenDodge.world.invoke("take_action", { characterId: strikeThenDodge.mage.id, action: "dodge" });
  nextRound(strikeThenDodge.world);
  assert.equal(strikeThenDodge.world.sheet(strikeThenDodge.mage.id).concentratingOn ?? null, null);

  const dodgeThenStrike = await fight();
  await bolt(dodgeThenStrike.world, dodgeThenStrike.mage, dodgeThenStrike.enemies[0], [15, 5]);
  nextRound(dodgeThenStrike.world);
  await dodgeThenStrike.world.invoke("take_action", { characterId: dodgeThenStrike.mage.id, action: "dodge" });
  grantActionSurge(dodgeThenStrike.world.campaignId, dodgeThenStrike.world.sheet(dodgeThenStrike.mage.id));
  const late = await beam(dodgeThenStrike.world, dodgeThenStrike.mage, dodgeThenStrike.enemies[0]);
  assert.equal(late.ok, false, JSON.stringify(late));
  assert.match(late.error, /went on something else/);
  assert.equal(dodgeThenStrike.world.sheet(dodgeThenStrike.mage.id).concentratingOn ?? null, null);
});

await test("The Hand's card reads as a new casting until the beam holds, then as its free strike", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  const before = handCard(world, mage);
  assert.equal(before.damage, "1d12");
  assert.equal(typeof before.toHit, "number", "a casting rolls to hit");
  assert.match(before.resource, /Slot 1/);
  await bolt(world, mage, goblin, [15, 5]);
  const held = handCard(world, mage);
  assert.equal(held.damage, "1d12");
  assert.equal(held.toHit, null, "the beam rolls nothing");
  assert.equal(held.roll, "no roll");
  assert.equal(held.resource, "No slot");
  assert.equal(held.intent.slotLevel, null, "no slot is named");
  assert.match(held.rules, /new casting/, "the card warns what another target means");
  assert.equal(held.disabled, null);
  world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, slots: { 1: { max: 1, used: 1 } } } });
  assert.equal(handCard(world, mage).disabled, null, "a beam asks no slot, so an empty one does not grey it");
  assert.ok(handCard(world, mage, { ...FRESH_TURN, actionUsed: true }).disabled, "it does need the action");
});

await test("A card played at the connected creature strikes with the beam; at another it is a new casting", async () => {
  const { world, mage, enemies: [first, second] } = await fight(2);
  assert.equal(played(world, mage, first, 1)[0].name, "pc_attack", "nothing held yet");
  await bolt(world, mage, first, [15, 5]);
  nextRound(world);
  const [strike] = played(world, mage, first);
  assert.equal(strike.name, "cast_at_enemy");
  assert.equal(strike.args.level, undefined);
  const [recast] = played(world, mage, second, 1);
  assert.equal(recast.name, "pc_attack");
  dice(7);
  const out = await world.invoke(strike.name, strike.args);
  clearDice();
  assert.equal(payload(out).damage, 7, JSON.stringify(out));
  assert.equal(used(world, mage, 1), 1);
  await world.invoke("clear_condition", { characterId: mage.id, condition: "concentration" });
  assert.equal(played(world, mage, first, 1)[0].name, "pc_attack", "the spell ended, so it is a casting again");
});

await test("A beam held from a scroll gets its card, though the spell is on no list of theirs", async () => {
  const { world, mage } = await fight();
  const casting = world.sheet(mage.id).spellcasting;
  world.patch(mage.id, { spellcasting: { ...casting, prepared: casting.prepared.filter((name) => name !== SPELL) } });
  assert.equal(handCard(world, mage), undefined, "not theirs to cast");
  world.patch(mage.id, { concentratingOn: SPELL });
  assert.equal(handCard(world, mage).resource, "No slot");
});

await test("A fighter holding a beam an item cast gets its card and strikes through it", async () => {
  const world = await openWorld();
  const fighter = world.addHero({ class: "fighter", level: 5, name: "Brute" });
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [fighter.id]: 20 } });
  assert.equal(handCard(world, fighter), undefined);
  world.patch(fighter.id, { concentratingOn: SPELL });
  const card = handCard(world, fighter);
  assert.equal(card.damage, "1d12");
  assert.equal(card.resource, "No slot");
  assert.equal(card.disabled, null, JSON.stringify(card.disabled));
  const encounters = await import("../src/lib/db/encounters.ts");
  encounters.patchEnemyConditions(goblin.id, ["witch bolt"], { "witch bolt": { spell: SPELL, source: fighter.id } });
  assert.equal(played(world, fighter, goblin)[0].name, "cast_at_enemy");
});

await test("A new casting through pc_attack is a new casting: it spends a slot and rolls to hit", async () => {
  const { world, mage, enemies: [goblin] } = await fight();
  await bolt(world, mage, goblin, [15, 5]);
  nextRound(world);
  const again = await bolt(world, mage, goblin, [15, 5]);
  assert.equal(payload(again).hit, true, JSON.stringify(again));
  assert.equal(used(world, mage, 1), 2, "the second casting spends its own slot");
});

finish();
