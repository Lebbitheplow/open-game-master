// How fast a bond may grow (issue 643), the pure half: the in-game time a
// romance rung needs after the one before it, and how a lasting companion's
// regard for what it holds wears on deeds it has seen honour that value
// again and again. The rim is src/lib/dm/romance-scenes.ts; the scenes a
// companion starts at each rung are romance-scene-logic.ts.
//
// Two romance playtests on 0.31.1 found the pace was the player's alone: a
// companion whose values matched the party's deeds went from strangers to
// devoted in seven deeds, and nothing stopped interested to married inside
// one afternoon. The repeat table already wore down a deed's personality
// read (relationship-logic.ts REPEAT_FACTOR), but the values swing, up to 12
// a deed for a red line, was added after it at full weight every time.
//
// Pure, with relative imports only, so scripts/test-romance-pace.mjs loads it
// directly.

import { REPEAT_FACTOR, ROMANCE_LABEL, type BeatCounts, type RomanceStage } from "./relationship-logic.ts";
import { deedVerdict, type CompanionValue, type CompanionValueId } from "./companion-values-logic.ts";

const HOUR = 60;
const DAY = 24 * HOUR;

// ---- time between rungs ----

// In-game time each rung needs after the step before it, in minutes on the
// campaign's clock. The first rung needs none: no step came before it. A
// day to say aloud what was felt, a few days of courting before partners,
// a week together before a proposal and a week to arrange the wedding:
// eighteen days from first interest to marriage, which a campaign with
// travel and rests passes without trying, and one afternoon never does.
export const STEP_WAIT_MINUTES: Record<RomanceStage, number> = {
  none: 0,
  interested: 0,
  courting: DAY,
  together: 3 * DAY,
  betrothed: 7 * DAY,
  married: 7 * DAY,
};

// Minutes still to wait before `target` may come, 0 when it may come now.
// `steppedAt` is the clock when the last step up was taken; null means it
// was taken before this was recorded, and holds nobody back. A clock wound
// back past the step counts no time as passed.
export function stepWaitLeft(target: RomanceStage, steppedAt: number | null, now: number): number {
  if (steppedAt === null) {
    return 0;
  }
  return Math.max(0, steppedAt + STEP_WAIT_MINUTES[target] - Math.max(now, steppedAt));
}

// A stretch of the clock as a person says it, rounded: "about 3 days",
// "about an hour", "less than an hour".
export function waitWords(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));
  if (value >= 20 * HOUR) {
    const days = Math.max(1, Math.round(value / DAY));
    return days === 1 ? "about a day" : `about ${days} days`;
  }
  if (value >= HOUR) {
    const hours = Math.round(value / HOUR);
    return hours === 1 ? "about an hour" : `about ${hours} hours`;
  }
  return "less than an hour";
}

// The refusal when a step comes too soon: what is held, since when, and
// when the next step can come. `human`: a person at the console, who moves
// the clock by hand rather than with pass_time.
export function tooSoonError(
  character: string,
  subject: string,
  current: RomanceStage,
  target: RomanceStage,
  elapsed: number,
  left: number,
  human: boolean,
): string {
  const since = current === "none" ? "" : ` They became ${ROMANCE_LABEL[current]} ${elapsed < HOUR ? "less than an hour" : waitWords(elapsed)} ago, and this step needs ${waitWords(STEP_WAIT_MINUTES[target])} after that.`;
  const pass = human ? "a rest, a journey, or time moved on the clock" : "travel, a rest, or pass_time";
  return `It is too soon for ${character} and ${subject} to be ${ROMANCE_LABEL[target]}.${since} The next step can come in ${waitWords(left)} of story time (${pass}); play what passes between them meanwhile, as ${subject} wanting more time, not as a no.`;
}

// ---- deeds that honour the same value ----

// How many deeds this pair has already seen honour what this deed honours
// for the companion judging it: for each value it honours, every counted
// beat that honours that value too, and the most of any one value. Mercy
// after freeing captives is the same kind of deed to someone who protects
// the innocent. A faction loyalty is honoured only through the faction a
// deed names, which a count does not keep, so it reads this deed's own
// count. Counts are the bond's beat counters, which halve at each chapter
// close (relationship-tick.ts), so the wear forgives itself across a story.
export function honourRepeats(values: readonly CompanionValue[], beats: BeatCounts, beat: string, faction = ""): number {
  const honoured = deedVerdict(values, beat, "serious", faction).honoured;
  if (!honoured.length) {
    return 0;
  }
  const honoursOf = new Map<string, Set<CompanionValueId>>();
  for (const prior of Object.keys(beats)) {
    honoursOf.set(prior, new Set(deedVerdict(values, prior, "serious").honoured.map((held) => held.value)));
  }
  let most = 0;
  for (const held of honoured) {
    const count =
      held.value === "faction_loyalty"
        ? (beats[beat] ?? 0)
        : Object.entries(beats).reduce((sum, [prior, times]) => sum + (honoursOf.get(prior)?.has(held.value) ? times : 0), 0);
    most = Math.max(most, count);
  }
  return most;
}

// The values swing worn by how often that value was honoured already, on
// the same table the personality read wears by (1, 0.6, 0.3, then nothing).
// Only a warming swing wears: a red line crossed again costs what it did.
export function fadedValueSwing(approval: number, repeats: number): number {
  if (approval <= 0) {
    return approval;
  }
  const factor = REPEAT_FACTOR[Math.min(Math.max(repeats, 0), REPEAT_FACTOR.length - 1)];
  return Math.round(approval * factor);
}
