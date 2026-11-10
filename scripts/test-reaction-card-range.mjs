// Every reaction card said "Self" in its corner, including the ones aimed at an
// ally or an attacker. A card now names the reach it has, and "Self" stays on the
// cards that only ever cover their holder.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-reaction-card-range");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");

const hero = (extra) =>
  world.addHero({
    user: world.owner, level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 },
    portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }],
    ...extra,
  });
const friend = hero({ class: "fighter", subclass: "Champion" });

async function stage(who) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [who.id]: 3, [friend.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(who.id, 5, 5);
  kit.place(friend.id, 4, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  world.patch(who.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  world.patch(friend.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  return enemy;
}
const strike = async (enemy, target) => {
  world.dice(16, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const cards = (who) =>
  reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, activePublicEncounter(world.campaignId)?.lastHits ?? [], world.sheets());
const card = (who, name) => {
  const found = cards(who).find((entry) => entry.name === name);
  assert.ok(found, `${name} is offered (${cards(who).map((entry) => entry.name).join(", ")})`);
  return found;
};

for (const [name, range, extra] of [
  ["Cutting Words", "60 ft", { class: "bard", subclass: "College of Lore" }],
  ["Glorious Defense", "10 ft", { class: "paladin", subclass: "Oath of Glory" }],
  ["Protection", "5 ft", { class: "fighter", features: [{ name: "Fighting Style: Protection", source: "class", level: 1 }] }],
  ["Warding Maneuver", "5 ft", { class: "fighter", subclass: "Cavalier" }],
  ["Runic Shield", "60 ft", { class: "fighter", subclass: "Rune Knight" }],
  // "A creature you can see attacks a target other than you that you can see":
  // no feet on record, and a blank corner said nothing.
  ["Shadow Martyr", "Sight", { class: "fighter", subclass: "Echo Knight" }],
]) {
  await test(`${name} on an ally's hit names its reach, ${range}.`, async () => {
    const who = hero(extra);
    // The style is a choice made at level 1, written straight to the sheet.
    if (extra.features) world.patch(who.id, { features: extra.features });
    const enemy = await stage(who);
    // Shadow Martyr needs the echo out (Manifest Echo's mark).
    if (name === "Shadow Martyr") world.patch(who.id, { conditions: [...world.sheet(who.id).conditions, "echo manifested"] });
    await strike(enemy, friend);
    const held = card(who, name);
    assert.equal(held.target, "ally");
    assert.equal(held.range, range);
  });
}

await test("Hellish Rebuke, aimed at the attacker, names the spell's range.", async () => {
  const who = hero({ class: "warlock", spellcasting: { ability: "cha", slots: { 2: { max: 2, used: 0 } }, prepared: [], known: ["Hellish Rebuke"], cantrips: [] } });
  await strike(await stage(who), who);
  const held = card(who, "Hellish Rebuke");
  assert.equal(held.target, "enemy");
  assert.equal(held.range, "60 ft");
});

await test("A reaction that only covers its holder still says Self.", async () => {
  const who = hero({ class: "rogue", subclass: "Thief" });
  await strike(await stage(who), who);
  const held = card(who, "Uncanny Dodge");
  assert.equal(held.target, "none");
  assert.equal(held.range, "Self");
});

await test("A subclass reaction on the holder's own hit says Self, and on an ally's hit its reach.", async () => {
  const who = hero({ class: "paladin", subclass: "Oath of Glory" });
  await strike(await stage(who), who);
  assert.equal(card(who, "Glorious Defense").range, "Self");
  await strike(await stage(who), friend);
  assert.equal(card(who, "Glorious Defense").range, "10 ft");
});

await test("A reaction that turns the hit onto a creature beside the holder names 5 feet, not Self.", async () => {
  const who = hero({ class: "rogue", subclass: "Mastermind" });
  await strike(await stage(who), who);
  assert.equal(card(who, "Misdirection").range, "5 ft");
});

await test("Sentinel at Death's Door names its 30 feet on an ally's critical, and Self on the holder's own.", async () => {
  const who = hero({ class: "cleric", subclass: "Grave Domain" });
  const crit = async (target) => {
    const enemy = await stage(who);
    world.dice(20, 4, 3);
    const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  };
  await crit(friend);
  assert.equal(card(who, "Sentinel at Death's Door").range, "30 ft");
  await crit(who);
  assert.equal(card(who, "Sentinel at Death's Door").range, "Self");
});

await test("A melee strike back with no reach on record says Melee.", async () => {
  const who = hero({ class: "cleric", subclass: "Tempest Domain" });
  await strike(await stage(who), who);
  const held = card(who, "Wrath of the Storm");
  assert.equal(held.target, "enemy");
  assert.equal(held.range, "Melee");
});

await test("No card for an ally says Self: each of these names a reach or none.", async () => {
  for (const extra of [
    { class: "bard", subclass: "College of Lore" },
    { class: "paladin", subclass: "Oath of Glory" },
    { class: "cleric", subclass: "Light Domain" },
    { class: "fighter", subclass: "Cavalier" },
  ]) {
    const who = hero(extra);
    await strike(await stage(who), friend);
    const aimed = cards(who).filter((entry) => entry.target !== "none");
    assert.ok(aimed.length > 0, `${extra.subclass} has a card for the ally`);
    for (const entry of aimed) {
      assert.notEqual(entry.range, "Self", `${entry.name} is aimed at someone else`);
    }
  }
});

world.close();
finish();
