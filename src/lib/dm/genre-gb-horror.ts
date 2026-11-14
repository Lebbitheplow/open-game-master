// Horror features wired in the cc1113 genre-b pass (WAVE2 D5: the genre text
// is the rule, played on the SRD 5.1 engine).
//
//   Light Against the Dark (exorcist 7, Order of the Candle)  "Your light
//     reveals invisible and ethereal creatures within 10 ft"
//
// While the exorcist carries a lit light (src/lib/dm/light-timers.ts
// carriedLight: a torch, a lamp, a candle), they see invisible and ethereal
// creatures within 10 feet: the reach, in squares, of the truesight the SRD
// engine holds for that sight, read beside Veilsight's by
// src/lib/dm/attack-light.ts characterSenses. Without a light, nothing.
import { carriedLight } from "@/lib/dm/light-timers";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

// The viewer as the senses reader has it: a full sheet carries its gear and
// class, a creature form may carry neither.
type Viewer = Partial<Pick<CharacterSheet, "equipment" | "class" | "classes" | "features" | "conditions">>;

export function candleSightTiles(sheet: Viewer): number {
  if (!sheet.class || !sheet.features || !holdsGenreFeature(sheet as Pick<CharacterSheet, "class" | "features">, "exorcist", "Light Against the Dark")) {
    return 0;
  }
  return carriedLight({ equipment: sheet.equipment ?? [], conditions: sheet.conditions ?? [] }).radius > 0 ? 2 : 0;
}
