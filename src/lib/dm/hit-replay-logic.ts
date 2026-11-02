// The hits on one character replayed in the order they landed, for a
// reaction that changes one of them after it landed
// (src/lib/dm/reaction-refund.ts).
//
// A character can hold several open hits (src/lib/dm/last-hit.ts). The first
// may drop them, and every blow after it that lands on them at 0 is an
// automatic death-save failure, two on a critical hit, or death when it is as
// large as their hit point maximum (SRD 5.1, Damage at 0 Hit Points). So a
// reaction that changes an earlier hit changes what every later one did: a
// miss that leaves them standing turns the later blows back into hit point
// damage, and a later blow that now misses takes back its failures. The hits
// are replayed whole, from the earliest one changed, as the damage path
// deals them (src/lib/dm/pc-damage.ts, death.ts applyDamageDeathHook).
//
// Between two hits, and since the last, anything else may have changed them:
// an area spell, a breath, healing, temporary hit points, the death saves
// they rolled. That is a gap, and each change in it is carried onto the
// corrected fight as the change it made (carryGap), in the order the changes
// happened (carryGaps): healing that found them whole now does nothing to
// a blow that lands after it. The corrected blows then take back only their
// own part: replaying the hits alone from where the first found them erased
// the fire and the healing between them.
//
// Pure.
import type { Advantage } from "@/lib/dice";
import { freshDeathTrack, isMassiveDamage, onDamageAtZero, type DeathTrack } from "@/lib/dm/death-logic";
import { applyDamageMath, wildShapeDamageMath } from "@/lib/dm/mutation-math";

// Where a character stands between blows. `wildShape` is a beast form's
// pool while the form holds; its other fields ride along untouched. `ward`
// is an abjurer's Arcane Ward's hit points, which take a blow first; null
// with none raised.
export type Standing<W extends { beastHp: number } = { beastHp: number }> = {
  currentHp: number;
  tempHp: number;
  wildShape: W | null;
  track: DeathTrack | null;
  ward?: number | null;
};

// What of a blow gets through the character's defenses, given what of it
// the ward let past (reaction-refund.ts builds it from pc-damage.ts).
export type Landing = (past: number) => number;

// One swing as the replay needs it: whether it hit, whether it was a
// critical hit, the damage sent to the damage path and what of it lands.
// `ordinary`: a critical that came only from the character lying
// unconscious at 0 within 5 ft, as the ordinary hit it is on them standing
// (SRD 5.1); a replay that finds them standing when it lands deals that.
// `standingHit`: false when the swing hit them only for lying at 0 (its
// advantage came from their unconsciousness), so on them standing it misses.
export type ReplaySwing = {
  hit: boolean;
  crit: boolean;
  raw: number;
  land: Landing;
  ordinary?: { raw: number; land: Landing };
  standingHit?: boolean;
};

// What one swing did in a replay: the damage that got through the defenses
// (the concentration save is made against it), whether they stood when it
// landed, and whether it dropped them.
export type SwingOutcome = { landed: number; standing: boolean; dropped: boolean };

const killed = (): DeathTrack => ({ ...freshDeathTrack(), failures: 3, dead: true });

// Up: above 0 hit points, or in a beast form.
export function up(state: Standing): boolean {
  return state.currentHp > 0 || state.wildShape !== null;
}

function blow<W extends { beastHp: number }>(state: Standing<W>, landed: number, crit: boolean, maxHp: number): { next: Standing<W>; overkill: number | null } {
  if (state.wildShape) {
    const shape = wildShapeDamageMath(state.wildShape.beastHp, state.tempHp, landed);
    if (!shape.reverted) {
      return { next: { ...state, tempHp: shape.tempHp, wildShape: { ...state.wildShape, beastHp: shape.beastHp } }, overkill: null };
    }
    return dropping<W>({ ...state, tempHp: shape.tempHp, wildShape: null }, shape.carryover, maxHp);
  }
  if (state.currentHp > 0) {
    return dropping(state, landed, maxHp);
  }
  // Already at 0: temporary hit points still soak, and the blow is a failure
  // (two on a critical hit), or death past the maximum. A character with no
  // track, or dead, takes nothing more on it.
  const math = applyDamageMath(0, state.tempHp, landed);
  if (!state.track || state.track.dead) {
    return { next: { ...state, tempHp: math.tempHp }, overkill: null };
  }
  return {
    next: { ...state, tempHp: math.tempHp, track: isMassiveDamage(math.overkill, maxHp) ? killed() : onDamageAtZero(state.track, crit) },
    overkill: null,
  };
}

// Hit point damage on a character above 0: a drop starts the dying track, or
// ends them outright when the damage past 0 is as large as their maximum.
function dropping<W extends { beastHp: number }>(state: Standing<W>, amount: number, maxHp: number): { next: Standing<W>; overkill: number | null } {
  const math = applyDamageMath(state.currentHp, state.tempHp, amount);
  if (!math.dropped) {
    return { next: { ...state, currentHp: math.currentHp, tempHp: math.tempHp }, overkill: null };
  }
  return {
    next: { ...state, currentHp: 0, tempHp: math.tempHp, track: isMassiveDamage(math.overkill, maxHp) ? killed() : freshDeathTrack() },
    overkill: math.overkill,
  };
}

// One blow as the damage path lands it: the ward takes it first, what it
// lets past meets the defenses, and the rest lands. `pastZero` is what went
// past 0 hit points (a blow that dropped them, or one that found them down).
export function strike<W extends { beastHp: number }>(
  state: Standing<W>,
  raw: number,
  land: Landing,
  crit: boolean,
  maxHp: number,
): { next: Standing<W>; landed: number; dropped: boolean; pastZero: number } {
  if (raw <= 0) {
    return { next: state, landed: 0, dropped: false, pastZero: 0 };
  }
  const absorbed = state.ward ? Math.min(state.ward, raw) : 0;
  const warded = absorbed ? { ...state, ward: (state.ward as number) - absorbed } : state;
  const landed = land(raw - absorbed);
  if (landed <= 0) {
    return { next: warded, landed: 0, dropped: false, pastZero: 0 };
  }
  const wasUp = up(warded);
  const out = blow(warded, landed, crit, maxHp);
  const pastZero = out.overkill ?? (wasUp ? 0 : Math.max(0, landed - warded.tempHp));
  return { next: out.next, landed, dropped: out.overkill !== null, pastZero };
}

// One hit's swings in order, from where it found them.
export function replayHit<W extends { beastHp: number }>(start: Standing<W>, swings: ReplaySwing[], maxHp: number): { after: Standing<W>; swings: SwingOutcome[]; dropped: boolean } {
  let state: Standing<W> = { ...start };
  let dropped = false;
  const outcomes = swings.map((swing) => {
    const standing = up(state);
    if (!swing.hit || (standing && swing.standingHit === false)) {
      return { landed: 0, standing, dropped: false };
    }
    const asOrdinary = standing && swing.ordinary !== undefined;
    const raw = asOrdinary ? (swing.ordinary as { raw: number }).raw : swing.raw;
    const land = asOrdinary ? (swing.ordinary as { land: Landing }).land : swing.land;
    const out = strike(state, raw, land, swing.crit && !asOrdinary, maxHp);
    state = out.next;
    dropped = dropped || out.dropped;
    return { landed: out.landed, standing, dropped: out.dropped };
  });
  return { after: state, swings: outcomes, dropped };
}

// Whether a recorded roll hits with another advantage: kept from the same
// d20 faces (a roll without advantage reads the first die, as the engine's
// Protection does), its modifiers unchanged, against the AC it met.
export function hitsWith(
  swing: { faces: number[]; natural: number | null; total: number; vsAc: number },
  advantage: Advantage,
): boolean {
  if (swing.natural === null || !swing.faces.length) {
    return true;
  }
  const kept =
    advantage === "none" || swing.faces.length < 2
      ? swing.faces[0]
      : advantage === "advantage"
        ? Math.max(...swing.faces)
        : Math.min(...swing.faces);
  if (kept === 20) {
    return true;
  }
  if (kept === 1) {
    return false;
  }
  return swing.total - swing.natural + kept >= swing.vsAc;
}

// What changed a character between two hits, or since the last: read off
// where the hit left them (`from`) and where the next found them, or where
// they stand now (`to`). `pastZero` is the damage that went past 0 hit
// points in it, which the hit points alone cannot show (the audit's
// overkill, reaction-refund.ts).
export type Gap<W extends { beastHp: number } = { beastHp: number }> = {
  from: Standing<W>;
  to: Standing<W>;
  pastZero: number;
};

// A gap carried onto where the corrected hits left them, as the change it
// made: damage (with what went past 0) through the ward, temporary hit
// points and the hit points, temporary hit points granted (the higher kept,
// as they do not stack), healing, a form taken, a ward raised, and while
// they lay at 0 through it the death saves they rolled and the failures it
// dealt. A gap that dropped them drops the corrected fight only if its
// damage reaches that far. Returns the damage it dealt and what of it went
// past 0, for the concentration save it asks and the next reaction.
export function carryGap<W extends { beastHp: number }>(
  state: Standing<W>,
  gap: Gap<W>,
  maxHp: number,
): { next: Standing<W>; dealt: number; pastZero: number } {
  const { from, to } = gap;
  let next: Standing<W> = { ...state };
  const fromBeast = from.wildShape?.beastHp ?? 0;
  const toBeast = to.wildShape?.beastHp ?? 0;
  // A form taken between: they stand in it as they do now.
  if (!from.wildShape && to.wildShape) {
    next = { ...next, wildShape: to.wildShape };
  }
  const wardGained = Math.max(0, (to.ward ?? 0) - (from.ward ?? 0));
  if (wardGained) {
    next = { ...next, ward: (next.ward ?? 0) + wardGained };
  }
  const tempGranted = to.tempHp > from.tempHp;
  if (tempGranted) {
    next = { ...next, tempHp: Math.max(next.tempHp, to.tempHp) };
  }
  const tempLost = tempGranted ? 0 : from.tempHp - to.tempHp;
  const beastLost = from.wildShape ? Math.max(0, fromBeast - (to.wildShape ? toBeast : 0)) : 0;
  const wardLost = Math.max(0, (from.ward ?? 0) - (to.ward ?? 0));
  const hpLost = Math.max(0, from.currentHp - to.currentHp);
  const healed = Math.max(0, to.currentHp - from.currentHp);
  const damage = tempLost + beastLost + wardLost + hpLost + gap.pastZero;
  let dealt = 0;
  let pastZero = 0;
  if (!up(from) && !up(to) && !up(next)) {
    // Down through it on both sides: its damage soaked into temporary hit
    // points, and the rest is on the track as it moved.
    next = { ...next, tempHp: Math.max(0, next.tempHp - tempLost), track: trackMoved(next.track, from.track, to.track) };
    pastZero = gap.pastZero;
  } else if (damage > 0) {
    const out = strike(next, damage, (past) => past, false, maxHp);
    next = out.next;
    dealt = out.landed;
    pastZero = out.pastZero;
  }
  if (healed > 0) {
    next = up(next) ? { ...next, currentHp: Math.min(maxHp, next.currentHp + healed) } : { ...next, currentHp: Math.min(maxHp, healed), track: null };
  }
  return { next, dealt, pastZero };
}

// A gap carried change by change, in the order the changes happened: healing
// that found them whole in the corrected fight does nothing, and damage after
// it still lands, where the gap read as one change (where the hit left them
// against where the next found them) let a heal and a blow cancel out. The
// changes are those the audit kept, each read off its own pre-image, then
// whatever the audit did not keep, read as one change from where they leave
// the fight as it was (`kept`) to where the next hit found them (`to`).
// Returns each change's damage, as each source asks its own concentration
// save.
export function carryGaps<W extends { beastHp: number }>(
  state: Standing<W>,
  gap: { kept: Standing<W>; to: Standing<W>; changes: Gap<W>[] },
  maxHp: number,
): { next: Standing<W>; dealt: number[] } {
  let next = state;
  let left = gap.kept;
  const dealt: number[] = [];
  for (const change of gap.changes) {
    if (sameStanding(change.from, change.to) && change.pastZero <= 0) {
      continue;
    }
    const out = carryGap(next, change, maxHp);
    next = out.next;
    left = carryGap(left, change, maxHp).next;
    if (out.dealt > 0) {
      dealt.push(out.dealt);
    }
  }
  if (!sameStanding(left, gap.to)) {
    const out = carryGap(next, { from: left, to: gap.to, pastZero: 0 }, maxHp);
    next = out.next;
    if (out.dealt > 0) {
      dealt.push(out.dealt);
    }
  }
  return { next, dealt };
}

// The track of a character still at 0 moved as theirs did in a gap: the
// saves rolled and the failures dealt, stability won or lost, death.
function trackMoved(current: DeathTrack | null, from: DeathTrack | null, to: DeathTrack | null): DeathTrack | null {
  if (!to) {
    return current;
  }
  if (!current || !from) {
    return to;
  }
  const failures = Math.max(0, Math.min(3, current.failures + to.failures - from.failures));
  return {
    successes: Math.max(0, Math.min(3, current.successes + to.successes - from.successes)),
    failures,
    stable: from.stable === to.stable ? current.stable : to.stable,
    dead: (to.dead && !from.dead) || current.dead || failures >= 3,
  };
}

// Whether two standings are the same for the refund.
export function sameStanding(a: Standing, b: Standing): boolean {
  return (
    a.currentHp === b.currentHp &&
    a.tempHp === b.tempHp &&
    (a.wildShape?.beastHp ?? null) === (b.wildShape?.beastHp ?? null) &&
    (a.ward ?? null) === (b.ward ?? null) &&
    (a.track?.failures ?? 0) === (b.track?.failures ?? 0) &&
    (a.track?.successes ?? 0) === (b.track?.successes ?? 0) &&
    Boolean(a.track?.dead) === Boolean(b.track?.dead) &&
    Boolean(a.track?.stable) === Boolean(b.track?.stable)
  );
}

// Hit points, temporary hit points and a beast form's pool together: what a
// blow takes and a reaction gives back.
export function pool(state: Standing): number {
  return state.currentHp + state.tempHp + (state.wildShape?.beastHp ?? 0);
}
