// The infusions an artificer knows, as the Infuse Item door and the Hand's
// card read them (src/lib/dm/infuse-item.ts, src/lib/battlemap/hand-spells.ts).
// Pure: the Hand runs in the browser.
import { containsPhrase } from "@/lib/language/text-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { matchArmor } from "@/lib/srd/armor";
import { infusionNamed, replicableAt, RESISTANT_TYPES, type InfusionDef } from "@/lib/srd/infusions";
import { hasItemTag } from "@/lib/srd/item-tags";
import { magicItemBonus } from "@/lib/srd/item-row";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { chosenOptions } from "@/lib/srd/options";
import { classLevelOf } from "@/lib/srd/trait-rules";
import { matchWeapon } from "@/lib/srd/weapons";
import { wearSlotOf } from "@/lib/srd/wear-slots";

export const INFUSE_COUNTER = "art_infuse_item";

// The infusions an artificer knows and their level allows, by option name.
export function knownInfusions(sheet: Pick<CharacterSheet, "features" | "class" | "level" | "classes">): InfusionDef[] {
  const level = classLevelOf(sheet, "artificer");
  return chosenOptions(sheet.features ?? [], "infusion").flatMap((name) => {
    const def = infusionNamed(name);
    return def && level >= def.level ? [def] : [];
  });
}

// A mundane helmet, boots, ring or robes has no row in the wear-slot table
// (it lists the magic ones) and a gem no tag: the place a row is worn on
// comes first, the item's own word for itself after.
const HELMET = ["helm", "helmet"];
const BOOTS = ["boots", "shoes", "slippers", "sandals"];
const RING = ["ring"];
const ROBES = ["robe", "robes"];
const GEM = ["gem", "gemstone", "crystal", "diamond", "ruby", "sapphire", "emerald", "pearl", "jade", "opal", "topaz", "amethyst", "garnet", "jacinth", "onyx", "quartz", "tourmaline", "spinel", "peridot", "chrysoberyl", "bloodstone", "moonstone", "zircon", "aquamarine", "alexandrite", "jet", "coral"];
const callsItself = (row: EquipmentItem, words: readonly string[]) => words.some((word) => containsPhrase(row.name, word));

type WeaponLike = { category?: string; properties?: string[] };

// The weapon or suit the row is, for the engines' base and the takes test.
export function weaponOf(row: EquipmentItem): WeaponLike | null {
  return matchWeapon(row) ?? ((row.gear?.weapon as WeaponLike | undefined) ?? null);
}

export function armorOf(row: EquipmentItem): { category: string } | null {
  return matchArmor(row) ?? ((row.gear?.armor as { category: string } | undefined) ?? null);
}

// Why the row cannot take the infusion, or null when it can.
export function takesProblem(def: InfusionDef, row: EquipmentItem, priceCp?: (row: EquipmentItem) => number | null): string | null {
  const weapon = weaponOf(row);
  const trained = Boolean(weapon && (weapon.category === "simple" || weapon.category === "martial"));
  const armor = armorOf(row);
  const shield = armor?.category === "shield";
  switch (def.takes) {
    case "weapon":
      return trained ? null : "a simple or martial weapon";
    case "ammunition_weapon":
      return trained && weapon?.properties?.includes("ammunition") ? null : "a simple or martial weapon with the ammunition property";
    case "thrown_weapon":
      return trained && weapon?.properties?.includes("thrown") ? null : "a simple or martial weapon with the thrown property";
    case "armor":
      return armor && !shield ? null : "a suit of armor";
    case "shield":
      return shield ? null : "a shield";
    case "armor_or_shield":
      return armor ? null : "a suit of armor or a shield";
    case "armor_or_robes":
      return (armor && !shield) || wearSlotOf(row) === "robe" || callsItself(row, ROBES) ? null : "a suit of armor or robes";
    case "focus":
      return hasItemTag(row, "rod") || hasItemTag(row, "staff") || hasItemTag(row, "wand") ? null : "a rod, a staff or a wand";
    case "helmet":
      return wearSlotOf(row) === "head" || callsItself(row, HELMET) ? null : "a helmet";
    case "boots":
      return wearSlotOf(row) === "feet" || callsItself(row, BOOTS) ? null : "a pair of boots";
    case "ring":
      return wearSlotOf(row) === "ring" || callsItself(row, RING) ? null : "a ring";
    case "gem":
      return callsItself(row, GEM) && (priceCp ? (priceCp(row) ?? 0) : (row.worth ?? 0) * 100) >= 100 * 100 ? null : "a gem or crystal worth at least 100 gp";
    case "any":
      return null;
  }
}

// Whether the row is magic already, apart from an infusion of this
// artificer's (which the new one replaces: one infusion an item).
export function magicProblem(row: EquipmentItem, artificerId: string): string | null {
  if (row.infusion) {
    return row.infusion.by === artificerId ? null : `bears ${row.infusion.byName}'s ${row.infusion.name}`;
  }
  return matchMagicItem(row) || magicItemBonus(row.name) > 0 || row.gear?.magic ? "is a magic item" : null;
}

type PickSheet = Pick<CharacterSheet, "features" | "class" | "level" | "classes"> & { id?: string; equipment?: EquipmentItem[] };

// The picks the Hand's card offers and the door names: each infusion known
// that an item the artificer carries can take now, with its choice spelled
// after a colon where it asks one ("Resistant Armor: fire"). `priceCp`: the
// list price the server reads for a gem's worth; the browser reads the row's.
export function infusionPicks(sheet: PickSheet, priceCp?: (row: EquipmentItem) => number | null): string[] {
  const level = classLevelOf(sheet, "artificer");
  const carried = sheet.equipment ?? [];
  return knownInfusions(sheet)
    .filter((def) => carried.some((row) => !takesProblem(def, row, priceCp) && !magicProblem(row, sheet.id ?? "")))
    .flatMap((def) =>
      def.choose === "damage_type"
        ? RESISTANT_TYPES.map((type) => `${def.name}: ${type}`)
        : def.choose === "magic_item"
          ? replicableAt(level).map((item) => `${def.name}: ${item}`)
          : [def.name],
    );
}
