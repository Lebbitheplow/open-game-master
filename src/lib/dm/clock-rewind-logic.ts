import type { CampaignClock, Instant } from "@/lib/dm/calendar";

// Putting back the time a turn moved the clock on, for "Revert this turn"
// (issue #622). Pure over the clock as it stands and the moves the turn made
// (src/lib/db/clock-moves.ts records them), so the route decides nothing the
// tests cannot read.
//
// What comes back is everything the turn changed on the clock: the turn
// keeps the whole clock as it found it (src/lib/db/turn-journal.ts keeps
// the campaign row), so the weather a rest or a march rolled, the pace they
// set, a disease, a poison or a lifestyle the turn gave, an object it broke
// go back with the hours. Each part goes back unless something moved it
// again since the turn (another turn, the GM's own controls), and the
// instant decides "kept": time moved on since stays where it is. A turn kept
// before the clock was journaled has only its moves, which put back what the
// moving itself changed (src/lib/db/clock.ts advanceClock).

export type RecordedClockMove = {
  // The clock as the move found it.
  before: CampaignClock;
  // Where the move left the instant.
  afterInstant: Instant;
};

export type ClockRewind =
  // The clock as it was before the turn's first move.
  | { restored: CampaignClock }
  // The clock moved again since (another turn, the GM's own controls): it
  // stays, with only the Wild Shapes whose hours this turn spent written
  // back, so the next move ends a form the revert gave back.
  | { kept: CampaignClock };

// The Wild Shape ends the moves took off the clock, back on it, unless a
// newer shape for that character is there now.
function withLapsedShapes(current: CampaignClock, moves: RecordedClockMove[]): Record<string, Instant> | undefined {
  const shapeEnds: Record<string, Instant> = { ...(current.shapeEnds ?? {}) };
  for (const move of moves) {
    for (const [characterId, ends] of Object.entries(move.before.shapeEnds ?? {})) {
      if (ends <= move.afterInstant && shapeEnds[characterId] === undefined) {
        shapeEnds[characterId] = ends;
      }
    }
  }
  return Object.keys(shapeEnds).length ? shapeEnds : undefined;
}

type Restored = "shapeEnds" | "supplies" | "mealAtDawn" | "shortRest" | "afflictions" | "downtime" | "marched";

// Sets `key` to `value`, or leaves it off when there is none, so a restored
// clock reads as the one that was saved.
function put<K extends Restored>(clock: CampaignClock, key: K, value: CampaignClock[K] | undefined) {
  if (value === undefined) {
    delete clock[key];
  } else {
    clock[key] = value;
  }
}

// The clock as the turn found it and as it left it (both read through
// normalizeClock, as `current` is).
export type ClockImage = { before: CampaignClock; after: CampaignClock };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function rewindImage(current: CampaignClock, moves: RecordedClockMove[], image: ClockImage): ClockRewind {
  const next: Record<string, unknown> = { ...current };
  const before = image.before as Record<string, unknown>;
  const after = image.after as Record<string, unknown>;
  const now = current as Record<string, unknown>;
  // Time moved on since the turn: the hours stay, and the revert says so.
  const moved = image.before.instant !== image.after.instant && current.instant !== image.after.instant;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[key], after[key]) || !same(now[key], after[key])) {
      continue;
    }
    if (before[key] === undefined) {
      delete next[key];
    } else {
      next[key] = before[key];
    }
  }
  const clock = next as CampaignClock;
  if (moved) {
    put(clock, "shapeEnds", withLapsedShapes(clock, moves));
    return { kept: clock };
  }
  return { restored: clock };
}

// Null when the turn changed nothing on the clock. The moves come oldest
// first; `image`, when the turn's clock was kept whole and it changed.
export function rewindClock(current: CampaignClock, moves: RecordedClockMove[], image: ClockImage | null = null): ClockRewind | null {
  if (image && !same(image.before, image.after)) {
    return rewindImage(current, moves, image);
  }
  if (!moves.length) {
    return null;
  }
  const first = moves[0].before;
  const last = moves[moves.length - 1];
  const next: CampaignClock = { ...current };
  put(next, "shapeEnds", withLapsedShapes(current, moves));
  if (current.instant !== last.afterInstant) {
    return { kept: next };
  }
  next.instant = first.instant;
  put(next, "supplies", first.supplies);
  put(next, "mealAtDawn", first.mealAtDawn);
  put(next, "shortRest", first.shortRest);
  put(next, "afflictions", first.afflictions);
  put(next, "downtime", first.downtime);
  put(next, "marched", first.marched);
  return { restored: next };
}
