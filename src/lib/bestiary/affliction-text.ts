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

// The sentences of a hit the disease's reading carries, so they are not also
// told to the GM.
export const HIT_DISEASE_SENTENCE = /\bagainst disease\b|\bevery 24 hours that elapse\b|\bthe disease is cured\b|\bthe disease reduces\b|\breduction to the target's hit point maximum lasts\b/i;
