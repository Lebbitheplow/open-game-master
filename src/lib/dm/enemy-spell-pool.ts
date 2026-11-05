import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import type { EnemyUse } from "@/lib/dm/enemy-casting";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollCard } from "@/lib/dm/roll-card";
import { conditionImmunity, handleSetCondition } from "@/lib/dm/set-condition";
import { laySpellConditionsOnEnemy, spellConditionMeta } from "@/lib/dm/spell-effects";
import { sheetCreatureType } from "@/lib/dm/summon-rules";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { addDice } from "@/lib/srd/spell-scaling";

// Sleep (and Color Spray) cast by a creature (SRD 5.1): no saving throw, one
// pool of hit points rolled for the casting and spent on the creatures caught
// from the lowest current hit points up, characters, companions and other
// creatures alike. A creature the spell passes over (undead, one immune to
// being charmed, an elf whose Fey Ancestry keeps magic from putting it to
// sleep, one already asleep) spends nothing of it; the first the rest of the
// pool cannot cover ends the casting, since every one after it has more. A
// character's casting of these is spell-pool.ts; a creature's was refused,
// as the spell asks for no save.
export function enemySpellPool(
  campaign: Campaign,
  turn: DmTurn,
  use: EnemyUse,
  caught: { sheets: CharacterSheet[]; enemies: EncounterEnemy[] },
): ToolResult {
  const pool = use.hitPointPool;
  if (!pool) {
    return { error: `${use.name} rolls no pool of hit points.`, retry: true };
  }
  const spellLevel = use.spellLevel ?? 1;
  const dice = addDice(pool.dice, pool.perSlotLevel, Math.max(0, (use.slotLevel ?? spellLevel) - spellLevel));
  const caster = { kind: "enemy" as const, id: use.enemy.id, name: use.enemy.displayName };
  use.commit();
  const rolled = rollCard(campaign, turn, null, "custom", `${use.name}: hit points it can affect`, dice, caster).total;
  const meta = spellConditionMeta({ rounds: pool.rounds, endsOnDamage: pool.endsOnDamage }, { spell: use.name, casterId: use.enemy.id, slotLevel: use.slotLevel ?? null }, null);
  type Caught = { kind: "sheet"; sheet: CharacterSheet } | { kind: "enemy"; enemy: EncounterEnemy };
  const hp = (entry: Caught) => (entry.kind === "sheet" ? entry.sheet.currentHp : entry.enemy.currentHp);
  const creatures: Caught[] = [
    ...caught.sheets.filter((sheet) => sheet.currentHp > 0 && !sheet.deathSaves?.dead).map((sheet) => ({ kind: "sheet" as const, sheet })),
    ...caught.enemies.filter((enemy) => enemy.status === "alive" && enemy.id !== use.enemy.id).map((enemy) => ({ kind: "enemy" as const, enemy })),
  ].sort((a, b) => hp(a) - hp(b));
  let left = rolled;
  let spent = false;
  const results: Array<Record<string, unknown>> = [];
  for (const entry of creatures) {
    const name = entry.kind === "sheet" ? entry.sheet.name : entry.enemy.displayName;
    const conditions = entry.kind === "sheet" ? entry.sheet.conditions : entry.enemy.conditions;
    const type = (entry.kind === "sheet" ? sheetCreatureType(entry.sheet) : String(entry.enemy.stats.type ?? "")).toLowerCase();
    const passed =
      pool.immuneTypes?.find((kind) => type.includes(kind)) ??
      pool.skipConditions?.find((condition) => conditions.some((held) => isConditionNamed(held, condition))) ??
      null;
    const immune = passed
      ? null
      : entry.kind === "sheet"
        ? (pool.immuneCondition ? conditionImmunity(campaign, entry.sheet, pool.immuneCondition, true, use.enemy.id) : null) ??
          conditionImmunity(campaign, entry.sheet, pool.condition, true, use.enemy.id)
        : (pool.immuneCondition && immuneToCondition(entry.enemy, pool.immuneCondition)) || immuneToCondition(entry.enemy, pool.condition)
          ? "it is immune"
          : null;
    if (passed || immune) {
      results.push({ target: name, note: passed ? `${name} is ${passed}; ${use.name} passes over them.` : `${name} is not affected (${immune}).` });
      continue;
    }
    if (spent || hp(entry) > left) {
      spent = true;
      results.push({ target: name, note: `${name} has ${hp(entry)} hit points, more than the ${left} left in ${use.name}: unaffected.` });
      continue;
    }
    left -= hp(entry);
    const landed =
      entry.kind === "sheet"
        ? !("error" in handleSetCondition(campaign, turn.id, getSheetById(entry.sheet.id) ?? entry.sheet, { condition: pool.condition, sourceEnemyId: use.enemy.id }, `${use.enemy.displayName}'s ${use.name}`, { spellEffect: meta }))
        : laySpellConditionsOnEnemy((getEnemy(entry.enemy.id) ?? entry.enemy).id, [pool.condition], meta).length > 0;
    results.push({ target: name, ...(landed ? { conditionApplied: pool.condition } : { note: `${name} is not affected.` }) });
  }
  if (caught.enemies.length) {
    publishEncounter(campaign.id);
  }
  return {
    ok: true,
    spell: use.name,
    caster: use.enemy.displayName,
    noSave: true,
    pool: `${dice}: ${rolled} hit points, ${left} left`,
    results,
    duration: `${pool.rounds} round${pool.rounds === 1 ? "" : "s"}${pool.endsOnDamage ? ", or until a sleeper takes damage or is shaken awake" : ""}`,
  };
}
