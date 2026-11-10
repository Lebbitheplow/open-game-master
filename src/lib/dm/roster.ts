import type { Campaign } from "@/lib/db/campaigns";
import { getCampaignById, listMembers } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { fieldedOf } from "@/lib/player-characters";
import { heroFell } from "@/lib/characters/fallen-logic";

// The characters in play (docs/vtt-parity-implementation-plan.md 11.3).
// With one character active per player, a player's other characters wait
// off the board: they are not staged into fights or placed on the map. All
// of them field when the table says so, and companions always do.
export function fieldedSheets(campaign: Campaign, sheets: CharacterSheet[] = listSheets(campaign.id)): CharacterSheet[] {
  if (campaign.gameSettings.multiCharacter !== "one_active") {
    return sheets;
  }
  const active = new Map<string, string>();
  for (const member of listMembers(campaign.id)) {
    active.set(member.userId, member.activeCharacterId);
  }
  return fieldedOf(sheets, "one_active", (userId) => active.get(userId));
}

// Whether the character is in play, for a helper who would answer another's
// roll (after-roll.ts, chronal-shift.ts, foresight.ts): one waiting on the
// bench is off the board and out of the scene, and the player who holds it
// plays only the one fielded (player-characters.ts resolveActionCharacter).
export function inPlay(campaignId: string, sheet: CharacterSheet): boolean {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.gameSettings.multiCharacter !== "one_active" || sheet.isCompanion) {
    return true;
  }
  return fieldedSheets(campaign, listSheets(campaignId).filter((entry) => entry.userId === sheet.userId)).some((entry) => entry.id === sheet.id);
}

// The characters a travel formation arranges (issue 230): the ones in play,
// companions with them. A benched character waits off the road as it waits
// off the board, and one who fell walks nowhere (issue 657): a hazard "at
// the front" struck the dead hero still standing in the marching order while
// their replacement was not placed, and the GM read a corpse in the line.
export function formationPartyIds(campaign: Campaign, sheets: CharacterSheet[]): string[] {
  const fielded = campaign.gameSettings?.multiCharacter === "one_active" ? fieldedSheets(campaign, sheets) : sheets;
  return fielded.filter((sheet) => !heroFell(sheet)).map((sheet) => sheet.id);
}
