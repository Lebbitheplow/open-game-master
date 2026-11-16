// A hit that lowers an ability score, read from the attack's printed line
// (SRD 5.1, Shadow: "the target's Strength score is reduced by 1d4. The
// target dies if this reduces its Strength to 0. Otherwise, the reduction
// lasts until the target finishes a short or long rest."). Read by
// attack-text.ts readOnHit into the hit's rider; enemy-hit.ts plays it
// (src/lib/srd/ability-drain-logic.ts keeps it on the sheet). A drain this
// reader cannot read whole (one that lasts until a disease is cured, one
// that grows each hour, one that incapacitates at 0) stays the GM's.
//
// Pure.

import type { DrainAbility } from "@/lib/srd/ability-drain-logic";

export type ScoreDrain = {
  ability: DrainAbility;
  dice: string;
  // "The target dies if this reduces its Strength to 0."
  diesAtZero: boolean;
  // The rest that ends it: "a short or long rest", or "a long rest".
  until: "short" | "long";
};

const ABILITY: Record<string, DrainAbility> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

// The drain a hit's clause prints, or null.
export function readScoreDrain(hit: string): ScoreDrain | null {
  const found = /\b(?:target's|its|creature's)\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+score\s+is\s+reduced\s+by\s+(\d{1,2}d\d{1,2}|\d{1,2})\s*\./i.exec(hit);
  if (!found) {
    return null;
  }
  const word = found[1].toLowerCase();
  const after = hit.slice(found.index);
  const until = /\buntil the target finishes a short or long rest\b/i.test(after) ? "short" : /\buntil the (?:target|creature) finishes a long rest\b(?! after)/i.test(after) ? "long" : null;
  if (!until || /\bfor each hour\b/i.test(after)) {
    return null;
  }
  const dies = new RegExp(`\\bdies if this reduces (?:its|their) ${word} to 0\\b`, "i").test(after);
  // Some other end at 0 (incapacitated, a life ended by its own hand).
  if (!dies && /\breduces (?:its|their) \w+ to 0\b|\breduced to 0\b/i.test(after)) {
    return null;
  }
  return { ability: ABILITY[word], dice: found[2].toLowerCase(), diesAtZero: dies, until };
}

// The sentences of a hit that the drain's reading carries, so they are not
// also told to the GM.
export const SCORE_DRAIN_SENTENCE = /\bscore is reduced by\b|\bif this reduces (?:its|their) \w+ to 0\b|\bthe reduction lasts until\b/i;
