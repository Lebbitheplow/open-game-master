// Mantle of Inspiration (College of Glamour), the clause its spend left out:
// "When a creature gains these temporary hit points, it can immediately use
// its reaction to move up to its speed, without provoking opportunity
// attacks." The spend marks every creature it chose (authored-spend-effects.ts
// temp_hp, whether or not their own temporary hit points were higher), and
// use_reaction "Mantle of Inspiration" with the square is the move: the whole
// speed, no opportunity attacks, the creature's reaction. "Immediately" is
// the bard's turn: the mark ends with it.
import type { Campaign } from "@/lib/db/campaigns";
import { MANTLE_STRIDE } from "@/lib/battlemap/hand-feature-doors";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { reactionMove } from "@/lib/dm/authored-reactions-more";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { SPENT, spendReaction } from "@/lib/dm/reaction-tools";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The mark is named where the Hand deals the stride (hand-feature-doors.ts).
export { MANTLE_STRIDE } from "@/lib/battlemap/hand-feature-doors";
const FEATURE = "Mantle of Inspiration";

// The creatures the mantle chose may move: called by the spend that gave the
// temporary hit points, for that feature only.
export function markMantleStride(campaign: Campaign, bard: Pick<CharacterSheet, "id">, spendName: string, chosen: ReadonlyArray<Pick<CharacterSheet, "id">>): void {
  if (!isNamed(spendName, FEATURE)) {
    return;
  }
  for (const ally of chosen) {
    const fresh = getSheetById(ally.id);
    if (!fresh || fresh.conditions.some((entry) => isConditionNamed(entry, MANTLE_STRIDE))) {
      continue;
    }
    const meta: ConditionMetaMap = { ...(fresh.conditionMeta as ConditionMetaMap), [MANTLE_STRIDE]: { source: bard.id, untilTurnEndOf: bard.id, turnBegun: true } };
    patchSheetAudited(campaign.id, fresh.id, { conditions: [...fresh.conditions, MANTLE_STRIDE], conditionMeta: meta }, { kind: "set_condition", reason: `${FEATURE}: may move with their reaction`, delta: { condition: MANTLE_STRIDE } });
  }
}

type Ctx = Parameters<typeof reactionMove>[0];

// use_reaction "Mantle of Inspiration": null for any other feature.
export function mantleMove(ctx: Ctx): ToolResult | null {
  if (!isNamed(ctx.args.feature, FEATURE)) {
    return null;
  }
  const sheet = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  if (!sheet.conditions.some((entry) => isConditionNamed(entry, MANTLE_STRIDE))) {
    return { error: `${FEATURE}'s move belongs to a creature a Glamour bard's mantle has just given temporary hit points, on that bard's turn; ${sheet.name} is not one. Nothing was spent.`, refused: "rules" };
  }
  const moved = reactionMove(ctx, FEATURE, "opened", "full");
  if ("error" in moved) {
    return moved;
  }
  spendReaction(ctx);
  const now = getSheetById(sheet.id) ?? sheet;
  const cleared = removeConditions(now.conditions, now.conditionMeta, now.conditions.filter((entry) => isConditionNamed(entry, MANTLE_STRIDE)));
  patchSheetAudited(ctx.campaign.id, now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, { kind: "clear_condition", reason: `${FEATURE}: the move is taken`, delta: { condition: MANTLE_STRIDE } });
  return { ok: true, reaction: FEATURE, ...moved, spent: SPENT(sheet.name) };
}
