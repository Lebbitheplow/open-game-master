// Shaking a sleeper awake. SRD 5.1, Sleep: "Each creature affected by this
// spell falls unconscious until the spell ends, the sleeper takes damage, or
// someone uses an action to shake or slap the sleeper awake." Hypnotic
// Pattern: "The spell ends for an affected creature if it takes any damage or
// if someone else uses an action to shake the creature out of its stupor."
// take_action had no such action, so a sleeping ally stayed asleep until the
// GM cleared the condition by hand (audit 2026-11-16, Y17). The engine
// (shake-awake.ts) and the Hand's Wake card (hand-gear.ts) read the same rule.
// Pure.

import { instancesOf, packInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { textKey } from "@/lib/language/text-logic";

const WAKING_SPELLS = new Set(["sleep", "hypnotic pattern"]);
const PRONE = "prone";

const wakes = (instance: ConditionMeta) => Boolean(instance.spell && WAKING_SPELLS.has(textKey(instance.spell)));

// The spells of the two a creature could be shaken out of, as laid.
export function wakeableSpells(conditions: readonly string[], meta: ConditionMetaMap | undefined): string[] {
  const spells = conditions.flatMap((name) => instancesOf(meta?.[name]).filter(wakes).map((instance) => instance.spell as string));
  return [...new Set(spells)];
}

// The conditions once shaken awake: every instance those spells laid goes,
// with the speed hold and the incapacitation beside the charm; another
// source's hold of the same condition stays. A fall's prone stays too: a
// woken sleeper still lies where it fell, and standing costs half its speed.
export function shakenAwake(
  conditions: readonly string[],
  meta: ConditionMetaMap | undefined,
): { conditions: string[]; meta: ConditionMetaMap; ended: string[] } {
  const nextMeta: ConditionMetaMap = { ...(meta ?? {}) };
  const ended: string[] = [];
  const kept = conditions.filter((name) => {
    if (textKey(name) === PRONE) {
      return true;
    }
    const all = instancesOf(meta?.[name]);
    const left = all.filter((instance) => !wakes(instance));
    if (left.length === all.length) {
      return true;
    }
    if (!left.length) {
      delete nextMeta[name];
      ended.push(name);
      return false;
    }
    nextMeta[name] = packInstances(left) as ConditionMeta;
    return true;
  });
  return { conditions: kept, meta: nextMeta, ended };
}
