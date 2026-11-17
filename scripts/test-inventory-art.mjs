import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
register("./lib/register-alias.mjs", import.meta.url);
const { inventoryItemIcon } = await import("../src/lib/inventory-art-logic.ts");
const { iconCandidates } = await import("../src/lib/icons.ts");
const { equipmentArtwork } = await import("../src/lib/equipment-art-logic.ts");
const { cardArtwork } = await import("../src/lib/battlemap/card-art.ts");
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../src/lib/srd/armor-table.ts");
const { SRD_GEAR } = await import("../src/lib/srd/adventuring-gear.ts");
const { GameIcon } = await import("../src/components/ui/GameIcon.tsx");
const { EquipmentArtProvider } = await import("../src/components/ui/EquipmentArtProvider.tsx");
const { EquipmentChips } = await import("../src/components/sheet/SheetParts.tsx");
const { SheetGearRow } = await import("../src/components/sheet/SheetGearRow.tsx");
const { SheetPaperdoll } = await import("../src/components/sheet/SheetPaperdoll.tsx");
const { buildIconList, slugify } = await import("./icon-set.mjs");
const { buildInventoryGenreScales } = await import("./generate-inventory-genre-scales.mjs");
const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const report = read("docs/art/inventory-2026-11-16.json").records;
const meta = read("src/lib/inventory-art.json");
const manifest = read("public/assets/icons/manifest.json").icons;
const catalogue = await buildIconList();
assert.deepEqual(read("src/lib/inventory-genre-scales.json"), await buildInventoryGenreScales());
const resolve = (name, extra = {}) => inventoryItemIcon({ name, ...extra });
const expect = (name, key, extra) => assert.equal(resolve(name, extra).key, key, name);

const standardWeapons = SRD_WEAPONS.filter(r => meta[`weapon-${slugify(r.name)}`]);
assert.equal(standardWeapons.length, 37);
for (const row of standardWeapons) {
  expect(row.name, `weapon-${slugify(row.name)}`);
  expect(`${row.name} +1`, `weapon-${slugify(row.name)}`);
}
for (const row of SRD_ARMOR.filter(r => meta[`armor-${slugify(r.name)}`])) expect(row.name, `armor-${slugify(row.name)}`);
for (const [name, key] of [
  ["Bracers of Defense", "magic-bracers"], ["Bracers of Archery", "magic-bracers"],
  ["Aurochs Bracers", "magic-bracers"], ["Alliance Rings", "magic-ring"],
  ["Dagger of Venom", "weapon-dagger"], ["Oathbow", "weapon-longbow"],
  ["Dwarven Plate", "armor-plate"], ["Elven Chain", "armor-chain-shirt"],
  ["Wooden Shield", "armor-wooden-shield"], ["Staff of Power", "magic-staff"],
  ["Wand of Magic Missiles", "magic-wand"], ["Cloak of Protection", "magic-cloak"],
  ["Ring of Protection", "magic-ring"], ["Ring Mail", "armor-ring-mail"],
  ["Crossbow, light", "weapon-light-crossbow"], ["Longswords", "weapon-longsword"],
  ["Épée longue", "weapon-longsword"], ["Cotte de mailles", "armor-chain-mail"],
  ["Rope, hempen (50 feet)", "gear-rope"], ["Lantern, Hooded", "gear-hooded-lantern"],
  ["Manacles", "magic-shackles"], ["Potion of Healing (Greater)", "gear-potion-of-healing"],
  ["Spell Scroll (3rd level)", "gear-spell-scroll"], ["Crystal Ball", "magic-orb"],
  ["Dimensional Shackles", "magic-shackles"], ["Wind Fan", "magic-fan"],
  ["Quiver", "gear-quiver"], ["Efficient Quiver", "gear-quiver"],
  ["Lute", "gear-lute"], ["Drum", "gear-drum"],
  ["Lute of Echoes", "gear-lute"], ["Drum of Thunder", "gear-drum"],
  ["Dust of Disappearance", "magic-dust"], ["Dust of Dryness", "magic-dust"],
  ["Dust of Sneezing and Choking", "magic-dust"],
  ["Carquois", "gear-quiver"], ["Carquois efficace", "gear-quiver"],
  ["Luth", "gear-lute"], ["Tambour", "gear-drum"],
  ["Poudre dessiccative", "magic-dust"], ["Poudre à éternuer", "magic-dust"],
  ["Poussière de disparition", "magic-dust"],
  ["Arcane Focus", "magic-gem"], ["Crystal", "magic-gem"],
  ["Arcane Focus (orb)", "magic-orb"], ["Arcane Focus (rod)", "magic-rod"],
  ["Arcane Focus (staff)", "magic-staff"], ["Arcane Focus (wand)", "magic-wand"],
  ["Wooden Staff (druidic focus)", "magic-staff"], ["Yew Wand", "magic-wand"],
  ["Spellbook", "magic-book"], ["Robes", "magic-robe"], ["Vestments", "magic-robe"],
  ["Playing Card Set", "magic-deck"], ["Deck of playing cards", "magic-deck"],
  ["Sack", "magic-bag"], ["Little Bag of Sand", "magic-bag"],
  ["Ink (1 ounce bottle)", "magic-bottle"], ["Glass bottle", "magic-bottle"],
  ["Amulet", "gear-holy-symbol"], ["Cubic Gate", "magic-cube"],
  ["Glove of Swift Return", "magic-gloves"], ["Clockwork Gauntlet", "magic-gauntlets"],
  ["Clockwork Pendant", "magic-amulet"], ["Girdle of Traveling Alchemy", "magic-belt"],
  ["Crafter’s Codex", "magic-book"], ["Resolute Bracer", "magic-bracers"],
  ["Backpack", "gear-backpack"], ["Thieves' Tools", "gear-thieves-tools"],
  ["Holy Symbol", "gear-holy-symbol"], ["Component Pouch", "gear-component-pouch"],
  ["Rations (1 day)", "gear-rations"], ["Trail rations", "gear-rations"],
  ["Waterskin", "gear-waterskin"], ["Bedroll", "gear-bedroll"],
  ["Sac à dos", "gear-backpack"], ["Outils de voleur", "gear-thieves-tools"],
  ["Symbole sacré", "gear-holy-symbol"], ["Sacoche à composantes", "gear-component-pouch"],
  ["Outre", "gear-waterskin"], ["Sac de couchage", "gear-bedroll"],
]) expect(name, key);
// Bare staves are weapon aliases; an explicitly named focus keeps its own art.
expect("Staff", "weapon-quarterstaff");
expect("Wooden Staff", "weapon-quarterstaff");
expect("Unknown focus", "item-gear", { identified: false, srdName: "Arcane Focus" });
expect("Sparkles", "magic-dust", { srdName: "Dust of Disappearance" });
expect("Unknown powder", "item-gear", { identified: false, srdName: "Dust of Disappearance" });
expect("Diamond dust", "item-gear");
expect("Flour", "item-gear");
expect("Moonblade", "weapon-longsword", { srdName: "Longsword" });
expect("Blue Wrists", "magic-bracers", { srdName: "Bracers of Defense" });
expect("Unknown trinket", "item-gear", { identified: false, srdName: "Bracers of Defense", slug: "bracers-of-defense" });
expect("Dinner Plate", "item-gear");
expect("Signet Ring", "item-gear");
expect("Moonblade", "weapon-rapier", { slug: "homebrew:example", gear: { weapon: { name: "Rapier", kind: "melee" } } });
expect("Amber ring blade", "item-melee", { slug: "homebrew:example", gear: { weapon: { name: "Amber ring blade", kind: "melee" } } });

const steel = resolve("Shield");
assert.equal(equipmentArtwork(steel, "steampunk", "inventory").key, "steampunk-shield");
assert.equal(equipmentArtwork(resolve("Dagger +1"), "cyberpunk", "inventory").key, "cyberpunk-dagger");
assert.equal(equipmentArtwork(steel, "high_fantasy", "inventory"), steel);
expect("Ballistic Shield", "Ballistic Shield");
// Card calls never receive the inventory kind and still choose the same wide art.
for (const [name, key] of [["Longsword", "weapon-longsword"], ["Dagger", "weapon-dagger"], ["Potion of Healing", "gear-potion-of-healing"]]) {
  const card = cardArtwork({ kind: "item", key: name, family: "item-gear" });
  assert.equal(card.kind, "action"); assert.equal(card.key, key);
  assert.ok(iconCandidates(card)[0].startsWith("/assets/icons/action/"));
}

// Genre-only gear must keep its approved override even without a base painting.
let genreChecks = 0;
for (const genre of Object.keys(read("src/lib/equipment-art.json"))) for (const gear of SRD_GEAR) {
  const base = { kind: "item", key: gear.name, family: "item-gear" };
  const expected = equipmentArtwork(base, genre, "inventory");
  if (expected === base) continue;
  const actual = equipmentArtwork(resolve(gear.name), genre, "inventory");
  assert.equal(actual.kind, expected.kind, `${genre}: ${gear.name}`);
  assert.equal(actual.key, expected.key, `${genre}: ${gear.name}`);
  const hidden = equipmentArtwork(resolve("Unknown item", { identified: false, srdName: gear.name }), genre, "inventory");
  assert.equal(hidden.key, "item-gear");
  genreChecks++;
}
assert.ok(genreChecks > 100);
assert.equal(report.length, 119);
for (const row of report) {
  const bytes = readFileSync(path.join(root, "public", row.export.src));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), row.export.sha256);
  const info = await sharp(bytes).metadata();
  assert.equal(info.width, 256); assert.equal(info.height, 256); assert.ok(info.hasAlpha);
  const entries = catalogue.filter(r => r.id === `inventory-${row.id}`);
  assert.equal(entries.length, 1); assert.equal(entries[0].externalArt, true);
  assert.equal(manifest.find(r => r.id === entries[0].id)?.bytes, bytes.length);
  assert.ok(meta[row.id].scale > 0 && meta[row.id].scale <= 1.8);
}
const image = renderToStaticMarkup(createElement(GameIcon, { icon: resolve("Bracers of Defense") }));
assert.match(image, /\/inventory\/magic-bracers.webp/);
assert.match(image, /transform:scale\(/);
assert.ok(!image.includes("scale-[1.7]"));
const genreImage = renderToStaticMarkup(createElement(EquipmentArtProvider, { genre: "steampunk" }, createElement(GameIcon, { icon: steel })));
assert.match(genreImage, /\/item\/steampunk-shield.webp/);
assert.match(genreImage, /transform:scale\(/);
assert.ok(!genreImage.includes("scale-[1.7]"));
const item = { name: "Bracers of Defense", qty: 1, equipped: true, attuned: true };
const sheet = { name: "Art Preview", equipment: [item], features: [], class: "fighter", level: 5, conditions: [], resources: {} };
const wrap = node => renderToStaticMarkup(createElement(EquipmentArtProvider, { genre: "high_fantasy" }, node));
const chest = createElement(EquipmentArtProvider, { genre: "cyberpunk" }, createElement(EquipmentChips, { equipment: [{ name: "Chest", qty: 1 }] }));
assert.match(renderToStaticMarkup(chest), /\/item\/cyberpunk-chest.webp/);
const privateChest = createElement(EquipmentArtProvider, { genre: "cyberpunk" }, createElement(EquipmentChips, { equipment: [{ name: "Unknown item", srdName: "Chest", identified: false, qty: 1 }] }));
assert.ok(!renderToStaticMarkup(privateChest).includes("cyberpunk-chest.webp"));
for (const node of [
  createElement(EquipmentChips, { equipment: [item] }),
  createElement(SheetGearRow, { sheet, item, worn: true, onGear() {} }),
  createElement(SheetPaperdoll, { sheet, armor: { armorName: null, shieldName: null }, mine: true, pending: null, onPending() {}, onGear() {} }),
]) assert.match(wrap(node), /\/inventory\/magic-bracers.webp/);
for (const name of ["Quiver", "Lute", "Drum", "Dust of Disappearance", "Backpack", "Thieves' Tools", "Holy Symbol", "Component Pouch", "Rations (1 day)", "Waterskin", "Bedroll"]) {
  const added = { name, qty: 1 };
  for (const node of [createElement(EquipmentChips, { equipment: [added] }), createElement(SheetGearRow, { sheet, item: added, worn: false, onGear() {} })]) {
    assert.ok(wrap(node).includes(`/inventory/${resolve(name).key}.webp`), name);
  }
}
console.log(`inventory art: base equipment, magic categories, identity, privacy, ${genreChecks} gear/genre overrides, card isolation, 119 exports and three rendered surfaces passed`);
