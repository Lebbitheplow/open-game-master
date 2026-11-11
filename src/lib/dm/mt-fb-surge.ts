// How many allies may answer one trigger of a party reaction (Inspiring
// Surge: "Action Surge also lets an ally ... two allies from 18th level").
// A party reaction was taken by whoever named it, so at 10th level two allies
// each made the attack. The answers are kept on the turn that holds the
// trigger (the banneret's own: the surge is its mark), one key per ally, and
// authored-reactions.ts asks here before the reaction is spent and writes here
// once the attack is made.
import { getActiveEncounter } from "@/lib/db/encounters";
import { storeBudget } from "@/lib/dm/turn-budget";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const key = (name: string) => `answered:${name}:`;

function holderTurn(campaignId: string, holderId: string) {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget && encounter.turnBudget.ownerId === holderId && encounter.turnBudget.round === encounter.round ? encounter.turnBudget : null;
  return encounter && budget ? { encounter, budget } : null;
}

export function answersRefusal(campaignId: string, holder: CharacterSheet, name: string, most: number): ToolError | null {
  const turn = holderTurn(campaignId, holder.id);
  const taken = (turn?.budget.oncePerTurn ?? []).filter((mark) => mark.startsWith(key(name))).length;
  if (taken < most) {
    return null;
  }
  return {
    error: `${name} lets ${most === 1 ? "one ally" : `${most} allies`} of ${holder.name} answer, and ${most === 1 ? "one has" : `${most} have`} already. Nothing was spent.`,
    refused: "rules",
  };
}

export function noteAnswer(campaignId: string, holder: CharacterSheet, name: string, reactorId: string) {
  const turn = holderTurn(campaignId, holder.id);
  if (turn) {
    storeBudget(turn.encounter, { ...turn.budget, oncePerTurn: [...turn.budget.oncePerTurn, `${key(name)}${reactorId}`] });
  }
}
