// What a one-creature save_effect spend holds beyond its save and its
// condition (src/lib/dm/authored-spend-effects.ts): Hypnotic Gaze's "if it
// can see or hear you", its incapacitation beside the charm, its endings (more
// than 5 feet away, any damage), its "later actions extend it", and its "once
// you use it on a creature, whatever the result, you can't use it on that
// creature again until you finish a long rest". Before this every one of those
// was a sentence for the GM, so a gazed creature kept its turn and could be
// gazed again on the next.
//
// A save_effect row that names any of these fields goes through here.
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export type SaveEffectExtras = {
  condition?: string;
  rounds?: number;
  untilNextTurnEnds?: boolean;
  alsoCondition?: string;
  endsOnDamage?: boolean;
  leashFeet?: number;
  senses?: "see_or_hear";
  oncePerCreature?: boolean;
};

const has = (enemy: EncounterEnemy, condition: string) => enemy.conditions.some((entry) => textKey(entry) === textKey(condition));

// The mark a creature carries once the feature was used on it, naming each
// holder (as Instinctive Charm's "withstood" mark does), until their long rest.
const metMark = (feature: string) => textKey(`met ${feature}`);

// Whether the creature carries this holder's condition now (one instance of
// several sources counts).
function heldBy(enemy: EncounterEnemy, condition: string, holderId: string): boolean {
  const meta = (enemy.conditionMeta as ConditionMetaMap)[textKey(condition)] as { source?: string; others?: Array<{ source?: string }> } | undefined;
  return has(enemy, condition) && Boolean(meta && (meta.source === holderId || meta.others?.some((other) => other.source === holderId)));
}

// The refusal before anything is rolled or spent, or null.
export function saveEffectRefusal(does: SaveEffectExtras, holder: { id: string; name: string }, enemy: EncounterEnemy, feature: string): ToolError | null {
  if (does.senses === "see_or_hear" && has(enemy, "blinded") && has(enemy, "deafened")) {
    return { error: `${enemy.displayName} can neither see nor hear ${holder.name}, and ${feature} takes a creature that can see or hear them. Nothing was spent.`, refused: "rules" };
  }
  if (does.oncePerCreature) {
    const sources = ((enemy.conditionMeta as ConditionMetaMap)[metMark(feature)] as { sources?: string[] } | undefined)?.sources ?? [];
    if (has(enemy, metMark(feature)) && sources.includes(holder.id)) {
      return { error: `${holder.name} has used ${feature} on ${enemy.displayName} already, and cannot again until their long rest. Nothing was spent.`, refused: "rules" };
    }
  }
  return null;
}

// "Later actions extend it": the call names variant "extend", and with the
// creature still under this holder's condition the action renews it for its
// whole length and rolls nothing. Asked without it, a second use on the same
// creature is the one the text bars.
export const EXTEND = "extend";

export function extendsHeld(does: SaveEffectExtras, holderId: string, enemy: EncounterEnemy, variant: string | undefined): boolean | ToolError {
  if (!does.oncePerCreature || textKey(variant ?? "") !== EXTEND) {
    return false;
  }
  if (!does.condition || !heldBy(enemy, does.condition, holderId)) {
    return { error: `${enemy.displayName} is not ${does.condition ?? "held"} by this use any more, so there is nothing to extend. Nothing was spent.`, refused: "rules" };
  }
  return true;
}

// Lays the condition and the one beside it, each ending as the row says.
// Answers whether the condition landed.
export function layWithExtras(campaign: Campaign, enemy: EncounterEnemy, holderId: string, does: SaveEffectExtras): boolean {
  if (!does.condition) {
    return false;
  }
  const meta = {
    source: holderId,
    ...(does.untilNextTurnEnds ? { untilTurnEndOf: holderId } : does.rounds ? { rounds: does.rounds } : {}),
    ...(does.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(does.leashFeet ? { leashFeet: does.leashFeet } : {}),
    // "if it can't see or hear you": the hold ends with the senses it asked
    // for (ar-ws-senses-logic.ts, applied where enemy conditions are written).
    ...(does.senses === "see_or_hear" ? { endsUnsensed: true } : {}),
  };
  const fresh = () => getEnemy(enemy.id) ?? enemy;
  if (immuneToCondition(fresh(), does.condition)) {
    return false;
  }
  // A renewal takes the old instance off first, so the new length stands.
  dropHolders(fresh(), [does.condition, does.alsoCondition ?? ""].filter(Boolean), holderId);
  layEnemyConditionInstance(campaign, fresh(), does.condition, meta);
  if (does.alsoCondition && !immuneToCondition(fresh(), does.alsoCondition)) {
    layEnemyConditionInstance(campaign, fresh(), does.alsoCondition, meta);
  }
  publishEncounter(campaign.id);
  return true;
}

// The creature remembers the holder until their long rest, whatever the result.
export function markMet(campaign: Campaign, enemy: EncounterEnemy, holderId: string, feature: string): void {
  const fresh = getEnemy(enemy.id) ?? enemy;
  const mark = metMark(feature);
  const marks = fresh.conditionMeta as ConditionMetaMap;
  const sources = (marks[mark] as { sources?: string[] } | undefined)?.sources ?? [];
  patchEnemyConditions(fresh.id, [...fresh.conditions.filter((entry) => textKey(entry) !== mark), mark], {
    ...marks,
    [mark]: { source: holderId, sources: [...sources.filter((id) => id !== holderId), holderId].slice(-20), untilLongRest: true },
  } as typeof fresh.conditionMeta);
  publishEncounter(campaign.id);
}

function dropHolders(enemy: EncounterEnemy, conditions: string[], holderId: string): void {
  const keys = conditions.map(textKey);
  const marks = enemy.conditionMeta as ConditionMetaMap;
  const owned = keys.filter((key) => heldBy(enemy, key, holderId) && !(marks[key] as { others?: unknown[] } | undefined)?.others?.length);
  if (!owned.length) {
    return;
  }
  const meta = { ...marks };
  for (const key of owned) delete meta[key];
  patchEnemyConditions(enemy.id, enemy.conditions.filter((entry) => !owned.includes(textKey(entry))), meta as typeof enemy.conditionMeta);
}
