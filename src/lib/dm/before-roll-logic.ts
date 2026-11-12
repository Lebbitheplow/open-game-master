// The reactions used before a d20 is thrown, on Portent's path (the
// maintainer's ruling on issue #908): Cosmic Omen and Restore Balance.
//
//   Cosmic Omen (Circle of Stars 6): after each long rest the druid rolls a
//   die, and its parity is their omen until the next one: even is Weal, odd is
//   Woe. When a creature they can see within 30 feet is about to make an
//   attack roll, a saving throw or an ability check, their reaction rolls a
//   d6 and adds it to that roll (Weal) or takes it off (Woe).
//   Restore Balance (Clockwork Soul 1): when a creature within 60 feet is
//   about to roll a d20 with advantage or disadvantage, the sorcerer's
//   reaction cancels it: the roll is made with one d20.
//
// Both are chosen before the roll and applied whatever it turns out to be,
// never "if it hits": on the holder's own check or save at the hold before
// the throw (invoke-roll.ts, character-roll.ts, the before-roll route), on
// another's roll at the watch stop (foresight.ts), in a fight or, through the
// Watch toggle, out of one. Restore Balance is paid only if the roll really
// had an edge, since that is its trigger; both only if a d20 took them.
//
// Pure and client-safe: the sheet and the roll in, the choices and the dice out.

import type { RollResult } from "@/lib/dice";
import { canWaitOnRoll, keepD20 } from "@/lib/dm/after-roll-logic";
import { WATCH_ROWS, type WatchPower } from "@/lib/dm/after-roll-table";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

export const COSMIC_OMEN = "sub_cosmic_omen";
export const RESTORE_BALANCE = "sub_restore_balance";
export const OMEN_SIDES = 6;
export const OMEN_RANGE_FEET = 30;
export const BALANCE_RANGE_FEET = 60;
// The counters spent here and at the stop, never from the Hand: a card dealt
// after the roll had landed would answer it later than either feature allows
// (hand-react-triggers.ts).
export const BEFORE_ROLL_COUNTERS: readonly string[] = [COSMIC_OMEN, RESTORE_BALANCE];

export type Omen = "weal" | "woe";
export type BeforeRollPower = "cosmic_omen" | "restore_balance";
export const BEFORE_ROLL_FEATURES: Record<BeforeRollPower, string> = { cosmic_omen: "Cosmic Omen", restore_balance: "Restore Balance" };
export const BEFORE_ROLL_COUNTER: Record<BeforeRollPower, string> = { cosmic_omen: COSMIC_OMEN, restore_balance: RESTORE_BALANCE };
export const isBeforeRollPower = (power: string | null | undefined): power is BeforeRollPower => power === "cosmic_omen" || power === "restore_balance";

// What a sheet watches out of a fight with the Watch toggle on: the
// encounter id it is kept under (sheet.watchingEncounterId) when there is no
// fight. Only a before-the-roll feature is asked there (foresight.ts).
export const TABLE_WATCH = "table";

// The die rolled at the long rest decides the omen: even Weal, odd Woe.
export const omenOfFace = (face: number): Omen => (face % 2 === 0 ? "weal" : "woe");
export const OMEN_WORDS: Record<Omen, string> = { weal: "Weal", woe: "Woe" };

function usesLeft(sheet: Pick<CharacterSheet, "resources">, id: string): number {
  const state = sheet.resources?.[id];
  return state ? Math.max(0, state.max - state.used) : 0;
}

// The omen the druid can still spend: the feature, a use, and an omen read
// at the last long rest. Null when any is missing.
export function omenLeft(sheet: Pick<CharacterSheet, "resources" | "omen" | "features" | "feats">): Omen | null {
  return sheet.omen && usesLeft(sheet, COSMIC_OMEN) > 0 && holdsFeature(sheet, "cosmic omen") ? sheet.omen : null;
}

// Restore Balance with a use left.
export function balanceLeft(sheet: Pick<CharacterSheet, "resources" | "features" | "feats">): boolean {
  return usesLeft(sheet, RESTORE_BALANCE) > 0 && holdsFeature(sheet, "restore balance");
}

// A sheet the Watch toggle is shown to out of a fight: one holding a
// before-the-roll feature it can still use (Portent's number among them).
export function holdsBeforeRoll(sheet: Pick<CharacterSheet, "resources" | "omen" | "features" | "feats" | "foretold">): boolean {
  return foretoldLeft(sheet).length > 0 || omenLeft(sheet) !== null || balanceLeft(sheet);
}

// The feature a character watches with, for the Watch toggle and its route:
// a diviner's numbers first, then the before-the-roll features, then the
// watch rows in the table's order (after-roll-table.ts): a chronurgist's
// shift, an artificer's Flash of Genius, a divine soul's Favored by the Gods,
// Convergent Future, Bend Luck (foresight.ts asks in the same order).
// Slayer's Counter and the Cloud Rune have no toggle: they are asked at their
// own stops. Out of a fight only the before-the-roll ones are watched for
// (`table`).
type Watching = Pick<CharacterSheet, "resources" | "omen" | "features" | "feats" | "foretold">;
export function watchFeatureOf(sheet: Watching, table = false): WatchPower | null {
  if (foretoldLeft(sheet).length > 0) return "portent";
  if (omenLeft(sheet)) return "cosmic_omen";
  if (balanceLeft(sheet)) return "restore_balance";
  return table ? null : (WATCH_ROWS.find((row) => holdsFeature(sheet, row.feature))?.id ?? null);
}

export type BeforeRollChoice = { id: BeforeRollPower; label: string; note: string };

// The edge a roll is about to be thrown with, read from its dice: two d20s
// keeping the lowest is disadvantage, whatever gave it (a condition the
// expression already carries as well as the call's own advantage).
export function edgeOf(expression: string): "advantage" | "disadvantage" | "none" {
  const lead = /^(\d+)d20(k[hl])?/.exec(expression.replace(/\s+/g, ""));
  if (!lead || Number(lead[1]) < 2) return "none";
  return lead[2] === "kl" ? "disadvantage" : "advantage";
}

// The holder's own choices at the hold before their check or save is thrown.
// Weal alone on their own roll (Woe would only hurt it), and Restore Balance
// only on disadvantage (cancelling their own advantage helps nobody).
// `reactionFree`: their reaction is not spent this round (always so out of a
// fight). `used`: what this roll already took.
export function ownBeforeRollChoices(
  sheet: Pick<CharacterSheet, "resources" | "omen" | "features" | "feats">,
  roll: { kind: string; expression: string; reactionFree: boolean; used?: readonly string[] },
): BeforeRollChoice[] {
  if (!roll.reactionFree || !canWaitOnRoll(roll.kind) || roll.kind === "initiative") {
    return [];
  }
  const used = new Set(roll.used ?? []);
  const choices: BeforeRollChoice[] = [];
  if (!used.has("cosmic_omen") && omenLeft(sheet) === "weal") {
    choices.push({ id: "cosmic_omen", label: `Cosmic Omen (Weal): add 1d${OMEN_SIDES}`, note: `Use your reaction and a use of Cosmic Omen: 1d${OMEN_SIDES} is rolled with this roll and added to it.` });
  }
  if (!used.has("restore_balance") && edgeOf(roll.expression) === "disadvantage" && balanceLeft(sheet)) {
    choices.push({ id: "restore_balance", label: "Restore Balance: no disadvantage", note: "Use your reaction and a use of Restore Balance: this roll is made with one d20." });
  }
  return choices;
}

// What the holder may use before their own roll, in the model's words:
// "Portent", "Cosmic Omen", "Portent or Restore Balance".
export function beforeRollWords(sheet: Pick<CharacterSheet, "resources" | "foretold"> | null | undefined, choices: readonly BeforeRollChoice[]): string {
  const names = [...(sheet && foretoldLeft(sheet).length > 0 ? ["Portent"] : []), ...choices.map((choice) => BEFORE_ROLL_FEATURES[choice.id])];
  return names.join(" or ") || "Portent";
}

// The roll with its edge cancelled: the first d20 thrown is its one d20.
// Null on a roll that threw one d20, which had no edge to cancel.
export function withoutEdge(outcome: RollResult): RollResult | null {
  const lead = outcome.terms[0];
  return lead && lead.kind === "dice" && lead.sides === 20 && lead.dice.length > 1 ? keepD20(outcome, 0) : null;
}

// The roll with the omen's d6 on it: added for Weal, taken off for Woe.
export function withOmenDie(outcome: RollResult, value: number, omen: Omen): RollResult {
  const sign = omen === "weal" ? 1 : -1;
  return {
    ...outcome,
    expression: `${outcome.expression}${sign > 0 ? "+" : "-"}1d${OMEN_SIDES}`,
    total: outcome.total + sign * value,
    terms: [...outcome.terms, { kind: "dice", sign, count: 1, sides: OMEN_SIDES, dice: [{ sides: OMEN_SIDES, value, kept: true }], subtotal: value }],
  };
}

// The line the model reads when one of them changed a roll.
export function beforeRollLine(power: BeforeRollPower, holder: string, roller: string, before: number, after: number, omen?: Omen | null): string {
  if (power === "restore_balance") {
    return `${holder} used Restore Balance: ${roller}'s roll was made with one d20 (${before} became ${after}).`;
  }
  return `${holder} used Cosmic Omen (${OMEN_WORDS[omen ?? "weal"]}): ${roller}'s roll went from ${before} to ${after}.`;
}
