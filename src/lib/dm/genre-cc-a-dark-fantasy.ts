// The dark fantasy features the 2026-11-13 creator audit's second genre pass
// wired into a weapon attack (WAVE2 D5: the genre text is the rule, played on
// the SRD 5.1 engine):
//
//   Silver Tide (witch hunter 11): "Allies within 20 ft deal +1d4 radiant
//     with weapon attacks against your branded quarry": another character's
//     weapon attack on a creature a witch hunter's brand is on, standing
//     within 20 feet of that hunter, carries 1d4 radiant (read by
//     src/lib/dm/pc-attack-plan.ts as Bestow Curse's die is);
//   Sanctioned Execution (witch hunter 17): "Your critical hits against
//     branded creatures prevent regeneration and revival for 24 hours": the
//     creature's Regeneration is stopped for a day (the troll's acid or fire
//     mark, kept 24 hours) and the mark says it cannot be revived;
//   Champion of the Quiet Court (grave knight 18): "critical hits also
//     frighten (WIS save negates)": the creature a weapon's critical hit
//     struck saves on Wisdom against the knight's spell save DC or is
//     frightened of them until the end of their next turn, as Form of Dread's
//     fright lasts (src/lib/dm/hit-save.ts).
//
// The two critical hits are read once the blow has landed
// (src/lib/dm/attack-blow.ts), the execution even on a blow that kills.
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { TypedRider } from "@/lib/dm/damage-parts";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { REGENERATION_STOPPED } from "@/lib/dm/monster-abilities";
import { applyRiderCondition, riderBarred } from "@/lib/dm/pc-attack-riders";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { computeSheetDerived } from "@/lib/srd";
import { counterSaveDc } from "@/lib/srd/counter-rules";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { BRAND_CONDITIONS } from "@/lib/srd/genre-a-dark-fantasy-conditions";
import { SANCTIONED } from "@/lib/srd/genre-cc-a-conditions";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const DAY = 24 * 600;

// Whether one of the hunter's brands is on this creature.
export function brandsCreature(hunter: Pick<CharacterSheet, "conditions" | "conditionMeta">, enemyId: string): boolean {
  const meta = (hunter.conditionMeta ?? {}) as ConditionMetaMap;
  return hunter.conditions.some((entry) => isConditionNamed(entry, ...BRAND_CONDITIONS) && meta[entry]?.quarry === enemyId);
}

export function silverTideRider(campaignId: string, encounterId: string, attacker: CharacterSheet, enemy: EncounterEnemy, weaponAttack: boolean): (TypedRider & { note: string }) | null {
  if (!weaponAttack) {
    return null;
  }
  const hunter = listSheets(campaignId)
    .filter((entry) => entry.id !== attacker.id)
    .map((entry) => getSheetById(entry.id) ?? entry)
    .find((entry) => holdsGenreFeature(entry, "witch_hunter", "Silver Tide") && brandsCreature(entry, enemy.id) && withinFeet(encounterId, entry.id, attacker.id, 20));
  return hunter ? { dice: "1d4", type: "radiant", note: `Silver Tide: +1d4 radiant, ${hunter.name}'s branded quarry` } : null;
}

export function darkFantasyCritMarks(scene: { campaign: Campaign; sheet: CharacterSheet; enemy: EncounterEnemy }, record: { weaponAttack?: boolean }, crit: boolean, dead: boolean): string[] {
  if (!crit) {
    return [];
  }
  const { campaign, enemy } = scene;
  const sheet = getSheetById(scene.sheet.id) ?? scene.sheet;
  const lines: string[] = [];
  const fresh = getEnemy(enemy.id);
  if (fresh && holdsGenreFeature(sheet, "witch_hunter", "Sanctioned Execution") && brandsCreature(sheet, fresh.id)) {
    const kept = fresh.conditions.filter((entry) => entry !== REGENERATION_STOPPED && !isConditionNamed(entry, SANCTIONED));
    patchEnemyConditions(fresh.id, [...kept, REGENERATION_STOPPED, SANCTIONED], {
      ...(fresh.conditionMeta as ConditionMetaMap),
      [REGENERATION_STOPPED]: { rounds: DAY, source: sheet.id },
      [SANCTIONED]: { rounds: DAY, source: sheet.id },
    } as typeof fresh.conditionMeta);
    lines.push(`Sanctioned Execution: ${fresh.displayName} cannot regenerate or be revived for 24 hours.`);
  }
  const struck = getEnemy(enemy.id);
  if (!dead && record.weaponAttack !== false && struck && struck.status === "alive" && holdsGenreFeature(sheet, "grave_knight", "Champion of the Quiet Court")) {
    const barred = riderBarred(struck, "frightened", null);
    if (barred) {
      return [...lines, `Champion of the Quiet Court: ${barred}`];
    }
    const dc = counterSaveDc("spell", computeSheetDerived(sheet), 0);
    const save = rollEnemySave(campaign.id, struck, "wis", dc, { against: "frightened", origin: { ref: sheet.id } });
    const shown = save.total ?? "an automatic failure";
    if (save.success) {
      lines.push(`Champion of the Quiet Court: ${struck.displayName} holds (${shown} vs DC ${dc}); not frightened.`);
    } else {
      applyRiderCondition(campaign, struck, "frightened", { meta: untilTurnEnd(sheet.id, { source: sheet.id }) });
      lines.push(`Champion of the Quiet Court: the critical hit frightens ${struck.displayName} (${shown} vs DC ${dc}) until the end of ${sheet.name}'s next turn.`);
    }
  }
  return lines;
}

// Relentless Pursuit (witch hunter 10): "Your branded quarry cannot hide from
// you": a creature the hunter's brand is on is not hidden from them, so their
// attack on it is not made unseen (src/lib/dm/attack-sight.ts). Its
// invisibility, a spell's, still holds.
export function pursuedConditions(sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "id">, conditions: string[]): string[] {
  return holdsGenreFeature(sheet, "witch_hunter", "Relentless Pursuit") && brandsCreature(sheet, enemy.id) ? conditions.filter((entry) => !isConditionNamed(entry, "hidden")) : conditions;
}
