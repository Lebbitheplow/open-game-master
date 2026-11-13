// How the steampunk classes walk the board (WAVE2 D5: the genre text is the
// rule, played on the SRD 5.1 engine):
//
//   Rigging Runner (aeronaut 2)          "Climbing costs no extra movement"
//   Master of the High Wire (aeronaut 18) "difficult terrain never slows you"
//   Juggernaut Frame (steam knight 14)   "Your speed cannot be reduced;
//                                         difficult terrain never slows you
//                                         while armored"
//
// src/lib/battlemap/passage.ts pcMoveTraits reads steampunkStride, as it reads
// Athlete's climb: a climb square costs a foot a foot (`climbs`), and difficult
// ground of any kind, a spell's area and a Wall of Muscle or a Hold the Line
// included, costs no extra (`anyGround`, which src/lib/dm/zone-rules.ts
// withZoneSteps also reads). Juggernaut Frame's speed is read where
// Unstoppable's is (src/lib/srd/genre-b-post-apocalyptic.ts speedCannotBeReduced).
//
// Before this each was its sentence in the GM's prompt, and the board charged
// an aeronaut double for a rope and the knight double for rubble.
//
// Pure; no database.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isWorn, matchArmor } from "@/lib/srd/armor";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

// Any sheet-shaped walker: the board's mover carries only some of a sheet.
export type StrideHolder = { features: Array<{ name: string }>; class?: string; classes?: Array<{ id: string }>; equipment?: ReadonlyArray<object> };

// Any body armor on (a shield is not armor the frame is built into).
function armored(sheet: StrideHolder): boolean {
  const items = (sheet.equipment ?? []) as CharacterSheet["equipment"];
  return items.some((item) => {
    const category = item.gear?.armor?.category ?? matchArmor(item)?.category;
    return isWorn(item, items) && (category === "light" || category === "medium" || category === "heavy");
  });
}

const holds = (sheet: StrideHolder, classId: string, name: string) => Boolean(sheet.class) && holdsGenreFeature(sheet as unknown as Pick<CharacterSheet, "class" | "features">, classId, name);

export function steampunkStride(sheet: StrideHolder): { anyGround: boolean; climbs: boolean } {
  return {
    anyGround: holds(sheet, "aeronaut", "Master of the High Wire") || (holds(sheet, "steam_knight", "Juggernaut Frame") && armored(sheet)),
    climbs: holds(sheet, "aeronaut", "Rigging Runner"),
  };
}

// Juggernaut Frame: "Your speed cannot be reduced".
export function frameSpeedWhole(sheet: StrideHolder): boolean {
  return holds(sheet, "steam_knight", "Juggernaut Frame");
}
