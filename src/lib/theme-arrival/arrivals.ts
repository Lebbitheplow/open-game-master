// How each theme arrives when it replaces another on screen, and one frame of
// an arrival. Loaded with run.ts the first time a theme changes, so no page
// carries it at first load.
import type { AppearanceTheme } from "@/lib/appearance-themes";
import { hexMap, pageTurn, signalGlitch, spellCircle } from "./effects-crafted";
import { burningPage, frostCreep, risingTide, watercolorWash } from "./effects-elements";
import { brushStrokes, inkDrops, spilledInk } from "./effects-ink";
import { clamp, mix, pathData, tracePath, type Arrival, type Ring, type Scene } from "./shapes";

// Each is a way in, with how long it takes at full length.
export const ARRIVALS = {
  spell: { ms: 1400, make: spellCircle },
  wash: { ms: 1500, make: watercolorWash },
  pour: { ms: 1500, make: spilledInk },
  burn: { ms: 1500, make: burningPage },
  page: { ms: 1100, make: pageTurn },
  tide: { ms: 1400, make: risingTide },
  ink: { ms: 1500, make: inkDrops(7) },
  drop: { ms: 1200, make: inkDrops(1) },
  frost: { ms: 1500, make: frostCreep },
  hex: { ms: 1100, make: hexMap },
  glitch: { ms: 800, make: signalGlitch },
  brush: { ms: 1400, make: brushStrokes },
} satisfies Record<string, { ms: number; make: (scene: Scene) => Arrival }>;
export type ArrivalId = keyof typeof ARRIVALS;

// A new theme names its arrival here: the type has a key for every theme in
// the catalog, so the build stops on one that is missing.
export const THEME_ARRIVALS: Record<AppearanceTheme, ArrivalId> = {
  arcane: "spell",
  woodland: "wash",
  gothic: "pour",
  hearth: "burn",
  kingdoms: "page",
  tide: "tide",
  forge: "burn",
  depths: "ink",
  frost: "frost",
  inferno: "burn",
  fey: "wash",
  brassworks: "hex",
  neon: "glitch",
  wasteland: "brush",
  gaslight: "drop",
};

// What the incoming page's snapshot is given for this frame.
export interface FrameStyle {
  clipPath: string;
  maskImage: string;
}
const HIDDEN: FrameStyle = { clipPath: "inset(50%)", maskImage: "none" };
const cut = (rings: Ring[], rule?: "evenodd"): FrameStyle =>
  rings.length ? { clipPath: `path(${rule ? "evenodd," : ""}"${pathData(rings)}")`, maskImage: "none" } : HIDDEN;

// Ink in the new theme's accent, a darker rim outside it, and the part that
// has soaked in rubbed out with a soft edge.
function paintInk(g: CanvasRenderingContext2D, scene: Scene, wet: Ring[], dry: Ring[]) {
  if (!wet.length) return;
  const body = tracePath(wet), { accent } = scene.tones;
  g.save();
  // The rim first: the fill then covers its inner half, and with it the
  // outline of any drop that lies inside another.
  g.lineJoin = "round"; g.strokeStyle = mix(accent, "#000000", 0.64); g.lineWidth = 3.5 * scene.line; g.stroke(body);
  const fill = g.createLinearGradient(0, 0, scene.w * 0.3, scene.h);
  fill.addColorStop(0, accent); fill.addColorStop(1, mix(accent, "#000000", 0.42));
  g.fillStyle = fill; g.fill(body);
  if (dry.length) {
    g.globalCompositeOperation = "destination-out"; g.shadowColor = "#000"; g.shadowBlur = 26 * scene.glow; g.fillStyle = "#000";
    g.fill(tracePath(dry));
  }
  g.restore();
}

// Paints frame `p` (0 to 1) on the cleared canvas and returns how the
// incoming page is cut for it.
export function paintFrame(arrival: Arrival, p: number, g: CanvasRenderingContext2D, scene: Scene): FrameStyle {
  if (arrival.kind === "soft") {
    const spots = arrival.spots(p);
    arrival.paint?.(g, p, spots);
    if (!spots.length) return HIDDEN;
    const tenth = (value: number) => Math.round(value * 10) / 10;
    return { clipPath: "none", maskImage: spots.map((spot) => `radial-gradient(circle at ${tenth(spot.x)}px ${tenth(spot.y)}px,#000 ${tenth(spot.inner)}px,transparent ${tenth(spot.r)}px)`).join(",") };
  }
  if (arrival.kind === "ink") {
    // Three fronts of one shape. The new page shows where the ink has lain
    // for `lead`, under ink that is still whole, so the soft edge of the
    // rubbing-out never shows the old page through it.
    const front = p * (1 + arrival.trail);
    paintInk(g, scene, arrival.shape(Math.min(1, front)), arrival.shape(clamp(front - arrival.trail)));
    return cut(arrival.shape(clamp(front - arrival.lead)));
  }
  const rings = arrival.shape(p);
  arrival.paint?.(g, p, rings);
  return cut(rings, arrival.rule);
}
