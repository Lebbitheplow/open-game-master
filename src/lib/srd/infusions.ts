// An artificer's infusions (Infuse Item, 2nd level, src/lib/help/srd-features.json):
// what each one takes, what it makes of the item it is laid in, and the
// numbers the feature's table gives. The picks themselves are the Infusion
// options (src/lib/srd/options.json, kind infusion); laying one in an item
// is src/lib/dm/infuse-item.ts.
//
// An infused row carries its mark (`infusion` on the equipment row), and the
// item engines read it through two finders only: gearDefFor (magic-gear.ts:
// the weapon's or the armor's bonus, the charges) and matchMagicItem
// (magic-items.ts: attunement, the worn riders, detect magic). Every door
// that already reads a magic item's row reads an infused item the same way,
// so nothing below names a door. An infusion's own extra rule (an
// initiative's advantage, a reaction) is asked of infusionWorn by the door
// that runs it.
//
// Pure, with type imports only and a relative path, so the item tables
// (magic-gear.ts, which the weapon table reads) import it without a cycle.
import { textKey } from "../language/text-logic.ts";
import type { ChargeRule, GearDef } from "./magic-gear.ts";
import type { MagicItemDef, MagicItemEffect } from "./magic-items.ts";

export type InfusionMark = {
  // The infusion, by its option name ("Enhanced Weapon").
  name: string;
  // The artificer who laid it: their sheet id, and their name for the lines.
  by: string;
  byName: string;
  // The artificer's level when it was laid or last refreshed: Enhanced
  // Weapon's +1 is +2 from 10th.
  level: number;
  // The clock's instant it was laid: past the limit the oldest ends.
  at: number;
  // The mundane weapon or armor the row is, for the engines that build a
  // magic weapon or suit on a base.
  base?: { kind: "weapon" | "armor"; name: string };
  // Resistant Armor's damage type; Replicate Magic Item's item.
  choice?: string;
  // Set once its artificer is dead: the instant it vanishes.
  endsAt?: number;
};

export type InfusionTakes =
  | "weapon"
  | "ammunition_weapon"
  | "thrown_weapon"
  | "armor"
  | "armor_or_shield"
  | "shield"
  | "focus"
  | "helmet"
  | "boots"
  | "armor_or_robes"
  | "ring"
  | "gem"
  | "any";

export type InfusionDef = {
  name: string;
  // The artificer level the infusion needs.
  level: number;
  takes: InfusionTakes;
  attunement: boolean;
  // A +1 to the weapon's attacks and damage, to the armor's AC, or to the
  // holder's spell attacks; `scales`: +2 from the artificer's 10th level.
  bonus?: { to: "weapon" | "armor" | "spell_attack"; scales: boolean };
  charges?: ChargeRule;
  // What the item asks to be chosen when it is laid.
  choose?: "damage_type" | "magic_item";
};

const RECHARGE_1D4: ChargeRule = { max: 4, regain: "1d4" };

export const INFUSIONS: InfusionDef[] = [
  { name: "Arcane Propulsion Armor", level: 14, takes: "armor", attunement: true },
  { name: "Armor of Magical Strength", level: 6, takes: "armor", attunement: true, charges: { max: 6, regain: "1d6" } },
  { name: "Boots of the Winding Path", level: 6, takes: "boots", attunement: true },
  { name: "Enhanced Arcane Focus", level: 2, takes: "focus", attunement: true, bonus: { to: "spell_attack", scales: true } },
  { name: "Enhanced Defense", level: 2, takes: "armor_or_shield", attunement: false, bonus: { to: "armor", scales: true } },
  { name: "Enhanced Weapon", level: 2, takes: "weapon", attunement: false, bonus: { to: "weapon", scales: true } },
  { name: "Helm of Awareness", level: 10, takes: "helmet", attunement: true },
  { name: "Homunculus Servant", level: 2, takes: "gem", attunement: false },
  { name: "Mind Sharpener", level: 2, takes: "armor_or_robes", attunement: false, charges: RECHARGE_1D4 },
  { name: "Radiant Weapon", level: 6, takes: "weapon", attunement: true, bonus: { to: "weapon", scales: false }, charges: RECHARGE_1D4 },
  { name: "Repeating Shot", level: 2, takes: "ammunition_weapon", attunement: true, bonus: { to: "weapon", scales: false } },
  { name: "Replicate Magic Item", level: 2, takes: "any", attunement: false, choose: "magic_item" },
  { name: "Repulsion Shield", level: 6, takes: "shield", attunement: true, bonus: { to: "armor", scales: false }, charges: RECHARGE_1D4 },
  { name: "Resistant Armor", level: 6, takes: "armor", attunement: true, choose: "damage_type" },
  { name: "Returning Weapon", level: 2, takes: "thrown_weapon", attunement: false, bonus: { to: "weapon", scales: false } },
  { name: "Spell-Refueling Ring", level: 6, takes: "ring", attunement: true, charges: { max: 1, regain: "all", daily: "recovers one expended spell slot of 3rd level or lower, as an action" } },
];

// Resistant Armor's choice.
export const RESISTANT_TYPES = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];

// The SRD 5.1 magic items Replicate Magic Item makes, by the artificer level
// that opens each list.
export const REPLICABLE: Array<[number, string[]]> = [
  [2, ["Alchemy Jug", "Bag of Holding", "Cap of Water Breathing", "Goggles of Night", "Rope of Climbing", "Sending Stones", "Wand of Magic Detection", "Wand of Secrets"]],
  [6, ["Boots of Elvenkind", "Cloak of Elvenkind", "Cloak of the Manta Ray", "Eyes of Charming", "Lantern of Revealing", "Pipes of Haunting", "Ring of Water Walking"]],
  [10, ["Boots of Striding and Springing", "Boots of the Winterlands", "Bracers of Archery", "Brooch of Shielding", "Cloak of Protection", "Efficient Quiver", "Eyes of the Eagle", "Gauntlets of Ogre Power", "Gloves of Missile Snaring", "Gloves of Swimming and Climbing", "Hat of Disguise", "Headband of Intellect", "Helm of Telepathy", "Medallion of Thoughts", "Necklace of Adaptation", "Periapt of Wound Closure", "Pipes of the Sewers", "Ring of Jumping", "Ring of Mind Shielding", "Slippers of Spider Climbing", "Winged Boots"]],
  [14, ["Amulet of Health", "Belt of Hill Giant Strength", "Boots of Levitation", "Boots of Speed", "Bracers of Defense", "Cloak of the Bat", "Dimensional Shackles", "Gem of Seeing", "Horn of Blasting", "Ring of Free Action", "Ring of Protection", "Ring of the Ram"]],
];

const byKey = new Map(INFUSIONS.map((def) => [textKey(def.name), def]));

export function infusionNamed(name: string): InfusionDef | null {
  return byKey.get(textKey(name)) ?? null;
}

// The items Replicate Magic Item offers an artificer of this level.
export function replicableAt(level: number): string[] {
  return REPLICABLE.filter(([from]) => level >= from).flatMap(([, names]) => names);
}

// "Infused Items" in the artificer's table: two at 2nd level, three at 6th,
// four at 10th, five at 14th and six at 18th.
export function infusedItemsMax(level: number): number {
  return level >= 18 ? 6 : level >= 14 ? 5 : level >= 10 ? 4 : level >= 6 ? 3 : level >= 2 ? 2 : 0;
}

// The +N an infusion's bonus gives at the level it was laid.
export function infusionBonus(def: InfusionDef, mark: Pick<InfusionMark, "level">): number {
  return def.bonus?.scales && mark.level >= 10 ? 2 : def.bonus ? 1 : 0;
}

type Infused = { name: string; infusion?: InfusionMark | null };

// The infusion a row carries and its definition; null on every other row.
export function infusionOf(item: Infused): { mark: InfusionMark; def: InfusionDef } | null {
  const mark = item.infusion;
  const def = mark ? infusionNamed(mark.name) : null;
  return mark && def ? { mark, def } : null;
}

// The item Replicate Magic Item made of the row, by name.
export function replicaOf(item: Infused): string | null {
  const held = infusionOf(item);
  return held?.def.name === "Replicate Magic Item" && held.mark.choice ? held.mark.choice : null;
}

// The weapon or armor row an infusion makes of the item, as magic-gear.ts
// reads a magic weapon's or suit's row: its own base, its +N, its charges.
// Replicate Magic Item is the replica's own row (magic-gear.ts gearDefFor).
export function infusionGearDef(item: Infused): GearDef | null {
  const held = infusionOf(item);
  if (!held || held.def.choose === "magic_item") {
    return null;
  }
  const { mark, def } = held;
  const bonus = infusionBonus(def, mark);
  return {
    name: item.name,
    match: `infusion ${textKey(def.name)}`,
    requiresAttunement: def.attunement,
    ...(mark.base ? { base: { kind: mark.base.kind, name: mark.base.name } } : {}),
    ...(def.bonus?.to === "weapon" ? { weapon: { bonus, ...(def.name === "Repeating Shot" ? { dropProperties: ["loading"] } : {}) } } : {}),
    ...(def.bonus?.to === "armor" ? { armor: { bonus } } : {}),
    ...(def.charges ? { charges: def.charges } : {}),
  };
}

// The magic item an infused row is, as magic-items.ts reads one: whether it
// asks for attunement and what it gives its wearer.
export function infusionMagicDef(item: Infused): MagicItemDef | null {
  const held = infusionOf(item);
  if (!held || held.def.choose === "magic_item") {
    return null;
  }
  const { mark, def } = held;
  const effects: MagicItemEffect[] = [];
  if (def.bonus?.to === "spell_attack") {
    effects.push({ kind: "spell_attack_bonus", amount: infusionBonus(def, mark) });
  }
  // Arcane Propulsion Armor's gauntlets: the wearer's unarmed strike is
  // 1d8 force, with proficiency, thrown 20/60 and flying back.
  if (def.name === "Arcane Propulsion Armor") {
    effects.push({ kind: "weapon_rider", weapons: ["unarmed strike"], proficient: true, unarmed: { die: "d8", damageType: "force", thrown: { rangeFt: 20, longRangeFt: 60 } } });
  }
  if (def.choose === "damage_type" && mark.choice) {
    effects.push({ kind: "resistance", types: [textKey(mark.choice)] });
  }
  return { name: item.name, match: `infusion ${textKey(def.name)} ${mark.by}`, requiresAttunement: def.attunement, effects };
}

// A Replicate Magic Item replica the item table has no row for (a Bag of
// Holding): still a magic item, with nothing the engines add.
export function bareReplica(name: string): MagicItemDef {
  return { name, match: `replica ${textKey(name)}`, requiresAttunement: false, effects: [] };
}

// Radiant Weapon: "the wielder can take a bonus action to cause it to shed
// bright light in a 30-foot radius and dim light for an additional 30 feet",
// and another to put it out. Lit while the wielder holds the mark and the
// weapon (src/lib/dm/infusion-charges.ts radiantLight lays it), in tiles as
// the carried lights are (src/lib/dm/light-timers.ts).
export const RADIANT_LIT = "radiant light";
export const RADIANT_LIGHT = { radius: 6, dim: 12, minutes: 0 };

export function radiantWeaponLit(sheet: { conditions?: readonly string[]; equipment: readonly (Infused & { equipped?: boolean; attuned?: boolean })[] }): boolean {
  return (sheet.conditions ?? []).some((entry) => textKey(entry) === RADIANT_LIT) && Boolean(infusionWorn(sheet.equipment, "Radiant Weapon"));
}

// Whether the weapon carried under this name is a Repeating Shot, which
// "produces its own ammunition": a shot spends none of the quiver's.
export function makesOwnAmmunition(equipment: readonly (Infused & { attuned?: boolean })[], weapon: string): boolean {
  return equipment.some((item) => textKey(item.name) === textKey(weapon) && infusionOf(item)?.def.name === "Repeating Shot" && item.attuned === true);
}

// The infusions of these names the carried list holds where they count: worn
// (or wielded) and, for one that asks for attunement, attuned. For the doors
// that run an infusion's own rule (Helm of Awareness's initiative).
export function infusionWorn<T extends Infused & { equipped?: boolean; attuned?: boolean }>(
  equipment: readonly T[],
  name: string,
): T | null {
  const anyEquipped = equipment.some((item) => item.equipped !== undefined);
  return (
    equipment.find((item) => {
      const held = infusionOf(item);
      return Boolean(held && textKey(held.def.name) === textKey(name) && (!anyEquipped || item.equipped) && (!held.def.attunement || item.attuned));
    }) ?? null
  );
}
