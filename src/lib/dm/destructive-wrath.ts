// Destructive Wrath (Tempest Domain 2): "When you roll lightning or thunder
// damage, you can use your Channel Divinity to deal maximum damage, instead of
// rolling." The cleric spends the use before the roll, from the Hand, and it is
// held on the sheet until their next lightning or thunder damage or their next
// rest. A spell attack that misses rolls no damage, so it keeps the hold.
//
// Reached by cast_at_enemy, aoe_damage, an attack's own damage and Wrath of the
// Storm. Not by a thunder rider on another type's blow (Divine Strike): spent on
// its 1d8 automatically, the hold would be gone before the thunder spell the
// cleric took it for.

import { spendRollCarriers } from "@/lib/dm/forced-save";
import { maximumOf } from "@/lib/dm/heal-spell";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";

export const DESTRUCTIVE_WRATH = "destructive wrath";

export const holdsDestructiveWrath = (sheet: CharacterSheet) => sheet.conditions.some((entry) => isConditionNamed(entry, DESTRUCTIVE_WRATH));

// Whether this character's damage of this type is dealt at its maximum.
export function wrathApplies(sheet: CharacterSheet, damageType: string | undefined): boolean {
  return isNamed(damageType ?? "", "lightning", "thunder") && holdsDestructiveWrath(sheet);
}

export function spendWrath(campaignId: string, sheetId: string) {
  spendRollCarriers(campaignId, sheetId, DESTRUCTIVE_WRATH);
}

// An attack's own dice written as their maximum: the first term, and the copy a
// critical adds of it. Dice riding under another type stay to be rolled.
const DICE = /\d*d\d+/gi;
export function withOwnDiceAtMaximum(expression: string): string {
  let own: string | undefined;
  return expression.replace(DICE, (dice) => {
    own ??= dice;
    return dice === own ? String(maximumOf(dice)) : dice;
  });
}
export const hasNoDice = (expression: string) => expression.replace(DICE, "") === expression;

export const WRATH_NOTE = "Destructive Wrath: maximum damage, with no roll";
