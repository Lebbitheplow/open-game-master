import { iconSlug, iconPath, isPainted, type IconRef } from "@/lib/icons";
import { withoutBonus } from "@/lib/srd/item-row";
import equipmentArt from "./equipment-art.json";
import equipmentAliases from "./equipment-art-aliases.json";

type Variant = { item: string; card: string; baseCard: string };
const VARIANTS = new Map<string, Map<string, Variant>>(
  Object.entries(equipmentArt).map(([genre, entries]) => [genre, new Map(Object.entries(entries))]),
);
// Generated from catalogue spellings so every inventory icon need not load
// the complete gear catalogue and its rules dependencies in the browser.
const ALIASES = new Map<string, string>(Object.entries(equipmentAliases.gear));
const WEAPONS = new Map<string, string>(Object.entries(equipmentAliases.weapons));

function artworkKey(name: string): string {
  const book = /^([^,(]+),\s*([^,(]+)$/.exec(name);
  for (const written of [name, ...(book ? [`${book[2]} ${book[1]}`] : [])]) {
    const weapon = WEAPONS.get(iconSlug(withoutBonus(written)).replaceAll("-", ""));
    if (weapon) return weapon;
  }
  return iconSlug(withoutBonus(name));
}

// Catalogue aliases let "rations" and "common clothes" use their paintings.
// Whole-name matching keeps homebrew names such as "Moon Dagger" unchanged.
export function equipmentArtwork(icon: IconRef, genre: string | null | undefined, surface: "inventory" | "card"): IconRef {
  const variants = genre ? VARIANTS.get(genre) : undefined;
  if (!variants || (icon.kind !== "item" && icon.kind !== "action")) return icon;
  const key = artworkKey(icon.key);
  const variant = icon.kind === "item"
    ? variants.get(key) ?? variants.get(ALIASES.get(key) ?? "")
    : [...variants.values()].find((entry) => entry.baseCard === icon.key);
  if (!variant) return icon;
  const kind = surface === "card" ? "action" : "item";
  const painting = surface === "card" ? variant.card : variant.item;
  return isPainted(iconPath(kind, painting)) ? { ...icon, kind, key: painting } : icon;
}
