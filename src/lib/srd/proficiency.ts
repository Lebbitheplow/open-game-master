// A character's proficiency bonus, the one number every proficient roll,
// save DC and feature sized by it reads.
//
// SRD 5.1: the bonus comes from the total character level (Multiclassing:
// "always based on your total character level"), and an Ioun Stone of
// Mastery raises it: "Your proficiency bonus increases by 1 while this pale
// green prism orbits your head." The stone orbits while it is worn
// (equipped) and works while attuned (wearsWorkingItem). Before this every
// door took the level alone, so the stone did nothing.
//
// Pure and import-light: the builder, the Hand and the server all read it.

import { wearsWorkingItem, type WornMagicItem, type Wearer } from "@/lib/srd/magic-items";

// The proficiency bonus the level gives, 1st to 20th.
export function levelProficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

export const IOUN_MASTERY = "Ioun Stone of Mastery";
// The other Ioun Stones whose magic one door reads by name: Awareness (the
// surprise guard), Sustenance (food and drink), Reserve (spells stored, as a
// Ring of Spell Storing's at three levels: src/lib/srd/spell-storing.ts).
export const IOUN_AWARENESS = "Ioun Stone of Awareness";
export const IOUN_SUSTENANCE = "Ioun Stone of Sustenance";
export const IOUN_RESERVE = "Ioun Stone of Reserve";

// What worn magic adds to the proficiency bonus: 1 for an attuned, orbiting
// Ioun Stone of Mastery (one copy counts, as for any item).
export function itemProficiencyBonus(equipment: WornMagicItem[] | undefined, wearer?: Wearer): number {
  return equipment?.length && wearsWorkingItem(equipment, wearer, IOUN_MASTERY) ? 1 : 0;
}

// The character's proficiency bonus: the level's, plus the stone's.
export function proficiencyBonusOf(sheet: { level?: number; equipment?: WornMagicItem[] } & Wearer): number {
  return levelProficiencyBonus(sheet.level ?? 1) + itemProficiencyBonus(sheet.equipment, sheet);
}
