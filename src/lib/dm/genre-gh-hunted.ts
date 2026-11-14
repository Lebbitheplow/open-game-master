// Hunted Instincts (apostate 7): "Advantage on initiative when cultists or
// their summonings are present; you cannot be surprised by them" (cc1113
// genre-c pass). The surprise half is the no_surprise row
// (src/lib/srd/authored-effects-genre-a.ts, cultist and cult fanatic slugs);
// this is the initiative half, read by the one door every initiative roll
// takes (src/lib/dm/forced-save.ts rollExtrasFor), at the opening roll of a
// fight (the enemies are in the encounter by then) and at any later one.
//
// A cultist is a humanoid, so its type says nothing and its stat block's
// slug does (the same slugs as the surprise half). "Their summonings": a
// creature the GM marks "summoned" in a fight a cultist stands in, or after
// the cultists fell; the engine keeps no other record of who called a foe.
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { textKey } from "@/lib/language/text-logic";

const CULT_SLUGS = ["cultist", "cult_fanatic"];

type Holder = Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>;
type Present = { slug?: string; conditions?: readonly string[]; currentHp?: number };

export function cultPresent(foes: readonly Present[]): boolean {
  return foes.some((foe) => (foe.currentHp ?? 1) > 0 && (CULT_SLUGS.includes(textKey(foe.slug ?? "")) || (foe.conditions ?? []).some((name) => textKey(name) === "summoned")));
}

export function huntedInstinctsAdvantage(campaignId: string, sheet: Holder): string | null {
  if (!holdsGenreFeature(sheet, "apostate", "Hunted Instincts")) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  return encounter && cultPresent(listEnemies(encounter.id)) ? "Hunted Instincts: advantage on initiative with cultists or their summonings present" : null;
}
