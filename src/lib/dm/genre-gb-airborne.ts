// Whether a character stands aloft on the board: their token moves by flying
// (src/lib/dm/map-tools.ts set_token_movement). The board keeps no other
// height, so "airborne or elevated" (Greater Daring) is a flying token.
import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";

export function airborneNow(campaignId: string, characterId: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  return Boolean(map && getTokenByRef(map.id, characterId)?.movement === "fly");
}
