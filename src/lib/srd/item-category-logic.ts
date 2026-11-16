import type { IconRef } from "@/lib/icons";
import type { ItemTag } from "@/lib/schemas/item-tags";
import { matchArmor } from "@/lib/srd/armor";
import { magicItemBonus } from "@/lib/srd/item-row";
import { isBeyondPlainGear, itemTags, wieldedAs } from "@/lib/srd/item-tags";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { matchWeapon } from "@/lib/srd/weapons";

// What kind of thing a carried item is, for the one picture a sheet's row
// leads with. An item's own painting cannot be told from another's at the
// 24 to 32px a row gives it, so the row shows which of six kinds it is and
// the painting stays where there is room for it (the hover and the entry).
export const ITEM_CATEGORIES = ["melee", "ranged", "armor", "consumable", "magic", "gear"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

// The words a screen reader and the hover say for the picture.
export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  melee: "Melee weapon",
  ranged: "Ranged weapon",
  armor: "Armor or shield",
  consumable: "Used up when used",
  magic: "Magic item",
  gear: "Gear",
};

const USED_UP: readonly ItemTag[] = ["consumable", "potion", "healing_potion", "scroll"];

export type CategoryItem = {
  name: string;
  slug?: string;
  srdName?: string;
  tags?: readonly ItemTag[];
  identified?: boolean;
  // A homebrew item's snapshot (src/lib/homebrew/item-data.ts).
  gear?: { weapon?: unknown; armor?: unknown; magic?: unknown; tags?: readonly ItemTag[]; [field: string]: unknown };
};

// A weapon or a suit says so before its magic does: a +1 Longsword is a
// melee weapon first, which is what a player scanning for their sword wants.
export function itemCategory(item: CategoryItem): ItemCategory {
  // An unidentified item's name is the party's description of it; what it
  // really is must not show through its picture.
  if (item.identified === false) {
    return "gear";
  }
  const own = item.gear?.weapon as { kind?: "melee" | "ranged" } | undefined;
  const weapon = own ?? matchWeapon(item);
  if (weapon) {
    return weapon.kind === "ranged" ? "ranged" : "melee";
  }
  if (item.gear?.armor || matchArmor(item)) {
    return "armor";
  }
  // A magic weapon or suit the engines have no base for is still one by the
  // pack's own word: an Axe of Chilling Fear leads with the weapon's picture
  // and never the ring's.
  const packed = wieldedAs(item);
  if (packed) {
    return packed;
  }
  const tags = itemTags(item);
  if (USED_UP.some((tag) => tags.includes(tag))) {
    return "consumable";
  }
  // Past weapons, armor and what is used up, the pack's rows beyond the
  // SRD's plain gear are its magic items, the ones no engine table lists
  // (a Bag of Holding) among them.
  if (item.gear?.magic || matchMagicItem(item) || magicItemBonus(item.name) > 0 || isBeyondPlainGear(item)) {
    return "magic";
  }
  return "gear";
}

// The category's picture: one glyph each, painted to be read small
// (docs/art/item-categories-2026-11-14).
export function itemCategoryIcon(category: ItemCategory): IconRef {
  return { kind: "glyph", key: `item-${category}` };
}

// The colour each kind's pill and its plate's rim take, so a long list sorts
// itself by eye on a phone, where the picture is the only other cue. The
// picture and its spoken label still say the kind; the colour only repeats it.
const TONE: Record<ItemCategory, string> = {
  melee: "#e2685c",
  ranged: "#5cbd78",
  armor: "#62a3e6",
  consumable: "#3fc4b4",
  magic: "#a987f2",
  gear: "#a8a29e",
};

// Inline styles rather than rules in globals.css: the shared stylesheet every
// page loads sits at its budget, and the build wrote each colour-mix rule
// twice (with a fallback), so six kinds of rules cost 0.2 KiB there. The
// rim (globals.css .tone-rim) reads --rim, the tone at 85%. The pill mixes
// the tone into the chip's own plate for the night theme and the day one
// (light-dark() follows the color-scheme each theme sets on <html>); a
// browser without light-dark() keeps the plain chip.
export function itemToneStyle(category: ItemCategory, surface: "chip" | "row"): Record<string, string> {
  const tone = TONE[category];
  const rim = { "--rim": `${tone}d9` };
  if (surface === "row") {
    return rim;
  }
  return {
    ...rim,
    borderColor: `light-dark(color-mix(in srgb,${tone} 75%,#44403c),${tone}99)`,
    background: `light-dark(color-mix(in srgb,${tone} 20%,#fffcf4bf),color-mix(in srgb,${tone} 13%,#0a07148c))`,
  };
}
