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
]) expect(name, key);
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

assert.equal(report.length, 108);
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
for (const node of [
  createElement(EquipmentChips, { equipment: [item] }),
  createElement(SheetGearRow, { sheet, item, worn: true, onGear() {} }),
  createElement(SheetPaperdoll, { sheet, armor: { armorName: null, shieldName: null }, mine: true, pending: null, onPending() {}, onGear() {} }),
]) assert.match(wrap(node), /\/inventory\/magic-bracers.webp/);
console.log("inventory art: base equipment, magic categories, identity, privacy, genres, card isolation, 108 exports and three rendered surfaces passed");
