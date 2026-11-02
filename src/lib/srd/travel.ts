// Travel rules from the PHB: pace affects passive Perception and stealth, and
// marching more than 8 hours in a day forces a Constitution save each extra
// hour or the traveler gains a level of exhaustion. Pure so scripts/
// test-world.mjs can exercise the save math without a database.

import type { ToolError } from "@/lib/dm/tool-errors";

export type TravelPace = "fast" | "normal" | "slow";

// The passive-Perception consequence and stealth allowance of each pace.
const PACE_EFFECT: Record<TravelPace, { passivePerceptionMod: number; canStealth: boolean }> = {
  fast: { passivePerceptionMod: -5, canStealth: false },
  normal: { passivePerceptionMod: 0, canStealth: false },
  slow: { passivePerceptionMod: 0, canStealth: true },
};

export function paceEffect(pace: TravelPace) {
  return PACE_EFFECT[pace];
}

// How far a pace covers, from the SRD 5.1 "Travel Pace" table. The Day
// column is its own number, not the hour column times 8: a fast day is 30
// miles (not 32) and a slow one 18 (not 16).
const PACE_SPEED: Record<TravelPace, { feetPerMinute: number; milesPerHour: number; milesPerDay: number }> = {
  fast: { feetPerMinute: 400, milesPerHour: 4, milesPerDay: 30 },
  normal: { feetPerMinute: 300, milesPerHour: 3, milesPerDay: 24 },
  slow: { feetPerMinute: 200, milesPerHour: 2, milesPerDay: 18 },
};

export function paceSpeed(pace: TravelPace) {
  return PACE_SPEED[pace];
}

// A normal day of travel is 8 hours; every hour beyond that is a forced march.
export const NORMAL_TRAVEL_HOURS = 8;

// The miles a pace covers in so many hours on open ground in fair weather,
// read off the table as it is printed: the Hour column for a leg shorter than
// a day (never past the Day figure, since 8 fast hours would be 32), the Day
// column for a full 8-hour day, and the Hour column again for each hour past
// it (SRD 5.1, Forced March: "For each additional hour of travel beyond 8
// hours, the characters cover the distance shown in the Hour column").
export function paceMiles(pace: TravelPace, hours: number): number {
  const speed = PACE_SPEED[pace];
  const travelled = Math.max(0, hours);
  if (travelled < NORMAL_TRAVEL_HOURS) {
    return Math.min(speed.milesPerHour * travelled, speed.milesPerDay);
  }
  return speed.milesPerDay + speed.milesPerHour * (travelled - NORMAL_TRAVEL_HOURS);
}

// The hours paceMiles takes to cover so many miles: its inverse. Past what
// the Hour column covers in under a day, the leg is a full day.
function paceHours(pace: TravelPace, miles: number): number {
  const speed = PACE_SPEED[pace];
  if (miles <= Math.min(speed.milesPerHour * NORMAL_TRAVEL_HOURS, speed.milesPerDay)) {
    return miles / speed.milesPerHour;
  }
  if (miles <= speed.milesPerDay) {
    return NORMAL_TRAVEL_HOURS;
  }
  return NORMAL_TRAVEL_HOURS + (miles - speed.milesPerDay) / speed.milesPerHour;
}

// The number of forced-march hours in a day of the given length.
export function forcedMarchHours(totalHours: number): number {
  return Math.max(0, Math.round(Number(totalHours) || 0) - NORMAL_TRAVEL_HOURS);
}

// One stretch of marching the clock keeps: when it ended, how long it was in
// minutes, and who marched it (src/lib/dm/march-state.ts).
export type MarchLeg = { end: number; minutes: number; ids: string[] };

const DAY_MINUTES = 24 * 60;

// The forced-march hours a traveller's leg ending at `end` adds, counted over
// their day before it ends. SRD 5.1, Travel Pace (Forced March): "The table
// assumes that characters travel for 8 hours in day. They can push on beyond
// that limit ... For each additional hour of travel beyond 8 hours". A day is
// the 24 hours before the leg ends, or less when their last long rest ended
// inside them (`restedAt`): two back-to-back 8-hour legs are 16 hours in a
// day, as one 16-hour leg is, and a night's rest gives the next day's march
// its own 8. `earlier` holds the legs they marched. `from` and `to` number
// the hours past 8 this leg adds (from 1 for the ninth), none when `to` is
// below `from`.
export function forcedMarchSpan(earlier: readonly MarchLeg[], end: number, legHours: number, restedAt?: number): { from: number; to: number } {
  // A stop of a night's length (8 hours, a long rest's) between two
  // stretches ends the day before it, whether or not a long rest was taken
  // or granted in it: a night camped with pass_time, or a rest refused by
  // the one-in-24-hours rule, left the next morning's 8 hours a forced march.
  let stopped = Number.NEGATIVE_INFINITY;
  let cursor = end - legHours * 60;
  for (const leg of [...earlier].sort((a, b) => b.end - a.end)) {
    if (cursor - leg.end >= NORMAL_TRAVEL_HOURS * 60) {
      stopped = cursor;
      break;
    }
    cursor = Math.min(cursor, leg.end - leg.minutes);
  }
  const start = Math.max(end - DAY_MINUTES, restedAt ?? end - DAY_MINUTES, stopped);
  const before = earlier.reduce((sum, leg) => sum + Math.max(0, Math.min(leg.end, end) - Math.max(leg.end - leg.minutes, start)), 0) / 60;
  return { from: forcedMarchHours(before) + 1, to: forcedMarchHours(before + legHours) };
}

// The legs still inside the day before `now`, for the clock to keep.
export function legsWithinDay(legs: readonly MarchLeg[], now: number): MarchLeg[] {
  return legs.filter((leg) => leg.end > now - DAY_MINUTES);
}

// The Constitution save DC for the nth forced-march hour. SRD 5.1, Forced
// March: "The DC is 10 + 1 for each hour past 8 hours", so the ninth hour is
// DC 11 and the twelfth DC 14.
export function forcedMarchSaveDc(extraHour: number): number {
  return 10 + Math.max(1, Math.round(Number(extraHour) || 1));
}

// The miles a leg covers: the pace's distance for those hours (paceMiles),
// halved in difficult terrain (SRD 5.1, Difficult Terrain: "you can cover
// only half the normal distance in a minute, an hour, or a day"), times what
// the weather leaves of it. Rounded to the half mile.
export function milesCovered(input: {
  pace: TravelPace;
  terrain?: "normal" | "difficult";
  hours: number;
  weatherFactor?: number;
}): number {
  const factor = (input.terrain === "difficult" ? 0.5 : 1) * (input.weatherFactor ?? 1);
  return Math.round(paceMiles(input.pace, input.hours) * factor * 2) / 2;
}

// One leg of travel from what the DM gave: hours (the miles follow) or miles
// (the hours follow, in whole minutes). A leg is one day's travel, 24 hours
// at most; a longer journey is travelled a day at a time.
export function travelLeg(input: {
  pace: TravelPace;
  terrain?: "normal" | "difficult";
  hours?: number;
  miles?: number;
  weatherFactor?: number;
}): { hours: number; minutes: number; miles: number } | ToolError {
  if (input.miles !== undefined && input.miles > 0) {
    const factor = (input.terrain === "difficult" ? 0.5 : 1) * (input.weatherFactor ?? 1);
    const minutes = Math.ceil(paceHours(input.pace, input.miles / factor) * 60);
    if (minutes > 24 * 60) {
      return {
        error: `${input.miles} miles at a ${input.pace} pace takes ${Math.ceil(minutes / 60)} hours, more than one day's leg. A journey of several days is days, each one 8 hours on the road and a night in camp.`,
        retry: true,
      };
    }
    return { hours: Math.ceil(minutes / 60), minutes, miles: input.miles };
  }
  if (input.hours === undefined) {
    return { error: "travel needs the hours travelled or the miles to cover.", retry: true };
  }
  return { hours: input.hours, minutes: input.hours * 60, miles: milesCovered({ ...input, hours: input.hours }) };
}
