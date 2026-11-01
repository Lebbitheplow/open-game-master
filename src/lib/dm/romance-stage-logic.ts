import { namesRomance } from "./advance-logic.ts";
import { ROMANCE_LABEL, romanceIndex, type RelationshipStatus, type RomanceStage } from "./relationship-logic.ts";

// A romance's rung moving, said where the table can see it (issue 640). In
// two playtests nobody at the table heard of a stage change, a wedding
// included: the only sign was a chip on the Bonds tab, and a romance that
// slipped back did so in silence, with nothing in the GM's note either. The
// server says each one in a table line, the way it says a companion's
// ultimatum (issue 615), and tells whoever made the call when one cooled.
// Pure: the database side is romance-stage-lines.ts.

export type Rung = { romance: RomanceStage; status: RelationshipStatus; died: boolean };

export type RungChange =
  | { kind: "up"; to: Exclude<RomanceStage, "none"> }
  | { kind: "down"; from: Exclude<RomanceStage, "none">; to: RomanceStage }
  | { kind: "over"; from: Exclude<RomanceStage, "none"> };

// What moved between two readings of one bond, or null. A parting leaves the
// rung where it was (they are what they were, out of reach), so it says
// nothing. A death closes the bond but is the story's own moment, narrated as
// one, never a line about a romance; and a bond already over says nothing
// more.
export function rungChange(before: Rung, after: Rung): RungChange | null {
  if (before.status === "ended" || after.died) {
    return null;
  }
  if (after.status === "ended") {
    return before.romance === "none" ? null : { kind: "over", from: before.romance };
  }
  const moved = romanceIndex(after.romance) - romanceIndex(before.romance);
  if (moved > 0 && after.romance !== "none") {
    return { kind: "up", to: after.romance };
  }
  if (moved < 0 && before.romance !== "none") {
    return { kind: "down", from: before.romance, to: after.romance };
  }
  return null;
}

// What a rung that cooled no longer is, in the table's words.
const NO_LONGER: Record<Exclude<RomanceStage, "none">, string> = {
  interested: "drawn to each other",
  courting: "courting",
  together: "partners",
  betrothed: "betrothed",
  married: "married",
};

// The table's line. A step up reads in the words the story log already
// keeps for it (relationship-subject.ts defaultMilestoneText, issue 649:
// "Vex and Sir Ivo Ashford were married"), handed in by the caller, so the
// transcript and the Log agree.
export function rungLine(change: RungChange, character: string, subject: string, stepWords: (stage: RomanceStage) => string): string {
  switch (change.kind) {
    case "up":
      return `${stepWords(change.to)}.`;
    case "down":
      return `Things have cooled between ${character} and ${subject}: they are no longer ${NO_LONGER[change.from]}.`;
    case "over":
      return `The romance between ${character} and ${subject} is over.`;
  }
}

// What whoever made the call is told when a romance cooled: the GM's note
// used to say nothing of it, so a slip went unplayed. A step up and an
// ending are already the call's own note.
export function cooledNote(change: RungChange, character: string, subject: string): string | null {
  if (change.kind !== "down") {
    return null;
  }
  const now = change.to === "none" ? "" : ` (now ${ROMANCE_LABEL[change.to]})`;
  return `The romance between ${character} and ${subject} has cooled: they are no longer ${NO_LONGER[change.from]}${now}. The table was told; play the distance between them.`;
}

// Whether this table hears romance lines at all, by the settings it already
// has (no setting of its own). Romance off: the ladder is not played, and a
// rung left from before it went off slips without a word. A safety line drawn
// at romance keeps it off the page in any form (safety-logic.ts), a table
// line included; a veil allows the summary after the fact a line is, and a
// family table hears of a wedding as any other does.
export function romanceLinesAllowed(settings: {
  relationships?: string;
  romance?: string;
  safety?: { lines?: readonly string[] } | null;
}): boolean {
  if (settings.relationships === "off" || settings.romance === "off") {
    return false;
  }
  return !(settings.safety?.lines ?? []).some(namesRomance);
}
