// Funeral March (dirgesinger 14), wired by the 2026-11-13 creator audit's
// second genre pass: "You and allies within 30 ft ignore difficult terrain
// and cannot be slowed while you sing". Singing is a dirge held in
// concentration, the gate Pallbearer's Procession reads
// (src/lib/srd/authored-effects-genre-a.ts SINGING). The terrain half is read
// by crossesAnyGround (src/lib/dm/ar-wbf-feat-turn.ts), which every door that
// prices a character's walk passes on; the slow half by the move budget
// (src/lib/battlemap/view.ts pcMoveBudget), as Unstoppable's whole speed: what
// halves or cuts the speed is passed over, what holds the character in place
// (a grapple, a restraint) still does.
import type { Encounter } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { sideOf } from "@/lib/dm/combatant";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

const MARCH_FT = 30;

export function funeralMarchCovers(encounter: Encounter | null, sheetId: string): boolean {
  if (!encounter) {
    return false;
  }
  const side = sideOf(encounter, "sheet", sheetId);
  return listSheets(encounter.campaignId).some(
    (singer) =>
      singer.currentHp > 0 &&
      Boolean(singer.concentratingOn) &&
      holdsGenreFeature(singer, "dirgesinger", "Funeral March") &&
      (singer.id === sheetId || (sideOf(encounter, "sheet", singer.id, singer) === side && withinFeet(encounter.id, singer.id, sheetId, MARCH_FT))),
  );
}
