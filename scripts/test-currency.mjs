// Money in more than one denomination: what a purse is worth, how it reads,
// and what a person typing "340 sp" gets.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  addCopper,
  breakdown,
  coinMove,
  COPPER_PER_GOLD,
  DENOMINATION_COPPER,
  formatCopper,
  formatPrice,
  formatPurse,
  fromCopper,
  packCostCopper,
  parseCoins,
  priceText,
  purseCoins,
  purseCopper,
  splitCopper,
  unreadCoins,
} = await import("../src/lib/srd/currency.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// The pack prints a part of a gold piece as a decimal and its newer rows a
// bare gold figure; the builder's gear list showed them as printed beside a
// receipt that wrote the same price in coins.
test("a price the pack or an author wrote reads as every other price does", () => {
  assert.equal(priceText("0.05 gp"), "5 cp");
  assert.equal(priceText("0.4 gp"), "4 sp");
  assert.equal(priceText("1.5 gp"), "1 gp 5 sp");
  assert.equal(priceText("0.15"), "1 sp 5 cp");
  assert.equal(priceText("17"), "17 gp");
  // Already in the codes: kept as written, its thousands mark too.
  assert.equal(priceText("2,000 gp"), "2,000 gp");
  assert.equal(priceText("5 sp"), "5 sp");
  assert.equal(priceText("varies"), "varies");
  assert.equal(priceText(""), "");
});

test("a price reads in gold, with silver and copper only for the remainder", () => {
  assert.equal(formatPrice(5500), "55 gp");
  assert.equal(formatPrice(150), "1 gp 5 sp");
  assert.equal(formatPrice(105), "1 gp 5 cp");
  assert.equal(formatPrice(22), "2 sp 2 cp");
  assert.equal(formatPrice(150000), "1500 gp");
  assert.equal(formatPrice(1234), "12 gp 3 sp 4 cp");
  assert.equal(formatPrice(7), "7 cp");
  assert.equal(formatPrice(0), "0 gp");
  // Coins in a purse still count out in platinum.
  assert.equal(formatCopper(5500), "5 pp 5 gp");
  // And a price written out reads back as the same price.
  for (const copper of [5500, 150, 105, 22, 1234, 7]) assert.equal(parseCoins(formatPrice(copper)), copper);
});

test("the Market shows prices in gold and the purse in its coins", () => {
  // Windows CI checks the files out with CRLF line endings.
  const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const panel = read("src/app/campaigns/[campaignId]/MarketPanel.tsx");
  assert.match(panel, /label: `Buy for \$\{formatPrice\(line\.askingCp\)\}`/);
  assert.match(panel, /\{formatPrice\(line\.askingCp\)\}/);
  assert.match(panel, /coin-purse" \}\} size="size-5" \/> \{formatCopper\(purse\)\}/);
  assert.doesNotMatch(panel, /formatCopper\(line\./, "a price still counts out in platinum");
  assert.match(read("src/app/campaigns/[campaignId]/MarketShopEditor.tsx"), /value=\{draft \?\? formatPrice\(value\)\}/);
});

test("a coin change says its own direction, or is asked for again", () => {
  assert.deepEqual(coinMove(-3, undefined), { copper: -300 });
  assert.deepEqual(coinMove(-1, "5 sp"), { copper: -50 });
  assert.deepEqual(coinMove(1, "5 sp"), { copper: 50 });
  assert.deepEqual(coinMove(undefined, "-5 sp"), { copper: -50 });
  assert.deepEqual(coinMove(undefined, "\u22125 sp"), { copper: -50 });
  assert.deepEqual(coinMove(undefined, "+3 gp 4 sp"), { copper: 340 });
  // The written sign wins over a delta that says otherwise.
  assert.deepEqual(coinMove(5, "-5 sp"), { copper: -50 });
  // No direction at all never turns a payment into an earning.
  assert.match(coinMove(0, "5 sp").problem, /does not say gain or spend/);
  assert.match(coinMove(undefined, "5 sp").problem, /"-5 sp" to spend it/);
  assert.match(coinMove(0, undefined).problem, /nonzero delta/);
  assert.match(coinMove(-1, "5 silver").problem, /pp, gp, ep, sp and cp/);
});

test("the denominations are the PHB's", () => {
  assert.equal(DENOMINATION_COPPER.cp, 1);
  assert.equal(DENOMINATION_COPPER.sp, 10);
  assert.equal(DENOMINATION_COPPER.ep, 50);
  assert.equal(DENOMINATION_COPPER.gp, 100);
  assert.equal(DENOMINATION_COPPER.pp, 1000);
});

test("a purse is gold times a hundred plus the remainder", () => {
  assert.equal(purseCopper({ gold: 3, copper: 42 }), 342);
  assert.equal(purseCopper({ gold: 0, copper: 0 }), 0);
  assert.equal(COPPER_PER_GOLD, 100);
});

test("copper splits back into gold and change", () => {
  assert.deepEqual(fromCopper(342), { gold: 3, copper: 42 });
  assert.deepEqual(fromCopper(100), { gold: 1, copper: 0 });
  // Nothing in ODM models owing money, so a negative purse clamps to empty
  // rather than rendering as nonsense wherever it is shown.
  assert.deepEqual(fromCopper(-50), { gold: 0, copper: 0 });
});

test("coins are counted out largest first", () => {
  assert.deepEqual(breakdown(1342), [
    { denomination: "pp", count: 1 },
    { denomination: "gp", count: 3 },
    { denomination: "sp", count: 4 },
    { denomination: "cp", count: 2 },
  ]);
  // Electrum is never produced as change; nobody says "two electrum" when
  // they mean 41 silver.
  assert.ok(!breakdown(50).some((row) => row.denomination === "ep"));
});

test("an empty purse reads as a number, not a blank", () => {
  assert.equal(formatCopper(0), "0 gp");
  assert.equal(formatPurse({ gold: 0, copper: 0 }), "0 gp");
  assert.equal(formatCopper(342), "3 gp 4 sp 2 cp");
});

test("a bare number is gold, because every price in the pack is", () => {
  assert.equal(parseCoins("17"), 1700);
  assert.equal(parseCoins("12gp"), 1200);
});

test("denominations parse by their codes", () => {
  assert.equal(parseCoins("340 sp"), 3400);
  assert.equal(parseCoins("2 pp 5 sp"), 2050);
  assert.equal(parseCoins("6 cp"), 6);
  assert.equal(parseCoins("1,200 gp"), 120000);
  assert.equal(parseCoins("1.200 gp"), 120000);
});

test("a part of a coin is refused, naming the mark, never read as one table's decimal", () => {
  for (const text of ["1.5 gp", "1,5 gp", "2,50 sp"]) {
    assert.equal(parseCoins(text), null, text);
    assert.match(unreadCoins(text), /whole numbers.*"1 gp 5 sp"/, text);
  }
});

test("the pack's own costs keep their English notation", () => {
  assert.equal(packCostCopper("0.05 gp"), 5);
  assert.equal(packCostCopper("5,000 gp"), 500000);
});

test("a coin's name in any language is no code, never a guessed amount", () => {
  for (const text of ["340 silver", "12 gold pieces", "50 mo", "5 monete d'argento", "50 pièces d'or", "50 monedas de oro", "50 Goldmünzen", "3 gp 5 mo"]) {
    assert.equal(parseCoins(text), null, text);
  }
});

test("nothing said parses to null, so a caller can tell it apart from free", () => {
  assert.equal(parseCoins(""), null);
  assert.equal(parseCoins("   "), null);
  assert.equal(parseCoins("expensive"), null);
});

test("a number with a non-coin word is not a price", () => {
  // "5 arrows" must not silently become five gold.
  assert.equal(parseCoins("5 arrows"), null);
});

test("spending floors at empty and reports the shortfall", () => {
  const change = addCopper({ gold: 1, copper: 0 }, -150);
  assert.deepEqual(change.purse, { gold: 0, copper: 0 });
  assert.equal(change.applied, -100);
  assert.equal(change.short, 50);
});

test("earning just adds, with no shortfall", () => {
  const change = addCopper({ gold: 0, copper: 60 }, 60);
  assert.deepEqual(change.purse, { gold: 1, copper: 20 });
  assert.equal(change.applied, 60);
  assert.equal(change.short, 0);
});

test("a hoard splits with the remainder to the first share", () => {
  assert.deepEqual(splitCopper(100, 3), [34, 33, 33]);
  assert.deepEqual(splitCopper(100, 4), [25, 25, 25, 25]);
  // Never divides by zero, and never loses a coin.
  const shares = splitCopper(7, 0);
  assert.equal(shares.reduce((a, b) => a + b, 0), 7);
});

const { capacityProblem } = await import("../src/lib/dm/load-rules.ts");
const { encumbranceFor } = await import("../src/lib/srd/encumbrance.ts");

test("a sheet saved before copper was kept reads its gold, not 0 gp", () => {
  assert.equal(purseCopper({ gold: 50 }), 5000);
  assert.equal(formatPrice(purseCopper({ gold: 50 })), "50 gp");
  assert.equal(purseCopper({ gold: 3, copper: 47 }), 347);
});

test("the coins a purse weighs are its gold pieces and its silver and copper, in the fewest coins", () => {
  assert.equal(purseCoins({ gold: 0, copper: 75 }), 12, "7 sp 5 cp");
  assert.equal(purseCoins({ gold: 12, copper: 0 }), 12);
  assert.equal(purseCoins({ gold: 3, copper: 99 }), 3 + 9 + 9);
  assert.equal(purseCoins({ gold: 0 }), 0);
  // A Strength 1 carrier holds 15 lb: a 14.7 lb pack and 18 coins of silver
  // and copper (0.36 lb) is past it, where the gold alone said it was not.
  const sheet = { name: "Pip", abilities: { str: 1 }, race: "human", gold: 0, copper: 99, equipment: [] };
  assert.ok(capacityProblem(sheet, [{ name: "Anvil", qty: 1, weight: 14.7 }], "the anvil"), "the coin weighs nothing");
  assert.equal(capacityProblem({ ...sheet, copper: 0 }, [{ name: "Anvil", qty: 1, weight: 14.7 }], "the anvil"), null);
  assert.equal(encumbranceFor({ strength: 10, equipment: [], coins: purseCoins({ gold: 50, copper: 0 }) }).carriedLb, 1);
});

console.log(`currency: ${passed} tests passed`);
