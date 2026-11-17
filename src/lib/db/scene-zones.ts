// The zones of each place and where each person stands
// (docs/specs/ogm-npc-perception.md §6). Positions are kept by name, heroes
// and NPCs alike, for the place they were last placed in.
import { getDatabase, parseJson } from "@/lib/db/core";
import { validateZones, type PlaceZones } from "@/lib/dm/zones-logic";
import { textKey } from "@/lib/language/text-logic";

export function getPlaceZones(campaignId: string, place: string): PlaceZones | null {
  const row = getDatabase().prepare(`SELECT zones_json FROM place_zones WHERE campaign_id = ? AND place = ?`).get(campaignId, textKey(place)) as { zones_json: string } | undefined;
  return row ? validateZones(parseJson<unknown>(row.zones_json, [])) : null;
}

export function setPlaceZones(campaignId: string, place: string, zones: PlaceZones) {
  getDatabase()
    .prepare(`INSERT INTO place_zones (campaign_id, place, zones_json) VALUES (?, ?, ?) ON CONFLICT(campaign_id, place) DO UPDATE SET zones_json = excluded.zones_json`)
    .run(campaignId, textKey(place), JSON.stringify(zones.zones));
}

export type Position = { name: string; zone: string };

export function listPositions(campaignId: string, place: string): Position[] {
  return getDatabase().prepare(`SELECT name, zone FROM scene_positions WHERE campaign_id = ? AND place = ?`).all(campaignId, textKey(place)) as Position[];
}

export function positionOf(campaignId: string, place: string, name: string): string {
  const row = getDatabase().prepare(`SELECT zone FROM scene_positions WHERE campaign_id = ? AND name_key = ? AND place = ?`).get(campaignId, textKey(name), textKey(place)) as { zone: string } | undefined;
  return row?.zone ?? "";
}

export function setPosition(campaignId: string, place: string, name: string, zone: string) {
  getDatabase()
    .prepare(
      `INSERT INTO scene_positions (campaign_id, name_key, name, place, zone) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, name_key) DO UPDATE SET name = excluded.name, place = excluded.place, zone = excluded.zone`,
    )
    .run(campaignId, textKey(name), name, textKey(place), zone);
}

// Whether zones were ever asked for this place (a place found to be one
// zone keeps an empty row, so it is not asked again every turn).
export function placeZonesKnown(campaignId: string, place: string): boolean {
  return Boolean(getDatabase().prepare(`SELECT 1 FROM place_zones WHERE campaign_id = ? AND place = ?`).get(campaignId, textKey(place)));
}
