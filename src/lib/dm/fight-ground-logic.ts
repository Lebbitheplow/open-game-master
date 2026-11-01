// "The ground changes" in a prepared fight's events (issue 685, the third
// use: "a bridge that falls when the boss does"): the squares of the fight's
// own map that turn to another kind of ground, and the words for it. The
// event itself is one more action of src/lib/dm/fight-event-logic.ts; the
// change runs on the live board through the painter (src/lib/dm/fight-ground.ts).
//
// Pure by design (no "@/" imports, no I/O), as fight-event-logic.ts is, so
// the suites drive it directly.

export const GROUND_LIMITS = {
  // Squares one change names: a bridge, a doorway, a stretch of floor that
  // floods. Enough for a room's worth, and a bound on the save.
  tiles: 100,
  // A square's column or row, as a placement's (encounter-template-logic.ts).
  tileMax: 255,
} as const;

// The kinds of ground a change can leave: the painter's own brushes
// (src/lib/battlemap/paint.ts BRUSHES), named again here because this module
// stays free of "@/" imports. scripts/test-fight-events.mjs holds the two
// lists equal, so a brush added there fails until it is added here.
export const GROUND_KINDS = ["floor", "wall", "water", "difficult", "door", "lowwall", "climb"] as const;
export type GroundKind = (typeof GROUND_KINDS)[number];

export type GroundTile = { x: number; y: number };

export function groundKindOf(value: unknown): GroundKind | null {
  return (GROUND_KINDS as readonly unknown[]).includes(value) ? (value as GroundKind) : null;
}

// The squares a change names, each once, in reading order (row by row), cut
// to the limit. With the board's size, a square off the board goes, and so
// does one on its edge: the painter never opens the border (paint.ts), so a
// change there would do nothing the table could see.
export function fitGroundTiles(raw: unknown, board: { width: number; height: number } | null = null): GroundTile[] {
  const seen = new Map<string, GroundTile>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const tile = (entry ?? {}) as { x?: unknown; y?: unknown };
    const x = Math.round(Number(tile.x));
    const y = Math.round(Number(tile.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > GROUND_LIMITS.tileMax || y > GROUND_LIMITS.tileMax) {
      continue;
    }
    if (board && !insideBorder(x, y, board)) {
      continue;
    }
    seen.set(`${x},${y}`, { x, y });
  }
  return [...seen.values()].sort((a, b) => a.y - b.y || a.x - b.x).slice(0, GROUND_LIMITS.tiles);
}

// A square the painter may change: on the board and off its edge.
export function insideBorder(x: number, y: number, board: { width: number; height: number }): boolean {
  return x >= 1 && y >= 1 && x < board.width - 1 && y < board.height - 1;
}

// The board an armed event's squares were fitted to. A map put down in its
// place during the fight (the studio, the library's Deploy) changes the size
// or the seed, and the plan's squares no longer name its ground.
export type BoardStamp = { width: number; height: number; seed: number };

export function readBoardStamp(raw: unknown): BoardStamp | null {
  const source = (raw ?? {}) as { width?: unknown; height?: unknown; seed?: unknown };
  const [width, height, seed] = [source.width, source.height, source.seed].map((value) => Math.round(Number(value)));
  return Number.isFinite(width) && Number.isFinite(height) && Number.isFinite(seed) && width > 0 && height > 0
    ? { width, height, seed }
    : null;
}

export function sameBoard(stamp: BoardStamp | null, board: BoardStamp): boolean {
  return Boolean(stamp && stamp.width === board.width && stamp.height === board.height && stamp.seed === board.seed);
}

// ---- words ----

// How the GM's plan note names each kind of ground, and the line the table
// reads when squares turn to it: what the board now shows, in words a player
// knows without the painter's palette. The GM's own words (the bridge, the
// portcullis) are a "say" beside it.
const GROUND_NOUNS: Record<GroundKind, string> = {
  floor: "clear ground",
  wall: "wall",
  water: "water",
  difficult: "rough ground",
  door: "a door",
  lowwall: "a low wall or ledge",
  climb: "ground to climb",
};

const GROUND_LINES: Record<GroundKind, string> = {
  floor: "The way opens.",
  wall: "The way is blocked.",
  water: "Water floods the ground.",
  difficult: "The ground turns rough underfoot.",
  door: "A doorway opens.",
  lowwall: "The ground gives way.",
  climb: "The ground heaves up, steep enough to climb.",
};

const listWords = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// "6 squares of the map become a low wall or ledge", for the GM's plan note.
export function groundWords(tileCount: number, terrain: GroundKind): string {
  const one = tileCount === 1;
  return `${tileCount} square${one ? "" : "s"} of the map become${one ? "s" : ""} ${GROUND_NOUNS[terrain]}`;
}

// The table's line. `moved`: who was standing where the ground no longer
// holds them, as the table may name them. "Pushed", not "jumps": the ground
// moved them, whether or not they could have moved themselves.
export function groundLine(terrain: GroundKind, moved: string[]): string {
  const clear = moved.length ? ` ${listWords(moved)} ${moved.length === 1 ? "is" : "are"} pushed clear.` : "";
  return `${GROUND_LINES[terrain]}${clear}`;
}
