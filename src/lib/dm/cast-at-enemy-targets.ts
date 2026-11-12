// cast_at_enemy as the model calls it: every creature the casting reaches,
// one entry each in `targets`, resolved in order in one call (an agent
// program's calls arrive one at a time, src/lib/dm/action-parts-logic.ts).
// Each entry is the single-target call it always was: the first spends the
// slot, and the next ride the casting through its open share
// (src/lib/dm/cast-guard.ts open casts), as Magic Missile's darts, Bane's
// creatures and an area resolved creature by creature always did. Two
// creatures for a casting that reaches one (at its slot) are Improved Reaper's
// (src/lib/dm/authored-reaper.ts), which refuses a caster without it.

import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { spellMechanicsFor } from "@/lib/content";
import { MAX_PARTS, partsResult, spreadDarts } from "@/lib/dm/action-parts-logic";
import { handleReaperCast } from "@/lib/dm/authored-reaper";
import { handleCastAtEnemy } from "@/lib/dm/cast-at-enemy";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { badArguments, invalidArguments, type ToolResult } from "@/lib/dm/tool-errors";
import { castShares } from "@/lib/srd/spell-mechanics";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const NEEDS = "Invalid arguments: cast_at_enemy needs characterId, spell, and targets, one entry per creature with its targetEnemyId.";

const targetsSchema = z.object({
  characterId: z.string(),
  spell: z.string().max(80),
  level: z.coerce.number().int().min(1).max(9).optional(),
  targets: z
    .array(z.object({ targetEnemyId: z.string(), darts: z.coerce.number().int().min(1).max(20).optional() }))
    .min(1)
    .max(MAX_PARTS),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function handleCastAtEnemyTargets(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch (error) {
    return badArguments(NEEDS, error, rawArguments);
  }
  // The flat shape, one creature (and Improved Reaper's second): read as it
  // always was.
  if (!isRecord(raw) || !("targets" in raw)) {
    return handleReaperCast(campaign, turn, rawArguments, sheets, sheetsById) ?? handleCastAtEnemy(campaign, turn, rawArguments, sheets, sheetsById);
  }
  const parsed = targetsSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidArguments(NEEDS, parsed.error, raw);
  }
  const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "targets"));
  const { characterId, targets, spell, level } = parsed.data;
  const authors = spellAuthorsFor(campaign);
  const resolved = spellMechanicsFor({ spell, userIds: authors });
  const caster = resolveSheetRef(characterId, sheets, sheetsById);
  if (!caster) {
    return unknownSheetRef("characterId", characterId, sheets);
  }
  // How many creatures this casting reaches at the slot it is cast from: Hold
  // Person from a 3rd-level slot reaches two of its own, and only a casting
  // that reaches one is a twin feature's to double.
  const reach = castShares(resolved?.mech ?? null, {
    spellLevel: resolved?.spellLevel ?? 1,
    slotLevel: level ?? null,
    casterLevel: caster.level,
  });
  if (reach === 1 && targets.length === 2) {
    const [first, second] = targets;
    const reaped = handleReaperCast(campaign, turn, JSON.stringify({ ...rest, targetEnemyId: first.targetEnemyId, secondTargetEnemyId: second.targetEnemyId }), sheets, sheetsById);
    if (reaped) {
      return reaped;
    }
  }
  const aimed = resolved?.mech?.darts ? spreadDarts(targets, reach) : targets;
  const outcomes = aimed.map(
    ({ targetEnemyId, darts }) =>
      handleCastAtEnemy(campaign, turn, JSON.stringify({ ...rest, targetEnemyId, ...(darts ? { darts } : {}) }), sheets, sheetsById) as Record<string, unknown>,
  );
  return partsResult(outcomes, "targets");
}
