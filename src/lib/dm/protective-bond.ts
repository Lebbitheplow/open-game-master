// Protective Bond (Peace Domain 6): "When a creature bonded by your
// Emboldening Bond is about to take damage, another bonded creature within 30
// feet of it can use its reaction to teleport to an unoccupied space within 5
// feet of the first creature and take all the damage instead."
//
// The take-for-an-ally reaction (authored-reactions.ts take_for_ally) asks
// here: both creatures carry the bond, and the protector's token steps to an
// open square beside the one it shields. Before this any two creatures could
// trade the blow, and the protector stayed where it stood.
import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens, placeToken } from "@/lib/db/battle-maps";
import { publishEphemeral } from "@/lib/events";
import { isConditionNamed } from "@/lib/srd/feature-names";

// Both sides of the trade carry the condition the bond lays.
export function bothBonded(bond: string, a: { conditions: string[] }, b: { conditions: string[] }): boolean {
  const holds = (sheet: { conditions: string[] }) => sheet.conditions.some((entry) => isConditionNamed(entry, bond));
  return holds(a) && holds(b);
}

// The protector's token to an open square within 5 feet of the shielded
// creature, nearest to where it stood; null when it is already beside it, or
// there is no board or no open square (then it stays and the GM places it).
export function teleportBeside(campaignId: string, moverId: string, besideId: string): string | null {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const mover = map ? getTokenByRef(map.id, moverId) : null;
  const anchor = map ? getTokenByRef(map.id, besideId) : null;
  if (!map || !mover || !anchor) return null;
  if (Math.max(Math.abs(mover.x - anchor.x), Math.abs(mover.y - anchor.y)) <= 1) return null;
  const taken = new Set(listTokens(map.id).filter((token) => token.id !== mover.id).map((token) => `${token.x},${token.y}`));
  const open: Array<{ x: number; y: number; d: number }> = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if ((dx === 0 && dy === 0) || x < 0 || y < 0 || x >= map.width || y >= map.height || taken.has(`${x},${y}`)) continue;
      open.push({ x, y, d: Math.max(Math.abs(mover.x - x), Math.abs(mover.y - y)) });
    }
  }
  const spot = open.sort((a, b) => a.d - b.d)[0];
  if (!spot) return null;
  placeToken(mover.id, spot.x, spot.y);
  publishEphemeral(campaignId, "battle_map_updated", {});
  return `The protector teleports to (${spot.x},${spot.y}), beside the creature it shields.`;
}
