// The divine package's authored spends that read the table rather than
// change it (src/lib/srd/authored-effects-w2-divine.ts rows), resolved from
// src/lib/dm/authored-spend-effects.ts resolveSpendEffect like every
// authored spend: a refusal returns before anything is paid.
import { getActiveEncounter } from "@/lib/db/encounters";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { unseenBecause } from "@/lib/dm/authored-saves";
import { swallowCoverError } from "@/lib/dm/swallow";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

// Every kind this module resolves comes through here, so the shared
// resolver carries one case per kind and no rules of its own.
export function divineSpend(ctx: SpendContext, does: Extract<SpendDoes, { kind: "reveal_defenses" }>): Resolution {
  switch (does.kind) {
    case "reveal_defenses":
      return revealDefenses(ctx);
  }
}

const line = (text: string | undefined) => (text ?? "").trim();

// Hunter's Sense: "An action reveals a creature's damage immunities,
// resistances and vulnerabilities". Gap study WAVE2 D3: the answer is the
// creature's stat block (its immunities, resistances and vulnerabilities, or
// that it has none), the use is spent; a creature the ranger cannot see is
// refused, spending nothing. Before this the use was spent and the model
// was left to say what the block holds, or to guess.
export function revealDefenses(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} reads a creature in a fight; there is no fight. Nothing was spent.`, refused: "rules" };
  }
  const ref = ctx.args.targetEnemyId?.trim();
  if (!ref) {
    return { error: `${ctx.spend.name} reads one creature: pass targetEnemyId from GAME STATE. Nothing was spent.`, retry: true };
  }
  const enemy = resolveTargetFoe(encounter.campaignId, encounter, ref);
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} needs a living creature in the fight: pass targetEnemyId from GAME STATE. Nothing was spent.`, retry: true };
  }
  const walled = swallowCoverError(ctx.sheet.id, enemy.id);
  if (walled) {
    return walled;
  }
  const unseen = unseenBecause(encounter.id, ctx.sheet, enemy);
  if (unseen) {
    return { error: `${ctx.sheet.name} cannot see ${enemy.displayName} (${unseen}), and ${ctx.spend.name} reads a creature they can see. Nothing was spent.`, refused: "rules" };
  }
  const immune = line(enemy.stats.immune);
  const resist = line(enemy.stats.resist);
  const vulnerable = line(enemy.stats.vulnerable);
  const parts = [
    immune ? `immune to ${immune}` : "",
    resist ? `resists ${resist}` : "",
    vulnerable ? `vulnerable to ${vulnerable}` : "",
  ].filter(Boolean);
  return {
    result: {
      creature: enemy.displayName,
      immunities: immune || "none",
      resistances: resist || "none",
      vulnerabilities: vulnerable || "none",
      reveals: parts.length
        ? `${ctx.sheet.name} senses ${enemy.displayName}: ${parts.join("; ")}.`
        : `${ctx.sheet.name} senses ${enemy.displayName} has no damage immunities, resistances or vulnerabilities.`,
    },
  };
}
