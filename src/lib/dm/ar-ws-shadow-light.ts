// The light on one square of a board, and the teleports that go only between
// shadows (Shadow Walk, Shadow Magic 14: "A bonus action teleports 120 feet
// between dim or dark spaces"). The spend's note left the light at both ends
// to the GM, and the board's teleport took any open square: a sorcerer in a
// lit hall stepped across it in full daylight.
//
// A square is in bright light when the board's light there is bright (its
// own, the sky's by the hour and the weather, a lit patch drawn on it, a
// Daylight spell), or when a lamp's or a carried light's bright radius
// reaches it with nothing in the way. Short of that it is in dim light when
// the board's light there is dim or a light's dim radius reaches it, and in
// darkness otherwise. Magical darkness is darkness whatever shines into it.
// These are the same sources the attack's sight and the fog of war read
// (attack-light.ts, battlemap/los.ts litTiles); those ask only "lit or not",
// and this asks which of the two a light's rings is.
//
// Both ends of such a teleport stand out of bright light: where the walker
// stands and where they arrive. Read by the spend that names its square
// (ar-ws-shadow-walk.ts) and by move_token's teleport when it takes the
// teleport such a spend paid for (map-tools.ts handleTeleportToken), so the
// rule holds whichever of the two calls makes the move.
//
// Must not import map-tools.ts (which imports it).

import { getClock } from "@/lib/db/clock";
import { listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { computeFov } from "@/lib/battlemap/los";
import { ambientAt, magicalDarknessAt } from "@/lib/battlemap/scene";
import { carriedDimRadius, tileIndex, type AmbientLight, type BattleToken, type MapLight, type XY } from "@/lib/battlemap/types";
import { breakDown } from "@/lib/dm/calendar";
import type { ToolError } from "@/lib/dm/tool-errors";
import { lightSourcesWithZones, lightsWithZones } from "@/lib/dm/zone-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { authoredSpendFor } from "@/lib/srd/authored-effects";

// The light on a square of the board: bright, dim or dark.
export function lightAt(campaignId: string, map: BattleMap, at: XY): AmbientLight {
  const clock = getClock(campaignId);
  const ambient = effectiveAmbient(map.ambient, map.outdoors, breakDown(clock.calendar, clock.instant).hour, clock.weather);
  const zones = lightsWithZones(map);
  if (zones.length && magicalDarknessAt(zones, at.x, at.y)) {
    return "dark";
  }
  const local = zones.length ? ambientAt(zones, at.x, at.y, ambient) : ambient;
  if (local === "bright") {
    return "bright";
  }
  const square = tileIndex(map.width, at.x, at.y);
  const sources: MapLight[] = [
    ...lightSourcesWithZones(map),
    ...listTokens(map.id)
      .filter((token) => token.lightRadius > 0)
      .map((token) => ({ x: token.x, y: token.y, brightRadius: token.lightRadius, dimRadius: carriedDimRadius(token) })),
  ];
  const reaches = (source: MapLight, radius: number) => radius > 0 && computeFov(map.terrain, map.width, map.height, source.x, source.y, radius).has(square);
  let dim = local === "dim";
  for (const source of sources) {
    if (reaches(source, source.brightRadius)) {
      return "bright";
    }
    dim ||= reaches(source, source.dimRadius);
  }
  return dim ? "dim" : "dark";
}

// Why a teleport between shadows cannot go from where `token` stands to
// `to`, or null. The square is a mistake to correct; a walker standing in the
// light is the rule saying no.
export function shadowsRefusal(campaignId: string, map: BattleMap, token: BattleToken, to: XY, feature: string): ToolError | null {
  if (lightAt(campaignId, map, token) === "bright") {
    return { error: `${token.name} stands in bright light at (${token.x},${token.y}), and ${feature} leaves from dim light or darkness.`, refused: "rules" };
  }
  if (lightAt(campaignId, map, to) === "bright") {
    return { error: `(${to.x},${to.y}) is in bright light, and ${feature} arrives in dim light or darkness. Pick a square out of the light.`, retry: true };
  }
  return null;
}

// Whether the feature this character spent on a teleport goes only between
// shadows (its row says so), for the move that takes what the spend paid for.
export function goesBetweenShadows(spender: CharacterSheet, feature: string): boolean {
  const does = authoredSpendFor(spender, feature)?.spend.does;
  return does?.kind === "teleport" && does.shadows === true;
}
