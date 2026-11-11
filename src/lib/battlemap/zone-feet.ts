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

export function zoneFeetKey(spell: string, creatureId: string): string {
  return `zone:${textKey(spell)}:${creatureId}`;
}
