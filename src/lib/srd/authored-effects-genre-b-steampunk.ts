// The steampunk classes' features built in wave 2's fifth round (WAVE2 D5:
// "The genre classes' text is the rule, played on the SRD 5.1 engine"), kept
// apart from authored-effects-genre-b.ts so the mystery and post-apocalyptic
// rounds, which run beside this one, never append to the same array. Rows are
// found by feature name with `classes` naming the class they belong to, as
// that file's are; their text is src/lib/classes/steampunk-features.json.
//
// Pure data; no database.
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

export const GENRE_B_STEAMPUNK_AUTHORED: GenreRow[] = [];
