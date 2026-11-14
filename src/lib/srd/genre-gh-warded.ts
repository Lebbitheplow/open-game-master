// Hunter's Kit (slayer 2): "a warding gives one ally +2 AC against one monster
// type for a night"; Stake and Salt (Lodge of the Silver Stake 3): "Your
// Hunter's Kit wardings cover the whole party". The warding is the condition
// "warded (<type>)" on each creature it covers (laid by
// src/lib/dm/genre-gh-wards.ts huntersKit), and every enemy attack's AC asks
// here with the attacker's type (src/lib/dm/ac-effects.ts acWithEffects).
// Pure.
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const WARDED = "warded";
export const WARDED_AC = 2;

// The SRD 5.1 creature types a warding is made against.
export const WARDING_TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"] as const;

export const wardedCondition = (type: string) => `${WARDED} (${type})`;

// The AC the creature's wardings add against an attacker of this type.
export function wardedAc(conditions: readonly string[], attackerType: string | null | undefined): number {
  const words = textKey(attackerType ?? "").split(" ");
  const against = conditions.filter((entry) => isConditionNamed(entry, WARDED)).map((entry) => textKey(/\(([^)]+)\)/.exec(entry)?.[1] ?? ""));
  return against.some((type) => type && words.includes(type)) ? WARDED_AC : 0;
}
