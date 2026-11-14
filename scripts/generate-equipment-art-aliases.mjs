// Keep catalogue matching out of the small inventory renderer's browser bundle.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
register("./lib/register-alias.mjs", import.meta.url);
const { SRD_GEAR, SRD_GOODS, gearKey, matchGear } = await import("../src/lib/srd/adventuring-gear.ts");
const { pluralForms } = await import("../src/lib/srd/name-forms.ts");
const { SRD_WEAPONS, WEAPON_ALIASES, weaponNamed } = await import("../src/lib/srd/weapons.ts");
const { iconSlug } = await import("../src/lib/icons.ts");
const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "src/lib/equipment-art-aliases.json");

export function buildEquipmentArtAliases() {
  const paintings = JSON.parse(readFileSync(path.join(root, "src/lib/equipment-art.json"), "utf8"));
  const supported = new Set(Object.values(paintings).flatMap(entries => Object.keys(entries)));
  const aliases = new Map();
  for (const gear of [...SRD_GEAR, ...SRD_GOODS]) {
    const canonical = iconSlug(gear.name);
    if (!supported.has(canonical)) continue;
    const bare = gear.name.replace(/\s*\([^)]*\)\s*$/, "");
    const comma = /^([^,]+),\s*(.+)$/.exec(bare);
    const names = [gear.name, bare, ...(comma ? [`${comma[2]} ${comma[1]}`] : []), ...(gear.aliases ?? [])];
    for (const name of names.flatMap(name => pluralForms(gearKey(name)))) {
      // Ask the catalogue to settle collisions before recording a spelling.
      if (matchGear(name)?.name !== gear.name) continue;
      const key = iconSlug(name);
      if (key !== canonical) aliases.set(key, canonical);
    }
  }
  const weapons = new Map();
  for (const weapon of SRD_WEAPONS) {
    const canonical = iconSlug(weapon.name);
    if (!supported.has(canonical)) continue;
    for (const name of [weapon.name, ...(WEAPON_ALIASES[weapon.name] ?? [])].flatMap(name => pluralForms(gearKey(name)))) {
      if (weaponNamed(name)?.name === weapon.name) weapons.set(iconSlug(name).replaceAll("-", ""), canonical);
    }
  }
  const sorted = entries => Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b, "en")));
  return { gear: sorted(aliases), weapons: sorted(weapons) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const aliases = buildEquipmentArtAliases();
  if (process.argv.includes("--check")) assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), aliases);
  else writeFileSync(target, JSON.stringify(aliases, null, 2) + "\n");
  console.log(`${Object.keys(aliases.gear).length} gear and ${Object.keys(aliases.weapons).length} weapon spellings ${process.argv.includes("--check") ? "verified" : "written"}.`);
}
