// What the vermin lord's swarms and the grave knight's garden do as turns go
// by, wired by the 2026-11-13 creator audit's second genre pass (WAVE2 D5: the
// genre text is the rule). Called as each turn starts, beside the zone
// triggers (src/lib/dm/condition-tick.ts), and once more as a swarm is laid
// or called (src/lib/dm/genre-cc-a-spends.ts):
//
//   The Crown Descends: "1d6 piercing at the start of each of its turns" on a
//     creature the swarm holds (the swarmed condition the spend laid);
//   Garden of Grief: "allies in it regain 1d6 HP per turn": a character other
//     than the knight starting a turn on a square of the knight's garden;
//   The Walls Have Teeth: "While your swarm is active, enemies within 10 ft of
//     it cannot take reactions": every enemy within 10 feet of a square of the
//     vermin lord's Rat Tide holds the mark (no reactions), and the mark comes
//     off a creature no longer near one or once the swarm is gone.
//
// The swarm's squares are the area the Rat Tide laid (zones-genre-cc-a.ts).
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { getEnemy, listEnemies, patchEnemyConditions, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { regainHitPoints } from "@/lib/dm/regain";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { liveZones } from "@/lib/dm/zone-store";
import { chebyshev } from "@/lib/battlemap/types";
import { GARDEN_OF_GRIEF, RAT_TIDE } from "@/lib/battlemap/zones-genre-cc-a";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { SWARMED, TEETH } from "@/lib/srd/genre-cc-a-conditions";
import type { SpellZone } from "@/lib/battlemap/zones";

type Board = { map: NonNullable<ReturnType<typeof getBattleMapForEncounter>>; zones: SpellZone[] };

function boardOf(encounter: Encounter): Board | null {
  const map = getBattleMapForEncounter(encounter.id);
  return map ? { map, zones: liveZones(map, encounter) } : null;
}

const isZone = (zone: SpellZone, name: string) => isNamed(zone.spell, name);

// Whether a square lies on the zone, or within `feet` of one of its squares.
export function nearZone(board: Board, zone: SpellZone, at: { x: number; y: number }, feet: number): boolean {
  const width = board.map.width;
  return zone.cells.some((cell) => chebyshev(cell % width, Math.floor(cell / width), at.x, at.y) * 5 <= feet);
}

// The vermin lord's Rat Tide swarms on the board.
export function swarmsOf(board: Board, lordId?: string): SpellZone[] {
  return board.zones.filter((zone) => zone.casterKind === "pc" && (!lordId || zone.casterId === lordId) && isZone(zone, RAT_TIDE));
}

// Whether a creature stands within `feet` of a swarm of this vermin lord
// (Greater Gutter Fighting: "creatures adjacent to your swarm").
export function besideSwarm(encounter: Encounter, lordId: string, refId: string, feet = 5): boolean {
  const board = boardOf(encounter);
  const token = board ? getTokenByRef(board.map.id, refId) : null;
  return Boolean(board && token && swarmsOf(board, lordId).some((zone) => nearZone(board, zone, token, feet)));
}

function crownBites(campaign: Campaign, encounter: Encounter, ids: string[]): string[] {
  const lines: string[] = [];
  for (const id of ids) {
    const enemy = getEnemy(id);
    const held = enemy?.conditions.find((entry) => isConditionNamed(entry, SWARMED));
    if (!enemy || enemy.status !== "alive" || !held) {
      continue;
    }
    const lord = getSheetById(String(((enemy.conditionMeta ?? {}) as ConditionMetaMap)[held]?.source ?? ""));
    const amount = rollCard(campaign, null, lord?.id ?? null, "damage", `The Crown Descends: ${enemy.displayName}`, "1d6", lord ? sheetAttacker(lord) : null).total;
    lines.push(hurtEnemy(campaign, encounter, enemy, amount, "piercing", "The Crown Descends", true));
  }
  return lines;
}

function gardenHeals(campaign: Campaign, board: Board, ids: string[]): string[] {
  const lines: string[] = [];
  const gardens = board.zones.filter((zone) => zone.casterKind === "pc" && isZone(zone, GARDEN_OF_GRIEF));
  for (const id of ids) {
    const sheet = getSheetById(id);
    const token = sheet ? getTokenByRef(board.map.id, id) : null;
    if (!sheet || !token || sheet.deathSaves?.dead) {
      continue;
    }
    const garden = gardens.find((zone) => zone.casterId !== id && nearZone(board, zone, token, 0));
    if (!garden) {
      continue;
    }
    const knight = getSheetById(garden.casterId);
    const amount = rollCard(campaign, null, knight?.id ?? null, "custom", `Garden of Grief: ${sheet.name}'s hit points regained`, "1d6", null).total;
    const given = regainHitPoints(campaign, null, sheet, amount, "Garden of Grief");
    if (given > 0) {
      lines.push(`Garden of Grief: ${sheet.name} regains ${given} hit points among the black roses.`);
    }
  }
  return lines;
}

// Lays and lifts The Walls Have Teeth on every enemy of the fight.
export function refreshTeeth(campaign: Campaign, encounter: Encounter): string[] {
  const board = boardOf(encounter);
  if (!board) {
    return [];
  }
  const tokens = listTokens(board.map.id);
  const swarms = swarmsOf(board).filter((zone) => {
    const lord = getSheetById(zone.casterId);
    return Boolean(lord && holdsGenreFeature(lord, "vermin_lord", "The Walls Have Teeth"));
  });
  const lines: string[] = [];
  let changed = false;
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive") {
      continue;
    }
    const token = tokens.find((entry) => entry.refId === enemy.id);
    const near = Boolean(token && swarms.some((zone) => nearZone(board, zone, token, 10)));
    const holds = enemy.conditions.some((entry) => isConditionNamed(entry, TEETH));
    if (near === holds) {
      continue;
    }
    const meta = { ...((enemy.conditionMeta ?? {}) as ConditionMetaMap) };
    if (near) {
      patchEnemyConditions(enemy.id, [...enemy.conditions, TEETH], { ...meta, [TEETH]: { source: swarms[0].casterId } } as typeof enemy.conditionMeta);
      lines.push(`The Walls Have Teeth: ${enemy.displayName} is within 10 feet of the swarm and cannot take reactions.`);
    } else {
      delete meta[TEETH];
      patchEnemyConditions(enemy.id, enemy.conditions.filter((entry) => !isConditionNamed(entry, TEETH)), meta as typeof enemy.conditionMeta);
    }
    changed = true;
  }
  if (changed) {
    publishEncounter(campaign.id);
  }
  return lines;
}

export function ccTurnStart(campaign: Campaign, encounter: Encounter, combatantIds: string[]): string[] {
  const board = boardOf(encounter);
  return [
    ...crownBites(campaign, encounter, combatantIds),
    ...(board ? gardenHeals(campaign, board, combatantIds) : []),
    ...refreshTeeth(campaign, encounter),
  ];
}
