// Which of a sheet's items carry no stats at this table: none from a catalog
// row (slug, srdName), none from a workshop entry (gear), and a name the
// table's rules do not know. An unidentified item is left out: its name is
// what the party sees, not what it is. Each name once, in the sheet's order.
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

export function itemsWithoutStats(equipment: readonly EquipmentItem[], known: (name: string) => boolean): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of equipment) {
    if (item.slug || item.srdName || item.gear || item.identified === false) continue;
    const key = textKey(item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!known(item.name)) names.push(item.name);
  }
  return names;
}
