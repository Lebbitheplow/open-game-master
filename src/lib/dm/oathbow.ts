// Oathbow (SRD 5.1): "When you use this weapon to make a ranged attack, you
// can, as a command phrase, say, 'Swift death to you who have wronged me.'
// The target of your attack becomes your sworn enemy until it dies or until
// dawn seven days later. You can have only one such sworn enemy at a time.
// ... When you make a ranged attack roll with this weapon against your sworn
// enemy, you have advantage on the roll. In addition, your target gains no
// benefit from cover, other than total cover, and you suffer no disadvantage
// due to long range. If the attack hits, your sworn enemy takes an extra 3d6
// piercing damage. While your sworn enemy lives, you have disadvantage on
// attack rolls with all other weapons." The bow carried no rider at all.
//
// The sworn enemy is a condition on the archer naming the creature
// (`source`); it holds while that creature lives on the board. The phrase is
// said on the first Oathbow shot with no sworn enemy, as a player would say
// it, and written only once the shot is made (pc-attack.ts). Read by the
// turn's swing (pc-attack-plan.ts) and, for the disadvantage with other
// weapons, the opportunity attack (opportunity-strike.ts).
//
// Not modeled: the oath outliving the fight (dawn seven days later), and the
// wait for the next dawn before swearing anew once the sworn enemy dies.

import { getEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { Campaign } from "@/lib/db/campaigns";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SWORN_ENEMY = "sworn enemy";

// The creature the archer has sworn against, while it lives.
export function swornEnemyOf(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): string | null {
  const name = sheet.conditions.find((entry) => isConditionNamed(entry, SWORN_ENEMY));
  const id = name ? (sheet.conditionMeta as ConditionMetaMap)[name]?.source : undefined;
  const foe = id ? getEnemy(id) : null;
  return foe && foe.status === "alive" ? foe.id : null;
}

// An Oathbow's ranged shot at this creature: whether it is at the sworn
// enemy, and whether the shot swears it (none is sworn yet).
export function oathbowShot(sheet: CharacterSheet, profile: AttackProfile, enemyId: string, atRange: boolean): { sworn: boolean; swear: boolean } | null {
  if (!profile.gearOath || !atRange) {
    return null;
  }
  const held = swornEnemyOf(sheet);
  return held ? { sworn: held === enemyId, swear: false } : { sworn: true, swear: true };
}

// Disadvantage on an attack with any other weapon while the sworn enemy lives.
export function swornElsewhere(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, profile: Pick<AttackProfile, "gearOath">): boolean {
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
  const updated = patchSheet(sheet.id, { conditions: [...kept, SWORN_ENEMY], conditionMeta: { ...meta, [SWORN_ENEMY]: { source: enemy.id } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `Oathbow: "Swift death to you who have wronged me." ${enemy.displayName} is ${sheet.name}'s sworn enemy until it dies: advantage, no cover but total and no long-range disadvantage on the bow's shots at it, +3d6 piercing on a hit, and disadvantage with every other weapon while it lives`;
}
