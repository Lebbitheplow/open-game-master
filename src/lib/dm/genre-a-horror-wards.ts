// The horror classes' rules on a teleport (WAVE2 D5), asked by the one place
// teleports are judged (src/lib/dm/map-tools.ts handleTeleportToken):
//   Warden of the Threshold (occultist 15): "Creatures cannot teleport into
//     or out of a 30-ft radius around you unless you allow it". The warden
//     allows their own side: a creature fighting the party is refused a jump
//     that crosses the radius either way (one that starts and ends inside it,
//     or outside it, crosses nothing). A warden at 0 hit points wards nothing.
//   Walk Between (occultist 11): "teleport 60 ft to a space you can see": a
//     square with no line of sight from where the occultist stands is refused.
import { getTokenByRef, type BattleMap } from "@/lib/db/battle-maps";
import type { BattleToken } from "@/lib/battlemap/types";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { hasLineOfSightBetween } from "@/lib/battlemap/los";
import { spaceOf, tilesApart } from "@/lib/dm/board-reach";
import { sideOf } from "@/lib/dm/combatant";
import type { ToolError } from "@/lib/dm/tool-errors";
import { sightTerrainFor } from "@/lib/dm/zone-rules";
import { isNamed } from "@/lib/srd/feature-names";
import { horrorHolds } from "@/lib/srd/genre-a-horror-holds";

const WARDEN_TILES = 6;

export function horrorTeleportRefusal(
  campaignId: string,
  map: BattleMap,
  token: BattleToken,
  to: { x: number; y: number },
  spell: string | undefined,
): ToolError | null {
  const landed = { ...token, x: to.x, y: to.y };
  if (spell && isNamed(spell, "Walk Between") && !hasLineOfSightBetween(sightTerrainFor(map), map.width, spaceOf(token), spaceOf(landed))) {
    return { error: `(${to.x},${to.y}) is not a space ${token.name} can see from where they stand, and Walk Between goes only to one they can. Pick a square in sight.`, retry: true };
  }
  if (token.kind !== "enemy") {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  for (const stale of listSheets(campaignId)) {
    const warden = getSheetById(stale.id) ?? stale;
    const at = warden.currentHp > 0 && horrorHolds(warden, "Warden of the Threshold") ? getTokenByRef(map.id, warden.id) : null;
    if (!at) {
      continue;
    }
    // A creature fighting on the warden's side is one the warden allows.
    if (encounter && sideOf(encounter, "enemy", token.refId) === sideOf(encounter, "sheet", warden.id, warden)) {
      continue;
    }
    const from = tilesApart(at, token) <= WARDEN_TILES;
    const into = tilesApart(at, landed) <= WARDEN_TILES;
    if (from !== into) {
      return {
        error: `${token.name} cannot teleport ${into ? "into" : "out of"} the 30 feet around ${warden.name}: Warden of the Threshold holds the Veil shut there. It may teleport without crossing that radius, or move on foot.`,
        refused: "rules",
      };
    }
  }
  return null;
}
