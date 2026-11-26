// The damage dice a player's hit throws, and the once-a-turn feats that
// change them: thrown by the server here, or told to a player who rolls at
// the table (the note for the GM, the steps on their damage roll card).
// Split out of attack-blow.ts, which lands the blow these dice make.

import { empoweredLine } from "@/lib/dm/mt-srd-metamagic";
import { rollExpression, type DiceTerm, type RollResult } from "@/lib/dice";
import type { DamageAsk } from "@/lib/dm/attack-record";
import type { DiceStep } from "@/lib/roll-words";

// The server's dice for a damage roll, with the feats the hit spent on them:
// Brutal Attack rolls it twice and keeps the better, Savage Attacker the
// weapon's own dice, Piercer rerolls the lowest die.
export function throwDamage(ask: DamageAsk, who: string, notes: string[]): RollResult {
  let outcome = rollExpression(ask.expression, undefined, { rerollBelow: ask.rerollBelow, ...(ask.empower ? { empower: ask.empower } : {}), purpose: { roller: "hero", kind: "damage", who } });
  if (ask.empower) {
    notes.push(empoweredLine(ask.empower));
  }
  if (ask.feats.brutal) {
    const again = rollExpression(ask.expression, undefined, { rerollBelow: ask.rerollBelow });
    notes.push(`Brutal Attack: the damage rolled twice (${outcome.total} and ${again.total}), the better kept`);
    outcome = again.total > outcome.total ? again : outcome;
  }
  if (ask.feats.savage) {
    const weapon = outcome.terms.find((term): term is DiceTerm => term.kind === "dice");
    const kept = weapon ? weapon.dice.filter((die) => die.kept) : [];
    if (weapon && kept.length) {
      const first = kept.reduce((sum, die) => sum + die.value, 0);
      const again = rollExpression(`${kept.length}d${kept[0].sides}`, undefined, { rerollBelow: ask.rerollBelow });
      const fresh = again.terms.find((term): term is DiceTerm => term.kind === "dice");
      notes.push(`Savage Attacker: the weapon's dice rolled twice (${first} and ${again.total}), the better kept`);
      if (fresh && again.total > first) {
        kept.forEach((die, index) => {
          die.value = fresh.dice[index]?.value ?? die.value;
        });
        weapon.subtotal += again.total - first;
        outcome = { ...outcome, total: outcome.total - first + again.total };
      }
    }
  }
  if (ask.feats.piercer) {
    const dice = outcome.terms.find((term): term is DiceTerm => term.kind === "dice");
    const lowest = dice ? dice.dice.filter((die) => die.kept).sort((a, b) => a.value - b.value)[0] : undefined;
    if (dice && lowest) {
      const fresh = rollExpression(`1d${lowest.sides}`).total;
      notes.push(`Piercer: a ${lowest.value} on a d${lowest.sides} is rerolled to ${fresh}`);
      dice.subtotal += fresh - lowest.value;
      outcome = { ...outcome, total: outcome.total - lowest.value + fresh };
      lowest.value = fresh;
    }
  }
  return outcome;
}

// The same feats for a player rolling at the table: what they do with the dice
// before entering the total.
export function damageDiceNote(ask: DamageAsk): string {
  return [
    ask.rerollBelow ? `, rerolling any die of ${ask.rerollBelow} or less once for Great Weapon Fighting` : "",
    ask.feats.brutal ? ", rolling the damage a second time and keeping the better total (Brutal Attack)" : "",
    ask.feats.savage ? ", rolling the weapon's dice a second time and keeping the better total (Savage Attacker)" : "",
    ask.feats.piercer ? ", rerolling the lowest damage die once and keeping the new roll (Piercer)" : "",
    ask.empower ? `, rerolling up to ${ask.empower} of the damage dice and keeping the new rolls (Empowered Spell)` : "",
  ].join("");
}

// The same steps said to the player on their damage roll card. The model's
// note above is not enough: the feat is spent the moment the hit parks the
// roll, and a GM who does not pass the note on leaves the player entering
// dice the feat never touched. Empty when no feat changes the dice. An
// opportunity attack's card asks it too, with no feats spent
// (opportunity-strike.ts).
// They are said as steps by their ids, and the card's line makes the words
// from them in the player's language (src/lib/roll-words.ts cardLine).
export function diceSteps(ask: Pick<DamageAsk, "rerollBelow" | "empower"> & { feats?: DamageAsk["feats"] }): DiceStep[] {
  return [
    ...(ask.rerollBelow ? [{ step: "reroll_low", below: ask.rerollBelow } as const] : []),
    ...(ask.feats?.brutal ? [{ step: "brutal" } as const] : []),
    ...(ask.feats?.savage ? [{ step: "savage" } as const] : []),
    ...(ask.feats?.piercer ? [{ step: "piercer" } as const] : []),
    ...(ask.empower ? [{ step: "empower", dice: ask.empower } as const] : []),
  ];
}
