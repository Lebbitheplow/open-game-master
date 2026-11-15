import { iconSlug, iconPath, isPainted, type IconRef } from "@/lib/icons";
import { weaponNamed } from "@/lib/srd/weapons";
import { withoutBonus } from "@/lib/srd/item-row";
import equipmentArt from "./equipment-art.json";

type Variant = { item: string; card: string; baseCard: string };
const VARIANTS = new Map<string, Map<string, Variant>>(
  Object.entries(equipmentArt).map(([genre, entries]) => [genre, new Map(Object.entries(entries))]),
);

// Exact catalogue names keep a homebrew "Moon Dagger" from borrowing a
// mundane dagger. weaponNamed also recognizes the engine's bonus spellings.
export function equipmentArtwork(icon: IconRef, genre: string | null | undefined, surface: "inventory" | "card"): IconRef {
  const variants = genre ? VARIANTS.get(genre) : undefined;
  if (!variants || (icon.kind !== "item" && icon.kind !== "action")) return icon;
  const variant = icon.kind === "item"
    ? variants.get(iconSlug(weaponNamed(icon.key)?.name ?? withoutBonus(icon.key)))
    : [...variants.values()].find((entry) => entry.baseCard === icon.key);
  if (!variant) return icon;
  const kind = surface === "card" ? "action" : "item";
  const key = surface === "card" ? variant.card : variant.item;
  return isPainted(iconPath(kind, key)) ? { ...icon, kind, key } : icon;
}
