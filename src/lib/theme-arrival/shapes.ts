// The geometry every theme arrival shares (docs/appearance-themes.md, "How a
// theme arrives"). An arrival is a shape that grows from nothing until it
// covers the screen: the new theme shows inside it, and a canvas above both
// pages paints what the shape alone cannot (ink, an ember line, foam).
//
// Nothing here touches the document, so scripts/test-theme-arrival.mjs can
// hold every arrival to "starts empty, ends covering the whole screen" on any
// screen size. The paint functions take the canvas they draw on.

// A closed outline as x0, y0, x1, y1, ...
export type Ring = number[];

// The colours an arrival paints with: the new theme's accent in three weights
// and a second hue beside it, and the old page's panel colour (the back of a
// turned page). Six-digit hex, as the theme palettes are written.
export interface Tones {
  accent: string;
  bright: string;
  deep: string;
  second: string;
  paper: string;
}

export interface Scene {
  w: number;
  h: number;
  // Where the reader pressed, or the middle of the screen.
  ox: number;
  oy: number;
  rand: () => number;
  // Stroke widths are written for a desktop and scaled by this on a phone.
  line: number;
  // Canvas shadows ignore the canvas scale, so blur radii carry it themselves.
  glow: number;
  tones: Tones;
}

export interface SoftSpot {
  x: number;
  y: number;
  r: number;
  inner: number;
}

// "ink" lays ink over the old page (the shape), shows the new page under it a
// little later (lead) and thins the ink to nothing later still (trail).
// "cut" shows the new page inside the shape and paints its own edge.
// "soft" has no edge at all: feathered spots that run together.
export type Arrival =
  | { kind: "ink"; lead: number; trail: number; shape(p: number): Ring[] }
  | { kind: "cut"; rule?: "evenodd"; shape(p: number): Ring[]; paint?(g: CanvasRenderingContext2D, p: number, rings: Ring[]): void }
  | { kind: "soft"; spots(p: number): SoftSpot[]; paint?(g: CanvasRenderingContext2D, p: number, spots: SoftSpot[]): void };

export const TAU = Math.PI * 2;
export const clamp = (value: number, low = 0, high = 1) => (value < low ? low : value > high ? high : value);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut3 = (t: number) => 1 - (1 - t) ** 3;
export const easeOut5 = (t: number) => 1 - (1 - t) ** 5;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const outBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

// The same splash every time for one seed, so a test can replay it.
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const farthestCorner = (x: number, y: number, w: number, h: number) =>
  Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y));

// An uneven edge: a few sine waves round a circle (whole-number frequencies,
// so the outline closes), each drifting at its own speed as the phase moves.
// Returns -1 to 1.
export function wobbler(rand: () => number, waves = 5, first = 2): (angle: number, phase: number) => number {
  const parts: Array<[number, number, number, number]> = [];
  let total = 0;
  for (let i = 0; i < waves; i++) {
    const weight = 1 / (i + 1.4);
    total += weight;
    parts.push([first + i + (i > 2 ? Math.floor(rand() * 3) : 0), weight, rand() * TAU, (rand() - 0.5) * 2]);
  }
  return (angle, phase) => {
    let sum = 0;
    for (const [frequency, weight, offset, drift] of parts) sum += weight * Math.sin(frequency * angle + offset + drift * phase);
    return sum / total;
  };
}

export function blob(x: number, y: number, r: number, wobble: (angle: number, phase: number) => number, sway: number, phase: number, points = 72): Ring | null {
  if (r < 0.5) return null;
  const ring: Ring = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * TAU;
    const reach = r * (1 + sway * wobble(angle, phase));
    ring.push(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
  }
  return ring;
}

// Every `step` from one side to the other, and the far side itself: an edge
// that stopped a step short left a sliver of the old page down that side.
export function across(from: number, to: number, step: number, each: (x: number) => void) {
  for (let x = from; x < to; x += step) each(x);
  each(to);
}

const tenth = (value: number) => Math.round(value * 10) / 10;

// The rings as an SVG path, for clip-path: path().
export function pathData(rings: Ring[]): string {
  let data = "";
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) data += `${i ? "L" : "M"}${tenth(ring[i])} ${tenth(ring[i + 1])}`;
    data += "Z";
  }
  return data;
}

export function tracePath(rings: Ring[]): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      if (i) path.lineTo(ring[i], ring[i + 1]);
      else path.moveTo(ring[i], ring[i + 1]);
    }
    path.closePath();
  }
  return path;
}

export function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
const toHex = (parts: number[]) => `#${parts.map((part) => Math.round(clamp(part, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a: string, b: string, t: number) => {
  const from = rgb(a), to = rgb(b);
  return toHex(from.map((part, i) => lerp(part, to[i], t)));
};
export const alpha = (hex: string, opacity: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${opacity})`;
};
export const brightness = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// The same colour turned round the wheel: the second tube of a neon sign.
export function hueShift(hex: string, degrees: number): string {
  const [r, g, b] = rgb(hex).map((part) => part / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2, spread = max - min;
  let hue = 0, saturation = 0;
  if (spread) {
    saturation = spread / (1 - Math.abs(2 * light - 1));
    hue = 60 * (max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4);
  }
  hue = (hue + degrees + 360) % 360;
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation, x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1)), base = light - chroma / 2;
  const [red, green, blue] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return toHex([red, green, blue].map((part) => (part + base) * 255));
}
