// Using, buying, selling and carrying things, from the 2026-11-16 rules audit
// (the items lens, findings I01..). Each test names its finding and the SRD
// 5.1 rule it holds the engine to.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-audit1116-items");
const world = await openWorld({ campaign: { maxPlayers: 40 } });
const { insertShop } = await import("../src/lib/db/shops.ts");
const { ammoCount, ammoKindForItem } = await import("../src/lib/srd/ammunition.ts");
const { purseCopper } = await import("../src/lib/srd/currency.ts");

const purse = (id) => purseCopper({ gold: world.sheet(id).gold, copper: world.sheet(id).copper ?? 0 });
// Every round of one kind a pack holds, over all its lines, as a shot reads
// each line (src/lib/srd/ammunition.ts ammoCount).
const rounds = (id, kind) => world.sheet(id).equipment.filter((item) => ammoKindForItem(item) === kind).reduce((sum, item) => sum + ammoCount(item), 0);

// I01. SRD 5.1, Adventuring Gear: "Arrows (20) 1 gp", "Blowgun needles (50)
// 1 gp", "Crossbow bolts (20) 1 gp", "Sling bullets (20) 4 cp"; Selling
// Treasure: equipment fetches half its cost. A pack counts ammunition by the
// round (the starting kit's "Arrows" x20, what a shot spends). The bundle's
// gold piece was charged for every arrow, a bundle bought twice was counted
// as two arrows, and twenty arrows sold for 10 gp.
await test("I01: twenty arrows bought by the round cost the bundle's 1 gp and land as twenty more arrows", async () => {
  const archer = world.addHero({ class: "ranger", level: 3, gold: 10, equipment: [{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 20 }] });
  const bought = await world.invoke("purchase", { characterId: archer.id, action: "buy", item: "Arrows", qty: 20 });
  assert.equal(bought.ok, true, bought.error);
  assert.equal(purse(archer.id), 900, `twenty arrows cost 1 gp: the purse holds ${purse(archer.id)} cp`);
  assert.equal(rounds(archer.id, "arrows"), 40);
});

await test("I01: two bundles bought outside a shop are forty arrows, on the quiver's own line", async () => {
  const archer = world.addHero({ class: "ranger", level: 3, gold: 10, equipment: [{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 5 }] });
  const bought = await world.invoke("purchase", { characterId: archer.id, action: "buy", item: "Arrows (20)", qty: 2 });
  assert.equal(bought.ok, true, bought.error);
  assert.equal(purse(archer.id), 800, "two bundles cost 2 gp");
  assert.equal(rounds(archer.id, "arrows"), 45);
  assert.deepEqual(world.sheet(archer.id).equipment.filter((item) => ammoKindForItem(item)).map((item) => [item.name, item.qty]), [["Arrows", 45]]);
});

await test("I01: a shop's bundle bought on two visits leaves forty arrows, not two", async () => {
  insertShop(world.campaignId, { name: "The Fletcher", kind: "general", size: "town", markup: 1, stock: [{ itemName: "Crossbow Bolts (20)", qty: 6, priceCp: 100, note: "" }] });
  const archer = world.addHero({ class: "fighter", level: 3, gold: 10, equipment: [{ name: "Light Crossbow", qty: 1 }] });
  for (const visit of [1, 2]) {
    const bought = await world.invoke("buy_item", { characterId: archer.id, shop: "The Fletcher", item: "Crossbow Bolts (20)", qty: 1 });
    assert.equal(bought.ok, true, `visit ${visit}: ${bought.error}`);
  }
  assert.equal(purse(archer.id), 800);
  assert.equal(rounds(archer.id, "bolts"), 40, "two bundles of twenty bolts");
});

await test("I01: twenty arrows sold fetch half the bundle's price, 5 sp, at a counter and outside one", async () => {
  const seller = world.addHero({ class: "ranger", level: 3, gold: 0, equipment: [{ name: "Arrows", qty: 30 }] });
  const sold = await world.invoke("purchase", { characterId: seller.id, action: "sell", item: "Arrows", qty: 20 });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(purse(seller.id), 50, `half of 1 gp: the purse holds ${purse(seller.id)} cp`);
  insertShop(world.campaignId, { name: "The Quiver", kind: "general", size: "town", markup: 1, buys: true, stock: [] });
  const shopSale = await world.invoke("sell_item", { characterId: seller.id, shop: "The Quiver", item: "Arrows", qty: 10 });
  assert.equal(shopSale.ok, true, shopSale.error);
  assert.equal(purse(seller.id), 75, `ten more arrows fetch 2 sp 5 cp: the purse holds ${purse(seller.id)} cp`);
});

await test("I01: twenty sling bullets cost 4 cp and sell for 2 cp, never a copper apiece", async () => {
  const slinger = world.addHero({ class: "rogue", level: 3, gold: 1, equipment: [{ name: "Sling", qty: 1 }] });
  const bought = await world.invoke("purchase", { characterId: slinger.id, action: "buy", item: "Sling Bullets (20)", qty: 1 });
  assert.equal(bought.ok, true, bought.error);
  assert.equal(purse(slinger.id), 96);
  assert.equal(rounds(slinger.id, "bullets"), 20);
  const sold = await world.invoke("purchase", { characterId: slinger.id, action: "sell", item: "Sling Bullets", qty: 20 });
  assert.equal(sold.ok, true, sold.error);
  assert.equal(purse(slinger.id), 98, "half of 4 cp");
});

await test("I01: an old bundle line handed to a friend who has one keeps both counts", async () => {
  const giver = world.addHero({ class: "ranger", level: 3, equipment: [{ name: "Arrows (20)", qty: 1 }] });
  const taker = world.addHero({ class: "ranger", level: 3, equipment: [{ name: "Arrows (20)", qty: 1 }] });
  const handed = await world.invoke("handle_item", { characterId: giver.id, action: "hand", item: "Arrows (20)", toCharacterId: taker.id });
  assert.equal(handed.ok, true, handed.error);
  assert.equal(rounds(taker.id, "arrows"), 40);
});

// I02. SRD 5.1, Berserker Axe: "This axe is cursed, and becoming attuned to
// it extends the curse to you. As long as you remain cursed, you are
// unwilling to part with the axe"; Remove Curse: "If the object is a cursed
// magic item, its curse remains, but the spell breaks its owner's attunement
// to the object so it can be removed or discarded." The sheet refused to end
// the attunement, but handing the axe over, dropping it, selling it or
// trading it away ended it at once; and Remove Curse broke nothing, so the
// sheet's refusal never lifted.
const cursedAxe = () => ({ name: "Berserker Axe", qty: 1, attuned: true, equipped: true });
const cleric = () => world.addHero({
  class: "cleric",
  level: 5,
  abilities: { wis: 16 },
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 3: { max: 2, used: 0 } }, prepared: ["Remove Curse"], known: [], cantrips: [] },
});

await test("I02: an attuned Berserker Axe is not handed over, dropped, sold or traded away while the curse holds", async () => {
  const bearer = world.addHero({ class: "barbarian", level: 5, equipment: [cursedAxe()] });
  const friend = world.addHero({ class: "fighter", level: 5 });
  const tries = [
    ["hand", () => world.invoke("handle_item", { characterId: bearer.id, action: "hand", item: "Berserker Axe", toCharacterId: friend.id })],
    ["drop", () => world.invoke("handle_item", { characterId: bearer.id, action: "drop", item: "Berserker Axe" })],
    ["sell", () => world.invoke("purchase", { characterId: bearer.id, action: "sell", item: "Berserker Axe", price: 500 })],
  ];
  for (const [label, attempt] of tries) {
    const out = await attempt();
    assert.equal(out.ok, false, `${label}: the curse keeps the axe in hand`);
    assert.match(String(out.error), /curse/i, label);
    assert.deepEqual(world.sheet(bearer.id).equipment.map((item) => [item.name, item.attuned]), [["Berserker Axe", true]], label);
  }
  insertShop(world.campaignId, { name: "Axe and Anvil", kind: "smith", size: "town", markup: 1, buys: true, stock: [] });
  const atShop = await world.invoke("sell_item", { characterId: bearer.id, shop: "Axe and Anvil", item: "Berserker Axe", priceCp: 50000 });
  assert.equal(atShop.ok, false);
  const { computeTrade } = await import("../src/lib/dm/trade-logic.ts");
  const traded = computeTrade(world.sheet(bearer.id), world.sheet(friend.id), { toCharacterId: friend.id, give: [{ name: "Berserker Axe", qty: 1 }], giveCp: 0, want: [], wantCp: 0 });
  assert.ok("error" in traded, "a trade cannot carry the axe off either");
});

await test("I02: Remove Curse breaks the attunement to a cursed item, and then the axe can be set down", async () => {
  const bearer = world.addHero({ class: "barbarian", level: 5, equipment: [cursedAxe()] });
  const priest = cleric();
  const lifted = await world.invoke("cast_buff", { characterId: priest.id, spell: "Remove Curse", targetCharacterIds: [bearer.id], level: 3 });
  assert.equal(lifted.ok, true, lifted.error);
  assert.equal(world.sheet(bearer.id).equipment[0].attuned, undefined, "the attunement is broken");
  assert.match(JSON.stringify(lifted.result), /Berserker Axe/);
  const dropped = await world.invoke("handle_item", { characterId: bearer.id, action: "drop", item: "Berserker Axe" });
  assert.equal(dropped.ok, true, dropped.error);
});

// I03. SRD 5.1, Attunement: "A creature's attunement to an item ends if the
// creature no longer satisfies the prerequisites for attunement, if the item
// has been more than 100 feet away for at least 24 hours, if the creature
// dies, or if another creature attunes to the item." A hand-over is none of
// these: the fighter who lends the cloak for a moment is still attuned when
// it comes back. The engine ended the attunement with every hand-over and
// trade, so the cloak came back needing a short rest.
const acOf = (id) => world.sheet(id).ac;
await test("I03: a cloak lent to a friend and handed back is still attuned, with its +1, and no short rest", async () => {
  const owner = world.addHero({ class: "fighter", level: 5, acOverride: false, equipment: [{ name: "Cloak of Protection", qty: 1, attuned: true, equipped: true }] });
  const friend = world.addHero({ class: "wizard", level: 5 });
  const before = acOf(owner.id);
  const lent = await world.invoke("handle_item", { characterId: owner.id, action: "hand", item: "Cloak of Protection", toCharacterId: friend.id });
  assert.equal(lent.ok, true, lent.error);
  assert.notEqual(world.sheet(friend.id).equipment[0].attuned, true, "the friend is not attuned to it");
  const back = await world.invoke("handle_item", { characterId: friend.id, action: "hand", item: "Cloak of Protection", toCharacterId: owner.id });
  assert.equal(back.ok, true, back.error);
  const cloak = world.sheet(owner.id).equipment.find((item) => item.name === "Cloak of Protection");
  assert.equal(cloak?.attuned, true, "the owner's attunement held");
  await world.invoke("handle_item", { characterId: owner.id, action: "equip", item: "Cloak of Protection" });
  assert.equal(acOf(owner.id), before, "the cloak's +1 is back with it");
});

await test("I03: a trade away and back keeps the attunement; one to a third friend and on keeps it too", async () => {
  const { computeTrade } = await import("../src/lib/dm/trade-logic.ts");
  const owner = world.addHero({ class: "fighter", level: 5, equipment: [{ name: "Ring of Protection", qty: 1, attuned: true, equipped: true }] });
  const a = world.addHero({ class: "rogue", level: 5 });
  const b = world.addHero({ class: "cleric", level: 5 });
  const move = (from, to) => {
    const done = computeTrade(world.sheet(from), world.sheet(to), { toCharacterId: to, give: [{ name: "Ring of Protection", qty: 1 }], giveCp: 0, want: [], wantCp: 0 });
    assert.ok(!("error" in done), done.error);
    world.patch(from, done.from);
    world.patch(to, done.to);
  };
  move(owner.id, a.id);
  move(a.id, b.id);
  assert.notEqual(world.sheet(b.id).equipment[0].attuned, true);
  move(b.id, owner.id);
  assert.equal(world.sheet(owner.id).equipment.find((item) => item.name === "Ring of Protection")?.attuned, true);
});

// I04. SRD 5.1, Potions: Climbing, "you gain a climbing speed equal to your
// walking speed for 1 hour"; Water Breathing, "You can breathe underwater for
// 1 hour after drinking this potion"; Gaseous Form, "you gain the effect of
// the gaseous form spell for 1 hour (no concentration required)"; Flying,
// "You gain a flying speed equal to your walking speed for 1 hour and can
// hover"; Oil of Slipperiness, "the covered creature is affected as if under
// the effect of a freedom of movement spell for 8 hours". Each was drunk and
// narrated: the board still charged the climber double, the drowning hazard
// still drowned the water breather, and flight never left the ground.
const drink = async (potion, extra = {}) => {
  const hero = world.addHero({ class: "fighter", level: 5, speed: 30, equipment: [{ name: potion, qty: 1 }], ...extra });
  const drunk = await world.invoke("use_item", { characterId: hero.id, item: potion });
  assert.equal(drunk.ok, true, `${potion}: ${drunk.error}`);
  return { hero, result: drunk.result, sheet: world.sheet(hero.id) };
};
const { moverSpellTraits } = await import("../src/lib/battlemap/zones-movers.ts");
const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");
const { aloftByMagic } = await import("../src/lib/dm/flight-logic.ts");

await test("I04: a Potion of Climbing gives an hour of climbing at the walking cost", async () => {
  const { sheet } = await drink("Potion of Climbing");
  assert.equal(moverSpellTraits({ conditions: sheet.conditions }).climbs, true, `conditions: ${sheet.conditions.join(", ")}`);
});

await test("I04: a Potion of Water Breathing keeps its drinker from drowning for an hour", async () => {
  const { hero } = await drink("Potion of Water Breathing");
  const hazard = await world.invoke("apply_hazard", { type: "drowning", characterIds: [hero.id], roundsWithoutAir: 99 });
  assert.equal(hazard.ok, true, hazard.error);
  assert.equal(world.sheet(hero.id).currentHp, world.sheet(hero.id).maxHp, "no drop to 0");
  assert.match(JSON.stringify(hazard.result), /does not drown/i);
});

await test("I04: Gaseous Form and Flying potions hold their drinker aloft; Flying at the walking speed", async () => {
  const gas = await drink("Potion of Gaseous Form");
  assert.equal(aloftByMagic(gas.sheet.conditions), true, `conditions: ${gas.sheet.conditions.join(", ")}`);
  const wings = await drink("Potion of Flying", { speed: 25 });
  assert.equal(aloftByMagic(wings.sheet.conditions), true);
  assert.equal(flyingSpeedOf({ conditions: wings.sheet.conditions, walkingFeet: 25 }), 25);
});

await test("I04: Oil of Slipperiness is freedom of movement for 8 hours", async () => {
  const { sheet } = await drink("Oil of Slipperiness");
  assert.equal(moverSpellTraits({ conditions: sheet.conditions }).landStride, true, `conditions: ${sheet.conditions.join(", ")}`);
});

// I05. SRD 5.1, Variant: Encumbrance: "If you carry weight in excess of 10
// times your Strength score, up to your maximum carrying capacity, you are
// instead heavily encumbered, which means your speed drops by 20 feet and you
// have disadvantage on ability checks, attack rolls, and saving throws that
// use Strength, Dexterity, or Constitution." The turn's swing rolled at
// disadvantage; the same hero's opportunity attack rolled one d20.
const RULES = {
  flanking: false, criticalFumbles: false, encumbrance: true, lingeringInjuries: false,
  powerfulCritical: false, criticalDamageMods: false, ammunition: false, restVariant: "standard",
};
const loaded = await openWorld({ campaign: { maxPlayers: 10 }, gameSettings: { variantRules: RULES } });
const loadedKit = await gearKit(loaded);
const porter = loaded.addHero({ class: "fighter", level: 5 });
const mule = loaded.addHero({ class: "fighter", level: 5 });
const { resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const loadedMaps = await import("../src/lib/db/battle-maps.ts");

await test("I05: a heavily encumbered hero's opportunity attack is made at disadvantage, as the turn's swing is", async () => {
  await loadedKit.arena({ first: porter.id });
  // Strength 8: heavily encumbered past 80 lb, carrying up to 120.
  loaded.patch(mule.id, {
    abilities: { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencies: profs({ weapons: ["simple", "martial"], armor: [] }),
    equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Anvil", qty: 1, weight: 100 }],
  });
  const goblin = loadedKit.dummy();
  const map = loadedKit.board();
  loadedMaps.placeToken(loadedMaps.getTokenByRef(map.id, porter.id).id, 9, 9);
  loadedMaps.placeToken(loadedMaps.getTokenByRef(map.id, goblin.id).id, 3, 0);
  loadedMaps.placeToken(loadedMaps.getTokenByRef(map.id, mule.id).id, 2, 0);
  loaded.clearDice();
  loaded.diceLog();
  loaded.dice(15, 2, 4);
  const notes = resolvePcOpportunityAttacks(loaded.campaign(), goblin.id, { x: 3, y: 0 }, { x: 5, y: 0 }, [{ x: 4, y: 0 }, { x: 5, y: 0 }]);
  const d20s = loaded.diceLog().filter((die) => die.sides === 20).length;
  loaded.clearDice();
  assert.ok(notes.some((note) => /breaks away/i.test(note)), `no opportunity attack: ${JSON.stringify(notes)}`);
  assert.equal(d20s, 2, `the swing rolled ${d20s} d20 (disadvantage throws two): ${notes.join(" ")}`);
});

// I06. SRD 5.1, Adventuring Gear, Healer's Kit: "As an action, you can
// expend one use of the kit to stabilize a creature that has 0 hit points,
// without needing to make a Wisdom (Medicine) check." The Hand's Stabilize
// card says "a DC 10 Medicine check, or a healer's kit with no roll", and
// sends no method; the server rolled the check whatever the healer carried,
// so a 4 on the die left the ally dying beside an unopened kit.
await test("I06: a healer carrying a healer's kit stabilizes with it, no roll, when no method is named", async () => {
  const medic = world.addHero({ class: "cleric", level: 3, equipment: [{ name: "Healer's Kit", qty: 1 }] });
  const fallen = world.addHero({ class: "fighter", level: 3 });
  world.patch(fallen.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 1, stable: false, dead: false } });
  world.clearDice();
  world.diceLog();
  world.dice(1);
  const out = await world.invoke("stabilize", { characterId: fallen.id, healerId: medic.id });
  const d20s = world.diceLog().filter((die) => die.sides === 20).length;
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(d20s, 0, "no Medicine check is rolled");
  assert.equal(world.sheet(fallen.id).deathSaves.stable, true);
  assert.equal(world.sheet(medic.id).equipment.find((item) => item.name === "Healer's Kit")?.charges, 9, "one use of ten spent");
  // Without a kit the check is rolled as before.
  const plain = world.addHero({ class: "fighter", level: 3 });
  const other = world.addHero({ class: "fighter", level: 3 });
  world.patch(other.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.dice(15);
  const checked = await world.invoke("stabilize", { characterId: other.id, healerId: plain.id });
  world.clearDice();
  assert.equal(checked.ok, true, checked.error);
  assert.match(JSON.stringify(checked.result), /Medicine/);
});

// I07. SRD 5.1, Healer's Kit: "The kit has ten uses." A stacked row's
// charges are the uses of the one in use; the others are whole
// (src/lib/dm/stabilize.ts kitAfterUse, item-charges.ts). Handing one kit of
// two over copied the opened kit's count onto both (3 + 3 where 3 + 10 were
// carried), and an opened kit handed to a friend with a whole one merged into
// a stack of two whole kits (10 + 10 where 3 + 10 were).
const uses = (id) => world.sheet(id).equipment.filter((item) => item.name === "Healer's Kit").reduce((sum, item) => sum + (item.charges ?? 10) + 10 * (item.qty - 1), 0);
await test("I07: one kit of two handed over leaves the opened one's uses where they were, and none are made or lost", async () => {
  const a = world.addHero({ class: "cleric", level: 3, equipment: [{ name: "Healer's Kit", qty: 2, charges: 3 }] });
  const b = world.addHero({ class: "fighter", level: 3 });
  const handed = await world.invoke("handle_item", { characterId: a.id, action: "hand", item: "Healer's Kit", toCharacterId: b.id });
  assert.equal(handed.ok, true, handed.error);
  assert.equal(uses(a.id) + uses(b.id), 13, `uses: ${uses(a.id)} and ${uses(b.id)}`);
  assert.equal(uses(a.id), 3);
  const c = world.addHero({ class: "fighter", level: 3, equipment: [{ name: "Healer's Kit", qty: 1 }] });
  const back = await world.invoke("handle_item", { characterId: a.id, action: "hand", item: "Healer's Kit", toCharacterId: c.id });
  assert.equal(back.ok, true, back.error);
  assert.equal(uses(c.id), 13, `the opened kit joined a whole one: ${JSON.stringify(world.sheet(c.id).equipment)}`);
});

world.close();
loaded.close();
finish();
