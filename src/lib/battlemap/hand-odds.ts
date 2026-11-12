// The advantage and the odds a raised attack card previews against the
// creature it is aimed at, from what the roll itself reads: the board's
// edge (cover, flanking, a hostile creature beside, the distance, and sight
// as attack-sight.ts decides it for pc_attack), the conditions on both
// sides, the card's own roll extras (Bless's die, True Strike's advantage)
// and the range its weapon is thrown or shot at (attack-rules.ts). Split
// from hand-play.ts, whose previewRows prints it; aimedCard re-judges the
// options that hang on the aim (Rapid Strike needs advantage to trade).
//
// Pure; scripts/test-hand-attack-lines.mjs drives it.
import { pastNormalRange, thrownAtRange } from "@/lib/dm/attack-rules";
import { attackContext, mergeAdvantage } from "@/lib/dm/condition-logic";
import type { Advantage } from "@/lib/dice";
import { attackOdds, type AttackOdds } from "@/lib/srd/odds";
import type { HandCard } from "@/lib/battlemap/hand-core";
import type { HandAim, HandChoices } from "@/lib/battlemap/hand-play";

// Where the aimed creature stands against a ranged or thrown card's reach:
// inside a thrown weapon's melee reach, inside its normal range, past it
// (disadvantage), or past its long range (pc_attack refuses the shot).
export type ShotRange = "reach" | "normal" | "long" | "beyond";

export function shotRange(shot: NonNullable<HandCard["shot"]>, feet: number): ShotRange {
  const apart = Math.ceil(feet / 5);
  if (shot.thrown && !thrownAtRange({ thrown: true, reachTiles: shot.reachFt / 5 }, apart)) return "reach";
  if (feet > shot.longFt) return "beyond";
  return pastNormalRange({ ranged: !shot.thrown, thrown: shot.thrown, rangeTiles: shot.normalFt / 5 }, apart) ? "long" : "normal";
}

export function previewAdvantage(
  card: HandCard,
  enemy: HandAim | null,
  attackerConditions: string[],
  choices: HandChoices = {},
): { advantage: Advantage; melee: boolean; range: ShotRange | null } {
  // The board's verdict, when there is one: how far apart, whether the
  // line gives cover, whether an ally flanks with you, what sight does.
  const edge = enemy?.edge;
  const range = card.shot && edge?.feet !== undefined ? shotRange(card.shot, edge.feet) : null;
  // A thrown weapon is a ranged attack once it leaves the hand.
  const melee = card.melee && (range === null || range === "reach");
  const sight = enemy?.sight;
  const context = attackContext({
    // Blindsight or truesight past invisibility, as the roll reads it (view-tactics.ts).
    attackerSenses: edge?.senses?.attacker,
    targetSenses: edge?.senses?.target,
    // Feral Senses and a fear out of sight, as the roll reads them (attack-sight.ts).
    attackerConditions: sight?.attacker ?? attackerConditions,
    targetConditions: sight?.target ?? enemy?.conditions ?? [],
    melee,
    adjacent: edge ? edge.adjacent : melee,
    requested: "none",
    ...(sight ? { targetSeesAttacker: sight.targetSees } : {}),
  });
  const sources: Advantage[] = [...context.sources, ...(sight?.light ?? []), ...(card.rollAdvantage ?? [])];
  if (edge?.flanking && melee) sources.push("advantage");
  if (choices.options?.includes("reckless")) sources.push("advantage");
  if (choices.options?.includes("useInspiration")) sources.push("advantage");
  if (enemy?.advantage?.length) sources.push("advantage");
  // A ranged attack with a hostile creature beside the attacker is at
  // disadvantage; the board says whether one is.
  if (edge?.hostileBeside && !melee) sources.push("disadvantage");
  if (range === "long") sources.push("disadvantage");
  return { advantage: mergeAdvantage(sources), melee, range };
}

// The odds with the dice the roll adds beside its bonus ("+1d4", "-1d4"),
// averaged over every face they can show.
export function attackOddsWithDice(input: { attackBonus: number; dice: string; ac: number; advantage: Advantage }): AttackOdds {
  const dice = [...input.dice.replace(/\s+/g, "").matchAll(/([+-])(\d+)d(\d+)/g)].flatMap((match) =>
    Array.from({ length: Math.min(4, Number(match[2])) }, () => ({ sign: match[1] === "-" ? -1 : 1, sides: Math.min(20, Number(match[3])) })),
  );
  let totals = [0];
  for (const die of dice) {
    totals = totals.flatMap((total) => Array.from({ length: die.sides }, (_, face) => total + die.sign * (face + 1)));
  }
  const sum = { hit: 0, crit: 0, miss: 0 };
  for (const extra of totals) {
    const odds = attackOdds({ attackBonus: input.attackBonus + extra, ac: input.ac, advantage: input.advantage });
    sum.hit += odds.hit;
    sum.crit += odds.crit;
    sum.miss += odds.miss;
  }
  return { hit: sum.hit / totals.length, crit: sum.crit / totals.length, miss: sum.miss / totals.length };
}

// Rapid Strike trades an attack's advantage for one more attack (pc_attack
// refuses it on a swing with none), so its chip is shut until the aimed
// creature gives the roll advantage.
export const RAPID_STRIKE_NEEDS_ADVANTAGE = "Rapid Strike trades this attack's advantage for one more attack, and it has none here. Aim at a creature you attack with advantage.";

// The card as aimed: the options that hang on the aim judged against it.
export function aimedCard(card: HandCard, aim: HandAim | null, attackerConditions: string[]): HandCard {
  if (!card.options?.some((option) => option.needsAdvantage)) return card;
  const enemy = aim?.kind === "enemy" ? aim : null;
  const advantage = enemy ? previewAdvantage(card, enemy, attackerConditions).advantage : "none";
  return {
    ...card,
    options: card.options.map((option) =>
      option.needsAdvantage ? { ...option, disabled: advantage === "advantage" ? null : RAPID_STRIKE_NEEDS_ADVANTAGE } : option,
    ),
  };
}
