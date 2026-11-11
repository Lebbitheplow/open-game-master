// The spend shapes the martial subclasses brought in wave 2 (fighter,
// barbarian, monk, rogue), resolved here so authored-spend-effects.ts keeps
// one line per kind. Each refuses before it writes, as every resolver does.

import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { alliesJoin } from "@/lib/dm/allies-join";
import { attacksAllowedFor, budgetFor, grantActionAttack, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { getActiveEncounter } from "@/lib/db/encounters";
import { unleashRefusal } from "@/lib/dm/mt-fb-echo";

export type MartialDoes = Extract<SpendDoes, { kind: "allies_join" | "action_attack" }>;

export function martialSpend(ctx: SpendContext, does: MartialDoes): ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> } {
  switch (does.kind) {
    case "allies_join":
      return alliesJoin(ctx, does);
    case "action_attack": {
      // From the echo's space: someone must stand in reach of it (mt-fb-echo.ts).
      const unreached = does.fromEcho ? unleashRefusal(ctx) : null;
      if (unreached) return unreached;
      const encounter = getActiveEncounter(ctx.campaign.id);
      const budget = encounter ? budgetFor(encounter, ctx.sheet.id, attacksAllowedFor(ctx.sheet), conditionTurnShape(ctx.sheet.conditions)) : null;
      const granted = grantActionAttack(budget, ctx.sheet.name, ctx.spend.name);
      if ("error" in granted) return granted;
      storeBudget(encounter!, granted.budget);
      return { result: { applied: `${ctx.sheet.name}'s Attack action holds one more attack (${granted.budget.attacksAllowed - granted.budget.attacksMade} left): ${does.note}` } };
    }
  }
}
