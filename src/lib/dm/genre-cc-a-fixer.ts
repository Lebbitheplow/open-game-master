// The fixer's and the trauma doc's features the 2026-11-13 creator audit's
// second genre pass wired (WAVE2 D5: the genre text is the rule):
//
//   Silver Ledger (fixer 6): "Sell goods at full value": a shop pays the
//     fixer the list price, not half (src/lib/dm/shop-tools.ts handleSellItem);
//   Neutral Ground (fixer 13): "A creature that accepts your parley cannot
//     attack you until your next turn": the creature named is marked for the
//     fixer until their next turn starts (src/lib/dm/genre-cc-a-spends.ts),
//     and its attack on them is refused (src/lib/dm/enemy-attack.ts);
//   Exit Strategy (fixer 7): "When you roll initiative, move up to your speed
//     without provoking opportunity attacks": the fight's start leaves the
//     mark the move spends (src/lib/dm/feature-hooks.ts), until the fixer's
//     first turn starts.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

export const PARLEY = "neutral ground";
export const EXIT = "exit strategy";

export function sellsAtFullValue(sheet: Pick<CharacterSheet, "class" | "classes" | "features">): boolean {
  return holdsGenreFeature(sheet, "fixer", "Silver Ledger");
}

// Whether the creature's parley with this character holds: the attack is refused.
export function parleyHolds(creature: { conditions: string[]; conditionMeta?: unknown }, targetId: string): boolean {
  const meta = (creature.conditionMeta ?? {}) as ConditionMetaMap;
  return creature.conditions.some((entry) => isConditionNamed(entry, PARLEY) && meta[entry]?.source === targetId);
}

export function exitAtInitiative(campaign: Campaign, sheetId: string): string[] {
  const sheet = getSheetById(sheetId);
  if (!sheet || sheet.deathSaves?.dead || !holdsGenreFeature(sheet, "fixer", "Exit Strategy")) {
    return [];
  }
  const kept = sheet.conditions.filter((entry) => !isConditionNamed(entry, EXIT));
  const updated = patchSheet(sheet.id, { conditions: [...kept, EXIT], conditionMeta: { ...sheet.conditionMeta, [EXIT]: { untilTurnOf: sheet.id } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return [`Exit Strategy: ${sheet.name} may move up to their speed now without provoking opportunity attacks (use_resource "Exit Strategy" with x and y).`];
}
