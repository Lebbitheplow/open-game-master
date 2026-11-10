// The attacks a ranger's archetype adds to the Attack action on the turn's
// own record (src/lib/dm/turn-budget.ts budgetFor reads this for every
// attack a turn allows, so pc_attack, the Hand and the pips agree):
//
//   - Dread Ambusher (Gloom Stalker 3): "on your first turn ... one extra
//     attack dealing an extra 1d8", the first round of the fight.
//   - Stalker's Flurry (Gloom Stalker 11): "Once per turn, a missed attack
//     lets you make another one."
//   - Distant Strike (Horizon Walker 11): "attack a third creature if you
//     struck two others this turn": two creatures attacked, one more attack,
//     at a third.
//
// Before this each was narrated, and the turn budget refused the attack the
// feature gives. Pure: no database.
import type { TurnBudget } from "@/lib/dm/action-budget";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Holder = Pick<CharacterSheet, "features" | "feats">;
type Turn = Pick<TurnBudget, "struck"> | null;

// The fight's first round is the ranger's first turn of it.
export const ambushRound = (sheet: Holder, round: number): boolean => round === 1 && holdsFeature(sheet, "Dread Ambusher");

const attacked = (turn: Turn): string[] => [...new Set((turn?.struck ?? []).map((swing) => textKey(swing.target)))];

function flurry(sheet: Holder, turn: Turn): boolean {
  return holdsFeature(sheet, "Stalker's Flurry") && (turn?.struck ?? []).some((swing) => !swing.hit);
}

function distant(sheet: Holder, turn: Turn): boolean {
  return holdsFeature(sheet, "Distant Strike") && attacked(turn).length >= 2;
}

// How many attacks these features add to the Attack action this turn.
export function turnExtraAttacks(sheet: Holder, turn: Turn, round: number): number {
  return (ambushRound(sheet, round) ? 1 : 0) + (flurry(sheet, turn) ? 1 : 0) + (distant(sheet, turn) ? 1 : 0);
}

// Distant Strike's attack goes at a third creature: an attack that only it
// allows, at a creature the ranger already attacked this turn, is refused.
// `made`: attacks made before this one; `base`: what the action allows
// without the feature's own.
export function distantStrikeRefusal(sheet: Holder & Pick<CharacterSheet, "name">, turn: Turn, round: number, made: number, base: number, target: string): string | null {
  if (!distant(sheet, turn)) {
    return null;
  }
  const others = base + (ambushRound(sheet, round) ? 1 : 0) + (flurry(sheet, turn) ? 1 : 0);
  if (made < others || !attacked(turn).includes(textKey(target))) {
    return null;
  }
  return `${sheet.name}'s Distant Strike attack goes at a third creature, and ${target} is one they have attacked this turn. Pick another creature. Nothing was spent.`;
}

// Dread Ambusher's attack deals an extra 1d8 of the weapon's type: the one
// past what the action allows without it, on the first round.
export function ambushAttackDie(sheet: Holder, round: number, made: number, base: number): string | null {
  return ambushRound(sheet, round) && made === base ? "1d8" : null;
}
