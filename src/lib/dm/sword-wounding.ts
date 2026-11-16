// Sword of Wounding (SRD 5.1): "Once per turn, when you hit a creature with
// an attack using this magic weapon, you can wound the target. At the start
// of each of the wounded creature's turns, it takes 1d4 necrotic damage for
// each time you've wounded it, and it can then make a DC 15 Constitution
// saving throw, ending the effect of all such wounds on itself on a
// success." The blade had no rider at all: its wielder's hits left nothing.
//
// The wounds are one condition on the creature, counted in its meta
// (`stacks`), with the turn it was last wounded on (`woundedOn`) for the
// once per turn. Every hit takes the wound, as a player would choose it; the
// turn's swing (attack-blow.ts) and the opportunity attack
// (opportunity-strike.ts) both lay it, and the creature's turn start
// (turn-start-effects.ts) bleeds and saves.
//
// Not modeled: the Wisdom (Medicine) action that ends the wounds (the GM
// clears the condition with clear_condition), and "Hit points lost to this
// weapon's damage can be regained only through a short or long rest"
// against a creature's own regeneration or healing magic.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { publicDie } from "@/lib/dm/between-io";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { closeStandInTurn, openStandInTurn, type DmTurn } from "@/lib/db/dm-turns";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const SWORD_WOUND = "sword wound";
const WOUND_DC = 15;

// A short turn for the bleed's and the save's rows, as the turn-start hooks
// keep them (opportunity-strike.ts withOpportunityTurn, not imported: that
// module lays the wound).
function inStandInTurn<T>(campaignId: string, run: (turn: DmTurn) => T): T {
  const turn = openStandInTurn(campaignId);
  try {
    return run(turn);
  } finally {
    closeStandInTurn(turn);
  }
}

function woundOf(enemy: EncounterEnemy): { name: string; stacks: number; woundedOn?: string } | null {
  const name = enemy.conditions.find((entry) => isConditionNamed(entry, SWORD_WOUND));
  if (!name) {
    return null;
  }
  const meta = (enemy.conditionMeta as ConditionMetaMap)[name] ?? {};
  return { name, stacks: Math.max(1, meta.stacks ?? 1), ...(meta.woundedOn ? { woundedOn: meta.woundedOn } : {}) };
}

// The wound a hit lays, once per turn: the sentence for the table, or null
// when this turn already wounded it or it is gone.
export function woundOnHit(campaign: Campaign, enemyId: string, wielderId: string): string | null {
  const enemy = getEnemy(enemyId);
  const encounter = getActiveEncounter(campaign.id);
  if (!enemy || enemy.status !== "alive" || !encounter) {
    return null;
  }
  const turnKey = `${encounter.round}:${encounter.turnIndex}`;
  const held = woundOf(enemy);
  if (held?.woundedOn === turnKey) {
    return null;
  }
  const stacks = (held?.stacks ?? 0) + 1;
  const meta = enemy.conditionMeta as ConditionMetaMap;
  patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => entry !== held?.name), SWORD_WOUND], {
    ...meta,
    [SWORD_WOUND]: { source: wielderId, stacks, woundedOn: turnKey },
  } as typeof enemy.conditionMeta);
  publishEncounter(campaign.id);
  return `Sword of Wounding: ${enemy.displayName} is wounded (${stacks} ${stacks === 1 ? "wound" : "wounds"}): ${stacks}d4 necrotic at the start of each of its turns, until a DC ${WOUND_DC} Constitution save ends them all.`;
}

// The bleed and the save at the start of a wounded creature's turn.
export function swordWoundTurnStart(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy | undefined): string[] {
  const held = enemy && enemy.status === "alive" ? woundOf(enemy) : null;
  if (!enemy || !held) {
    return [];
  }
  const bleed = publicDie(campaign, null, `${held.stacks}d4`, `${enemy.displayName}: Sword of Wounding`);
  const sheets = listSheets(campaign.id);
  const applied = inStandInTurn(campaign.id, (turn) =>
    applyEnemyDamage(campaign, turn, encounter, enemy, bleed, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), "necrotic", { holdVictory: true }),
  );
  const taken = typeof applied?.damageApplied === "number" ? applied.damageApplied : bleed;
  const lines = [`${enemy.displayName} starts its turn bleeding and takes ${taken} necrotic damage (Sword of Wounding).`];
  const now = getEnemy(enemy.id);
  if (!now || now.status !== "alive") {
    const left = listEnemies(encounter.id).filter((entry) => entry.status === "alive").length;
    return left ? lines : [...lines, "No enemy is left standing; end the encounter."];
  }
  const save = inStandInTurn(campaign.id, (turn) => rollEnemySave(campaign.id, now, "con", WOUND_DC, { magical: true, record: { turn, detail: `${now.displayName}: CON save vs Sword of Wounding (DC ${WOUND_DC})` } }));
  if (save.success) {
    const cleared = removeConditions(now.conditions, now.conditionMeta as ConditionMetaMap, [held.name]);
    patchEnemyConditions(now.id, cleared.conditions, cleared.meta as typeof now.conditionMeta);
    publishEncounter(campaign.id);
    lines.push(`${now.displayName} makes the DC ${WOUND_DC} Constitution save (${save.total}): its wounds close.`);
  } else {
    lines.push(`${now.displayName} fails the DC ${WOUND_DC} Constitution save (${save.total}): the wounds stay open.`);
  }
  return lines;
}
