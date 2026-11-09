// Why a character cannot use a magic item as they stand, in the words use_item
// refuses with and its card greys with (src/lib/dm/item-use.ts,
// src/lib/battlemap/hand-items.ts).
//
// SRD 5.1, Magic Items, Attunement: an item that asks for it works only for
// someone attuned to it. Wearing and Wielding Items: "a magic item meant to be
// worn must be donned in the intended fashion", and the swords say "while you
// are holding". A wand or a staff is said to be held too, but a sheet tracks
// neither (only weapons and shields take a hand, src/lib/dm/gear-hands.ts), so
// asking would refuse a wand no card could draw.
//
// Pure, so the Hand can ask it in the browser.
import { gearKindOf, inHand } from "@/lib/dm/gear-hands";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { gearDefOfRow } from "@/lib/srd/magic-gear";
import { textKey } from "@/lib/language/text-logic";
import { rowName } from "@/lib/srd/item-row";
import { attunementProblem } from "@/lib/srd/magic-items";

// A weapon whose power its text grants to whoever carries it, not holds it:
// "While you carry it, you can use an action and expend 1 charge to cast
// dominate beast" (Trident of Fish Command). Asking for it in hand refused a
// trident strapped to a back the SRD lets cast.
const WORKS_CARRIED = textKey("Trident of Fish Command");

export function itemBarrier(sheet: CharacterSheet, item: EquipmentItem): string | null {
  if (gearDefOfRow(item)?.requiresAttunement && !item.attuned) {
    // One their class keeps them from is no matter of a short rest: with no
    // other row to count, this answers only that (attunementProblem).
    const barred = attunementProblem(item, [], sheet);
    return `${barred ?? `${item.name} works only for someone attuned to it, and ${sheet.name} is not; attuning takes a short rest with the item.`} Nothing was spent.`;
  }
  const kind = gearKindOf(item);
  if (kind === "carried" || inHand(item, sheet.equipment) || (kind === "weapon" && textKey(rowName(item)) === WORKS_CARRIED)) {
    return null;
  }
  return kind === "weapon"
    ? `${item.name} works only while it is held, and ${sheet.name} has it put away; drawing it is the turn's object interaction. Nothing was spent.`
    : `${item.name} works only while it is worn, and ${sheet.name} is not wearing it. Nothing was spent.`;
}
