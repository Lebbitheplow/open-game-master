// Who sees whom when one creature attacks another on a mapped fight, from
// the board's own light, darkvision and senses (SRD 5.1, Vision and Light,
// Unseen Attackers and Targets): attacking a creature you cannot see is at
// disadvantage, and attacking one that cannot see you is at advantage.
//
// Darkness (heavily obscured) is what hides a creature: dim light only
// hampers Perception, so a target in dim light is seen. A tile is seen when
// the ambient light there (its zone, the sky, a fog past its radius) is not
// dark, when a light reaches it (the board's lamps and every carried light,
// the same lit set the fog of war draws), or when a sense reaches it:
// darkvision, blindsight, truesight, Devil's Sight, and tremorsense for a
// creature on the ground. Magical darkness yields only to blindsight,
// truesight and Devil's Sight. Walls are the range check's business.
//
// Off the map there is nothing to measure: the conditions (blinded,
// invisible, hidden) are the whole answer, as before.

import { getClock } from "@/lib/db/clock";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { cachedLitTiles } from "@/lib/battlemap/lit-cache";
import { darkvisionTilesFromText, hasLineOfSight } from "@/lib/battlemap/los";
import { ambientAt, magicalDarknessAt } from "@/lib/battlemap/scene";
import { chebyshev, tileIndex, type BattleToken, type XY } from "@/lib/battlemap/types";
import { breakDown } from "@/lib/dm/calendar";
import { sensesFromBlock, sensesFromText, type Senses } from "@/lib/srd/senses";
import { formSenses } from "@/lib/srd/mt-srd-form-senses";
import { weatherObscurementTiles } from "@/lib/srd/weather";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { lightSourcesWithZones, lightsWithZones, zoneHidesFrom } from "@/lib/dm/zone-rules";
import { conditionSightFeet, conditionTruesightFeet } from "@/lib/srd/condition-effect-queries";
import { authoredDarkvisionFeet } from "@/lib/srd/authored-effects-more";
import { mrSensesOver } from "@/lib/srd/mt-mr-senses";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { instancesOf, type ConditionMetaMap, type PastSight } from "@/lib/dm/condition-logic";
import { spaceOf, tilesApart } from "@/lib/dm/board-reach";
import { revelationSightTiles, unveilsAt, type UnveilingSense } from "@/lib/dm/ar-ws-revelation";
import { hasLineOfSightBetween } from "@/lib/battlemap/los";

export function characterSenses(sheet: Pick<CharacterSheet, "features" | "race"> & { conditions?: string[]; wildShape?: CharacterSheet["wildShape"] }): Senses & UnveilingSense {
  // A worn form sees by its own senses alone (mt-srd-form-senses.ts); True
  // Seeing is a spell on the creature, whatever its shape.
  const worn = formSenses(sheet);
  if (worn) {
    return { ...worn, truesight: Math.max(worn.truesight, Math.floor(conditionTruesightFeet(sheet.conditions ?? []) / 5)) };
  }
  const texts = [...sheet.features.map((feature) => feature.name), sheet.race];
  const senses = sensesFromText(texts);
  // True Seeing's truesight, in squares (condition-effects-last.ts).
  const seeing = Math.floor(conditionTruesightFeet(sheet.conditions ?? []) / 5);
  const named = Math.max(senses.darkvision, darkvisionTilesFromText(texts));
  // A subclass's darkvision (Umbral Sight, Eyes of the Dark, Eyes of Night).
  const authored = Math.floor(authoredDarkvisionFeet(sheet, named * 5) / 5);
  // Revelation in Flesh's sight of the invisible (ar-ws-revelation.ts).
  const unveils = revelationSightTiles(sheet.conditions);
  // A monk subclass's blindsight and Astral Sight (mt-mr-senses.ts).
  return { ...mrSensesOver(sheet, { ...senses, darkvision: Math.max(named, authored), truesight: Math.max(senses.truesight, seeing) }), ...(unveils ? { unveils } : {}) };
}

export function enemySenses(enemy: Pick<EncounterEnemy, "stats"> & { conditions?: string[] }): Senses {
  const block = sensesFromBlock(enemy.stats.senses);
  const text = sensesFromText(enemy.stats.traits ?? []);
  return {
    darkvision: Math.max(block.darkvision, text.darkvision, darkvisionTilesFromText(enemy.stats.traits ?? [])),
    blindsight: Math.max(block.blindsight, text.blindsight),
    tremorsense: Math.max(block.tremorsense, text.tremorsense),
    // True Seeing's truesight, in squares, as on a character.
    truesight: Math.max(block.truesight, text.truesight, Math.floor(conditionTruesightFeet(enemy.conditions ?? []) / 5)),
    devilsSight: Math.max(block.devilsSight, text.devilsSight),
  };
}

// Which of a viewer's senses reach another creature past what eyes need:
// blindsight perceives without them, so blindness and invisibility do not
// stop it, and truesight sees the invisible (SRD 5.1, Senses). Measured on
// the board between their tokens; off it, a sense the viewer has reaches.
// The one rule every sight check reads: an attack roll (condition-logic.ts
// attackContext), "a creature you can see" (authored-saves.ts), and who
// provokes an opportunity attack.
//
// `at` puts a creature on a tile other than its token's: an opportunity
// attack happens as the mover leaves the reach, before the token reaches the
// square it lands on, so the tile it left is where it is seen (or not).
export function sensesReaching(encounterId: string | null, viewer: Placed & { senses: Senses & UnveilingSense }, seen: Placed): PastSight {
  const { blindsight, truesight } = viewer.senses;
  // A sense that shows the invisible alone (Revelation in Flesh): its reach,
  // and no total cover between the two (ar-ws-revelation.ts).
  const unveils = viewer.senses.unveils ?? 0;
  if (!blindsight && !truesight && !unveils) {
    return { blindsight: false, truesight: false };
  }
  const map = encounterId ? getBattleMapForEncounter(encounterId) : null;
  const from = map ? placedToken(map.id, viewer) : null;
  const to = map ? placedToken(map.id, seen) : null;
  const apart = from && to ? tilesApart(from, to) : null;
  const reaches = (tiles: number) => tiles > 0 && (apart === null || apart <= tiles);
  const past: PastSight = { blindsight: reaches(blindsight), truesight: reaches(truesight) };
  if (!unveils) {
    return past;
  }
  const clear = !map || !from || !to || hasLineOfSightBetween(map.terrain, map.width, spaceOf(from), spaceOf(to));
  return { ...past, invisible: unveilsAt(unveils, apart, clear) };
}

// A creature by its token, or by the tile `at` names for it (see
// sensesReaching). Null when it has no token on the board.
type Placed = { refId: string; at?: XY | null };
function placedToken(mapId: string, who: Placed): BattleToken | null {
  const token = getTokenByRef(mapId, who.refId);
  return token && who.at ? { ...token, x: who.at.x, y: who.at.y } : token;
}

// Both ways round, for an attack: what the attacker's senses reach of the
// target, and the target's of the attacker.
export function attackSenses(
  encounterId: string | null,
  attacker: Placed & { senses: Senses },
  target: Placed & { senses: Senses },
): { attackerSenses: PastSight; targetSenses: PastSight } {
  return { attackerSenses: sensesReaching(encounterId, attacker, target), targetSenses: sensesReaching(encounterId, target, attacker) };
}

export type Sight = {
  // The attacker perceives the target, and the target the attacker.
  attackerSees: boolean;
  targetSees: boolean;
};

// Null when there is no board or either creature is off it. Either side may
// name the tile it stands on with `at` (an opportunity attack's mover, at the
// tile it left: opportunity-strike.ts opportunitySight). The light's
// verdict, then what cuts a creature's own sight short: one that "can't see
// anything farther than 5 feet away" (Shadow Arrow, a condition row's
// sightFeet) sees no creature past that, whatever the light. Blindsight is
// not sight and still reaches (sensesReaching).
export function attackSight(input: Parameters<typeof sightByLight>[0]): Sight | null {
  const sight = sightByLight(input);
  const map = sight ? getBattleMapForEncounter(input.encounterId) : null;
  const from = map ? placedToken(map.id, input.attacker) : null;
  const to = map ? placedToken(map.id, input.target) : null;
  if (!sight || !from || !to) {
    return sight;
  }
  const feet = tilesApart(from, to) * 5;
  const near = (refId: string) => {
    const limit = conditionSightFeet(getEnemy(refId)?.conditions ?? getSheetById(refId)?.conditions ?? []);
    return limit === null || feet <= limit;
  };
  return { attackerSees: sight.attackerSees && near(input.attacker.refId), targetSees: sight.targetSees && near(input.target.refId) };
}

function sightByLight(input: {
  campaignId: string;
  encounterId: string;
  attacker: Placed & { senses: Senses };
  target: Placed & { senses: Senses };
}): Sight | null {
  const map = getBattleMapForEncounter(input.encounterId);
  const from = map ? placedToken(map.id, input.attacker) : null;
  const to = map ? placedToken(map.id, input.target) : null;
  if (!map || !from || !to) {
    return null;
  }
  const clock = getClock(input.campaignId);
  const ambient = effectiveAmbient(
    map.ambient,
    map.outdoors,
    breakDown(clock.calendar, clock.instant).hour,
    clock.weather,
  );
  // A spell area on the sight line (a fog cloud, magical darkness, an opaque
  // wall) blinds as darkness does, and Daylight lights: zone-rules.ts.
  // `self`: an area its own caster sees through (a Darkness paid for through
  // Eyes of the Dark, zones.ts seenThroughBy) is not there for that creature.
  const veiled = {
    attacker: zoneHidesFrom(map, from, to, { ...input.attacker.senses, self: input.attacker.refId }),
    target: zoneHidesFrom(map, to, from, { ...input.target.senses, self: input.target.refId }),
  };
  const patches = lightsWithZones(map);
  if (ambient !== "dark" && !patches.length) {
    // Bright or dim everywhere (weather only dims a bright tile): everyone
    // sees everyone.
    return { attackerSees: !veiled.attacker, targetSees: !veiled.target };
  }
  const vision = {
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    ambient,
    zones: patches,
    obscureBeyond: map.outdoors ? weatherObscurementTiles(clock.weather) : Infinity,
  };
  const lit = cachedLitTiles({ ...vision, id: map.id }, listTokens(map.id), lightSourcesWithZones(map));
  // Umbral Sight (Gloom Stalker 3): "you are invisible to creatures relying
  // on darkvision to see you in darkness". Darkvision alone does not find
  // its holder in the dark; a light, blindsight, tremorsense, truesight or
  // Devil's Sight still does. Before this a goblin's darkvision saw the
  // ranger and attacked with a straight roll.
  const umbral = (refId: string) => {
    const sheet = getSheetById(refId);
    return Boolean(sheet && holdsFeature(sheet, "Umbral Sight"));
  };
  const sees = (viewer: BattleToken, senses: Senses, subject: BattleToken, self: string, unseenByDarkvision = false): boolean => {
    const distance = chebyshev(viewer.x, viewer.y, subject.x, subject.y);
    if (distance <= senses.blindsight) {
      return true;
    }
    if (distance <= senses.tremorsense && subject.movement !== "fly") {
      return true;
    }
    // A darkness this viewer sees through is not there for them (zones.ts zoneLights).
    const zones = lightsWithZones(map, self);
    if (zones.length && magicalDarknessAt(zones, subject.x, subject.y)) {
      return distance <= senses.truesight || distance <= senses.devilsSight;
    }
    const local = zones.length ? ambientAt(zones, subject.x, subject.y, ambient) : ambient;
    if (local !== "dark") {
      return true;
    }
    return (
      lit.has(tileIndex(map.width, subject.x, subject.y)) ||
      (distance <= senses.darkvision && !unseenByDarkvision) ||
      distance <= senses.devilsSight ||
      distance <= senses.truesight
    );
  };
  return {
    attackerSees: !veiled.attacker && sees(from, input.attacker.senses, to, input.attacker.refId, umbral(input.target.refId)),
    targetSees: !veiled.target && sees(to, input.target.senses, from, input.target.refId, umbral(input.attacker.refId)),
  };
}

// Whether a creature's own square lies in darkness on the board: dark there
// (the ambient light, or magical darkness laid over it) with no lamp or
// carried light reaching it, whoever looks. Lunar Empowerment's New Moon reads
// it ("while you are entirely in darkness", ar-ws-lunar-empowerment.ts). Null
// with no board, or for a creature not on it.
export function standsInDarkness(campaignId: string, encounterId: string, refId: string): boolean | null {
  const map = encounterId ? getBattleMapForEncounter(encounterId) : null;
  const at = map ? getTokenByRef(map.id, refId) : null;
  if (!map || !at) {
    return null;
  }
  const clock = getClock(campaignId);
  const ambient = effectiveAmbient(map.ambient, map.outdoors, breakDown(clock.calendar, clock.instant).hour, clock.weather);
  const zones = lightsWithZones(map);
  if (zones.length && magicalDarknessAt(zones, at.x, at.y)) {
    return true;
  }
  if ((zones.length ? ambientAt(zones, at.x, at.y, ambient) : ambient) !== "dark") {
    return false;
  }
  const vision = { terrain: map.terrain, width: map.width, height: map.height, ambient, zones, obscureBeyond: map.outdoors ? weatherObscurementTiles(clock.weather) : Infinity, id: map.id };
  return !cachedLitTiles(vision, listTokens(map.id), lightSourcesWithZones(map)).has(tileIndex(map.width, at.x, at.y));
}

// The advantage sources and notes one attack takes from the light.
export function lightOnAttack(
  sight: Sight | null,
  names: { attacker: string; target: string },
): { sources: Array<"advantage" | "disadvantage">; notes: string[] } {
  const sources: Array<"advantage" | "disadvantage"> = [];
  const notes: string[] = [];
  if (!sight) {
    return { sources, notes };
  }
  if (!sight.attackerSees) {
    sources.push("disadvantage");
    notes.push(`${names.attacker} cannot see ${names.target} in the dark: disadvantage`);
  }
  if (!sight.targetSees) {
    sources.push("advantage");
    notes.push(`${names.target} cannot see ${names.attacker} in the dark: advantage`);
  }
  return { sources, notes };
}

// A creature's conditions as its attack rolls and ability checks read them:
// "A frightened creature has disadvantage on ability checks and attack rolls
// while the source of its fear is within line of sight" (SRD 5.1,
// Conditions, Frightened). On a board where every source of the fear stands
// behind something that blocks sight, frightened drops out of the list the
// roll reads (it still keeps the creature from moving closer). Off a board,
// or with a source not on it, the list is as written.
export function fearAsRolled(
  // The fight or scene whose board is read; null reads no board.
  encounterId: string | null,
  refId: string,
  conditions: string[],
  meta: unknown,
): string[] {
  const frightened = conditions.find((entry) => isConditionNamed(entry, "frightened"));
  const map = frightened && encounterId ? getBattleMapForEncounter(encounterId) : null;
  const self = map ? getTokenByRef(map.id, refId) : null;
  if (!frightened || !map || !self) {
    return conditions;
  }
  const sources = instancesOf((meta as ConditionMetaMap | null)?.[frightened]).flatMap((entry) => (entry.source ? [entry.source] : []));
  const unseen =
    sources.length > 0 &&
    sources.every((source) => {
      const token = getTokenByRef(map.id, source);
      return token !== null && !hasLineOfSight(map.terrain, map.width, token.x, token.y, self.x, self.y);
    });
  return unseen ? conditions.filter((entry) => entry !== frightened) : conditions;
}
