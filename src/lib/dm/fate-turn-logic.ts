// Two reactions that decide another creature's roll once it is seen and before
// anything comes of it. Pure: what each offers on a roll and what it does to
// the dice. The paying and the reach are src/lib/dm/fate-turn.ts.
//
// Convergent Future (Chronurgy Magic 14): "When you or a creature you can see
// within 60 feet of you makes an attack roll, an ability check, or a saving
// throw, you can use your reaction to ignore the die roll and decide whether
// the number rolled is the minimum needed to succeed or one less than that
// number (your choice). When you do so, you gain one level of exhaustion."
//
// Bend Luck (Wild Magic 6): "When another creature you can see makes an attack
// roll, an ability check, or a saving throw, you can use your reaction and
// spend 2 sorcery points to roll 1d4 and apply the number rolled as a bonus or
// penalty (your choice) to the creature's roll. You can do so after the
// creature rolls but before any effects of the roll occur."
//
// Both were one door before: a hit on the holder or an ally turned into a miss
// (authored-reactions.ts force_miss, attack_penalty). The other cases are a
// friend's roll that fails (the after-the-roll card, after-roll.ts) and a roll
// the server throws inside a call (the watch stop, foresight.ts).

import type { RollResult } from "@/lib/dice";
import type { AfterRollOption } from "@/lib/dm/after-roll-logic";
import { rowWords } from "@/lib/dm/after-roll-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

export type FatePower = "convergent_future" | "bend_luck";
export const FATE_NAMES: Record<FatePower, string> = { convergent_future: "Convergent Future", bend_luck: "Bend Luck" };
export const CONVERGENT_RANGE_FEET = 60;
export const BEND_LUCK_POINTS = 2;
export const BEND_LUCK_SIDES = 4;
const SORCERY_POINTS = "sorcery_points";

export const isFatePower = (id: string): id is FatePower => id === "convergent_future" || id === "bend_luck";

// A roll with the number it must reach: a check or save against a Difficulty
// Class, or an attack against an Armor Class.
export type JudgedRoll = { kind: string; outcome: RollResult; dc: number | null } | { kind: "attack"; outcome: RollResult; ac: number; critRange: number };

export const fateTarget = (roll: JudgedRoll): number | null => ("ac" in roll ? roll.ac : roll.dc);

// Whether the roll succeeds as it stands; null when nothing says (no DC).
export function fateSucceeds(roll: JudgedRoll): boolean | null {
  const natural = roll.outcome.natural;
  if ("ac" in roll) {
    return natural !== 1 && ((natural !== undefined && natural >= roll.critRange) || roll.outcome.total >= roll.ac);
  }
  return roll.dc === null ? null : roll.outcome.total >= roll.dc;
}

// Whether the character holds the feature with what it costs in hand: the
// sorcery points for Bend Luck; Convergent Future costs a level of exhaustion,
// which is always theirs to take.
export function holdsFate(sheet: CharacterSheet, power: FatePower): boolean {
  if (power === "convergent_future") {
    return holdsFeature(sheet, "convergent future");
  }
  const points = sheet.resources?.[SORCERY_POINTS];
  return holdsFeature(sheet, "bend luck") && Boolean(points) && points!.max - points!.used >= BEND_LUCK_POINTS;
}

// What the holder is offered on a roll that fails as it stands. `own`: the
// roller's own roll, which Convergent Future answers ("you or a creature") and
// Bend Luck does not ("another creature"). A roll with no number to reach is
// not offered: there is no "minimum needed to succeed", and a d4 on it would
// be spent blind.
export function fateOption(holder: CharacterSheet, power: FatePower, roll: JudgedRoll, rollerName: string, own: boolean): AfterRollOption | null {
  const target = fateTarget(roll);
  if (target === null || fateSucceeds(roll) !== false || !holdsFate(holder, power) || (own && power === "bend_luck")) {
    return null;
  }
  // The words are the row's (after-roll-table.ts): {what} is "save",
  // "check" or "attack roll", {name} whose roll.
  const words = { kind: "ac" in roll ? "attack" : roll.kind, name: rollerName, other: !own };
  if (power === "convergent_future") {
    return { id: "convergent_future", ...(own ? {} : { by: holder.id }), ...rowWords("convergent_future", words) };
  }
  // A natural 1 on an attack misses whatever is added, and a d4 reaches 4.
  if (("ac" in roll && roll.outcome.natural === 1) || roll.outcome.total + BEND_LUCK_SIDES < target) {
    return null;
  }
  return { id: "bend_luck", by: holder.id, ...rowWords("bend_luck", words) };
}

// The roll with its die ignored: the lowest number that succeeds against
// `target`, or one less. The d20 is written as the face that gives that total
// where one does (never a natural 1 or 20, which would carry rules of their
// own), and the rest as a modifier.
export function withDictatedRoll(outcome: RollResult, target: number, succeed: boolean): RollResult {
  const want = succeed ? target : target - 1;
  const lead = outcome.terms[0];
  const rest = { ...outcome };
  delete rest.crit;
  if (!lead || lead.kind !== "dice" || lead.sides !== 20) {
    return { ...rest, total: want };
  }
  const face = Math.min(19, Math.max(2, want - (outcome.total - lead.subtotal)));
  const kept = lead.dice.findIndex((die) => die.kept !== false);
  const dice = lead.dice.map((die, at) => ({ ...die, value: at === Math.max(0, kept) ? face : die.value, kept: at === Math.max(0, kept) }));
  const total = outcome.total - lead.subtotal + face;
  const terms = [{ ...lead, dice, subtotal: face }, ...outcome.terms.slice(1)];
  return total === want
    ? { ...rest, total, natural: face, terms }
    : { ...rest, total: want, natural: face, terms: [...terms, { kind: "modifier" as const, sign: (want > total ? 1 : -1) as 1 | -1, value: Math.abs(want - total) }] };
}

// The roll with Bend Luck's d4 on it, as a bonus or a penalty.
export function withBentLuck(outcome: RollResult, value: number, add: boolean): RollResult {
  const sign = add ? 1 : -1;
  return {
    ...outcome,
    expression: `${outcome.expression}${add ? "+" : "-"}1d${BEND_LUCK_SIDES}`,
    total: outcome.total + sign * value,
    terms: [...outcome.terms, { kind: "dice", sign, count: 1, sides: BEND_LUCK_SIDES, dice: [{ sides: BEND_LUCK_SIDES, value, kept: true }], subtotal: value }],
  };
}

// The line the model reads when one of them changed a roll.
export function fateLine(power: FatePower, helper: string, roller: string, what: string, before: number, after: number, target: number): string {
  const verdict = after >= target ? "it succeeds" : "it fails";
  return power === "convergent_future"
    ? `${helper} used Convergent Future: the die is ignored, ${roller}'s ${what} is ${after} against ${target}, and ${verdict}.`
    : `${helper} used Bend Luck: ${roller}'s ${what} went from ${before} to ${after} against ${target}, and ${verdict}.`;
}
