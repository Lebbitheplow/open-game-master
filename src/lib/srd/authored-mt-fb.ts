// The readers of the authored effect kinds the fighter and barbarian repair
// added (wave 2 of the 2026-11-09 gap sweep): each is one engine's question
// about a sheet, answered from the authored tables. Pure, like the rest of
// src/lib/srd. src/lib/srd/authored-coverage.ts names the engine file that
// calls each.
import { activeAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { textKey } from "@/lib/language/text-logic";

// check_bonus: an ability modifier added to a skill's checks (Elegant
// Courtier: "Add your Wisdom modifier to Persuasion checks").
export function authoredCheckBonus(sheet: AuthoredSheet, skill: string | undefined, mods: Record<string, number>): { bonus: number; notes: string[] } {
  let bonus = 0;
  const notes: string[] = [];
  const key = textKey(skill ?? "");
  for (const { effect, held } of activeAuthored(sheet, "check_bonus")) {
    const amount = Math.max(0, mods[effect.ability] ?? 0);
    if (key && effect.skills.includes(key) && amount > 0) {
      bonus += amount;
      notes.push(`${held.feature}: +${amount}`);
    }
  }
  return { bonus, notes };
}
