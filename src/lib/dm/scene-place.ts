// The place a scene happens in, as the senses need it
// (docs/specs/ogm-npc-perception.md §6–7): its zones, made once from the
// place's description; where each person stands; and what the light and the
// weather let through. The zones-logic rules decide; this reads and writes.
import type { Campaign } from "@/lib/db/campaigns";
import { getCurrentLocation } from "@/lib/db/locations";
import { getPlaceZones, listPositions, placeZonesKnown, positionOf, setPlaceZones, setPosition } from "@/lib/db/scene-zones";
import { requestDmMessage } from "@/lib/dm/model";
import { egoChoice } from "@/lib/dm/npc-mind";
import type { SenseScene } from "@/lib/dm/senses-logic";
import { currentScene } from "@/lib/dm/sky";
import { ZONES_SYSTEM, parseZoneProposal, positionsLine, renderZonesPrompt, zoneNamed, type PlaceZones } from "@/lib/dm/zones-logic";
import { resolveTextTimeoutMs } from "@/lib/model-client";
import { weatherObscurementTiles } from "@/lib/srd/weather";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

function placeName(campaign: Campaign): string {
  return getCurrentLocation(campaign.id)?.name ?? "";
}

// The zones of the party's place, asked for once when the place has a
// description to read them from, and everyone here without a position
// placed. A place without a description, or whose proposal does not hold, is
// one zone: everyone near everyone, as before zones existed.
export async function ensureZones(campaign: Campaign, people: readonly string[], scene: string): Promise<PlaceZones | null> {
  const location = getCurrentLocation(campaign.id);
  if (!location?.name) {
    return null;
  }
  let zones = getPlaceZones(campaign.id, location.name);
  let placements: Record<string, string> = {};
  if (!zones && !placeZonesKnown(campaign.id, location.name) && location.layoutDescription.trim()) {
    try {
      const result = await requestDmMessage(
        campaign.settings,
        [
          { role: "system", content: ZONES_SYSTEM },
          { role: "user", content: renderZonesPrompt({ place: location.name, layout: location.layoutDescription, people, scene }) },
        ],
        { meta: { task: "scene_zones" }, timeoutMs: resolveTextTimeoutMs(undefined, "NPC_MIND_TIMEOUT_MS", 120_000), mindChoice: egoChoice() },
      );
      const proposal = result.error ? null : parseZoneProposal(stripReasoningArtifacts(String(result.message?.content ?? "")), people);
      if (proposal) {
        zones = proposal.zones;
        placements = proposal.placements;
      } else {
        console.warn(`[scene-zones] ${location.name}: no usable zones proposed; the place is one zone`);
      }
    } catch (caught) {
      console.warn(`[scene-zones] ${location.name}: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
    setPlaceZones(campaign.id, location.name, zones ?? { zones: [] });
  }
  if (!zones) {
    return null;
  }
  for (const name of people) {
    const at = positionOf(campaign.id, location.name, name);
    if (!at || !zoneNamed(zones, at)) {
      setPosition(campaign.id, location.name, name, placements[name] ?? zones.zones[0].name);
    }
  }
  return zones;
}

export function zoneOf(campaign: Campaign, name: string): string {
  const place = placeName(campaign);
  return place ? positionOf(campaign.id, place, name) : "";
}

// A move to a zone of this place; an unknown zone moves nobody.
export function moveTo(campaign: Campaign, name: string, zone: string): string {
  const place = placeName(campaign);
  const zones = place ? getPlaceZones(campaign.id, place) : null;
  const real = zones && zone ? zoneNamed(zones, zone) : null;
  if (place && real) {
    setPosition(campaign.id, place, name, real);
  }
  return real ?? "";
}

// What the light and the weather let through, for an event in `eventZone`.
export function senseScene(campaign: Campaign, eventZone: string): SenseScene {
  const place = placeName(campaign);
  const scene = currentScene(campaign);
  const tiles = weatherObscurementTiles(scene.weather);
  const windy = scene.weather?.wind === "gale" || (scene.weather?.precipitation ?? 0) >= 3;
  return {
    zones: place ? getPlaceZones(campaign.id, place) : null,
    eventZone,
    sightRange: tiles <= 6 ? 0 : tiles <= 12 ? 1 : 2,
    dark: scene.isDark,
    noise: windy ? 1 : 0,
  };
}

// Where everyone stands, for a mind (self named "you") or the referee.
export function whereEveryoneIs(campaign: Campaign, self?: string): string {
  const place = placeName(campaign);
  const zones = place ? getPlaceZones(campaign.id, place) : null;
  if (!zones) {
    return "";
  }
  const own = self ? positionOf(campaign.id, place, self) : "";
  return `${own ? `You stand at: ${own}. ` : ""}The parts of this place and who is in each: ${positionsLine(zones, listPositions(campaign.id, place), self)}.`;
}
