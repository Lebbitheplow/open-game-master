// Copying a spell scroll into a wizard's spellbook (learn_spell with from
// "scroll", src/lib/dm/mutations.ts): the server rolls the copier's
// Intelligence (Arcana) check against 10 + the spell's level
// (learn-rules.ts scrollCopyDc), so the GM never names the number. A table
// was told DC 8 for See Invisibility, whose copy is DC 12.
//
// The roll goes through the character's own door (character-roll.ts), so a
// seat on physical dice rolls it and a held Bardic Inspiration die can
// settle it, as with stabilize's Medicine check (stabilize.ts). It is rolled
// before anything is written: a held call that parks on it runs again when
// the die lands.
import { recordRoll } from "@/lib/dm/roll-record";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollCharacterD20 } from "@/lib/dm/character-roll";
import { heldDieWaits, rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { scrollCopyDc } from "@/lib/dm/learn-rules";
import { resolveRollExpression } from "@/lib/dm/rolls";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type ScrollCopyCheck = { passed: boolean; rolled: number; dc: number };

export function rollScrollCopy(
  campaign: Campaign,
  copier: CharacterSheet,
  spell: string,
  level: number,
  turn?: DmTurn | null,
): ScrollCopyCheck | ToolError {
  const dc = scrollCopyDc(level);
  const detail = `arcana, to copy ${spell} from a scroll into the spellbook`;
  const resolved = resolveRollExpression(
    { kind: "skill_check", skill: "arcana", dc, characterId: copier.id },
    copier,
    { ...rollExtrasFor(campaign, copier, "skill_check"), keepHeldDie: heldDieWaits(copier, dc) },
  );
  if ("error" in resolved) {
    return toolError(resolved);
  }
  if ("autoFail" in resolved) {
    return { error: `${copier.name} cannot make the Arcana check a copy needs: ${resolved.notes.join("; ")}. Nothing was spent.`, refused: "rules" };
  }
  spendRollCarriers(campaign.id, copier.id, resolved.spendInspiration);
  const outcome = rollCharacterD20(campaign, copier, { kind: "skill_check", expression: resolved.expression, detail, parts: resolved.parts, dc, settleHeldDie: heldDieWaits(copier, dc) });
  recordRoll({ campaignId: campaign.id, characterId: copier.id, requestedBy: "dm", kind: "skill_check", detail, parts: resolved.parts, dc, result: outcome, turn });
  return { passed: outcome.total >= dc, rolled: outcome.total, dc };
}
