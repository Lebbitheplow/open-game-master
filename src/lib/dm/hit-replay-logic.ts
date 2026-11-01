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
// deals them (src/lib/dm/pc-damage.ts, death.ts applyDamageDeathHook): once
// as they landed and once corrected. What differs is what the reaction gives
// back.
//
// Pure.
import { freshDeathTrack, isMassiveDamage, onDamageAtZero, type DeathTrack } from "@/lib/dm/death-logic";
import { applyDamageMath, wildShapeDamageMath } from "@/lib/dm/mutation-math";

// Where a character stands between blows. `wildShape` is a beast form's
// pool while the form holds; its other fields ride along untouched.
export type Standing<W extends { beastHp: number } = { beastHp: number }> = {
  currentHp: number;
  tempHp: number;
  wildShape: W | null;
  track: DeathTrack | null;
};

// One swing as the replay needs it: whether it hit, whether it was a
// critical hit, and the damage that reached the character (after resistance).
export type ReplaySwing = { hit: boolean; crit: boolean; landed: number };

export type Replay<W extends { beastHp: number }> = {
  // Where they stood before and after each hit, in order.
  steps: Array<{ before: Standing<W>; after: Standing<W> }>;
  final: Standing<W>;
  // The damage past 0 of the blow that dropped them (massive damage).
  overkill: number;
};

const killed = (): DeathTrack => ({ ...freshDeathTrack(), failures: 3, dead: true });

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

export function replayHits<W extends { beastHp: number }>(start: Standing<W>, hits: ReplaySwing[][], maxHp: number): Replay<W> {
  let state: Standing<W> = { ...start };
  let overkill = 0;
  const steps = hits.map((swings) => {
    const before = { ...state };
    for (const swing of swings) {
      if (!swing.hit || swing.landed <= 0) {
        continue;
      }
      const out = blow(state, swing.landed, swing.crit, maxHp);
      state = out.next;
      if (out.overkill !== null) {
        overkill = out.overkill;
      }
    }
    return { before, after: { ...state } };
  });
  return { steps, final: state, overkill };
}

// The death track a character at 0 is left with: the one they have now
// (with the saves rolled since the hits), less the failures the corrected
// blows no longer dealt, and alive again when it was those failures, or a
// blow past their maximum, that killed them. Stability a blow broke comes
// back when that blow is gone.
export function trackAfter(current: DeathTrack | null, was: DeathTrack | null, now: DeathTrack | null): DeathTrack | null {
  if (!now) {
    return current;
  }
  if (!current || !was) {
    return now;
  }
  const failures = Math.max(0, Math.min(3, current.failures - (was.failures - now.failures)));
  return {
    successes: current.successes,
    failures,
    stable: was.stable === now.stable ? current.stable : now.stable,
    dead: was.dead && !now.dead ? failures >= 3 : current.dead,
  };
}

// Whether two standings are the same for the refund.
export function sameStanding(a: Standing, b: Standing): boolean {
  return (
    a.currentHp === b.currentHp &&
    a.tempHp === b.tempHp &&
    (a.wildShape?.beastHp ?? null) === (b.wildShape?.beastHp ?? null) &&
    (a.track?.failures ?? 0) === (b.track?.failures ?? 0) &&
    Boolean(a.track?.dead) === Boolean(b.track?.dead) &&
    Boolean(a.track?.stable) === Boolean(b.track?.stable)
  );
}

// Hit points, temporary hit points and a beast form's pool together: what a
// blow takes and a reaction gives back.
export function pool(state: Standing): number {
  return state.currentHp + state.tempHp + (state.wildShape?.beastHp ?? 0);
}
