// Distance on the live board between creatures of any size (issue #186): an
// ogre fills four squares, and a character against any of them is within 5
// feet of it, not 10 feet from its top-left anchor. An enemy's size is read
// from its stat block; a character on a mount fills the mount's space
// (issue 1055); a character on foot, a companion and an NPC take one square,
// as the movement occupancy already has it (src/lib/battlemap/view.ts
// footprintLookup). The geometry itself is pure and lives in
// src/lib/battlemap/footprint.ts. Must not import encounter-tools, map-tools
// or attack-spatial: they call in here.

import { getEnemy } from "@/lib/db/encounters";
import { getMounts } from "@/lib/db/mounts";
import { getSheetById } from "@/lib/db/sheets";
import type { BattleToken, XY } from "@/lib/battlemap/types";
import {
  footprintDistance,
  enemyFootprint,
  footprintTiles,
  riderFootprint,
  type Footprint,
} from "@/lib/battlemap/footprint";

// A square with the size of what stands on it.
export type Spot = XY & { footprint?: Footprint };

// The space a character's token fills, by their sheet's id: their mount's
// while they ride one, read from the campaign's mount records, so it is the
// record that sizes the token and nothing has to be kept in step when the
// rider gets down, is thrown or loses the mount. One square for anyone on
// foot and for an id that is no sheet's. A creature that carries a rider
// stands on its rider's token (db/battle-maps.ts getTokenByRef), so asked by
// its own id it answers with the same space: an independent mount's walk is
// the pair's.
export function characterFootprint(sheetId: string): Footprint {
  const campaignId = getSheetById(sheetId)?.campaignId;
  if (!campaignId) {
    return 1;
  }
  const mounts = getMounts(campaignId);
  return riderFootprint(mounts[sheetId] ?? Object.values(mounts).find((mount) => mount.sheetId === sheetId));
}

export function tokenFootprint(token: Pick<BattleToken, "kind" | "refId">): Footprint {
  if (token.kind === "pc") {
    return characterFootprint(token.refId);
  }
  return token.kind === "enemy" ? enemyFootprint(getEnemy(token.refId)) : 1;
}

export function spotOf(token: BattleToken): Spot {
  return { x: token.x, y: token.y, footprint: tokenFootprint(token) };
}

// Squares between two tokens, nearest square to nearest square.
export function tilesApart(a: BattleToken, b: BattleToken): number {
  return footprintDistance(a, tokenFootprint(a), b, tokenFootprint(b));
}

// The squares a token stands on, which sight and cover are measured to: a
// wall beside an ogre's far corner does not shelter the corner the attacker
// can see (src/lib/battlemap/sight-lines.ts).
export function spaceOf(token: BattleToken): XY[] {
  return footprintTiles(token, tokenFootprint(token));
}
