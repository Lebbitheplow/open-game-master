// The steel defender's Dodge: "acts on your initiative right after you,
// taking the Dodge action unless you spend a bonus action to command it". A
// defender that has not attacked since its last turn began is taking the
// Dodge action, so an attack at it is at disadvantage (SRD 5.1, Dodge). Its
// own attack (an order its artificer gave) marks it "commanded" until its
// next turn starts. Before this the Dodge was a line of its traits and an
// attack at it rolled one d20.

import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

const DEFENDER = "steel defender";
export const COMMANDED = "commanded by its artificer";

const isDefender = (sheet: Pick<CharacterSheet, "summon"> | null | undefined) => Boolean(sheet?.summon && textKey(sheet.summon.form) === DEFENDER);

// The note for an attack at the defender while it dodges, or null.
export function defenderDodging(target: Pick<CharacterSheet, "summon" | "conditions" | "name">): string | null {
  if (!isDefender(target) || target.conditions.some((entry) => textKey(entry) === textKey(COMMANDED))) {
    return null;
  }
  return `${target.name} is taking the Dodge action (uncommanded): attacks against it are at disadvantage`;
}

// The defender attacked: commanded until its next turn starts.
export function markDefenderCommanded(campaignId: string, attackerId: string): void {
  const sheet = getSheetById(attackerId);
  if (!sheet || !isDefender(sheet) || sheet.conditions.some((entry) => textKey(entry) === textKey(COMMANDED))) {
    return;
  }
  const updated = patchSheet(sheet.id, {
    conditions: [...sheet.conditions, COMMANDED],
    conditionMeta: { ...sheet.conditionMeta, [COMMANDED]: { untilTurnOf: sheet.id } } as FullPatchSheetInput["conditionMeta"],
  });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}
