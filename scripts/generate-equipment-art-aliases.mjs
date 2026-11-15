// Keep the weapon catalogue out of every page that shows a round icon: the
// genre equipment painting a carried weapon wears is found through this
// generated table of its spellings instead of weaponNamed at runtime.
// Approach by Smoebo (pull request #963), cut down to the weapon spellings
// the shared starting-kit paintings need.
// Run: node scripts/generate-equipment-art-aliases.mjs (--check to verify)
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
register("./lib/register-alias.mjs", import.meta.url);
const { gearKey } = await import("../src/lib/srd/adventuring-gear.ts");
const { pluralForms } = await import("../src/lib/srd/name-forms.ts");
const { SRD_WEAPONS, WEAPON_ALIASES, weaponNamed } = await import("../src/lib/srd/weapons.ts");
const { iconSlug } = await import("../src/lib/icons.ts");
const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "src/lib/equipment-art-aliases.json");

export function buildEquipmentArtAliases() {
  const paintings = JSON.parse(readFileSync(path.join(root, "src/lib/equipment-art.json"), "utf8"));
  const supported = new Set(Object.values(paintings).flatMap((entries) => Object.keys(entries)));
  const weapons = new Map();
  for (const weapon of SRD_WEAPONS) {
    const canonical = iconSlug(weapon.name);
    if (!supported.has(canonical)) continue;
    for (const name of [weapon.name, ...(WEAPON_ALIASES[weapon.name] ?? [])].flatMap((name) => pluralForms(gearKey(name)))) {
      // The catalogue settles every spelling, so the table never claims a
      // name weaponNamed would read as another weapon.
      if (weaponNamed(name)?.name === weapon.name) weapons.set(iconSlug(name).replaceAll("-", ""), canonical);
    }
  }
  return { weapons: Object.fromEntries([...weapons].sort(([a], [b]) => a.localeCompare(b, "en"))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const aliases = buildEquipmentArtAliases();
  const check = process.argv.includes("--check");
  if (check) assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), aliases, "src/lib/equipment-art-aliases.json is stale: rerun without --check");
  else writeFileSync(target, JSON.stringify(aliases, null, 2) + "\n");
  console.log(`${Object.keys(aliases.weapons).length} weapon spellings ${check ? "verified" : "written"}.`);
}
