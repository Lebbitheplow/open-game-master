// A descriptive line a tool keeps for recall or display (a reason, a note, a
// trait, a motive, a caption): one that runs past its length is fitted at a
// word, as a relationship note is (src/lib/dm/relationship-note.ts, issue
// 634), instead of refusing the whole call: a reason a few words past its
// limit cost the adjust_reputation it explained, with nothing done and a
// fixed "needs ..." line that named fields the call already had.
// Only text far past any line is refused. Names, ids and anything the engine
// matches against a record are never fitted: those are refused with the
// reason (src/lib/dm/tool-errors.ts invalidArguments).
import { z } from "zod";
import { fitName } from "@/lib/schemas/sheet";

export const FITTED_REFUSED_PAST = 4_000;

export function fittedText(max: number) {
  return z
    .string()
    .max(FITTED_REFUSED_PAST)
    .transform((value) => fitName(value, max));
}

// The same, for a line the call must carry: empty words are refused.
export function fittedLine(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(FITTED_REFUSED_PAST)
    .transform((value) => fitName(value, max));
}
