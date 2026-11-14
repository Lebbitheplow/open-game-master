// What the horror classes' features do around a character's attack (WAVE2
// D5), each called from the one place both dice paths share:
//   The Stake Remembers (slayer 15): "an attack against a creature at half HP
//     or lower becomes an automatic critical if it hits": the spend lays its
//     mark, and the next attack on such a creature spends it
//     (authored-hooks.ts authoredAttackSituation asks horrorAttackSituation);
//   Deathblow (slayer 15): "Your critical hits against your Quarry deal
//     maximum damage" (attack-swing.ts hitSwing asks horrorCritMaximum);
//   Piercing the Heart (slayer 7): "Your critical hits against undead or
//     shapechangers stun them until the end of your next turn (CON save
//     negates...)", Stunning Strike's stun at the text's DC;
//   Called Shot (slayer 13): "on hit, the target also loses one movement
//     mode, attack, or sense until your next turn": the declared shot's mark
//     is spent by the next weapon hit, which leaves the creature hobbled
//     (speed 0), its attack rolls at disadvantage (the nearest the engine
//     holds to one attack lost), or blinded;
//   Ectoplasmic Sample (parapsychologist 7): "After damaging a spirit, your
//     party's attacks against it count as magical for 1 minute" (a spirit is
//     an undead in the SRD's types; pc-attack-damage.ts strikesAsMagic reads
//     the sample);
//   No Witnesses Left (survivor 11): "+1d8 damage against creatures that have
//     downed an ally this fight": the creature whose attack drops a character
//     to 0 carries the record (authored-hooks.ts authoredAfterHit asks
//     horrorAfterEnemyHit), which the hit_rider row reads (vsCondition).
// attack-blow.ts landSwingBlow asks horrorOnHit once a blow has landed.
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { TypedRider } from "@/lib/dm/damage-parts";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { quarryOn } from "@/lib/dm/genre-a-horror-marks";
import { maximumOf } from "@/lib/dm/heal-spell";
import { stunningStrikeSave } from "@/lib/dm/pc-attack-riders";
import { textKey } from "@/lib/language/text-logic";
import { computeSheetDerived } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { horrorHolds } from "@/lib/srd/genre-a-horror-holds";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const STAKE = "the stake remembers";
const CALLED = "called shot";
export const SAMPLE = "ectoplasmic sample";
export const DOWNED_AN_ALLY = "downed an ally";

const held = (sheet: Pick<CharacterSheet, "conditions">, name: string) => sheet.conditions.find((entry) => isConditionNamed(entry, name));
const typeOf = (enemy: Pick<EncounterEnemy, "stats">) => textKey(String(enemy.stats?.type ?? ""));

export function horrorAttackSituation(sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "currentHp" | "maxHp">): { autoCrit: string; note: string; spent: string } | null {
  const mark = held(sheet, STAKE);
  return mark && enemy.currentHp * 2 <= enemy.maxHp
    ? { autoCrit: "The Stake Remembers", note: "The Stake Remembers: a hit on a creature at half its hit points or lower is a critical hit", spent: mark }
    : null;
}

// The critical's damage at its maximum: every die of the doubled roll, and
// each typed rider's doubled dice as a flat part of its type.
export function horrorCritMaximum(
  sheet: CharacterSheet,
  enemyId: string,
  rolled: string,
  riders: TypedRider[],
  critOf: (dice: string) => string,
): { expression: string; riders: TypedRider[]; note: string } | null {
  if (!horrorHolds(sheet, "Deathblow") || !quarryOn(sheet, enemyId)) {
    return null;
  }
  return {
    expression: String(maximumOf(rolled)),
    riders: riders.map((rider) => (rider.dice ? { dice: "", type: rider.type, flat: (rider.flat ?? 0) + maximumOf(critOf(rider.dice)) } : rider)),
    note: "Deathblow: the critical hit on the slayer's Quarry deals its maximum damage",
  };
}

const CALLED_SHOTS: Record<string, { condition: string; says: string }> = {
  "called shot (movement)": { condition: "hobbling shot", says: "its speed is 0" },
  "called shot (attack)": { condition: "disarming shot", says: "its attack rolls are at disadvantage" },
  "called shot (sense)": { condition: "blinded", says: "it is blinded" },
};

function leave(enemyId: string, condition: string, holderId: string): boolean {
  const fresh = getEnemy(enemyId);
  if (!fresh || fresh.status !== "alive" || immuneToCondition(fresh, condition)) {
    return false;
  }
  const kept = fresh.conditions.filter((entry) => entry !== condition);
  patchEnemyConditions(fresh.id, [...kept, condition], { ...fresh.conditionMeta, [condition]: { source: holderId, untilTurnOf: holderId } });
  return true;
}

export function horrorOnHit(
  campaign: Campaign,
  input: { sheet: CharacterSheet; enemy: EncounterEnemy; crit: boolean; dead: boolean; weapon: boolean },
): string[] {
  const lines: string[] = [];
  const sheet = getSheetById(input.sheet.id) ?? input.sheet;
  const enemy = getEnemy(input.enemy.id) ?? input.enemy;
  const called = input.weapon ? held(sheet, CALLED) : undefined;
  if (called) {
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, [called]);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    const shot = CALLED_SHOTS[called];
    if (shot && !input.dead) {
      lines.push(
        leave(enemy.id, shot.condition, sheet.id)
          ? `Called Shot: ${enemy.displayName} is hit where ${sheet.name} called it, and ${shot.says} until the start of ${sheet.name}'s next turn.`
          : `Called Shot: the shot lands, and ${enemy.displayName} cannot be ${shot.condition}.`,
      );
    }
  }
  if (input.dead) {
    return lines;
  }
  const type = typeOf(enemy);
  if (input.crit && input.weapon && (type.includes("undead") || type.includes("shapechanger")) && horrorHolds(sheet, "Piercing the Heart")) {
    const derived = computeSheetDerived(sheet);
    const dc = 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.str, derived.abilityMods.dex);
    lines.push(stunningStrikeSave(campaign, enemy.encounterId, enemy.id, sheet.id, dc).replace("Stunning Strike", "Piercing the Heart").replace(" The ki is spent.", ""));
  }
  if (type.includes("undead") && horrorHolds(sheet, "Ectoplasmic Sample")) {
    const fresh = getEnemy(enemy.id);
    if (fresh && fresh.status === "alive") {
      patchEnemyConditions(fresh.id, [...fresh.conditions.filter((entry) => entry !== SAMPLE), SAMPLE], { ...fresh.conditionMeta, [SAMPLE]: { source: sheet.id, rounds: 10 } });
      lines.push(`Ectoplasmic Sample: for a minute the party's attacks against ${fresh.displayName} count as magical.`);
    }
  }
  return lines;
}

// The party's attacks count as magical against a creature that carries the sample.
export function horrorSampled(enemy: { conditions?: string[] } | undefined): boolean {
  return Boolean(enemy?.conditions?.some((entry) => isConditionNamed(entry, SAMPLE)));
}

// An enemy's attack has dealt damage to a character: one it left at 0 hit
// points is recorded on the attacker for the rest of the fight, while any
// survivor of the party holds No Witnesses Left.
export function horrorAfterEnemyHit(campaign: Campaign, attacker: EncounterEnemy, target: CharacterSheet): void {
  const fresh = getEnemy(attacker.id);
  if (target.currentHp > 0 || !fresh || fresh.status !== "alive" || fresh.conditions.includes(DOWNED_AN_ALLY)) {
    return;
  }
  if (!listSheets(campaign.id).some((entry) => entry.id !== target.id && horrorHolds(entry, "No Witnesses Left"))) {
    return;
  }
  patchEnemyConditions(fresh.id, [...fresh.conditions, DOWNED_AN_ALLY], { ...fresh.conditionMeta, [DOWNED_AN_ALLY]: { source: target.id } });
}
