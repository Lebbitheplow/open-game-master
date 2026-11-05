// The release of a readied action (SRD 5.1, Ready): off the character's
// turn, when the DM judges the trigger has come, the action they readied
// resolves through its own tool with their reaction, and nothing of the
// acting combatant's turn. Each door that resolves an action asks here
// first (take_action, use_item, stabilize, the class features, a
// character's walk); on the character's own turn, or with nothing readied,
// the answer is null and the door's ordinary checks apply. A readied spell
// has its own release (readied-spell.ts: the slot was spent on the turn).
import type { Encounter } from "@/lib/db/encounters";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { actingCombatantId, canAct } from "@/lib/dm/can-act";
import { releasesReadiedOffTurn } from "@/lib/dm/held-turn";
import { removeConditions } from "@/lib/dm/condition-logic";
import { READIED, READIED_WORDS, RELEASE_TOOLS, readiedHeld, type Readiable, type ReadiedHeld } from "@/lib/dm/readied-kinds";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";

export { READIED, readiedHeld };

export type ReadiedRelease = { held: ReadiedHeld; release: () => Record<string, unknown> };

// How `door` releases what the character holds, off their turn: the
// release to run once the action's own checks have passed, a refusal
// (another action was readied, the reaction is gone), or null when this is
// not a release at all.
export function readiedReleaseFor(
  sheet: CharacterSheet,
  encounter: Encounter | null,
  door: Readiable,
): ReadiedRelease | ToolError | null {
  const held = readiedHeld(sheet);
  if (!held || !encounter || (encounter.kind ?? "fight") !== "fight" || !encounter.orderReady) {
    return null;
  }
  if (actingCombatantId(encounter) === sheet.id && !releasesReadiedOffTurn(encounter, sheet)) {
    return null;
  }
  if (held.holds !== door) {
    return {
      error: `It is not ${sheet.name}'s turn, and what they readied is ${READIED_WORDS[held.holds]} (${held.trigger}), not ${READIED_WORDS[door]}: a readied action is released only as the action that was readied (SRD 5.1, Ready). Nothing was spent. ${RELEASE_TOOLS[held.holds]} releases it; unreleased, it is lost when their turn starts.`,
      refused: "rules",
    };
  }
  const able = canAct({ sheet, encounter, kind: "reaction" });
  if (!able.ok) {
    return toolError(able);
  }
  const blocked = conditionBlocksReactions(sheet.conditions);
  if (blocked) {
    return { error: `${sheet.name} is ${blocked} and cannot take reactions, so the readied ${READIED_WORDS[held.holds]} cannot be released. Nothing was spent.`, refused: "rules" };
  }
  if (encounter.reactionsUsed.includes(sheet.id)) {
    return {
      error: `${sheet.name} has already used their reaction, so the readied ${READIED_WORDS[held.holds]} cannot be released; it is lost when their turn starts. Nothing was spent.`,
      refused: "rules",
    };
  }
  return {
    held,
    release: () => {
      const live = getActiveEncounter(encounter.campaignId);
      if (live && !live.reactionsUsed.includes(sheet.id)) {
        markReactionUsed(live, sheet.id);
      }
      dropReadied(encounter.campaignId, sheet.id);
      return { cost: `their reaction: the readied ${READIED_WORDS[held.holds]} (${held.trigger})`, released: true };
    },
  };
}

// Clears what a character held readied: released, or lost.
export function dropReadied(campaignId: string, sheetId: string): void {
  const sheet = getSheetById(sheetId);
  if (!sheet || !readiedHeld(sheet)) {
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [READIED]);
  const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}

// The first living character of the campaign holding a readied action, for
// the decision point inside an enemy's turn (enemy-approach.ts): while one
// waits, an enemy out of reach does not walk in and swing in one call.
export function readiedHolder(campaignId: string): { holder: string; trigger: string; holds: Readiable } | null {
  for (const sheet of listSheets(campaignId)) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    if (fresh.currentHp <= 0) {
      continue;
    }
    const held = readiedHeld(fresh);
    if (held) {
      return { holder: fresh.name, trigger: held.trigger, holds: held.holds };
    }
  }
  return null;
}
