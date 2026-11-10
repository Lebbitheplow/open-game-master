// When a reaction can still be taken by a character the triggering hit just
// dropped (issue 233). A reaction is "an instant response to a trigger" (PHB,
// Reactions), and a creature at 0 hit points is unconscious and takes none;
// what the reaction does to its trigger decides which of the two comes first:
//
//   answers  acts on the triggering attack or damage itself (Shield, Uncanny
//            Dodge, Stone's Endurance): taken as the hit lands, so judged as
//            the character stood before it.
//   at_zero  is triggered by being reduced to 0 hit points (Strength before
//            Death, Necrotic Husk): allowed exactly then, refused otherwise.
//   after    follows the damage and does not change it (Hellish Rebuke,
//            Misty Escape, Wrath of the Storm): a character the hit dropped
//            is unconscious and cannot take it. Every reaction not named as
//            one of the other two is this one.
//
// A reaction that answers a hit on someone else is judged as the reactor is
// now: the "as before" reading is only for a hit on the reactor themselves.
// Pure: no imports beyond types and the name helpers, so every tool and the
// tests read one table.
import type { ReactionDoes } from "@/lib/srd/authored-effects-types";
import { isNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

export type ReactionTiming = "answers" | "at_zero" | "after";

const AT_ZERO = ["strength before death", "necrotic husk"];

// Kind A, by the words of each feature's trigger: the PHB, XGtE, TCoE, FToD
// and VRGtR reactions that change the attack or damage that triggered them,
// with the spells that do (Shield "including against the triggering attack",
// Absorb Elements "the triggering damage", Feather Fall, Silvery Barbs).
const ANSWERS = [
  "uncanny dodge",
  "deflect missiles",
  "deflect missile",
  "slow fall",
  "feather fall",
  "shield",
  "absorb elements",
  "silvery barbs",
  "defensive duelist",
  "parry",
  "warding flare",
  "entropic ward",
  "illusory self",
  "instinctive charm",
  "sentinel at death's door",
  "glorious defense",
  "spell thief",
  "stone's endurance",
  "stones endurance",
  "swarming dispersal",
  "one with the word",
  "warding maneuver",
  "lucky",
  "fortunate",
  "cutting words",
  "protection",
  "ice pick",
];

// Answered from the reaction strip but no reaction: Lucky spends a luck
// point (src/lib/dm/feat-reactions.ts), so neither a reaction already used
// nor a condition that bars reactions keeps it from the character.
export function spendsNoReaction(name: string): boolean {
  return isNamed(name, "lucky", "fortunate", "luck point", "luck points");
}

// By the reaction's whole name (src/lib/srd/feature-names.ts): Shield of
// Faith is no Shield.
export function reactionTimingOf(name: string): ReactionTiming {
  if (isNamed(name, ...AT_ZERO)) {
    return "at_zero";
  }
  if (isNamed(name, ...ANSWERS)) {
    return "answers";
  }
  return "after";
}

// An authored reaction's timing, from what it does to the hit: lowering it,
// raising the AC against it, rolling it again, resisting it, taking it in an
// ally's place, turning it aside or into a miss (Armor of Hexes' d6) or into a
// normal hit all act on the triggering attack; striking
// back, attacking, a save, a move or a condition follow it.
export function timingOfDoes(does: ReactionDoes): ReactionTiming {
  switch (does.kind) {
    case "reduce":
    case "ac_vs_hit":
    case "disadv_vs_hit":
    case "reroll_hit":
    case "resist_instance":
    case "take_for_ally":
    case "redirect":
    case "force_miss":
    case "chance_miss":
    case "uncrit":
    case "echo_takes_hit":
    case "attack_penalty":
      return "answers";
    default:
      return "after";
  }
}

// The limited-use reactions a hit calls for, which the engine resolves when it is
// named. A reaction to any damage a creature deals is dealt by its trigger
// (src/lib/srd/trigger-table.ts) instead. Each is a card when the hit comes
// (hand-react.ts) and none on the holder's own turn: they sat in the Hand there, with no trigger to answer, and never came
// up at the moment they are for.
export const HIT_ANSWER_COUNTERS: ReadonlyArray<{
  id: string;
  // Also answers a hit on a creature within `rangeFt` of the holder.
  ally?: boolean;
  // How near that creature stands, in feet, for the Hand to deal its card
  // only inside the reach (hand-react.ts inReach).
  rangeFt?: number;
  // Taken only while wielding a melee weapon or a shield (maneuver-rules.ts).
  armed?: boolean;
  // Only an attack, not a fall or a missile's other damage.
  attackOnly?: boolean;
  // Taken as the hit drops the holder to 0, and only then.
  atZero?: boolean;
  // Acts on the hit itself, so it is open to a holder that hit has just dropped.
  answersDrop?: boolean;
  // Only while the holder has this condition.
  whileHolding?: string;
  // Also answers damage no hit records (an area spell, a zone), so its card stays.
  anyDamage?: boolean;
}> = [
  { id: "race_stones_endurance", answersDrop: true },
  { id: "sub_swarming_dispersal", answersDrop: true },
  { id: "sub_warding_maneuver", ally: true, attackOnly: true, rangeFt: 5, armed: true, answersDrop: true },
  { id: "sub_one_with_the_word", answersDrop: true, whileHolding: "manifest mind" },
  { id: "sub_necrotic_husk", atZero: true },
  { id: "sub_strength_before_death", atZero: true },
];

// The limited-use reactions src/lib/dm/reaction-counters.ts carries out when
// use_resource spends them: their dice are rolled and applied there, not by
// a counter's fx.
export const COUNTER_REACTION_IDS = [
  "race_stones_endurance",
  "sub_swarming_dispersal",
  "sub_one_with_the_word",
  "sub_warding_maneuver",
  "sub_necrotic_husk",
  "sub_strength_before_death",
];

// A reach that grows with the holder's level ([[level, feet], ...], the last
// row reached), as a feature's authored range is written.
export function reachAtLevel(range: number | Array<[number, number]>, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 5;
  for (const [at, value] of range) {
    if (level >= at) {
      feet = value;
    }
  }
  return feet;
}

// The mark a miss under Entropic Ward leaves on the warlock: the creature
// that missed is its `quarry`, and the warlock's next attack roll against it
// has advantage before the end of their next turn (authored-hooks.ts).
export const ENTROPIC_EDGE = "entropic ward";

export function entropicQuarry(sheet: { conditions: string[]; conditionMeta?: unknown }): string | null {
  if (!sheet.conditions.some((entry) => textKey(entry) === ENTROPIC_EDGE)) return null;
  const meta = (sheet.conditionMeta as Record<string, { quarry?: string } | undefined> | undefined)?.[ENTROPIC_EDGE];
  return meta?.quarry ?? null;
}
