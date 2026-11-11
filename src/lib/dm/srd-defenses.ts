// The SRD defenses the final recount found narrated (SRD 5.1):
//
//   - Nature's Sanctuary (Circle of the Land 14): a beast or plant that
//     attacks the druid first makes a WIS save against their spell save DC;
//     on a failure it must choose another target or lose the attack.
//     enemy_attack asks it through the Sanctuary ward (enemy-conditions.ts
//     sanctuaryWard), so a creature turned away stays turned for the turn.
//   - Tranquility (Way of the Open Hand 11): at the end of a long rest the
//     monk gains the effect of Sanctuary until the next long rest, with a
//     save DC of 8 + WIS + proficiency (spell-defenses.ts sanctuaryRefusal
//     reads tranquilityDc for a caster with no spell save DC of their own).

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

// A beast or plant that made its save against one druid's Nature's Sanctuary,
// for the day it is immune to it.
export const SANCTUARY_PASSED = "unmoved by nature's sanctuary";
const DAY_ROUNDS = 14400;

export function naturesSanctuaryRefusal(campaignId: string, enemy: EncounterEnemy, targetId: string): ToolError | null {
  const target = getSheetById(targetId);
  if (!target || !holdsFeature(target, "nature's sanctuary") || !/\b(beast|plant)\b/.test(textKey(String(enemy.stats.type ?? "")))) {
    return null;
  }
  // "On a successful save, the creature is immune to this effect for 24
  // hours": the mark its save leaves, read before another is rolled.
  const meta = enemy.conditionMeta as ConditionMetaMap;
  if (enemy.conditions.includes(SANCTUARY_PASSED) && instancesOf(meta[SANCTUARY_PASSED]).some((entry) => entry.source === target.id)) {
    return null;
  }
  const dc = computeSheetDerived(target).spellSaveDc ?? 13;
  const save = rollEnemySave(campaignId, enemy, "wis", dc, {
    magical: true,
    record: { detail: `${enemy.displayName}: WIS save against ${target.name}'s Nature's Sanctuary` },
  });
  if (save.success) {
    const fresh = getEnemy(enemy.id) ?? enemy;
    const held = fresh.conditionMeta as ConditionMetaMap;
    const earlier = fresh.conditions.includes(SANCTUARY_PASSED) ? instancesOf(held[SANCTUARY_PASSED]) : [];
    const [first, ...rest] = [...earlier, { rounds: DAY_ROUNDS, source: target.id }];
    patchEnemyConditions(
      fresh.id,
      fresh.conditions.includes(SANCTUARY_PASSED) ? fresh.conditions : [...fresh.conditions, SANCTUARY_PASSED],
      { ...held, [SANCTUARY_PASSED]: rest.length ? { ...first, others: rest } : first } as typeof fresh.conditionMeta,
    );
  }
  return save.success
    ? null
    : { error: `${enemy.displayName} fails its WIS save (DC ${dc}) against ${target.name}'s Nature's Sanctuary and cannot attack them: it must choose another target or lose the attack.`, retry: true };
}

// The DC of the Sanctuary Tranquility gives, or null for a caster whose own
// spell save DC decides it.
export function tranquilityDc(caster: CharacterSheet): number | null {
  if (!holdsFeature(caster, "tranquility")) {
    return null;
  }
  const derived = computeSheetDerived(caster);
  return 8 + derived.proficiencyBonus + derived.abilityMods.wis;
}

// After a long rest: every monk with Tranquility is under Sanctuary until the
// next one (it ends early, as the spell does, when they attack or cast at an
// enemy).
export function tranquilityAfterLongRest(campaign: Campaign, restingIds: string[]): string[] {
  const lines: string[] = [];
  for (const id of restingIds) {
    const sheet = getSheetById(id);
    if (!sheet || sheet.deathSaves?.dead || !holdsFeature(sheet, "tranquility")) {
      continue;
    }
    const kept = sheet.conditions.filter((entry) => textKey(entry) !== "sanctuary");
    const updated = patchSheet(sheet.id, {
      conditions: [...kept, "sanctuary"],
      conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), sanctuary: { source: sheet.id, rounds: 14400 } },
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${sheet.name} rises under Tranquility's Sanctuary.`);
  }
  return lines;
}
