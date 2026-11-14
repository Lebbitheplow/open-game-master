// What the steampunk classes' reactions do beyond the authored layer's own
// shapes (WAVE2 D5), each called by src/lib/dm/authored-reactions.ts from the
// shape it extends:
//
//   Intercept Protocol (steam knight, Boilerplate Vanguard 7)  "Reaction: swap
//     places with an adjacent ally targeted by an attack; you become the
//     target." take_for_ally moves the blow; swapPlaces moves the two tokens.
//   Capacitor Soul (aether channeler 9)  "absorb it, taking no damage, and
//     regain a 1st-level slot." reduce takes the whole blow off; regainSlot
//     gives the slot back.
//
// Before this the knight took the blow from where they stood, and Capacitor
// Soul's use was spent for its sentence.
import { getBattleMapForEncounter, listTokens, placeToken } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";

// The two characters trade squares. Null with no board up, or with either off it.
export function swapPlaces(campaign: Campaign, encounterId: string, firstId: string, secondId: string): string | null {
  const map = getBattleMapForEncounter(encounterId);
  const tokens = map ? listTokens(map.id) : [];
  const first = tokens.find((token) => token.kind === "pc" && token.refId === firstId);
  const second = tokens.find((token) => token.kind === "pc" && token.refId === secondId);
  if (!first || !second) {
    return null;
  }
  placeToken(first.id, second.x, second.y);
  placeToken(second.id, first.x, first.y);
  publishBattleMapUpdate(campaign.id);
  return "The two trade places on the board.";
}

// One expended slot of the level comes back. Null with none expended.
export function regainSlot(campaign: Campaign, holderId: string, level: number): string | null {
  const sheet = getSheetById(holderId);
  const state = sheet?.spellcasting?.slots?.[String(level)];
  if (!sheet?.spellcasting || !state || state.used <= 0) {
    return null;
  }
  const updated = patchSheet(sheet.id, { spellcasting: { ...sheet.spellcasting, slots: { ...sheet.spellcasting.slots, [String(level)]: { ...state, used: state.used - 1 } } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${sheet.name} regains a level ${level} spell slot.`;
}
