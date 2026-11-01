import type { Campaign } from "@/lib/db/campaigns";
import { diceGiveBackWarnings, giveBackDice } from "@/lib/db/dice-scripts";
import { getEncounter, saveEncounter, turnKey } from "@/lib/db/encounters";
import type { SpentBudget } from "@/lib/db/spent-budget";
import { liveTurnChangesAfter, markTurnChangesReverted, type TurnChange } from "@/lib/db/turn-changes";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { fightEventWarnings, takeBackFightEvent } from "@/lib/dm/fight-event-undo";
import { cardRevertWarnings, takeBackCardResolution } from "@/lib/dm/resolve-card";

// The part of "Revert this turn" that is not a sheet or the clock (issue
// 685; src/lib/db/turn-changes.ts lists what a turn keeps): the prepared
// fight's events it fired, the test dice it spent, the cards the GM resolved
// in it, the action economy it spent. The route (audit/revert-turn) asks for
// the warnings first and then takes them back, after the sheets.

function spentOf(change: TurnChange): SpentBudget | null {
  const raw = change.payload;
  return typeof raw.encounterId === "string" && typeof raw.turnKey === "string" && typeof raw.round === "number"
    ? {
        encounterId: raw.encounterId,
        turnKey: raw.turnKey,
        round: raw.round,
        turnBudget: (raw.turnBudget ?? null) as SpentBudget["turnBudget"],
        reactionsUsed: Array.isArray(raw.reactionsUsed) ? raw.reactionsUsed.filter((id): id is string => typeof id === "string") : [],
      }
    : null;
}

// A later turn spent more of the same creature's turn: giving this turn's
// back gives that back too, so the lead is told.
function budgetWarnings(change: TurnChange): string[] {
  const spent = spentOf(change);
  const later = spent
    ? liveTurnChangesAfter(change).filter((entry) => {
        const other = spentOf(entry);
        return other !== null && other.encounterId === spent.encounterId && other.round === spent.round;
      })
    : [];
  return later.length ? ["The fight's turn has spent more since this GM turn (an action, a reaction); reverting gives that back too."] : [];
}

// The action, bonus action and attacks back while the fight is still on the
// creature's turn they were spent on, and the reactions while it is still the
// same round: past those, the budget is the next turn's and is not touched.
function giveBackBudget(change: TurnChange): boolean {
  const spent = spentOf(change);
  const encounter = spent ? getEncounter(spent.encounterId) : null;
  if (!spent || !encounter || encounter.status !== "active") {
    return false;
  }
  let changed = false;
  if (encounter.round === spent.round) {
    encounter.reactionsUsed = spent.reactionsUsed;
    changed = true;
  }
  if (turnKey(encounter) === spent.turnKey) {
    encounter.turnBudget = spent.turnBudget;
    changed = true;
  }
  if (changed) {
    saveEncounter(encounter);
  }
  return changed;
}

export function turnChangeWarnings(campaign: Campaign, changes: readonly TurnChange[]): string[] {
  const dice = changes.filter((change) => change.kind === "dice_face" || change.kind === "dice_seed");
  return [
    ...changes.flatMap((change) => {
      switch (change.kind) {
        case "fight_event":
          return fightEventWarnings(change);
        case "card":
          return cardRevertWarnings(change);
        case "budget":
          return budgetWarnings(change);
        default:
          return [];
      }
    }),
    ...(dice.length ? diceGiveBackWarnings(campaign.id, dice) : []),
  ];
}

// Newest first, as the sheets go back: an event a later event brought on is
// taken back before the one that brought it. Returns how many were.
export function takeBackTurnChanges(campaign: Campaign, changes: readonly TurnChange[]): number {
  const dice = changes.filter((change) => change.kind === "dice_face" || change.kind === "dice_seed");
  if (dice.length) {
    giveBackDice(campaign.id, dice);
  }
  let budget = false;
  for (const change of [...changes].reverse()) {
    if (change.kind === "fight_event") {
      takeBackFightEvent(campaign, change);
    } else if (change.kind === "card") {
      takeBackCardResolution(change);
    } else if (change.kind === "budget") {
      budget = giveBackBudget(change) || budget;
    }
  }
  if (budget) {
    publishEncounter(campaign.id);
  }
  markTurnChangesReverted(changes.map((change) => change.id));
  return changes.length;
}
