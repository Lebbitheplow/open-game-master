// How far a creature stands from an area the holder keeps on the board (a
// spell zone they laid): Guardian Coil reads it, "when you or a creature you
// can see takes damage while within 10 feet of the tentacle" (the Tentacle of
// the Deeps' zone, src/lib/battlemap/zones-spells.ts). A reach measured from
// the holder (a reaction row's rangeFt) is a different rule; a reach measured
// from a thing they placed comes here.

import type { Encounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { liveZones } from "@/lib/dm/zone-store";
import { textKey } from "@/lib/language/text-logic";
import { zoneFeetKey } from "@/lib/battlemap/zone-feet";
import { heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";

const TILE_FEET = 5;

// The feet from the creature's square to the nearest square of the holder's
// zone named `spell`; null when no board, no token or no such zone stands
// (nothing to measure from).
export function feetFromOwnZone(encounter: Encounter, holderId: string, spell: string, creatureId: string): number | null {
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, creatureId) : null;
  if (!map || !token) {
    return null;
  }
  const zone = liveZones(map, encounter).find((entry) => entry.casterId === holderId && [entry.spell, entry.heldBy ?? ""].some((name) => textKey(name) === textKey(spell)));
  if (!zone) {
    return null;
  }
  const cells = zone.cells.length ? zone.cells.map((cell) => ({ x: cell % map.width, y: Math.floor(cell / map.width) })) : [zone.origin];
  return Math.min(...cells.map((cell) => Math.max(Math.abs(cell.x - token.x), Math.abs(cell.y - token.y)))) * TILE_FEET;
}

// The same feet for the Hand: every creature given, against every area a
// reaction of this character reaches from (a row's nearZone), keyed by
// zoneFeetKey. The player's map view carries them beside the distances from
// the character (src/lib/battlemap/view.ts), so the card is withheld exactly
// where use_reaction refuses: Guardian Coil's was dealt for an ally 25 feet
// from the tentacle. Nothing is written for an area that does not stand.
export function ownZoneFeet(encounter: Encounter, sheet: AuthoredSheet & { id: string }, creatureIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      const near = reaction.does.kind === "reduce" ? reaction.does.nearZone : undefined;
      if (!near) {
        continue;
      }
      for (const id of creatureIds) {
        const feet = feetFromOwnZone(encounter, sheet.id, near.spell, id);
        if (feet !== null) {
          out[zoneFeetKey(near.spell, id)] = feet;
        }
      }
    }
  }
  return out;
}
