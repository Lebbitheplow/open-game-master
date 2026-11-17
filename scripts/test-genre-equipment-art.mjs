import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import sharp from "sharp";

register("./lib/register-alias.mjs", import.meta.url);
const { cardArtwork } = await import("../src/lib/battlemap/card-art.ts");
const { iconCandidates } = await import("../src/lib/icons.ts");
const { buildIconList } = await import("./icon-set.mjs");
const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const subjects = read("scripts/genre-equipment-subjects.json");
const report = read("docs/art/genre-equipment-2026-11-14.json");
const manifest = read("public/assets/icons/manifest.json");
const catalogue = await buildIconList();
assert.equal(subjects.length, 32);
assert.equal(new Set(subjects.map((row) => row.id)).size, 32);
assert.equal(report.records.length, 32);
for (const row of subjects) {
  const ref = Object.freeze({ kind: "item", key: row.label, family: `item-${row.kind}` });
  assert.equal(iconCandidates(ref)[0], `/assets/icons/item/${row.id}.webp`, row.label);
  for (const genre of [undefined, "high_fantasy", "dark_fantasy", "cyberpunk", "steampunk", "horror", "mystery", "post_apocalyptic", "custom"]) {
    const card = cardArtwork(ref, genre);
    assert.equal(card.key, row.cardId, row.label);
    assert.equal(card.family, ref.family);
    assert.equal(iconCandidates(card)[0], `/assets/icons/action/${row.cardId}.webp`);
  }
  const record = report.records.find((r) => r.id === row.id);
  for (const [group, key, height, exported] of [["item", row.id, 256, record.exports.icons], ["action", row.cardId, 128, record.exports.cards]]) {
    const id = `${group}-${key}`;
    const entries = catalogue.filter((entry) => entry.id === id);
    assert.equal(entries.length, 1, `${id} is registered once even with table/content entries`);
    assert.equal(entries[0].externalArt, true, `${id} survives generator runs`);
    assert.equal(entries[0].width, 256);
    assert.equal(entries[0].height, height);
    const stored = manifest.icons.filter((entry) => entry.id === id);
    assert.equal(stored.length, 1, id);
    const file = path.join(root, "public", stored[0].src);
    assert.ok(existsSync(file), id);
    const bytes = readFileSync(file);
    assert.equal(bytes.length, stored[0].bytes, id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), exported.sha256, id);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 256); assert.equal(meta.height, height);
    assert.equal(stored[0].height, height);
    assert.ok(meta.hasAlpha, id);
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0, clear = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha === 0) clear++;
      if (alpha >= 250) opaque++;
      // The 1.7x inventory zoom must leave the entire silhouette inside the
      // plate. A 74px radius leaves margin within its 128px radius after zoom.
      if (group === "item" && alpha > 8) assert.ok(Math.hypot(x - 127.5, y - 127.5) < 74, `${id} clips in GameIcon`);
    }
    assert.ok(opaque && clear, `${id} has both solid art and transparency`);
  }
}
assert.equal(cardArtwork({ kind: "item", key: "Pistol +1" }).key, "weapon-pistol");
assert.equal(cardArtwork({ kind: "item", key: "Longsword" }, "cyberpunk").key, "weapon-longsword");
const custom = { kind: "item", key: "Moon Pistol", family: "item-weapon" };
assert.equal(cardArtwork(custom, "cyberpunk"), custom);
console.log("genre equipment: 32 named items, 64 image/hash/dimension checks, generator preservation, circular framing and genre fallback passed");
