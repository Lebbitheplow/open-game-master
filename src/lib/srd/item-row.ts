// Which row an inventory item is, as every engine looks it up: the SRD or
// pack row the DM named it by (srdName, #408) when its own name is in the
// table's language ("Mantello di protezione" is the Cloak of Protection),
// else its own name without the bonus it declares, since no row is named
// with one ("Arrows +1" are arrows). A pack item is also known by its slug,
// which the finders that index slugs read first.
//
// The finders that serve inventory items (matchWeapon, matchArmor,
// matchMagicItem, gearDefFor, checkRidersOf) take the item rather than a
// string, so none can be handed the name the player sees instead of this
// one. A "+1" stays in the item's own name, where magicItemBonus reads it;
// srdName never carries one (src/lib/dm/item-logic.ts srdNameFor).
//
// Imports only text-logic, by a relative path, so the armor and magic-gear
// tables, the sheet and the scripts that load the item math without the
// path alias read it without a cycle.
import { textKey } from "../language/text-logic.ts";

export type RowItem = { name: string; slug?: string | null; srdName?: string };

// A name without its trailing size or note: "Rope, hempen (50 feet)" is
// "Rope, hempen", "Rations (1 day)" "Rations". A tool sends a row's name
// that way (live), and the name picks the row out when it is the only one
// so written.
export function baseName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "");
}

export function rowName(item: RowItem): string {
  return item.srdName ?? withoutBonus(item.name);
}

// Whether the line is a workshop entry's: its slug names the entry
// ("homebrew:<id>", how src/lib/db/homebrew.ts hydrateHomebrewGear finds it),
// so its mechanics are the snapshot it carries in `gear` and never a
// published row it shares a name with. A GM's own "Prayer Mat", made before
// the pack's item of that name came into the magic item table, stays the
// GM's rug rather than turning into an item that asks for attunement.
export function isWorkshopRow(item: RowItem): boolean {
  return Boolean(item.slug?.startsWith("homebrew:"));
}

// The bonus a magic item's name declares: "+1 Longsword", "Plate +2",
// "Shield, +3". Shared with the weapon engine (attack-logic.ts) because
// both sides read the same naming convention off the same equipment list.
export function magicItemBonus(name: string): number {
  const match = /(?:^|[\s,(])\+([123])(?![0-9])/.exec(name);
  return match ? Number(match[1]) : 0;
}

// A name without the one bonus it declares, in front or behind: "+1
// Longsword" and "Longsword, +1" are a Longsword. A name listing several
// ("Weapon, +1, +2, or +3") is a family's own row and stays whole, as does a
// bonus inside a note ("Rations (+1 day)").
export function withoutBonus(name: string): string {
  if ((name.match(/\+[123](?![0-9])/g) ?? []).length !== 1) {
    return name;
  }
  return name.replace(/(?:^|,?\s+)\+[123](?![0-9])\s*/, " ").trim();
}

// The item's srdName with the bonus its own name declares ("Spada lunga +1"
// is a "Longsword +1"), else its own name: the name the item lists would
// give it. A name a tool is sent is in that convention, so a carried item
// answers to it, and the pack prices by it.
export function srdNameWithBonus(item: RowItem): string {
  const bonus = item.srdName ? magicItemBonus(item.name) : 0;
  return bonus ? `${item.srdName} +${bonus}` : (item.srdName ?? item.name);
}

// The lines a tool's item name picks out, by the first of its names that
// any line answers to: its very own name, which names one line on the
// sheet, else its srdNameWithBonus, else its row, else its row without
// its trailing size (baseName), when one row is so written. A starting-kit
// "Longsword" is the one "Longsword" takes beside the "Spada lunga" the DM
// granted later, and with only a "Longsword +1" carried, "Longsword" is
// that one. A word of a name picks out nothing.
function namedLines<T extends RowItem>(items: readonly T[], name: string): { tier: number; lines: T[] } {
  const wanted = textKey(name);
  if (wanted) {
    for (const [tier, nameOf] of [(item: RowItem) => item.name, srdNameWithBonus, rowName, (item: RowItem) => baseName(rowName(item))].entries()) {
      const lines = items.filter((item) => textKey(nameOf(item)) === wanted);
      if (lines.length) {
        return { tier, lines };
      }
    }
  }
  return { tier: 0, lines: [] };
}

export function linesNamed<T extends RowItem>(items: readonly T[], name: string): T[] {
  return namedLines(items, name).lines;
}

// The one line linesNamed picks out, as an index, or -1. A row two lines of
// their own names answer to (a "Spada lunga" and a silvered "Spada
// d'argento", both longswords) picks out none: the tool names the one it
// means.
export function lineNamed(items: readonly RowItem[], name: string): number {
  const { tier, lines } = namedLines(items, name);
  if (!lines.length || (tier > 0 && new Set(lines.map((line) => textKey(line.name))).size > 1)) {
    return -1;
  }
  return items.indexOf(lines[0]);
}
