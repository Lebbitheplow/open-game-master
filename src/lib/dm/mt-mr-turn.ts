// What a monk's or a rogue's subclass leaves on the turn it acts in (wave 2,
// part mr): the marks the engine reads later in the same turn. Each sits in
// the turn budget's once-per-turn list, so a revert takes it back with the
// turn and a restart keeps it.
//
// Every swing goes through swingMarks and flurryStrikeRefusal
// (pc-attack-spend.ts), every Flurry of Blows bought through flurryBought
// (bonus-actions.ts), and the board's movement through turnBonusTiles
// (battlemap/view.ts): a new door for a swing or a flurry calls them too.
//
// Pure: no database, so the board's view may import it.

import { SNEAK_HIT, budgetApplies, type TurnBudget } from "@/lib/dm/action-budget";
import { gateHolds, hasCondition, heldAuthored, type AuthoredSheet, type HeldAuthored } from "@/lib/srd/authored-effects";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

// A creature a Flurry of Blows strike of this turn was aimed at, one mark a
// strike (Intoxicated Frenzy counts them and reads who they went to).
export const FLURRY_AT = "mr:flurry-at:";
// Drunken Technique's 10 feet, added to the turn's movement by the flurry.
export const DRUNKEN_FEET = "mr:drunken-technique";
// An unarmed strike made as part of the Attack action (Agile Parry).
export const UNARMED_IN_ACTION = "mr:unarmed-in-action";
// A Flurry of Blows strike that Hand of Healing took the place of.
export const FLURRY_HEALED = "mr:flurry-healed";
// The creature the turn's last unarmed hit landed on while a Flurry of Blows
// strike made it (Flurry of Healing and Harm's free Hand of Harm).
export const FLURRY_SWUNG = "mr:flurry-swung";
// A creature a Soulknife's psychic blade was swung at this turn (Rend Mind
// answers a Sneak Attack made with one).
export const BLADE_AT = "mr:psychic-blade-at:";
// Sudden Strike's second Sneak Attack of a turn.
export const SECOND_SNEAK = "sneak_attack:second";

// "You can sneak attack twice per turn as long as it is against different
// targets" (Sudden Strike): the key a second Sneak Attack claims, when the
// turn's first struck another creature. Null for anyone else.
export function secondSneakKey(sheet: AuthoredSheet, budget: TurnBudget, enemyId: string): string | null {
  if (!holdsRow(sheet, "rogue::Sudden Strike")) {
    return null;
  }
  const struck = budget.oncePerTurn.filter((mark) => mark.startsWith(SNEAK_HIT)).map((mark) => mark.slice(SNEAK_HIT.length));
  return struck.length === 1 && struck[0] !== enemyId ? SECOND_SNEAK : null;
}

// The row of the authored table a sheet holds, by its key ("monk::Drunken
// Technique"), with the level of the class that granted it.
export function holdsRow(sheet: AuthoredSheet, key: string): HeldAuthored | null {
  return heldAuthored(sheet).find((held) => held.key === key) ?? null;
}

// "Flurry of Blows also grants the benefit of Disengage and 10 feet of extra
// movement" (Drunken Technique): what buying the flurry adds to the turn.
export function flurryBought(sheet: AuthoredSheet, budget: TurnBudget): Partial<TurnBudget> {
  if (!holdsRow(sheet, "monk::Drunken Technique")) {
    return {};
  }
  return { disengaged: true, oncePerTurn: budget.oncePerTurn.includes(DRUNKEN_FEET) ? budget.oncePerTurn : [...budget.oncePerTurn, DRUNKEN_FEET] };
}

// Radiant Sun Bolt, "usable with the Attack action and extendable with ki as
// a bonus action": the 1 ki and the bonus action that buy Flurry of Blows'
// two strikes buy two more bolts, so a strike of the flurry may be a bolt
// for the monk who holds it. The part door keeps the bolt's name
// (pc-attack-parts.ts naturalAttack) and the turn counts it as one of the
// flurry's strikes (pc-attack-spend.ts), both through here.
const SUN_BOLT_NAMES = ["radiant sun bolt", "sun bolt"];
export function sunBoltStrike(sheet: AuthoredSheet, weapon: string | null | undefined): boolean {
  return SUN_BOLT_NAMES.includes(textKey(weapon ?? "")) && holdsRow(sheet, "monk::Radiant Sun Bolt") !== null;
}

// "An extra Arms attack when taking the Attack action" (Awakened Astral
// Self): one more attack in the action while the complete astral body holds.
export function awakenedArmsAttacks(sheet: AuthoredSheet): number {
  return hasCondition(sheet, "awakened astral self") ? 1 : 0;
}

// Whether the gate an authored rider's row states holds for the sheet. The
// rider itself reaches the attack through feature-effects.ts, which carries
// one condition and no gate, so a rider gated on a second one rode without it.
export function riderGateHolds(sheet: AuthoredSheet, feature: string): boolean {
  for (const held of heldAuthored(sheet)) {
    if (held.feature !== feature) continue;
    for (const effect of held.entry.effects ?? []) {
      if (effect.kind === "rider" && effect.gate && !gateHolds(effect.gate, sheet, held)) {
        return false;
      }
    }
  }
  return true;
}

// The squares a turn's marks add to its owner's movement.
export function turnBonusTiles(budget: TurnBudget | null | undefined, ownerId: string, round: number): number {
  return budget && budgetApplies(budget, ownerId, round) && budget.oncePerTurn.includes(DRUNKEN_FEET) ? 2 : 0;
}

export type SwingFacts = { unarmed: boolean; inAttackAction: boolean; flurryStrike: boolean; enemyId: string; psychicBlade?: boolean };

// The marks one swing leaves.
export function swingMarks(budget: TurnBudget, swing: SwingFacts): TurnBudget {
  const marks = [...budget.oncePerTurn];
  if (swing.flurryStrike) {
    marks.push(`${FLURRY_AT}${swing.enemyId}`);
  }
  if (swing.psychicBlade && !marks.includes(`${BLADE_AT}${swing.enemyId}`)) {
    marks.push(`${BLADE_AT}${swing.enemyId}`);
  }
  if (swing.unarmed && swing.inAttackAction && !marks.includes(UNARMED_IN_ACTION)) {
    marks.push(UNARMED_IN_ACTION);
  }
  // Which kind of strike the turn's latest unarmed one was: a flurry's, or not.
  const withoutSwung = marks.filter((mark) => mark !== FLURRY_SWUNG);
  const next = swing.unarmed && swing.flurryStrike ? [...withoutSwung, FLURRY_SWUNG] : swing.unarmed ? withoutSwung : marks;
  return next.length === budget.oncePerTurn.length && next.every((mark, at) => mark === budget.oncePerTurn[at]) ? budget : { ...budget, oncePerTurn: next };
}

// "Flurry of Blows grants up to three extra attacks, provided each one hits a
// different creature" (Intoxicated Frenzy): the flurry's own two strikes go
// where the monk likes; each strike past them is at a creature no other
// strike of this flurry was aimed at. `before` is the budget as the strike
// found it.
export function flurryStrikeRefusal(sheet: AuthoredSheet & { name?: string }, before: TurnBudget, enemyId: string): ToolError | null {
  if (!holdsRow(sheet, "monk::Intoxicated Frenzy")) {
    return null;
  }
  const aimed = before.oncePerTurn.filter((mark) => mark.startsWith(FLURRY_AT)).map((mark) => mark.slice(FLURRY_AT.length));
  if (aimed.length < 2 || !aimed.includes(enemyId)) {
    return null;
  }
  return {
    error: `Intoxicated Frenzy's extra strikes each go to a different creature, and this Flurry of Blows has already struck at that one. ${sheet.name ?? "The monk"} strikes another creature in reach, or ends the flurry. Nothing was rolled.`,
    refused: "rules",
  };
}
