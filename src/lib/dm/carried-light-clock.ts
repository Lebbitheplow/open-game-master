import { getActiveBattleMap, sheetDarkvisionTiles } from "@/lib/battlemap/view";
import { listSheets } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { burningSource, lightIn, putOutIn } from "@/lib/dm/carried-light-logic";
import { burnOutLight } from "@/lib/dm/light-timers";
import { offBoardAmbient } from "@/lib/dm/place-light";
import { MINUTES_PER_DAY } from "@/lib/dm/calendar";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

// The game clock burns every lit carried light, on the board and off it
// alike: a rest, a road or a wait spends a torch's hour as a fight does
// (SRD 5.1, Adventuring Gear: "A torch burns for 1 hour"; a lantern "burns
// for 6 hours on a flask (1 pint) of oil"). Before, a torch burned only while
// a board was out, and the next board lit a fresh one, so a party never used
// one up (src/lib/dm/carried-light-logic.ts).
//
// Off the board the server keeps the light as the party would:
//  - put out where the place is in bright light as the time begins, keeping
//    the burn it has left;
//  - lit in a place dark at every hour (an unlit dungeon or cave) by each
//    living, waking bearer who cannot see in the dark, and the next lit as
//    one gutters, unless the time is a rest. A party walking at night under
//    the sky, or sleeping, lights nothing new; what is already lit burns on.
//
// `resting`: the time is a short or long rest (take_rest).
export function burnCarriedLights(campaignId: string, from: number, to: number, resting = false) {
  const offBoard = !getActiveBattleMap(campaignId);
  const ambient = offBoard ? offBoardAmbient(campaignId, null, from) : null;
  // Noon of the day the time began: a place dark then is dark at every hour.
  const darkAllDay = offBoard && !resting && offBoardAmbient(campaignId, null, Math.floor(from / MINUTES_PER_DAY) * MINUTES_PER_DAY + 720) === "dark";
  for (const stale of listSheets(campaignId)) {
    const found = burningSource(stale.equipment);
    if (!found || found.source.minutes <= 0 || stale.deathSaves?.dead) {
      continue;
    }
    const keepsLit = darkAllDay && seesByTheLight(stale);
    const changed = ambient === "bright" ? putOutIn(stale.equipment, from) : keepsLit ? lightIn(stale.equipment, from) : null;
    if (changed) {
      patchSheetAudited(campaignId, stale.id, { equipment: changed }, {
        kind: "use_item",
        reason: `${found.lamp.name} ${ambient === "bright" ? "put out in the light" : "lit in the dark"}`,
        delta: { item: found.lamp.name, lit: ambient !== "bright" },
      });
    }
    burnOutLight(campaignId, stale.id, to, keepsLit ? () => true : undefined);
  }
}

// A bearer who lights a light to see by: alive, awake, and with no
// darkvision to see in the dark without one.
function seesByTheLight(sheet: CharacterSheet): boolean {
  if (sheet.currentHp <= 0 || sheet.conditions.some((entry) => isConditionNamed(entry, "unconscious"))) {
    return false;
  }
  return sheetDarkvisionTiles(sheet) <= 0;
}
