import { iconSlug, iconPath, isPainted, type IconRef } from "@/lib/icons";
import { withoutBonus } from "@/lib/srd/item-row";
import equipmentArt from "./equipment-art.json";
import equipmentAliases from "./equipment-art-aliases.json";

type Variant = { item: string; card: string; baseCard: string };
const VARIANTS = new Map<string, Map<string, Variant>>(
  Object.entries(equipmentArt).map(([genre, entries]) => [genre, new Map(Object.entries(entries))]),
);
// Every GameIcon on every page reaches this module, so it reads the weapon
// spellings from a table generated off the catalogue
// (scripts/generate-equipment-art-aliases.mjs) instead of loading the weapon
// rules and the magic gear behind weaponNamed into the browser.
const WEAPONS = new Map<string, string>(Object.entries(equipmentAliases.weapons));

// A weapon's whole name past its bonus, a plural or an alias, also in the
// book's order ("Crossbow, light"), as weaponNamed reads it; anything else by
// its own whole name, so a homebrew "Moon Dagger" keeps its own icon.
function artworkKey(name: string): string {
  const book = /^([^,(]+),\s*([^,(]+)$/.exec(name);
  for (const written of [name, ...(book ? [`${book[2]} ${book[1]}`] : [])]) {
    const weapon = WEAPONS.get(iconSlug(withoutBonus(written)).replaceAll("-", ""));
    if (weapon) return weapon;
  }
  return iconSlug(withoutBonus(name));
}

export function equipmentArtwork(icon: IconRef, genre: string | null | undefined, surface: "inventory" | "card"): IconRef {
  const variants = genre ? VARIANTS.get(genre) : undefined;
  if (!variants || (icon.kind !== "item" && icon.kind !== "action")) return icon;
  const variant = icon.kind === "item"
    ? variants.get(artworkKey(icon.key))
    : [...variants.values()].find((entry) => entry.baseCard === icon.key);
  if (!variant) return icon;
  const kind = surface === "card" ? "action" : "item";
  const painting = surface === "card" ? variant.card : variant.item;
  return isPainted(iconPath(kind, painting)) ? { ...icon, kind, key: painting } : icon;
}
