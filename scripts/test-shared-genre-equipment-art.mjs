import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
register("./lib/register-alias.mjs", import.meta.url);
const { equipmentArtwork, GENRE_VARIANTS } = await import("../src/lib/equipment-art-logic.ts");
const { cardArtwork } = await import("../src/lib/battlemap/card-art.ts");
const { iconCandidates, iconSlug, iconPath, isPainted } = await import("../src/lib/icons.ts");
const { SRD_WEAPONS, WEAPON_ALIASES, weaponNamed } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../src/lib/srd/armor.ts");
const { SRD_GEAR, SRD_GOODS, gearKey, matchGear } = await import("../src/lib/srd/adventuring-gear.ts");
const { pluralForms } = await import("../src/lib/srd/name-forms.ts");
const { withoutBonus } = await import("../src/lib/srd/item-row.ts");
const { buildEquipmentArtAliases } = await import("./generate-equipment-art-aliases.mjs");
const { GameIcon } = await import("../src/components/ui/GameIcon.tsx");
const { EquipmentArtProvider } = await import("../src/components/ui/EquipmentArtProvider.tsx");
const { buildIconList } = await import("./icon-set.mjs");
const { GENRE_KITS } = await import("../src/lib/srd/genre-kits.ts");
const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const report = read("docs/art/shared-genre-equipment-2026-11-14.json");
const subjects = read("scripts/shared-genre-equipment-subjects.json");
const manifest = read("public/assets/icons/manifest.json");
const catalogue = await buildIconList();
assert.equal(subjects.length, 49);
assert.equal(new Set(subjects.map(r => r.id)).size, 49);
const sharedNames = new Set(subjects.map(r => r.label));
for (const genre of new Set(subjects.map(r => r.genre))) {
  const classes = read(`src/lib/classes/${genre.replaceAll("_", "-")}.json`).classes;
  const names = new Set(classes.flatMap(c => GENRE_KITS[c.id].lines.flatMap(line => line.options.flatMap(option => option.items.map(item => item.name)))));
  assert.deepEqual(subjects.filter(r => r.genre === genre).map(r => r.label).sort(), [...names].filter(name => sharedNames.has(name)).sort(), genre + " starting-kit coverage");
}
// The 49 starting-kit paintings and the 87 everyday-equipment paintings of
// scripts/test-extended-genre-equipment-art.mjs, each listed once.
assert.equal([...GENRE_VARIANTS.values()].reduce((n, v) => n + v.size, 0), 49 + 87, "every painting is listed once");
for (const row of subjects) {
  const original = Object.freeze({ kind: "item", key: row.label, family: `item-${row.kind}` });
  const inventory = equipmentArtwork(original, row.genre, "inventory");
  const card = cardArtwork(original, row.genre);
  assert.equal(inventory.key, row.id, row.id);
  assert.equal(card.key, row.cardId, row.id);
  assert.equal(card.family, original.family);
  const markup = renderToStaticMarkup(h(EquipmentArtProvider, { genre: row.genre }, h(GameIcon, { icon: original })));
  assert.ok(markup.includes(`/assets/icons/item/${row.id}.webp`), row.id + " reaches inventory through context");
  assert.equal(equipmentArtwork(card, row.genre, "card"), card, "already resolved art stays unchanged");
  const base = { kind: "action", key: `${row.kind}-${row.itemId}` };
  assert.equal(equipmentArtwork(base, row.genre, "card").key, row.cardId);
  for (const genre of [undefined, null, "high_fantasy", "custom", "unknown", "../../cyberpunk", "constructor", "__proto__"]) {
    assert.equal(equipmentArtwork(original, genre, "inventory"), original, `${row.id}: ${genre}`);
  }
  const record = report.records.find(r => r.id === row.id);
  for (const [group, key, height, exported] of [["item", row.id, 256, record.exports.icons], ["action", row.cardId, 128, record.exports.cards]]) {
    const id = `${group}-${key}`;
    const entries = catalogue.filter(e => e.id === id);
    assert.equal(entries.length, 1, id);assert.equal(entries[0].externalArt, true, id);
    assert.equal(entries[0].width, 256);assert.equal(entries[0].height, height);
    const stored = manifest.icons.filter(e => e.id === id);assert.equal(stored.length, 1, id);
    const file = path.join(root, "public", exported.file);assert.ok(existsSync(file), id);
    const bytes = readFileSync(file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), exported.sha256, id);
    assert.equal(stored[0].bytes, bytes.length);assert.equal(stored[0].height, height);
    const meta = await sharp(bytes).metadata();assert.equal(meta.width, 256);assert.equal(meta.height, height);assert.ok(meta.hasAlpha);
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0, clear = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (!alpha) clear++;if (alpha >= 250) opaque++;
      if (group === "item" && alpha > 8) assert.ok(Math.hypot(x - 127.5, y - 127.5) < 74, id + " circular crop");
    }
    assert.ok(clear && opaque, id);
    assert.equal(iconCandidates({ kind: group, key })[0], exported.file);
  }
}
for (const [key, genre, expected] of [["Dagger +1", "cyberpunk", "cyberpunk-dagger"], ["+2 Warhammer", "steampunk", "steampunk-warhammer"], ["Shield, +3", "dark_fantasy", "dark-fantasy-shield"], ["Arrows +1", "post_apocalyptic", "post-apocalyptic-arrows"], ["Tinker’s Tools", "steampunk", "steampunk-tinkers-tools"]]) {
  assert.equal(equipmentArtwork({ kind: "item", key }, genre, "inventory").key, expected);
}
// The browser reads weapon spellings from a generated table rather than the
// weapon catalogue (budget); it must stay current and pick exactly the
// painting the catalogue's own weaponNamed reading picks, for every spelling.
assert.deepEqual(read("src/lib/equipment-art-aliases.json"), buildEquipmentArtAliases(), "src/lib/equipment-art-aliases.json matches the catalogue");
{
  const bases = [
    ...SRD_WEAPONS.flatMap((w) => [w.name, ...(WEAPON_ALIASES[w.name] ?? [])]),
    ...SRD_ARMOR.map((a) => a.name), ...SRD_GEAR.map((g) => g.name), ...SRD_GOODS.map((g) => g.name),
    ...subjects.map((r) => r.label), "long sword", "Hand axe", "Light-Hammer", "WAR HAMMER", "Crossbow, light", "Moon Dagger",
  ];
  const spellings = new Set(bases.flatMap((name) => {
    const book = /^([^,(]+),\s*([^,(]+)$/.exec(name);
    const forms = [name, name.toLowerCase(), ...pluralForms(gearKey(name)), ...(book ? [`${book[2]} ${book[1]}`, `${book[2]}, ${book[1]}`] : [])];
    return forms.flatMap((form) => [form, `${form} +1`, `+2 ${form}`, `${form}, +3`]);
  }));
  let compared = 0;
  for (const [genre, variants] of GENRE_VARIANTS) {
    for (const key of spellings) {
      // #961's resolver, which loaded the weapon catalogue into every page,
      // and #963's gear reading: a catalogue spelling ("backpacks") finds
      // the painting of the gear it names.
      const gear = matchGear(withoutBonus(key))?.name;
      const variant = variants.get(iconSlug(weaponNamed(key)?.name ?? withoutBonus(key))) ?? (gear ? variants.get(iconSlug(gear)) : undefined);
      const ref = { kind: "item", key };
      for (const [surface, kind, painting] of [["inventory", "item", variant?.item], ["card", "action", variant?.card]]) {
        const expected = painting && isPainted(iconPath(kind, painting)) ? painting : key;
        const now = equipmentArtwork(ref, genre, surface);
        assert.equal(now === ref ? key : now.key, expected, `${genre} ${surface}: ${key}`);
        compared++;
      }
    }
  }
  assert.ok(compared > 10000, `compared ${compared} spellings`);
}
for (const key of ["Moon Dagger", "Leather of the Moon", "Unknown Relic", "constructor", "__proto__"]) {
  const ref = { kind: "item", key };assert.equal(equipmentArtwork(ref, "cyberpunk", "inventory"), ref);
}
for (const ref of [{ kind: "spell", key: "Shield" }, { kind: "feature", key: "Dagger" }, { kind: "action", key: "attack" }]) {
  assert.equal(equipmentArtwork(ref, "dark_fantasy", "card"), ref);
}
// No cyberpunk longsword is painted in this starting-kit pass.
assert.equal(cardArtwork({ kind: "item", key: "Longsword" }, "cyberpunk").key, "weapon-longsword");
assert.equal(cardArtwork({ kind: "action", key: "attack" }, "cyberpunk").key, "cyberpunk-attack");
assert.ok(renderToStaticMarkup(h(GameIcon, { icon: { kind: "item", key: "Dagger" } })).includes('/assets/icons/item/dagger.webp'));
console.log("shared genre equipment: 49 mappings (of 136 with the everyday set), 98 exports, hashes, alpha, framing, generator preservation and fallbacks passed");
