// Oathbow (SRD 5.1): "When you use this weapon to make a ranged attack, you
// can, as a command phrase, say, 'Swift death to you who have wronged me.'
// The target of your attack becomes your sworn enemy until it dies or until
// dawn seven days later. You can have only one such sworn enemy at a time.
// When your sworn enemy dies, you can choose a new one after the next dawn.
// When you make a ranged attack roll with this weapon against your sworn
// enemy, you have advantage on the roll. In addition, your target gains no
// benefit from cover, other than total cover, and you suffer no disadvantage
// due to long range. If the attack hits, your sworn enemy takes an extra 3d6
// piercing damage. While your sworn enemy lives, you have disadvantage on
// attack rolls with all other weapons." The bow carried no rider at all.
//
// The sworn enemy is a condition on the archer naming the creature
// (`source`) and the clock instant it was sworn (`oath.swornAt`). The phrase
// is said on the first Oathbow shot with no sworn enemy, as a player would
// say it, and written only once the shot is made (pc-attack.ts). Read by
// the turn's swing (pc-attack-plan.ts) and, for the disadvantage with other
// weapons, the opportunity attack (opportunity-strike.ts).
//
// The oath is the creature's, not the fight's: it follows the creature into
// every later fight it comes back to (foe-history.ts latestAppearance), and
// holds across rests until it dies or the first dawn once seven days have
// passed. It ended with the fight it was sworn in, so a foe that fled was
// forgotten and the next creature shot was sworn. Once the creature dies the
// mark stays, with the instant it died (`oath.diedAt`), and no new oath is
// sworn until a dawn has passed (the next creature was sworn at once). The
// clock's own dawn hook (db/clock.ts) takes an ended oath off the sheet.

import { getEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { latestAppearance } from "@/lib/db/foe-history";
import { getClock } from "@/lib/db/clock";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { Campaign } from "@/lib/db/campaigns";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { MINUTES_PER_DAY } from "@/lib/dm/calendar";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { dawnsBetween } from "@/lib/dm/item-charges";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SWORN_ENEMY = "sworn enemy";
const OATH_DAYS = 7;

type Archer = Pick<CharacterSheet, "id" | "campaignId" | "conditions" | "conditionMeta">;

// The oath now: the sworn creature as it stands (its newest row, living),
// or the wait for the dawn after it died. Null when no oath holds; an oath
// run out is taken off the sheet here.
type OathNow = { lives: EncounterEnemy } | { waitsForDawn: true } | null;

export function oathNow(sheet: Archer): OathNow {
  const name = sheet.conditions.find((entry) => isConditionNamed(entry, SWORN_ENEMY));
  const meta = name ? (sheet.conditionMeta as ConditionMetaMap)[name] : undefined;
  if (!name || !meta?.source) {
    return null;
  }
  const now = getClock(sheet.campaignId).instant;
  const swornAt = meta.oath?.swornAt ?? now;
  const creature = latestAppearance(meta.source);
  if (dawnsBetween(swornAt + OATH_DAYS * MINUTES_PER_DAY, now) >= 1) {
    endOath(sheet, name);
    return null;
  }
  if (creature && creature.status !== "dead") {
    return { lives: creature };
  }
  // Dead: when, as near as the clock knows (by the end of its fight).
  const fight = creature ? getEncounter(creature.encounterId) : null;
  const diedAt = meta.oath?.diedAt ?? Math.min(now, fight?.endedInstant ?? now);
  if (dawnsBetween(diedAt, now) >= 1) {
    endOath(sheet, name);
    return null;
  }
  if (meta.oath?.diedAt === undefined) {
    patchSheet(sheet.id, { conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), [name]: { ...meta, oath: { swornAt, diedAt } } } });
  }
  return { waitsForDawn: true };
}

function endOath(sheet: Archer, name: string) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, [name]);
  const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(sheet.campaignId, "sheet_updated", { sheet: updated });
  }
}

// The creature the archer has sworn against, while it lives: its newest row,
// in this fight or another.
export function swornEnemyOf(sheet: Archer): string | null {
  const oath = oathNow(sheet);
  return oath && "lives" in oath ? oath.lives.id : null;
}

// An Oathbow's ranged shot at this creature: whether it is at the sworn
// enemy, whether the shot swears it (none is sworn, and no death is waiting
// on a dawn), and whether a dead sworn enemy keeps the bow from swearing.
export function oathbowShot(sheet: CharacterSheet, profile: AttackProfile, enemyId: string, atRange: boolean): { sworn: boolean; swear: boolean; waits?: boolean } | null {
  if (!profile.gearOath || !atRange) {
    return null;
  }
  const oath = oathNow(sheet);
  if (!oath) {
    return { sworn: true, swear: true };
  }
  return "lives" in oath ? { sworn: oath.lives.id === enemyId, swear: false } : { sworn: false, swear: false, waits: true };
}

// Disadvantage on an attack with any other weapon while the sworn enemy lives.
export function swornElsewhere(sheet: Archer, profile: Pick<AttackProfile, "gearOath">): boolean {
  return !profile.gearOath && swornEnemyOf(sheet) !== null;
}

// The +3d6 piercing on a hit against the sworn enemy, as a magic weapon's
// dice ride (gear-attack.ts itemRidersAgainst reads gearDice).
export function withOathDice(profile: AttackProfile): AttackProfile {
  return { ...profile, gearDice: [...(profile.gearDice ?? []), { dice: "3d6", type: "piercing" }] };
}

// The command phrase said: this creature is the archer's sworn enemy.
export function swearOath(campaign: Campaign, sheetId: string, enemyId: string): string | null {
  const sheet = getSheetById(sheetId);
  const enemy = getEnemy(enemyId);
  if (!sheet || !enemy) {
    return null;
  }
  const kept = sheet.conditions.filter((entry) => !isConditionNamed(entry, SWORN_ENEMY));
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  delete meta[SWORN_ENEMY];
  const swornAt = getClock(campaign.id).instant;
  const updated = patchSheet(sheet.id, { conditions: [...kept, SWORN_ENEMY], conditionMeta: { ...meta, [SWORN_ENEMY]: { source: enemy.id, oath: { swornAt } } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `Oathbow: "Swift death to you who have wronged me." ${enemy.displayName} is ${sheet.name}'s sworn enemy until it dies or the dawn seven days from now: advantage, no cover but total and no long-range disadvantage on the bow's shots at it, +3d6 piercing on a hit, and disadvantage with every other weapon while it lives`;
}

// The clock moved (db/clock.ts): an oath its dawn has ended comes off the
// sheet, so the sheet and GAME STATE stop showing it.
export function oathsAtDawn(campaignId: string) {
  for (const sheet of listSheets(campaignId)) {
    if (sheet.conditions.some((entry) => isConditionNamed(entry, SWORN_ENEMY))) {
      oathNow(sheet);
    }
  }
}
