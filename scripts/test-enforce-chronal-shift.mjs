// Chronal Shift (Chronurgy Magic, 2nd level) spent its use and its reaction
// and changed nothing: no card came up when an attack hit, so the wizard never
// had the moment it is for. "After you or a creature you can see within 30 feet
// of you makes an attack roll... you can use your reaction to force that creature
// to reroll. You make this decision after you see whether the roll succeeds or
// fails. The target must use the result of the second roll." An attack that hit
// the wizard or an ally, made from within 30 feet, is now answered: a card for it, and
// the attacker's d20 rolled again, the new roll standing. The 30 feet are to the
// creature that rolled, the attacker, not to the one it hit.
//
// Dice forced; every check reads a sheet, a card or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-chronal-shift");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { tilesApart } = await import("../src/lib/dm/board-reach.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { call } = await import("./lib/enforce-campaign.mjs");
const afterRoll = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

const hero = (classId, subclass, level = 20) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const wizard = hero("wizard", "Chronurgy Magic");
const ally = hero("rogue", "Thief", 1);

const COUNTER = "sub_chronal_shift";
const used = () => world.sheet(wizard.id).resources[COUNTER].used;

async function stage() {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [wizard.id]: 3 } });
  const [enemy, other] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(other.id, 6, 8);
  kit.place(wizard.id, 5, 5);
  kit.place(ally.id, 5, 7);
  kit.place(enemy.id, 5, 8);
  kit.freshRound();
  world.patch(ally.id, { currentHp: 50, maxHp: 100, ac: 12, conditions: [], conditionMeta: {} });
  const resources = world.sheet(wizard.id).resources;
  world.patch(wizard.id, { currentHp: 50, conditions: [], conditionMeta: {}, resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used: 0 } } });
  return enemy;
}
// A club at +4, 1d6+2: a 16 on the die is a 20, through AC 12, for 6.
const strike = async (enemy, target, faces = [16, 4]) => {
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const shift = async (faces, target) => {
  world.dice(...faces);
  const out = await world.invoke("use_reaction", { characterId: wizard.id, feature: "Chronal Shift", ...(target ? { targetCharacterId: target.id } : {}) });
  world.clearDice();
  return out;
};
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
const offered = (feet) =>
  reactionCards(world.sheet(wizard.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets(), "you", feet).filter((card) => card.name === "Chronal Shift");
const reactionKept = () => !world.encounter().reactionsUsed.includes(wizard.id);

await test("With no hit open there is no reaction card, and a plain use_resource is sent to use_reaction, spending nothing.", async () => {
  await stage();
  assert.equal(world.sheet(wizard.id).resources[COUNTER].max, 2);
  assert.equal(offered().length, 0, "no hit, no card");
  // The use and the reaction go with the reroll they buy: use_reaction for an
  // attack roll, the roll's own card or the watch stop for a check or a save
  // (src/lib/dm/chronal-shift.ts). A plain spend took the use and rolled
  // nothing again ("forces a reroll ... and the second roll stands").
  const out = await world.invoke("use_resource", { characterId: wizard.id, resource: "Chronal Shift" });
  assert.equal(out.ok, false);
  assert.match(out.error, /use_reaction/);
  assert.equal(used(), 0);
});

await test("A hit on an ally deals a card aimed at that ally, and a reroll that misses gives the hit points back.", async () => {
  const enemy = await stage();
  await strike(enemy, ally);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  const cards = offered();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].target, "ally");
  assert.equal(cards[0].answers?.characterId, ally.id);
  assert.equal(cards[0].rules, "The attacker rolls the d20 again and must use the new roll.");
  const out = await shift([2], ally);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /6 against AC 12 misses/);
  assert.equal(world.sheet(ally.id).currentHp, 50);
  assert.equal(used(), 1);
  assert.equal(reactionKept(), false);
  assert.equal(offered().length, 0, "the hit is answered");
});

await test("A hit on the wizard deals a card on themselves, and unnamed the reaction answers it.", async () => {
  const enemy = await stage();
  kit.place(enemy.id, 5, 6);
  await strike(enemy, wizard);
  assert.equal(world.sheet(wizard.id).currentHp, 44);
  const cards = offered();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].target, "none");
  assert.equal(cards[0].answers?.characterId, wizard.id);
  const out = await shift([2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(wizard.id).currentHp, 50);
  assert.equal(used(), 1);
});

await test("The new roll stands when it still hits: the use is spent and the hit cannot be answered again.", async () => {
  const enemy = await stage();
  await strike(enemy, ally);
  const out = await shift([15], ally);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /19 against AC 12 still hits/);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.equal(used(), 1);
  assert.equal(offered().length, 0);
});

await test("The 30 feet are to the attacker, wherever the ally it hit stands: an ally 35 feet off is answered, an attacker 35 feet off is not.", async () => {
  const enemy = await stage();
  const apart = (id) => tilesApart(kit.token(wizard.id), kit.token(id)) * 5;
  const feet = () => ({ [ally.id]: apart(ally.id), [enemy.id]: apart(enemy.id) });
  // The goblin swings from 15 feet at an ally beside it, 35 feet from the wizard.
  kit.place(ally.id, 5, 12);
  kit.place(enemy.id, 5, 8);
  kit.place(enemy.id, 5, 11);
  await strike(enemy, ally);
  kit.place(enemy.id, 5, 8);
  assert.equal(feet()[ally.id], 35);
  assert.equal(offered(feet()).length, 1, "the attacker is 15 feet off");
  const out = await shift([2], ally);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 50);
  assert.equal(used(), 1);
});

await test("An attacker beyond 30 feet gets no card and is refused with nothing spent, on the wizard or an ally beside them; exactly 30 feet reaches.", async () => {
  for (const target of [ally, wizard]) {
    const enemy = await stage();
    kit.place(enemy.id, 5, target === wizard ? 6 : 8);
    await strike(enemy, target);
    const feet = () => ({ [ally.id]: tilesApart(kit.token(wizard.id), kit.token(ally.id)) * 5, [enemy.id]: tilesApart(kit.token(wizard.id), kit.token(enemy.id)) * 5 });
    kit.place(enemy.id, 5, 11);
    assert.equal(feet()[enemy.id], 30);
    assert.equal(offered(feet()).length, 1, `30 feet reaches (${target.name})`);
    kit.place(enemy.id, 5, 12);
    assert.equal(feet()[enemy.id], 35);
    assert.equal(offered(feet()).length, 0, `35 feet does not (${target.name})`);
    const out = await shift([2], target === wizard ? undefined : target);
    assert.match(String(out.error), /beyond 30 feet/);
    assert.equal(used(), 0);
    assert.equal(world.sheet(target.id).currentHp, 44);
    assert.ok(reactionKept());
  }
});

await test("With both uses spent there is no card, and the reaction refuses with nothing changed.", async () => {
  const enemy = await stage();
  const resources = world.sheet(wizard.id).resources;
  world.patch(wizard.id, { resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used: 2 } } });
  await strike(enemy, ally);
  assert.equal(offered().length, 0);
  const out = await shift([2], ally);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.ok(reactionKept());
});

await test("A wizard of another school has no card for the hit.", async () => {
  const other = hero("wizard", "School of Evocation");
  const enemy = await stage();
  kit.place(other.id, 5, 6);
  await strike(enemy, ally);
  const cards = reactionCards(world.sheet(other.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets()).filter((card) => card.name === "Chronal Shift");
  assert.equal(cards.length, 0);
});

// ---- the wizard's own roll ("after you ... make an ... ability check, or a
// saving throw"): the after-the-roll card offers it, as it offers Lucky ----

const ownSave = async (face) => {
  for (const pending of listOpenPendingRolls(world.campaignId)) {
    world.signIn(world.owner);
    await call(afterRoll, "POST", { keep: true }, { campaignId: world.campaignId, pendingRollId: pending.id });
  }
  world.dice(face);
  const out = await world.invoke("request_roll", { characterId: wizard.id, kind: "saving_throw", ability: "wis", dc: 15, reason: "a mind reaching for theirs" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return listOpenPendingRolls(world.campaignId).find((pending) => pending.characterId === wizard.id) ?? null;
};

await test("The wizard's own failed save waits with Chronal Shift on the card: the use and the reaction are spent, and the new roll stands.", async () => {
  await stage();
  const pending = await ownSave(3);
  assert.ok(pending, "the failed save waits");
  assert.ok(pending.thrown.options.some((option) => option.id === "chronal_shift"), JSON.stringify(pending.thrown.options));
  world.signIn(world.owner);
  world.dice(18);
  const res = await call(afterRoll, "POST", { use: "chronal_shift" }, { campaignId: world.campaignId, pendingRollId: pending.id });
  world.clearDice();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(used(), 1);
  assert.equal(reactionKept(), false);
  const landed = listRecentRolls(world.campaignId, 20).find((roll) => roll.id === getPendingRoll(pending.id).rollId);
  assert.equal(landed?.breakdown.natural, 18, "the second roll stands");
});

await test("With the reaction spent this round, or no use left, the card has no Chronal Shift.", async () => {
  await stage();
  const encounter = world.encounter();
  const { saveEncounter } = await import("../src/lib/db/encounters.ts");
  saveEncounter({ ...encounter, reactionsUsed: [...encounter.reactionsUsed, wizard.id] });
  const spentReaction = await ownSave(3);
  // Nothing else to offer: the save lands at once instead of waiting.
  assert.ok(!spentReaction || !spentReaction.thrown.options.some((option) => option.id === "chronal_shift"), "the reaction is spent");
  assert.equal(used(), 0);
  await stage();
  const resources = world.sheet(wizard.id).resources;
  world.patch(wizard.id, { resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used: 2 } } });
  const noUse = await ownSave(3);
  assert.ok(!noUse || !noUse.thrown.options.some((option) => option.id === "chronal_shift"), "no use left");
});

world.close();
finish();
