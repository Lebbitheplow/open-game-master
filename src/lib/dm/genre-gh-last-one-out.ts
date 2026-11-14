// Last One Out (survivor 13): "Allies within 10 ft may use your Adrenaline
// Surge movement options as a reaction when you do, 1/rest each". When the
// survivor takes Adrenaline Surge's Dash or Disengage on their turn
// (action-tools.ts marks the turn with SURGE_MARK), an ally within 10 feet
// answers with use_reaction Last One Out: a move of their speed that draws
// no opportunity attack (the Dash's ground and the Disengage's safety,
// reactionMove's "opened" move). The use is the survivor's Last One Out
// counter (its row in src/lib/classes/resources.json).
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { withinFeet } from "@/lib/dm/authored-saves";
import { reactionMove } from "@/lib/dm/authored-reactions-more";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SURGE_MARK = "horror:adrenaline surge";
const SURGE_MOVES = ["dash", "disengage"];

type Ctx = Parameters<typeof reactionMove>[0];

// The survivor's Adrenaline Surge took a movement option this turn.
export function markSurge(campaignId: string, action: string) {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget;
  if (!encounter || !budget || !SURGE_MOVES.includes(action) || budget.oncePerTurn.includes(SURGE_MARK)) {
    return;
  }
  storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, SURGE_MARK] });
}

function surgedThisTurn(encounter: Encounter | null, holder: CharacterSheet): boolean {
  const budget = encounter?.turnBudget;
  return Boolean(budget && budget.ownerId === holder.id && budget.oncePerTurn.includes(SURGE_MARK));
}

export function lastOneOut(ctx: Ctx, holder: CharacterSheet, name: string, rangeFt: number): ToolResult {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (holder.id === ctx.sheet.id) {
    return { error: `${name} is for ${holder.name}'s allies; ${holder.name} moves with Adrenaline Surge itself. Nothing was spent.`, refused: "rules" };
  }
  if (!surgedThisTurn(encounter, holder)) {
    return { error: `${name} answers ${holder.name} using Adrenaline Surge to Dash or Disengage on their turn, and they have not this turn. Nothing was spent.`, refused: "rules" };
  }
  if (!encounter || !withinFeet(encounter.id, holder.id, ctx.sheet.id, rangeFt)) {
    return { error: `${ctx.sheet.name} is not within ${rangeFt} feet of ${holder.name}. Nothing was spent.`, refused: "rules" };
  }
  return reactionMove(ctx, name, "opened", "full");
}
