// Chronal Shift (Chronurgy Magic, 2nd level) spent its use and its reaction
// and changed nothing: no card came up when an attack hit, so the wizard never
// had the moment it is for. "After you or a creature you can see within 30 feet
// of you makes an attack roll... you can use your reaction to force that creature
// to reroll. You make this decision after you see whether the roll succeeds or
// fails. The target must use the result of the second roll." An attack that hit
// the wizard or a creature within 30 feet is now answered: a card for it, and
// the attacker's d20 rolled again, the new roll standing.
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

await test("With no hit open there is no reaction card, and use_resource still spends a use for a check or a save.", async () => {
  await stage();
  assert.equal(world.sheet(wizard.id).resources[COUNTER].max, 2);
  assert.equal(offered().length, 0, "no hit, no card");
  // A check or a save is thrown and settled in one call, so nothing waits for
  // the reaction there: the GM spends it and narrates the reroll, as before.
  const out = await world.invoke("use_resource", { characterId: wizard.id, resource: "Chronal Shift" });
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.effect, /use_reaction 'Chronal Shift'/);
  assert.equal(used(), 1);
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

await test("An ally beyond 30 feet gets no card and is refused with nothing spent; exactly 30 feet reaches.", async () => {
  const enemy = await stage();
  await strike(enemy, ally);
  const apart = () => ({ [ally.id]: tilesApart(kit.token(wizard.id), kit.token(ally.id)) * 5 });
  kit.place(ally.id, 5, 11);
  assert.equal(apart()[ally.id], 30);
  assert.equal(offered(apart()).length, 1);
  kit.place(ally.id, 5, 12);
  assert.equal(apart()[ally.id], 35);
  assert.equal(offered(apart()).length, 0);
  const out = await shift([2], ally);
  assert.match(out.error, /beyond 30 feet/);
  assert.equal(used(), 0);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.ok(reactionKept());
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

world.close();
finish();
