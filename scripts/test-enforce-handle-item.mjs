// Issue #424: what a character does with the things in their hands during a
// fight, held to SRD 5.1 by the engine (handle_item, src/lib/dm/gear-tool.ts).
//
// A shield takes an action to don or doff; armor takes minutes, so it never
// changes in a fight. Drawing or stowing a weapon, picking something up and
// handing it over are the turn's one free object interaction, and a second
// takes the Use an Object action. Dropping costs nothing, and what is
// dropped lies where it fell: on the board, in reach of whoever stands
// within 5 ft, held by an enemy that takes it, on a fallen enemy's body, and
// at the place after the fight.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-handle-item");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listDroppedItems } = await import("../src/lib/db/dropped-items.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { describeGround } = await import("../src/lib/dm/gear-tool.ts");
const { intentRefusal } = await import("../src/lib/dm/intent-check.ts");

const GEAR = () => [
  { name: "Chain Mail", qty: 1, equipped: true },
  { name: "Shield", qty: 1, equipped: false },
  { name: "Longsword", qty: 1, equipped: true },
  { name: "Handaxe", qty: 1, equipped: false },
  { name: "Dagger", qty: 1, equipped: false },
];
const fighter = world.addHero({
  name: "Kara", class: "fighter", level: 5, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED, maxHp: 200, equipment: GEAR(),
});
const ALLY_GEAR = () => [{ name: "Leather Armor", qty: 1, equipped: true }];
const ally = world.addHero({ name: "Mira", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 200, equipment: ALLY_GEAR() });

const handle = (args) => world.invoke("handle_item", { characterId: fighter.id, ...args });
const row = (sheet, name) => world.sheet(sheet.id).equipment.find((item) => item.name === name);
const budget = () => world.encounter().turnBudget;

async function freshFight() {
  await kit.endFight();
  world.patch(fighter.id, { equipment: GEAR() });
  world.patch(ally.id, { equipment: ALLY_GEAR() });
  getDatabase().prepare(`DELETE FROM dropped_items WHERE campaign_id = ?`).run(world.campaignId);
  await kit.fight(1);
  kit.place(fighter.id, 2, 2);
  kit.giveTurn(fighter.id);
}

await test("A shield takes the action to strap on, and with the action spent a second change waits; armor never changes in a fight", async () => {
  await freshFight();
  const on = await handle({ action: "equip", item: "Shield" });
  assert.equal(on.ok, true, on.error);
  assert.equal(row(fighter, "Shield").equipped, true);
  assert.equal(budget().actionUsed, true);
  const off = await handle({ action: "unequip", item: "Shield" });
  assert.equal(off.ok, false);
  // Sword and shield fill the hands: the handaxe has no hand to go to.
  kit.freshTurn();
  const axe = await handle({ action: "equip", item: "Handaxe" });
  assert.equal(axe.ok, false);
  assert.match(axe.error, /hands are full \(Shield and Longsword\)|hands are full \(Longsword and Shield\)/);
  const armor = await handle({ action: "unequip", item: "Chain Mail" });
  assert.equal(armor.ok, false);
  assert.match(armor.error, /Armor takes minutes/);
  assert.equal(row(fighter, "Chain Mail").equipped, true);
});

await test("Drawing a weapon is the free object interaction; a second draw takes the Use an Object action; a third waits for the next turn", async () => {
  await freshFight();
  const first = await handle({ action: "equip", item: "Handaxe" });
  assert.equal(first.ok, true, first.error);
  assert.equal(row(fighter, "Handaxe").equipped, true);
  assert.equal(budget().actionUsed, false);
  assert.ok(budget().interaction);
  // Both hands are full now: a third weapon needs one freed first, and
  // putting one away is not folded into the draw.
  const full = await handle({ action: "equip", item: "Dagger" });
  assert.equal(full.ok, false);
  assert.match(full.error, /hands are full \(Longsword and Handaxe\)/);
  const stowed = await handle({ action: "unequip", item: "Longsword" });
  assert.equal(stowed.ok, true, stowed.error);
  assert.equal(budget().actionUsed, true, "the second object took the Use an Object action");
  const third = await handle({ action: "equip", item: "Dagger" });
  assert.equal(third.ok, false);
  assert.match(third.error, /Use an Object action/);
  // Dropping stays free, whatever is spent.
  const dropped = await handle({ action: "drop", item: "Handaxe" });
  assert.equal(dropped.ok, true, dropped.error);
});

await test("An attack with a stowed weapon draws it as part of the attack, spending the interaction; a later swing with another stowed weapon is refused", async () => {
  await freshFight();
  const [enemy] = world.enemies();
  kit.place(enemy.id, 3, 2);
  const swing = await kit.swing(fighter.id, enemy.id, [2], { weapon: "Handaxe" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(row(fighter, "Handaxe").equipped, true);
  assert.ok(budget().interaction, "the draw spent the interaction");
  // Sword and axe fill the hands: the dagger has no hand to go to.
  const full = await kit.swing(fighter.id, enemy.id, [2], { weapon: "Dagger" });
  assert.equal(full.ok, false);
  assert.match(full.error, /hands are full \(Longsword and Handaxe\)/);
  // Dropping the sword is free, but the interaction went on the axe.
  assert.equal((await handle({ action: "drop", item: "Longsword" })).ok, true);
  const again = await kit.swing(fighter.id, enemy.id, [2], { weapon: "Dagger" });
  assert.equal(again.ok, false);
  assert.match(again.error, /an attack cannot draw it as well/);
  assert.equal(row(fighter, "Dagger").equipped, false);
});

await test("A dropped weapon costs nothing, lies on the board for the party to see, and is picked up only from within 5 ft, with the interaction", async () => {
  await freshFight();
  const dropped = await handle({ action: "drop", item: "Longsword" });
  assert.equal(dropped.ok, true, dropped.error);
  assert.equal(budget()?.actionUsed ?? false, false);
  assert.equal(row(fighter, "Longsword"), undefined);
  const [lying] = listDroppedItems(world.campaignId);
  assert.equal(lying.item.name, "Longsword");
  assert.deepEqual([lying.x, lying.y], [2, 2]);
  assert.equal(lying.item.equipped, undefined, "what lies on the ground is nobody's to wear");
  // The board shows it to the ally, out of reach from where she stands.
  kit.place(ally.id, 6, 2);
  const view = buildPlayerMapView(world.campaignId, ally.userId);
  const seen = view.drops.find((entry) => entry.name === "Longsword");
  assert.ok(seen, "the drop is on the ally's board");
  assert.equal(seen.reach, false);
  kit.giveTurn(ally.id);
  const far = await world.invoke("handle_item", { characterId: ally.id, action: "pick_up", item: lying.id });
  assert.equal(far.ok, false);
  assert.match(far.error, /within 5 ft/);
  kit.place(ally.id, 3, 2);
  assert.equal(buildPlayerMapView(world.campaignId, ally.userId).drops.find((entry) => entry.name === "Longsword").reach, true);
  const took = await world.invoke("handle_item", { characterId: ally.id, action: "pick_up", item: "Longsword" });
  assert.equal(took.ok, true, took.error);
  assert.ok(budget().interaction);
  assert.equal(row(ally, "Longsword").equipped, true, "a hand was free, so she holds it");
  assert.equal(listDroppedItems(world.campaignId).length, 0);
});

// Play-test 2026-11-07: a net thrown from the hand that held it stayed on
// the sheet, equipped, so the hands read as full afterwards and a weapon
// picked up went into the pack.
await test("A thrown net leaves the hand and the pack and lies at the creature it was thrown at, hit or miss", async () => {
  await freshFight();
  world.patch(fighter.id, { equipment: [...GEAR(), { name: "Net", qty: 2, equipped: true }] });
  const [enemy] = world.enemies();
  kit.place(enemy.id, 3, 2);
  const hit = await kit.swing(fighter.id, enemy.id, [18, 18], { weapon: "Net" });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(hit.result.hit, true, JSON.stringify(hit.result));
  assert.equal(row(fighter, "Net").qty, 1, "the net thrown is still in the pack");
  assert.equal(row(fighter, "Net").equipped, false, "the net thrown is still in hand");
  const [lying] = listDroppedItems(world.campaignId);
  assert.equal(lying?.item.name, "Net");
  assert.equal(lying.item.qty, 1);
  assert.deepEqual([lying.x, lying.y], [3, 2], "the net lies at the creature it was thrown at");
  assert.equal(lying.droppedBy, "Kara");
  // Sword in one hand and the other free: the handaxe can be drawn.
  const axe = await handle({ action: "equip", item: "Handaxe" });
  assert.equal(axe.ok, true, axe.error);
  // A miss on the next turn: the second net leaves the sheet as well.
  kit.giveTurn(fighter.id);
  assert.equal((await handle({ action: "drop", item: "Handaxe" })).ok, true);
  const miss = await kit.swing(fighter.id, enemy.id, [2, 2], { weapon: "Net" });
  assert.equal(miss.ok, true, miss.error);
  assert.equal(miss.result.hit, false, JSON.stringify(miss.result));
  assert.equal(row(fighter, "Net"), undefined, "a missed net is still on the sheet");
  assert.equal(listDroppedItems(world.campaignId).filter((entry) => entry.item.name === "Net").length, 2);
  // From within 5 ft it is taken up again, as anything on the ground is.
  kit.giveTurn(fighter.id);
  const took = await handle({ action: "pick_up", item: "Net" });
  assert.equal(took.ok, true, took.error);
  assert.equal(row(fighter, "Net").qty, 1);
});

// SRD 5.1, Net: "A creature can use its action to make a DC 10 Strength
// check, freeing itself ... Dealing 5 slashing damage to the net (AC 10) also
// frees the creature without harming it, ending the effect and destroying the
// net." Neither was wired: an enemy's take_action escape found "nothing to
// escape", and a blow at the net was a wooden object's.
await test("A net's hold ends by its own rule: a DC 10 Strength check frees the creature and leaves the net; 5 slashing to the net (AC 10) frees it unharmed and destroys the net", async () => {
  await freshFight();
  world.patch(fighter.id, { equipment: [...GEAR(), { name: "Net", qty: 2, equipped: true }] });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 40, stats: { abilities: { str: 10 } } });
  kit.place(enemy.id, 3, 2);
  const restrained = () => kit.enemy(enemy.id).conditions.includes("restrained");
  const throwNet = async () => {
    kit.giveTurn(fighter.id);
    const hit = await kit.swing(fighter.id, enemy.id, [18, 18], { weapon: "Net" });
    assert.equal(hit.ok, true, hit.error);
    assert.ok(restrained(), "the net did not restrain it");
  };
  await throwNet();
  // Its action and a Strength check: a 9 stays, a 10 breaks free.
  kit.freshRound();
  kit.dice(9);
  const stuck = await world.invoke("take_action", { action: "escape", enemyId: enemy.id });
  assert.equal(stuck.ok, true, stuck.error);
  assert.equal(stuck.result.success, false);
  assert.ok(restrained());
  kit.freshRound();
  kit.dice(10);
  const free = await world.invoke("take_action", { action: "escape", enemyId: enemy.id });
  assert.equal(free.ok, true, free.error);
  assert.equal(free.result.success, true, JSON.stringify(free.result));
  assert.ok(!restrained(), "a 10 against DC 10 left it restrained");
  assert.equal(listDroppedItems(world.campaignId).filter((entry) => entry.item.name === "Net").length, 1, "the net broken free of no longer lies where it fell");
  // The second net, cut: 4 bludgeoning does nothing, 5 slashing cuts it.
  await throwNet();
  const hp = kit.enemy(enemy.id).currentHp;
  const blunt = await world.invoke("damage_object", { name: "Net", damage: "6", damageType: "bludgeoning" });
  assert.equal(blunt.ok, true, blunt.error);
  assert.equal(blunt.result.ac, 10);
  assert.ok(restrained(), "bludgeoning cut the net");
  const cut = await world.invoke("damage_object", { name: "Net", damage: "5", damageType: "slashing" });
  assert.equal(cut.ok, true, cut.error);
  assert.equal(cut.result.broken, true, JSON.stringify(cut.result));
  assert.ok(!restrained(), "the net cut through still restrains it");
  assert.equal(kit.enemy(enemy.id).currentHp, hp, "cutting the net harmed the creature");
  assert.equal(listDroppedItems(world.campaignId).filter((entry) => entry.item.name === "Net").length, 1, "the net cut through still lies on the ground");
  // With no creature held, "Net" is refused, not a wooden door.
  const none = await world.invoke("damage_object", { name: "Net", damage: "5", damageType: "slashing" });
  assert.equal(none.ok, false);
});

// The same fault as the net, for every weapon thrown: a javelin held in hand
// and thrown 20 feet stayed in the hand and on the sheet, so it could be
// thrown at every attack, and a dagger drawn and thrown stayed in the pack.
// A dagger used within reach is a stab, not a throw, and a Dwarven Thrower
// "flies back to your hand" (SRD 5.1).
await test("A weapon thrown at range leaves the hand and the pack and lies at its target, hit or miss; a stab within reach keeps it", async () => {
  await freshFight();
  world.patch(fighter.id, {
    equipment: [
      { name: "Chain Mail", qty: 1, equipped: true },
      { name: "Javelin", qty: 1, equipped: false },
      { name: "Javelin", qty: 1, equipped: true },
      { name: "Dagger", qty: 1, equipped: true },
    ],
  });
  const [enemy] = world.enemies();
  kit.place(enemy.id, 6, 2);
  const hit = await kit.swing(fighter.id, enemy.id, [18, 3], { weapon: "Javelin" });
  assert.equal(hit.ok, true, hit.error);
  // The held line went: the one left is the stowed one.
  const javelins = world.sheet(fighter.id).equipment.filter((item) => item.name === "Javelin");
  assert.deepEqual(javelins.map((item) => item.equipped), [false], "the javelin thrown is still in hand or in the pack");
  const lying = listDroppedItems(world.campaignId).find((entry) => entry.item.name === "Javelin");
  assert.deepEqual([lying?.x, lying?.y], [6, 2], "the javelin lies at the creature it was thrown at");
  // A stab within reach keeps the dagger in hand.
  kit.giveTurn(fighter.id);
  kit.place(enemy.id, 3, 2);
  const stab = await kit.swing(fighter.id, enemy.id, [18, 3], { weapon: "Dagger" });
  assert.equal(stab.ok, true, stab.error);
  assert.equal(row(fighter, "Dagger")?.equipped, true, "a stab let go of the dagger");
  // Thrown, a miss: it leaves the sheet all the same.
  kit.giveTurn(fighter.id);
  kit.place(enemy.id, 6, 2);
  const miss = await kit.swing(fighter.id, enemy.id, [2, 3], { weapon: "Dagger" });
  assert.equal(miss.ok, true, miss.error);
  assert.equal(miss.result.hit, false, JSON.stringify(miss.result));
  assert.equal(row(fighter, "Dagger"), undefined, "a dagger thrown and missed is still on the sheet");
  assert.ok(listDroppedItems(world.campaignId).some((entry) => entry.item.name === "Dagger" && entry.x === 6));
  const { returnsToHand } = await import("../src/lib/dm/gear-ground.ts");
  assert.equal(returnsToHand("Dwarven Thrower"), true);
  assert.equal(returnsToHand("Javelin"), false);
});

await test("A strapped-on shield is not dropped for free: taking it off is the action", async () => {
  await freshFight();
  world.patch(fighter.id, { equipment: GEAR().map((item) => (item.name === "Shield" ? { ...item, equipped: true } : item)) });
  const dropped = await handle({ action: "drop", item: "Shield" });
  assert.equal(dropped.ok, false);
  assert.match(dropped.error, /taking it off is an action/);
});

await test("Handing something over takes being within 5 ft and the interaction, and the ally holds it", async () => {
  await freshFight();
  kit.place(ally.id, 8, 8);
  const far = await handle({ action: "hand", item: "Dagger", toCharacterId: ally.id });
  assert.equal(far.ok, false);
  assert.match(far.error, /within 5 ft/);
  kit.place(ally.id, 2, 3);
  const handed = await handle({ action: "hand", item: "Dagger", toCharacterId: ally.id });
  assert.equal(handed.ok, true, handed.error);
  assert.equal(row(fighter, "Dagger"), undefined);
  assert.ok(row(ally, "Dagger"));
  assert.ok(budget().interaction);
});

await test("An enemy that takes a dropped weapon holds it until it falls; then it lies with the body, and after the fight it is collected at the place", async () => {
  await freshFight();
  const [enemy] = world.enemies();
  kit.place(enemy.id, 3, 2);
  await handle({ action: "drop", item: "Longsword" });
  const grabbed = await world.invoke("handle_item", { enemyId: enemy.id, action: "pick_up", item: "Longsword" });
  assert.equal(grabbed.ok, true, grabbed.error);
  assert.equal(listDroppedItems(world.campaignId)[0].heldByEnemy, enemy.id);
  assert.match(describeGround(world.campaignId).join("\n"), /Longsword/);
  // It falls; the fight ends.
  getDatabase().prepare(`UPDATE encounter_enemies SET status = 'dead', current_hp = 0 WHERE id = ?`).run(enemy.id);
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  assert.match(JSON.stringify(ended.result), /Longsword lies with/);
  const [lying] = listDroppedItems(world.campaignId);
  assert.equal(lying.heldByEnemy, null);
  const collected = await handle({ action: "pick_up", item: "Longsword" });
  assert.equal(collected.ok, true, collected.error);
  assert.ok(row(fighter, "Longsword"));
});

await test("What an enemy lets fall is asked what it is, as grant_item asks, at every table; picked up, it is the row its srdName names", async () => {
  const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { listSheets } = await import("../src/lib/db/sheets.ts");
  const { matchWeapon } = await import("../src/lib/srd/weapons.ts");
  const ai = (args) => {
    const sheets = listSheets(world.campaignId);
    return dispatchAdjudication("handle_item", JSON.stringify(args), {
      campaign: world.campaign(), turn: createDmTurn(world.campaignId, []), sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set(),
    });
  };
  for (const name of ["Scimitarra", "Cimeterre", "Cimitarra", "Krummsäbel", "Curved blade"]) {
    await freshFight();
    const [enemy] = world.enemies();
    kit.place(enemy.id, 3, 2);
    const asked = await ai({ enemyId: enemy.id, action: "drop", item: name });
    assert.equal(asked.retry, true, `${name}: dropped without asking what it is`);
    assert.match(asked.error, /srdName/);
    assert.equal(listDroppedItems(world.campaignId).length, 0);
    const dropped = await ai({ enemyId: enemy.id, action: "drop", item: name, srdName: "Scimitar" });
    assert.equal(dropped.ok, true, dropped.error);
    assert.equal(listDroppedItems(world.campaignId)[0].item.srdName, "Scimitar");
    const taken = await handle({ action: "pick_up", item: name });
    assert.equal(taken.ok, true, taken.error);
    assert.equal(matchWeapon(row(fighter, name))?.name, "Scimitar", name);
  }
  // handle_item names no spell: a scroll that falls is granted as grant_item grants one.
  for (const name of ["Pergamena", "Parchemin", "Pergamino", "Schriftrolle", "Scroll"]) {
    await freshFight();
    const [enemy] = world.enemies();
    const asked = await ai({ enemyId: enemy.id, action: "drop", item: name, srdName: "Spell Scroll" });
    assert.equal(asked.retry, true, `${name}: a scroll dropped with no spell`);
    assert.match(asked.error, /grant it with grant_item, naming the spell/);
    assert.equal(listDroppedItems(world.campaignId).length, 0);
  }
});

await test("A gear card is free to send with the action spent: the tool charges what the move costs, and a drop costs nothing", async () => {
  await freshFight();
  await handle({ action: "equip", item: "Shield" });
  assert.equal(budget().actionUsed, true);
  const intent = { card: "gear", action: "drop", item: "Longsword" };
  assert.equal(intentRefusal(world.campaign(), world.sheet(fighter.id), intent), null);
});

await test("The sheet's own equip toggle charges the same in a fight: a draw is the interaction, and a third weapon in full hands is refused", async () => {
  await freshFight();
  const route = await world.route("campaigns/[campaignId]/sheet/usage");
  const toggle = async (gear) => {
    world.signIn({ id: fighter.userId });
    const response = await route.POST(
      new Request("http://test/", { method: "POST", body: JSON.stringify({ characterId: fighter.id, gear }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, json: await response.json() };
  };
  const drawn = await toggle({ Handaxe: { equipped: true } });
  assert.equal(drawn.status, 200, JSON.stringify(drawn.json));
  assert.ok(budget().interaction);
  assert.equal(budget().actionUsed, false);
  const full = await toggle({ Dagger: { equipped: true } });
  assert.notEqual(full.status, 200);
  assert.match(full.json.error, /hands are full/);
  assert.equal(row(fighter, "Dagger").equipped, false);
});

finish();
