// What a monk's or a rogue's subclass reads of the board when a check is
// rolled (wave 2, part mr). The authored layer's gates are words about the
// sheet (authored-effects.ts gateHolds), and "after moving no more than half
// your speed on your turn" (Steady Eye) is a fact of the board: the roll
// door hands the readers the sheet with that fact written as a condition of
// the moment, never stored, and the row gates on it.
//
// src/lib/dm/roll-feature-riders.ts calls withMovementFacts where it reads
// the authored riders of a check.

import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

// The mover has gone farther this turn than half their walking speed.
export const MOVED_PAST_HALF = "moved past half speed";

// Only a sheet with a feature that asks (Steady Eye: authored-effects-data3.ts
// gates on the mark) has the board read for it: every other roll, and a roll
// resolved with no table behind it, reads no encounter.
const ASKS_MOVEMENT = ["Steady Eye"];

export function withMovementFacts<T extends Pick<CharacterSheet, "id" | "campaignId" | "conditions" | "speed" | "features">>(sheet: T): T {
  if (!ASKS_MOVEMENT.some((name) => holdsFeature(sheet, name))) {
    return sheet;
  }
  const encounter = getActiveEncounter(sheet.campaignId);
  // Out of a fight nobody counts a turn's movement.
  if (!encounter || (encounter.kind ?? "fight") !== "fight") {
    return sheet;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!token || token.movedThisRound * 5 * 2 <= sheet.speed) {
    return sheet;
  }
  return { ...sheet, conditions: [...sheet.conditions, MOVED_PAST_HALF] };
}
