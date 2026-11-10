// Supernatural Defense (Monster Slayer 7): "Add 1d6 to saves and escape
// checks against effects from your Slayer's Prey target". The saves read the
// forcer in forced-save.ts (authoredSaveDieVs); this is the check side: a
// check to escape a grapple (or the restraint a grapple holds) laid by the
// creature the holder marked. rollExtrasFor (forced-save.ts) asks it, and
// resolveRollExpression (rolls.ts) adds the die to a check named against
// that condition. Before this the GM was left to add it, and an Athletics
// check against the prey's grapple rolled 1d20+3.
import { getFoe } from "@/lib/dm/sheet-foe";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { authoredSaveDieVs } from "@/lib/srd/authored-effects-more";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type EscapeDie = { dice: string; note: string; against: string[] };

const HOLDS = ["grappled", "restrained"] as const;

export function preyEscapeDie(sheet: CharacterSheet): EscapeDie | null {
  const meta = (sheet.conditionMeta ?? {}) as ConditionMetaMap;
  const against: string[] = [];
  let found: { die: string; feature: string; name: string } | null = null;
  for (const hold of HOLDS) {
    const held = sheet.conditions.find((entry) => isConditionNamed(entry, hold));
    if (!held) continue;
    for (const instance of instancesOf(meta[held])) {
      const ref = (instance as { sourceEnemyId?: string; source?: string }).sourceEnemyId ?? instance.source;
      const foe = ref ? getFoe(ref) : null;
      if (!foe) continue;
      const die = authoredSaveDieVs(sheet, sheet.id, { conditions: foe.conditions, meta: foe.conditionMeta as Record<string, { source?: string } | undefined> });
      if (die) {
        found = { ...die, name: foe.displayName };
        against.push(hold);
      }
    }
  }
  return found ? { dice: found.die, note: `${found.feature}: +${found.die} to escape ${found.name}, their Slayer's Prey`, against } : null;
}
