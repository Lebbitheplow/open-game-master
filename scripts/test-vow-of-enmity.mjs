// Vow of Enmity (Oath of Vengeance 3) spent its use and changed nothing, and
// Soul of Vengeance (15), its reaction, was never offered and answered no vow.
//
//   - the card aims at a creature, and the spend names one within 10 feet;
//   - the vow gives the paladin advantage against that creature and no other,
//     and no other hero;
//   - Soul of Vengeance is offered when the vowed creature attacks, hit or miss,
//     and is refused without a vow or an attack.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-vow-of-enmity");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { handTargets } = await import("../src/app/campaigns/[campaignId]/handTargets.ts");
const { previewRows } = await import("../src/lib/battlemap/hand-play.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");

const hero = (extra = {}) =>
  world.addHero({
    class: "paladin", subclass: "Oath of Vengeance", level: 15, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    ...extra,
  });
const paladin = hero();
const friend = world.addHero({
  class: "fighter", level: 5, maxHp: 100, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});

async function stage(first = paladin) {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [first.id]: 19 } });
  const [near, other] = world.enemies();
  for (const enemy of [near, other]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(paladin.id, 5, 5);
  kit.place(friend.id, 4, 5);
  kit.place(near.id, 5, 6);
  kit.place(other.id, 6, 6);
  kit.giveTurn(first.id);
  const sheet = world.sheet(paladin.id);
  world.patch(paladin.id, {
    conditions: [], conditionMeta: {}, currentHp: 100,
    resources: { ...sheet.resources, channel_divinity: { ...sheet.resources.channel_divinity, used: 0 } },
  });
  return { near, other };
}
const vow = (targetEnemyId) =>
  world.invoke("use_resource", { characterId: paladin.id, resource: "channel_divinity", variant: "vow of enmity", ...(targetEnemyId ? { targetEnemyId } : {}) });
const d20s = (swing) => swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length;
const cd = () => world.sheet(paladin.id).resources.channel_divinity.used;

await test("The card aims at a creature, costs the bonus action, and its call names the creature.", async () => {
  const { near } = await stage();
  const card = deriveHand(world.sheet(paladin.id), FRESH_TURN, {}).find((entry) => entry.name === "Vow of Enmity");
  assert.equal(card.target, "enemy");
  assert.equal(card.cost, "bonus");
  const call = directCardCall({ ...card.intent, targetId: near.id, targetKind: "enemy" }, paladin.id, { inFight: true });
  const out = await world.invoke(call.name, call.args);
  assert.equal(out.ok, true, out.error);
  assert.equal(cd(), 1);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("The spend refuses no creature and one beyond 10 feet, and spends nothing.", async () => {
  const { near } = await stage();
  const none = await vow();
  assert.equal(none.ok, false);
  kit.place(near.id, 5, 12);
  const far = await vow(near.id);
  assert.equal(far.ok, false);
  assert.match(far.error, /beyond 10 feet/);
  assert.equal(cd(), 0);
});

await test("The paladin rolls with advantage against the vowed creature, and only that one.", async () => {
  const { near, other } = await stage();
  assert.equal((await vow(near.id)).ok, true, "the vow");
  kit.freshTurn();
  assert.equal(d20s(await kit.swing(paladin.id, other.id, [15, 3, 4, 4, 4, 4])), 1, "another creature");
  kit.freshTurn();
  assert.equal(d20s(await kit.swing(paladin.id, near.id, [2, 15, 3, 4, 4, 4, 4])), 2, "the vowed creature");
});

await test("A second vow moves it: only the newer creature gives advantage.", async () => {
  const { near, other } = await stage();
  await vow(near.id);
  kit.giveTurn(paladin.id);
  const sheet = world.sheet(paladin.id);
  world.patch(paladin.id, { resources: { ...sheet.resources, channel_divinity: { ...sheet.resources.channel_divinity, used: 0 } } });
  const second = await vow(other.id);
  assert.equal(second.ok, true, second.error);
  kit.freshTurn();
  assert.equal(d20s(await kit.swing(paladin.id, near.id, [15, 3, 4, 4, 4, 4])), 1);
  kit.freshTurn();
  assert.equal(d20s(await kit.swing(paladin.id, other.id, [2, 15, 3, 4, 4, 4, 4])), 2);
});

await test("The feature's own name lays the vow, as the variant does.", async () => {
  const { near } = await stage();
  const out = await world.invoke("use_resource", { characterId: paladin.id, resource: "Channel Divinity: Vow of Enmity", targetEnemyId: near.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(paladin.id).conditionMeta["vow of enmity"].quarry, near.id);
});

await test("With no use left, that is the answer, not a question about the target.", async () => {
  await stage();
  const sheet = world.sheet(paladin.id);
  world.patch(paladin.id, { resources: { ...sheet.resources, channel_divinity: { ...sheet.resources.channel_divinity, used: 1 } } });
  const out = await vow();
  assert.equal(out.ok, false);
  assert.doesNotMatch(out.error, /targetEnemyId/);
});

await test("Another hero has no advantage from the paladin's vow.", async () => {
  const { near } = await stage();
  await vow(near.id);
  kit.giveTurn(friend.id);
  kit.freshTurn();
  assert.equal(d20s(await kit.swing(friend.id, near.id, [15, 3, 4, 4, 4, 4])), 1);
});

// Vow of Enmity lasts "1 minute or until it drops to 0 hit points or falls
// unconscious"; the vow outlived its creature, and a creature healed in the
// minute still gave advantage.
const vowed = () => world.sheet(paladin.id).conditions.includes("vow of enmity");
await test("The vow ends when its creature drops to 0 hit points.", async () => {
  const { near } = await stage();
  await vow(near.id);
  kit.setEnemy(near.id, { currentHp: 1 });
  kit.freshTurn();
  const out = await kit.swing(paladin.id, near.id, [2, 15, 3, 4, 4, 4, 4]);
  assert.equal(world.enemies().find((enemy) => enemy.id === near.id).status, "dead", JSON.stringify(out));
  assert.equal(vowed(), false);
});

await test("The vow ends when its creature falls unconscious, and not on another creature's fall.", async () => {
  const { near, other } = await stage();
  await vow(near.id);
  const asleep = await world.invoke("set_enemy_condition", { enemyId: other.id, condition: "unconscious" });
  assert.equal(asleep.ok, true, asleep.error);
  assert.equal(vowed(), true, "another creature");
  const out = await world.invoke("set_enemy_condition", { enemyId: near.id, condition: "unconscious" });
  assert.equal(out.ok, true, out.error);
  assert.equal(vowed(), false);
});

// The Hand's hit odds read one d20 against the vowed creature, though the
// roll had two.
await test("The Hand's hit odds carry the vow's advantage against its creature alone.", async () => {
  const { near, other } = await stage();
  await vow(near.id);
  const view = activePublicEncounter(world.campaignId, { enemyNumbers: false });
  const chips = handTargets(view.enemies, world.sheets(), paladin.id, undefined, view.sides, view);
  const chip = (id) => chips.find((entry) => entry.id === id);
  assert.deepEqual(chip(near.id).advantage, ["Vow of Enmity"]);
  assert.equal(chip(other.id).advantage, undefined);
  const card = deriveHand(world.sheet(paladin.id), FRESH_TURN, {}).find((entry) => entry.intent.card === "attack");
  const toHit = (aim) => previewRows(card, aim).find((row) => row.key === "To hit").value;
  assert.match(toHit(chip(near.id)), /advantage/);
  assert.doesNotMatch(toHit(chip(other.id)), /advantage/);
  const friendChips = handTargets(view.enemies, world.sheets(), friend.id, undefined, view.sides, view);
  assert.equal(friendChips.find((entry) => entry.id === near.id).advantage, undefined, "not another hero's");
});

await test("Assassinate's advantage shows against a creature yet to act in the first round.", async () => {
  const { featureAdvantage } = await import("../src/lib/battlemap/hand-edge.ts");
  const assassin = world.addHero({ class: "rogue", subclass: "Assassin", level: 3, maxHp: 30 });
  const order = (first) => ({ round: 1, orderReady: true, order: first === "pc" ? [{ kind: "pc", id: assassin.id }, { kind: "enemy", id: "e1" }] : [{ kind: "enemy", id: "e1" }, { kind: "pc", id: assassin.id }] });
  assert.deepEqual(featureAdvantage(world.sheet(assassin.id), { id: "e1" }, order("pc")), ["Assassinate"]);
  assert.deepEqual(featureAdvantage(world.sheet(assassin.id), { id: "e1" }, order("enemy")), []);
  assert.deepEqual(featureAdvantage(world.sheet(assassin.id), { id: "e1" }, { ...order("pc"), round: 2 }), []);
});

const openHit = (over) => ({ id: "h1", characterId: paladin.id, hit: true, hits: 1, source: "attack", ranged: false, attacker: "Goblin", attack: "Club", type: "bludgeoning", damage: 5, answered: [], ...over });
const offered = (hit) =>
  reactionCards(world.sheet(paladin.id), { ...FRESH_TURN, myTurn: false }, [hit], [{ id: friend.id, name: "Friend" }]).filter((card) => card.name === "Soul of Vengeance");

await test("Soul of Vengeance is offered on the vowed creature's attack, hit or miss, on anyone, and no other.", async () => {
  const { near, other } = await stage();
  assert.equal(offered(openHit({ attackerId: near.id })).length, 0, "no vow yet");
  await vow(near.id);
  assert.equal(offered(openHit({ attackerId: near.id })).length, 1, "a hit");
  assert.equal(offered(openHit({ attackerId: near.id, hit: false })).length, 1, "a miss");
  assert.equal(offered(openHit({ attackerId: near.id, characterId: friend.id })).length, 1, "on an ally");
  assert.equal(offered(openHit({ attackerId: other.id })).length, 0, "another creature");
});

await test("Soul of Vengeance is refused without a vow and without an attack, and strikes after one.", async () => {
  const { near, other } = await stage();
  const react = (id) => world.invoke("use_reaction", { characterId: paladin.id, feature: "Soul of Vengeance", targetEnemyId: id });
  assert.match((await react(near.id)).error, /Vow of Enmity/);
  await vow(near.id);
  assert.match((await react(near.id)).error, /none on record/);
  kit.freshRound();
  world.dice(18, 4);
  assert.equal((await world.invoke("enemy_attack", { enemyId: other.id, targetCharacterId: paladin.id })).ok, true);
  world.clearDice();
  assert.match((await react(near.id)).error, /none on record/, "another creature's attack");
  world.dice(18, 4);
  assert.equal((await world.invoke("enemy_attack", { enemyId: near.id, targetCharacterId: paladin.id })).ok, true);
  world.clearDice();
  world.dice(15, 3, 4, 4);
  const out = await react(near.id);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.attack.target, near.displayName);
});

// A reaction's attack borrowed the readied condition: on the holder's own
// turn it spent their Action, and off it it took a readied action they held.
await test("Soul of Vengeance on the paladin's own turn spends no Action, and off it leaves a readied action alone.", async () => {
  const { near } = await stage();
  await vow(near.id);
  kit.giveTurn(paladin.id);
  world.dice(18, 4);
  assert.equal((await world.invoke("enemy_attack", { enemyId: near.id, targetCharacterId: paladin.id })).ok, true);
  world.dice(15, 3, 4, 4);
  const own = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Soul of Vengeance", targetEnemyId: near.id });
  world.clearDice();
  assert.equal(own.ok, true, own.error);
  const budget = world.encounter().turnBudget;
  assert.ok(!budget || (budget.actionUsed === false && budget.attacksMade === 0), JSON.stringify(budget));

  const again = await stage();
  assert.equal((await vow(again.near.id)).ok, true, "the vow");
  kit.giveTurn(friend.id);
  const sheet = world.sheet(paladin.id);
  world.patch(paladin.id, {
    conditions: [...sheet.conditions, "readied"],
    conditionMeta: { ...sheet.conditionMeta, readied: { untilTurnOf: paladin.id, holds: "move", trigger: "when the goblin moves" } },
  });
  world.dice(18, 4);
  assert.equal((await world.invoke("enemy_attack", { enemyId: again.near.id, targetCharacterId: paladin.id })).ok, true);
  world.dice(15, 3, 4, 4);
  const off = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Soul of Vengeance", targetEnemyId: again.near.id });
  world.clearDice();
  assert.equal(off.ok, true, off.error);
  assert.equal(world.sheet(paladin.id).conditionMeta.readied?.holds, "move", "the readied move is still held");
});

await test("An attack reaction whose trigger the engine has not seen is refused on the holder's own turn.", async () => {
  const shadow = world.addHero({
    class: "monk", subclass: "Way of Shadow", level: 17, maxHp: 100, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" },
  });
  const { near } = await stage();
  kit.place(shadow.id, 6, 5);
  kit.giveTurn(shadow.id);
  const out = await world.invoke("use_reaction", { characterId: shadow.id, feature: "Opportunist", targetEnemyId: near.id });
  assert.equal(out.ok, false);
  // Refused first for want of the trigger, which the engine now keeps
  // (src/lib/srd/trigger-table.ts: "a creature within 5 feet that another
  // creature just hit"), the own turn second.
  assert.match(out.error, /own turn|another creature has just hit/);
  assert.equal(world.encounter().reactionsUsed.includes(shadow.id), false);
});

world.close();
finish();
