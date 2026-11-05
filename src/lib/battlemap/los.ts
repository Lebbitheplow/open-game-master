import {
  blocksSight,
  carriedDimRadius,
  chebyshev,
  inBounds,
  tileAt,
  tileIndex,
  type AmbientLight,
  type BattleToken,
  type MapLight,
  TERRAIN,
} from "@/lib/battlemap/types";
import { ambientAt, magicalDarknessAt, type LightZone } from "@/lib/battlemap/scene";
import { anyLineClear, blockedLines, wallInView, type Blocks, type XY } from "@/lib/battlemap/sight-lines";

// What a tile can see, by the same corner lines an attack is measured along
// (src/lib/battlemap/sight-lines.ts): fog of war drawn by another method let a
// player see a target they were then told they could not shoot, or shoot one
// the fog still hid. A blocking tile is itself visible so players can see the
// wall that stops their sight.
export function computeFov(
  terrain: string,
  width: number,
  height: number,
  originX: number,
  originY: number,
  radius: number,
): Set<number> {
  const visible = new Set<number>();
  if (!inBounds(width, height, originX, originY)) {
    return visible;
  }
  const blocks = wallsOn(terrain, width);
  const origin = [{ x: originX, y: originY }];
  const top = Math.max(0, originY - radius);
  const bottom = Math.min(height - 1, originY + radius);
  const left = Math.max(0, originX - radius);
  const right = Math.min(width - 1, originX + radius);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const square = { x, y };
      if (blocks(x, y) ? wallInView(origin[0], square, blocks) : anyLineClear(origin, [square], blocks)) {
        visible.add(tileIndex(width, x, y));
      }
    }
  }
  return visible;
}

// The squares a line stops at, for sight.
function wallsOn(terrain: string, width: number): Blocks {
  return (x, y) => x >= 0 && x < width && y >= 0 && blocksSight(terrain[y * width + x] ?? TERRAIN.floor);
}

// Line of sight between two spaces, a list of squares each: a Large creature
// is seen if any of its four squares is. No line means total cover (SRD 5.1,
// Cover), so this is what refuses a shot, and it answers the same whichever
// creature asks.
export function hasLineOfSightBetween(terrain: string, width: number, from: XY[], to: XY[]): boolean {
  return anyLineClear(from, to, wallsOn(terrain, width));
}

// The same between two single squares.
export function hasLineOfSight(
  terrain: string,
  width: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  return hasLineOfSightBetween(terrain, width, [{ x: fromX, y: fromY }], [{ x: toX, y: toY }]);
}

export type Viewer = {
  x: number;
  y: number;
  // Darkvision range in tiles (feet / 5); 0 = none.
  darkvisionTiles: number;
  // The other senses (src/lib/srd/senses.ts), in tiles; absent means none.
  blindsightTiles?: number;
  tremorsenseTiles?: number;
  truesightTiles?: number;
  devilsSightTiles?: number;
};

export type MapForVision = {
  terrain: string;
  width: number;
  height: number;
  ambient: AmbientLight;
  // Patches where the light is not the map's own: a lit shrine in a dark
  // crypt, a dark alcove in a bright hall (src/lib/battlemap/scene.ts).
  zones?: LightZone[];
  // Weather: beyond this many tiles from the viewer the light reads as dim
  // at best (heavy rain, fog). Infinity or absent when the air is clear
  // (src/lib/srd/weather.ts).
  obscureBeyond?: number;
};

// How far a viewer can perceive unlit tiles under dim ambient light: dim
// light is workable at short range even without darkvision.
const DIM_SELF_RADIUS = 6;

// Every tile lit by static lights and carried token lights, out to where
// each one's dim light ends (a lamp's 45 feet, a torch's 40). A light only
// lights tiles it can itself "see" (no glow through walls); light FOVs are
// computed per call and shared across viewers by the caller when batching.
export function litTiles(map: MapForVision, tokens: BattleToken[], lights: MapLight[]): Set<number> {
  const lit = new Set<number>();
  const sources: MapLight[] = [
    ...lights,
    ...tokens
      .filter((token) => token.lightRadius > 0)
      .map((token) => ({
        x: token.x,
        y: token.y,
        brightRadius: token.lightRadius,
        dimRadius: carriedDimRadius(token),
      })),
  ];
  for (const source of sources) {
    const glow = computeFov(map.terrain, map.width, map.height, source.x, source.y, source.dimRadius);
    for (const idx of glow) {
      lit.add(idx);
    }
  }
  return lit;
}

// Tiles this viewer can currently see: line of sight intersected with what
// the ambient light level allows them to perceive.
export function visibleTiles(
  map: MapForVision,
  viewer: Viewer,
  tokens: BattleToken[],
  lights: MapLight[],
  precomputedLit?: Set<number>,
): Set<number> {
  const maxRadius = Math.max(map.width, map.height);
  const los = computeFov(map.terrain, map.width, map.height, viewer.x, viewer.y, maxRadius);
  const zones = map.zones ?? [];
  const obscureBeyond = map.obscureBeyond ?? Infinity;
  if (map.ambient === "bright" && !zones.length && !Number.isFinite(obscureBeyond)) {
    return los;
  }
  const lit = precomputedLit ?? litTiles(map, tokens, lights);
  const visible = new Set<number>();
  for (const idx of los) {
    const x = idx % map.width;
    const y = Math.floor(idx / map.width);
    // The light on THIS tile decides whether it can be seen, so a dark
    // alcove stays dark inside a bright hall and a lit shrine shows in a
    // dark crypt.
    const distance = chebyshev(viewer.x, viewer.y, x, y);
    // Blindsight needs no light at all, only a clear line.
    if (distance <= (viewer.blindsightTiles ?? 0)) {
      visible.add(idx);
      continue;
    }
    // Magical darkness: no light and no darkvision reach into it; only
    // truesight and Devil's Sight do (src/lib/battlemap/scene.ts).
    if (zones.length && magicalDarknessAt(zones, x, y)) {
      if (distance <= (viewer.truesightTiles ?? 0) || distance <= (viewer.devilsSightTiles ?? 0)) {
        visible.add(idx);
      }
      continue;
    }
    const local = zones.length ? ambientAt(zones, x, y, map.ambient) : map.ambient;
    // Rain and fog: past the obscurement radius a bright tile reads as dim.
    const ambient = distance > obscureBeyond && local === "bright" ? "dim" : local;
    if (ambient === "bright") {
      visible.add(idx);
      continue;
    }
    const selfRadius = ambient === "dim" ? DIM_SELF_RADIUS : 0;
    if (
      lit.has(idx) ||
      distance <= viewer.darkvisionTiles ||
      distance <= (viewer.devilsSightTiles ?? 0) ||
      distance <= (viewer.truesightTiles ?? 0) ||
      distance <= selfRadius
    ) {
      visible.add(idx);
    }
  }
  return visible;
}

// Whether a viewer perceives a creature: the tile is in view, or a sense
// reaches it. Tremorsense feels anything on the ground within reach, walls
// or not, and misses whatever flies; blindsight is already in `visible`.
export function perceivesToken(
  map: MapForVision,
  viewer: Viewer,
  target: { x: number; y: number; movement?: "walk" | "fly" | "burrow" },
  visible: Set<number>,
  // The squares it stands on: an ogre round a corner shows by the square that
  // sticks out, as it can be shot by that square.
  space: XY[] = [target],
): boolean {
  if (space.some((square) => inBounds(map.width, map.height, square.x, square.y) && visible.has(tileIndex(map.width, square.x, square.y)))) {
    return true;
  }
  const distance = chebyshev(viewer.x, viewer.y, target.x, target.y);
  if (distance <= (viewer.tremorsenseTiles ?? 0) && target.movement !== "fly") {
    return true;
  }
  return false;
}

// "Darkvision 60 ft" style feature/trait text to a tile radius. A bare
// "Darkvision" with no range defaults to the common 60 ft.
export function darkvisionTilesFromText(texts: string[]): number {
  let bare = false;
  for (const text of texts) {
    if (!/darkvision/i.test(text)) {
      continue;
    }
    const match = /darkvision\s*\(?\s*(\d+)/i.exec(text);
    if (match) {
      return Math.floor(Number(match[1]) / 5);
    }
    bare = true;
  }
  return bare ? 12 : 0;
}

// Cover from terrain between two spaces, as the bonus the SRD grants the
// target: 0 for none, +2 for half cover, +5 for three-quarters, counted along
// the corner lines (src/lib/battlemap/sight-lines.ts). Cover depends on who
// is tucked behind what, so unlike sight it can differ between two creatures.
// Every line blocked also answers 5; whether that target has total cover is
// hasLineOfSightBetween's to say, and that is what refuses the attack.
export function coverBetweenSpaces(
  terrain: string,
  width: number,
  height: number,
  from: XY[],
  to: XY[],
): 0 | 2 | 5 {
  let near: { from: XY; to: XY; apart: number } | null = null;
  for (const a of from) {
    for (const b of to) {
      const apart = chebyshev(a.x, a.y, b.x, b.y);
      if (!near || apart < near.apart) {
        near = { from: a, to: b, apart };
      }
    }
  }
  if (!near || near.apart <= 1) {
    // Toe to toe: nothing is between them.
    return 0;
  }
  const blocked = blockedLines(from, to, wallsOn(terrain, width));
  if (blocked >= 3) {
    return 5;
  }
  if (blocked > 0) {
    return 2;
  }
  // A low wall stops no line, since everything sees over it. A fence or ledge
  // directly in front of the target is half cover, never more.
  const towardX = Math.sign(near.from.x - near.to.x);
  const towardY = Math.sign(near.from.y - near.to.y);
  for (const [dx, dy] of [
    [towardX, 0],
    [0, towardY],
  ]) {
    if (dx === 0 && dy === 0) {
      continue;
    }
    const x = near.to.x + dx;
    const y = near.to.y + dy;
    if (inBounds(width, height, x, y) && tileAt(terrain, width, x, y) === TERRAIN.lowwall) {
      return 2;
    }
  }
  return 0;
}

// The same between two single squares.
export function coverBetween(
  terrain: string,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): 0 | 2 | 5 {
  return coverBetweenSpaces(terrain, width, height, [{ x: fromX, y: fromY }], [{ x: toX, y: toY }]);
}
