// An entry's reading and needs for whoever asks (the search labels, the
// picker filters, the best-effort note): stored when the pack has them
// current (src/lib/content/pack-readings.ts), else read live with the same
// readers the build ran. Apart from pack-readings.ts so the content index,
// which the readers' own imports reach, never imports the readers back.

import { readEntry } from "@/lib/content/entry-reading";
import { storedReading } from "@/lib/content/pack-readings";
import type { EntryReading, ReadingKind, ReadingRow } from "@/lib/content/reading-logic";

// A row's reading, stored when the pack has it current, else read live
// with the same reader the build ran.
export function readingOf(kind: ReadingKind, row: ReadingRow): EntryReading {
  return storedReading(kind, row.slug) ?? readEntry(kind, row);
}

