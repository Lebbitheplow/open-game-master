// use_item's half of the SRD's manuals and tomes (src/lib/srd/studied-books.ts):
// the score rises by the book's amount, the maximum with it (recorded as the
// reading's story feature), and a Constitution raised moves the hit point
// maximum for every level held (SRD 5.1, Hit Points: "as though you had the
// new modifier from 1st level"). The book's one reading a century is its
// charge (item-use.ts spends it).

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { storyEditHp } from "@/lib/dm/update-sheet-hp-logic";
import { studiedRecord } from "@/lib/srd/studied-books";
import type { Ability } from "@/lib/schemas/abilities";

const ABILITY_WORD: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

// The reading applied to the reader's sheet, and the words for the note.
export function studyBook(campaign: Campaign, sheetId: string, book: string, reading: { ability: Ability; amount: number }, turnId: string): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return null;
  }
  const was = sheet.abilities[reading.ability];
  const abilities = { ...sheet.abilities, [reading.ability]: Math.min(30, was + reading.amount) };
  const features = [...sheet.features, { name: studiedRecord(book, reading), source: "story" as const }];
  const hp = storyEditHp(sheet, { abilities }, { hpMethod: campaign.gameSettings.hpMethod });
  const word = ABILITY_WORD[reading.ability];
  patchSheetAudited(campaign.id, sheet.id, { abilities, features, ...(hp ?? {}) }, {
    kind: "use_item",
    reason: `${book} studied: ${word} ${was} to ${abilities[reading.ability]}, and its maximum with it`,
    delta: { [reading.ability]: abilities[reading.ability], ...(hp ? { maxHp: hp.maxHp } : {}) },
  });
  void turnId;
  return `${sheet.name}'s ${word} rises from ${was} to ${abilities[reading.ability]}, and its maximum by ${reading.amount} with it${hp ? `; the hit point maximum is ${hp.maxHp}` : ""}. This is 48 hours of study over 6 days or fewer: pass that time if it has not passed. ${book} has lost its magic for a century.`;
}
