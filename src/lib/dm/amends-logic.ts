// What making amends can repair (issue 642), the pure half. Each bond keeps
// what wrongs cost it and no amends has repaired yet (relationships.owed):
// amends gives back at most that, and spends it. Before this an amends was a
// flat +6 whatever it was for, so a partner who objected to a flirt the
// engine never recorded came out six points warmer for the apology, and an
// apology with nothing to apologise for bought regard like a gift.
//
// Pure, with no imports, so scripts/test-romance-exclusive.mjs loads it
// directly; beat-landing.ts applies it.

// A bond's grievance never grows past the meter's whole span.
export const OWED_MAX = 200;

// The approval an amends moves: what the beat rules gave it, never past what
// is owed. A cost is passed through untouched.
export function amendsDelta(weighed: number, owed: number): number {
  return weighed > 0 ? Math.min(weighed, Math.max(0, owed)) : weighed;
}

// What a bond owes after a beat moved its meter by `moved` (the change as it
// landed, after the meter's bounds): a cost adds to it, an amends
// (`amends`) spends it, and anything else leaves it be. A gift after an
// insult is its own act, not a repair, so only amends draws it down.
export function owedAfter(owed: number, moved: number, amends = false): number {
  const current = Math.max(0, Math.round(owed) || 0);
  if (moved < 0) {
    return Math.min(OWED_MAX, current - Math.round(moved));
  }
  if (amends && moved > 0) {
    return Math.max(0, current - Math.round(moved));
  }
  return current;
}

// The GM's line when an amends found nothing left to repair (`owed` as it
// stood before), so it is narrated as the gesture it is rather than a gain.
export function amendsNote(subject: string, character: string, owed: number): string | null {
  return owed <= 0 ? `Nothing ${character} did stands unrepaired between them and ${subject}, so the amends changes nothing; narrate it as the gesture it is.` : null;
}
