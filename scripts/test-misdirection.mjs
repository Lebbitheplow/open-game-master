// Misdirection and Instinctive Charm turn a hit onto another creature, and the
// engine asks which one. Their card named no target and no way to pick one, so
// played from the Hand it was refused or left the GM to fill it in. The card now
// offers the creatures beside the holder, other than the attacker.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-misdirection");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionAim, reactionCards, reactionPicks } = await import("../src/lib/battlemap/hand-react.ts");
const { intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const { directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { tilesApart } = await import("../src/lib/dm/board-reach.ts");

const hero = (extra) =>
  world.addHero({
    user: world.owner, level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
    ...extra,
  });
const rogue = hero({ class: "rogue", subclass: "Mastermind" });

// The attacker and another goblin beside the holder, and a third 30 feet off.
async function stage(who = rogue) {
  await kit.endFight();
  await kit.fight(3, { heroFaces: { [who.id]: 3 } });
  const [attacker, beside, far] = world.enemies();
  for (const enemy of [attacker, beside, far]) kit.setEnemy(enemy.id, { maxHp: 100, currentHp: 100 });
  kit.place(who.id, 5, 5);
  kit.place(attacker.id, 5, 6);
  kit.place(beside.id, 4, 5);
  kit.place(far.id, 5, 12);
  kit.freshRound();
  world.patch(who.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  return { attacker, beside, far };
}
const strike = async (enemy, target = rogue) => {
  world.dice(16, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
// As the board measures them for the Hand (PlayerMapView.feet).
const feetFrom = (who) => {
  const me = kit.token(who.id);
  return Object.fromEntries(world.enemies().filter((enemy) => kit.token(enemy.id)).map((enemy) => [enemy.id, tilesApart(me, kit.token(enemy.id)) * 5]));
};
const card = (name, who = rogue, feet = feetFrom(who), offered = foes()) => {
  const found = reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets(), "you", feet, [], offered).find((entry) => entry.name === name);
  assert.ok(found, `${name} is offered`);
  return found;
};
const foes = () => world.enemies().map((enemy) => ({ id: enemy.id, name: enemy.displayName }));
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });
const reactionSpent = (who) => world.encounter().reactionsUsed.includes(who.id);

await test("The card asks for a creature: the hit fixes no aim, and it is open with someone beside the holder.", async () => {
  const { attacker } = await stage();
  await strike(attacker);
  const held = card("Misdirection");
  assert.equal(held.target, "enemy");
  assert.equal(held.pickWithin, 5);
  assert.equal(held.disabled, null);
  assert.equal(reactionAim(held, hits(), rogue.id, world.sheets()), null);
});

await test("The picker offers the creature beside the holder, not the attacker, and not one 30 feet off.", async () => {
  const { attacker, beside } = await stage();
  await strike(attacker);
  const picks = reactionPicks(card("Misdirection"), foes(), feetFrom(rogue));
  assert.deepEqual(picks.map((foe) => foe.id), [beside.id]);
});

await test("Other cards' pickers are untouched.", async () => {
  const { attacker } = await stage();
  await strike(attacker);
  const held = card("Misdirection");
  const { pickWithin: _dropped, ...plain } = held;
  assert.equal(reactionPicks(plain, foes(), feetFrom(rogue)).length, 3);
});

await test("Nobody else beside the holder: the card is shut and says why.", async () => {
  const { attacker, beside } = await stage();
  kit.place(beside.id, 5, 14);
  await strike(attacker);
  assert.match(card("Misdirection").disabled ?? "", /no other creature stands within 5 feet/i);
});

await test("Only a foe the Hand offers keeps the card open: a token that is no foe does not, and a character on the foes' side does.", async () => {
  const { attacker, beside } = await stage();
  kit.place(beside.id, 5, 14);
  await strike(attacker);
  const feet = { ...feetFrom(rogue), "npc:barrel": 5, turncoat: 5 };
  assert.match(card("Misdirection", rogue, feet).disabled ?? "", /no other creature/i, "an NPC token is nobody to pick");
  const held = card("Misdirection", rogue, feet, [...foes(), { id: "turncoat", name: "Turncoat" }]);
  assert.equal(held.disabled, null, "a character fighting for the foes can take it");
  assert.deepEqual(reactionPicks(held, [{ id: "turncoat", name: "Turncoat" }], feet).map((foe) => foe.id), ["turncoat"]);
});

await test("With no distances for this holder, the card is open and every foe but the attacker is offered, for the engine to judge.", async () => {
  const { attacker, beside, far } = await stage();
  await strike(attacker);
  const held = reactionCards(world.sheet(rogue.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets()).find((entry) => entry.name === "Misdirection");
  assert.equal(held.disabled, null);
  assert.deepEqual(reactionPicks(held, foes()).map((foe) => foe.id).sort(), [beside.id, far.id].sort());
});

await test("Played from the card, the pick reaches the engine and the blow lands on that creature.", async () => {
  const { attacker, beside } = await stage();
  await strike(attacker);
  assert.equal(world.sheet(rogue.id).currentHp, 44);
  const held = card("Misdirection");
  const body = intentBody(held, { id: beside.id, name: beside.displayName, kind: "enemy" });
  const [call] = directCardCalls(body, rogue.id, { inFight: true });
  assert.equal(call.name, "use_reaction");
  assert.equal(call.args.targetEnemyId, beside.id);
  const out = await world.invoke(call.name, call.args);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /lands on/);
  assert.equal(world.sheet(rogue.id).currentHp, 50, "the blow comes off the rogue");
  assert.equal(world.enemies().find((enemy) => enemy.id === beside.id).currentHp, 94, "and lands on the other goblin");
  assert.equal(reactionSpent(rogue), true);
});

await test("The attacker cannot take its own blow: refused, with nothing spent.", async () => {
  const { attacker } = await stage();
  await strike(attacker);
  const out = await react(rogue, "Misdirection", { targetEnemyId: attacker.id });
  assert.equal(out.ok, false);
  assert.match(out.error, /another creature/);
  assert.equal(world.sheet(rogue.id).currentHp, 44);
  assert.equal(reactionSpent(rogue), false);
});

await test("A creature beyond 5 feet is refused, and no target asks for one, with nothing spent.", async () => {
  const { attacker, far } = await stage();
  await strike(attacker);
  const beyond = await react(rogue, "Misdirection", { targetEnemyId: far.id });
  assert.equal(beyond.ok, false);
  assert.match(beyond.error, /not within 5 feet/);
  const none = await react(rogue, "Misdirection");
  assert.equal(none.ok, false);
  assert.match(none.error, /pass its targetEnemyId/);
  assert.equal(reactionSpent(rogue), false);
});

const charmer = hero({ class: "wizard", subclass: "School of Enchantment", spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: [] } });

await test("Instinctive Charm picks the same way, and a bad pick rolls no save.", async () => {
  const { attacker, far } = await stage(charmer);
  await strike(attacker, charmer);
  assert.equal(card("Instinctive Charm", charmer).pickWithin, 5);
  // A 20 would pass the save: rolled first, the attacker would resist and the use be gone.
  world.dice(20);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: far.id });
  world.clearDice();
  assert.equal(out.ok, false, "refused before any save");
  assert.match(out.error, /not within 5 feet/);
  assert.equal(reactionSpent(charmer), false);
});

await test("Instinctive Charm: a failed save turns the blow onto the pick.", async () => {
  const { attacker, beside } = await stage(charmer);
  await strike(attacker, charmer);
  world.dice(1);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /lands on/);
  assert.equal(world.sheet(charmer.id).currentHp, 50);
  assert.equal(world.enemies().find((enemy) => enemy.id === beside.id).currentHp, 94);
});

world.close();
finish();
