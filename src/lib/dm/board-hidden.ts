// The creatures the GM keeps off the board now (the tracker's "someone
// unseen"), read fresh, and the name a line the table reads gives one of
// them. Every writer of a line that names a creature goes through here
// (opportunity.ts, encounter-tools.ts, fight-events.ts): the event stream is
// redacted in one place (table-delivery.ts), but a chat row is stored with
// the words its writer chose, and a player who reloads reads them.
import { getBattleMapForEncounter, listHiddenRefIds } from "@/lib/db/battle-maps";
import { tableName } from "@/lib/dm/turn-lines-logic";

export function hiddenNow(encounterId: string): Set<string> {
  const map = getBattleMapForEncounter(encounterId);
  return new Set(map ? listHiddenRefIds(map.id) : []);
}

// The creature's name as the table may read it now.
export function shownName(encounterId: string, id: string, name: string): string {
  return tableName(name, hiddenNow(encounterId).has(id));
}
