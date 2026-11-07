// The one answer to "is this spell on this list" (issue #833), for a list
// named the way a search names it (src/lib/classes/index.ts spellPoolKeyFor):
// a published class's list by its id ("wizard"), or a workshop class by its
// own id ("homebrew-<entry id>").
//
// A workshop class's list is three things together: the spells its author
// picked for a list of its own, or the published list it borrows; and any
// homebrew spell whose "Classes that can learn it" names the class itself.
// Before this, each reader asked its own question: the server's check held a
// borrowed list only, the GM's learn_spell let in any homebrew spell that
// named no class at all, and a search offered every homebrew spell to every
// class. Every check, search and pool now asks this one.
//
// Light on purpose (the registry and the name key only), so the campaign
// page and the builder can ask it without loading the class tables.

import { workshopClassDef } from "@/lib/classes/workshop-registry";
import { textKey } from "@/lib/language/text-logic";

export type ListedSpell = { name: string; classes: readonly string[] };

// Workshop class ids are written lowercase by workshopClassId and kept so.
const isWorkshopKey = (key: string) => key.startsWith("homebrew-");

// The workshop class a list key names, when it is one this page or server
// holds (src/lib/classes/workshop-registry.ts).
function workshopList(key: string): { custom: string[] | null; borrowed: string | null } | null {
  if (!isWorkshopKey(key)) {
    return null;
  }
  const def = workshopClassDef(key);
  if (!def) {
    return { custom: null, borrowed: null };
  }
  return def.klass.customSpells
    ? { custom: def.klass.customSpells, borrowed: null }
    : { custom: null, borrowed: def.klass.spellListFrom };
}

// Whether `spell` is on the list `key` names. `spell.classes` are the lists
// its row puts it on, in any spelling a row keeps them ("Wizard", "wizard",
// "homebrew-1f0c..."): each is compared as a name key.
export function spellOnListKey(key: string, spell: ListedSpell): boolean {
  const lists = spell.classes.map((entry) => textKey(entry));
  const wanted = textKey(key);
  if (wanted && lists.includes(wanted)) {
    return true;
  }
  const workshop = workshopList(key);
  if (!workshop) {
    return false;
  }
  if (workshop.custom) {
    const name = textKey(spell.name);
    return workshop.custom.some((entry) => textKey(entry) === name);
  }
  return Boolean(workshop.borrowed) && lists.includes(textKey(workshop.borrowed ?? ""));
}

// The spells a workshop class's own list names, or null for any other key.
export function customSpellsOf(key: string): string[] | null {
  return workshopList(key)?.custom ?? null;
}

// How a list is named in a sentence a player reads: "wizard" as it is, a
// workshop class by the list it borrows, or by its own name for a list of
// its own ("the Spellblade spell list"), never by its id.
export function spellListLabel(key: string): string {
  if (!isWorkshopKey(key)) {
    return key;
  }
  const def = workshopClassDef(key);
  if (!def) {
    return "class's";
  }
  return def.klass.customSpells ? def.klass.name : (def.klass.spellListFrom ?? def.klass.name);
}

// A caster class as a sentence names it: a workshop class by its name, not
// its id ("level 3 Spellblade", never "level 3 homebrew 1f0c...").
export function classLabelOf(classId: string): string {
  const def = isWorkshopKey(classId) ? workshopClassDef(classId) : null;
  return def ? def.klass.name : classId.replace(/[_-]+/g, " ");
}
