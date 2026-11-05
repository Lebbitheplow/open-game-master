import { footprintTiles, type Footprint } from "@/lib/battlemap/footprint";
import {
  CLOSE_OPENING_TILES,
  mulberry32,
  sceneTheme,
  tilesBetweenSides,
  type GeneratedMap,
} from "@/lib/battlemap/generate";
import { skinFor, type MapSkin } from "@/lib/battlemap/skins";
import { TERRAIN, blocksMove, tileIndex, type XY } from "@/lib/battlemap/types";

// A fight that opens inside a building on an outdoor place (issue 743): a
// besieged house, a barricaded inn, a shop with a mob at the door. The
// generator draws a whole exterior or a whole interior, so the party stood on
// a meadow while the story had them behind walls, or scene "tavern" put the
// enemies indoors with them. This draws the building on a finished outdoor
// board, so a board without one comes out of generateBattleMap untouched.
//
// What the terrain makes of it, as los.ts and movement.ts read each tile: a
// wall stops walking and sight and gives cover. A door is an open door, walked
// through and seen through, until someone locks it (scene.ts). A window is a
// low wall: seen and shot through with half cover for whoever stands right
// behind it, closed to walkers, open to fliers and to a jump (srd/jump.ts). A
// shutter that closes would be a second door state for a rule nobody asked for.

export const BUILDING_SIDES = ["north", "east", "south", "west"] as const;
export type BuildingSide = (typeof BUILDING_SIDES)[number];

export const MAX_OPENINGS = 4;
// A door and one window: a way in and something to shoot through.
const DEFAULT_OPENINGS = 2;

export type BuildingPlan = {
  enemySide: BuildingSide;
  // A door plus windows, 1 to MAX_OPENINGS.
  openings?: number | null;
};

export type BuildingFacts = {
  // The walls, door and windows, as drawn.
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  door: XY[];
  windows: XY[];
  // What the GM reads in the tool result, to narrate what the board shows.
  line: string;
};

const OPPOSITE: Record<BuildingSide, BuildingSide> = { north: "south", south: "north", east: "west", west: "east" };

// Ground a building can stand on. Indoors it would be a room in a room, and
// underground its walls would read as more of the cave.
export function holdsBuilding(scene: string | null | undefined): boolean {
  const theme = sceneTheme(scene);
  return theme !== "interior" && theme !== "cave";
}

// The board is drawn in one frame whichever side the enemies are on: `depth`
// runs from the edge behind the building toward the enemies, `along` across.
function frameFor(side: BuildingSide, width: number, height: number) {
  const across = side === "east" || side === "west";
  return {
    alongMax: across ? height : width,
    depthMax: across ? width : height,
    at(along: number, depth: number): XY {
      if (side === "east") return { x: depth, y: along };
      if (side === "west") return { x: width - 1 - depth, y: along };
      if (side === "south") return { x: along, y: depth };
      return { x: along, y: height - 1 - depth };
    },
    // The walls either side of the front and the back, in compass words.
    flanks: (across ? ["north", "south"] : ["west", "east"]) as [BuildingSide, BuildingSide],
  };
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function count(items: number, word: string): string {
  return `${items} ${word}${items === 1 ? "" : "s"}`;
}

export function drawBuilding(
  map: GeneratedMap,
  input: {
    plan: BuildingPlan;
    seed: number;
    pcCount: number;
    // One per enemy, in the order their tokens are placed.
    enemyFootprints: Footprint[];
    enemyDistanceTiles?: number;
  },
): GeneratedMap & { building: BuildingFacts } {
  const { width, height } = map;
  const side = input.plan.enemySide;
  const openings = Math.min(MAX_OPENINGS, Math.max(1, input.plan.openings ?? DEFAULT_OPENINGS));
  const rng = mulberry32(input.seed ^ 0x62d1c7);
  const frame = frameFor(side, width, height);
  const { alongMax, depthMax } = frame;
  const tiles = [...map.terrain];
  const put = (along: number, depth: number, ch: string) => {
    const spot = frame.at(along, depth);
    tiles[tileIndex(width, spot.x, spot.y)] = ch;
  };
  const get = (along: number, depth: number) => {
    const spot = frame.at(along, depth);
    return tiles[tileIndex(width, spot.x, spot.y)];
  };

  // A creature larger than the doorway squeezes through one size smaller
  // (movement.ts), so the door is as wide as that: a Huge one still gets in.
  const largest = Math.max(1, ...input.enemyFootprints);
  const doorWidth = Math.max(1, largest - 1);

  // The yard keeps room for every enemy and the way to the door, and what is
  // left over is the most the house can take: a party that does not fit
  // makes it grow, along the long side first.
  const enemyArea = input.enemyFootprints.reduce((sum, footprint) => sum + footprint * footprint, 0);
  const yardDepth = Math.max(2, Math.ceil((enemyArea * 2) / Math.max(1, alongMax - 2)) + 1);
  const back = 2;
  const deepest = Math.max(2, depthMax - 2 - yardDepth - back - 1);
  const widest = Math.max(doorWidth + 1, alongMax - 6);
  let inDepth = Math.min(4, deepest);
  let inAlong = Math.min(Math.max(4, doorWidth + 1), widest);
  const room = Math.ceil(input.pcCount * 1.5);
  while (inDepth * inAlong < room) {
    if (inAlong < widest && (inAlong <= inDepth + 2 || inDepth >= deepest)) {
      inAlong += 1;
    } else if (inDepth < deepest) {
      inDepth += 1;
    } else {
      break;
    }
  }
  const front = back + inDepth + 1;
  const freeAlong = alongMax - 2 - inAlong;
  const left = 1 + Math.floor((freeAlong - 1) / 2) + (freeAlong > 5 ? Math.floor(rng() * 3) - 1 : 0);
  const right = left + inAlong + 1;

  // Whatever stood on this ground gives way to the house and a path round it.
  // Clumps of wall elsewhere become low walls: a board has one wall material,
  // so a thicket left in the yard would be drawn in the house's timber. They
  // still block a walker where they did and still give cover.
  for (let along = 1; along < alongMax - 1; along += 1) {
    for (let depth = 1; depth < depthMax - 1; depth += 1) {
      const onSite = along >= left - 1 && along <= right + 1 && depth >= back - 1 && depth <= front + 1;
      if (onSite) {
        put(along, depth, TERRAIN.floor);
      } else if (get(along, depth) === TERRAIN.wall) {
        put(along, depth, TERRAIN.lowwall);
      }
    }
  }
  for (let along = left; along <= right; along += 1) {
    put(along, back, TERRAIN.wall);
    put(along, front, TERRAIN.wall);
  }
  for (let depth = back; depth <= front; depth += 1) {
    put(left, depth, TERRAIN.wall);
    put(right, depth, TERRAIN.wall);
  }

  // The door faces the enemies: they come through it, and it is what the party
  // holds. Windows take that wall first and then the flanks, the far one only
  // when a wide door leaves no room. A window never touches a corner, the door
  // or another window, so each one reads as a gap in a wall.
  const doorAt = left + 1 + Math.floor(rng() * Math.max(1, inAlong - doorWidth + 1));
  const door: XY[] = [];
  for (let along = doorAt; along < doorAt + doorWidth; along += 1) {
    put(along, front, TERRAIN.door);
    door.push(frame.at(along, front));
  }
  const flip = rng() < 0.5;
  const flankWalls = flip ? [0, 1] : [1, 0];
  const walls: Array<{ facing: BuildingSide; slots: Array<[number, number]> }> = [];
  const span = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
  walls.push({ facing: side, slots: span(left + 1, right - 1).filter((along) => along < doorAt - 1 || along > doorAt + doorWidth).map((along) => [along, front]) });
  for (const flank of flankWalls) {
    const along = flank === 0 ? left : right;
    walls.push({ facing: frame.flanks[flank], slots: span(back + 1, front - 1).map((depth) => [along, depth]) });
  }
  walls.push({ facing: OPPOSITE[side], slots: span(left + 1, right - 1).map((along) => [along, back]) });
  const windows: XY[] = [];
  const windowFaces: BuildingSide[] = [];
  for (const wall of walls) {
    if (windows.length >= openings - 1 || !wall.slots.length) {
      continue;
    }
    const [along, depth] = wall.slots[Math.floor((wall.slots.length - (rng() < 0.5 ? 1 : 0)) / 2)];
    put(along, depth, TERRAIN.lowwall);
    windows.push(frame.at(along, depth));
    windowFaces.push(wall.facing);
  }

  // The party stands around the middle, or against the front wall when the
  // story has the enemies right outside. Nobody blocks the doorway unless the
  // room is that full.
  const close = input.enemyDistanceTiles !== undefined && input.enemyDistanceTiles <= 3;
  const middleAlong = doorAt + (doorWidth - 1) / 2;
  const middleDepth = close ? front - 1 : back + (inDepth + 1) / 2;
  const inside: Array<{ along: number; depth: number }> = [];
  for (let along = left + 1; along < right; along += 1) {
    for (let depth = back + 1; depth < front; depth += 1) {
      inside.push({ along, depth });
    }
  }
  const inDoorway = (tile: { along: number; depth: number }) => tile.depth === front - 1 && tile.along >= doorAt && tile.along < doorAt + doorWidth;
  const score = (tile: { along: number; depth: number }) =>
    (inDoorway(tile) ? 100 : 0) + Math.max(Math.abs(tile.along - middleAlong), Math.abs(tile.depth - middleDepth));
  const placed = shuffled(inside, rng).sort((a, b) => score(a) - score(b));
  const pcSpawns = placed.slice(0, input.pcCount).map((tile) => frame.at(tile.along, tile.depth));

  // The enemies stand on the named side, past the front wall. A roster with a
  // large creature, or a yard with too little clear ground, gets the yard
  // cleared: a token never stands half in a fence.
  const yard: Array<{ along: number; depth: number }> = [];
  for (let along = 1; along < alongMax - 1; along += 1) {
    for (let depth = front + 1; depth < depthMax - 1; depth += 1) {
      yard.push({ along, depth });
    }
  }
  const clearGround = yard.filter((tile) => get(tile.along, tile.depth) === TERRAIN.floor).length;
  if (largest > 1 || clearGround < enemyArea * 2) {
    for (const tile of yard) {
      if (largest > 1 ? blocksMove(get(tile.along, tile.depth)) : clearGround < enemyArea * 2) {
        put(tile.along, tile.depth, TERRAIN.floor);
      }
    }
  }
  const yardTiles = new Set(yard.map((tile) => {
    const spot = frame.at(tile.along, tile.depth);
    return tileIndex(width, spot.x, spot.y);
  }));
  const doorstep = new Set(door.map((_, index) => {
    const spot = frame.at(doorAt + index, front + 1);
    return tileIndex(width, spot.x, spot.y);
  }));
  const taken = new Set<number>();
  const standable = (anchor: XY, footprint: Footprint, dryOnly: boolean) =>
    footprintTiles(anchor, footprint).every((tile) => {
      const index = tileIndex(width, tile.x, tile.y);
      return (
        tile.x >= 0 && tile.x < width && yardTiles.has(index) && !taken.has(index) && !doorstep.has(index) &&
        (dryOnly ? tiles[index] === TERRAIN.floor : !blocksMove(tiles[index]))
      );
    });
  const opening = Math.max(1, Math.round(input.enemyDistanceTiles ?? CLOSE_OPENING_TILES));
  const rank = (away: number) => (away >= opening ? away : depthMax + alongMax - away);
  const order = input.enemyFootprints.map((_, index) => index).sort((a, b) => input.enemyFootprints[b] - input.enemyFootprints[a]);
  const enemySpots: Array<XY | undefined> = new Array(input.enemyFootprints.length);
  const anchors = shuffled(yard.map((tile) => frame.at(tile.along, tile.depth)), rng);
  for (const index of order) {
    const footprint = input.enemyFootprints[index];
    // Clear ground first; a large creature in a boggy yard stands in the water
    // rather than nowhere.
    const dry = anchors.filter((anchor) => standable(anchor, footprint, true));
    const open = (dry.length ? dry : anchors.filter((anchor) => standable(anchor, footprint, false)))
      .map((anchor) => ({ anchor, away: pcSpawns.length ? tilesBetweenSides(pcSpawns, footprintTiles(anchor, footprint)) : 0 }))
      // The nearest at the distance asked, else the farthest the yard has.
      .sort((a, b) => rank(a.away) - rank(b.away));
    const [pick] = open;
    if (pick) {
      enemySpots[index] = pick.anchor;
      for (const tile of footprintTiles(pick.anchor, footprint)) {
        taken.add(tileIndex(width, tile.x, tile.y));
      }
    }
  }
  // A yard too small for the roster (four Gargantuan creatures on a board 15
  // tiles deep): whoever is left stands beside or behind the house, on ground
  // cleared under them. Left out, the board would put them on single tiles
  // near the first enemy (spotsForTokens), inside the walls or half in a
  // fence, and every later enemy would take the spot meant for the one before.
  const box = { x0: Math.min(frame.at(left, back).x, frame.at(right, front).x), x1: Math.max(frame.at(left, back).x, frame.at(right, front).x), y0: Math.min(frame.at(left, back).y, frame.at(right, front).y), y1: Math.max(frame.at(left, back).y, frame.at(right, front).y) };
  // A board that cannot seat the roster apart at all (eight Gargantuan
  // creatures) lets the last share ground, as a board with no building does,
  // but never inside the house or across its doorstep.
  const besideHouse = (anchor: XY, footprint: Footprint, apart: boolean) =>
    footprintTiles(anchor, footprint).every((tile) => {
      const index = tileIndex(width, tile.x, tile.y);
      const inHouse = tile.x >= box.x0 && tile.x <= box.x1 && tile.y >= box.y0 && tile.y <= box.y1;
      return tile.x >= 1 && tile.y >= 1 && tile.x < width - 1 && tile.y < height - 1 && !inHouse && !(apart && taken.has(index)) && !doorstep.has(index);
    });
  const everywhere: XY[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      everywhere.push({ x, y });
    }
  }
  for (const index of order.filter((entry) => !enemySpots[entry])) {
    const footprint = input.enemyFootprints[index];
    const apart = everywhere.some((anchor) => besideHouse(anchor, footprint, true));
    const [pick] = everywhere
      .filter((anchor) => besideHouse(anchor, footprint, apart))
      .map((anchor) => ({ anchor, away: pcSpawns.length ? tilesBetweenSides(pcSpawns, footprintTiles(anchor, footprint)) : 0 }))
      .sort((a, b) => rank(a.away) - rank(b.away));
    if (pick) {
      enemySpots[index] = pick.anchor;
      for (const tile of footprintTiles(pick.anchor, footprint)) {
        const at = tileIndex(width, tile.x, tile.y);
        taken.add(at);
        if (blocksMove(tiles[at])) {
          tiles[at] = TERRAIN.floor;
        }
      }
    }
  }
  const enemySpawns = enemySpots.flatMap((spot) => (spot ? [spot] : []));

  // Every enemy can walk to the door: a fence or a thicket that cut one off
  // gets a gap, in the yard, so it never touches the house.
  const startAt = frame.at(doorAt, front + 1);
  const reached = new Set<number>([tileIndex(width, startAt.x, startAt.y)]);
  const queue: XY[] = [startAt];
  const flood = () => {
    while (queue.length) {
      const here = queue.shift() as XY;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = here.x + dx;
          const y = here.y + dy;
          const index = tileIndex(width, x, y);
          if (x > 0 && y > 0 && x < width - 1 && y < height - 1 && !reached.has(index) && !blocksMove(tiles[index])) {
            reached.add(index);
            queue.push({ x, y });
          }
        }
      }
    }
  };
  flood();
  for (const tile of yard) {
    const spot = frame.at(tile.along, tile.depth);
    if (!enemySpawns.some((enemy) => enemy.x === spot.x && enemy.y === spot.y) || reached.has(tileIndex(width, spot.x, spot.y))) {
      continue;
    }
    const step = tile.along < doorAt ? 1 : -1;
    for (let along = tile.along; along !== doorAt; along += step) {
      if (blocksMove(get(along, tile.depth))) put(along, tile.depth, TERRAIN.floor);
    }
    for (let depth = tile.depth; depth > front + 1; depth -= 1) {
      if (blocksMove(get(doorAt, depth))) put(doorAt, depth, TERRAIN.floor);
    }
    queue.push(startAt);
    reached.clear();
    reached.add(tileIndex(width, startAt.x, startAt.y));
    flood();
  }

  const corners = [frame.at(left, back), frame.at(right, front)];
  const faces = windowFaces.length
    ? ` ${count(windows.length, "window")} ${windows.length === 1 ? "looks" : "look"} ${windowFaces.join(" and ")}: seen and shot through, half cover right behind one, and only a flier or a jump crosses it.`
    : " It has no windows.";
  const terrain = tiles.join("");
  return {
    ...map,
    terrain,
    lights: map.lights.filter((light) => !blocksMove(terrain[tileIndex(width, light.x, light.y)])),
    pcSpawns,
    enemySpawns,
    building: {
      x0: Math.min(corners[0].x, corners[1].x),
      y0: Math.min(corners[0].y, corners[1].y),
      x1: Math.max(corners[0].x, corners[1].x),
      y1: Math.max(corners[0].y, corners[1].y),
      door,
      windows,
      line: `The party is inside a building with the enemies outside to the ${side}. Its door faces ${side}.${faces}`,
    },
  };
}

// A hedge or a tree clump is no house wall, and those skins paint a wall as
// soft green, so the walls go to timber. The other settings' field skins are
// already built things (a container yard, a gaslit street), and so keep their own.
export function buildingSkin(genre: string | null | undefined, theme: string | null | undefined): MapSkin | null {
  const base = skinFor(genre, theme);
  return base.genre ? null : { id: "", bind: { "#": "wall-wood-log", "+": "door-wood-plain" } };
}
