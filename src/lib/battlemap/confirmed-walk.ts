import type { XY } from "@/lib/battlemap/types";

const WALK_TTL_MS = 10_000;
const MAX_WALKS = 512;
const MAX_STEPS = 128;

declare global {
  var __odmConfirmedWalks: Map<string, { until: number; path: XY[] }> | undefined;
}

export function forgetWalk(tokenId: string): void {
  globalThis.__odmConfirmedWalks?.delete(tokenId);
}

// A short-lived animation trail for the current token position, shared by
// the routes that move figures and the viewer projection that reads them.
export function rememberWalk(tokenId: string, from: XY | null, to: XY, path?: readonly XY[]): void {
  forgetWalk(tokenId);
  if (!from || !path || path.length < 2 || path.length > MAX_STEPS) return;
  const start = path[0], end = path[path.length - 1];
  if (start.x !== from.x || start.y !== from.y || end.x !== to.x || end.y !== to.y
    || (from.x === to.x && from.y === to.y)) return;
  const walks = globalThis.__odmConfirmedWalks ??= new Map();
  walks.set(tokenId, { until: Date.now() + WALK_TTL_MS, path: path.map(({ x, y }) => ({ x, y })) });
  if (walks.size > MAX_WALKS) walks.delete(walks.keys().next().value!);
}

export function visibleWalk(token: XY & { id: string }, width: number, height: number, visible: ReadonlySet<number>, fullVision: boolean): XY[] | undefined {
  const walk = globalThis.__odmConfirmedWalks?.get(token.id);
  if (!walk || walk.until <= Date.now()) return;
  const end = walk.path[walk.path.length - 1];
  if (end.x !== token.x || end.y !== token.y) return;
  if (walk.path.every(({ x, y }) => Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && x < width && y >= 0 && y < height
    && (fullVision || visible.has(y * width + x)))) return walk.path;
}
