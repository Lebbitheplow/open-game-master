// One with the Word's price (Order of Scribes 14): "a reaction dismisses it to
// prevent all of that damage; then roll 3d6, and spells in your book with a
// combined level at least that total vanish from it until you finish 1d6 long
// rests (if there aren't enough, you drop to 0 hit points)."
//
// Before this the reaction prevented the damage and told the price: the 3d6
// was rolled, and taking the spells off the sheet was left to the lead, so the
// damage was prevented for free. Now the server takes spells of that combined
// level out of the book (src/lib/srd/ar-ws-spellbook.ts says which, and keeps
// them on the sheet), rolls the 1d6 long rests they stay gone, and the long
// rest counts them back (rest-logic.ts longRestPatch).
//
// Ruling, where the text is short: a book that cannot pay the total keeps its
// spells, and the wizard drops to 0 hit points in their place. That is no
// damage (nothing resists it, no blow is recorded): the hit points are set to
// 0, the wizard falls unconscious and prone, and their concentration ends.
//
// Called by src/lib/dm/reaction-counters.ts (One with the Word), after the
// damage is given back.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { spellFactsFor } from "@/lib/content";
import { breakConcentration } from "@/lib/dm/concentration";
import { rollCard } from "@/lib/dm/roll-card";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { downConditions } from "@/lib/dm/vitals-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { bookEntries, spellsToVanish, vanishFromBook } from "@/lib/srd/ar-ws-spellbook";
import { checklistSpell } from "@/lib/srd/spell-lists";

// Pays the 3d6 just rolled (`total`) from the wizard's book. `named`: the
// spells the wizard would lose first, as the call's variant lists them
// ("Shield, Fly"). Answers the lines the reaction's result carries.
export function payTheWord(campaign: Campaign, turn: DmTurn | null, wizard: CharacterSheet, total: number, named?: string): Record<string, unknown> {
  const sheet = getSheetById(wizard.id) ?? wizard;
  const authors = spellAuthorsFor(campaign);
  const levelOf = (spell: string) => spellFactsFor(spell, authors)?.level ?? checklistSpell(spell)?.level ?? null;
  const first = (named ?? "").split(/[,;]/).map((name) => name.trim()).filter(Boolean);
  const taken = sheet.spellcasting ? spellsToVanish(bookEntries(sheet.spellcasting), total, levelOf, first) : null;
  if (!taken || !sheet.spellcasting) {
    patchSheet(sheet.id, { currentHp: 0, ...downConditions(sheet) });
    const dropped = breakConcentration(campaign, turn?.id ?? null, sheet.id, `${sheet.name} dropped to 0 hit points`);
    return {
      spellbook: `The 3d6 came to ${total}, and ${sheet.name}'s book holds fewer spell levels than that: no spell vanishes, and ${sheet.name} drops to 0 hit points instead (unconscious and prone; death saving throws from their next turn).`,
      droppedTo0: true,
      ...(dropped ? { concentration: dropped } : {}),
    };
  }
  const rests = rollCard(campaign, turn, sheet.id, "custom", `${sheet.name}: One with the Word, long rests the spells stay gone`, "1d6", null).total;
  patchSheet(sheet.id, { spellcasting: vanishFromBook(sheet.spellcasting, taken, rests) });
  const levels = taken.reduce((sum, entry) => sum + entry.level, 0);
  return {
    spellbook: `The 3d6 came to ${total}: ${taken.map((entry) => `${entry.spell} (level ${entry.level})`).join(", ")} vanish${taken.length === 1 ? "es" : ""} from ${sheet.name}'s book, ${levels} spell level${levels === 1 ? "" : "s"} in all, until ${sheet.name} finishes ${rests} long rest${rests === 1 ? "" : "s"}. They cannot be cast or prepared meanwhile; the server writes them back.`,
    vanished: taken.map((entry) => entry.spell),
    longRests: rests,
  };
}
