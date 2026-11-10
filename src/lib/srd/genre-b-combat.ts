// The mystery, post-apocalyptic and steampunk classes' features that change a
// weapon swing, read from the sheet alone so pc_attack and the Hand's attack
// cards (src/lib/dm/attack-damage-riders.ts, src/lib/dm/attack-logic.ts) add
// the same dice:
//
//   - a strike's own die: Heavy Hands' 1d6 fist, Improvised Weapon Mastery's
//     1d6 (1d8 in two hands) proficient improvised weapon;
//   - damage riders the feature-effects table has no condition for: a weapon
//     category (simple, improvised, firearm), the holder below half their hit
//     points, the target charmed, Head of Steam's pressure on Piston Strike.
//
// Before this each was its sentence in the GM's prompt: a scavenger's chair
// leg hit for 1d4 unproficient, a steam knight's pistons added nothing.
//
// Pure: no database, so the Hand imports it.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";
import { weaponNamed } from "@/lib/srd/weapons";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

type Holder = Pick<CharacterSheet, "class" | "features" | "conditions" | "currentHp" | "maxHp"> & Partial<Pick<CharacterSheet, "classes">>;

// The class a genre feature is held by, so a same-named feature of another
// class never runs as this one (src/lib/dm/genre-b-auras.ts asks it too).
export function holdsGenreFeature(sheet: Pick<Holder, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>, classId: string, feature: string): boolean {
  return holds(sheet as Holder, classId, feature);
}

function holds(sheet: Holder, classId: string, feature: string): boolean {
  const classes = [sheet.class, ...(sheet.classes ?? []).map((entry) => entry.id)].map(textKey);
  return classes.includes(textKey(classId)) && holdsFeature(sheet, feature);
}

const belowHalf = (sheet: Holder) => sheet.maxHp > 0 && sheet.currentHp * 2 < sheet.maxHp;

export type GenreStrike = { unarmed?: string; improvised?: string; improvisedTwoHanded?: string; improvisedProficient?: boolean };

// The die an unarmed strike or an improvised weapon rolls in place of the
// SRD's 1 and 1d4.
export function genreStrike(sheet: Holder): GenreStrike {
  const out: GenreStrike = {};
  // "Your unarmed strikes deal 1d6 + STR bludgeoning."
  if (holds(sheet, "enforcer", "Heavy Hands")) out.unarmed = "1d6";
  // "Improvised weapons count as proficient simple weapons dealing 1d6, or 1d8 two-handed."
  if (holds(sheet, "scavenger", "Improvised Weapon Mastery")) {
    out.improvised = "1d6";
    out.improvisedTwoHanded = "1d8";
    out.improvisedProficient = true;
  }
  return out;
}

export type GenreRider = { feature: string; dice: string; type: string; when: "weapon" | "melee" | "ranged"; oncePerTurn: boolean; requiresCondition?: string };

type Swing = { ranged: boolean; improvised: boolean; base?: string; unarmed?: boolean };

// The weapon's SRD category, by the row it swings as.
function category(profile: Swing): string | null {
  return profile.base ? (weaponNamed(profile.base)?.category ?? null) : null;
}

// What these features add to one weapon hit. `target`: the creature struck,
// for the riders that read it; absent (the Hand before a target is picked),
// those are left out.
export function genreBRiders(sheet: Holder, profile: Swing, target?: { conditions?: string[] }): GenreRider[] {
  const out: GenreRider[] = [];
  const kind = category(profile);
  const melee = !profile.ranged;
  // "Your improvised and simple weapons deal +1d6 damage."
  if (holds(sheet, "scavenger", "Junkyard Strikes") && (profile.improvised || kind === "simple")) {
    out.push({ feature: "Junkyard Strikes", dice: "1d6", type: "", when: "weapon", oncePerTurn: false });
  }
  // "1/turn, your improvised weapons deal +1d4 poison."
  if (holds(sheet, "scavenger", "Tetanus Edge") && profile.improvised) {
    out.push({ feature: "Tetanus Edge", dice: "1d4", type: "poison", when: "weapon", oncePerTurn: true });
  }
  // "While below half HP, your melee attacks deal +1d8 damage."
  if (holds(sheet, "road_warrior", "Blood and Chrome") && melee && belowHalf(sheet)) {
    out.push({ feature: "Blood and Chrome", dice: "1d8", type: "", when: "melee", oncePerTurn: false });
  }
  // "While below half HP, ... your attacks deal +10 damage."
  if (holds(sheet, "enforcer", "Last Man Standing") && belowHalf(sheet)) {
    out.push({ feature: "Last Man Standing", dice: "10", type: "", when: "weapon", oncePerTurn: false });
  }
  // "1/turn, a firearm hit deals +1d8 lightning."
  if (holds(sheet, "salvage_tech", "Overcharged Rounds") && kind === "firearm") {
    out.push({ feature: "Overcharged Rounds", dice: "1d8", type: "lightning", when: "ranged", oncePerTurn: true });
  }
  // "1/turn, +2d6 damage against a creature that is charmed, deceived by
  // you, or unaware you are a threat": the charm is on the board; deceit and
  // surprise are the GM's to say, by charming nothing.
  if (holds(sheet, "grifter", "Twist the Knife") && (target?.conditions ?? []).some((entry) => isConditionNamed(entry, "charmed"))) {
    out.push({ feature: "Twist the Knife", dice: "2d6", type: "", when: "weapon", oncePerTurn: true });
  }
  // "1/turn, +1d6 bludgeoning on a melee hit as the pistons slam", "Head of
  // Steam: your next Piston Strike this turn deals +2d6 instead", and
  // Piston Barrage: "applies to every melee hit, not once per turn".
  if (holds(sheet, "steam_knight", "Piston Strike") && melee && !profile.unarmed) {
    const pressure = sheet.conditions.some((entry) => isConditionNamed(entry, "head of steam"));
    out.push({ feature: "Piston Strike", dice: pressure ? "2d6" : "1d6", type: "bludgeoning", when: "melee", oncePerTurn: !holds(sheet, "steam_knight", "Piston Barrage") });
  }
  return out;
}

// Hardened (road warrior): "1/rest, reduce all damage you take this round by
// your CON modifier"; Hardened (2 uses): "reduces damage by twice your CON
// modifier". The spend lays "hardened" for the round
// (src/lib/srd/authored-effects-genre-b.ts); src/lib/dm/pc-damage.ts takes
// the cut off every blow while it lasts, before resistance.
export function genreDamageCut(sheet: Holder & Pick<CharacterSheet, "abilities">): number {
  if (!holds(sheet, "road_warrior", "Hardened") || !sheet.conditions.some((entry) => isConditionNamed(entry, "hardened"))) {
    return 0;
  }
  const con = Math.floor(((sheet.abilities?.con ?? 10) - 10) / 2);
  return Math.max(0, con * (holdsFeature(sheet, "Hardened (2 uses)") ? 2 : 1));
}

// A cut taken off a blow of several damage types: from the largest part first.
export function cutParts<T extends { amount: number }>(parts: T[], cut: number): T[] {
  let left = cut;
  const order = parts.map((part, index) => ({ part, index })).sort((a, b) => b.part.amount - a.part.amount);
  const out = [...parts];
  for (const { part, index } of order) {
    const taken = Math.min(part.amount, left);
    out[index] = { ...part, amount: part.amount - taken };
    left -= taken;
  }
  return out.filter((part) => part.amount > 0);
}
