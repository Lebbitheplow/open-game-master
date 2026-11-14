// What the horror classes' features held by an engine outside the authored
// layer answer (src/lib/srd/authored-effects-genre-a-horror.ts holds their
// rows): each reader asks here, so a feature is found by its class's row and
// never by a name another class's feature shares.
//
// Pure: the sheet alone.
import { heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { normalizeCreatureType } from "@/lib/bestiary/creature-type";
import { textKey } from "@/lib/language/text-logic";

export function horrorHolds(sheet: AuthoredSheet, feature: string): boolean {
  return heldAuthored(sheet).some((entry) => isNamed(entry.feature, feature));
}

// What the horror classes' features add to one ability check, read by
// src/lib/dm/rolls.ts for skill checks and plain ability checks alike:
//   Forbidden Lore (occultist 1): "Double proficiency bonus on Arcana and
//     Religion checks" (expertise, as the bard's, on a trained skill);
//   Desperate Strength (survivor 11): "While below half HP, +2 to ... STR/DEX
//     checks" (its +2 to attack rolls is an attack_bonus row).
export type HorrorCheckRider = { expertise: boolean; bonus: number; notes: string[] };

export function horrorCheckRider(
  sheet: AuthoredSheet & { currentHp?: number; maxHp?: number },
  skill: string | null,
  ability: string,
): HorrorCheckRider {
  const out: HorrorCheckRider = { expertise: false, bonus: 0, notes: [] };
  if (skill && (skill === "arcana" || skill === "religion") && horrorHolds(sheet, "Forbidden Lore")) {
    out.expertise = true;
    out.notes.push("Forbidden Lore: double proficiency bonus");
  }
  const belowHalf = (sheet.currentHp ?? 0) < (sheet.maxHp ?? 0) / 2;
  if ((ability === "str" || ability === "dex") && belowHalf && horrorHolds(sheet, "Desperate Strength")) {
    out.bonus += 2;
    out.notes.push("Desperate Strength: +2 below half hit points");
  }
  return out;
}

// Consecrated Tools (exorcist 1): "Your weapon attacks count as magical
// against fiends, undead, and spirits" (a spirit is an undead in the SRD's
// types), read by src/lib/dm/pc-attack-damage.ts strikesAsMagic.
export function horrorMagicalAgainst(sheet: AuthoredSheet, type: string | undefined): boolean {
  const kind = type ? normalizeCreatureType(type) : null;
  return (kind === "fiend" || kind === "undead") && horrorHolds(sheet, "Consecrated Tools");
}

// The saves a horror feature gives advantage on for who forces them:
//   Ink-Stained Mind (occultist 7): "Advantage on saves against madness,
//     charm, and fear from aberrations and fiends" (madness is no condition of
//     the SRD's: the charm and the fear are what the engine can name);
//   Turncoat's Insight (apostate 13): "Advantage on saves against spells cast
//     by fiends, cultists, and aberrations" (the cultists by their stat
//     blocks: horrorCultSave below).
// The source is the spell's caster (`casterType`, named by the engine or the
// GM's request_roll) or the creature forcing the save (`sourceType`, set by
// src/lib/dm/forced-save.ts). Read by src/lib/dm/roll-feature-riders.ts, so a
// forced save and a requested one answer alike.
export function horrorSourcedSaves(
  sheet: AuthoredSheet,
  roll: { against?: string; magical?: boolean; casterType?: string; sourceType?: string },
): string[] {
  const kind = roll.casterType ?? (roll.sourceType ? normalizeCreatureType(roll.sourceType) : null);
  if (kind !== "fiend" && kind !== "aberration") {
    return [];
  }
  const notes: string[] = [];
  if ((roll.against === "charmed" || roll.against === "frightened") && horrorHolds(sheet, "Ink-Stained Mind")) {
    notes.push(`Ink-Stained Mind: advantage against the charm and fear of ${kind}s`);
  }
  if (roll.magical && horrorHolds(sheet, "Turncoat's Insight")) {
    notes.push(`Turncoat's Insight: advantage against a spell cast by a ${kind}`);
  }
  return notes;
}

// Baseline Readings (parapsychologist 5): "After 1 minute of measurement,
// grant the party advantage on the next save any of them makes against a
// haunting or psychic effect". The grant is the condition "baseline
// readings" on each of the party (src/lib/dm/genre-gh-wards.ts); a save
// against psychic damage, or one an undead forces or casts for (a haunting
// is a spirit's doing), takes the advantage and spends the condition, from
// every one of them (src/lib/dm/forced-save.ts spendRollCarriers). Read by
// src/lib/dm/roll-feature-riders.ts.
export const BASELINE_READINGS = "baseline readings";
export function baselineReadingsSave(
  sheet: Pick<AuthoredSheet, "conditions">,
  roll: { against?: string; casterType?: string; sourceType?: string },
): { condition: string; note: string } | null {
  const condition = (sheet.conditions ?? []).find((entry) => isConditionNamed(entry, BASELINE_READINGS));
  if (!condition) {
    return null;
  }
  const kind = roll.casterType ?? (roll.sourceType ? normalizeCreatureType(roll.sourceType) : null);
  const psychic = roll.against === "psychic";
  if (!psychic && kind !== "undead") {
    return null;
  }
  return { condition, note: `Baseline Readings: advantage against ${psychic ? "a psychic effect" : "a haunting"}` };
}

// Turncoat's Insight against a cultist's spell: a cultist is a humanoid, so
// its type says nothing and its stat block's slug does (the slugs Hunted
// Instincts reads). src/lib/dm/forced-save.ts asks with the creature forcing
// the save.
const CULT_SLUGS = ["cultist", "cult_fanatic"];
export function horrorCultSave(
  sheet: AuthoredSheet,
  resists: { magical?: boolean } | undefined,
  from: { slug?: string } | null | undefined,
): { advantage: "advantage"; reason: string } | null {
  return resists?.magical && CULT_SLUGS.includes(textKey(from?.slug ?? "")) && horrorHolds(sheet, "Turncoat's Insight")
    ? { advantage: "advantage", reason: "Turncoat's Insight: advantage against a cultist's spell" }
    : null;
}

// Veilsight (occultist 3): "See invisible and ethereal creatures within 30
// ft", as the reach, in squares, of the one sense the SRD engine holds that
// sees the invisible and into the Ethereal Plane: truesight (which also sees
// through magical darkness; the engine holds no narrower sense). Read by
// src/lib/dm/attack-light.ts characterSenses, the one reader of a
// character's senses.
export function horrorVeilTiles(sheet: AuthoredSheet): number {
  return horrorHolds(sheet, "Veilsight") ? 6 : 0;
}

// Nine Lives (survivor 9): "Won't Die Here ... also ends one condition on
// you": the condition that ends as the hold keeps the survivor up, the worst
// first (a player has no moment to choose at the drop). Read by
// src/lib/dm/genre-drop-holds.ts for the survivor's own hold.
const NINE_LIVES_ENDS = ["paralyzed", "stunned", "restrained", "frightened", "charmed", "blinded", "poisoned", "grappled", "deafened", "prone"];
const WONT_DIE_HERE = ["horror_won_t_die_here", "horror_the_one_who_lives"];
export function horrorDropEnds(sheet: AuthoredSheet, holdId: string): string | null {
  if (!WONT_DIE_HERE.includes(holdId) || !horrorHolds(sheet, "Nine Lives")) {
    return null;
  }
  for (const name of NINE_LIVES_ENDS) {
    const found = (sheet.conditions ?? []).find((entry) => isConditionNamed(entry, name));
    if (found) {
      return found;
    }
  }
  return null;
}

// Death's Old Acquaintance (survivor 17): "Advantage on death saves", read by
// src/lib/dm/death.ts rollDeathSave beside Diehard and Beacon of Hope.
export function horrorDeathSaveAdvantage(sheet: AuthoredSheet): string | null {
  return horrorHolds(sheet, "Death's Old Acquaintance") ? "Death's Old Acquaintance" : null;
}

// Death's Old Acquaintance: "stabilizing you takes no check". The healer
// still spends the action (src/lib/dm/stabilize.ts); the Medicine check is
// not rolled and the creature is stable.
export function horrorStabilizesWithoutCheck(sheet: AuthoredSheet): string | null {
  return horrorHolds(sheet, "Death's Old Acquaintance") ? "Death's Old Acquaintance" : null;
}
