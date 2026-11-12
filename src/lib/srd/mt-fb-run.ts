// The keys a run at a creature leaves on the turn (src/lib/dm/mt-fb-charge.ts
// writes them; the Hand, the bonus-attack gate and the spend that rides a
// charge read them). Pure, so src/lib/srd and the Hand import it.
//
//   run-from:<x>,<y>          where the character stood when this turn's
//                             current run began (cleared by a melee attack)
//   charged:<enemyId>:<feet>  how many feet nearer to that creature the run
//                             that ended in a melee attack on it brought them

export const RUN_FROM = "run-from:";
export const CHARGED = "charged:";
// A fight with no board keeps no squares: the run is open, as a reach is
// (authored-saves.ts withinFeet).
export const OPEN_RUN = 999;

// The feet of the run that ended in a melee attack on this creature this
// turn (on any creature when none is named), 0 with none.
export function chargedFeet(marks: readonly string[] | undefined, enemyId?: string): number {
  let most = 0;
  for (const mark of marks ?? []) {
    if (!mark.startsWith(CHARGED)) continue;
    const [id, feet] = mark.slice(CHARGED.length).split(":");
    if (enemyId && id !== enemyId) continue;
    most = Math.max(most, Number(feet) || 0);
  }
  return most;
}

// The creature a natural weapon of the attacker's hit this turn, one key each
// (attack-swing.ts writes it beside the weapon hit's), for what rides such a
// hit (Infectious Fury).
export const NATURAL_HIT = "natural-hit:";
