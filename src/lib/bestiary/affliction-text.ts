// A hit's disease with a save every 24 hours, read from the attack's printed
// line (SRD 5.1, Otyugh, Bite: "it must succeed on a DC 15 Constitution
// saving throw against disease or become poisoned until the disease is
// cured. Every 24 hours that elapse, the target must repeat the saving
// throw, reducing its hit point maximum by 5 (1d10) on a failure. The
// disease is cured on a success. The target dies if the disease reduces its
// hit point maximum to 0."). Read by attack-text.ts readOnHit into the hit's
// rider; enemy-hit.ts lays it and src/lib/dm/hit-disease.ts runs its days.
// Read as a plain repeat save, the poisoning ended at the end of a turn or
// two and nothing took the maximum.
//
// Pure.

export type HitDisease = {
  // What a failed daily save takes off the hit point maximum.
  dice: string;
};

// The disease a hit's clause prints, or null for any other wording (that
// stays the GM's).
export function readHitDisease(hit: string): HitDisease | null {
  if (!/\bagainst disease or become poisoned until the disease is cured\b/i.test(hit) || !/\bthe disease is cured on a success\b/i.test(hit)) {
    return null;
  }
  const daily = /\bevery 24 hours that elapse, the target must repeat the saving throw, reducing its hit point maximum by \d{1,3} \((\d{1,2}d\d{1,2})\) on a failure\b/i.exec(hit);
  return daily ? { dice: daily[1].toLowerCase() } : null;
}

// A hit's curse that takes every rest's benefit (SRD 5.1, Rakshasa, Claw:
// "the target is cursed if it is a creature ... The cursed target gains no
// benefit from finishing a short or long rest"), laid by enemy-hit.ts as
// src/lib/dm/nightmare-curse-logic.ts's condition.
export function readsRestlessCurse(hit: string): boolean {
  return /\bthe target is cursed\b/i.test(hit) && /\bgains no benefit from finishing a short or long rest\b/i.test(hit);
}

// The curse's sentences, carried by the condition and not told to the GM.
export const RESTLESS_CURSE_SENTENCE = /\bthe target is cursed\b|\bthe magical curse takes effect\b|\bgains no benefit from finishing\b|\bthe curse lasts until\b/i;

// The sentences of a hit the disease's reading carries, so they are not also
// told to the GM.
export const HIT_DISEASE_SENTENCE = /\bagainst disease\b|\bevery 24 hours that elapse\b|\bthe disease is cured\b|\bthe disease reduces\b|\breduction to the target's hit point maximum lasts\b/i;
