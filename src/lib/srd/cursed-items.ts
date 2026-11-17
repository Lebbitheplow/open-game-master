// SRD 5.1's cursed magic items (Berserker Axe, Armor of Vulnerability, Demon
// Armor, Shield of Missile Attraction; magic-gear.ts GearDef.cursed): attuning
// curses the bearer, and the curse holds until remove curse or similar magic
// breaks the attunement. Berserker Axe: "As long as you remain cursed, you are
// unwilling to part with the axe". Remove Curse: "If the object is a cursed
// magic item, its curse remains, but the spell breaks its owner's attunement
// to the object so it can be removed or discarded."
//
// The sheet's attune switch refused to end the attunement (usage-rules.ts),
// but every door that takes a row out of a pack ended it with the row: the
// axe handed to a friend, dropped, sold or traded came away unattuned, and
// Remove Curse broke nothing, so the switch's refusal never lifted.
import { gearDefOfRow } from "@/lib/srd/magic-gear";
import type { RowItem } from "@/lib/srd/item-row";

type Held = RowItem & { attuned?: boolean; gear?: unknown };

// Why this row cannot leave its bearer's pack, or null: an attuned cursed item.
export function cursedHold(bearer: { name: string }, row: Held | undefined): string | null {
  if (!row?.attuned || !gearDefOfRow(row)?.cursed) {
    return null;
  }
  return `${row.name} is cursed, and ${bearer.name}, attuned to it, will not part with it until remove curse (or greater restoration) breaks the attunement. Nothing changed.`;
}

// The pack with every attunement to a cursed item broken (the item stays,
// its curse with it), and the names of the items it was broken from.
export function breakCursedAttunements<T extends Held>(equipment: readonly T[]): { equipment: T[]; broken: string[] } {
  const broken: string[] = [];
  const next = equipment.map((row) => {
    if (!row.attuned || !gearDefOfRow(row)?.cursed) {
      return row;
    }
    broken.push(row.name);
    const { attuned: _attuned, ...rest } = row;
    void _attuned;
    return rest as T;
  });
  return { equipment: next, broken };
}
