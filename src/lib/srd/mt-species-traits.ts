// The lineage traits of src/lib/srd/races.json whose line states a number or
// a rule that the engines read off the sheet: natural armor, a larger build
// for carrying, how long the breath holds, a people at home in the cold, the
// ones who never sleep, longer arms, earth underfoot. Each is read from the
// trait line the sheet door granted (src/lib/srd/features.ts), so a workshop
// species that carries the same line plays the same way.
//
// Every reader of one of these rules goes through this module: the armor
// class (src/lib/srd/index.ts acBreakdownFor), the load (encumbrance.ts,
// src/lib/dm/load-rules.ts), apply_hazard (src/lib/dm/hazard-tools.ts), the
// long rest (src/lib/dm/rest-tools.ts), a melee swing's reach and the board's
// walking cost. Pure and database-free, like the rest of src/lib/srd.
import { holdsFeature } from "@/lib/srd/feature-names";

type Held = { features?: ReadonlyArray<{ name: string }> | null };
const linesOf = (sheet: Held | null | undefined) => (sheet?.features ?? []).map((feature) => feature.name.trim());

// ---- Natural Armor ----

// "Natural Armor (AC 17, unmodified by Dexterity)" (tortle) and "Natural
// Armor (AC 13 + DEX)" (lizardfolk): a base the body gives, with or without
// the Dexterity modifier. A shield still adds to either.
export type NaturalArmor = { base: number; dex: boolean };
const NATURAL_ARMOR = /^natural armor\s*\(\s*ac\s*(\d+)\s*(\+\s*dex)?/i;
export function naturalArmorOf(sheet: Held | null | undefined): NaturalArmor | null {
  for (const line of linesOf(sheet)) {
    const found = NATURAL_ARMOR.exec(line);
    if (found) {
      return { base: Number(found[1]), dex: Boolean(found[2]) };
    }
  }
  return null;
}

// ---- Powerful Build ----

const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
// "Powerful Build (count as one size larger for carrying)": the size the
// carrying capacity and the push, drag and lift limit are worked from.
export function carrySize(size: string | undefined, sheet: Held | null | undefined): string | undefined {
  if (!holdsFeature({ features: sheet?.features ?? [] }, "powerful build")) {
    return size;
  }
  const at = SIZES.findIndex((entry) => entry.toLowerCase() === (size ?? "Medium").trim().toLowerCase());
  return SIZES[Math.min(SIZES.length - 1, (at < 0 ? 2 : at) + 1)];
}

// ---- breath ----

// What a lineage does without air: "Hold Breath (up to 1 hour)" and "(up to
// 15 minutes)" in place of the 1 + Constitution modifier minutes everyone
// has, "Unending Breath (hold your breath indefinitely)", and "Amphibious
// (breathe air and water)", which never drowns.
export type Breath = { holdMinutes: number | null; unending: string | null; water: string | null };
const HOLD_BREATH = /^hold breath\s*\(\s*up to\s*(\d+)\s*(hour|minute)s?\s*\)/i;
export function breathOf(sheet: Held | null | undefined): Breath {
  const out: Breath = { holdMinutes: null, unending: null, water: null };
  for (const line of linesOf(sheet)) {
    const held = HOLD_BREATH.exec(line);
    if (held) {
      out.holdMinutes = Number(held[1]) * (held[2].toLowerCase() === "hour" ? 60 : 1);
    }
  }
  const features = { features: sheet?.features ?? [] };
  if (holdsFeature(features, "unending breath")) {
    out.unending = "Unending Breath";
  }
  if (holdsFeature(features, "amphibious")) {
    out.water = "Amphibious";
  }
  return out;
}

// ---- Mountain Born ----

// "Mountain Born (cold and altitude adapted)": SRD 5.1, Extreme Cold,
// "creatures naturally adapted to cold climates" automatically succeed on
// the save against it.
export function coldAdapted(sheet: Held | null | undefined): string | null {
  return holdsFeature({ features: sheet?.features ?? [] }, "mountain born") ? "Mountain Born" : null;
}

// ---- Trance, Sentry's Rest ----

// The trait that keeps a character awake through a night's rest: an elf's
// Trance (SRD 5.1: "Elves don't need to sleep. Instead, they meditate
// deeply, remaining semiconscious") and a warforged's Sentry's Rest ("6
// hours of inactive alertness in place of sleep"). Whoever holds one is
// never asleep, so what sleep ends (a spell they concentrate on) stays.
export function sleeplessBy(sheet: Held | null | undefined): string | null {
  const features = { features: sheet?.features ?? [] };
  if (holdsFeature(features, "trance")) {
    return "Trance";
  }
  return holdsFeature(features, "sentry's rest") ? "Sentry's Rest" : null;
}

// ---- Long-Limbed ----

// "Long-Limbed (5 extra feet of reach on melee attacks on your turn)": the
// feet a melee attack reaches further, on the holder's own turn only.
export function longLimbedFeet(sheet: Held | null | undefined, ownTurn: boolean): number {
  return ownTurn && holdsFeature({ features: sheet?.features ?? [] }, "long-limbed") ? 5 : 0;
}

// ---- Earth Walk ----

// "Earth Walk (difficult terrain of earth or stone costs no extra
// movement)". The board's difficult tiles are rubble and undergrowth and
// carry no word for which: see earthUnderfoot (src/lib/dm/mt-species-board.ts)
// for where the ground is known to be earth or stone.
export function hasEarthWalk(sheet: Held | null | undefined): boolean {
  return holdsFeature({ features: sheet?.features ?? [] }, "earth walk");
}

// Whether the board's difficult ground is earth or stone, by the theme it
// was drawn for: a cave's rubble and an interior's broken flagstones are; a
// forest's undergrowth, a swamp's mud, a riverside's reeds and a field's
// brush are not.
const EARTHEN_THEMES = new Set(["cave", "interior"]);
export function earthUnderfoot(theme: string | undefined): boolean {
  return EARTHEN_THEMES.has((theme ?? "").trim().toLowerCase());
}

// ---- damage a lineage trait rides on a hit ----

export type LineageRider = { feature: string; dice: string; type: string; when: "weapon"; oncePerTurn: boolean; requiresCondition?: string };

// The damage riders the lineage traits add to a weapon hit, as the feature
// riders of src/lib/dm/attack-damage-riders.ts (which the Hand's card
// prints from too):
//   Celestial Revelation (aasimar): while one of its three forms is held,
//     "extra damage equal to your proficiency bonus once a turn": radiant,
//     or necrotic under the Necrotic Shroud.
//   Surprise Attack (bugbear): "2d6 extra damage on a surprised creature in
//     the first round". `surprised` is the caller's word that the target is
//     surprised and the fight is in its first round; once a turn, and a
//     bugbear has one turn in that round.
const REVELATION = /^celestial revelation:\s*(heavenly wings|inner radiance|necrotic shroud)$/i;
export function lineageRiders(
  sheet: Held & { conditions?: readonly string[]; level?: number },
  target: { surprised?: boolean } = {},
): LineageRider[] {
  const out: LineageRider[] = [];
  const form = (sheet.conditions ?? []).map((entry) => REVELATION.exec(entry.trim())).find(Boolean);
  if (form) {
    const bonus = 2 + Math.floor((Math.max(1, sheet.level ?? 1) - 1) / 4);
    out.push({ feature: "Celestial Revelation", dice: String(bonus), type: form[1].toLowerCase() === "necrotic shroud" ? "necrotic" : "radiant", when: "weapon", oncePerTurn: true });
  }
  if (target.surprised && holdsFeature({ features: sheet.features ?? [] }, "surprise attack")) {
    out.push({ feature: "Surprise Attack", dice: "2d6", type: "", when: "weapon", oncePerTurn: true });
  }
  return out;
}
