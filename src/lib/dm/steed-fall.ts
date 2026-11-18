// The rider of a steed that drops to 0 hit points and disappears.
//
// A steed that is a creature's sheet (mount-link.ts) is hurt through the
// door every sheet is hurt through (pc-damage.ts), and at 0 it disappears
// (summon-store.ts summonAfterDamage), which ends the ride. Only a blow
// aimed at the mount or an area on its rider went on to ask what became of
// the rider (mount-combat.ts riderOfDownedMount). Damage sent to the steed's
// own sheet, an area that named it, or the damage an attack carries on a hit
// left the rider standing where the steed had been, with no reaction spent
// and no fall: "If your mount is knocked prone, you can use your reaction to
// dismount it as it falls and land on your feet. Otherwise, you are
// dismounted and fall prone in a space within 5 feet it" (SRD 5.1, Mounting
// and Dismounting), and a mount that is gone carries nobody.
//
// So the fall is asked where the steed disappears, once, whichever door the
// damage came through. The mount's own doors then take what was decided here
// and do not ask again.
//
// Phantom Steed's horse is the exception its spell writes: "the steed
// gradually fades, giving the rider 1 minute to dismount". Its rider steps
// down.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { mountFalls } from "@/lib/dm/mount-tools";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// What became of each rider, kept for the mount's door that struck the
// steed: keyed by the steed's sheet, which is gone and never names another.
const decided = new Map<string, ToolResult>();
const key = (steedId: string, riderId: string) => `${steedId}:${riderId}`;

// The steed `riders` sat on has just disappeared under them. Returns what
// became of each, for the result of the call that did the damage.
export function ridersFallWith(
  campaign: Campaign,
  turnId: string,
  steed: Pick<CharacterSheet, "id" | "name">,
  fades: boolean,
  riders: readonly string[],
): ToolResult[] {
  if (!riders.length) {
    return [];
  }
  const sheets = listSheets(campaign.id).map((sheet) => getSheetById(sheet.id) ?? sheet);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const turn = getDmTurn(turnId) ?? undefined;
  return riders.flatMap((riderId) => {
    const rider = sheetsById.get(riderId);
    if (!rider) {
      return [];
    }
    const fall: ToolResult = fades
      ? { ok: true, dismounted: steed.name, landed: "on their feet", note: `${steed.name} fades (Phantom Steed), and ${rider.name} has time to step down: no fall, no reaction.` }
      : mountFalls(campaign, rider, steed.name, sheets, sheetsById, turn);
    // A table whose mount doors never ask keeps a handful of these at most.
    if (decided.size > 200) {
      decided.clear();
    }
    decided.set(key(steed.id, riderId), fall);
    return [{ rider: rider.name, ...fall }];
  });
}

// The fall already decided for this rider as the steed went, taken once.
export function takeSteedFall(steedId: string, riderId: string): ToolResult | null {
  const fall = decided.get(key(steedId, riderId)) ?? null;
  decided.delete(key(steedId, riderId));
  return fall;
}
