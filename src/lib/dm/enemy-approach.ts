import type { Campaign } from "@/lib/db/campaigns";
import { COWERING } from "@/lib/srd/genre-b-conditions";
import { tokenSides } from "@/lib/dm/combatant";
import { allyBeside } from "@/lib/dm/side-allies";
import { getEncounter, listEnemies, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken, resetTurnBudgets } from "@/lib/db/battle-maps";
import { findPath, reachableTiles, walkPathWithBudget } from "@/lib/battlemap/movement";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { bestFiringPosition } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { climbsFrom, crawlingTraits, swimsFrom, type BattleToken, type MoveTraits } from "@/lib/battlemap/types";
import { footprintDistance, enemyFootprint, nearestFootprintTile, type Footprint } from "@/lib/battlemap/footprint";
import { tokenFootprint } from "@/lib/dm/board-reach";

import { passableTiles } from "@/lib/battlemap/passage";
import { getSheetById } from "@/lib/db/sheets";
import { sheetSize } from "@/lib/srd";
import { instancesOf, removeConditions, type ConditionMeta } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { resolvePcOpportunityWalk } from "@/lib/dm/opportunity";
import { publishEphemeral } from "@/lib/events";
import { swingMode, type EnemyAttackProfile } from "@/lib/dm/enemy-profile";
import { enemyMoveBudget, enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { endsOwedTurn, markEnemyActed } from "@/lib/dm/can-act";
import { forgetEnemyTurns } from "@/lib/dm/enemy-turn-logic";
import { FLEEING, TURNED, fearDistance } from "@/lib/dm/flee-logic";
import { aggressiveSteps } from "@/lib/dm/enemy-aggressive";
import { missileDeflection, zoneStepsFor } from "@/lib/dm/zone-rules";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { AttackStop } from "@/lib/dm/turn-lines-logic";

// An enemy getting to where its attack reaches, on its own turn (SRD 5.1,
// Movement and Position): it stands up from prone for half its speed, walks
// no farther than its speed, stops as soon as its reach or its range covers
// the target, never walks closer to what it is frightened of, and draws the
// opportunity attacks of whoever it walks away from (none after a
// Disengage this turn). A model that never calls move_token still gets
// spatially honest enemies. Must not import encounter-tools or map-tools
// (they import this).

type XY = { x: number; y: number };

export type Approach = {
  // The refusal, when the attack cannot be made this turn, tagged with why
  // (turn-lines-logic.ts), so the backstop's line names it (issue #666).
  blocked?: ToolError & { heldGround?: string; stop: AttackStop };
  // A Wind Wall between them: why a ranged weapon swing misses.
  deflected?: string;
  movedTo?: string;
  opportunityAttacks?: string[];
  // Squares between the two after the approach; null with no board.
  distance: number | null;
};

export type FearSource = XY & { footprint?: number };

// Where the creatures it fears stand, those on the board: the source of each
// frightened it holds, the cleric who turned it, or the caster it flees at
// Command's word (none of them walks closer, SRD 5.1; issue #621), or the
// packmaster whose Alpha's Roar it cowers from ("no move toward you"). Every
// instance counts (condition-logic.ts instancesOf): frightened by two
// goblins, a hero read only the first and walked straight at the second
// (SRD 5.1, Frightened: it "can't willingly move closer to the source of its
// fear", and each instance of a condition holds on its own). The first is
// the one it runs from (enemy-flight.ts).
export function fearSourcesAt(
  mapId: string,
  conditions: string[],
  meta: Record<string, ConditionMeta | undefined>,
): FearSource[] {
  const held = ["frightened", TURNED, FLEEING, COWERING].map((name) => conditions.find((entry) => entry.toLowerCase() === name)).filter((entry): entry is string => Boolean(entry));
  const ids = [...new Set(held.flatMap((name) => instancesOf(meta?.[name]).map((instance) => instance.source)).filter((id): id is string => Boolean(id)))];
  return ids.flatMap((id) => {
    const token = getTokenByRef(mapId, id);
    // Its size goes with it: fear is measured to the nearest square it fills.
    return token ? [{ x: token.x, y: token.y, footprint: tokenFootprint(token) }] : [];
  });
}

// The steps of a walk a frightened creature may take: it stops before the
// first square that is closer to any source of its fear than where it began.
export function awayFromFear(from: XY, steps: XY[], sources: readonly FearSource[]): XY[] {
  if (!sources.length) {
    return steps;
  }
  const starts = sources.map((source) => fearDistance(from, source));
  const allowed: XY[] = [];
  for (const step of steps) {
    if (sources.some((source, at) => fearDistance(step, source) < starts[at])) {
      break;
    }
    allowed.push(step);
  }
  return allowed;
}

// An enemy spends its action. When that closes the turn it was owed and its
// own turn follows (can-act.ts endsOwedTurn), the own turn walks on fresh
// movement. The caller saves the encounter.
export function spendEnemyAction(encounter: Encounter, enemyId: string) {
  const ownTurnFollows = endsOwedTurn(encounter, enemyId);
  markEnemyActed(encounter, enemyId);
  if (!ownTurnFollows) {
    return;
  }
  // The own turn starts clean: a Disengage or a Dash of the owed turn is
  // no part of it (src/lib/dm/enemy-turn-logic.ts).
  forgetEnemyTurns(encounter, [enemyId]);
  const map = getBattleMapForEncounter(encounter.id);
  if (map) {
    resetTurnBudgets(map.id, [enemyId]);
  }
}

// What standing up would cost a prone enemy now, in squares: half its
// speed, or null when it stays down (no speed, or less than that left, its
// Dashes counted: issue #621). 0 when it is not prone.
export function standUpCost(encounterId: string, enemy: EncounterEnemy): number | null {
  if (!enemy.conditions.some((entry) => entry.toLowerCase() === "prone")) {
    return 0;
  }
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  const budget = token ? enemyMoveBudget(getEncounter(encounterId), enemy, token) : null;
  const full = budget ? budget.speedTiles : enemySpeedTiles(enemy);
  // Rounded up in squares, as a character's is (authored-effects-more.ts standUpTiles).
  const half = Math.ceil(full / 2);
  if (full <= 0 || (budget && budget.tilesLeft < half)) {
    return null;
  }
  return half;
}

// A prone enemy stands at the start of what it does on its turn, paying
// half its speed; with less than that left it stays down (and crawls, which
// the walk below does not attempt). Returns the enemy as it now stands.
export function standUpIfProne(encounterId: string, enemy: EncounterEnemy): { enemy: EncounterEnemy; stood: boolean } {
  const prone = enemy.conditions.find((entry) => entry.toLowerCase() === "prone");
  const half = prone ? standUpCost(encounterId, enemy) : null;
  if (!prone || half === null) {
    return { enemy, stood: false };
  }
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (token) {
    moveToken(token.id, token.x, token.y, token.movedThisRound + half);
  }
  const stood = removeConditions(enemy.conditions, enemy.conditionMeta, [prone]);
  patchEnemyConditions(enemy.id, stood.conditions, stood.meta);
  return { enemy: { ...enemy, conditions: stood.conditions, conditionMeta: stood.meta }, stood: true };
}

// The squares of a path up to and including the one landed on.
// The way a creature larger than a square walks toward a reach: to the
// cheapest square its whole space can stand on and strike from, squeezing
// where it must. Null when no such square is open.
function largeApproach(
  map: { terrain: string; width: number; height: number },
  occupied: Set<number>,
  origin: XY,
  footprint: Footprint,
  traits: MoveTraits,
  reachesFrom: (at: XY) => boolean,
): XY[] | null {
  const costs = reachableTiles(map.terrain, map.width, map.height, occupied, origin, map.width * map.height * 4, footprint, false, traits);
  let best: { at: XY; cost: number } | null = null;
  for (const [idx, cost] of costs) {
    const at = { x: idx % map.width, y: Math.floor(idx / map.width) };
    if ((!best || cost < best.cost) && reachesFrom(at)) {
      best = { at, cost };
    }
  }
  return best ? findPath(map.terrain, map.width, map.height, occupied, origin, best.at, footprint, false, traits) : null;
}

function walkedPart(path: XY[], landing: XY) {
  const at = path.findIndex((step) => step.x === landing.x && step.y === landing.y);
  return at >= 0 ? path.slice(0, at + 1) : path;
}

export function approachTarget(
  campaign: Campaign,
  encounterId: string,
  enemy: EncounterEnemy,
  targetRef: string,
  profile: EnemyAttackProfile,
  // A character holding a readied action (readied-release.ts readiedHolder):
  // while one waits, an enemy out of reach is not walked in and swung in one
  // call. The DM moves it with move_token, judges the trigger, then attacks.
  holdGround: { holder: string; trigger: string } | null = null,
  // Only asks: works out the walk and whether the attack then reaches,
  // and moves nothing (reachesThisTurn).
  options: { dryRun?: boolean } = {},
): Approach {
  const map = getBattleMapForEncounter(encounterId);
  const attacker = map ? getTokenByRef(map.id, enemy.id) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !attacker || !target) {
    return { distance: null };
  }
  // Measured between the nearest squares of the two (src/lib/battlemap/
  // footprint.ts): an ogre two squares wide reaches a character against
  // either of them, and is reached from either.
  const mine = enemyFootprint(enemy);
  const theirs = tokenFootprint(target);
  const apart = (at: XY) => footprintDistance(at, mine, target, theirs);
  const sightFrom = (at: XY) => {
    const to = nearestFootprintTile(target, theirs, at);
    const from = nearestFootprintTile(at, mine, to);
    return hasLineOfSight(map.terrain, map.width, from.x, from.y, to.x, to.y);
  };
  const reachesFrom = (at: XY) => {
    const distance = apart(at);
    if (profile.melee && distance <= profile.reachTiles && (distance <= 1 || sightFrom(at))) {
      return true;
    }
    return profile.ranged && distance <= profile.longRangeTiles && sightFrom(at);
  };
  const origin = { x: attacker.x, y: attacker.y };
  const startDistance = apart(origin);

  if (reachesFrom(origin)) {
    // A Wind Wall between them turns its arrows from where it stands too.
    const deflected = swingMode(profile, startDistance)?.ranged ? missileDeflection(encounterId, enemy.id, targetRef, target.name) : null;
    return deflected ? { distance: startDistance, deflected } : { distance: startDistance };
  }
  if (holdGround) {
    return {
      distance: startDistance,
      blocked: {
        error: `${attacker.name} is ${startDistance * 5} ft from ${target.name}, out of reach, and ${holdGround.holder} holds a readied action (${holdGround.trigger}). It does not walk in and attack in one call while someone waits on a trigger: move it with move_token, release ${holdGround.holder}'s readied action if its movement fired the trigger (or let the trigger pass), then call enemy_attack. Nothing was spent.`,
        retry: true,
        heldGround: holdGround.holder,
        stop: "held",
      },
    };
  }

  // Its movement this turn, its Dashes counted, and whether it Disengaged
  // (src/lib/dm/enemy-speed.ts enemyMoveBudget, issue #621).
  // A rider steering its mount rides it into reach (issue 1055, ruling 2: a
  // controlled mount "moves as you direct it"): the walk is the mount's, on
  // its movement, its Dash and its Disengage, and it is the mount that
  // provokes. A rider on a mount that acts as it wishes stays where the
  // mount's own turn left the pair.
  const steed = enemy.ridesEnemyId ? listEnemies(encounterId).find((entry) => entry.id === enemy.ridesEnemyId && entry.ledBy === enemy.id && entry.status === "alive") : undefined;
  const walker = steed ?? enemy;
  const move = enemyMoveBudget(getEncounter(encounterId), walker, attacker);
  // A dry run asks before the turn is played, while a prone creature still
  // lies there: it will stand first (standUpIfProne), paying half its speed,
  // and only the rest walks. Uncounted, a prone goblin picked its scimitar,
  // stood, fell short and never drew its bow.
  const standing = options.dryRun ? (standUpCost(encounterId, enemy) ?? 0) : 0;
  const budget = Math.max(0, move.tilesLeft - standing);
  const fear = fearSourcesAt(map.id, enemy.conditions, enemy.conditionMeta as Record<string, ConditionMeta>);
  // Every square of a large creature on the board is taken, not its corner.
  const occupied = occupiedTiles(map, listTokens(map.id), attacker, tokenFootprint);
  let landing: XY = origin;
  let cost = 0;
  let walked: XY[] = [];
  if (budget > 0 && profile.melee) {
    // Toward the target, stopping at the first square its reach covers.
    // Through its allies' spaces, and a character's two sizes apart.
    // Still prone once it tried to stand (standUpIfProne, or a dry run's
    // standUpCost), it had too little movement to stand and crawls, every
    // square one more (SRD 5.1, Being Prone), as move_token walks it.
    const crawls = enemy.conditions.some((entry) => isConditionNamed(entry, "prone")) && (!options.dryRun || standUpCost(encounterId, enemy) === null);
    const walking = enemyMoveTraits(map.width, listTokens(map.id), attacker, enemy.encounterId);
    const swims = crawls ? crawlingTraits(walking) : walking;
    // A creature larger than a square walks as its whole space: it squeezes
    // a one-square gap at double cost and stops where all of it fits, as
    // move_token walks it. Walked as one square, an ogre slipped through a
    // doorway at full speed and could stop half inside a wall.
    const path = mine > 1 ? largeApproach(map, occupied, origin, mine, swims, reachesFrom) : findPath(map.terrain, map.width, map.height, occupied, attacker, target, 1, false, swims);
    const approach = path ? (mine > 1 ? path : path.slice(0, -1)) : [];
    const stopAt = approach.findIndex((step) => reachesFrom(step));
    const unafraid = awayFromFear(origin, stopAt >= 0 ? approach.slice(0, stopAt + 1) : approach, fear);
    // Aggressive's speed goes only toward a hostile it can see (enemy-aggressive.ts).
    const live = getEncounter(encounterId);
    const wanted = live ? aggressiveSteps(live, map, enemy, attacker, unafraid, swims).steps : unafraid;
    const walk = walkPathWithBudget(map.terrain, map.width, wanted, budget, swims, origin, mine > 1 ? { height: map.height, occupied, footprint: mine } : undefined);
    if (walk.at) {
      landing = walk.at;
      cost = walk.spent;
      walked = walkedPart(wanted, walk.at);
    }
  } else if (budget > 0 && profile.ranged) {
    // A shooter out of range or sight steps to the nearest square with both.
    const spot =
      bestFiringPosition(map.terrain, map.width, map.height, occupied, attacker, target, budget, profile.rangeTiles) ??
      bestFiringPosition(map.terrain, map.width, map.height, occupied, attacker, target, budget, profile.longRangeTiles);
    const allowed =
      spot && fear.every((source) => fearDistance(spot.at, source) >= fearDistance(origin, source));
    const route = spot && allowed ? (findPath(map.terrain, map.width, map.height, occupied, attacker, spot.at) ?? []) : [];
    // A firing position Aggressive's speed would carry it away from a hostile to is not taken.
    const live = getEncounter(encounterId);
    const rushed = live && route.length ? aggressiveSteps(live, map, enemy, attacker, route, enemyMoveTraits(map.width, listTokens(map.id), attacker, enemy.encounterId)) : null;
    if (spot && allowed && !rushed?.cut) {
      landing = spot.at;
      cost = spot.cost;
      walked = route;
    }
  }
  let provoked: string[] = [];
  let stoppedBySwing = false;
  if (!options.dryRun && (landing.x !== origin.x || landing.y !== origin.y)) {
    // Walking is walking: whoever it leaves behind gets their opportunity
    // attack, however it came to move, unless it Disengaged this turn: a
    // Nimble Escape goblin's Disengage held for move_token and was forgotten
    // by this walk-up (issue #621). Rolled before the token moves, as on
    // move_token: a hit that leaves its speed at 0 (Sentinel, Hold the Line)
    // or drops it ends the walk-up on the square the swing was taken on.
    const struck = resolvePcOpportunityWalk(campaign, walker.id, origin, landing, walked.length ? walked : undefined, move.disengaged);
    provoked = struck.notes;
    if (struck.stoppedAt) {
      const at = walked.findIndex((step) => step.x === struck.stoppedAt?.x && step.y === struck.stoppedAt?.y);
      walked = at >= 0 ? walked.slice(0, at + 1) : [];
      landing = struck.stoppedAt;
      stoppedBySwing = true;
    }
    if (landing.x !== origin.x || landing.y !== origin.y) {
      moveToken(attacker.id, landing.x, landing.y, attacker.movedThisRound + cost,
        attacker.movement === "walk" ? [origin, ...walked] : undefined);
      publishEphemeral(campaign.id, "battle_map_updated", {});
      // The spell areas it walked into (src/lib/dm/zone-triggers.ts).
      provoked.push(...zonesAfterMove(campaign, encounterId, { kind: "enemy", refId: walker.id }, origin, walked.length ? walked : [landing]));
    }
  }
  const distance = apart(landing);
  const moved = landing.x !== origin.x || landing.y !== origin.y;

  const base = {
    distance,
    ...(moved ? { movedTo: `(${landing.x},${landing.y})` } : {}),
    ...(provoked.length ? { opportunityAttacks: provoked } : {}),
  };
  // Dropped on the way, it attacks nobody: enemy_attack says it fell
  // (enemy-attack.ts, the walk "may have drawn an opportunity attack that
  // killed it"), not that it could not reach.
  if (stoppedBySwing && listEnemies(encounterId).find((entry) => entry.id === enemy.id)?.status !== "alive") {
    return base;
  }
  if (reachesFrom(landing) && swingMode(profile, distance)) {
    // A Wind Wall between them turns its arrows (zone-rules.ts): each shot
    // through it is made and misses.
    const deflected = swingMode(profile, distance)?.ranged ? missileDeflection(encounterId, enemy.id, targetRef, target.name) : null;
    return deflected ? { ...base, deflected } : base;
  }
  const why = stoppedBySwing
    ? `${attacker.name} was stopped at (${landing.x},${landing.y}) by an opportunity attack, its speed 0 for the rest of the turn: it is ${distance * 5} ft from ${target.name} and cannot reach them this turn`
    : fear.length
    ? `${attacker.name} is frightened and will not move closer to what it fears`
    : profile.melee
      ? `${attacker.name} is ${distance * 5} ft from ${target.name} and cannot reach them this turn`
      : sightFrom(landing)
        ? `${attacker.name} is ${distance * 5} ft from ${target.name}, beyond this attack's ${profile.longRangeTiles * 5} ft range, and cannot close the gap this turn`
        : `${attacker.name} has no line of sight to ${target.name} and cannot reach a firing position this turn`;
  const stop: AttackStop = fear.length ? "fear" : profile.melee ? "reach" : sightFrom(landing) ? "range" : "sight";
  // The game saying no, not a mistake in the call: the walk was made, its
  // movement spent and its opportunity attacks rolled, so a retry told the
  // model nothing had happened (issue #666).
  return {
    ...base,
    blocked: {
      error: `${why}${moved ? `; it moved to (${landing.x},${landing.y})` : ""}. Use a ranged option, a different target, or another action.`,
      refused: "rules",
      stop,
    },
  };
}

// Whether an attack with `profile` reaches the target this turn, walking as
// approachTarget would, without moving anything. True with no board.
export function reachesThisTurn(campaign: Campaign, encounterId: string, enemy: EncounterEnemy, targetRef: string, profile: EnemyAttackProfile): boolean {
  return !approachTarget(campaign, encounterId, enemy, targetRef, profile, null, { dryRun: true }).blocked;
}

// Pack Tactics' condition: another enemy of the target, standing and able to
// act, within 5 feet of it (SRD 5.1).
export function enemyAllyNear(encounterId: string, enemyId: string, targetRef: string): boolean {
  // Its side's, not its kind's (side-allies.ts, issue 503).
  return allyBeside(encounterId, { kind: "enemy", id: enemyId }, targetRef);
}

// An enemy's walking traits on the board: a swimming or climbing speed from
// its stat block, whose spaces it may pass through (its allies', a
// character's two sizes apart, src/lib/battlemap/passage.ts), and, for a
// creature larger than one square, squeezing where one size smaller fits.
export function enemyMoveTraits(width: number, tokens: BattleToken[], mover: BattleToken, encounterId: string): MoveTraits {
  const enemies = new Map(listEnemies(encounterId).map((entry) => [entry.id, entry]));
  const sizeOf = (token: BattleToken): string | undefined => {
    if (token.kind === "enemy") {
      return enemies.get(token.refId)?.stats.size;
    }
    if (token.kind === "pc") {
      const sheet = getSheetById(token.refId);
      return sheet ? sheetSize(sheet) : undefined;
    }
    return undefined;
  };
  const footprintOf = (token: BattleToken) =>
    token.kind === "enemy" ? enemyFootprint(enemies.get(token.refId)) : tokenFootprint(token);
  // The creature walking. A rider's token is walked only by its mount, on
  // the mount's legs (issue 1055, ruling 2), so a crocodile's swim speed is
  // the pair's: read from the goblin on its back, the pair waded.
  const standing = enemies.get(mover.refId);
  const walker = standing?.ridesEnemyId ? (enemies.get(standing.ridesEnemyId) ?? standing) : standing;
  const speed = walker?.stats.speed;
  // And what the spell areas on the board make of each step (zone-rules.ts).
  return zoneStepsFor({
    swims: swimsFrom(speed),
    climbs: climbsFrom(speed),
    passable: passableTiles({ width, tokens, mover, footprintOf, sizeOf, sideOf: tokenSides(getEncounter(encounterId)) }),
    squeeze: footprintOf(mover) > 1,
  }, encounterId, "enemy", walker?.id ?? mover.refId);
}
