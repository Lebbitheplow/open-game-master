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
// "Hit points lost to this weapon's damage can be regained only through a
// short or long rest": the hit points every hit and every bleed takes are
// held on the creature (sword-wounding-logic.ts), and no healing of a
// creature reaches them. "You or any creature within 5 feet of the wounded
// target can use an action to make a DC 15 Wisdom (Medicine) check, ending
// the effect of such wounds on it on a success": a character's
// take_action improvise with skill medicine at the wounded creature
// (improvise.ts, tendSwordWounds below). A creature's own tending is the
// GM's to narrate and clear (clear_condition on the creature).
//
// Only a hero wields the blade: a creature's attacks carry no magic item's
// rider (a character fighting for the foes is read from a stat block,
// sheet-foe-stats.ts), so no hero is ever wounded by one.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { publicDie } from "@/lib/dm/between-io";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { closeStandInTurn, openStandInTurn, type DmTurn } from "@/lib/db/dm-turns";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { WOUND_LOSS } from "@/lib/dm/sword-wounding-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { feetBetween } from "@/lib/dm/combat-features";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";

export const SWORD_WOUND = "sword wound";
const WOUND_DC = 15;
const TEND_DC = 15;
const TEND_REACH_FT = 5;

// The hit points the blade took, added to the creature's mark: no healing
// but a rest gives them back (monster-abilities.ts enemyHpCap).
function holdLostHp(enemyId: string, hp: number) {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive" || !(hp > 0)) {
    return;
  }
  const meta = { ...(enemy.conditionMeta as ConditionMetaMap) };
  const held = enemy.conditions.find((entry) => isConditionNamed(entry, WOUND_LOSS));
  const was = held ? (meta[held]?.heldHp ?? 0) : 0;
  if (held) {
    delete meta[held];
  }
  patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => entry !== held), WOUND_LOSS], {
    ...meta,
    [WOUND_LOSS]: { heldHp: Math.min(enemy.maxHp, was + hp) },
  } as typeof enemy.conditionMeta);
}

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
// when this turn already wounded it or it is gone. Every hit's `lost` hit
// points are held, the hits after the turn's wound too.
export function woundOnHit(campaign: Campaign, enemyId: string, wielderId: string, lost: number): string | null {
  holdLostHp(enemyId, lost);
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
  return `Sword of Wounding: ${enemy.displayName} is wounded (${stacks} ${stacks === 1 ? "wound" : "wounds"}): ${stacks}d4 necrotic at the start of each of its turns, until a DC ${WOUND_DC} Constitution save ends them all, or a creature within 5 feet tends them with an action (a character: take_action improvise, skill medicine, DC ${TEND_DC}). The hit points the blade takes come back only with a rest.`;
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
  holdLostHp(enemy.id, taken);
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

// A character's action at a wounded creature within 5 feet: the DC 15
// Wisdom (Medicine) check closes every sword wound on it. Null when the
// creature bears none, so the improvised action goes on as any other.
export function tendSwordWounds(campaign: Campaign, encounter: Encounter, sheet: CharacterSheet, enemyId: string, spend: () => void): { result: ToolResult; rollId: string | null } | null {
  const enemy = getEnemy(enemyId);
  const held = enemy && enemy.status === "alive" ? woundOf(enemy) : null;
  if (!enemy || !held) {
    return null;
  }
  const apart = feetBetween(encounter.id, sheet.id, enemy.id);
  if (apart !== null && apart > TEND_REACH_FT) {
    return {
      result: {
        error: `${enemy.displayName} is ${apart} ft from ${sheet.name}: a creature's sword wounds are tended from within 5 feet. Nothing was spent.`,
        refused: "rules",
      },
      rollId: null,
    };
  }
  spend();
  const check = rollCharacterCheck(campaign, sheet, { skill: "medicine", dc: TEND_DC }, `${sheet.name}: Medicine to close ${enemy.displayName}'s wounds`);
  const closed = check.total >= TEND_DC;
  if (closed) {
    const now = getEnemy(enemy.id) ?? enemy;
    const cleared = removeConditions(now.conditions, now.conditionMeta as ConditionMetaMap, [held.name]);
    patchEnemyConditions(now.id, cleared.conditions, cleared.meta as typeof now.conditionMeta);
    publishEncounter(campaign.id);
  }
  return {
    result: {
      ok: true,
      action: "Tend the wounds",
      check: `Medicine ${check.total} vs DC ${TEND_DC}`,
      success: closed,
      note: closed
        ? `${sheet.name} closes ${enemy.displayName}'s sword wounds: they bleed no more. The hit points the blade took still come back only with a rest.`
        : `${sheet.name} cannot close ${enemy.displayName}'s sword wounds; they keep bleeding.`,
    },
    rollId: check.rollId,
  };
}
