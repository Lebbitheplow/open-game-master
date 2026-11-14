// The scavenger's features that ask whether the party is "in ruins"
// (post-apocalyptic, WAVE2 D5: the genre text is the rule, played on the SRD
// 5.1 engine):
//
//   Trap Eye (scavenger 6)             "+2 initiative in ruins"
//   One With the Ruins (Rustpicker 15)  "In ruins you cannot be surprised,
//                                        tracked, or flanked, and your Scrap
//                                        Sense recharges on any rest"
//
// "In ruins" is the GM's own call on the place, read from what the table
// already records: the current location's ambience bed is "ruins" (the GM's
// set_ambience, src/lib/dm/ambience-tools.ts, offers it; a ruined place is
// set to it as it is entered). Initiative reads it in src/lib/dm/forced-save.ts
// rollExtrasFor, surprise in src/lib/dm/surprise-guard.ts, a creature's
// flanking in src/lib/dm/attack-spatial.ts enemyFlanks. Being tracked is a
// creature's Survival the GM rolls; nothing on the engine tracks a character.
// Scrap Sense's recharge is src/lib/dm/rest-logic.ts's short rest
// (scrapOnAnyRest).
import { getCurrentLocation } from "@/lib/db/locations";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

type Holder = Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>;

const SCRAP_SENSE = "post_apocalyptic_scrap_sense";

export function inRuins(campaignId: string | null | undefined): boolean {
  if (!campaignId) {
    return false;
  }
  const bed = getCurrentLocation(campaignId)?.ambience?.bed ?? "";
  return bed.trim().toLowerCase() === "ruins";
}

// Trap Eye's +2 on the scavenger's initiative in ruins.
export function ruinsInitiative(campaignId: string, sheet: Holder): { bonus: number; note: string } | null {
  return holdsGenreFeature(sheet, "scavenger", "Trap Eye") && inRuins(campaignId) ? { bonus: 2, note: "Trap Eye: +2 initiative in ruins" } : null;
}

// One With the Ruins: in ruins, never surprised and never flanked.
export function oneWithTheRuins(sheet: Holder & { campaignId?: string }): boolean {
  return holdsGenreFeature(sheet, "scavenger", "One With the Ruins") && inRuins(sheet.campaignId);
}

// "your Scrap Sense recharges on any rest": the short rest gives it back too.
export function scrapOnAnyRest(sheet: Holder, resources: CharacterSheet["resources"] | undefined): CharacterSheet["resources"] | null {
  const scrap = resources?.[SCRAP_SENSE];
  if (!resources || !scrap || scrap.used <= 0 || !holdsGenreFeature(sheet, "scavenger", "One With the Ruins")) {
    return null;
  }
  return { ...resources, [SCRAP_SENSE]: { ...scrap, used: 0 } };
}
