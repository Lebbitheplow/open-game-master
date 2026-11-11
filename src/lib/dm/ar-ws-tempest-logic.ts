// Tempestuous Magic (Storm Sorcery 1): "Before or after casting a spell of 1st
// level or higher, a bonus action lets you fly 10 feet without provoking."
// The flight was a plain bonus-action spend: taken on a turn with no spell at
// all, it flew the sorcerer out of a reach for free, every turn.
//
// Ruling (the fifth round of the arcane repair). In a fight the flight is
// open on a turn the sorcerer has already cast a spell of 1st level or higher,
// which the turn's marks know (cast-rules.ts LEVELLED_SPELL, written by the one
// cast door). "Before" casting cannot be held: a flight taken first would bind
// the sorcerer to cast a levelled spell later in the same turn, and no call
// can hold them to that once the bonus action is spent. So the flight follows
// the cast. A cantrip opens nothing ("of 1st level or higher"). A levelled
// spell cast with the bonus action leaves no bonus action for the flight, as
// the text's own cost has it. Out of a fight no turn is kept and the call
// cannot know, so the spend is open there as it was.
//
// Read by use_resource (authored-spends.ts, for a spend whose row says
// afterLevelledCast) and by the Hand's card (battlemap/hand-subclass.ts), so
// the card is shut exactly when the engine refuses.
//
// Pure: no database.

import { budgetApplies, type TurnBudget } from "@/lib/dm/action-budget";
import { LEVELLED_SPELL } from "@/lib/dm/cast-rules";
import type { ToolError } from "@/lib/dm/tool-errors";

// Whether the turn these marks belong to has seen a spell of 1st level or
// higher cast with something other than the bonus action.
export function levelledCastThisTurn(marks: readonly string[] | null | undefined): boolean {
  return (marks ?? []).includes(LEVELLED_SPELL);
}

// What the card and the refusal both say.
export function castFirstReason(spend: string, who: string): string {
  return `${spend} follows a spell of 1st level or higher, and ${who} has cast none this turn: cast the spell first.`;
}

// The refusal for a spend that follows a levelled casting, or null when it is
// open: out of a fight, or once the holder's own turn has seen one cast.
export function castFirstRefusal(
  spend: string,
  holder: { id: string; name: string },
  fight: { round: number; turnBudget?: TurnBudget | null } | null,
): ToolError | null {
  if (!fight) {
    return null;
  }
  const budget = fight.turnBudget ?? null;
  const marks = budgetApplies(budget, holder.id, fight.round) ? budget.oncePerTurn : [];
  return levelledCastThisTurn(marks) ? null : { error: `${castFirstReason(spend, holder.name)} Nothing was spent.`, refused: "rules" };
}
