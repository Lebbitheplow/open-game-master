// The horror classes' features built in the fifth genre-a round (WAVE2 D5:
// "The genre classes' text is the rule, played on the SRD 5.1 engine"), as
// the authored layer's rows. Registered with one line in
// authored-effects-genre-a.ts, so the three genre branches never append to
// the same array. A row whose rule an engine outside this layer applies names
// that engine (`heldBy`); the readers find it through
// src/lib/srd/genre-a-horror-holds.ts.
//
// The text each row holds is src/lib/classes/horror-features.json; the ledger
// (scripts/clauses/genre-horror.json) says which clause each row holds.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const held = (classId: string, feature: string, file: string, call: string, more: Partial<AuthoredEntry> = {}): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", heldBy: { file, call }, ...more },
});

export const GENRE_A_HORROR: GenreRow[] = [
  // "Advantage on death saves; stabilizing you takes no check"
  held("survivor", "Death's Old Acquaintance", "src/lib/dm/death.ts", "horrorDeathSaveAdvantage"),
];
