// What a spell scroll holds and who can read it: the pure half of the rules in
// src/lib/dm/consumables.ts, so a scroll's card greys in the browser with the
// words use_item refuses with (src/lib/battlemap/hand-items.ts).
//
// SRD 5.1, Spell Scroll: a spell on your class's list can be read; one of a
// higher level than you can cast needs an ability check with your spellcasting
// ability, DC 10 + the spell's level, and a failure wastes the scroll; a spell
// off your list is unintelligible.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { checklistSpell } from "@/lib/srd/spell-lists";

type ScrollRow = { identified?: boolean; spell?: string };

// The spell a scroll holds: the one the tool that gave it named, never a
// spell read in its name.
export function scrollSpell(item: ScrollRow): string | null {
  return item.identified === false ? null : (item.spell ?? null);
}

// SRD 5.1 Spell Scroll table: the save DC and attack bonus by spell level.
export function scrollNumbers(level: number): { saveDc: number; attackBonus: number } {
  if (level <= 2) return { saveDc: 13, attackBonus: 5 };
  if (level <= 4) return { saveDc: 15, attackBonus: 7 };
  if (level <= 6) return { saveDc: 17, attackBonus: 9 };
  if (level <= 8) return { saveDc: 18, attackBonus: 10 };
  return { saveDc: 19, attackBonus: 11 };
}

function classSlugs(sheet: CharacterSheet): string[] {
  const ids = sheet.classes?.length ? sheet.classes.map((entry) => entry.id) : [sheet.class];
  return ids.map((id) => id.trim().toLowerCase());
}

// The highest spell level this character can cast with a slot.
export function highestSlotLevel(sheet: CharacterSheet): number {
  const slots = sheet.spellcasting?.slots ?? {};
  const fromSlots = Object.entries(slots)
    .filter(([, slot]) => slot.max > 0)
    .map(([level]) => Number(level));
  const pact = (sheet.spellcasting as { pact?: { level?: number } } | null)?.pact?.level ?? 0;
  return Math.max(0, pact, ...fromSlots);
}

// Why this reader cannot read this scroll at all, or null.
export function scrollUnreadable(sheet: CharacterSheet, item: ScrollRow): string | null {
  const spell = scrollSpell(item);
  const known = spell ? checklistSpell(spell) : null;
  if (!known || (sheet.spellcasting && known.classes.some((slug) => classSlugs(sheet).includes(slug)))) {
    return null;
  }
  return `${known.name} is not on ${sheet.name}'s class spell list, so the scroll is unintelligible to them; it stays in the pack for someone who can read it.`;
}

// The check the reading waits on, or null: the DC, for a spell above what they
// can cast.
export function scrollCheckDc(sheet: CharacterSheet, item: ScrollRow): number | null {
  const spell = scrollSpell(item);
  const known = spell ? checklistSpell(spell) : null;
  return known && sheet.spellcasting && known.level > highestSlotLevel(sheet) ? 10 + known.level : null;
}
