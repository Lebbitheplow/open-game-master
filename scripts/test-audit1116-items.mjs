// Using, buying, selling and carrying things, from the 2026-11-16 rules audit
// (the items lens, findings I01..). Each test names its finding and the SRD
// 5.1 rule it holds the engine to.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

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

world.close();
finish();
