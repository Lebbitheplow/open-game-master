// What holds a character of the mystery or post-apocalyptic classes up as a
// blow would drop them to 0 hit points (WAVE2 D5), spent by the damage path
// itself as Undying Sentinel's use is (src/lib/dm/pc-damage.ts asks here once,
// after Death Ward and Undying Sentinel, before Relentless Endurance):
//
//   Hard to Kill (enforcer)          "when you drop to 0 HP, drop to 1
//                                    instead", the enforcer's own use
//   Stand at the Dawn (waste         "when an ally within 30 ft drops to 0 HP,
//     preacher)                      they instead drop to WIS-mod x 5 HP", the
//                                    preacher's use, the preacher conscious
//                                    and on the ally's side
//   Pack Endurance (packmaster)      "the same holds for you while it lives":
//                                    the packmaster's use, their beast alive
//                                    (genre-b-post-apocalyptic-beast.ts)
//
// A new hold of this kind is a branch here, never a check in pc-damage.ts.
import { spendGenreHold } from "@/lib/srd/genre-b-counter-terms";
import { nearbyHolders } from "@/lib/dm/genre-b-auras";
import { packmasterHold } from "@/lib/dm/genre-b-post-apocalyptic-beast";
import { computeSheetDerived } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Uses = Record<string, { max: number; used: number }>;

export type GenreDropHold = {
  name: string;
  hp: number;
  // The fallen character's counters after the spend, when the use was theirs.
  resources?: Uses;
  // Whose use it was, when another character's (the preacher's).
  giver?: { id: string; name: string; resources: Uses };
};

const STAND_AT_THE_DAWN = "post_apocalyptic_stand_at_the_dawn";

export function genreDropHold(campaignId: string, sheet: CharacterSheet): GenreDropHold | null {
  const own = spendGenreHold(sheet.resources as Uses | undefined);
  if (own) {
    return { name: own.name, hp: 1, resources: own.resources };
  }
  // Pack Endurance: "the same holds for you while it lives".
  const pack = packmasterHold(campaignId, sheet);
  if (pack) {
    return { name: pack.name, hp: 1, resources: pack.resources };
  }
  for (const preacher of nearbyHolders(campaignId, sheet, "waste_preacher", "Stand at the Dawn", 30)) {
    const state = (preacher.resources as Uses | undefined)?.[STAND_AT_THE_DAWN];
    if (!state || state.used >= state.max) {
      continue;
    }
    const wis = computeSheetDerived(preacher).abilityMods.wis ?? 0;
    return {
      name: "Stand at the Dawn",
      hp: Math.max(1, wis * 5),
      giver: { id: preacher.id, name: preacher.name, resources: { ...(preacher.resources as Uses), [STAND_AT_THE_DAWN]: { max: state.max, used: state.used + 1 } } },
    };
  }
  return null;
}
