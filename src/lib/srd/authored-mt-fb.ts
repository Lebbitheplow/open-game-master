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

// infuse: the element the weapon in hand deals, and how far it is thrown
// (Elemental Cleaver, while raging, by the option chosen).
export function authoredInfusion(sheet: AuthoredSheet): { type: string; rangeFt: number; longRangeFt: number; feature: string } | null {
  const found = activeAuthored(sheet, "infuse")[0];
  return found ? { type: found.effect.type, rangeFt: found.effect.rangeFt, longRangeFt: found.effect.longRangeFt, feature: found.held.feature } : null;
}

// jump: feet added to the long jump and the high jump, whatever the start
// (Totem Spirit's tiger, while raging: "add 10 feet to your long jump distance
// and 3 feet to your high jump distance").
export function authoredJump(sheet: AuthoredSheet): { long: number; high: number } {
  let long = 0;
  let high = 0;
  for (const { effect } of activeAuthored(sheet, "jump")) {
    long += effect.long;
    high += effect.high;
  }
  return { long, high };
}

// The Strength score a long jump is planned with once those feet are in it:
// a standing jump covers half the score, so the feet are doubled first to
// come out whole (src/lib/srd/jump.ts longJumpFeet).
export function jumpStrength(strength: number, extraFeet: number, runningStart: boolean): number {
  return strength + (runningStart ? extraFeet : extraFeet * 2);
}
