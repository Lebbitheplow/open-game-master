// What a warlock's pact leaves on a sheet, watched where the sheet is
// written (SRD 5.1, warlock, Pact Boon):
//
//   Pact of the Blade
//   - "Your pact weapon disappears if it is more than 5 feet away from you
//     for 1 minute or more." The weapon the pact made is an equipment row
//     marked `pact: "conjured:<the warlock>"`. The day it leaves their
//     equipment by any door (dropped, thrown, handed over, taken) the minute
//     starts: the condition PACT_APART, ten rounds on the clock. The row keeps
//     its mark where it lies. Taken back in time, the minute is forgotten;
//     run out, the row is gone from the ground and from whoever holds it.
//   - "It also disappears if you use this feature again, if you dismiss the
//     weapon (no action required), or if you die." The feature's own writes
//     (mt-srd-warlock.ts) remove the row themselves and are not the weapon
//     leaving the hand (`asPactWrite`); a death removes it here.
//   - "The weapon ceases being your pact weapon if you die": a magic weapon
//     bonded by the ritual (`pact: "bonded"`, or "stowed" while it is in the
//     extradimensional space) loses the mark, and one that was stowed is
//     back among what the body carries, out of the hand.
//
//   Pact of the Tome
//   - "The book turns to ash when you die": the Book of Shadows row is gone.
//
// settlePact is pure and runs inside patchSheet (src/lib/db/sheets.ts), as
// the other watches there do; vanishStrays reaches the ground and the other
// sheets, after the write.

import { listDroppedItems, takeFromDroppedItem } from "@/lib/db/dropped-items";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { EquipmentItem } from "@/lib/schemas/sheet";

export const PACT_APART = "pact weapon apart";
export const BOOK_OF_SHADOWS = "Book of Shadows";
// "for 1 minute or more"
const MINUTE_ROUNDS = 10;

export const conjuredMark = (ownerId: string) => `conjured:${ownerId}`;
const isConjured = (item: Pick<EquipmentItem, "pact">) => (item.pact ?? "").startsWith("conjured:");
export const isBookOfShadows = (item: Pick<EquipmentItem, "name">) => textKey(item.name) === textKey(BOOK_OF_SHADOWS);
// The book a ceremony gave this warlock, wherever it lies.
export const tomeMark = (ownerId: string) => `tome:${ownerId}`;

let ownWrites = 0;
// A write the feature makes itself: its rows come and go by its own rules.
export function asPactWrite<T>(write: () => T): T {
  ownWrites += 1;
  try {
    return write();
  } finally {
    ownWrites -= 1;
  }
}

type Watched = {
  equipment: EquipmentItem[];
  conditions: string[];
  conditionMeta: unknown;
  deathSaves?: { dead?: boolean } | null;
};

const apart = (sheet: Pick<Watched, "conditions">) => sheet.conditions.some((entry) => textKey(entry) === PACT_APART);

function withoutApart(next: Watched) {
  next.conditions = next.conditions.filter((entry) => textKey(entry) !== PACT_APART);
  const meta = { ...(next.conditionMeta as Record<string, unknown>) };
  for (const key of Object.keys(meta)) {
    if (textKey(key) === PACT_APART) {
      delete meta[key];
    }
  }
  next.conditionMeta = meta;
}

// The sheet as it is about to be stored, settled in place. True when the
// warlock's conjured weapon must now vanish wherever it lies (vanishStrays).
export function settlePact(ownerId: string, existing: Watched, next: Watched): boolean {
  const marked = (sheet: Watched) => sheet.equipment.some((item) => item.pact);
  const waiting = apart(existing) || apart(next);
  const died = !existing.deathSaves?.dead && Boolean(next.deathSaves?.dead);
  if (!waiting && !marked(existing) && !marked(next) && !(died && next.equipment.some(isBookOfShadows))) {
    return false;
  }
  const mark = conjuredMark(ownerId);
  const mine = (sheet: Watched) => sheet.equipment.find((item) => item.pact === mark);
  if (died) {
    next.equipment = next.equipment
      .filter((item) => !isConjured(item) && !isBookOfShadows(item))
      .map((item) => {
        if (!item.pact) {
          return item;
        }
        const { pact, ...plain } = item;
        return pact === "stowed" ? { ...plain, equipped: false } : pact === "bonded" ? plain : item;
      });
    withoutApart(next);
    return true;
  }
  const held = mine(next);
  if (held && apart(next)) {
    // Back in hand within the minute.
    withoutApart(next);
    return false;
  }
  const lost = mine(existing);
  if (lost && !held && !ownWrites && !apart(next)) {
    next.conditions = [...next.conditions, PACT_APART];
    next.conditionMeta = { ...(next.conditionMeta as Record<string, unknown>), [PACT_APART]: { rounds: MINUTE_ROUNDS, holds: lost.name.slice(0, 80) } };
    return false;
  }
  // The minute ran out with the weapon still away.
  return apart(existing) && !apart(next) && !held && !ownWrites;
}

// The warlock's conjured weapon, gone from the ground and from every other
// sheet. What vanished, for the caller's line.
export function vanishStrays(campaignId: string, ownerId: string): string[] {
  const mark = conjuredMark(ownerId);
  const gone: string[] = [];
  for (const dropped of listDroppedItems(campaignId)) {
    if ((dropped.item as EquipmentItem).pact === mark) {
      takeFromDroppedItem(dropped.id, dropped.item.qty ?? 1);
      gone.push(dropped.item.name);
    }
  }
  for (const sheet of listSheets(campaignId)) {
    if (sheet.id === ownerId || !sheet.equipment.some((item) => item.pact === mark)) {
      continue;
    }
    gone.push(...sheet.equipment.filter((item) => item.pact === mark).map((item) => item.name));
    const updated = asPactWrite(() => patchSheet(sheet.id, { equipment: sheet.equipment.filter((item) => item.pact !== mark) }));
    if (updated) {
      publishPersisted(campaignId, "sheet_updated", { sheet: updated });
    }
  }
  return gone;
}
