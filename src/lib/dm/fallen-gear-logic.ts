// SRD 5.1, Unconscious: "The creature drops whatever it's holding and falls
// prone." What leaves a sheet's hands as it falls, read from the in-hand
// model every sheet keeps (held-default.ts, gear-hands.ts heldRows): the
// weapons in hand and the shield on the arm. A sheet that has never said what
// it holds says nothing here, as it says nothing to the Hand.
//
// Attunement stays on the row: SRD 5.1, Attunement ends when the creature
// no longer satisfies its prerequisites, the item has been more than 100 feet
// away for 24 hours, the creature dies, or another creature attunes to it,
// never because it was let go. So the row keeps every mark but the hand's,
// and the hand-over between two characters (mutation-math.ts handedOverRow),
// which ends attunement, is not the path it takes back.
//
// Pure: no database. src/lib/dm/fallen-gear.ts lays the rows on the ground.
import { gearKindOf, handsFor, heldRows, weaponRowOf } from "@/lib/dm/gear-hands";
import type { EquipmentItem } from "@/lib/schemas/sheet";

// The row out of anyone's hand: its in-hand mark and the engine's guess at it
// gone, everything else (attunement, charges, a pact's mark) kept.
export function outOfHand(row: EquipmentItem, qty: number): EquipmentItem {
  const { equipped: _equipped, heldGuess: _guess, ...kept } = row;
  void _equipped;
  void _guess;
  return { ...kept, qty: Math.max(1, Math.floor(qty)) };
}

// How many of a held row are in hand: one, or two of a one-handed melee
// weapon held as a pair with nothing else in the hands (attack-rules.ts
// otherHandArmed reads a pair the same way).
function inHandCount(row: EquipmentItem, held: readonly EquipmentItem[]): number {
  const qty = row.qty ?? 1;
  if (qty < 2 || gearKindOf(row) !== "weapon") {
    return 1;
  }
  const pair = held.length === 1 && weaponRowOf(row)?.kind === "melee" && handsFor(row) === 1;
  return pair ? 2 : 1;
}

// The pack once the hands let go, and the rows that fell (each with the
// count that was in hand). Null when nothing was held.
export function lettingGo(equipment: readonly EquipmentItem[]): { equipment: EquipmentItem[]; fallen: EquipmentItem[] } | null {
  const held = heldRows(equipment);
  if (!held.length) {
    return null;
  }
  const fallen: EquipmentItem[] = [];
  const kept = equipment.flatMap((item) => {
    if (!held.includes(item)) {
      return [item];
    }
    const count = Math.min(item.qty ?? 1, inHandCount(item, held));
    fallen.push(outOfHand(item, count));
    const left = (item.qty ?? 1) - count;
    return left > 0 ? [{ ...outOfHand(item, left), equipped: false }] : [];
  });
  return { equipment: kept, fallen };
}

// With no square for it to lie in (no board up, the creature has no token,
// or no fight at all, where nothing is counted in turns): it leaves the hands
// all the same and is drawn again from the pack, the same free object
// interaction a pick-up costs. Null when nothing was held.
export function emptyHands(equipment: readonly EquipmentItem[]): EquipmentItem[] | null {
  const held = heldRows(equipment);
  if (!held.length) {
    return null;
  }
  return equipment.map((item) => (held.includes(item) ? { ...outOfHand(item, item.qty ?? 1), equipped: false } : item));
}

// The owner's own row back in their pack: still attuned, out of hand.
export function backInThePack(row: EquipmentItem): EquipmentItem {
  return { ...outOfHand(row, row.qty ?? 1), equipped: false };
}
