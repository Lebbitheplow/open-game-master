// Misdirection and Instinctive Charm turn a hit onto another creature, and the
// engine asks which one. Their card named no target and no way to pick one, so
// played from the Hand it was refused or left the GM to fill it in. By the
// features' text in the content pack, Misdirection's card offers the creatures
// beside the rogue, friend or foe, and the engine takes one giving cover; for
// Instinctive Charm the attacker turns on the creature closest to it, which the
// engine finds. Either way the attack's roll meets the new creature's AC.
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

// Instinctive Charm's stage: the attacker toe to toe with the holder, another
// goblin beside both (the one closest to the attacker), and a third 30 feet off.
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
const SHORTBOW = { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" };
// Misdirection's stage (the pack's text: "onto a creature within 5 feet that is
// giving you cover"): an archer 15 feet off, a goblin in the line between it and
// the rogue, and another goblin beside the rogue out of that line. The goblin in
// the way gives the rogue half cover, so the shot needs 14.
async function shot(who = rogue) {
  const { attacker, beside, far } = await stage(who);
  kit.setEnemy(attacker.id, { stats: { ...attacker.stats, attacks: [SHORTBOW] } });
  kit.place(attacker.id, 5, 8);
  kit.place(beside.id, 5, 6);
  kit.place(far.id, 4, 5);
  return { archer: attacker, between: beside, aside: far };
}
const strike = async (enemy, target = rogue) => {
  world.dice(16, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
// As the board measures them for the Hand (PlayerMapView.feet): every token.
const feetFrom = (who) => {
  const me = kit.token(who.id);
  const ids = [...world.enemies().map((enemy) => enemy.id), ...world.sheets().map((sheet) => sheet.id)];
  return Object.fromEntries(ids.filter((id) => id !== who.id && kit.token(id)).map((id) => [id, tilesApart(me, kit.token(id)) * 5]));
};
const card = (name, who = rogue, feet = feetFrom(who), offered = foes()) => {
  const found = reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets(), "you", feet, [], offered).find((entry) => entry.name === name);
  assert.ok(found, `${name} is offered`);
  return found;
};
const foes = () => world.enemies().map((enemy) => ({ id: enemy.id, name: enemy.displayName }));
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });
const reactionSpent = (who) => world.encounter().reactionsUsed.includes(who.id);
const hpOf = (enemy) => world.enemies().find((entry) => entry.id === enemy.id).currentHp;
const friend = hero({ class: "fighter", subclass: "Champion" });

await test("The card asks for a creature: the hit fixes no aim, and it is open with someone beside the holder.", async () => {
  const { archer } = await shot();
  await strike(archer);
  const held = card("Misdirection");
  assert.equal(held.target, "enemy");
  assert.equal(held.pickWithin, 5);
  assert.equal(held.range, "5 ft");
  assert.equal(held.disabled, null);
  assert.equal(reactionAim(held, hits(), rogue.id, world.sheets()), null);
});

await test("The picker offers the creatures beside the holder, friend or foe, not the attacker, and none farther off.", async () => {
  const { archer, between, aside } = await shot();
  kit.place(friend.id, 6, 5);
  await strike(archer);
  const party = [{ id: friend.id, name: friend.name }];
  const picks = reactionPicks(card("Misdirection", rogue, feetFrom(rogue), [...foes(), ...party]), [...foes(), ...party], feetFrom(rogue));
  assert.deepEqual(picks.map((entry) => entry.id).sort(), [between.id, aside.id, friend.id].sort());
  kit.place(friend.id, 14, 14);
});

await test("The holder is never offered as their own creature, though the hero acting for another's card is.", async () => {
  const { archer, between } = await shot();
  await strike(archer);
  const held = card("Misdirection");
  const chips = [{ id: between.id }, { id: rogue.id }, { id: friend.id }];
  assert.deepEqual(reactionPicks(held, chips).map((chip) => chip.id), [between.id, friend.id]);
});

await test("Other cards' pickers are untouched.", async () => {
  const { archer } = await shot();
  await strike(archer);
  const held = card("Misdirection");
  const { pickWithin: _dropped, ...plain } = held;
  assert.equal(reactionPicks(plain, foes(), feetFrom(rogue)).length, 3);
});

await test("Nobody else beside the holder: the card is shut and says why.", async () => {
  const { archer, between, aside } = await shot();
  kit.place(between.id, 5, 14);
  kit.place(aside.id, 8, 14);
  await strike(archer);
  assert.match(card("Misdirection").disabled ?? "", /no other creature stands within 5 feet/i);
});

await test("Only a creature the Hand offers keeps the card open: a token that is nobody to aim at does not, and a character on the foes' side does.", async () => {
  const { archer, between, aside } = await shot();
  kit.place(between.id, 5, 14);
  kit.place(aside.id, 8, 14);
  await strike(archer);
  const feet = { ...feetFrom(rogue), "npc:barrel": 5, turncoat: 5 };
  assert.match(card("Misdirection", rogue, feet).disabled ?? "", /no other creature/i, "an NPC token is nobody to pick");
  const held = card("Misdirection", rogue, feet, [...foes(), { id: "turncoat", name: "Turncoat" }]);
  assert.equal(held.disabled, null, "a character fighting for the foes can take it");
  assert.deepEqual(reactionPicks(held, [{ id: "turncoat", name: "Turncoat" }], feet).map((foe) => foe.id), ["turncoat"]);
});

await test("With no distances for this holder, the card is open and every creature but the attacker is offered, for the engine to judge.", async () => {
  const { archer, between, aside } = await shot();
  await strike(archer);
  const held = reactionCards(world.sheet(rogue.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets()).find((entry) => entry.name === "Misdirection");
  assert.equal(held.disabled, null);
  assert.deepEqual(reactionPicks(held, foes()).map((foe) => foe.id).sort(), [between.id, aside.id].sort());
});

await test("Played from the card, the pick reaches the engine and the blow lands on the creature giving cover.", async () => {
  const { archer, between } = await shot();
  await strike(archer);
  assert.equal(world.sheet(rogue.id).currentHp, 44);
  const held = card("Misdirection");
  const body = intentBody(held, { id: between.id, name: between.displayName, kind: "enemy" });
  const [call] = directCardCalls(body, rogue.id, { inFight: true });
  assert.equal(call.name, "use_reaction");
  assert.equal(call.args.targetEnemyId, between.id);
  const out = await world.invoke(call.name, call.args);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /lands on/);
  assert.equal(world.sheet(rogue.id).currentHp, 50, "the blow comes off the rogue");
  assert.equal(hpOf(between), 94, "and lands on the goblin in the way");
  assert.equal(reactionSpent(rogue), true);
});

await test("An ally giving cover can take the blow: picked from the card, it lands on their sheet.", async () => {
  const { archer, between } = await shot();
  kit.place(between.id, 9, 9);
  kit.place(friend.id, 5, 6);
  world.patch(friend.id, { currentHp: 50, conditions: [], conditionMeta: {}, ac: 12, acOverride: true });
  // The ally in the way covers the rogue: 20 against 14.
  await strike(archer);
  const body = intentBody(card("Misdirection"), { id: friend.id, name: friend.name, kind: "ally" });
  const [call] = directCardCalls(body, rogue.id, { inFight: true });
  assert.equal(call.args.targetCharacterId, friend.id);
  const out = await world.invoke(call.name, call.args);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(rogue.id).currentHp, 50);
  assert.equal(world.sheet(friend.id).currentHp, 44, "the blow lands on the fighter");
  kit.place(friend.id, 14, 14);
});

await test("A creature beside the rogue that stands out of the line gives no cover: refused, with nothing spent.", async () => {
  const { archer, aside } = await shot();
  await strike(archer);
  const out = await react(rogue, "Misdirection", { targetEnemyId: aside.id });
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules");
  assert.match(out.error, /gives no cover/);
  assert.equal(world.sheet(rogue.id).currentHp, 44);
  assert.equal(hpOf(aside), 100);
  assert.equal(reactionSpent(rogue), false);
});

await test("Toe to toe nobody stands between the attacker and the rogue, so nobody beside gives cover.", async () => {
  const { attacker, beside } = await stage();
  await strike(attacker);
  const out = await react(rogue, "Misdirection", { targetEnemyId: beside.id });
  assert.equal(out.ok, false);
  assert.match(out.error, /gives no cover/);
  assert.equal(reactionSpent(rogue), false);
});

await test("The turned attack meets the new creature's AC: a roll that beat the rogue can miss it, and nobody takes the blow.", async () => {
  const { archer, between } = await shot();
  kit.setEnemy(between.id, { ac: 25 });
  await strike(archer);
  const out = await react(rogue, "Misdirection", { targetEnemyId: between.id });
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /misses \(20 against AC 25\)/);
  assert.equal(world.sheet(rogue.id).currentHp, 50);
  assert.equal(hpOf(between), 100);
  assert.equal(reactionSpent(rogue), true);
});

await test("The attacker cannot take its own blow, nor the holder: refused, with nothing spent.", async () => {
  const { archer } = await shot();
  await strike(archer);
  const out = await react(rogue, "Misdirection", { targetEnemyId: archer.id });
  assert.equal(out.ok, false);
  assert.match(out.error, /another creature/);
  const self = await react(rogue, "Misdirection", { targetCharacterId: rogue.id });
  assert.equal(self.ok, false);
  assert.match(self.error, /another creature/);
  assert.equal(world.sheet(rogue.id).currentHp, 44);
  assert.equal(reactionSpent(rogue), false);
});

await test("A creature beyond 5 feet is refused, and no target asks for one, with nothing spent.", async () => {
  const { archer, between } = await shot();
  await strike(archer);
  kit.place(between.id, 5, 7);
  const beyond = await react(rogue, "Misdirection", { targetEnemyId: between.id });
  assert.equal(beyond.ok, false);
  assert.match(beyond.error, /not within 5 feet/);
  const none = await react(rogue, "Misdirection");
  assert.equal(none.ok, false);
  assert.equal(none.retry, true);
  assert.match(none.error, /pass its targetEnemyId, or targetCharacterId/);
  assert.equal(reactionSpent(rogue), false);
});

const charmer = hero({ class: "wizard", subclass: "School of Enchantment", spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: [] } });

await test("Instinctive Charm's card asks for nobody: the attacker turns on the creature closest to it, and the card names its 30 feet.", async () => {
  const { attacker } = await stage(charmer);
  await strike(attacker, charmer);
  const held = card("Instinctive Charm", charmer);
  assert.equal(held.target, "none");
  assert.equal(held.pickWithin, undefined);
  assert.equal(held.range, "30 ft");
  assert.equal(held.disabled, null);
});

await test("Instinctive Charm: an attacker the board puts beyond 30 feet deals no card.", async () => {
  const { attacker } = await stage(charmer);
  kit.setEnemy(attacker.id, { stats: { ...attacker.stats, attacks: [SHORTBOW] } });
  kit.place(attacker.id, 5, 12);
  await strike(attacker, charmer);
  const offered = reactionCards(world.sheet(charmer.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets(), "you", feetFrom(charmer), [], foes());
  assert.equal(offered.some((entry) => entry.name === "Instinctive Charm"), false);
});

await test("Instinctive Charm: played with no creature named, the blow goes to the one closest to the attacker.", async () => {
  const { attacker, beside } = await stage(charmer);
  await strike(attacker, charmer);
  const [call] = directCardCalls(intentBody(card("Instinctive Charm", charmer), null), charmer.id, { inFight: true });
  assert.equal(call.args.targetEnemyId, undefined);
  world.dice(1);
  const out = await world.invoke(call.name, call.args);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, new RegExp(`lands on ${beside.displayName}`));
  assert.equal(world.sheet(charmer.id).currentHp, 50);
  assert.equal(hpOf(beside), 94);
});

await test("Instinctive Charm: a creature beside the wizard that is not the closest to the attacker is refused before any save.", async () => {
  const { attacker, beside, far } = await stage(charmer);
  kit.setEnemy(attacker.id, { stats: { ...attacker.stats, attacks: [SHORTBOW] } });
  kit.place(attacker.id, 5, 8);
  kit.place(far.id, 5, 9);
  await strike(attacker, charmer);
  // A 20 would pass the save: rolled first, the attacker would resist and the use be gone.
  world.dice(20);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(out.ok, false, "refused before any save");
  assert.match(out.error, new RegExp(`not the creature closest to ${attacker.displayName}: ${far.displayName} is`));
  assert.equal(reactionSpent(charmer), false);
  assert.equal(world.enemies().find((enemy) => enemy.id === attacker.id).conditions.includes("withstood instinctive charm"), false);
});

await test("Instinctive Charm: with two creatures equally close the attacker chooses, so the call names one of them.", async () => {
  const { attacker, beside, far } = await stage(charmer);
  kit.place(far.id, 6, 6);
  await strike(attacker, charmer);
  const asked = await react(charmer, "Instinctive Charm");
  assert.equal(asked.ok, false);
  assert.equal(asked.retry, true);
  assert.match(asked.error, /stand equally close/);
  assert.ok(asked.error.includes(beside.displayName) && asked.error.includes(far.displayName), asked.error);
  assert.equal(reactionSpent(charmer), false);
  world.dice(1);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: far.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hpOf(far), 94);
});

await test("Instinctive Charm: a failed save turns the blow onto the closest creature.", async () => {
  const { attacker, beside } = await stage(charmer);
  await strike(attacker, charmer);
  world.dice(1);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /lands on/);
  assert.equal(world.sheet(charmer.id).currentHp, 50);
  assert.equal(hpOf(beside), 94);
});

await test("Instinctive Charm: the attacker makes the save, not the creature picked to take the blow.", async () => {
  const { attacker, beside } = await stage(charmer);
  // Only the attacker can pass this save: a 20 from it keeps its target.
  const stats = attacker.stats;
  kit.setEnemy(beside.id, { stats: { ...beside.stats, conditionImmune: "" } });
  kit.setEnemy(attacker.id, { stats: { ...stats, conditionImmune: "" } });
  await strike(attacker, charmer);
  world.dice(20);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, new RegExp(`${attacker.displayName} resists`));
  assert.equal(world.sheet(charmer.id).currentHp, 44, "it keeps its target");
  assert.ok(world.enemies().find((enemy) => enemy.id === attacker.id).conditions.includes("withstood instinctive charm"));
  assert.equal(world.enemies().find((enemy) => enemy.id === beside.id).conditions.includes("withstood instinctive charm"), false);
});

await test("Instinctive Charm: an attacker beyond 30 feet is refused, whoever is picked.", async () => {
  const { attacker, beside } = await stage(charmer);
  const ranged = { ...attacker.stats, attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] };
  kit.setEnemy(attacker.id, { stats: ranged });
  kit.place(attacker.id, 5, 12);
  await strike(attacker, charmer);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  assert.equal(out.ok, false);
  assert.match(out.error, new RegExp(`${attacker.displayName} is beyond 30 feet`));
  assert.equal(reactionSpent(charmer), false);
});

await test("Instinctive Charm: an attacker that resisted cannot be swayed again, with nothing spent, though another can.", async () => {
  const encounters = await import("../src/lib/db/encounters.ts");
  const nextRound = () => {
    kit.freshRound();
    encounters.saveEncounter({ ...world.encounter(), reactionsUsed: [] });
    world.patch(charmer.id, { currentHp: 50 });
  };
  const { attacker, beside } = await stage(charmer);
  await strike(attacker, charmer);
  world.dice(20);
  const first = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  nextRound();
  await strike(attacker, charmer);
  // A 1 would fail the save, were it rolled.
  world.dice(1);
  const again = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(again.ok, false);
  assert.match(again.error, /cannot be swayed again/);
  assert.equal(world.sheet(charmer.id).currentHp, 44, "the blow stands");
  assert.equal(reactionSpent(charmer), false);
  nextRound();
  await strike(beside, charmer);
  world.dice(1);
  const other = await react(charmer, "Instinctive Charm", { targetEnemyId: attacker.id });
  world.clearDice();
  assert.equal(other.ok, true, other.error);
  assert.match(other.result.applied, /lands on/);
});

const nextRound = async (...heroes) => {
  const encounters = await import("../src/lib/db/encounters.ts");
  kit.freshRound();
  encounters.saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  for (const who of heroes) world.patch(who.id, { currentHp: 50 });
};

await test("Instinctive Charm: each wizard's bar is their own, and a second wizard's does not erase the first's.", async () => {
  const second = hero({ class: "wizard", subclass: "School of Enchantment", spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: [] } });
  const { attacker, beside } = await stage(charmer);
  kit.place(second.id, 4, 6);
  world.patch(second.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  const resist = async (who) => {
    await strike(attacker, who);
    world.dice(20);
    const out = await react(who, "Instinctive Charm", { targetEnemyId: beside.id });
    world.clearDice();
    return out;
  };
  assert.match((await resist(charmer)).result.applied, /resists/);
  await nextRound(charmer, second);
  assert.match((await resist(second)).result.applied, /resists/, "the first wizard's bar is no bar to the second");
  await nextRound(charmer, second);
  await strike(attacker, charmer);
  world.dice(1);
  const again = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(again.ok, false);
  assert.match(again.error, /cannot be swayed again/);
});

await test("Instinctive Charm: the wizards a mark names stay within what the schema takes.", async () => {
  const { attacker, beside } = await stage(charmer);
  const mark = "withstood instinctive charm";
  const others = Array.from({ length: 20 }, (_, at) => `wizard-${at}`);
  kit.setEnemy(attacker.id, { conditions: [mark], conditionMeta: { [mark]: { source: others[19], sources: others, untilLongRest: true } } });
  await strike(attacker, charmer);
  world.dice(20);
  assert.match((await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id })).result.applied, /resists/);
  world.clearDice();
  const sources = world.enemies().find((enemy) => enemy.id === attacker.id).conditionMeta[mark].sources;
  assert.equal(sources.length, 20);
  assert.equal(sources.at(-1), charmer.id);
});

await test("Instinctive Charm: before the round's tick the bar refuses even with the attacker's conditions list full, and it holds on a character fighting for the foes.", async () => {
  const { attacker, beside } = await stage(charmer);
  const full = Array.from({ length: 10 }, (_, at) => `mark ${at}`);
  kit.setEnemy(attacker.id, { conditions: full, conditionMeta: {} });
  await strike(attacker, charmer);
  world.dice(20);
  assert.match((await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id })).result.applied, /resists/);
  world.clearDice();
  await nextRound(charmer);
  await strike(attacker, charmer);
  world.dice(1);
  const barred = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.match(barred.error ?? "", /cannot be swayed again/);

  // A guest leaves with the fight it joined, so this one joins between fights.
  await kit.endFight();
  const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
  const joined = await world.invoke("add_companion", { gender: "Unknown", name: "Aldric", class: "fighter", race: "human", level: 3, personality: "Grim.", kind: "guest" });
  assert.equal(joined.ok, true, joined.error);
  const turncoat = joined.result.characterId;
  world.patch(turncoat, { proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 12, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }], conditions: [], conditionMeta: {} });
  await kit.fight(2, { heroFaces: { [charmer.id]: 3, [turncoat]: 2 } });
  const fresh = { beside: world.enemies()[0] };
  kit.setEnemy(fresh.beside.id, { maxHp: 100, currentHp: 100 });
  moveToSide(world.campaign(), turncoat, "foe");
  kit.place(charmer.id, 5, 5);
  kit.place(turncoat, 5, 6);
  kit.place(fresh.beside.id, 4, 5);
  kit.place(world.enemies()[1].id, 12, 12);
  kit.freshRound();
  world.patch(charmer.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  kit.giveTurn(turncoat);
  const blow = await kit.swing(turncoat, charmer.id, [15, 5]);
  assert.equal(blow.ok, true, blow.error);
  world.dice(20);
  const first = await react(charmer, "Instinctive Charm", { targetEnemyId: fresh.beside.id });
  world.clearDice();
  assert.match(first.result.applied, /resists/);
  assert.ok(world.sheet(turncoat).conditions.includes("withstood instinctive charm"), "the mark is on their sheet");
  await nextRound(charmer);
  kit.giveTurn(turncoat);
  const second = await kit.swing(turncoat, charmer.id, [15, 5]);
  assert.equal(second.ok, true, second.error);
  world.dice(1);
  const refused = await react(charmer, "Instinctive Charm", { targetEnemyId: fresh.beside.id });
  world.clearDice();
  assert.match(refused.error ?? "", /cannot be swayed again/);
});

await test("Instinctive Charm: the mark ends at a long rest, not on a timer.", async () => {
  const { carryConditions } = await import("../src/lib/dm/foe-carry-logic.ts");
  const { attacker, beside } = await stage(charmer);
  await strike(attacker, charmer);
  world.dice(20);
  await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  const held = world.enemies().find((enemy) => enemy.id === attacker.id);
  const mark = "withstood instinctive charm";
  assert.equal(held.conditionMeta[mark].untilLongRest, true);
  assert.equal(carryConditions(held.conditions, held.conditionMeta, 60, 0).conditions.includes(mark), true, "an hour later it holds");
  assert.equal(carryConditions(held.conditions, held.conditionMeta, 480, 1).conditions.includes(mark), false, "a long rest ends it");
});

await test("Instinctive Charm: a creature immune to being charmed is refused, with nothing spent and no save.", async () => {
  const { attacker, beside } = await stage(charmer);
  kit.setEnemy(attacker.id, { stats: { ...attacker.stats, conditionImmune: "charmed" } });
  await strike(attacker, charmer);
  // A 1 would fail the save, were it rolled.
  world.dice(1);
  const out = await react(charmer, "Instinctive Charm", { targetEnemyId: beside.id });
  world.clearDice();
  assert.equal(out.ok, false);
  assert.match(out.error, /cannot be charmed/);
  assert.equal(world.sheet(charmer.id).currentHp, 44);
  assert.equal(reactionSpent(charmer), false);
});

await test("Misdirection needs no save, so an attacker immune to being charmed is no bar.", async () => {
  const { archer, between } = await shot();
  kit.setEnemy(archer.id, { stats: { ...archer.stats, attacks: [SHORTBOW], conditionImmune: "charmed" } });
  await strike(archer);
  const out = await react(rogue, "Misdirection", { targetEnemyId: between.id });
  assert.equal(out.ok, true, out.error);
});

world.close();
finish();
