// Spells that end when their creature puts armor on. SRD 5.1, Mage Armor:
// "The spell ends if the target dons armor or if you dismiss the spell as an
// action." The armor took over the AC while it was worn, but the spell stayed
// on the sheet, so taking the armor off again brought Mage Armor back.
// Read by the sheet's own patch (src/lib/db/sheets.ts), the one door every
// equip goes through: handle_item, the sheet, a purchase, a level-up kit.
// Pure: no database.

import { armorOfRow, isWorn, type WornItem } from "@/lib/srd/armor";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

const ENDS_ON_ARMOR = ["mage armor"];

// Whether the pack holds a suit of armor (not a shield) that is worn.
export function wearsSuit(equipment: WornItem[]): boolean {
  return equipment.some((item) => isWorn(item, equipment) && (armorOfRow(item)?.armor.category ?? "shield") !== "shield");
}

// The conditions with what donning armor ended taken off, or null when the
// patch put on no armor or nothing ends with it.
export function endedByDonning(
  before: { equipment: WornItem[] },
  after: { equipment: WornItem[]; conditions: string[]; conditionMeta: ConditionMetaMap },
): { conditions: string[]; conditionMeta: ConditionMetaMap } | null {
  const ending = after.conditions.filter((name) => ENDS_ON_ARMOR.some((spell) => isConditionNamed(name, spell)));
  if (!ending.length || wearsSuit(before.equipment) || !wearsSuit(after.equipment)) {
    return null;
  }
  const cleared = removeConditions(after.conditions, after.conditionMeta, ending);
  return { conditions: cleared.conditions, conditionMeta: cleared.meta };
}

// Whether a spell that ends when armor goes on cannot be laid on a creature
// already wearing it. SRD 5.1, Mage Armor: "You touch a willing creature who
// isn't wearing armor": cast on the fighter in chain mail, the slot was spent
// and nothing happened (cast-buff.ts refuses it unspent).
export function armorBarsBuff(condition: string, equipment: WornItem[]): boolean {
  return ENDS_ON_ARMOR.some((spell) => isConditionNamed(condition, spell)) && wearsSuit(equipment);
}
