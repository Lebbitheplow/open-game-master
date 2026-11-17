// The plumbing handle_item's two halves share (src/lib/dm/gear-tool.ts,
// src/lib/dm/gear-ground.ts): its refusals and the acting combatant's running
// budget. A sheet's equipment is saved by its owner, src/lib/owners/items.ts.
import type { Encounter } from "@/lib/db/encounters";
import type { TurnBudget } from "@/lib/dm/action-budget";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";

export const retry = (error: string): ToolResult => ({ error, retry: true });
export const refuse = (error: string): ToolResult => ({ error, refused: "rules" });

// The fight's running budget for this combatant, when it is their turn.
export function ownBudget(encounter: Encounter | null, sheet: CharacterSheet): TurnBudget | null {
  return budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
}
