// Road Rage (road warrior 14): "1/rest, when an ally within 30 ft drops to 0
// HP, immediately move your speed and make one attack"
// (src/lib/classes/post-apocalyptic-features.json; WAVE2 D5: the genre text is
// the rule, played on the SRD 5.1 engine).
//
// The drop is the trigger: as a character falls to 0 (src/lib/dm/death.ts
// calls roadRageWakes), every road warrior of their side within 30 feet with
// a use left is marked "road rage" for the round. The mark lets the warrior
// walk off their own turn (src/lib/dm/map-tools.ts move_token, as a readied
// move does) and answers use_reaction "Road Rage" with one weapon attack
// (authored-effects-genre-gb.ts, the attack spending the use).
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { tilesApart } from "@/lib/dm/board-reach";
import { sideOf } from "@/lib/dm/combatant";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { ROAD_RAGE } from "@/lib/srd/genre-gb-conditions";

const POOL = "post_apocalyptic_road_rage";
const REACH_TILES = 6;

export function roadRageWakes(campaign: Campaign, fallen: CharacterSheet): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter) {
    return [];
  }
  const side = sideOf(encounter, "sheet", fallen.id, fallen);
  const at = map ? getTokenByRef(map.id, fallen.id) : null;
  const out: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    if (stale.id === fallen.id) {
      continue;
    }
    const warrior = getSheetById(stale.id) ?? stale;
    const pool = warrior.resources?.[POOL];
    if (!pool || pool.used >= pool.max || warrior.currentHp <= 0 || !holdsGenreFeature(warrior, "road_warrior", "Road Rage")) {
      continue;
    }
    if (sideOf(encounter, "sheet", warrior.id, warrior) !== side) {
      continue;
    }
    const own = map ? getTokenByRef(map.id, warrior.id) : null;
    if (map && at && own && tilesApart(own, at) > REACH_TILES) {
      continue;
    }
    patchSheet(warrior.id, {
      conditions: [...warrior.conditions.filter((entry) => entry !== ROAD_RAGE), ROAD_RAGE],
      conditionMeta: { ...(warrior.conditionMeta ?? {}), [ROAD_RAGE]: { rounds: 1, source: "Road Rage" } },
    });
    out.push(`${warrior.name}'s Road Rage: ${fallen.name} is down within 30 feet, so ${warrior.name} may move their speed now (move_token) and make one attack (use_reaction "Road Rage" with the targetEnemyId).`);
  }
  return out;
}

export const roadRaging = (sheet: Pick<CharacterSheet, "conditions">): boolean => sheet.conditions.includes(ROAD_RAGE);
