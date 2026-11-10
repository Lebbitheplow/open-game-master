// An aura that asks each enemy once (Avenging Angel's aura of menace): "The
// first time an enemy enters the aura or starts its turn there during a
// battle, it makes a Wisdom save or is frightened of you for a minute or until
// it takes damage." The spend's own burst asks those already in it as the
// wings open (authored-spend-effects.ts burst); this module asks the rest:
// one that walks in (map-tools.ts move_token, after the move) and one that
// starts its turn there (authored-turns.ts authoredTurnStart).
//
// Each creature asked carries a mark naming the holder, so it is never asked
// again while the aura lasts. The aura is the buff row's burst with `aura`
// set (src/lib/srd/authored-effects-types.ts), read where the holder carries
// the buff's condition.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { computeSheetDerived } from "@/lib/srd";
import { heldAuthored, hasCondition } from "@/lib/srd/authored-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { withinFeet } from "@/lib/dm/authored-saves";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { sideOf } from "@/lib/dm/combatant";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Burst = NonNullable<Extract<SpendDoes, { kind: "buff" }>["burst"]>;

// The mark an asked creature carries, with the holder as its source.
export const AURA_ASKED = "faced the aura of menace";

// The holder's aura now: the buff row whose burst is an aura, while the holder
// carries that buff's condition and is up.
function auraOf(holder: CharacterSheet): { name: string; burst: Burst } | null {
  if (holder.currentHp <= 0 || holder.deathSaves?.dead) {
    return null;
  }
  for (const held of heldAuthored(holder)) {
    for (const spend of held.entry.spends ?? []) {
      const does = spend.does;
      if (does.kind === "buff" && does.burst?.aura && typeof does.condition === "string" && hasCondition(holder, does.condition)) {
        return { name: spend.name, burst: does.burst };
      }
    }
  }
  return null;
}

function askedBy(enemy: EncounterEnemy, holderId: string): boolean {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  return enemy.conditions.some((name) => name === AURA_ASKED && instancesOf(meta?.[name]).some((entry) => entry.source === holderId));
}

function markAsked(campaign: Campaign, enemyId: string, holderId: string): void {
  const enemy = getEnemy(enemyId);
  if (enemy && !askedBy(enemy, holderId)) {
    layEnemyConditionInstance(campaign, enemy, AURA_ASKED, { source: holderId, rounds: 600 });
  }
}

// The burst's own creatures: asked as the aura opened.
export function noteAuraAsked(campaign: Campaign, holderId: string, enemyIds: string[]): string[] {
  for (const id of enemyIds) {
    markAsked(campaign, id, holderId);
  }
  return [];
}

function ask(campaign: Campaign, encounter: Encounter, holder: CharacterSheet, aura: { name: string; burst: Burst }, enemy: EncounterEnemy): string | null {
  const spec = aura.burst;
  markAsked(campaign, enemy.id, holder.id);
  const derived = computeSheetDerived(holder);
  const dc =
    spec.dcAbility === "spell"
      ? (derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int, derived.abilityMods.wis, derived.abilityMods.cha))
      : 8 + derived.proficiencyBonus + derived.abilityMods[spec.dcAbility];
  const save = rollEnemySave(campaign.id, enemy, spec.save, dc, {
    resist: Boolean(spec.condition) && bindsWorthResisting([spec.condition ?? ""]),
    against: spec.condition,
    origin: { ref: holder.id },
    record: { detail: `${enemy.displayName}: ${spec.save.toUpperCase()} save against ${aura.name}'s aura` },
  });
  if (save.success) {
    return `${aura.name}: ${enemy.displayName} resists the aura (${spec.save.toUpperCase()} ${save.total} vs DC ${dc}).`;
  }
  const lasting = { source: holder.id, ...(spec.rounds ? { rounds: spec.rounds } : {}), ...(spec.endsOnDamage ? { endsOnDamage: true } : {}) };
  for (const name of [spec.condition, spec.mark]) {
    const fresh = name ? getEnemy(enemy.id) : null;
    if (name && fresh && !immuneToCondition(fresh, name)) {
      layEnemyConditionInstance(campaign, fresh, name, lasting);
    }
  }
  return `${aura.name}: ${enemy.displayName} fails (${spec.save.toUpperCase()} ${save.total} vs DC ${dc}) and is ${spec.condition ?? "affected"}.`;
}

// Each holder's aura asks this enemy, when it stands in the aura and has not
// been asked. In a battle only, of a foe of the holder.
export function auraMenaceAsk(campaign: Campaign, enemyId: string): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return [];
  }
  const lines: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const holder = getSheetById(stale.id) ?? stale;
    const aura = auraOf(holder);
    const enemy = aura ? getEnemy(enemyId) : null;
    if (!aura || !enemy || enemy.status !== "alive" || enemy.currentHp <= 0 || askedBy(enemy, holder.id)) {
      continue;
    }
    // A creature on the holder's own side (a charmed or commanded one) is no enemy.
    if (sideOf(encounter, "enemy", enemy.id, enemy) === sideOf(encounter, "sheet", holder.id, holder)) {
      continue;
    }
    if (!withinFeet(encounter.id, holder.id, enemy.id, aura.burst.rangeFt)) {
      continue;
    }
    const line = ask(campaign, encounter, holder, aura, enemy);
    if (line) {
      lines.push(line);
    }
  }
  if (lines.length) {
    publishEncounter(campaign.id);
  }
  return lines;
}
