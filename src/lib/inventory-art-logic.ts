import { iconSlug, iconPath, isPainted, type IconRef } from "@/lib/icons";
import inventoryArt from "./inventory-art.json";
import { rowName, withoutBonus } from "@/lib/srd/item-row";
import { matchWeapon, weaponNamed } from "@/lib/srd/weapons";
import { matchArmor, armorNamed } from "@/lib/srd/armor";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { gearDefOfRow } from "@/lib/srd/magic-gear";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { itemCategory, itemCategoryIcon, type CategoryItem } from "@/lib/srd/item-category-logic";

const PAINTINGS = new Set(Object.keys(inventoryArt));
const MAGIC_FORMS: Record<string, string> = {
  amulet: "amulet", periapt: "amulet", medallion: "amulet", necklace: "necklace", brooch: "brooch",
  boots: "boots", slippers: "boots", gloves: "gloves", gauntlets: "gauntlets", bracers: "bracers",
  belt: "belt", robe: "robe", hat: "hat", helm: "helm", helmet: "helm", circlet: "circlet",
  headband: "headband", goggles: "goggles", eyes: "goggles", cloak: "cloak", mantle: "cloak", cape: "cloak",
  ring: "ring", wand: "wand", staff: "staff", rod: "rod", orb: "orb", gem: "gem", pearl: "pearl",
  stone: "stone", book: "book", tome: "book", manual: "book", bag: "bag", haversack: "bag",
  figurine: "figurine", horn: "horn", pipes: "pipes", deck: "deck", broom: "broom", carpet: "carpet",
  lantern: "lantern", bottle: "bottle", decanter: "bottle", candle: "candle", shackles: "shackles", feather: "feather",
  fan: "fan", mirror: "mirror", bowl: "bowl", censer: "censer", brazier: "brazier", cube: "cube", horseshoes: "horseshoes",
  quiver: "quiver", lute: "lute", drum: "drum",
  boot: "boots", slipper: "boots", glove: "gloves", gauntlet: "gauntlets", bracer: "bracers",
  pendant: "amulet", girdle: "belt", cap: "hat", codex: "book", purse: "bag",
};
const MAGIC_NAMES: Record<string, string> = {
  "crystal-ball": "orb", "dimensional-shackles": "shackles", "efreeti-bottle": "bottle",
  "eversmoking-bottle": "bottle", "wind-fan": "fan", "ioun-stone": "stone", "sending-stones": "stone",
  "handy-haversack": "bag", "instant-fortress": "cube", "scarab-of-protection": "brooch",
  "efficient-quiver": "quiver", "dust-of-disappearance": "dust",
  "dust-of-dryness": "dust", "dust-of-sneezing-and-choking": "dust",
  "cubic-gate": "cube",
};
const GEAR_NAMES: Record<string, string> = {
  "acid-vial": "gear-acid", "alchemists-fire-flask": "gear-alchemists-fire",
  "holy-water-flask": "gear-holy-water", "oil-flask": "gear-oil", "antitoxin-vial": "gear-antitoxin",
  "lantern-hooded": "gear-hooded-lantern", "lantern-bullseye": "magic-lantern",
  "rope-hempen-50-feet": "gear-rope", "rope-silk-50-feet": "gear-rope",
  "ball-bearings-bag-of-1000": "gear-ball-bearings", "caltrops-bag-of-20": "gear-caltrops",
  "mirror-steel": "magic-mirror", manacles: "magic-shackles", pouch: "magic-bag", candle: "magic-candle",
  "arcane-focus-wand": "magic-wand", "arcane-focus-rod": "magic-rod", "arcane-focus-staff": "magic-staff",
  "arcane-focus-orb": "magic-orb", "arcane-focus-crystal": "magic-gem",
  quiver: "gear-quiver", lute: "gear-lute", drum: "gear-drum",
  "arcane-focus": "magic-gem", "wooden-staff-druidic-focus": "magic-staff",
  "yew-wand-druidic-focus": "magic-wand", spellbook: "magic-book", robes: "magic-robe",
  vestments: "magic-robe", "playing-card-set": "magic-deck", sack: "magic-bag",
  "little-bag-of-sand": "magic-bag", "ink-1-ounce-bottle": "magic-bottle",
  "rations-1-day": "gear-rations",
};

// Match a physical form at the start of a name, never a word hidden inside
// another one: a Signet Ring is not a Net and a Ring Mail is armor first.
function magicPainting(name: string, known = false): string | null {
  const key = iconSlug(name);
  const special = Object.entries(MAGIC_NAMES).find(([prefix]) => key === prefix || key.startsWith(`${prefix}-`))?.[1];
  // Published names also put the form last (Aurochs Bracers, Alliance
  // Rings). Only a resolved catalog row gets this extra interpretation.
  const last = key.split("-").at(-1)!;
  const suffix = known ? MAGIC_FORMS[last] ?? MAGIC_FORMS[last.replace(/s$/, "")] : undefined;
  const form = special ?? MAGIC_FORMS[key.split("-")[0]] ?? suffix;
  return form ? GEAR_NAMES[form] ?? `magic-${form}` : null;
}

export function inventoryItemIcon(item: CategoryItem): IconRef {
  // Neither a canonical name nor a hidden homebrew block may identify loot.
  if (item.identified === false) return itemCategoryIcon("gear");
  const category = itemCategory(item);
  const family = `item-${category === "armor" ? "armor" : category === "melee" || category === "ranged" ? "weapon" : category === "magic" ? "magic_item" : "gear"}`;
  const painting = (key: string | null): IconRef | null => key && PAINTINGS.has(key) ? { kind: "inventory", key, family } : null;
  const name = withoutBonus(rowName(item));
  const magic = matchMagicItem(item);
  // Magic staves may also be quarterstaffs mechanically, but the focus is
  // what the inventory picture identifies. Other magic weapons use their base.
  const focus = magic && /^(staff|wand|rod)(?:\s|$)/i.test(magic.name) ? painting(magicPainting(magic.name)) : null;
  if (focus) return focus;
  const base = gearDefOfRow(item)?.base;
  const ownName = (value: unknown) => typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" ? value.name : "";
  const weapon = (item.gear?.weapon ? weaponNamed(ownName(item.gear.weapon)) : matchWeapon(item)) ?? (base?.kind === "weapon" ? weaponNamed(base.name) : null);
  const armor = (item.gear?.armor ? armorNamed(ownName(item.gear.armor)) : matchArmor(item)) ?? (base?.kind === "armor" ? armorNamed(base.name) : null);
  if (weapon || armor) {
    const canonical = (weapon ?? armor)!.name;
    const key = armor?.category === "shield" && /^wooden shields?$/i.test(name) ? "armor-wooden-shield" : `${weapon ? "weapon" : "armor"}-${iconSlug(canonical)}`;
    const circular = painting(key);
    if (circular) return circular;
    // Named genre equipment already has approved paintings of its own.
    if (isPainted(iconPath("item", canonical))) return { kind: "item", key: canonical, family };
    return itemCategoryIcon(category);
  }
  // Unknown weapons/armor keep their honest category rather than being
  // mistaken for a necklace or ring because of a decorative name.
  if (category === "melee" || category === "ranged" || category === "armor") return itemCategoryIcon(category);
  const knownGear = matchGear(name);
  const gearName = knownGear?.name ?? name;
  const withGenre = (icon: IconRef): IconRef => knownGear ? { ...icon, genreItem: gearName } : icon;
  const gear = iconSlug(gearName);
  const direct = painting(GEAR_NAMES[gear] ?? `gear-${gear}`);
  if (direct) return withGenre(direct);
  if (/^potions?(?:-|$)/.test(gear)) return withGenre(painting("gear-potion-of-healing")!);
  if (/^(?:spell-)?scrolls?(?:-|$)/.test(gear)) return withGenre(painting("gear-spell-scroll")!);
  if (/^ropes?(?:-|$)/.test(gear)) return withGenre(painting("gear-rope")!);
  // A gear alias can name a more specific visible form than its catalog row
  // (Amulet belongs to Holy Symbol); retain that painting when the row has none.
  return withGenre(painting(magicPainting(magic?.name ?? gearName, Boolean(magic))) ?? painting(magicPainting(name)) ?? itemCategoryIcon(category));
}
