// The aeronaut's spends the cc1113 genre-b pass wired (kind "steampunk",
// src/lib/srd/genre-b-steampunk-types.ts), resolved here:
//   grapnel  Grapnel Ace (aeronaut 15): "Grapnel Line can also disarm or trip
//            (contested by STR) at 30 ft". The aeronaut's Athletics check
//            against the creature's Strength roll; winning lays prone (trip)
//            or the disarmed mark a Disarming Attack leaves (disarm). A tie
//            leaves things as they were (SRD 5.1, Contests).
//   extra_turn  Legend of the Skies (aeronaut 20): "When you roll initiative,
//            gain a full extra turn before the first round begins": a second
//            full turn in the first round, taken on the aeronaut's own turn,
//            as Terminal Focus's (genre-a-horror-spends.ts).
//   boarding  Boarding Action (aeronaut 13): "1/rest, when combat starts,
//            immediately move your speed and make one attack": in the first
//            round, the aeronaut's speed again and one weapon attack beside
//            their own action (the turn's Dash and Haste-like action counts).
import { getActiveEncounter, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { saveModFor } from "@/lib/bestiary/enemy-numbers";
import { rollExpression } from "@/lib/dice";
import { dashCount } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import type { ToolError } from "@/lib/dm/tool-errors";
import { DISARMED } from "@/lib/srd/genre-b-steampunk-attacks";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";

type Outcome = ToolError | { result: Record<string, unknown>; patch?: FullPatchSheetInput };

const refused = (error: string): ToolError => ({ error: `${error} Nothing was spent.`, refused: "rules" });

export function grapnelAce(ctx: SpendContext, mode: "trip" | "disarm"): Outcome {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const ref = ctx.args.targetEnemyId?.trim() ?? "";
  const enemy: EncounterEnemy | null = encounter && ref ? resolveEnemyRef(encounter.id, ref) : null;
  if (!encounter || !enemy) {
    return refused(`Grapnel Ace ${mode === "trip" ? "trips" : "disarms"} one creature in the fight: name it in targetEnemyId.`);
  }
  if (!withinFeet(encounter.id, ctx.sheet.id, enemy.id, 30)) {
    return refused(`${enemy.displayName} is beyond the grapnel's 30 feet.`);
  }
  const mine = rollCharacterCheck(ctx.campaign, ctx.sheet, { skill: "athletics" }, "Grapnel Ace");
  const theirs = rollExpression(`1d20+${saveModFor(enemy.stats, "str")}`, undefined, { purpose: { roller: "enemy", kind: "check", who: enemy.displayName } }).total;
  const won = mine.total > theirs;
  const contest = `Athletics ${mine.total} against ${enemy.displayName}'s Strength ${theirs}`;
  if (!won) {
    return { result: { contest, outcome: `${enemy.displayName} holds firm.` } };
  }
  layEnemyConditionInstance(ctx.campaign, enemy, mode === "trip" ? "prone" : DISARMED, { source: ctx.sheet.id, ...(mode === "disarm" ? { rounds: 1 } : {}) });
  publishEncounter(ctx.campaign.id);
  return { result: { contest, outcome: mode === "trip" ? `${enemy.displayName} is knocked prone.` : `${enemy.displayName} is disarmed: what it held falls (handle_item drop with its enemyId).` } };
}

export function extraTurn(ctx: SpendContext, label: string): Outcome {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter || encounter.round > 1 || !ctx.marks) {
    return refused(`${label} is a second full turn in the first round of a fight, taken on ${ctx.sheet.name}'s own turn.`);
  }
  saveEncounter({ ...encounter, turnBudget: null, reactionsUsed: encounter.reactionsUsed.filter((id) => id !== ctx.sheet.id) });
  publishEncounter(ctx.campaign.id);
  return { result: { applied: [`${ctx.sheet.name} takes a full extra turn now: their action, bonus action, movement and reaction are fresh.`] } };
}

export function boardingAction(ctx: SpendContext): Outcome {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const budget = encounter && ctx.marks ? budgetFor(encounter, ctx.sheet.id, attacksAllowedFor(ctx.sheet), conditionTurnShape(ctx.sheet.conditions)) : null;
  if (!encounter || encounter.round > 1 || !budget) {
    return refused(`Boarding Action is taken as the fight starts, on ${ctx.sheet.name}'s turn in the first round.`);
  }
  storeBudget(encounter, { ...budget, dashed: true, dashes: dashCount(budget) + 1, extraActions: (budget.extraActions ?? 0) + 1 });
  publishEncounter(ctx.campaign.id);
  return { result: { applied: [`${ctx.sheet.name} boards: their speed again this turn, and one weapon attack beside their own action.`] } };
}
