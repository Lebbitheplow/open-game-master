// How long a spell lasts from the slot it was cast from. Some spells buy a
// longer lifetime with a higher slot (SRD 5.1): Hunter's Mark held 8 hours
// from a 3rd-level slot and 24 from a 5th, Dominate Person 10 minutes from a
// 6th, Geas a year from a 7th and until dispelled from a 9th. The rows say so
// where the SRD is bundled (`durationBySlot`); any other spell's own
// "At Higher Levels" text is read for it. One answer for the concentration
// clock, a buff's condition and a failed save's condition.

import { ROUND_CEILING } from "@/lib/schemas/condition-meta";
import { textKey } from "@/lib/language/text-logic";

// [the slot level it starts at, its rounds or null for "until dispelled"],
// in ascending order.
export type SlotDurations = Array<[number, number | null]>;

const ROUNDS: Record<string, number> = { round: 1, minute: 10, hour: 600, day: 14400, week: 100800, month: 432000, year: 5256000 };
const UNIT = "(round|minute|hour|day|week|month|year)s?";
// "3rd", "5th-level", "9th level", with whatever dash the text was typed with.
const LEVEL = /\b([1-9])(?:st|nd|rd|th)(?=\b|level)/i;
// A sentence about how long the spell lasts, not its damage or its reach.
const SPEAKS_OF_DURATION = /duration|\blasts?\b|concentration|for up to|until (?:it is )?dispelled|permanent|extended/i;

const roundsOf = (count: string | undefined, unit: string) =>
  Math.min(ROUND_CEILING, Number(count ?? 1) * (ROUNDS[unit.toLowerCase()] ?? 1));

// A count in words as well as digits, and a second length joined by "and":
// Mass Suggestion from a 9th-level slot lasts "a year and a day". Read with
// digits only, that sentence said nothing and the 8th level's 30 days stood.
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, thirty: 30 };
const COUNT = `(\\d+|${Object.keys(WORDS).join("|")})`;
const LASTS = new RegExp(`\\b${COUNT}\\s+${UNIT}(?:\\s+and\\s+${COUNT}\\s+${UNIT})?\\b`, "i");
const countOf = (word: string) => (/^\d+$/.test(word) ? Number(word) : (WORDS[word.toLowerCase()] ?? 1));

// The rounds a clause says the spell lasts, or null when it names no length.
function lastsIn(clause: string): number | null {
  const lasts = LASTS.exec(clause);
  if (!lasts) {
    return null;
  }
  const first = countOf(lasts[1]) * (ROUNDS[lasts[2].toLowerCase()] ?? 1);
  const second = lasts[3] && lasts[4] ? countOf(lasts[3]) * (ROUNDS[lasts[4].toLowerCase()] ?? 1) : 0;
  return Math.min(ROUND_CEILING, first + second);
}

// What an "At Higher Levels" text says about the duration: lifetimes from a
// slot level up, and a lifetime added for each slot level above one. A
// cantrip's growth with its caster ("when you reach 5th level") is no slot's.
export function slotDurationsFromText(text: string): { at: SlotDurations; each: { above: number; rounds: number } | null } {
  const at: SlotDurations = [];
  let each: { above: number; rounds: number } | null = null;
  const first = text.split(/\n\s*\n|\*\*\*/)[0] ?? "";
  for (const sentence of first.split(/(?<=[.;])\s+/)) {
    if (/you reach|character level/i.test(sentence) || !SPEAKS_OF_DURATION.test(sentence)) {
      continue;
    }
    const added =
      new RegExp(`(?:by|an additional|additional)\\s+(\\d+\\s+)?${UNIT}[^.]*?for each slot level above ([1-9])`, "i").exec(sentence) ??
      new RegExp(`(\\d+)\\s+${UNIT}\\s+longer[^.]*?for each slot level above ([1-9])`, "i").exec(sentence);
    if (added) {
      each = { above: Number(added[3]), rounds: roundsOf(added[1]?.trim(), added[2]) };
      continue;
    }
    // Planar Binding lists its lengths in one sentence, "to 30 days with a
    // 7th-level slot, to 180 days with an 8th-level slot": each "to" begins
    // a clause of its own, or the 7th and 8th went unread.
    for (const clause of sentence.split(/,\s*(?:or|and)\s+|,\s*(?=[1-9](?:st|nd|rd|th))|,\s*(?=to\s)/i)) {
      const level = LEVEL.exec(clause);
      if (!level) {
        continue;
      }
      // Geas from a 9th-level slot lasts "until it is ended by one of the
      // spells mentioned above": no count, as for "until dispelled".
      if (/until (?:it is )?(?:dispelled|ended)|permanent/i.test(clause)) {
        at.push([Number(level[1]), null]);
        continue;
      }
      const lasts = lastsIn(clause);
      if (lasts !== null) {
        at.push([Number(level[1]), lasts]);
      }
    }
  }
  return { at: at.sort((a, b) => a[0] - b[0]), each };
}

// The slot from which a concentration spell is held without it (SRD 5.1):
// Bestow Curse, "Using a spell slot of 5th level or higher grants a duration
// that doesn't require concentration"; Major Image, from a 6th-level slot
// "the spell lasts until dispelled, without requiring your concentration".
// Keyed by the published name a workshop copy runs as.
const HELD_WITHOUT_CONCENTRATION = new Map(Object.entries({ "bestow curse": 5, "major image": 6 }).map(([name, level]) => [textKey(name), level]));

// Whether a casting from `slotLevel` holds the caster's concentration: the
// spell's own flag, less the slots above that free it. The cast set it from
// the flag alone, so a 5th-level Bestow Curse ended the caster's Bless and a
// failed save on the next hit ended the eight-hour curse.
export function concentratesAtSlot(spell: string, printed: boolean, slotLevel: number | null | undefined): boolean {
  const from = HELD_WITHOUT_CONCENTRATION.get(textKey(spell));
  return printed && !(from !== undefined && (slotLevel ?? 0) >= from);
}

// The rounds a spell lasts from `slotLevel`, given what it lasts at its own
// level: the last lifetime the slot reaches, then anything added per level.
// Null is "until dispelled"; `base` when the slot changes nothing.
export function roundsAtSlot(
  base: number | null,
  slotLevel: number,
  scaling: { at: SlotDurations; each?: { above: number; rounds: number } | null },
): number | null {
  let rounds = base;
  for (const [level, lasts] of scaling.at) {
    if (slotLevel >= level) {
      rounds = lasts;
    }
  }
  const each = scaling.each;
  if (each && rounds !== null && slotLevel > each.above) {
    rounds = Math.min(ROUND_CEILING, rounds + each.rounds * (slotLevel - each.above));
  }
  return rounds;
}
