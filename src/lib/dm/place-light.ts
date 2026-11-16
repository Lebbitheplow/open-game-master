// The light a character sees by off the battle map, read once for the
// passive gate (check_notice, src/lib/dm/check-tools.ts) and for a rolled
// check (rollExtrasFor, src/lib/dm/forced-save.ts), so the two never
// disagree about whether the party can see: before this, check_notice said
// "darkness: sees nothing" while a request_roll Perception by sight beside it
// rolled as in daylight. On a board the light is the board's, read on the
// character's own square (boardLightFor).
import { getActiveBattleMap, sheetDarkvisionTiles } from "@/lib/battlemap/view";
import { getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { ambientAt, magicalDarknessAt } from "@/lib/battlemap/scene";
import { carriedDimRadius, chebyshev } from "@/lib/battlemap/types";
import { characterSenses } from "@/lib/dm/attack-light";
import { lightSourcesWithZones, lightsWithZones } from "@/lib/dm/zone-rules";
import { campaignLanguage } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getCurrentLocation } from "@/lib/db/locations";
import { getPreparedMap } from "@/lib/db/prepared-maps";
import { breakDown } from "@/lib/dm/calendar";
import { shedLight } from "@/lib/dm/light-timers";
import { lightSeenBy, offBoardLight, type Light } from "@/lib/dm/notice-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The light of the place off the board: the one the DM names, else the
// current location's by its scene (an unlit cave is dark at noon, a lit inn
// is not dark at midnight), or at an English table by the words of a place
// with no scene, else the sky's by the hour. Null on a board, or where
// neither settles it.
// `hourAt`: the clock's instant whose hour the sky follows (now, unsaid).
export function offBoardAmbient(campaignId: string, named: Light | null = null, hourAt?: number): Light | null {
  if (getActiveBattleMap(campaignId)) {
    return null;
  }
  const clock = getClock(campaignId);
  const place = getCurrentLocation(campaignId);
  return offBoardLight({
    hour: breakDown(clock.calendar, hourAt ?? clock.instant).hour,
    named,
    place: place
      ? {
          scene: place.ambience?.bed || null,
          outdoors: place.preparedMapId ? getPreparedMap(campaignId, place.preparedMapId)?.outdoors ?? null : null,
          name: place.name,
          description: place.layoutDescription,
        }
      : null,
    language: campaignLanguage(campaignId),
  });
}

// What one character sees by in that light: their own lit torch or lantern
// (one still in the pack lights nothing), then darkvision on top.
export function lightForSheet(ambient: Light, sheet: CharacterSheet): Light {
  return lightSeenBy(ambient, shedLight(sheet).radius > 0, sheetDarkvisionTiles(sheet) > 0);
}

// The light on a character's own square of the battle map as they see by
// it (SRD 5.1, Vision and Light): the board's ambient there (a zone's, the
// sky's by the hour outdoors), raised by any lamp or carried light reaching
// the square (bright inside its bright radius, dim out to its dim one), then
// darkvision lifting it a step (darkness to dim, dim to bright) and Devil's
// Sight seeing the dark plainly; magical darkness stays dark but to
// truesight and Devil's Sight. Null with no board or no token. Before, a
// board gave no light at all to a check by sight: a human's Perception in
// an unlit cave rolled as in daylight, and check_notice let them spot what
// lay in the dark.
export function boardLightFor(campaignId: string, sheet: CharacterSheet): Light | null {
  const map = getActiveBattleMap(campaignId);
  const at = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !at) {
    return null;
  }
  const senses = characterSenses(sheet);
  const zones = lightsWithZones(map);
  if (zones.length && magicalDarknessAt(zones, at.x, at.y)) {
    return senses.truesight > 0 || senses.devilsSight > 0 ? "bright" : "dark";
  }
  const clock = getClock(campaignId);
  const base = effectiveAmbient(map.ambient, map.outdoors, breakDown(clock.calendar, clock.instant).hour, clock.weather);
  let light: Light = zones.length ? ambientAt(zones, at.x, at.y, base) : base;
  const sources = [
    ...lightSourcesWithZones(map),
    ...listTokens(map.id)
      .filter((token) => token.lightRadius > 0)
      .map((token) => ({ x: token.x, y: token.y, brightRadius: token.lightRadius, dimRadius: carriedDimRadius(token) })),
  ];
  for (const source of sources) {
    const apart = chebyshev(source.x, source.y, at.x, at.y);
    if (light === "bright" || apart > source.dimRadius || (apart > 0 && !hasLineOfSight(map.terrain, map.width, source.x, source.y, at.x, at.y))) {
      continue;
    }
    light = apart <= source.brightRadius ? "bright" : "dim";
  }
  if (light === "dark" && senses.devilsSight > 0) {
    return "bright";
  }
  return senses.darkvision > 0 ? (light === "dark" ? "dim" : "bright") : light;
}

// The light a character's own check by sight is made in: the place's off
// the board, their square's on it.
export function rollerLight(campaignId: string, sheet: CharacterSheet): Light | null {
  const ambient = offBoardAmbient(campaignId);
  return ambient ? lightForSheet(ambient, sheet) : boardLightFor(campaignId, sheet);
}
