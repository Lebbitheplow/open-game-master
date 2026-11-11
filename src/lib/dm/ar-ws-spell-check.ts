// Improved Abjuration (School of Abjuration 10): "Add your proficiency bonus
// to ability checks made as part of an abjuration spell, such as counterspell
// and dispel magic." The row was narrated ("the GM adds it to that check"),
// but the server rolls both checks and settles the spell itself, so the GM had
// nothing to add it to: an abjurer's Counterspell failed on a roll the feature
// turns into a success.
//
// Every check a character makes inside a tool is built by
// contest-roll.ts rollCharacterCheck. A caller whose check is part of a spell
// names the spell there (`spell`), and this module answers what the caster's
// features add for it. A new door that rolls an ability check as part of a
// spell must name the spell the same way, never add the bonus itself.

import { spellSchoolFor } from "@/lib/content";
import type { Campaign } from "@/lib/db/campaigns";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { textKey } from "@/lib/language/text-logic";
import { proficiencyBonus } from "@/lib/srd";
import { activeAuthored } from "@/lib/srd/authored-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// What the caster's features add to an ability check made as part of this
// spell, or null.
export function spellCheckBonus(campaign: Campaign, sheet: CharacterSheet, spell: string): { amount: number; note: string } | null {
  const rows = activeAuthored(sheet, "spell_check_prof");
  if (!rows.length) {
    return null;
  }
  const school = textKey(spellSchoolFor(spell, spellAuthorsFor(campaign)) ?? "");
  const row = rows.find(({ effect }) => textKey(effect.school) === school);
  if (!row) {
    return null;
  }
  const amount = proficiencyBonus(sheet.level);
  return { amount, note: `${row.held.feature}: +${amount} (proficiency bonus), the check is part of ${spell}` };
}

// The roll extras of a check with that bonus folded into the lasting-effect
// bonus the resolver already adds to every ability check (rolls.ts).
export function withSpellCheckBonus<T extends { effectBonus?: number; effectNote?: string }>(
  extras: T,
  campaign: Campaign,
  sheet: CharacterSheet,
  spell: string | undefined,
): T {
  const bonus = spell ? spellCheckBonus(campaign, sheet, spell) : null;
  if (!bonus) {
    return extras;
  }
  return {
    ...extras,
    effectBonus: (extras.effectBonus ?? 0) + bonus.amount,
    effectNote: [extras.effectNote, bonus.note].filter(Boolean).join("; "),
  };
}
