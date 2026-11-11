// Distant Strike (Horizon Walker 11): "Teleport 10 feet before each
// attack". A swing refused only for reach, at a creature an open square
// beside it within 10 feet of the ranger, is made from there: the ranger
// teleports to that square first (pc-attack.ts asks this). Before this the
// teleport was the GM's to make, and pc_attack refused a creature 15 feet
// off. Nothing here refuses: a square or none.
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { placeTeleported } from "@/lib/dm/teleport-place";
import { listEnemies } from "@/lib/db/encounters";
import { openSquaresBeside } from "@/lib/dm/companion-approach";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { tilesApart } from "@/lib/dm/board-reach";
import { planTeleportFx } from "@/lib/battlemap/fx-plan";
import { publishFx } from "@/lib/dm/fx";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";

const TELEPORT_TILES = 2;

// The nearest open square beside the creature within the teleport of the
// ranger, or null.
export function distantStrikeSquare(encounterId: string, sheetId: string, enemyId: string): { x: number; y: number } | null {
  const map = getBattleMapForEncounter(encounterId);
  const from = map ? getTokenByRef(map.id, sheetId) : null;
  const to = map ? getTokenByRef(map.id, enemyId) : null;
  if (!map || !from || !to) {
    return null;
  }
  const enemy = listEnemies(encounterId).find((entry) => entry.id === enemyId);
  const squares = openSquaresBeside(encounterId, map, from, to, footprintForSize(enemy?.stats.size)).filter((square) => tilesApart(from, { ...from, ...square }) <= TELEPORT_TILES);
  squares.sort((a, b) => tilesApart(from, { ...from, ...a }) - tilesApart(from, { ...from, ...b }));
  return squares[0] ?? null;
}

// The teleport made, as the line the attack's result carries.
export function distantStrikeTeleport(campaignId: string, encounterId: string, sheetId: string, square: { x: number; y: number }): string {
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, sheetId) : null;
  if (!map || !token) {
    return "";
  }
  placeTeleported(campaignId, token, square);
  publishFx(campaignId, planTeleportFx({ from: { x: token.x, y: token.y }, to: square, tokenId: token.id }));
  publishBattleMapUpdate(campaignId);
  return `Distant Strike: ${token.name} teleports to (${square.x},${square.y}) before the attack.`;
}
