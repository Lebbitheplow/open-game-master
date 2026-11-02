// People the party already knows when the story begins (issue 731): the
// patron who hires them, an old friend, the mentor who trained them all.
// Pure, so node test scripts load it directly.
//
// Only an author says so, on the person's record in the workshop (or a GM at
// their own table before their first narration), never the engine or the
// AI, and always with how the party knows them. That line opens every hero's bond with them
// as its first memory, so the Bonds panel and the GM read the reason beside
// the standing. The standing stays modest: a tie opens at Neutral, Cordial
// or Friendly, never Close or above and never on the romance ladder (whose
// first rung asks 40, src/lib/dm/relationship-logic.ts). A strong bond is
// earned in play. The mark is the whole party's history: a tie to one hero
// (one character's aunt) is not something an author who never met the
// heroes can write, so it stays in the notes for the table to bind.

import { clipText } from "../language/text-logic.ts";

export const KNOWN_BEFORE_GRADES = ["acquainted", "friend", "close"] as const;
export type KnownBeforeGrade = (typeof KNOWN_BEFORE_GRADES)[number];

export type KnownBefore = { grade: KnownBeforeGrade; how: string };

// The bond's memory line is clipped at 160 characters, so is the reason.
export const KNOWN_BEFORE_HOW_CHARS = 160;

// Where each grade opens the meter: Neutral (they know each other, nothing
// more), Cordial, Friendly. Cordial opens at 10; 15 keeps one small slight
// from dropping a patron back to Neutral before the first scene is over.
export const KNOWN_BEFORE_APPROVAL: Record<KnownBeforeGrade, number> = { acquainted: 0, friend: 15, close: 30 };

// The memory kind a tie's line is kept under.
export const KNOWN_BEFORE_MEMORY = "known_before";

function gradeOf(value: unknown): KnownBeforeGrade | null {
  return KNOWN_BEFORE_GRADES.find((grade) => grade === value) ?? null;
}

// A tie as a form, a bundle or a stored column gives it. Null unless the
// grade is one of the three and the reason says something: no reason, no
// tie.
export function readKnownBefore(raw: unknown): KnownBefore | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as { grade?: unknown; how?: unknown };
  const grade = gradeOf(entry.grade);
  // Cut at a word's edge, as the Bonds tab cuts every memory (issue 644): a
  // long quote from a module's opening would otherwise end mid-word.
  const how = typeof entry.how === "string" ? clipText(entry.how, KNOWN_BEFORE_HOW_CHARS) : "";
  return grade && how ? { grade, how } : null;
}

// A grade chosen with nothing said about how: the one case a form refuses
// rather than drops, since the author meant a tie.
export function knownBeforeMissingHow(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const entry = raw as { grade?: unknown; how?: unknown };
  return gradeOf(entry.grade) !== null && !readKnownBefore(raw);
}

export function parseKnownBefore(column: string): KnownBefore | null {
  if (!column) {
    return null;
  }
  try {
    return readKnownBefore(JSON.parse(column));
  } catch {
    return null;
  }
}

export function knownBeforeColumn(value: KnownBefore | null | undefined): string {
  return value ? JSON.stringify({ grade: value.grade, how: value.how }) : "";
}

export type TieCandidate = {
  id: string;
  name: string;
  attitude: "hostile" | "indifferent" | "friendly";
  archived: boolean;
  knownBefore: KnownBefore | null;
  // A companion already in the party: the sheet is who the heroes travel
  // with, and its bonds open as it joins.
  behindCompanion: boolean;
};

export type Tie = { npcId: string; name: string; grade: KnownBeforeGrade; how: string; approval: number };

// The people whose tie opens as the story begins: marked, and neither
// hostile (a person against the party is nobody's friend from the start),
// set aside, nor travelling with the party already.
export function tiesToOpen(candidates: readonly TieCandidate[]): Tie[] {
  return candidates.flatMap((npc) =>
    npc.knownBefore && !npc.archived && !npc.behindCompanion && npc.attitude !== "hostile"
      ? [{ npcId: npc.id, name: npc.name, grade: npc.knownBefore.grade, how: npc.knownBefore.how, approval: KNOWN_BEFORE_APPROVAL[npc.knownBefore.grade] }]
      : [],
  );
}
