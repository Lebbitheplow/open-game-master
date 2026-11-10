// An ability modifier a feature adds to checks of another ability
// (Otherworldly Glamour, Fey Wanderer 3: "Add your Wisdom modifier to
// Charisma checks"), read by every check request_roll resolves
// (src/lib/dm/roll-feature-riders.ts). Before this the row did not exist and
// a Persuasion check totalled the same as a Hunter's. Pure.
import { activeAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import type { Ability } from "@/lib/srd/authored-effects-types";

export function authoredCheckMod(sheet: AuthoredSheet, ability: Ability | undefined, mods: Record<Ability, number>): { bonus: number; notes: string[] } {
  let bonus = 0;
  const notes: string[] = [];
  if (!ability) {
    return { bonus, notes };
  }
  for (const { effect, held } of activeAuthored(sheet, "check_ability_mod")) {
    if (effect.checks.includes(ability)) {
      const added = mods[effect.ability] ?? 0;
      bonus += added;
      notes.push(`${held.feature}: ${added >= 0 ? "+" : ""}${added} (${effect.ability.toUpperCase()}) on a ${ability.toUpperCase()} check`);
    }
  }
  return { bonus, notes };
}
