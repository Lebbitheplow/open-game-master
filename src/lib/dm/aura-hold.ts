// An aura that holds a frightened creature still (Aura of Conquest: "If a
// creature is frightened of you, its speed is reduced to 0 while in the
// aura"). Read by src/lib/dm/enemy-speed.ts enemyMoveBudget, the one count
// every walk of an enemy's own reads (move_token, enemy_attack's walk-up, the
// board's guess at its next move), so a frightened goblin beside the paladin
// cannot walk off: the row's note once said "the board does not stop it".
//
// The aura is an enemy_turn_damage effect with `holdsSpeed`
// (src/lib/srd/authored-effects-types.ts), the same row that hurts the
// creature as its turn starts, so the reach and its 18th-level growth are
// read from one place.

import { getSheetById } from "@/lib/db/sheets";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { incapacitatedBy, instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { textKey } from "@/lib/language/text-logic";

type Held = { id: string; encounterId: string; conditions: string[]; conditionMeta?: unknown };

function reach(range: number | Array<[number, number]>, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 10;
  for (const [atLevel, value] of range) {
    if (level >= atLevel) {
      feet = value;
    }
  }
  return feet;
}

// The feature that holds this creature's speed at 0 now, or null: a source of
// its fear, up and not incapacitated, whose aura it stands in.
export function auraHoldsSpeed(enemy: Held): string | null {
  const meta = (enemy.conditionMeta ?? {}) as ConditionMetaMap;
  const sources = new Set<string>();
  for (const name of enemy.conditions) {
    if (textKey(name) === "frightened") {
      for (const entry of instancesOf(meta[name])) {
        if (entry.source) {
          sources.add(entry.source);
        }
      }
    }
  }
  for (const id of sources) {
    const holder = getSheetById(id);
    if (!holder || holder.currentHp <= 0 || holder.deathSaves?.dead || incapacitatedBy(holder.conditions)) {
      continue;
    }
    for (const { effect, held } of activeAuthored(holder, "enemy_turn_damage")) {
      if (effect.holdsSpeed && withinFeet(enemy.encounterId, holder.id, enemy.id, reach(effect.rangeFt, held.level))) {
        return held.feature;
      }
    }
  }
  return null;
}
