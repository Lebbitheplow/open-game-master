import { readiedHeld } from "@/lib/dm/readied-kinds";
import { carriedLight, lightPlacement } from "@/lib/dm/light-timers";
import { getClock } from "@/lib/db/clock";
import { getDatabase } from "@/lib/db/core";
import type { Campaign } from "@/lib/db/campaigns";
import {
  getActiveBoard,
  getActiveEncounter,
  getEncounter,
  getEnemy,
  listEnemies,
  saveEncounter,
  turnKey,
  type Encounter,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import type { CombatSide } from "@/lib/dm/combat-sides-logic";
import { sideOf, standingFoesLine } from "@/lib/dm/combatant";
import {
  createBattleMap,
  getBattleMapForEncounter,
  getTokenByRef,
  listTokens,
  moveToken,
  placeTokens,
  resetTurnBudgets,
  setTokenMovement,
  type BattleMap,
} from "@/lib/db/battle-maps";
import { planTeleportFx } from "@/lib/battlemap/fx-plan";
import { placeTeleported } from "@/lib/dm/teleport-place";
import { publishFx } from "@/lib/dm/fx";
import { buildingSkin, drawBuilding, holdsBuilding, type BuildingPlan } from "@/lib/battlemap/building";
import { generateBattleMap, fnv1a, spotsForTokens, tilesBetweenSides } from "@/lib/battlemap/generate";
import { findPath, squeezedAt, walkPathWithBudget } from "@/lib/battlemap/movement";
import { coverBetweenSpaces, hasLineOfSightBetween } from "@/lib/battlemap/los";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { openSquaresBeside } from "@/lib/dm/companion-approach";
import { aiPlaysSheet } from "@/lib/dm/companion-command";
import { spaceOf, tilesApart } from "@/lib/dm/board-reach";

import {
  blocksMove,

  tileAt,
  tileIndex,
  TILE_FEET,
  TOKEN_MOVEMENTS,
  type BattleToken,
} from "@/lib/battlemap/types";
import { getCurrentLocation } from "@/lib/db/locations";
import { getParty } from "@/lib/db/party";
import { placeByFormation } from "@/lib/dm/formation-logic";
import { getSheetById } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { resolvePcOpportunityWalk } from "@/lib/dm/opportunity";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { canAct, canEnemyAct } from "@/lib/dm/can-act";
import { heldTurnRefusal, ownTurnOf } from "@/lib/dm/held-turn";
import { afterMoveLeashes, leashRefusal } from "@/lib/dm/condition-leash";
import { auraMenaceAsk } from "@/lib/dm/aura-menace";
import { awayFromFear, enemyMoveTraits, fearSourceAt, standUpCost, standUpIfProne } from "@/lib/dm/enemy-approach";
import { enemyMoveBudget } from "@/lib/dm/enemy-speed";
import { movementLeft, spendEnemyDisengage } from "@/lib/dm/enemy-actions";
import { forgetEnemyTurns, enemyTurnEntry, speedWords } from "@/lib/dm/enemy-turn-logic";
import { nearerSquares } from "@/lib/dm/flee-logic";
import { aggressiveSteps, approachSteps } from "@/lib/dm/enemy-aggressive";
import { enemyTurnRefusal } from "@/lib/dm/enemy-turn-order";
import { declaredThisTurn, walkHeld } from "@/lib/dm/player-word";
import { featureTeleportFeet } from "@/lib/dm/feature-teleport";
import { featureLandingRefusal } from "@/lib/dm/mt-mr-spends";
import { goesBetweenShadows, shadowsRefusal } from "@/lib/dm/ar-ws-shadow-light";
import { distancesFrom, payForTeleport, stillAt, teleportRangeFeet, walkCharacter } from "@/lib/dm/token-rules";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { z } from "zod";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import { recordMovesNear } from "@/lib/dm/move-near";
import { zoneCoverBetween } from "@/lib/dm/zone-rules";
import { longRangeTilesOf, pastNormalRange } from "@/lib/dm/attack-rules";
import { dragLandings, enemyDrag } from "@/lib/dm/drag-move";
import { walkCostFactor } from "@/lib/dm/drag";
import { flightOf, markSqueezing } from "@/lib/dm/token-state";
import { livePurchase } from "@/lib/dm/legendary-logic";
import { swallowRowWalk } from "@/lib/dm/swallow";
import { badArguments, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { echoStrikeFrom, moveEcho } from "@/lib/dm/mt-fb-echo";
import { moveMind } from "@/lib/dm/scribe-mind";
import { findNamed, textKey } from "@/lib/language/text-logic";

export { landTheFlightless } from "@/lib/dm/token-state";

// Battle-map lifecycle and the move_token DM tool. Kept separate from
// encounter-tools.ts to hold both files under the size limit; this module
// must not import encounter-tools (the import points the other way).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

// Contentless ping: with per-character fog even token coordinates are
// secret, so clients re-fetch their own filtered projection.
export function publishBattleMapUpdate(campaignId: string) {
  publishEphemeral(campaignId, "battle_map_updated", {});
}

// The token fields for that light, lit as the party steps onto the board.
export function carriedLightFields(campaignId: string, sheet: CharacterSheet) {
  return lightPlacement(carriedLight(sheet), getClock(campaignId).instant);
}

export function createBattleMapForEncounter(
  campaign: Campaign,
  encounter: Encounter,
  enemies: EncounterEnemy[],
  sheets: CharacterSheet[],
  // How far the nearest enemy stands as the fight opens, when the story
  // said (start_encounter's distanceFeet); a tile is five feet.
  distanceFeet?: number,
  // The ground the fight is on when it is not the place's own
  // (start_encounter's scene).
  scene?: string,
  // Where the enemy comes from against the travel formation (issue 230).
  from: "ahead" | "behind" = "ahead",
  // One side caught the other unawares: the board opens close
  // (battlemap/generate.ts CLOSE_OPENING_TILES) unless distanceFeet said.
  ambush = false,
  // The party inside a building, the enemies outside (issue 743).
  building?: BuildingPlan,
): { map: BattleMap; formation: string; distance?: string; building?: string } | null {
  const location = getCurrentLocation(campaign.id);
  const askedTiles = distanceFeet ? Math.max(1, Math.round(distanceFeet / TILE_FEET)) : undefined;
  const ground = scene ?? location?.ambience?.bed ?? null;
  const drawn = generateBattleMap({
    seed: fnv1a(encounter.id),
    // The place itself may be the building: an inn's own ambience would draw
    // the yard as more inn, so the ground outside it is open ground.
    scene: building && !holdsBuilding(ground) ? null : ground,
    pcCount: sheets.length,
    enemyCount: enemies.length,
    enemyDistanceTiles: askedTiles,
    ambush,
  });
  const house = building
    ? drawBuilding(drawn, {
        plan: building,
        seed: fnv1a(encounter.id),
        pcCount: sheets.length,
        enemyFootprints: enemies.map((enemy) => footprintForSize(enemy.stats.size)),
        enemyDistanceTiles: askedTiles,
      })
    : null;
  const generated = house ?? drawn;
  // Every token's tile is settled before anything is written, and the map and
  // its tokens are written together: a failure leaves no board without its
  // tokens (issue 741).
  const taken = new Set<number>();
  const partySpots = spotsForTokens(generated, generated.pcSpawns, sheets.length, taken);
  const enemySpots = spotsForTokens(generated, generated.enemySpawns, enemies.length, taken);
  // The party stands by its travel formation: the front of it nearest the
  // enemy, or the rear when they came from behind (formation-logic.ts).
  const formation = placeByFormation(sheets, partySpots, enemySpots, getParty(campaign.id).marchingOrder, from);
  const map = getDatabase().transaction(() => {
    const created = createBattleMap({
      encounterId: encounter.id,
      campaignId: campaign.id,
      width: generated.width,
      height: generated.height,
      terrain: generated.terrain,
      ambient: generated.ambient,
      theme: generated.theme,
      lights: generated.lights,
      seed: fnv1a(encounter.id),
      skin: house ? buildingSkin(campaign.gameSettings.genre, generated.theme) : undefined,
    });
    placeTokens(created.id, campaign.id, [
      ...sheets.map((sheet) => ({
        kind: "pc" as const,
        refId: sheet.id,
        name: sheet.name,
        spot: formation.spots.get(sheet.id) ?? partySpots[0],
        ...carriedLightFields(campaign.id, sheet),
      })),
      ...enemies.map((enemy, index) => ({
        kind: "enemy" as const,
        refId: enemy.id,
        name: enemy.displayName,
        spot: enemySpots[index],
      })),
    ]);
    return created;
  })();
  publishBattleMapUpdate(campaign.id);
  // The tool promises the board places them at the distance asked, so a
  // distance past the board's edge is said out loud: range and movement run
  // on the tiles, and a GM narrating 200 feet would misread both.
  const apart = askedTiles && partySpots.length && enemySpots.length ? tilesBetweenSides(partySpots, enemySpots) : undefined;
  const distance = askedTiles && apart !== undefined && apart < askedTiles
    ? `This board cannot hold ${distanceFeet} feet: the nearest enemy stands ${apart * TILE_FEET} feet from the party on it. Range and movement go by the board, so narrate them that far off.`
    : house && askedTiles && apart !== undefined && apart > askedTiles
      ? `The building's wall stands between them, so the nearest enemy stands ${apart * TILE_FEET} feet from the party, not ${distanceFeet}. Range and movement go by the board, so narrate them that far off.`
      : undefined;
  return { map, formation: formation.line, ...(distance ? { distance } : {}), ...(house ? { building: house.building.line } : {}) };
}

// ---- teleports and set_movement ----
//
// A teleport is move_token with teleport (issue #471); handleTeleportToken
// keeps its own name in the engine, for the callers that still send it.

export const setMovementTool: ToolDef = {
  type: "function",
  function: {
    name: "set_movement",
    description:
      "Record that a combatant is now flying, burrowing or back on foot (Fly spell, wings, Wild Shape into a bird, a burrowing worm). Only a creature with a flying speed takes to the air (the Fly spell cast with cast_buff, wings, a flying form, a stat block's fly); the server refuses the rest. A flying character moves at their flying speed (Fly: 60 feet), and one whose flight ends comes down prone. Flying creatures pass over ground obstacles and are missed by tremorsense; the board draws them lifted.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        token: { type: "string", description: "Character or enemy name or id, exactly as shown on the battle map in GAME STATE." },
        movement: { type: "string", enum: ["walk", "fly", "burrow"] },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["token", "movement"],
    },
  },
};

const teleportArgsSchema = z.object({
  token: z.string(),
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  rangeFeet: z.coerce.number().int().optional(),
  spell: z.string().max(80).optional(),
  enemyAbility: z.string().max(80).optional(),
  casterCharacterId: z.string().max(80).optional(),
  casterEnemyId: z.string().max(80).optional(),
  cause: z.enum(["hazard"]).optional(),
  reason: z.string().optional(),
});

const movementArgsSchema = z.object({
  token: z.string(),
  movement: z.enum(TOKEN_MOVEMENTS),
  reason: z.string().optional(),
});

// The board's own token id, as the battle map's view lists each token, read
// as the character or enemy it stands for. A GM or agent reading the board
// copies that id; the tools otherwise know only a sheet's or an enemy's.
function boardTokenById(map: BattleMap, ref: string): BattleToken | null {
  return listTokens(map.id).find((token) => token.id === ref) ?? null;
}

// Any combatant on the board by name or id, PC or enemy, alive or not:
// a teleport works on whoever is asked for, unlike a walk.
function resolveAnyToken(
  map: BattleMap,
  encounterId: string,
  ref: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): BattleToken | null {
  const own = boardTokenById(map, ref.trim());
  if (own && own.kind !== "pc" && own.kind !== "enemy") {
    return own;
  }
  const trimmed = own?.refId ?? ref.trim();
  const sheet = resolveSheetRef(trimmed, sheets, sheetsById);
  if (sheet) {
    return getTokenByRef(map.id, sheet.id);
  }
  const enemies = listEnemies(encounterId);
  const byId = enemies.find((entry) => entry.id === trimmed);
  if (byId) {
    return getTokenByRef(map.id, byId.id);
  }
  // An enemy or one of the DM's own pieces by its whole name
  // (src/lib/language/text-logic.ts findNamed): "goblin" with Goblin 1 on the
  // board is no piece, and is asked again with the names there are
  // (unknownCombatant).
  const named = [
    ...enemies.map((enemy) => ({ name: enemy.displayName, token: () => getTokenByRef(map.id, enemy.id) })),
    ...listTokens(map.id)
      .filter((token) => token.kind !== "pc" && token.kind !== "enemy")
      .map((token) => ({ name: token.name, token: () => token })),
  ];
  return findNamed(named, trimmed, (entry) => [entry.name])?.token() ?? null;
}

// A name the board holds no single token for: the names it does hold.
function unknownCombatant(map: BattleMap, name: string): ToolError {
  return { error: `No combatant on the battle map is called "${name}"; it holds ${listTokens(map.id).map((token) => token.name).join(", ")}.`, retry: true };
}

// Whether `token` may teleport to (x, y): on the map, open floor, nobody
// there, and within `rangeFeet` when one is given. Every teleport reads it
// (handleTeleportToken, a counter's teleport taken with its reaction:
// src/lib/dm/reaction-tools.ts counterTeleport), so a square refused here is
// refused before anything is spent.
export function teleportSquareRefusal(map: BattleMap, token: BattleToken, x: number, y: number, rangeFeet: number | null): ToolError | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return { error: `(${x},${y}) is outside the ${map.width}x${map.height} map.`, retry: true };
  }
  if (blocksMove(tileAt(map.terrain, map.width, x, y))) {
    return { error: `(${x},${y}) is a wall; a teleport needs open floor.`, retry: true };
  }
  if (occupiedTiles(map, listTokens(map.id), token).has(tileIndex(map.width, x, y))) {
    return { error: `(${x},${y}) is occupied by another combatant.`, retry: true };
  }
  const distanceFeet = Math.max(Math.abs(x - token.x), Math.abs(y - token.y)) * TILE_FEET;
  if (rangeFeet !== null && distanceFeet > rangeFeet) {
    return { error: `(${x},${y}) is ${distanceFeet} ft away, past the ${rangeFeet} ft range. Pick a tile within range.`, retry: true };
  }
  return null;
}

export function handleTeleportToken(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // The DM turn behind the call: the AI's teleport is a spell cast and paid
  // for (token-rules.ts); a person at the console moves pieces freely.
  turn?: DmTurn,
): ToolResult {
  const board = getActiveBoard(campaign.id);
  if (!board) {
    return { error: "There is no board on the table.", retry: true };
  }
  const map = getBattleMapForEncounter(board.id);
  if (!map) {
    return { error: "This board has no battle map.", retry: true };
  }
  let args: z.infer<typeof teleportArgsSchema>;
  try {
    args = teleportArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: a teleport needs token, x and y.", error, rawArguments);
  }
  const token = resolveAnyToken(map, board.id, args.token, sheets, sheetsById);
  if (!token) {
    return unknownCombatant(map, args.token);
  }
  const square = teleportSquareRefusal(map, token, args.x, args.y, null);
  if (square) {
    return square;
  }
  const distanceFeet = Math.max(Math.abs(args.x - token.x), Math.abs(args.y - token.y)) * TILE_FEET;
  const spender = args.spell && args.casterCharacterId ? resolveSheetRef(args.casterCharacterId, sheets, sheetsById) : null;
  const featureFeet = spender && args.spell ? featureTeleportFeet(spender.id, args.spell) : null;
  // Shadow Step lands in dim light or darkness (mt-mr-spends.ts).
  const landing = spender && args.spell && featureFeet !== null ? featureLandingRefusal(campaign.id, spender, args.spell, { x: args.x, y: args.y }) : null;
  if (landing) {
    return landing;
  }
  // A legendary action that bought the jump (a sphinx's or a solar's
  // Teleport) gives its reach and has paid for it.
  const live = token.kind === "enemy" ? getActiveEncounter(campaign.id) : null;
  const legendaryFeet = live ? (livePurchase(live.legendary, { turn: turnKey(live), round: live.round }, token.refId)?.teleportFeet ?? null) : null;
  const rangeFeet = legendaryFeet ?? featureFeet ?? (args.spell ? teleportRangeFeet(args.spell) : null) ?? args.rangeFeet;
  if (rangeFeet !== undefined && rangeFeet !== null && distanceFeet > rangeFeet) {
    return {
      error: `(${args.x},${args.y}) is ${distanceFeet} ft away, past the ${rangeFeet} ft range. Pick a tile within range.`,
      retry: true,
    };
  }
  // A feature that goes only between shadows (Shadow Walk) asks the light
  // at both ends of the teleport its spend paid for (ar-ws-shadow-light.ts).
  const lit = spender && args.spell && featureFeet !== null && goesBetweenShadows(spender, args.spell) ? shadowsRefusal(campaign.id, map, token, { x: args.x, y: args.y }, args.spell) : null;
  if (lit) {
    return lit;
  }
  // Every refusal above spends nothing; the spell is cast (or the enemy's
  // block checked) only now.
  if (turn?.actor === "ai" && legendaryFeet === null) {
    const refused = payForTeleport(
      campaign,
      turn,
      getActiveEncounter(campaign.id),
      token,
      args,
      sheets,
      sheetsById,
    );
    if (refused) {
      return refused;
    }
  }
  const from = { x: token.x, y: token.y };
  // On record for what answers a teleport (teleport-place.ts).
  placeTeleported(campaign.id, token, { x: args.x, y: args.y });
  publishBattleMapUpdate(campaign.id);
  publishFx(campaign.id, planTeleportFx({ from, to: { x: args.x, y: args.y }, tokenId: token.id }));
  return {
    ok: true,
    name: token.name,
    from: `(${from.x},${from.y})`,
    at: `(${args.x},${args.y})`,
    distanceFeet,
    note: "No movement was spent; the board already shows the new position.",
  };
}

export function handleSetMovement(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // The AI takes to the air only what has a flying speed; a person at the
  // console keeps a free hand (a turn left out is theirs).
  turn?: Pick<DmTurn, "actor">,
): ToolResult {
  const board = getActiveBoard(campaign.id);
  if (!board) {
    return { error: "There is no board on the table.", retry: true };
  }
  const map = getBattleMapForEncounter(board.id);
  if (!map) {
    return { error: "This board has no battle map.", retry: true };
  }
  let args: z.infer<typeof movementArgsSchema>;
  try {
    args = movementArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: set_movement needs token and movement (walk, fly or burrow).", error, rawArguments);
  }
  const token = resolveAnyToken(map, board.id, args.token, sheets, sheetsById);
  if (!token) {
    return unknownCombatant(map, args.token);
  }
  if (token.movement === args.movement) {
    return { ok: true, name: token.name, movement: args.movement, note: "Already so." };
  }
  if (turn?.actor === "ai" && args.movement === "fly" && flightOf(board.id, token) === null) {
    return {
      error: `${token.name} has no flying speed, so they cannot take to the air: a creature flies with a flying speed (the Fly spell, wings, a flying Wild Shape form, a stat block's fly). Nothing changed.`,
      refused: "rules",
    };
  }
  setTokenMovement(token.id, args.movement);
  publishBattleMapUpdate(campaign.id);
  return {
    ok: true,
    name: token.name,
    movement: args.movement,
    note:
      args.movement === "fly"
        ? `${token.name} is airborne: ground hazards and tremorsense no longer apply.`
        : args.movement === "burrow"
          ? `${token.name} is underground: unseen from above unless it surfaces.`
          : `${token.name} is back on foot.`,
  };
}

// ---- move_token tool ----

export const moveTokenTool: ToolDef = {
  type: "function",
  function: {
    name: "move_token",
    description:
      "Move a combatant on the battle map. A walk (no forced): an enemy taking its movement, or a character on their own turn, either an AI companion or a player character walking the move their player just declared; it spends their speed (standing from prone too) and draws opportunity attacks. A forced move (forced:true): a character pushed, pulled, or carried. A teleport (teleport:true): to an open, empty tile WITHOUT walking (Misty Step, a portal, a trap door), by spell with casterCharacterId for a character's (the server casts it and refuses a jump past its range), casterEnemyId with enemyAbility or spell for an enemy's, or cause 'hazard'. The server enforces walls, occupancy, speed, fear and squeezing, and clamps a move to the farthest legal tile toward the target.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        token: {
          type: "string",
          description:
            "Character or enemy name or id, exactly as shown on the battle map in GAME STATE.",
        },
        x: { type: "integer", description: "Destination column." },
        y: { type: "integer", description: "Destination row." },
        forced: {
          type: "boolean",
          description: "True only when a character is moved against their will.",
        },
        disengage: {
          type: "boolean",
          description:
            "An enemy Disengages before it walks, so leaving reach draws no opportunity attack. Its action, or a bonus action with Nimble Escape.",
        },
        drag: {
          type: "boolean",
          description:
            "An enemy drags the character it grapples, keeping the grapple; without drag, leaving reach lets go. The server halves its speed as the rules say.",
        },
        careful: { type: "boolean", description: "Half speed: no save in caltrops or ball bearings." },
        teleport: { type: "boolean", description: "No walking and no movement spent." },
        spell: { type: "string", description: "A teleport's spell (Misty Step), or the feature a character spent on it." },
        casterCharacterId: { type: "string", description: "Its caster: exact characterId from GAME STATE." },
        casterEnemyId: { type: "string", description: "Or its user: exact enemyId from GAME STATE." },
        enemyAbility: { type: "string", description: "An enemy's teleport ability, named as on its stat block (Fey Step), when it is no spell." },
        cause: { type: "string", enum: ["hazard"], description: "A teleport no spell made (a trap door, a portal)." },
        rangeFeet: { type: "integer", minimum: 5, maximum: 1000, description: "A teleport spell's range, if the server does not know it." },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["token", "x", "y"],
    },
  },
};

const moveArgsSchema = z.object({
  token: z.string(),
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  forced: z.coerce.boolean().optional(),
  disengage: z.coerce.boolean().optional(),
  drag: z.boolean().optional(),
  careful: z.boolean().optional(),
  reason: z.string().optional(),
});

function resolveMoveTarget(
  map: BattleMap,
  encounterId: string,
  ref: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { token: BattleToken; kind: "pc" | "enemy"; enemy?: EncounterEnemy } | null {
  const trimmed = boardTokenById(map, ref.trim())?.refId ?? ref.trim();
  const sheet = resolveSheetRef(trimmed, sheets, sheetsById);
  if (sheet) {
    const token = getTokenByRef(map.id, sheet.id);
    return token ? { token, kind: "pc" } : null;
  }
  const enemies = listEnemies(encounterId);
  // By its whole name only, as resolveAnyToken reads it: "A" (gpt-oss-20b
  // meaning Avery) once walked Bandit 1, the first name with an "a" in it.
  const enemy =
    enemies.find((entry) => entry.id === trimmed) ??
    enemies.find((entry) => textKey(entry.displayName) === textKey(trimmed));
  if (!enemy || enemy.status !== "alive") {
    return null;
  }
  const token = getTokenByRef(map.id, enemy.id);
  // Grappled/restrained/stunned... = speed 0; the budget clamp refuses the
  // move with the standard "no movement left" error.
  return token ? { token, kind: "enemy", enemy } : null;
}

// The squares of a path up to and including the one landed on.
function walkedPart(path: Array<{ x: number; y: number }>, landing: { x: number; y: number }) {
  const at = path.findIndex((step) => step.x === landing.x && step.y === landing.y);
  return at >= 0 ? path.slice(0, at + 1) : path;
}

export function handleMoveToken(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  turn: Pick<DmTurn, "id" | "actor">,
  // A legendary move (src/lib/dm/legendary-play.ts): this many squares, none
  // of the creature's own turn's movement, opportunity attacks only when the
  // option provokes them, aloft for a flight. A move_token after a
  // legendary_action that bought a move reads the same from the purchase.
  legendaryMove?: { tiles: number; provokes: boolean; fly: boolean },
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: there is no board to move tokens on. Call start_encounter first, or move the party with move_party.", retry: true };
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return { error: "This encounter has no battle map.", retry: true };
  }
  let args: z.infer<typeof moveArgsSchema>;
  try {
    args = moveArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: move_token needs token, x, and y.", error, rawArguments);
  }
  // An Echo Knight's echo is no combatant: it moves by its own rule (mt-fb-echo.ts).
  const echoMoved = moveEcho(campaign, encounter, map, args);
  if (echoMoved) {
    return echoMoved;
  }
  // A Scribes wizard's spellbook mind moves for their bonus action (scribe-mind.ts).
  const mindMoved = moveMind(campaign, encounter, map, args);
  if (mindMoved) {
    return mindMoved;
  }
  const resolved = resolveMoveTarget(map, encounter.id, args.token, sheets, sheetsById);
  if (!resolved) {
    return unknownCombatant(map, args.token);
  }
  const allowance =
    resolved.kind === "enemy" && resolved.enemy && !args.forced
      ? (legendaryMove ?? livePurchase(encounter.legendary, { turn: turnKey(encounter), round: encounter.round }, resolved.enemy.id)?.move ?? null)
      : null;
  if (resolved.kind === "pc" && !args.forced) {
    // An AI companion walks on its own turn as a player walks from the
    // board: its speed, standing from prone, fear, opportunity attacks. So
    // does a character whose player just typed the move on their own turn,
    // and a companion a player commands, once they have given the order.
    const walker = resolveSheetRef(args.token, sheets, sheetsById);
    const fresh = walker ? (getSheetById(walker.id) ?? walker) : null;
    const declared = fresh && turn.actor === "ai" && declaredThisTurn(campaign.id, fresh.id);
    // Their own turn, not one held for the enemies before them (held-turn.ts
    // ownTurnOf): the pointer resting on them while the goblins act is the
    // goblins' turn.
    const ownTurn = Boolean(fresh && ownTurnOf(encounter, fresh.id));
    // A player who said their character stays put is not walked, whatever
    // else they asked for (src/lib/dm/player-word-logic.ts).
    const held = fresh && ownTurn ? walkHeld(campaign.id, turn, fresh, " Nothing was moved.") : null;
    if (held) {
      return held;
    }
    if (fresh && (aiPlaysSheet(campaign, fresh) || declared) && ownTurn) {
      return walkCharacter(campaign, encounter, map, fresh, resolved.token, { x: args.x, y: args.y }, { drag: args.drag, careful: args.careful });
    }
    // The move a character readied releases off their turn, by whoever runs
    // the table (readied-release.ts: their reaction, up to their speed).
    if (fresh && readiedHeld(fresh)?.holds === "move" && !ownTurn) {
      return walkCharacter(campaign, encounter, map, fresh, resolved.token, { x: args.x, y: args.y }, { drag: args.drag, careful: args.careful });
    }
    // Off their own turn, a character in the order is the game saying no, as
    // pc_attack and take_action say it (can-act.ts): answered as a retry that
    // named forced:true, it invited the model to send the walk again as a
    // push. The retry below stays for a walk on their turn nobody declared.
    const placed = encounter.orderReady && encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === fresh?.id);
    if (fresh && placed && !ownTurn) {
      const heldOff = heldTurnRefusal(encounter, fresh);
      if (heldOff) {
        return heldOff;
      }
      const able = canAct({ sheet: fresh, encounter, kind: "move" });
      if (!able.ok) {
        return toolError(able);
      }
    }
    return {
      error: fresh?.isCompanion && aiPlaysSheet(campaign, fresh)
        ? `${resolved.token.name} walks on their own turn only; pass forced:true when something pushes, drags, or carries them.`
        : fresh?.isCompanion
          ? `${resolved.token.name} follows their player's orders in fights; move_token walks them on their own turn only, for the move that player just declared. Pass forced:true only when something pushes, drags, or carries them.`
          : `${resolved.token.name} is a player character; players move their own tokens, and move_token walks one only on their own turn, for the move their player just declared. Pass forced:true only when something pushes, drags, or carries them.`,
      retry: true,
    };
  }
  // On their own turn the player moves from the board; a "forced" move here
  // is the model walking a character for them (issue 17: a token that moved
  // with no input). Pushes and drags happen on somebody else's turn, and the
  // goblins' pass before a hero is theirs though the pointer already rests
  // on the hero (held-turn.ts ownTurnOf): a goblin's shove of Brom then was
  // refused as Brom walking himself.
  if (resolved.kind === "pc" && args.forced && encounter.orderReady) {
    if (ownTurnOf(encounter, resolved.token.refId)) {
      return {
        error: `It is ${resolved.token.name}'s own turn; they move their own token from the board (a companion walks with move_token and no forced). Forced movement is for a push, drag or carry on someone else's turn.`,
        retry: true,
      };
    }
  }
  // An enemy walking is an enemy acting: a surprised one stands where it is
  // through round 1, on its own (lost) turn too, which the reaction's
  // question let pass once the pointer had gone by its place. A legendary
  // move is spent on another creature's turn, and asks as a reaction does. A
  // push or a drag moves whoever it moves.
  if (resolved.kind === "enemy" && resolved.enemy && !args.forced) {
    const allowed = canEnemyAct({ enemy: resolved.enemy, encounter, kind: allowance ? "reaction" : "move" });
    if (!allowed.ok && allowed.reason === "surprised") {
      return toolError(allowed);
    }
    // Movement belongs to its turn, and every turn now brings its own
    // (advancePointer): a walk taken before its turn would be given back when
    // its turn starts. A legendary creature may still move on a legendary
    // action.
    const early = encounter.legendary.pools[resolved.enemy.id] ? null : enemyTurnRefusal(encounter, resolved.enemy, turn);
    if (early) {
      return early;
    }
  }
  if (args.x < 0 || args.y < 0 || args.x >= map.width || args.y >= map.height) {
    return { error: `(${args.x},${args.y}) is outside the ${map.width}x${map.height} map.`, retry: true };
  }

  const tokens = listTokens(map.id);
  // Large creatures cover their whole footprint, so an ogre neither walks
  // through a one-tile gap nor stops where its second row would overlap.
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const footprints = footprintLookup(enemiesById);
  const occupied = occupiedTiles(map, tokens, resolved.token, footprints);
  const moverFootprint = footprints(resolved.token);
  if (occupied.has(tileIndex(map.width, args.x, args.y))) {
    return { error: `(${args.x},${args.y}) is occupied by another combatant.`, retry: true };
  }
  // An enemy walking on its own passes its allies and squeezes where it
  // must (enemy-approach.ts enemyMoveTraits); a forced move does neither.
  const traits =
    resolved.kind === "enemy" && !args.forced
      ? enemyMoveTraits(map.width, tokens, resolved.token, encounter.id)
      : false;
  // A frightened or turned enemy takes a way that never comes nearer what
  // it fears, when there is one: the cheapest path stepped closer first, and
  // the walk stopped there (issue #621, a turned zombie that could not run).
  const feared = resolved.kind === "enemy" && resolved.enemy && !args.forced
    ? fearSourceAt(map.id, resolved.enemy.conditions, resolved.enemy.conditionMeta as Record<string, { source?: string }>)
    : null;
  const pathAvoiding = (blocked: Set<number>) =>
    findPath(map.terrain, map.width, map.height, blocked, resolved.token, { x: args.x, y: args.y }, moverFootprint, resolved.token.movement === "fly" || Boolean(allowance?.fly), traits);
  const path =
    (feared ? pathAvoiding(new Set([...occupied, ...nearerSquares(map.width, map.height, resolved.token, feared)])) : null) ??
    pathAvoiding(occupied);
  if (!path) {
    return {
      error:
        moverFootprint > 1
          ? `No path to (${args.x},${args.y}) for a creature ${moverFootprint} squares wide; walls or others block the way.`
          : `No path to (${args.x},${args.y}); walls block the way.`,
      retry: true,
    };
  }

  // Forced movement ignores speed (the force decides the distance); normal
  // enemy movement clamps to the turn's remaining budget along the path.
  let landing = { x: args.x, y: args.y };
  let spent = 0;
  let clamped = false;
  // Dragging the character it grapples halves its speed (drag-move.ts), and
  // so does walking carefully; a creature pushed or carried chooses neither.
  const drag = args.drag && !args.forced && resolved.enemy ? enemyDrag(campaign.id, resolved.enemy, tokens) : null;
  if (drag && "error" in drag) {
    return toolError(drag);
  }
  // An enemy walking on its own: its movement this turn with its Dashes
  // counted, and the Disengage it took earlier in the turn (issue #621).
  // A forced move is clamped by the same count, as it always was, and
  // stands, fears and Disengages nothing.
  const move = resolved.kind === "enemy" && resolved.enemy ? enemyMoveBudget(encounter, resolved.enemy, resolved.token) : null;
  const walking = move !== null && !args.forced;
  // Swallowed, as a character is (swallow.ts): no walk inside a living
  // creature, and out of a dead one the walk is the climb out of its corpse.
  const climb = walking && resolved.enemy ? swallowRowWalk(campaign, encounter, resolved.enemy, resolved.token, move?.tilesLeft ?? 0) : null;
  if (climb) {
    return climb;
  }
  let standCost = 0;
  let aggressiveCut = false;
  let approachCut = false;
  // Careful: at half speed, so caltrops and ball bearings ask no save.
  const careful = Boolean(args.careful) && !args.forced;
  const factor = walkCostFactor(drag?.factor ?? 1, careful);
  if (resolved.kind === "enemy") {
    // Walking on its own: a prone creature stands first for half its speed,
    // and a frightened one never steps closer to what it fears. Standing is
    // worked out here and made only once the walk and its Disengage hold:
    // a refused walk stood the creature up all the same.
    let steps = path;
    let fearCut = false;
    if (walking && resolved.enemy) {
      standCost = standUpCost(encounter.id, resolved.enemy) ?? 0;
      steps = awayFromFear(
        resolved.token,
        path,
        fearSourceAt(map.id, resolved.enemy.conditions, resolved.enemy.conditionMeta as Record<string, { source?: string }>),
      );
      fearCut = steps.length < path.length;
      // Aggressive's speed goes only toward a hostile it can see, and
      // Command's Approach only toward the caster (enemy-aggressive.ts).
      const rushed = aggressiveSteps(encounter, map, resolved.enemy, resolved.token, steps, traits);
      const drawn = approachSteps(map, resolved.enemy, resolved.token, rushed.steps);
      steps = drawn.steps;
      aggressiveCut = rushed.cut;
      approachCut = drawn.cut;
    }
    const budget = Math.floor(Math.max(0, (allowance ? allowance.tiles : (move?.tilesLeft ?? 0)) - standCost) / factor);
    const walk = walkPathWithBudget(map.terrain, map.width, steps, budget, traits, resolved.token);
    if (!walk.at && allowance) {
      return { error: `${resolved.token.name} cannot get anywhere toward (${args.x},${args.y}) on its legendary move (${allowance.tiles * 5} ft).${stillAt(tokens, resolved.token)}`, refused: "rules" };
    }
    if (!walk.at) {
      const words = move && resolved.enemy ? speedWords(move.speedTiles, enemyTurnEntry(encounter, resolved.enemy.id)) : "speed 0 ft";
      const why = approachCut
        ? ", and Command draws it only toward its caster"
        : aggressiveCut
          ? ", and Aggressive carries it only toward a hostile creature it can see"
          : fearCut
            ? ", and it will not move closer to what it fears"
            : "";
      return {
        error: `${resolved.token.name} has no movement left this turn (${words})${why}.${stillAt(tokens, resolved.token)}`,
        refused: "rules",
      };
    }
    landing = walk.at;
    spent = walk.spent * factor;
    clamped = !walk.reachedEnd || aggressiveCut || approachCut;
    // Its own walk keeps to a leash on it (condition-leash.ts): Champion
    // Challenge's "cannot move more than 30 feet away".
    const leashed = !args.forced && resolved.enemy ? leashRefusal(map.id, resolved.enemy, resolved.token, landing) : null;
    if (leashed) {
      return leashed;
    }
  }
  const origin = { x: resolved.token.x, y: resolved.token.y };
  const carried = drag ? dragLandings({ map, tokens, mover: resolved.token, landing, walked: [origin, ...walkedPart(path, landing)], held: drag.held, footprintOf: footprints }) : [];
  if (!carried) {
    return { error: `There is no room beside (${landing.x},${landing.y}) to set down the character ${resolved.token.name} drags. Choose another square.`, retry: true };
  }
  // Disengage first, paid for (enemy-actions.ts): then leaving reach draws
  // nothing, on this walk and every later one this turn. Every refusal is
  // above: nothing has changed until here.
  let disengaged: string | null = walking && move.disengaged ? "its Disengage earlier this turn" : null;
  let closesOwedTurn = false;
  if (args.disengage && walking && resolved.enemy && !disengaged && !allowance) {
    const paid = spendEnemyDisengage(campaign.id, resolved.enemy);
    if ("error" in paid) {
      return toolError(paid);
    }
    disengaged = paid.how;
    closesOwedTurn = Boolean(paid.closesOwedTurn);
  }
  if (standCost && resolved.enemy) {
    standUpIfProne(encounter.id, resolved.enemy);
  }
  // An enemy breaking away from a character eats their opportunity attack,
  // exactly as the reverse does when a player walks off. Forced movement
  // (a shove, a gust of wind) provokes nothing. Taken before the token moves:
  // a hit that leaves its speed at 0 (Sentinel, Hold the Line) or drops it
  // ends the walk on the square the swing was taken on. The token used to go
  // the whole way first, so a goblin Orin's Sentinel stopped still stood at
  // the far end, with movement to spare.
  const struck =
    resolved.kind === "enemy" && !args.forced && (!allowance || allowance.provokes)
      ? resolvePcOpportunityWalk(
          campaign,
          resolved.token.refId,
          origin,
          landing,
          walkedPart(path, landing),
          Boolean(disengaged),
        )
      : { notes: [] as string[] };
  const opportunity = struck.notes;
  const stoppedAt = struck.stoppedAt ?? null;
  const intended = landing;
  if (stoppedAt) {
    landing = stoppedAt;
  }
  // The squares actually walked: none when it was stopped where it began.
  const walked = stoppedAt && stoppedAt.x === origin.x && stoppedAt.y === origin.y ? [] : walkedPart(path, landing);
  // What it drags comes with it only as far as it got; with no room there,
  // they stay where they are.
  const carriedNow = stoppedAt && drag
    ? (walked.length ? (dragLandings({ map, tokens, mover: resolved.token, landing, walked: [origin, ...walked], held: drag.held, footprintOf: footprints }) ?? []) : [])
    : carried;
  moveToken(
    resolved.token.id,
    landing.x,
    landing.y,
    resolved.kind === "enemy" && !allowance
      ? (getTokenByRef(map.id, resolved.token.refId)?.movedThisRound ?? resolved.token.movedThisRound) + spent
      : (getTokenByRef(map.id, resolved.token.refId)?.movedThisRound ?? resolved.token.movedThisRound),
  );
  // A flight takes it up: it stays aloft where it lands (set_movement).
  if (allowance?.fly && resolved.token.movement !== "fly") {
    setTokenMovement(resolved.token.id, "fly");
  }
  for (const entry of carriedNow) {
    moveToken(entry.token.id, entry.at.x, entry.at.y, entry.token.movedThisRound);
  }
  // The Disengage and this walk were the turn it was owed; its own turn
  // follows on fresh movement, with no Disengage (enemy-actions.ts
  // spendEnemyDisengage).
  if (closesOwedTurn) {
    resetTurnBudgets(map.id, [resolved.token.refId]);
    const live = getActiveEncounter(campaign.id);
    if (live) {
      forgetEnemyTurns(live, [resolved.token.refId]);
      saveEncounter(live);
    }
  }
  publishBattleMapUpdate(campaign.id);
  // Moving two creatures apart ends a grapple between them (src/lib/dm/grapple.ts),
  // and a leash whose source is now too far (condition-leash.ts).
  releaseGrapplesOutOfReach(campaign);
  const leashesEnded = afterMoveLeashes(campaign);
  // A large creature that ended its move where only one size smaller fits is
  // squeezing (SRD 5.1); one that has room again is not.
  if (resolved.kind === "enemy" && resolved.enemy) {
    markSqueezing(campaign.id, resolved.enemy.id, squeezedAt(map.terrain, map.width, map.height, occupied, landing, moverFootprint));
  }

  // The spell areas walked (or pushed) into: their saves and damage (zone-triggers.ts).
  const zoneEffects = zonesAfterMove(campaign, encounter.id, resolved.token, origin, walked, { careful });
  // Who it came near, on record for what answers a creature moving up (move-near.ts).
  recordMovesNear(campaign.id, tokens, resolved.token, origin, walked);
  // An enemy entering an aura that asks once (Avenging Angel's aura of
  // menace, src/lib/dm/aura-menace.ts): its save as it comes in.
  if (resolved.kind === "enemy" && resolved.enemy) {
    zoneEffects.push(...auraMenaceAsk(campaign, resolved.enemy.id));
  }
  return {
    ok: true,
    name: resolved.token.name,
    at: `(${landing.x},${landing.y})`,
    ...distancesFrom(tokens, resolved.token, landing),
    ...(zoneEffects.length ? { zoneEffects } : {}),
    ...(leashesEnded.length ? { released: leashesEnded.join(" ") } : {}),
    ...(opportunity.length
      ? {
          opportunityAttacks: opportunity,
          opportunityNote:
            "The server already rolled and applied these; narrate them, and do not call pc_attack for them.",
        }
      : {}),
    ...(stoppedAt
      ? {
          note: getEnemy(resolved.token.refId)?.status === "alive"
            ? `${resolved.token.name} was stopped at (${landing.x},${landing.y}), where the opportunity attack was taken, short of (${intended.x},${intended.y}): its speed is 0 for the rest of the turn.`
            : `${resolved.token.name} fell at (${landing.x},${landing.y}), where the opportunity attack was taken, short of (${intended.x},${intended.y}).`,
        }
      : clamped
      ? {
          note: approachCut
            ? `Command draws ${resolved.token.name} only toward its caster: it stopped at (${landing.x},${landing.y}) short of (${args.x},${args.y}).`
            : aggressiveCut
              ? `Aggressive carries ${resolved.token.name} only toward a hostile creature it can see: it stopped at (${landing.x},${landing.y}) short of (${args.x},${args.y}).`
              : allowance
                ? `Its legendary move goes ${allowance.tiles * 5} ft: ${resolved.token.name} stopped at (${landing.x},${landing.y}) short of (${args.x},${args.y}).`
                : `Speed limited the move: ${resolved.token.name} stopped at (${landing.x},${landing.y}) short of (${args.x},${args.y}).`,
        }
      : {}),
    ...(disengaged ? { disengaged: `Disengaged with ${disengaged}: no opportunity attacks${opportunity.length ? " but a Sentinel's" : ""}.` } : {}),
    ...(allowance ? { legendaryMove: `A legendary move: none of its own turn's movement spent${allowance.provokes ? "" : ", and no opportunity attacks"}.` } : {}),
    // Read from the creature as it is now: a stop the swing laid is in it.
    ...(walking && resolved.enemy && !allowance ? { movementLeft: movementLeft(campaign.id, getEnemy(resolved.enemy.id) ?? resolved.enemy) } : {}),
  };
}

// A shove: the target goes one square straight away from whoever pushed it.
// Forced movement, so nothing is spent and nothing is provoked. The square
// has to be open floor with nobody on it; otherwise the target stays.
export function pushTokenAway(
  campaign: Campaign,
  encounterId: string,
  pusherRef: string,
  targetRef: string,
): { moved: true; at: { x: number; y: number } } | { moved: false; reason: string } {
  const map = getBattleMapForEncounter(encounterId);
  const pusher = map ? getTokenByRef(map.id, pusherRef) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !pusher || !target) {
    return { moved: false, reason: "there is no battle map to move it on" };
  }
  const at = {
    x: target.x + Math.sign(target.x - pusher.x),
    y: target.y + Math.sign(target.y - pusher.y),
  };
  if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height) {
    return { moved: false, reason: "the edge of the map is behind it" };
  }
  if (blocksMove(tileAt(map.terrain, map.width, at.x, at.y))) {
    return { moved: false, reason: "a wall is behind it" };
  }
  if (occupiedTiles(map, listTokens(map.id), target).has(tileIndex(map.width, at.x, at.y))) {
    return { moved: false, reason: "someone stands behind it" };
  }
  moveToken(target.id, at.x, at.y, target.movedThisRound);
  publishBattleMapUpdate(campaign.id);
  return { moved: true, at };
}

// A pull: the target goes one square straight toward whoever pulls it, and
// stops beside them. Forced movement under pushTokenAway's rules: nothing is
// spent, nothing is provoked, and the square must be open floor with nobody
// on it.
export function pullTokenToward(
  campaign: Campaign,
  encounterId: string,
  pullerRef: string,
  targetRef: string,
): { moved: true; at: { x: number; y: number } } | { moved: false; reason: string } {
  const map = getBattleMapForEncounter(encounterId);
  const puller = map ? getTokenByRef(map.id, pullerRef) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !puller || !target) {
    return { moved: false, reason: "there is no battle map to move it on" };
  }
  if (tilesApart(puller, target) <= 1) {
    return { moved: false, reason: "it is already beside them" };
  }
  const at = {
    x: target.x + Math.sign(puller.x - target.x),
    y: target.y + Math.sign(puller.y - target.y),
  };
  if (blocksMove(tileAt(map.terrain, map.width, at.x, at.y))) {
    return { moved: false, reason: "a wall is in the way" };
  }
  if (occupiedTiles(map, listTokens(map.id), target).has(tileIndex(map.width, at.x, at.y))) {
    return { moved: false, reason: "someone stands in the way" };
  }
  moveToken(target.id, at.x, at.y, target.movedThisRound);
  publishBattleMapUpdate(campaign.id);
  return { moved: true, at };
}

// ---- spatial checks for pc_attack ----

// Sneak Attack's second trigger: another enemy of the target is within 5 ft
// of it and is not incapacitated (SRD 5.1), meaning a PC token other than the
// attacker, standing adjacent, whose sheet is up and able to act; a party
// companion is a PC token too. Null map = no spatial information, so the
// caller falls back to the advantage trigger alone rather than guessing.
export function allyAdjacentToEnemy(
  encounterId: string,
  attackerCharacterId: string,
  enemyId: string,
): boolean {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return false;
  }
  const target = getTokenByRef(map.id, enemyId);
  if (!target) {
    return false;
  }
  // An ally is a creature of the attacker's side (src/lib/dm/combatant.ts):
  // a companion that turned on the party is no rogue's ally, and a creature
  // the party dominates is.
  const encounter = getEncounter(encounterId);
  const mine = encounter ? sideOf(encounter, "sheet", attackerCharacterId) : "party";
  return listTokens(map.id).some(
    (token) =>
      token.refId !== attackerCharacterId &&
      token.refId !== enemyId &&
      tilesApart(token, target) <= 1 &&
      allyCanThreaten(token, encounter, mine),
  );
}

// An ally standing up: on the attacker's side, above 0 hit points, alive,
// and not incapacitated.
function allyCanThreaten(token: { kind: string; refId: string }, encounter: Encounter | null, side: CombatSide): boolean {
  if (token.kind === "enemy") {
    const enemy = getEnemy(token.refId);
    return Boolean(encounter && enemy && enemy.status === "alive" && !isIncapacitated(enemy.conditions) && sideOf(encounter, "enemy", enemy.id, enemy) === side);
  }
  if (token.kind !== "pc") {
    return false;
  }
  const sheet = getSheetById(token.refId);
  return Boolean(
    sheet && sheet.currentHp > 0 && !sheet.deathSaves?.dead && !isIncapacitated(sheet.conditions) && (!encounter || sideOf(encounter, "sheet", sheet.id, sheet) === side),
  );
}

// Read-only range gate for player attacks: PCs are never auto-moved (players
// walk their own tokens), so an out-of-reach attack is refused with the
// distance spelled out. No map = no spatial enforcement. Returns an error
// string, or null when the attack may proceed.
// What the map says about an attack beyond whether it is legal: the cover
// the target enjoys and whether the shot is past its normal range. Returned
// alongside the refusal so pc_attack can fold both into the roll.
export type AttackSpatials = {
  cover: 0 | 2 | 5;
  longRange: boolean;
  // Tiles between the two, and whether the board is under the sky, so the
  // weather riders can be applied (src/lib/srd/weather.ts). Zero and false
  // when there is no board.
  distanceTiles: number;
  outdoors: boolean;
};

export function pcAttackSpatials(
  encounterId: string,
  characterId: string,
  enemyId: string,
  options: { ranged: boolean; rangeTiles: number; thrown: boolean },
  // The square a strike is made from when it is not the attacker's own
  // (Spiritual Weapon's weapon, issue 659): cover is read from there.
  from?: { x: number; y: number },
): AttackSpatials {
  const none: AttackSpatials = { cover: 0, longRange: false, distanceTiles: 0, outdoors: false };
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return none;
  }
  const own = getTokenByRef(map.id, characterId);
  const target = getTokenByRef(map.id, enemyId);
  // An Echo Knight's melee attack is made from their echo's square when it is
  // the nearer (mt-fb-echo.ts echoStrikeFrom, as checkPcAttackRange reads it).
  from ??= own && target && !options.ranged ? (echoStrikeFrom(map.id, characterId, target) ?? undefined) : undefined;
  const attacker = own && from ? { ...own, x: from.x, y: from.y } : own;
  if (!attacker || !target) {
    return none;
  }
  // Nearest square to nearest square: a Large target's space is four squares.
  // Cover is read to the one of them the attacker sees best.
  const distance = tilesApart(attacker, target);
  return {
    // Blade Barrier's three-quarters cover counts as a wall's (zone-rules.ts).
    cover: Math.max(coverBetweenSpaces(map.terrain, map.width, map.height, spaceOf(attacker), spaceOf(target)), zoneCoverBetween(encounterId, characterId, enemyId, from)) as 0 | 2 | 5,

    // Past the weapon's normal range but inside its long range: the SRD
    // penalty is disadvantage, and checkPcAttackRange allows up to double.
    longRange: pastNormalRange(options, distance),
    distanceTiles: distance,
    outdoors: map.outdoors,
  };
}

export function checkPcAttackRange(
  encounterId: string,
  characterId: string,
  enemyId: string,
  options: {
    ranged: boolean;
    rangeTiles: number;
    reachTiles: number;
    thrown: boolean;
    // The weapon's printed long range. Absent, the attack reaches twice its
    // normal range, which is what an attack-roll spell and a homebrew weapon
    // saved without one still do.
    longRangeTiles?: number;
    // The square the attack is made from when it is not the attacker's own
    // (a Scribes wizard's spell from their spellbook mind, scribe-mind.ts).
    from?: { x: number; y: number };
  },
): (ToolError & { closeIn?: string }) | null {
  const encounter = getEncounter(encounterId);
  const map = getBattleMapForEncounter(encounterId);
  if (!encounter || !map) {
    return null;
  }
  const own = getTokenByRef(map.id, characterId);
  const target = getTokenByRef(map.id, enemyId);
  if (!own || !target) {
    return null;
  }
  // "Make any attack of the Attack action from its space": an Echo Knight's
  // melee attack is measured from their echo's square when it is the nearer
  // (mt-fb-echo.ts echoStrikeFrom).
  const echoAt = options.from ?? (options.ranged ? null : echoStrikeFrom(map.id, characterId, target));
  const attacker = echoAt ? { ...own, ...echoAt } : own;
  const distance = tilesApart(attacker, target);
  const maxTiles = longRangeTilesOf(options);
  const sighted = hasLineOfSightBetween(map.terrain, map.width, spaceOf(attacker), spaceOf(target));

  if (!options.ranged && distance <= options.reachTiles) {
    // In reach. Toe to toe nothing can stand between; a reach weapon at 10
    // feet does not strike through the wall square in the middle.
    return distance <= 1 || sighted
      ? null
      : { error: `A wall stands between ${attacker.name} and ${target.name}; the blow cannot reach through it. They must move their token to a clear line first or pick another target.`, retry: true };
  }
  // The SRD long-range rule: past its normal range a weapon shoots at
  // disadvantage out to its long range. Past that it cannot reach at all.
  if ((options.ranged || options.thrown) && distance <= maxTiles) {
    return sighted
      ? null
      : { error: `${attacker.name} has no line of sight to ${target.name}; something blocks the shot. They must move their token to a sightline first or pick another target.`, retry: true };
  }
  // The foes this same attack reaches from where they stand, for the next
  // call to aim at instead.
  const tokens = listTokens(map.id);
  const within = (tiles: number) => {
    const line = standingFoesLine(encounter.campaignId, encounter, (id) => {
      const token = tokens.find((entry) => entry.refId === id);
      return Boolean(token && tilesApart(attacker, token) <= tiles);
    });
    return line ? ` ${options.ranged || options.thrown ? "In range" : "Within reach"}: ${line}.` : "";
  };
  if (options.ranged || options.thrown) {
    return { error: `${attacker.name} is ${distance * 5} ft from ${target.name}, beyond this attack's ${maxTiles * 5} ft maximum range.${within(maxTiles)} They must move their token closer or pick another target.`, retry: true };
  }
  // Named, so a model that cannot count tiles knows where the walk ends.
  // The directions name the model's own tools, so they ride beside the
  // sentence: a person refused at the Hand or the console reads the
  // sentence alone, and a model reads both (src/lib/dm/invoke.ts).
  const enemy = listEnemies(encounterId).find((entry) => entry.id === target.refId);
  const square = openSquaresBeside(encounterId, map, attacker, target, footprintForSize(enemy?.stats.size))[0];
  const refusal = { error: `${attacker.name} is ${distance * 5} ft from ${target.name}, out of melee reach (${options.reachTiles * 5} ft).${within(options.reachTiles)} They must move their token adjacent first or attack with a ranged weapon.`, retry: true as const };
  return square
    ? { ...refusal, closeIn: `When their player said they close in, send the attack again with approach true: the server walks them to (${square.x},${square.y}), the nearest open square beside ${target.name}, and attacks. The nearest open square beside ${target.name} is (${square.x},${square.y}): move_token ${attacker.name} there, then attack.` }
    : refusal;
}
