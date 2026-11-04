// Whether a character may take a reaction, asked the same way by every tool
// that spends one: use_reaction (src/lib/dm/reaction-tools.ts), a feature
// whose cost is the reaction (prepareReaction, src/lib/dm/turn-budget.ts),
// and a spell cast with the reaction (src/lib/dm/cast-guard.ts).
//
// The dead, the dying, the incapacitated and the surprised have no reaction;
// whose turn it is does not matter to one. When the hit that just landed
// dropped the character, the reaction's timing decides (issue 233,
// src/lib/dm/reaction-kinds.ts): one that answers that hit is asked of them
// as they stood before it (the record is src/lib/dm/last-hit.ts), one that
// is triggered by dropping to 0 is allowed exactly then, and one that only
// follows the damage is asked of them as they are, unconscious.

import type { Encounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { canAct } from "@/lib/dm/can-act";
import { freshLastHit } from "@/lib/dm/last-hit";
import { reactionTimingOf, type ReactionTiming } from "@/lib/dm/reaction-kinds";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";

export type { ReactionTiming } from "@/lib/dm/reaction-kinds";

// The character as the reaction is asked of them, and whether that is the
// standing before a hit that dropped them.
export function reactingSheet(
  campaignId: string,
  sheet: CharacterSheet,
  timing: ReactionTiming,
): { sheet: CharacterSheet; beforeDrop: boolean } {
  if (timing === "after") {
    return { sheet, beforeDrop: false };
  }
  // Of several open hits, the one that dropped them (a later one found them
  // already down), unless the call is aimed at another (last-hit.ts
  // withHitAim): a reaction to a blow that landed on them down is asked of
  // them down.
  const answering = sheet.currentHp <= 0 ? freshLastHit(campaignId, sheet.id, (hit) => hit.before.currentHp > 0) : null;
  const before = answering ? answering.before : null;
  return before
    ? {
        sheet: { ...sheet, currentHp: before.currentHp, conditions: before.conditions, deathSaves: before.deathSaves },
        beforeDrop: true,
      }
    : { sheet, beforeDrop: false };
}

// The refusal for a reaction the character cannot take, or null. The timing
// is the reaction's own (reaction-kinds.ts); a caller that does not name one
// gets the feature's by its label. `forAnother`: it answers a hit on someone
// else (Runic Shield, Shadow Martyr, Cutting Words), which a reactor at 0 is
// refused for being down, not for following any damage of their own.
export function reactionRefusal(
  campaignId: string,
  sheet: CharacterSheet,
  encounter: Encounter | null,
  label: string,
  timing: ReactionTiming = reactionTimingOf(label),
  forAnother = false,
): ToolError | null {
  const standing = reactingSheet(campaignId, sheet, timing);
  if (timing === "at_zero" && !standing.beforeDrop) {
    return { error: sheet.currentHp > 0
      ? `${label} answers the hit that drops ${sheet.name} to 0 hit points, and they are not down. Nothing was spent.`
      : `${label} is taken as the hit that drops ${sheet.name} to 0 hit points lands, and the server has no such hit on them this turn. Nothing was spent.`, refused: "rules" };
  }
  const allowed = canAct({ sheet: standing.sheet, encounter, kind: "reaction" });
  if (!allowed.ok) {
    return sheet.currentHp <= 0 && timing === "after" && !forAnother && !sheet.deathSaves?.dead
      ? { ...toolError(allowed), error: `${allowed.error} ${label} follows the damage rather than changing it, so a character that damage dropped is already unconscious and cannot take it.` }
      : toolError(allowed);
  }
  // Slow and its kin switch reactions off entirely.
  const blocked = conditionBlocksReactions(standing.sheet.conditions);
  return blocked ? { error: `${sheet.name} is ${blocked} and cannot take reactions; ${label} does not happen.`, refused: "rules" } : null;
}
