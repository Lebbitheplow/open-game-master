// A wizard's spellbook as the Order of Scribes' features read it: which spells
// are in it, and the spells One with the Word takes out of it for a while.
//
// One with the Word (Order of Scribes 14): "then roll 3d6, and spells in your
// book with a combined level at least that total vanish from it until you
// finish 1d6 long rests (if there aren't enough, you drop to 0 hit points)."
//
// The book is every leveled spell the wizard holds: written in the spellbook,
// prepared, waiting to be prepared, or (a sheet that keeps no spellbook list)
// known. A vanished spell leaves all of those lists, so no tool casts or
// prepares it, and is kept on the sheet (spellcasting.vanished) with the lists
// it left and the long rests still to pass; each long rest counts one off and
// the last writes the spell back where it was. The record is part of the
// sheet, so "Revert this turn" takes it back with the sheet.
//
// Which spells go is the wizard's choice in the source. Here the call may name
// them (they go first, in the order named); beyond those the server takes
// spells that are not prepared before spells that are, in the book's order,
// and lets go of any it took beyond what the total needs.
//
// Pure. Read by src/lib/dm/ar-ws-word.ts (the reaction's price), the long rest
// (src/lib/dm/rest-logic.ts longRestPatch), Master Scrivener's scroll
// (src/lib/dm/ar-ws-scrivener.ts) and Awakened Spellbook's damage type
// (src/lib/dm/ar-ws-awakened.ts).

import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Casting = NonNullable<CharacterSheet["spellcasting"]>;
type Lists = { prepared?: string[]; known?: string[]; spellbook?: string[]; pending?: string[] };

export const BOOK_LISTS = ["spellbook", "prepared", "pending", "known"] as const;
export type BookList = (typeof BOOK_LISTS)[number];
export type VanishedSpell = { spell: string; from: BookList[]; rests: number };
export type BookEntry = { spell: string; from: BookList[] };

const WIZARD = textKey("wizard");

// The lists the wizard's own spells are in: a multiclass sheet keeps them on
// the wizard's caster entry, a single-class sheet at the top.
function wizardEntry(casting: Casting): Lists {
  return casting.casters?.find((caster) => textKey(caster.classId) === WIZARD) ?? casting;
}

// Every leveled spell in the book, once each, with the lists that hold it.
export function bookEntries(casting: Casting | null | undefined): BookEntry[] {
  if (!casting) {
    return [];
  }
  const own = wizardEntry(casting);
  const out = new Map<string, BookEntry>();
  for (const list of BOOK_LISTS) {
    for (const spell of own[list] ?? []) {
      const key = textKey(spell);
      const entry = out.get(key) ?? { spell, from: [] };
      entry.from.push(list);
      out.set(key, entry);
    }
  }
  return [...out.values()];
}

export function inBook(casting: Casting | null | undefined, spell: string): boolean {
  const key = textKey(spell);
  return bookEntries(casting).some((entry) => textKey(entry.spell) === key);
}

// The spells that pay a total of spell levels, or null when the whole book
// holds fewer levels than that. `named` go first; `levelOf` answers null for
// a spell nobody knows the level of, which then pays nothing and stays.
export function spellsToVanish(
  entries: BookEntry[],
  total: number,
  levelOf: (spell: string) => number | null,
  named: string[] = [],
): Array<BookEntry & { level: number }> | null {
  const leveled = entries
    .map((entry) => ({ ...entry, level: levelOf(entry.spell) ?? 0 }))
    .filter((entry) => entry.level >= 1);
  if (leveled.reduce((sum, entry) => sum + entry.level, 0) < total) {
    return null;
  }
  const wanted = named.map((name) => textKey(name));
  const rank = (entry: BookEntry) => {
    const asked = wanted.indexOf(textKey(entry.spell));
    if (asked >= 0) return asked;
    const ready = entry.from.includes("prepared") || entry.from.includes("pending");
    return wanted.length + (ready ? 1 : 0);
  };
  const order = leveled.map((entry, at) => ({ entry, at })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.at - b.at).map((row) => row.entry);
  const taken: Array<BookEntry & { level: number }> = [];
  let sum = 0;
  for (const entry of order) {
    if (sum >= total) break;
    taken.push(entry);
    sum += entry.level;
  }
  // A spell taken early that the later ones made needless is left in the
  // book, unless the wizard named it.
  for (const entry of [...taken]) {
    if (!wanted.includes(textKey(entry.spell)) && sum - entry.level >= total) {
      taken.splice(taken.indexOf(entry), 1);
      sum -= entry.level;
    }
  }
  return taken;
}

function without<T extends Lists>(lists: T, gone: Set<string>): T {
  const next = { ...lists };
  for (const list of BOOK_LISTS) {
    const held = lists[list];
    if (held) {
      next[list] = held.filter((spell) => !gone.has(textKey(spell)));
    }
  }
  return next;
}

function withBack<T extends Lists>(lists: T, back: VanishedSpell[]): T {
  const next = { ...lists };
  for (const entry of back) {
    for (const list of entry.from) {
      const held = next[list] ?? [];
      if (!held.some((spell) => textKey(spell) === textKey(entry.spell))) {
        next[list] = [...held, entry.spell];
      }
    }
  }
  return next;
}

// The casting with these spells gone from the book for `rests` long rests.
export function vanishFromBook(casting: Casting, taken: BookEntry[], rests: number): Casting {
  const gone = new Set(taken.map((entry) => textKey(entry.spell)));
  const top = without(casting, gone);
  return {
    ...top,
    ...(casting.casters?.length ? { casters: casting.casters.map((caster) => (textKey(caster.classId) === WIZARD ? without(caster, gone) : caster)) } : {}),
    vanished: [...(casting.vanished ?? []), ...taken.map((entry) => ({ spell: entry.spell, from: entry.from, rests }))],
  };
}

// A long rest finished: each vanished spell has one rest fewer to wait, and
// one with none left is written back into the lists it left.
export function restVanished<T extends Casting>(casting: T): T {
  const held = casting.vanished ?? [];
  if (!held.length) {
    return casting;
  }
  const back = held.filter((entry) => entry.rests <= 1);
  const waiting = held.filter((entry) => entry.rests > 1).map((entry) => ({ ...entry, rests: entry.rests - 1 }));
  const next = { ...withBack(casting, back) };
  if (casting.casters?.length) {
    next.casters = casting.casters.map((caster) => (textKey(caster.classId) === WIZARD ? withBack(caster, back) : caster));
  }
  if (waiting.length) {
    next.vanished = waiting;
  } else {
    delete next.vanished;
  }
  return next;
}
