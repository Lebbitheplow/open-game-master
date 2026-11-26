// A push that names a mounted character (issue 1055, ruling 6, for players).
//
// "The rider is pushed out of the saddle, and the mount stays. A push moves
// the creature it targets. The mount-moved clause applies only when the mount
// moves. Moving the mount when the rider was the target would move a creature
// the effect never touched. So when a push or pull names the rider, the rider
// ends up where the push ends and lands prone ... If the push would end
// inside a Large mount's space, use the nearest open square just outside it.
// The rider gets no extra DC 10 save: it already resisted the push with its
// own save or contest."
//
// A character and their mount stand on the character's one token, so a push,
// a pull or a forced move_token of that token moved the pair and asked the
// save to stay on, whoever it was aimed at (mount-moved.ts). The engine can
// tell the two apart by the id the push was given: the character's own is the
// rider, and a creature mount that keeps its own turn answers to its own
// (db/battle-maps.ts getTokenByRef), which is the mount moved, as before.
//
// Must not import map-tools, zone-triggers or encounter-tools: they call in.

import { footprintIndexes } from "@/lib/battlemap/footprint";
import { forgetMoves } from "@/lib/battlemap/move-undo";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import type { XY } from "@/lib/battlemap/types";
import { occupiedTiles } from "@/lib/battlemap/view";
import { listTokens, moveToken, placeToken, setTokenMovement, type BattleMap } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getMounts, setMount } from "@/lib/db/mounts";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { tokenFootprint } from "@/lib/dm/board-reach";
import { landsOnFeet } from "@/lib/dm/fall-landing";
import { currentTurnId } from "@/lib/dm/job-control";
import { tellOfRider } from "@/lib/dm/mount-moved";
import { isProne } from "@/lib/dm/mount-thrown";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { flightOf } from "@/lib/dm/token-state";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { standBesideRider } from "@/lib/dm/summon-store";

// The effect named the rider: they leave the saddle for `at`, or for the open
// square nearest it when the space their mount stays in, or anyone else,
// holds that square, and land prone there (on their feet with Born to the
// Saddle, off a mount on the ground). The mount stays where the pair stood: a
// creature on a token of its own, with its turn. Returns where the rider
// landed, or null when this character rides nothing or stands on no board.
// What happened is told to the GM as the call finishes (mount-tools.ts
// settleMovedRiders).
//
// `draggedBy` is the grappler dragging them along (drag-move.ts): the same
// way out of the saddle, but a drag knocks nobody prone, so they are set down
// standing, still held.
export function pushedFromSaddle(campaign: Campaign, map: BattleMap, riderId: string, at: XY, how: { draggedBy?: string } = {}): { at: XY } | null {
  const mount = getMounts(campaign.id)[riderId];
  const sheet = mount ? getSheetById(riderId) : null;
  const tokens = listTokens(map.id);
  const token = tokens.find((entry) => entry.refId === riderId);
  if (!mount || !sheet || !token) {
    return null;
  }
  const stood = { x: token.x, y: token.y };
  // Off a mount in the air, a rider with no flight of their own falls: the
  // token comes down (token-state.ts landTheFlightless). The board keeps no
  // height, so the fall's damage is the GM's apply_hazard falling.
  const falls = token.movement === "fly" && flightOf(map.encounterId, token) === null;
  // Everyone else's whole space, and the mount's own: it stays in it.
  const taken = occupiedTiles(map, tokens, token, tokenFootprint);
  for (const cell of footprintIndexes(map.width, stood, tokenFootprint(token))) {
    taken.add(cell);
  }
  const [spot] = findSpawnTiles(map.terrain, map.width, map.height, taken, 1, [at], []);
  // No open square anywhere: they come down where the pair stood.
  const landed = spot ?? stood;
  setMount(campaign.id, riderId, null);
  // A walk made in the saddle is not taken back on foot (move-undo.ts): it
  // would set one square down where the pair's space began.
  forgetMoves(map.encounterId);
  moveToken(token.id, landed.x, landed.y, token.movedThisRound);
  if (falls) {
    setTokenMovement(token.id, "walk");
  }
  // A mount that is a creature has its own token and turn again, and keeps
  // the square the pair's space began on.
  const steed = mount.sheetId ? getSheetById(mount.sheetId) : null;
  if (steed) {
    standBesideRider(campaign, sheet, steed);
    const own = listTokens(map.id).find((entry) => entry.refId === steed.id);
    if (own && (own.x !== stood.x || own.y !== stood.y)) {
      placeToken(own.id, stood.x, stood.y);
    }
  }
  const dragged = how.draggedBy;
  const standing = dragged ? null : landsOnFeet(sheet, { offMount: true, feet: token.movement === "fly" ? null : 5 });
  if (!dragged && !standing && !isProne(sheet.conditions)) {
    const turnId = currentTurnId();
    if (turnId) {
      handleSetCondition(campaign, turnId, sheet, { condition: "prone" }, `pushed from ${mount.name}`);
    } else {
      const updated = patchSheet(sheet.id, { conditions: [...sheet.conditions, "prone"] });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
  const seq = tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "cue-travel",
    content: dragged
      ? `${dragged} drags ${sheet.name} out of the saddle; ${mount.name} stays.`
      : `${sheet.name} is knocked out of the saddle${standing ? " and lands on their feet" : falls ? " and falls" : ""}; ${mount.name} stays.`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  publishPersisted(campaign.id, "mounts_updated", { mounts: getMounts(campaign.id) });
  const left = `${mount.name} stays where the pair stood${steed ? ", riderless, on a token of its own, with a turn of its own" : ""}.${falls ? ` They came off ${mount.name} in the air: if it flew high, send apply_hazard falling with the feet for the fall's damage.` : ""}`;
  if (dragged) {
    tellOfRider(
      campaign.id,
      `${dragged} drags ${sheet.name} out of the saddle: they stand at (${landed.x},${landed.y}), still grappled, no longer mounted, with no save to stay on, as the grapple holds the rider and the mount was not moved. ${left}`,
    );
    return { at: landed };
  }
  tellOfRider(
    campaign.id,
    `${sheet.name} is taken out of the saddle and lands ${standing ? `on their feet (${standing})` : "prone"} at (${landed.x},${landed.y}), no longer mounted, with no save to stay on: the effect named the rider, who already resisted it. ${mount.name} stays where the pair stood${steed ? ", riderless, on a token of its own, with a turn of its own" : ""}.${falls ? ` They fell from ${mount.name} in the air: if it flew high, send apply_hazard falling with the feet for the fall's damage.` : ""}`,
  );
  return { at: landed };
}
