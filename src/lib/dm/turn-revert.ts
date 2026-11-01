import type { Campaign } from "@/lib/db/campaigns";
import { diceGiveBackWarnings, giveBackDice } from "@/lib/db/dice-scripts";
import { getEncounter, saveEncounter, turnKey } from "@/lib/db/encounters";
import type { SpentBudget } from "@/lib/db/spent-budget";
import { markTurnChangesReverted, type TurnChange } from "@/lib/db/turn-changes";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { fightEventWarnings, takeBackFightEvent } from "@/lib/dm/fight-event-undo";
import { cardRevertWarnings, takeBackCardResolution } from "@/lib/dm/resolve-card";

// The part of "Revert this turn" that is not a sheet or the clock (issue
// 685; src/lib/db/turn-changes.ts lists what a turn keeps): the prepared
// fight's events it fired, the test dice it spent, the cards the GM resolved
// in it, the action economy it spent. The route (audit/revert-turn) asks for
// the warnings first and then takes them back, after the sheets.

const budgetOf = (value: unknown) => (value && typeof value === "object" ? (value as SpentBudget["turnBudget"]) : null);
const idsOf = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

function spentOf(change: TurnChange): SpentBudget | null {
  const raw = change.payload;
  const after = (raw.after ?? {}) as { turnBudget?: unknown; reactionsUsed?: unknown };
  return typeof raw.encounterId === "string" && typeof raw.turnKey === "string" && typeof raw.round === "number"
    ? {
        encounterId: raw.encounterId,
        turnKey: raw.turnKey,
        round: raw.round,
        turnBudget: budgetOf(raw.turnBudget),
        reactionsUsed: idsOf(raw.reactionsUsed),
        after: { turnBudget: budgetOf(after.turnBudget), reactionsUsed: idsOf(after.reactionsUsed) },
      }
    : null;
}

// The fight still on the creature's turn the budget was spent on.
function onThatTurn(spent: SpentBudget) {
  const encounter = getEncounter(spent.encounterId);
  return encounter && encounter.status === "active" && turnKey(encounter) === spent.turnKey ? encounter : null;
}

// A later turn spent more of the same creature's turn: giving this turn's
// spending back gives that back too, so the lead is told first.
function budgetWarnings(change: TurnChange): string[] {
  const spent = spentOf(change);
  const encounter = spent ? onThatTurn(spent) : null;
  return spent && encounter && JSON.stringify(encounter.turnBudget) !== JSON.stringify(spent.after.turnBudget)
    ? ["The creature whose turn it is has spent more of it since (an action, a bonus action, an attack); reverting gives that back too."]
    : [];
}

// The action, bonus action and attacks back while the fight is still on the
// creature's turn they were spent on; the reactions this turn spent back
// while it is still the same round, by themselves, so one a later turn spent
// stays spent. Past those, the budget is the next turn's and is not touched.
function giveBackBudget(change: TurnChange): boolean {
  const spent = spentOf(change);
  const encounter = spent ? getEncounter(spent.encounterId) : null;
  if (!spent || !encounter || encounter.status !== "active") {
    return false;
  }
  let changed = false;
  if (encounter.round === spent.round) {
    const spentHere = new Set(spent.after.reactionsUsed.filter((id) => !spent.reactionsUsed.includes(id)));
    const kept = encounter.reactionsUsed.filter((id) => !spentHere.has(id));
    changed = kept.length !== encounter.reactionsUsed.length;
    encounter.reactionsUsed = kept;
  }
  if (onThatTurn(spent)) {
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
