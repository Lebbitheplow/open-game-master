// A condition that lasts only while the creature can see or hear its source.
// Hypnotic Gaze (School of Enchantment 2): "It ends if you move more than 5
// feet away, if it can't see or hear you, or if it takes damage." The move and
// the damage ended it (condition-leash.ts, endsOnDamage); a gazed creature
// that was then blinded and deafened stayed charmed and incapacitated.
//
// The spend that lays such a condition marks its instance endsUnsensed
// (authored-save-effect-extras.ts, for a row whose senses is "see_or_hear").
// A creature that is both blinded and deafened can neither see nor hear, the
// same reading the spend's own refusal takes of "if it can see or hear you".
// endUnsensed is applied where every write of an enemy's conditions lands
// (src/lib/db/encounters.ts patchEnemyConditions), so whatever lays the second
// of the two, by whichever tool, ends the hold.
//
// Pure.

import { instancesOf, removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

// The conditions and their meta with every endsUnsensed instance taken off,
// when the creature holding them is blinded and deafened; null when nothing
// ends.
export function endUnsensed(conditions: string[], meta: ConditionMetaMap | undefined): { conditions: string[]; meta: ConditionMetaMap } | null {
  const holds = (name: string) => conditions.some((entry) => isConditionNamed(entry, name));
  if (!meta || !holds("blinded") || !holds("deafened")) {
    return null;
  }
  let next = { conditions, meta };
  let ended = false;
  for (const name of conditions) {
    if (!instancesOf(next.meta[name]).some((entry) => entry.endsUnsensed)) {
      continue;
    }
    const removed = removeConditionInstances(next.conditions, next.meta, name, (entry) => Boolean(entry.endsUnsensed));
    if (removed.removed) {
      next = { conditions: removed.conditions, meta: removed.meta };
      ended = true;
    }
  }
  return ended ? next : null;
}
