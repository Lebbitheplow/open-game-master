// Spell Bombardment (Wild Magic 18): "Once per turn, the highest damage die
// you roll for a spell explodes: roll it again and add it." The feature it
// condenses: when you roll damage for a spell and roll the highest number
// possible on any of the dice, choose one of those dice, roll it again and
// add that roll to the damage, once per turn. The row was narrated ("the GM
// adds it with apply_damage") while the server rolls the spell's dice itself
// and knows which of them show their highest number.
//
// It only helps, so it is applied without a call: of the kept dice of the
// roll that show their highest number, the largest is rolled again once and
// its face joins the term the die came from, so a two-type spell's second die
// stays its own type and a save still halves the sum. A die dealt at its
// maximum without a roll (Overchannel, Destructive Wrath) was not rolled and
// does not explode. Once per turn: the fight's turn marks (turn-marks.ts),
// keyed by the turn the roll is made on, so a spell cast with a reaction on
// another creature's turn has its own. Out of a fight there are no turns, and
// every damage roll may explode.
//
// Who calls it: every path that rolls a character's spell damage at a
// creature, the census spell-damage-mark.ts keeps: cast_at_enemy
// (cast-at-enemy-damage.ts landSpellDamage), aoe_damage with a caster
// (aoe-damage.ts), a spell attack through pc_attack on either dice path
// (attack-blow.ts landSwingBlow) and a caster's standing spell area hurting a
// creature (zone-triggers.ts). A new spell damage path calls it too.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, turnKey } from "@/lib/db/encounters";
import { rollExpression, type DiceTerm, type RollResult } from "@/lib/dice";
import { rollCard } from "@/lib/dm/roll-card";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

export const SPELL_BOMBARDMENT = "Spell Bombardment";

// The die to roll again: of the kept dice showing their highest number, the
// one with the most sides ("choose one of those dice"). Pure.
export function maxedDie(outcome: Pick<RollResult, "terms">): { term: number; sides: number } | null {
  let best: { term: number; sides: number } | null = null;
  outcome.terms.forEach((term, at) => {
    if (term.kind !== "dice" || term.sign !== 1) {
      return;
    }
    for (const die of term.dice) {
      if (die.kept && die.sides > 1 && die.value === die.sides && die.sides > (best?.sides ?? 0)) {
        best = { term: at, sides: die.sides };
      }
    }
  });
  return best;
}

// The roll with one more die on a term. Pure.
export function withExplodedDie(outcome: RollResult, term: number, sides: number, face: number): RollResult {
  const terms = outcome.terms.map((entry, at) =>
    at === term && entry.kind === "dice" ? ({ ...entry, dice: [...entry.dice, { sides, value: face, kept: true }], subtotal: entry.subtotal + face } satisfies DiceTerm) : entry,
  );
  return { ...outcome, terms, total: outcome.total + face };
}

const turnMark = (sheetId: string) => `spell-bombardment:${sheetId}`;

// A spell's damage roll of this caster, exploded when it may be: the roll as
// it now stands, what the die added, and the line for the result. Null when
// the caster has no Spell Bombardment, no die shows its highest number, or
// the turn's one use is gone. `card`: false when the caller stores the roll
// itself, the new die in it; otherwise the die gets a roll card of its own.
export function spellBombardment(input: {
  campaign: Pick<Campaign, "id">;
  turn: DmTurn | null;
  sheet: CharacterSheet;
  outcome: RollResult;
  spell: string;
  card?: boolean;
}): { outcome: RollResult; extra: number; note: string } | null {
  const { campaign, sheet, outcome } = input;
  if (!holdsFeature(sheet, SPELL_BOMBARDMENT)) {
    return null;
  }
  const die = maxedDie(outcome);
  if (!die) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  const stamp = encounter ? `${encounter.id}:${turnKey(encounter)}` : null;
  if (encounter && stamp) {
    if (fightMarked(encounter.id, turnMark(sheet.id), stamp)) {
      return null;
    }
    markFight(encounter.id, turnMark(sheet.id), stamp);
  }
  const expression = `1d${die.sides}`;
  // The die's own card is the feature's, not a second damage roll of the
  // spell: the spell's card keeps the dice its Hand card shows.
  const extra = (input.card === false ? rollExpression(expression) : rollCard(campaign, input.turn, sheet.id, "custom", `${SPELL_BOMBARDMENT} (${input.spell})`, expression, null)).total;
  return {
    outcome: withExplodedDie(outcome, die.term, die.sides, extra),
    extra,
    note: `${SPELL_BOMBARDMENT}: a d${die.sides} of ${input.spell} showed its highest number and was rolled again for ${extra} more, once this turn.`,
  };
}
