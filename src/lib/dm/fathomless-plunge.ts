// Fathomless Plunge (subclasses.json, warlock, The Fathomless, 14th level):
// "Teleport yourself and up to five willing creatures within 30 feet of you
// to a body of water within a mile". The counter's own spend pays the use and
// the action (mutations.ts use_resource); this is what the use buys.
//
// In a fight everyone who goes leaves the board (leave-board.ts takeOffBoard:
// their place in the order and their token), and a fight with no hero left
// in its order ends with the party fled. Out of a fight there is no board:
// the party within reach goes, and the result names who went for the story.
//
// Who goes: the warlock and the party within 30 feet who can choose to come
// (one at 0 hit points cannot), five at most besides the warlock, in the
// party's order; the result names anyone left behind, so the table can ask
// the GM to change it.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { finishEncounter } from "@/lib/dm/enemy-damage";
import { takeOffBoard } from "@/lib/dm/leave-board";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const PLUNGE = "sub_fathomless_plunge";
const REACH_FEET = 30;
const COMPANIONS = 5;

export function plungeAfterSpend(
  campaign: Campaign,
  turn: DmTurn | null,
  warlock: CharacterSheet,
  counterId: string | undefined,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  if (counterId !== PLUNGE) {
    return {};
  }
  const encounter = getActiveEncounter(campaign.id);
  const party = listSheets(campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => sheet.id !== warlock.id && !sheet.deathSaves?.dead)
    // On the board only those standing on it, within 30 feet; nobody across a
    // swallower's wall (swallow.ts).
    .filter((sheet) => !encounter || (encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === sheet.id) && withinFeet(encounter.id, warlock.id, sheet.id, REACH_FEET)))
    .filter((sheet) => !swallowCoverBetween(warlock.id, sheet.id));
  const able = party.filter((sheet) => sheet.currentHp > 0);
  const going = [warlock, ...able.slice(0, COMPANIONS)];
  const behind = [...party.filter((sheet) => sheet.currentHp <= 0), ...able.slice(COMPANIONS)];
  const names = going.map((sheet) => sheet.name).join(", ");
  const lines = [`Fathomless Plunge: ${names} vanish${going.length === 1 ? "es" : ""} and surface in a body of water within a mile.`];
  if (behind.length) {
    lines.push(`Left behind: ${behind.map((sheet) => `${sheet.name}${sheet.currentHp <= 0 ? " (at 0 hit points, cannot choose to come)" : ""}`).join(", ")}. Five at most go with ${warlock.name}; if they name others, the GM moves them.`);
  }
  if (!encounter) {
    return { plunge: lines.join(" ") };
  }
  for (const sheet of going) {
    takeOffBoard(campaign.id, sheet.id);
  }
  const live = getActiveEncounter(campaign.id);
  const heroesLeft = live?.order.filter((entry) => entry.kind === "pc").length ?? 0;
  if (live && turn && heroesLeft === 0) {
    lines.push("No hero is left in the fight: it ends with the party gone.");
    return { plunge: lines.join(" "), fightEnded: finishEncounter(campaign, turn, live, "party_fled", sheets, sheetsById) };
  }
  lines.push(`They are off the board; the fight goes on for ${heroesLeft === 1 ? "the one hero" : `the ${heroesLeft} heroes`} still in it.`);
  return { plunge: lines.join(" ") };
}
