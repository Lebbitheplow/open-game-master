// A bag of caltrops or ball bearings spread on the board, or a flask of oil
// poured out (SRD 5.1 Adventuring Gear): use_item (or Use an Object, for the
// oil) spends it and lays its area here, the
// square in front of the user (toward the nearest foe on the board, else
// their own), and the zone triggers do the rest (src/lib/battlemap/
// zones-gear.ts). Off a board the bag is spent and the GM narrates where it
// lies.

import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneKey } from "@/lib/battlemap/zones-spells";
import { liveZones, publishZones, saveZones } from "@/lib/dm/zone-store";
import { getActiveBoard } from "@/lib/db/encounters";
import type { Campaign } from "@/lib/db/campaigns";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { matchGear } from "@/lib/srd/adventuring-gear";
import { GEAR_ZONES } from "@/lib/battlemap/zones-gear";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const SPREAD = GEAR_ZONES.map((entry) => ({ ...entry, row: matchGear(entry.gear) }));

// Lays the area of the bag just used, or null when the item is no such bag
// or there is no board. Returns the line use_item's result carries.
export function spreadGear(campaign: Campaign, user: CharacterSheet, itemName: string): string | null {
  const row = matchGear(itemName);
  const spread = row ? SPREAD.find((entry) => entry.row === row) : undefined;
  const encounter = spread ? getActiveBoard(campaign.id) : null;
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const own = map ? getTokenByRef(map.id, user.id) : null;
  if (!spread || !map || !own) {
    return null;
  }
  const apart = (token: { x: number; y: number }) => Math.max(Math.abs(token.x - own.x), Math.abs(token.y - own.y));
  const nearest = listTokens(map.id)
    .filter((token) => token.kind === "enemy")
    .reduce<{ x: number; y: number } | null>((best, token) => (!best || apart(token) < apart(best) ? token : best), null);
  const at = nearest
    ? { x: own.x + Math.sign(nearest.x - own.x), y: own.y + Math.sign(nearest.y - own.y) }
    : { x: own.x, y: own.y };
  return placeSpellZone(campaign, { spell: spread.zone, caster: { kind: "pc", id: user.id, name: user.name }, dc: spread.dc, at });
}

// Oil poured on the ground catches when fire reaches it, and "burns for 2
// rounds": the pool becomes burning oil (zones-gear.ts), which strikes a
// creature that enters it or ends its turn in it. `reach` is how many squares
// from the creature a pool may lie: 0 for fire striking a creature standing
// in one (the damage paths, beside the Web's burning), 1 for a torch or
// tinderbox put to it. Returns the line for the result, or null when no pool
// is there.
export function lightOil(campaign: Campaign, refId: string, reach: 0 | 1): string | null {
  const encounter = getActiveBoard(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, refId) : null;
  if (!encounter || !map || !token) {
    return null;
  }
  const zones = liveZones(map, encounter);
  const near = (cell: number) => Math.max(Math.abs((cell % map.width) - token.x), Math.abs(Math.floor(cell / map.width) - token.y)) <= reach;
  const pools = zones.filter((zone) => zoneKey(zone) === "oil" && zone.cells.some(near));
  if (!pools.length) {
    return null;
  }
  const lit = pools.map((pool): SpellZone => ({
    ...pool,
    id: crypto.randomUUID().slice(0, 12),
    spell: "Burning Oil",
    castRound: encounter.round,
    // Rounds counted as the areas count them: this one and the next.
    untilRound: encounter.round + 1,
    struck: {},
  }));
  saveZones(map.id, [...zones.filter((zone) => !pools.includes(zone)), ...lit]);
  publishZones(campaign.id);
  return `The oil at (${lit.map((pool) => `${pool.cells[0] % map.width},${Math.floor(pool.cells[0] / map.width)}`).join("), (")}) catches fire: it burns for 2 rounds, 5 fire to a creature that enters it or ends its turn there.`;
}
