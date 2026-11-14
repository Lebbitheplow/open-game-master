// A steampunk spend a feature makes free once a turn (WAVE2 D5):
//
//   The Engine Eternal (steam knight 20)  "Head of Steam is free once per turn."
//
// src/lib/dm/authored-spends.ts asks this before it charges the spend's cost:
// the key it gets back is the turn's mark the free use leaves, and the spend
// then costs no bonus action. The rule itself is
// src/lib/srd/genre-b-steampunk-attacks.ts freeSpendKey, which the Hand's card
// prices by; this adds what only the engine knows, that the turn is the
// holder's own and that they can act on it. A knight who cannot take a bonus
// action (stunned, held for the enemies before them) gets nothing waived, and
// the ordinary charge refuses in its own words.
//
// Before this the first Head of Steam of a turn cost the bonus action.
import type { Encounter } from "@/lib/db/encounters";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { freeSpendKey, mayBeFree } from "@/lib/srd/genre-b-steampunk-attacks";

export function freeSpendThisTurn(sheet: CharacterSheet, spendName: string, encounter: Encounter | null): string | null {
  if (!encounter || (encounter.kind ?? "fight") !== "fight") {
    return null;
  }
  // Asked before the budget: budgetFor begins a held turn, and only a spend
  // that could be free at all may do that.
  if (!mayBeFree(sheet, spendName)) {
    return null;
  }
  if (!canAct({ sheet, encounter, kind: "bonus" }).ok || heldTurnRefusal(encounter, sheet)) {
    return null;
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  return freeSpendKey(sheet, spendName, budget?.oncePerTurn);
}
