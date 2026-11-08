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
import type { EncounterEnemy } from "@/lib/db/encounters";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { cachedLitTiles } from "@/lib/battlemap/lit-cache";
import { darkvisionTilesFromText, hasLineOfSight } from "@/lib/battlemap/los";
import { ambientAt, magicalDarknessAt } from "@/lib/battlemap/scene";
import { chebyshev, tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { breakDown } from "@/lib/dm/calendar";
import { sensesFromBlock, sensesFromText, type Senses } from "@/lib/srd/senses";
import { weatherObscurementTiles } from "@/lib/srd/weather";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { lightSourcesWithZones, lightsWithZones, zoneHidesFrom } from "@/lib/dm/zone-rules";
import { conditionTruesightFeet } from "@/lib/srd/condition-effect-queries";
import { authoredDarkvisionFeet } from "@/lib/srd/authored-effects-more";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { instancesOf, type ConditionMetaMap, type PastSight } from "@/lib/dm/condition-logic";
import { tilesApart } from "@/lib/dm/board-reach";

export function characterSenses(sheet: Pick<CharacterSheet, "features" | "race"> & { conditions?: string[] }): Senses {
  const texts = [...sheet.features.map((feature) => feature.name), sheet.race];
  const senses = sensesFromText(texts);
  // True Seeing's truesight, in squares (condition-effects-last.ts).
  const seeing = Math.floor(conditionTruesightFeet(sheet.conditions ?? []) / 5);
  const named = Math.max(senses.darkvision, darkvisionTilesFromText(texts));
  // A subclass's darkvision (Umbral Sight, Eyes of the Dark, Eyes of Night).
  const authored = Math.floor(authoredDarkvisionFeet(sheet, named * 5) / 5);
  return { ...senses, darkvision: Math.max(named, authored), truesight: Math.max(senses.truesight, seeing) };
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
export function sensesReaching(encounterId: string | null, viewer: { refId: string; senses: Senses }, seen: { refId: string }): PastSight {
  const { blindsight, truesight } = viewer.senses;
  if (!blindsight && !truesight) {
    return { blindsight: false, truesight: false };
  }
  const map = encounterId ? getBattleMapForEncounter(encounterId) : null;
  const from = map ? getTokenByRef(map.id, viewer.refId) : null;
  const to = map ? getTokenByRef(map.id, seen.refId) : null;
  const apart = from && to ? tilesApart(from, to) : null;
  const reaches = (tiles: number) => tiles > 0 && (apart === null || apart <= tiles);
  return { blindsight: reaches(blindsight), truesight: reaches(truesight) };
}

// Both ways round, for an attack: what the attacker's senses reach of the
// target, and the target's of the attacker.
export function attackSenses(
  encounterId: string | null,
  attacker: { refId: string; senses: Senses },
  target: { refId: string; senses: Senses },
): { attackerSenses: PastSight; targetSenses: PastSight } {
  return { attackerSenses: sensesReaching(encounterId, attacker, target), targetSenses: sensesReaching(encounterId, target, attacker) };
}

export type Sight = {
  // The attacker perceives the target, and the target the attacker.
  attackerSees: boolean;
  targetSees: boolean;
};

// Null when there is no board or either creature is off it.
export function attackSight(input: {
  campaignId: string;
  encounterId: string;
  attacker: { refId: string; senses: Senses };
  target: { refId: string; senses: Senses };
}): Sight | null {
  const map = getBattleMapForEncounter(input.encounterId);
  const from = map ? getTokenByRef(map.id, input.attacker.refId) : null;
  const to = map ? getTokenByRef(map.id, input.target.refId) : null;
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
  const veiled = { attacker: zoneHidesFrom(map, from, to, input.attacker.senses), target: zoneHidesFrom(map, to, from, input.target.senses) };
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
  const sees = (viewer: BattleToken, senses: Senses, subject: BattleToken): boolean => {
    const distance = chebyshev(viewer.x, viewer.y, subject.x, subject.y);
    if (distance <= senses.blindsight) {
      return true;
    }
    if (distance <= senses.tremorsense && subject.movement !== "fly") {
      return true;
    }
    const zones = vision.zones ?? [];
    if (zones.length && magicalDarknessAt(zones, subject.x, subject.y)) {
      return distance <= senses.truesight || distance <= senses.devilsSight;
    }
    const local = zones.length ? ambientAt(zones, subject.x, subject.y, ambient) : ambient;
    if (local !== "dark") {
      return true;
    }
    return (
      lit.has(tileIndex(map.width, subject.x, subject.y)) ||
      distance <= senses.darkvision ||
      distance <= senses.devilsSight ||
      distance <= senses.truesight
    );
  };
  return {
    attackerSees: !veiled.attacker && sees(from, input.attacker.senses, to),
    targetSees: !veiled.target && sees(to, input.target.senses, from),
  };
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
