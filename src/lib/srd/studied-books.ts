// The SRD's manuals and tomes, read: SRD 5.1, Manual of Bodily Health, "If
// you spend 48 hours over a period of 6 days or fewer studying the book's
// contents and practicing its guidelines, your Constitution score increases
// by 2, as does your maximum for that score." Gainful Exercise (Strength),
// Quickness of Action (Dexterity), and the Tomes of Clear Thought
// (Intelligence), Leadership and Influence (Charisma) and Understanding
// (Wisdom) likewise. Before this nothing read them: the GM could only patch
// the score, held at 20, and no level-up or legality check knew the maximum
// had risen.
//
// The reading is recorded on the sheet as a story feature naming the book
// and what it raised ("Manual of Bodily Health (studied: +2 Constitution)"),
// written only by use_item (src/lib/dm/item-use.ts): a player's edit may not
// add a mechanical story feature (src/lib/srd/legality/features.ts), and
// update_sheet refuses one (src/lib/dm/mutations.ts). The cap every door
// reads is 20 plus what these records raise (featureAbilityGrants in
// src/lib/srd/trait-rules.ts, abilityCapsOf below).
//
// Pure and import-light: the builder and the sheet read it too.

import type { Ability } from "@/lib/schemas/abilities";

const ABILITY_WORDS: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const RECORD = /^(.+) \(studied: \+(\d) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\)$/;

// The feature a reading writes.
export function studiedRecord(book: string, reading: { ability: Ability; amount: number }): string {
  return `${book.trim()} (studied: +${reading.amount} ${ABILITY_WORDS[reading.ability]})`;
}

// What one feature name records, or null when it is no reading.
export function studiedRaise(name: string): { book: string; ability: Ability; amount: number } | null {
  const match = RECORD.exec(name.trim());
  if (!match) {
    return null;
  }
  const ability = (Object.keys(ABILITY_WORDS) as Ability[]).find((key) => ABILITY_WORDS[key] === match[3]);
  return ability ? { book: match[1], ability, amount: Number(match[2]) } : null;
}

// How far each maximum stands above 20 from the books this sheet has read.
export function studiedRaises(features: ReadonlyArray<{ name: string }> | undefined): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  for (const feature of features ?? []) {
    const raise = studiedRaise(feature.name);
    if (raise) {
      out[raise.ability] = (out[raise.ability] ?? 0) + raise.amount;
    }
  }
  return out;
}

// The records of readings among these features, in order, for comparing
// what an edit sends with what the sheet holds.
export function studiedRecords(features: ReadonlyArray<{ name: string }> | undefined): string[] {
  return (features ?? []).map((feature) => feature.name.trim()).filter((name) => studiedRaise(name)).sort();
}

// The most an Ability Score Improvement may take each score to: 20, and
// what a book read raised the maximum by.
export function abilityCapsOf(sheet: { features?: ReadonlyArray<{ name: string }> }, base = 20): Record<Ability, number> {
  const raises = studiedRaises(sheet.features);
  return Object.fromEntries((Object.keys(ABILITY_WORDS) as Ability[]).map((ability) => [ability, base + (raises[ability] ?? 0)])) as Record<Ability, number>;
}
