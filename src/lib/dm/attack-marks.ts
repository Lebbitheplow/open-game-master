// Effects on a character that one attack reads and changes: Hunter's Mark
// and Hex, which ride hits on one marked creature only, and Invisibility,
// which ends when its holder attacks or casts.
//
// The mark. SRD 5.1: Hunter's Mark and Hex mark "a creature you can see",
// and when it drops to 0 hit points the caster can move the mark with a
// bonus action on a later turn. The marked creature's enemyId is kept in the
// condition's meta (`quarry`). A mark written with the creature's name in
// the condition ("hunter's mark (Goblin 2)") reads that name. A mark that
// names nobody is placed on the first creature its holder attacks, which is
// the creature a mark cast in the moment is almost always for.
//
// Invisibility. SRD 5.1: the spell (and a potion of invisibility, and a ring)
// ends when the invisible creature attacks or casts a spell; Greater
// Invisibility does not. A character's "invisible" ends that way unless its
// meta names Greater Invisibility.

import { endCamouflage } from "@/lib/dm/mt-srd-camouflage";
import { getActiveEncounter, getEnemy, listEnemies, type EncounterEnemy } from "@/lib/db/encounters";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { storeBudget } from "@/lib/dm/turn-budget";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isKnockedOut } from "@/lib/dm/knockout";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import { isNamed } from "@/lib/srd/feature-names";

export type MarkPlan = {
  // Mark conditions whose die rides this attack.
  applies: Set<string>;
  // Marks this attack places or moves: written once the attack is paid for.
  assign: Array<{ condition: string; enemyId: string }>;
  // Moving a mark off a fallen creature is a bonus action.
  movesMark: boolean;
  notes: string[];
};

const out = (enemy: EncounterEnemy | null) =>
  !enemy || enemy.status !== "alive" || isKnockedOut(enemy);

// The key a turn keeps once the creature its own character marked falls on
// it (noteMarkFell). SRD 5.1, Hunter's Mark: "If the target drops to 0 hit
// points before this spell ends, you can use a bonus action on a subsequent
// turn of yours to mark a new creature"; Hex the same. A ranger with Extra
// Attack who dropped the marked goblin with the first swing moved the mark
// with the second swing of that turn, and its 1d6 rode it.
export const MARK_FELL = "mark-fell:";

// The creature a mark is on: the quarry its meta keeps, or the creature its
// "(note)" names by whole display name.
function quarryOf(condition: string, meta: ConditionMetaMap, enemies: EncounterEnemy[]): string | null {
  const kept = meta[condition]?.quarry ?? null;
  if (kept) {
    return kept;
  }
  const named = textKey(/\(([^)]+)\)/.exec(condition)?.[1] ?? "");
  const found = named ? enemies.find((entry) => textKey(entry.displayName) === named) : undefined;
  return found?.id ?? null;
}

export function planMarks(input: {
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  encounterEnemies: EncounterEnemy[];
  budget: TurnBudget | null;
}): MarkPlan {
  const { sheet, enemy, budget } = input;
  const plan: MarkPlan = { applies: new Set(), assign: [], movesMark: false, notes: [] };
  const meta = sheet.conditionMeta as ConditionMetaMap;
  for (const condition of sheet.conditions) {
    if (!conditionEffectsFor(condition)?.marksTarget) {
      continue;
    }
    const quarry = quarryOf(condition, meta, input.encounterEnemies);
    if (quarry === enemy.id) {
      plan.applies.add(condition);
      continue;
    }
    if (!quarry) {
      plan.applies.add(condition);
      plan.assign.push({ condition, enemyId: enemy.id });
      plan.notes.push(`${condition}: ${enemy.displayName} is the marked creature from now on`);
      continue;
    }
    // The marked creature fell on this very turn: the mark waits for a later
    // one (MARK_FELL).
    if (budget?.oncePerTurn.includes(`${MARK_FELL}${quarry}`) && out(getEnemy(quarry))) {
      plan.notes.push(`${condition}: the marked creature fell this turn, so the mark can move to another only on a later turn of ${sheet.name}'s`);
      continue;
    }
    // The marked creature has fallen: the mark moves, for a bonus action on
    // the holder's own turn, to the creature attacked now.
    if (out(getEnemy(quarry)) && budget && !budget.bonusUsed && !plan.movesMark) {
      plan.applies.add(condition);
      plan.assign.push({ condition, enemyId: enemy.id });
      plan.movesMark = true;
      plan.notes.push(`${condition}: the marked creature is down, so the mark moves to ${enemy.displayName} (a bonus action)`);
    }
  }
  return plan;
}

// The critical range a mark this attack rides gives against its creature
// (Hexblade's Curse: 19), or 20.
export function markCritRange(applies: Set<string>): number {
  return Math.min(20, ...[...applies].map((condition) => conditionEffectsFor(condition)?.critRangeVsMarked ?? 20));
}

// A creature fell. When the turn running is that of a character whose mark
// was on it, the turn keeps that (MARK_FELL), so the mark moves only on a
// later turn of theirs. Called where every blow drops a creature
// (enemy-damage.ts applyEnemyDamage), so a spell's kill counts as a swing's.
export function noteMarkFell(campaignId: string, enemyId: string): void {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  if (!encounter || !budget || budget.round !== encounter.round || !ownTurnOf(encounter, budget.ownerId)) {
    return;
  }
  const key = `${MARK_FELL}${enemyId}`;
  const holder = getSheetById(budget.ownerId);
  if (!holder || budget.oncePerTurn.includes(key)) {
    return;
  }
  const meta = holder.conditionMeta as ConditionMetaMap;
  const enemies = listEnemies(encounter.id);
  if (holder.conditions.some((condition) => conditionEffectsFor(condition)?.marksTarget && quarryOf(condition, meta, enemies) === enemyId)) {
    storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, key] });
  }
}

// Writes the marks an attack placed or moved.
export function writeMarks(campaignId: string, sheetId: string, assign: MarkPlan["assign"]) {
  if (!assign.length) {
    return;
  }
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return;
  }
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap) };
  for (const { condition, enemyId } of assign) {
    if (fresh.conditions.includes(condition)) {
      meta[condition] = { ...meta[condition], quarry: enemyId };
    }
  }
  const updated = patchSheet(sheetId, { conditionMeta: meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}

// The invisibility an attack or a cast ends, each source on its own: every
// instance of "invisible" but Greater Invisibility's (condition-logic.ts
// instances), so a creature holding both stays invisible by the greater one.
export function withoutActionInvisibility(
  conditions: string[],
  meta: ConditionMetaMap,
): { conditions: string[]; meta: ConditionMetaMap; removed: number } {
  const held = conditions.find((entry) => entry.trim().toLowerCase() === "invisible");
  if (!held) {
    return { conditions, meta, removed: 0 };
  }
  return removeConditionInstances(conditions, meta, held, (entry) => ![entry.spell, entry.source].some((name) => isNamed(name ?? "", "greater invisibility")));
}

// Ends a character's invisibility because they cast a spell or attacked (the
// cast guard and the attack spends call this once the act has gone through).
// Returns a line for the result.
export function endInvisibilityOnCast(campaignId: string, sheetId: string): string | null {
  // A ranger's camouflage is lost at the same doors (mt-srd-camouflage.ts).
  endCamouflage(campaignId, sheetId);
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return null;
  }
  const cleared = withoutActionInvisibility(sheet.conditions, sheet.conditionMeta as ConditionMetaMap);
  if (!cleared.removed) {
    return null;
  }
  const updated = patchSheet(sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return `${sheet.name} casts a spell and is no longer invisible.`;
}
