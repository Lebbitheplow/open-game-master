// The picture a sheet's item row leads with is its kind's, not its own
// (src/lib/srd/item-category-logic.ts): an item's painting could not be told
// from another's at the 24 to 32px a row gives it. Every kind has a painting
// that ships, a weapon or a suit says so before its magic does, and an
// unidentified item gives nothing away. Pure.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..");
const { ITEM_CATEGORIES, ITEM_CATEGORY_LABEL, itemCategory, itemCategoryIcon } = await import("../src/lib/srd/item-category-logic.ts");
const { iconCandidates } = await import("../src/lib/icons.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
}

test("every kind has a label and a painting that ships, small enough for a glyph", () => {
  for (const category of ITEM_CATEGORIES) {
    assert.ok(ITEM_CATEGORY_LABEL[category], category);
    const [src] = iconCandidates(itemCategoryIcon(category));
    assert.equal(src, `/assets/icons/glyph/item-${category}.webp`);
    const file = path.join(ROOT, "public", src);
    assert.ok(existsSync(file), src);
    assert.ok(statSync(file).size < 16 * 1024, `${src} is over 16 KiB`);
  }
});

test("a weapon is melee or ranged by the table the attack reads", () => {
  for (const [name, kind] of [
    ["Longsword", "melee"],
    ["Dagger", "melee"],
    ["Quarterstaff", "melee"],
    ["Shortbow", "ranged"],
    ["Crossbow, light", "ranged"],
    ["Sling", "ranged"],
  ]) {
    assert.equal(itemCategory({ name }), kind, name);
  }
});

test("a weapon or a suit says so before its magic does", () => {
  assert.equal(itemCategory({ name: "+1 Longsword" }), "melee");
  assert.equal(itemCategory({ name: "Longbow, +2" }), "ranged");
  assert.equal(itemCategory({ name: "Dagger of Venom" }), "melee");
  assert.equal(itemCategory({ name: "Plate +1" }), "armor");
});

test("a magic weapon or suit leads with the weapon's or the armor's picture, never the ring's", () => {
  for (const [name, kind] of [
    ["Flame Tongue", "melee"],
    ["Holy Avenger", "melee"],
    ["Hammer of Thunderbolts", "melee"],
    ["Oathbow", "ranged"],
    ["Dwarven Plate", "armor"],
    ["Elven Chain", "armor"],
    ["Animated Shield", "armor"],
    ["Armor +1, +2, or +3", "armor"],
    // The pack's own, with no base an engine table knows: its category says.
    ["Axe of Chilling Fear", "melee"],
    ["Blade of Petals", "melee"],
    ["Bow of Accuracy", "ranged"],
    ["Agile Armor", "armor"],
  ]) {
    assert.equal(itemCategory({ name }), kind, name);
  }
});

test("armor and shields are one kind", () => {
  for (const name of ["Chain Mail", "Leather", "Shield", "Studded Leather"]) {
    assert.equal(itemCategory({ name }), "armor", name);
  }
  // A plate you eat from is no Plate (issue 113).
  assert.equal(itemCategory({ name: "Dinner plate" }), "gear");
});

test("what is used up when used: potions, scrolls, flasks", () => {
  for (const name of ["Potion of Healing", "Potion of Greater Healing", "Acid (vial)", "Alchemist's Fire (Flask)"]) {
    assert.equal(itemCategory({ name }), "consumable", name);
  }
  assert.equal(itemCategory({ name: "Strange draught", tags: ["potion"] }), "consumable");
  assert.equal(itemCategory({ name: "Scroll of Fireball", tags: ["scroll"] }), "consumable");
});

test("a magic item that is no weapon, suit or potion is a magic item", () => {
  for (const name of ["Ring of Protection", "Cloak of Elvenkind", "Bag of Holding", "Wand of Magic Missiles"]) {
    assert.equal(itemCategory({ name }), "magic", name);
  }
});

test("everything else is gear", () => {
  for (const name of ["Rope, hempen (50 feet)", "Backpack", "Abacus", "A lock of the duke's hair"]) {
    assert.equal(itemCategory({ name }), "gear", name);
  }
});

test("a workshop item is read from its own block", () => {
  assert.equal(itemCategory({ name: "Thunder Lance", gear: { weapon: { kind: "ranged" } } }), "ranged");
  assert.equal(itemCategory({ name: "Thunder Maul", gear: { weapon: { kind: "melee" } } }), "melee");
  assert.equal(itemCategory({ name: "Glass Carapace", gear: { armor: { category: "medium" } } }), "armor");
  assert.equal(itemCategory({ name: "Lucky Coin", gear: { magic: {} } }), "magic");
});

test("an unidentified item gives nothing away: it is gear, whatever its row", () => {
  assert.equal(itemCategory({ name: "an ornate silver ring", srdName: "Ring of Protection", identified: false }), "gear");
  assert.equal(itemCategory({ name: "a cloudy vial", tags: ["potion"], identified: false }), "gear");
});

console.log(`test-item-categories: ${passed} passed`);
