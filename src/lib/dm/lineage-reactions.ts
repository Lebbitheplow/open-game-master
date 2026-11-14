// A lineage's own reaction, taken through use_reaction
// (src/lib/dm/reaction-tools.ts):
//
//   Swiftstride (a shifter's subtype, src/lib/srd/races.json): "shifted: 10
//   more feet of speed, and a 10-foot step as a reaction". The step answers
//   a foe within 5 feet (the text's "when a creature ends its turn within 5
//   feet of you"), moves up to 10 feet, and draws no opportunity attack
//   (authored-reactions-more.ts reactionMove). Only in the form Shifting lays.

import { reactionMove } from "@/lib/dm/authored-reactions-more";
import { spendReaction, SPENT, type Ctx } from "@/lib/dm/reaction-tools";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { holdsFeature, isConditionNamed, isNamed } from "@/lib/srd/feature-names";

const SWIFTSTRIDE_FEET = 10;

// Null when the reaction named is none of these.
export function lineageReaction(ctx: Ctx): ToolResult | null {
  if (!isNamed(ctx.args.feature, "swiftstride", "swiftstride step") || !holdsFeature(ctx.sheet, "Swiftstride")) {
    return null;
  }
  if (!ctx.sheet.conditions.some((entry) => isConditionNamed(entry, "shifted (swiftstride)"))) {
    return { error: `Swiftstride's step is taken while shifted, and ${ctx.sheet.name} is not: use_resource Shifting on their turn first. Nothing was spent.`, refused: "rules" };
  }
  const moved = reactionMove(ctx, "Swiftstride", "enemy_adjacent", SWIFTSTRIDE_FEET);
  if ("error" in moved) {
    return moved;
  }
  spendReaction(ctx);
  return { ok: true, reaction: "Swiftstride", spent: SPENT(ctx.sheet.name), ...moved };
}
