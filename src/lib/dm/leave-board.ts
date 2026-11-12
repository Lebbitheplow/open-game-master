// A character taken out of a running fight whole: their place in the order
// and their token on the board, with the table told. Every door that takes a
// hero off the board goes through here (a companion leaving the party,
// companion-tools.ts removeCompanion; the Fathomless Plunge,
// fathomless-plunge.ts), so the order's turn pointer is kept the one way.
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import { publishPersisted } from "@/lib/events";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";

// Takes the character's order entry and token away; false with no fight on.
// Imports nothing of enemy-damage.ts (mutations -> companion-tools ->
// enemy-damage -> mutations would close a cycle), so the state is published
// here as enemy-damage's publishEncounter would.
export function takeOffBoard(campaignId: string, sheetId: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return false;
  }
  const index = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === sheetId);
  if (index !== -1) {
    encounter.order.splice(index, 1);
    if (index < encounter.turnIndex) {
      encounter.turnIndex -= 1;
    } else if (index === encounter.turnIndex) {
      encounter.turnIndex = Math.max(0, encounter.turnIndex - 1);
    }
    saveEncounter(encounter);
    publishPersisted(campaignId, "encounter_updated", { encounter: activePublicEncounter(campaignId) });
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (map) {
    removeTokenByRef(map.id, sheetId);
    publishBattleMapUpdate(campaignId);
  }
  return true;
}
