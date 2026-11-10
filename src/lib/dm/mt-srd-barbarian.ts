// The barbarian's SRD 5.1 clauses that had no door of their own.
//
//   Rage: "You can also end your rage on your turn as a bonus action."
//     endRage, reached through use_resource rage with variant 'end'
//     (srd-feature-spends.ts).
//   Feral Instinct: "if you are surprised at the beginning of combat and
//     aren't incapacitated, you can act normally on your first turn, but only
//     if you enter your rage before doing anything else on that turn."
//     The fight's opening (encounter-tools.ts) takes such a barbarian off the
//     surprised list and lays RAGE_FIRST on them instead: canAct refuses
//     everything while they hold it, the rage's own charge reads the sheet
//     without it (resource-turn.ts), and entering the rage lifts it
//     (resource-tools.ts). It ends with their first turn either way.
//   Intimidating Presence: "This effect ends if the creature ends its turn
//     out of line of sight or more than 60 feet away from you."
//     presenceHold is the meta the fear is laid with, and endPresenceOutOfReach
//     runs as turns end (turn-end.ts endTurns).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { seesOnBoard, withinFeet } from "@/lib/dm/authored-saves";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import { instancesOf, isIncapacitated, removeConditionInstances, removeConditions, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { RAGING } from "@/lib/srd/class-resources";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsFeature } from "@/lib/srd/trait-rules";

const holds = (conditions: readonly string[], name: string) => conditions.some((entry) => isConditionNamed(entry, name));

// ---- ending a rage ----

const END_WORDS = new Set(["end", "end rage", "end the rage", "stop", "calm"]);

export function asksToEndRage(variant: string | undefined): boolean {
  return Boolean(variant) && END_WORDS.has(textKey(variant!));
}

export function endRage(campaign: Campaign, stale: CharacterSheet): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  const ragingAs = sheet.conditions.find((entry) => isConditionNamed(entry, RAGING));
  if (!ragingAs) {
    return { error: `${sheet.name} is not raging, so there is no rage to end. Nothing was spent.`, refused: "rules" };
  }
  const price = priceTheAction(sheet, getActiveEncounter(campaign.id), "ending the rage", "bonus");
  if ("error" in price) {
    return toolError(price);
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, [ragingAs]);
  patchSheetAudited(campaign.id, sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, {
    kind: "condition_clock",
    reason: "ended their rage",
    delta: { ended: [ragingAs], added: [] },
  });
  price.commit();
  publishSheet(campaign, sheet.id);
  return { ok: true, resource: "Rage", cost: "their bonus action", applied: `${sheet.name} lets the rage go. No use of Rage is spent or given back.` };
}

// ---- Feral Instinct ----

export const RAGE_FIRST = "feral instinct (rage first)";

export const holdsRageFirst = (sheet: Pick<CharacterSheet, "conditions">) => holds(sheet.conditions, RAGE_FIRST);

// The sheet as the rage's own charge reads it: the hold is on everything but
// the rage.
export function withoutRageFirst<T extends Pick<CharacterSheet, "conditions">>(sheet: T): T {
  return holdsRageFirst(sheet) ? { ...sheet, conditions: sheet.conditions.filter((entry) => !isConditionNamed(entry, RAGE_FIRST)) } : sheet;
}

function canStillRage(sheet: CharacterSheet): boolean {
  const pool = sheet.resources?.rage;
  return !holds(sheet.conditions, RAGING) && Boolean(pool) && pool!.used < pool!.max;
}

// The surprised list as the fight opens, without the barbarians whose Feral
// Instinct gives them their first turn: each is given RAGE_FIRST until that
// turn ends. Returns the list and a table line for each.
export function feralInstinctOpening(surprisedIds: string[], sheets: CharacterSheet[]): { surprisedIds: string[]; lines: string[] } {
  const lines: string[] = [];
  const keep = new Set(surprisedIds);
  for (const stale of sheets) {
    if (!keep.has(stale.id)) {
      continue;
    }
    const sheet = getSheetById(stale.id) ?? stale;
    if (!holdsFeature(sheet, "feral instinct") || sheet.currentHp <= 0 || isIncapacitated(sheet.conditions) || !canStillRage(sheet)) {
      continue;
    }
    keep.delete(sheet.id);
    patchSheet(sheet.id, {
      conditions: [...sheet.conditions.filter((entry) => !isConditionNamed(entry, RAGE_FIRST)), RAGE_FIRST],
      conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), [RAGE_FIRST]: untilTurnEnd(sheet.id) },
    });
    lines.push(`${sheet.name} is surprised, and Feral Instinct gives them their first turn if they enter their rage before anything else (use_resource rage).`);
  }
  return { surprisedIds: surprisedIds.filter((id) => keep.has(id)), lines };
}

// ---- Intimidating Presence ----

const PRESENCE_FEET = 60;

// The meta the fear is laid and extended with.
export function presenceHold(barbarianId: string): ConditionMeta {
  return untilTurnEnd(barbarianId, { source: barbarianId, turnEndBeyondFeet: PRESENCE_FEET });
}

// These creatures' turns are ending: a fear that lasts only within sight and
// reach of its source ends for one that stands outside either.
export function endPresenceOutOfReach(encounterId: string, endingIds: string[]): { lines: string[]; enemiesChanged: boolean } {
  const lines: string[] = [];
  let enemiesChanged = false;
  for (const id of endingIds) {
    const enemy = getEnemy(id);
    if (!enemy) {
      continue;
    }
    const meta = enemy.conditionMeta as ConditionMetaMap;
    for (const name of enemy.conditions) {
      const away = (entry: ConditionMeta) =>
        Boolean(entry.turnEndBeyondFeet && entry.source) &&
        (!withinFeet(encounterId, entry.source!, enemy.id, entry.turnEndBeyondFeet!) || !seesOnBoard(encounterId, enemy.id, entry.source!));
      if (!instancesOf(meta?.[name]).some(away)) {
        continue;
      }
      const removed = removeConditionInstances(enemy.conditions, meta, name, away);
      patchEnemyConditions(enemy.id, removed.conditions, removed.meta as typeof enemy.conditionMeta);
      enemiesChanged = true;
      lines.push(`${enemy.displayName} ends its turn out of sight or more than ${PRESENCE_FEET} feet from what frightened it, and is no longer ${name}.`);
      break;
    }
  }
  return { lines, enemiesChanged };
}
