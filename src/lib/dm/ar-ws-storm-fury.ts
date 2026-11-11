// Storm's Fury (Storm Sorcery 14): "A reaction deals your sorcerer level in
// lightning damage to a melee attacker and pushes it 20 feet on a failed
// Strength save." The reaction rolled the save and answered a sentence
// ("is pushed up to 20 feet (move_token forced)"), so the creature stood
// where it stood until a second call moved it, and at a person's table no
// such call was ever made.
//
// The push is made here, in the reaction: the creature goes straight away
// from the sorcerer a square at a time through the board's own forced move
// (map-tools.ts pushTokenAway, the shove's and Gathered Swarm's), so it stops
// at a wall, at the map's edge and at an occupied square, and provokes
// nothing. Off a board there is nothing to move and the line says so.
//
// Called by authored-reactions.ts for a strike_back whose save says pushFeet.

import type { Campaign } from "@/lib/db/campaigns";
import { pullTokenToward, pushTokenAway } from "@/lib/dm/map-tools";

const TILE_FEET = 5;

// Pushes `target` up to `feet` straight away from `pusher`; the line for the table.
export function pushStraightAway(
  campaign: Campaign,
  encounterId: string,
  pusher: { id: string; name: string },
  target: { id: string; displayName: string },
  feet: number,
): string {
  const steps = Math.max(1, Math.floor(feet / TILE_FEET));
  let moved = 0;
  let stopped = "";
  for (let step = 0; step < steps; step += 1) {
    const pushed = pushTokenAway(campaign, encounterId, pusher.id, target.id);
    if (!pushed.moved) {
      stopped = pushed.reason;
      break;
    }
    moved += 1;
  }
  if (!moved) {
    return `${target.displayName} is not pushed: ${stopped}.`;
  }
  return `${target.displayName} is pushed ${moved * TILE_FEET} feet straight away from ${pusher.name}${moved < steps ? ` and stops there (${stopped})` : ""}. The board already shows it.`;
}

// Pulls `target` up to `feet` straight toward `puller`, stopping beside them
// (Perfected Armor's Guardian pull); the line for the table.
export function pullStraightToward(
  campaign: Campaign,
  encounterId: string,
  puller: { id: string; name: string },
  target: { id: string; displayName: string },
  feet: number,
): string {
  const steps = Math.max(1, Math.floor(feet / TILE_FEET));
  let moved = 0;
  let stopped = "";
  for (let step = 0; step < steps; step += 1) {
    const pulled = pullTokenToward(campaign, encounterId, puller.id, target.id);
    if (!pulled.moved) {
      stopped = pulled.reason;
      break;
    }
    moved += 1;
  }
  if (!moved) {
    return `${target.displayName} is not pulled: ${stopped}.`;
  }
  return `${target.displayName} is pulled ${moved * TILE_FEET} feet straight toward ${puller.name}${stopped ? ` and stops there (${stopped})` : ""}. The board already shows it.`;
}
