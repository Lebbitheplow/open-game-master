import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { register } from "node:module";
import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
register("./lib/register-alias.mjs", import.meta.url);
const { inventoryItemIcon } = await import("../src/lib/inventory-art-logic.ts");
const { iconPath } = await import("../src/lib/icons.ts");
const { equipmentArtwork } = await import("../src/lib/equipment-art-logic.ts");
const { GameIcon } = await import("../src/components/ui/GameIcon.tsx");
const { EquipmentChips } = await import("../src/components/sheet/SheetParts.tsx");
const { buildIconList } = await import("./icon-set.mjs");
const root = path.resolve(import.meta.dirname, "..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const rows = read("docs/art/core-equipment-2026-11-18.json").records;
const legacy = read("docs/art/legacy-inventory-replacements-2026-11-18.json").records;
const catalogue = await buildIconList();
const manifest = read("public/assets/icons/manifest.json").icons;
const metadata = read("src/lib/inventory-art.json");
assert.equal(rows.length, 115);
assert.equal(legacy.length, 42);
assert.equal(new Set(rows.map(row => row.id)).size, 115);
for (const row of rows) {
  const icon = inventoryItemIcon({ name: row.label });
  assert.equal(icon.kind, "inventory", row.label);
  assert.equal(icon.key, row.id, row.label);
  assert.equal(inventoryItemIcon({ name: "Unidentified equipment", identified: false, srdName: row.label }).key, "item-gear", row.label);
  const bytes = fs.readFileSync(path.join(root, "public", row.export.src));
  assert.equal(hash(bytes), row.export.sha256);
  const info = await sharp(bytes).metadata();
  assert.equal(info.width, 256); assert.equal(info.height, 256); assert.ok(info.hasAlpha);
  assert.ok(bytes.length <= 48 * 1024, row.label);
  const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let outside = 0, clear = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const a = data[(y * 256 + x) * 4 + 3];
    if (a === 0) clear++;
    if (a > 64 && Math.hypot(x - 128, y - 128) * metadata[row.id].scale > 123) outside++;
  }
  assert.ok(clear > 1000, row.label);
  assert.equal(outside, 0, `${row.label} fits the inventory circle`);
  const entry = catalogue.filter(icon => icon.id === `inventory-${row.id}`);
  assert.equal(entry.length, 1); assert.equal(entry[0].externalArt, true);
  assert.equal(manifest.find(icon => icon.id === entry[0].id)?.bytes, bytes.length);
}
// Canonical names, inversions, translations and aliases must reach the art,
// rather than leaving the new files visible only under their catalog spelling.
for (const [name, key] of [
  ["Abacus", "gear-abacus"], ["common clothes", "gear-clothes-common"],
  ["winter blanket", "gear-blanket"], ["mule", "gear-donkey-or-mule"],
  ["horse (draft)", "gear-horse-draft"], ["Arrows", "gear-arrows-20"],
  ["Crossbow Bolts", "gear-crossbow-bolts-20"], ["Spyglass", "gear-spyglass"],
  ["Spiked Armor", "armor-spiked-armor"], ["Small Knife", "gear-small-knife"],
  ["Signet Ring", "gear-signet-ring"], ["Herbalism Kit", "gear-herbalism-kit"],
  ["Druidic Focus", "gear-druidic-focus"], ["Tent", "gear-tent-two-person"],
]) assert.equal(inventoryItemIcon({ name }).key, key, name);
assert.equal(inventoryItemIcon({ name: "Local name", srdName: "Spyglass" }).key, "gear-spyglass");
for (const row of legacy) {
  const bytes = fs.readFileSync(path.join(root, "public", row.src));
  const replacement = fs.readFileSync(path.join(root, "public", row.replacement));
  assert.deepEqual(bytes, replacement, row.src);
  assert.equal(hash(bytes), row.sha256);
  assert.notEqual(hash(bytes), row.previousSha256);
  const entry = catalogue.find(icon => icon.id === `${row.group}-${row.key}`);
  assert.equal(entry?.externalArt, true, row.src);
  const rendered = renderToStaticMarkup(createElement(GameIcon, { icon: { kind: row.group, key: row.key } }));
  assert.ok(rendered.includes(row.src), row.src);
  assert.ok(rendered.includes(`transform:scale(${metadata[row.inventoryKey].scale})`), row.src);
  assert.ok(!rendered.includes("scale-[1.7]"), row.src);
}
// Existing genre art remains first choice after introducing a base painting.
for (const genre of Object.keys(read("src/lib/equipment-art.json"))) for (const row of rows) {
  const base = { kind: "item", key: row.label };
  const expected = equipmentArtwork(base, genre, "inventory");
  if (expected === base) continue;
  const actual = equipmentArtwork(inventoryItemIcon({ name: row.label }), genre, "inventory");
  assert.equal(iconPath(actual.kind, actual.key), iconPath(expected.kind, expected.key), `${genre}: ${row.label}`);
}
const chips = renderToStaticMarkup(createElement(EquipmentChips, { equipment: [
  { name: "Spyglass", qty: 1 }, { name: "Spiked Armor", qty: 1 }, { name: "Mule", qty: 1 },
] }));
for (const key of ["gear-spyglass", "armor-spiked-armor", "gear-donkey-or-mule"]) assert.ok(chips.includes(`/inventory/${key}.webp`), key);
console.log("core equipment art: 115 mappings and exports, aliases, hidden-item privacy, genre preservation, 42 legacy replacements and rendered chips passed");
