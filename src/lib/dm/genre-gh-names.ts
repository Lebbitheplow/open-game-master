// Whispered Names (occultist 5): "Knowing a creature's true or use-name gives
// you advantage on your first spell attack or its first save against you
// each combat". Knowing the name is the story's: the occultist's spend
// Whispered Names on a creature (targetEnemyId) records it as the condition
// "true name known" on that creature, naming the occultist. Then, once in
// each fight, whichever comes first: the occultist's spell attack on it has
// advantage (src/lib/dm/pc-attack-situation.ts, spent by
// src/lib/dm/pc-attack-resolve.ts rollPcAttack), or its save against an
// effect the occultist forces has disadvantage (src/lib/dm/forced-save.ts
// rollEnemySave). The fight it was used in is kept on the condition.
import { getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";

export const NAME_KNOWN = "true name known";

// The creature's mark of a name this occultist knows, unused in this fight.
function knownName(encounter: Pick<Encounter, "id"> | null, sheet: Pick<CharacterSheet, "id" | "features"> | null, enemy: Pick<EncounterEnemy, "conditions" | "conditionMeta">): string | null {
  if (!encounter || !sheet || !holdsFeature(sheet, "Whispered Names")) {
    return null;
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  return enemy.conditions.find((entry) => isConditionNamed(entry, NAME_KNOWN) && meta[entry]?.source === sheet.id && meta[entry]?.usedTurn !== encounter.id) ?? null;
}

export const whisperedNameHolds = (encounter: Pick<Encounter, "id"> | null, sheet: Pick<CharacterSheet, "id" | "features"> | null, enemy: Pick<EncounterEnemy, "conditions" | "conditionMeta">) =>
  knownName(encounter, sheet, enemy) !== null;

// The name's use in this fight is spent.
export function spendWhisperedName(encounter: Pick<Encounter, "id"> | null, sheet: Pick<CharacterSheet, "id" | "features"> | null, enemyId: string): boolean {
  const enemy = getEnemy(enemyId);
  const held = enemy ? knownName(encounter, sheet, enemy) : null;
  if (!enemy || !held || !encounter) {
    return false;
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  patchEnemyConditions(enemy.id, enemy.conditions, { ...meta, [held]: { ...meta[held], usedTurn: encounter.id } });
  return true;
}

// The spend: the occultist knows this creature's name.
export function learnName(ctx: SpendContext): ToolError | { result: Record<string, unknown> } {
  const enemy = ctx.args.targetEnemyId ? getEnemy(ctx.args.targetEnemyId) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name}: name the creature whose true or use-name ${ctx.sheet.name} knows (targetEnemyId). Nothing was spent.`, retry: true };
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const conditions = [...enemy.conditions.filter((entry) => !isConditionNamed(entry, NAME_KNOWN)), NAME_KNOWN];
  patchEnemyConditions(enemy.id, conditions, { ...meta, [NAME_KNOWN]: { source: ctx.sheet.id } });
  publishEncounter(ctx.campaign.id);
  return { result: { applied: `${ctx.sheet.name} knows ${enemy.displayName}'s name: in each fight, their first spell attack on it has advantage, or its first save against them has disadvantage.` } };
}
