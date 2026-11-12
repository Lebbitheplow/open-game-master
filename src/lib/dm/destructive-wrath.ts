// Destructive Wrath (Tempest Domain 2): "When you roll lightning or thunder
// damage, you can use your Channel Divinity to deal maximum damage, instead of
// rolling." The choice comes at the roll, before the dice, two ways:
//
// - A hit that waits on its player (after-roll-logic.ts afterAttackOptions)
//   offers it on the card, as Touch of Death is offered: the cleric sees the
//   hit and decides before the damage is rolled.
// - The rolls the server makes inside the call (a save spell, an area, Wrath
//   of the Storm, and every roll of a seat whose rolls cannot wait) have no
//   such moment, so the cleric declares it first: the Hand card or
//   use_resource spends the use and holds it on the sheet, and the next
//   lightning or thunder damage they roll takes it. A missed attack rolls no
//   damage and keeps it, and so does the end of a fight; the rest that gives
//   the use back ends it, and a reverted turn puts it back with the use.
//
// Only the lightning and thunder dice are maximized (destructive-wrath-logic.ts).

import { spendRollCarriers } from "@/lib/dm/forced-save";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { DESTRUCTIVE_WRATH, holdsDestructiveWrath, isWrathType } from "@/lib/dm/destructive-wrath-logic";

export { DESTRUCTIVE_WRATH, holdsDestructiveWrath } from "@/lib/dm/destructive-wrath-logic";

// Whether this character holds it for damage of this type.
export function wrathApplies(sheet: CharacterSheet, damageType: string | undefined): boolean {
  return isWrathType(damageType) && holdsDestructiveWrath(sheet);
}

// The hold is taken by the roll it maximized. Audited, so an undo of the turn
// gives it back.
export function spendWrath(campaignId: string, sheetId: string) {
  spendRollCarriers(campaignId, sheetId, DESTRUCTIVE_WRATH);
}

export const WRATH_NOTE = "Destructive Wrath: the lightning and thunder dice dealt at their maximum, not rolled";
