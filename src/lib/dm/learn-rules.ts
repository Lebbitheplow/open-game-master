// What a spell taught in play must be (learn_spell, src/lib/dm/mutations.ts):
// a spell of one of the caster's classes, of a level that class has slots
// for, and a cantrip only while the Cantrips Known column has room. And what
// a wizard pays to copy it into the book.
//
// SRD 5.1, each class's Spellcasting feature; Wizard, "Your Spellbook":
// copying a spell of 1st level or higher takes 2 hours and 50 gp for each
// level of the spell.
//
// Pure: the sheet and the spell's facts come in as values.

import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { subclassSpellsFor } from "@/lib/srd/features";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { cantripCapOf, casterListOf, casterViewsOf, maxSpellLevelOf, spellOnCasterList, type CasterView } from "@/lib/srd/spell-prep";
import { spellListLabel } from "@/lib/classes/class-spell-list";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

type Learner = Pick<CharacterSheet, "name" | "class" | "level" | "subclass" | "classes" | "abilities" | "spellcasting"> & { features?: CharacterSheet["features"] };

// The caster views whose class list carries the spell: the one answer the
// server's check and the builder give (spell-prep.ts spellOnCasterList), so
// the GM teaches nothing a save would refuse, or the subclass's own
// always-prepared spells. A third caster's list is its profile's: an
// Eldritch Knight learns a wizard spell, which "fighter" was never on.
//
// Issue #833: a homebrew spell that named no class used to be learnable by
// any caster, and the class names were compared in two spellings (a
// workshop class's "homebrew-1f0c..." against the key "homebrew 1f0c ..."),
// so a spell tagged with a workshop class was refused to it.
export function viewsWithSpell(sheet: Learner, facts: SpellFacts, extras?: SubclassExtras): CasterView[] {
  return casterViewsOf(sheet, extras).filter(
    (view) =>
      spellOnCasterList(view, facts) ||
      subclassSpellsFor(view.classId, view.subclass, view.level, extras, view.features).some((name) => textKey(name) === textKey(facts.name)),
  );
}

export function learnProblem(sheet: Learner, spell: string, facts: SpellFacts | null, extras?: SubclassExtras): ToolError | null {
  if (!facts) {
    return { error: `"${spell}" is not a spell this table knows (published, or written by whoever runs the table), so it cannot be learned. Check the name.`, retry: true };
  }
  const views = viewsWithSpell(sheet, facts, extras);
  if (!views.length) {
    const classes = casterViewsOf(sheet).map((view) => spellListLabel(casterListOf(view))).join(" or ") || sheet.class;
    return { error: `${facts.name} is not on the ${classes} spell list, so ${sheet.name} cannot learn it.`, refused: "rules" };
  }
  if (facts.level === 0) {
    const room = views.some((view) => {
      const cap = cantripCapOf(view);
      return cap !== null && view.cantrips.length < cap;
    });
    if (!room) {
      return { error: `${sheet.name} already knows as many cantrips as their class allows at this level; ${facts.name} cannot be added until the Cantrips Known column grows.`, refused: "rules" };
    }
    return null;
  }
  const top = Math.max(0, ...views.map((view) => maxSpellLevelOf(view)));
  if (facts.level > top) {
    return { error: `${facts.name} is a level ${facts.level} spell and ${sheet.name} has slots up to level ${top}; it can be learned once they can cast spells of that level.`, refused: "rules" };
  }
  return null;
}

// What copying a spell into the spellbook costs: gold and hours.
export function copyCost(facts: SpellFacts): { gold: number; hours: number } {
  return { gold: 50 * facts.level, hours: 2 * facts.level };
}
