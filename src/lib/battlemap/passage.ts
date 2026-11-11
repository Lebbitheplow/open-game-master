// Whose space a mover may pass through (SRD 5.1, Moving Around Other
// Creatures): "You can move through a nonhostile creature's space. In
// contrast, you can move through a hostile creature's space only if the
// creature is at least two sizes larger or smaller than you." Halfling
// Nimbleness adds any creature of a size larger than the halfling's. Either
// way the space is difficult terrain, and no mover ends its move in it
// (src/lib/battlemap/movement.ts reads the set this returns).
//
// Pure: the caller hands in the tokens, their footprints and their sizes.

import { climbsFreely } from "@/lib/srd/feat-combat";
import { earthUnderfoot, hasEarthWalk } from "@/lib/srd/mt-species-traits";
import { footprintIndexes, type Footprint } from "@/lib/battlemap/footprint";
import { moveTraitsFrom, TERRAIN, tileIndex, type BattleToken, type MoveTraits } from "@/lib/battlemap/types";
import { sizeForRace } from "@/lib/srd";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { movesThroughEverything } from "@/lib/dm/ar-ws-umbral-logic";
import { itemSpeeds, type Wearer, type WornMagicItem } from "@/lib/srd/magic-items";

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

export function sizeIndex(size: string | undefined): number {
  const at = SIZES.indexOf((size ?? "").trim().toLowerCase());
  return at === -1 ? 2 : at;
}

// The side a token is on for passage: "prop" for a thing, else a side name.
export type TokenSide = (token: Pick<BattleToken, "kind" | "refId">) => string;

export function kindSide(token: Pick<BattleToken, "kind">): string {
  return token.kind === "enemy" ? "foe" : token.kind === "prop" ? "prop" : "party";
}

export function passableTiles(input: {
  width: number;
  tokens: BattleToken[];
  mover: BattleToken;
  footprintOf: (token: BattleToken) => Footprint;
  sizeOf: (token: BattleToken) => string | undefined;
  // Halfling Nimbleness: through the space of any creature larger than you.
  nimble?: boolean;
  // The side each token's creature fights on, when a fight has sides other
  // than its kinds' (src/lib/dm/combatant.ts tokenSides: a companion turned
  // on the party is hostile to it). Absent: by kind.
  sideOf?: TokenSide;
  // A Phantom's Ghost Walk: "the ability to move through creatures and
  // objects". Every creature's space, and a prop's (the board's objects:
  // SRD 5.1, "an object is a discrete, inanimate item ... not a building").
  // Walls are the building and still stop it; a space passed through is
  // difficult terrain and nobody ends a move in one, as for any passage.
  // Umbral Form: through every creature's space and every object's
  // (src/lib/dm/ar-ws-umbral-logic.ts).
  everything?: boolean;
}): Set<number> {
  const out = new Set<number>();
  const moverSize = sizeIndex(input.sizeOf(input.mover));
  // Characters and the DM's figures side with each other; enemies with each
  // other. A prop is a thing, not a creature, and blocks.
  const side = input.sideOf ?? kindSide;
  const moverSide = side(input.mover);
  for (const token of input.tokens) {
    if (token.id === input.mover.id || (side(token) === "prop" && !input.everything)) {
      continue;
    }
    const size = sizeIndex(input.sizeOf(token));
    const friendly = side(token) === moverSide;
    const through = input.everything === true || friendly || Math.abs(size - moverSize) >= 2 || (input.nimble === true && size > moverSize);
    if (!through) {
      continue;
    }
    const footprint = input.footprintOf(token);
    if (footprint === 1) {
      out.add(tileIndex(input.width, token.x, token.y));
      continue;
    }
    for (const idx of footprintIndexes(input.width, { x: token.x, y: token.y }, footprint)) {
      out.add(idx);
    }
  }
  return out;
}

// The condition a Phantom's Ghost Walk lays (authored-effects-sweep-counters.ts).
const GHOST_WALK = "ghost walk";

// Halfling Nimbleness on a sheet.
export function hasHalflingNimbleness(features: Array<{ name: string }> = []): boolean {
  return holdsFeature({ features }, "Halfling Nimbleness");
}

// A character's walking traits on the board, with whose space they may pass
// through: the move route and the board's reachable tiles ask the same.
export function pcMoveTraits(input: {
  width: number;
  tokens: BattleToken[];
  mover: BattleToken;
  sheet: { race: string; features: Array<{ name: string }>; equipment?: WornMagicItem[]; speed?: number; conditions?: string[] } & Wearer;
  footprintOf: (token: BattleToken) => Footprint;
  enemySize: (refId: string) => string | undefined;
  sideOf?: TokenSide;
  // What the board was drawn for (BattleMap.theme), for the traits that ask
  // what the difficult ground is made of (Earth Walk).
  theme?: string;
  // The board as drawn (BattleMap.drawnTerrain), door glyphs and all: the
  // doors and windows a Ghost Walk passes through (objectTiles).
  drawnTerrain?: string;
  // Mobile on a turn its holder Dashed (src/lib/dm/ar-wbf-feat-turn.ts
  // crossesAnyGround): difficult terrain costs no extra.
  anyGround?: boolean;
}): MoveTraits {
  const moverSize = sizeForRace(input.sheet.race);
  // Athlete: climbing costs no extra movement (src/lib/srd/feat-combat.ts).
  const base = moveTraitsFrom(input.sheet.features);
  const freely = typeof base === "object" && base !== null && climbsFreely(input.sheet) ? { ...base, climbs: true } : base;
  // A worn item's swimming or climbing speed (SRD 5.1, Ring of Swimming,
  // Slippers of Spider Climbing) moves through water and up walls at cost.
  const worn = input.sheet.equipment?.length ? itemSpeeds(input.sheet.equipment, input.sheet, input.sheet.speed ?? 30) : {};
  const traits = typeof freely === "object" && freely !== null && (worn.swim || worn.climb)
    ? { ...freely, ...(worn.swim ? { swims: true } : {}), ...(worn.climb ? { climbs: true } : {}) }
    : freely;
  // Earth Walk (earth genasi): difficult ground of earth or stone costs no
  // extra movement (src/lib/srd/mt-species-traits.ts).
  const earthen = hasEarthWalk(input.sheet) && earthUnderfoot(input.theme) ? { landStride: true } : {};
  // Umbral Form's holder and a Phantom on its Ghost Walk both pass.
  const everything = movesThroughEverything(input.sheet.conditions) || (input.sheet.conditions ?? []).some((entry) => isConditionNamed(entry, GHOST_WALK));
  const spaces = passableTiles({
    width: input.width,
    tokens: input.tokens,
    mover: input.mover,
    footprintOf: input.footprintOf,
    sizeOf: (token) => (token.id === input.mover.id ? moverSize : token.kind === "enemy" ? input.enemySize(token.refId) : undefined),
    nimble: hasHalflingNimbleness(input.sheet.features),
    everything,
    ...(input.sideOf ? { sideOf: input.sideOf } : {}),
  });
  return {
    ...(typeof traits === "object" ? traits : { swims: traits }),
    ...earthen,
    ...(input.anyGround ? { anyGround: true } : {}),
    passable: everything && input.drawnTerrain ? new Set([...spaces, ...objectTiles(input.drawnTerrain)]) : spaces,
  };
}

// The board's objects a mover through "creatures and objects" passes as
// difficult terrain and never stops in, as a creature's space: every door,
// a locked or secret one included (scene.ts walls it in the terrain the
// engine runs), and every low wall, a window or a fence (building.ts). A wall
// is the building, and stops it (SRD 5.1, Objects: "not a building").
export function objectTiles(drawnTerrain: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < drawnTerrain.length; index += 1) {
    if (drawnTerrain[index] === TERRAIN.door || drawnTerrain[index] === TERRAIN.lowwall) out.push(index);
  }
  return out;
}
