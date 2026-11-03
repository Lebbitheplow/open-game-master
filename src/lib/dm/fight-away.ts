import { getBattleMapForEncounter, getTokenByRef, insertToken, listTokens } from "@/lib/db/battle-maps";
import { setEncounterAway, type Encounter } from "@/lib/db/encounters";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { carriedLightFields, publishBattleMapUpdate } from "@/lib/dm/map-tools";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A character start_encounter left out arrives (issue 740): their initiative
// roll takes them off the list, and they stand on the board beside the party,
// as a companion joining a fight does. Without the token they held a place in
// the order and had nowhere to stand: the board said there was no token for
// them, and every reach measured from them failed.
export function arriveAtFight(campaignId: string, encounter: Encounter, sheet: CharacterSheet) {
  if (!encounter.awayIds.includes(sheet.id)) {
    return;
  }
  encounter.awayIds = encounter.awayIds.filter((id) => id !== sheet.id);
  setEncounterAway(encounter.id, encounter.awayIds);
  const map = getBattleMapForEncounter(encounter.id);
  if (!map || getTokenByRef(map.id, sheet.id)) {
    return;
  }
  const tokens = listTokens(map.id);
  const [spot] = findSpawnTiles(
    map.terrain,
    map.width,
    map.height,
    occupiedTiles(map, tokens, null),
    1,
    tokens.filter((token) => token.kind === "pc").map((token) => ({ x: token.x, y: token.y })),
    tokens.filter((token) => token.kind === "enemy").map((token) => ({ x: token.x, y: token.y })),
  );
  if (spot) {
    insertToken({ mapId: map.id, campaignId, kind: "pc", refId: sheet.id, name: sheet.name, x: spot.x, y: spot.y, ...carriedLightFields(campaignId, sheet) });
    publishBattleMapUpdate(campaignId);
  }
}
