// An ability score a creature's touch lowers, as the sheet keeps it. SRD 5.1,
// Shadow, Strength Drain: "the target's Strength score is reduced by 1d4. The
// target dies if this reduces its Strength to 0. Otherwise, the reduction
// lasts until the target finishes a short or long rest." Before this the
// reduction was a line for the GM: nothing on the sheet fell, so a fighter
// drained to Strength 2 swung and carried as before, and nobody ever died
// of it.
//
// Held as one condition per score carrying the whole of what was taken,
// "strength reduced (-3)", with the rest that ends it in its meta
// (untilRestEnds for "a short or long rest", untilLongRest for a long one:
// rest-logic.ts clears both). effectiveAbilities (magic-items.ts) takes it
// off the sheet's own score, so every number built on the score feels it:
// attack and damage, checks and saves, carrying capacity.
//
// Pure.

export type DrainAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";

const WORD: Record<DrainAbility, string> = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
const ABILITY_OF: Record<string, DrainAbility> = Object.fromEntries(Object.entries(WORD).map(([ability, word]) => [word, ability as DrainAbility]));

export const ABILITY_DRAIN = /^(strength|dexterity|constitution|intelligence|wisdom|charisma) reduced \(-(\d{1,2})\)$/i;

export function drainConditionName(ability: DrainAbility, total: number): string {
  return `${WORD[ability]} reduced (-${total})`;
}

// The condition holding a drain of this score, and its total, or null.
export function drainOf(conditions: readonly string[], ability: DrainAbility): { name: string; total: number } | null {
  for (const name of conditions) {
    const found = ABILITY_DRAIN.exec(name.trim());
    if (found && ABILITY_OF[found[1].toLowerCase()] === ability) {
      return { name, total: Number(found[2]) };
    }
  }
  return null;
}

// The scores with what every drain on them has taken (never below 0).
export function drainedScores<T extends Partial<Record<DrainAbility, number>>>(scores: T, conditions: readonly string[] | undefined): T {
  let out = scores;
  for (const name of conditions ?? []) {
    const found = ABILITY_DRAIN.exec(name.trim());
    const ability = found ? ABILITY_OF[found[1].toLowerCase()] : undefined;
    const score = ability ? out[ability] : undefined;
    if (ability && typeof score === "number") {
      out = { ...out, [ability]: Math.max(0, score - Number(found![2])) };
    }
  }
  return out;
}
