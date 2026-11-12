// The key under which a player's map view carries how far a creature stands
// from an area the viewer's own character keeps on the board (the Tentacle of
// the Deeps), beside the distances from the character themselves
// (PlayerMapView.feet). The server writes it (src/lib/dm/zone-reach.ts
// ownZoneFeet) and the Hand reads it (hand-react.ts) for a reaction whose
// reach is measured from that area (a row's nearZone), so one spelling of
// the key lives here. No creature id starts with "zone:".
//
// Pure: the Hand imports it.
import { textKey } from "@/lib/language/text-logic";

const ZONE = "zone:";

export function zoneFeetKey(spell: string, creatureId: string): string {
  return `${ZONE}${textKey(spell)}:${creatureId}`;
}

// The distances as the Hand may read them on this host: the feet from an
// area are read only where the host says it sends them
// (src/lib/capabilities.ts ownZoneFeet). A host that does not offer the flag
// is read as before the keys existed, whatever its payload holds, so a card
// that reaches from an area is dealt there as it always was and the engine
// judges the reach.
export function feetForHost(feet: Record<string, number> | undefined, offersZoneFeet: boolean): Record<string, number> | undefined {
  if (!feet || offersZoneFeet || !Object.keys(feet).some((id) => id.startsWith(ZONE))) {
    return feet;
  }
  return Object.fromEntries(Object.entries(feet).filter(([id]) => !id.startsWith(ZONE)));
}
