// The damage type a workshop subclass's choice hands its character (issue
// #833): a "Bloodline" whose Storm option deals lightning. The pick is kept
// as "Bloodline (Storm)" (src/lib/content/subclass-choices.ts), and the
// regrant writes beside it a class feature naming the type,
// "Bloodline damage type: Lightning" (src/lib/srd/subclass-choice-picks.ts),
// since the engines read features and never the workshop's tables.
//
// Elemental Affinity (its Charisma on a spell's damage, and the sorcery
// point's resistance) read only a dragon's colour, so a workshop bloodline
// that borrowed it added nothing to any spell. They now read this too
// (src/lib/srd/dragon-ancestor.ts chosenElementType).
//
// Kept apart and tiny: the check riders and the campaign page read it, and
// the workshop's own tables stay out of their bundle.

import { textKey } from "@/lib/language/text-logic";

const SUFFIX = " damage type: ";
// "<label> damage type: <type>". A label never holds a colon (the choice's
// checker refuses one), so the first colon is this one.
const FORM = /^([^:]+?) damage type:\s*([a-z]+)\s*$/i;

export function choiceDamageTypeFeatureName(label: string, damageType: string): string {
  const type = textKey(damageType);
  return `${label.trim()}${SUFFIX}${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

// The choice and the damage type a feature of that form names (the type
// lowercased), or null.
export function choiceDamageTypeOf(name: string): { label: string; type: string } | null {
  const found = FORM.exec(name.trim());
  return found ? { label: found[1].trim(), type: textKey(found[2]) } : null;
}

// The damage type a sheet's chosen option names, and its choice, or null:
// only the regrant's own "class" feature counts (a story feature of the
// same name, which a file may carry, is no element), and with `classId`
// only the one that class's subclass grants, so a multiclass's element is
// the subclass's that holds Elemental Affinity (issue #833 review).
export function chosenDamageType(
  features: ReadonlyArray<{ name: string; source?: string; classId?: string }>,
  classId?: string,
): { label: string; type: string } | null {
  for (const feature of features) {
    if (feature.source !== "class" || (classId && feature.classId && textKey(feature.classId) !== textKey(classId))) {
      continue;
    }
    const named = choiceDamageTypeOf(feature.name);
    if (named) {
      return named;
    }
  }
  return null;
}
