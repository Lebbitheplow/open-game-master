// The instances of a condition an affliction laid, read apart from the same
// condition another effect laid (SRD 5.1, Conditions: "If multiple effects
// impose the same condition on a creature, each instance of the condition
// has its own duration"). afflictCondition writes the affliction's name as
// each instance's source; dropConditions (afflictions.ts) takes only those.
//
// Pure: no database.

import { instancesOf, removeConditionInstances, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The conditions with this source's instances of `names` gone. A condition
// written with no instance record goes whole, as before.
export function withoutSourceOf(sheet: CharacterSheet, names: string[], source: string): { conditions: string[]; meta: ConditionMetaMap } {
  let conditions = sheet.conditions;
  let meta = sheet.conditionMeta as ConditionMetaMap;
  const own = source.slice(0, 80);
  for (const name of names) {
    const held = conditions.find((entry) => isConditionNamed(entry, name));
    if (!held) {
      continue;
    }
    if (!instancesOf(meta?.[held]).length) {
      ({ conditions, meta } = removeConditions(conditions, meta, [held]));
      continue;
    }
    ({ conditions, meta } = removeConditionInstances(conditions, meta, held, (instance) => instance.source === own));
  }
  return { conditions, meta };
}
