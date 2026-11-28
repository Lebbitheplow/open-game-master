// How a theme arrives (src/lib/theme-arrival): when a reader picks a theme,
// or the GM gives the table a new one, the new look spreads over the old in
// that theme's own way: a rune circle for Arcane, frost for Frostbound, a
// turned page for High Kingdoms. An arrival is a shape that grows; the new
// page shows inside it. This holds every arrival to what the screen needs of
// it, on a desk, a phone held either way and a small phone, from a press
// anywhere on the screen:
//
// - every theme in the catalog names an arrival that exists;
// - an arrival starts with nothing of the new page showing and ends with the
//   whole screen covered, so the swap to the live page at the end is not seen
//   (a corner left out would flash the old theme for a frame);
// - half way through it is in between: some new page, not all of it;
// - a frame's clip is a well-formed path, and painting a frame does not throw.
//
// Pure: the shapes are numbers, and the canvas here is a stand-in.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { APPEARANCE_THEME_IDS } = await import("../src/lib/appearance-themes.ts");
const { ARRIVALS, THEME_ARRIVALS, paintFrame } = await import("../src/lib/theme-arrival/arrivals.ts");
const { seeded } = await import("../src/lib/theme-arrival/shapes.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
}

test("every theme names an arrival, and no arrival is left unused", () => {
  for (const id of APPEARANCE_THEME_IDS) assert.ok(ARRIVALS[THEME_ARRIVALS[id]], `${id} names no arrival`);
  assert.deepEqual(Object.keys(THEME_ARRIVALS).sort(), [...APPEARANCE_THEME_IDS].sort());
  const used = new Set(Object.values(THEME_ARRIVALS));
  for (const id of Object.keys(ARRIVALS)) assert.ok(used.has(id), `no theme arrives by "${id}"`);
});

// Whether a point is inside a set of closed outlines, by the rule the
// browser's clip-path uses: nonzero winding, or even-odd.
function inside(rings, x, y, rule) {
  let winding = 0, crossings = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const x1 = ring[i], y1 = ring[i + 1], x2 = ring[(i + 2) % ring.length], y2 = ring[(i + 3) % ring.length];
      if ((y1 <= y) === (y2 <= y)) continue;
      if (x1 + ((y - y1) / (y2 - y1)) * (x2 - x1) <= x) continue;
      crossings += 1;
      winding += y2 > y1 ? 1 : -1;
    }
  }
  return rule === "evenodd" ? crossings % 2 === 1 : winding !== 0;
}

// The points a screen is judged by: a grid, the edges and the four corners.
function samples(w, h) {
  const points = [];
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 12; j++) points.push([0.5 + ((w - 1) * i) / 16, 0.5 + ((h - 1) * j) / 12]);
  return points;
}

// How many sample points show the new page at `p`.
function shown(arrival, p, points) {
  if (arrival.kind === "soft") {
    const spots = arrival.spots(p);
    // A point shows fully new only inside a spot's solid middle.
    return points.filter(([x, y]) => spots.some((spot) => Math.hypot(x - spot.x, y - spot.y) <= spot.inner)).length;
  }
  const rings = arrival.shape(p);
  for (const ring of rings) for (const value of ring) assert.ok(Number.isFinite(value), "an outline has a point that is not a number");
  return points.filter(([x, y]) => inside(rings, x, y, arrival.rule)).length;
}

const SCREENS = [[1920, 1080], [1366, 768], [2560, 1440], [390, 844], [844, 390], [320, 568]];
const PRESSES = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1], [0.86, 0.42], [0.3, 0.92]];
const TONES = { accent: "#b8922a", bright: "#ecd287", deep: "#95761f", second: "#87d2ec", paper: "#211b3a" };
const scene = (w, h, [px, py], seed) => ({ w, h, ox: w * px, oy: h * py, rand: seeded(seed), line: 1, glow: 1, tones: TONES });

for (const [id, { ms, make }] of Object.entries(ARRIVALS)) {
  test(`${id} starts empty, ends covering the screen, and is in between half way`, () => {
    assert.ok(ms >= 250 && ms <= 1600, `${id} lasts ${ms} ms: an arrival is a moment, not a wait`);
    for (const [w, h] of SCREENS) {
      const points = samples(w, h);
      for (const press of PRESSES) {
        for (const seed of [1, 77, 4242]) {
          const where = `${id} on ${w}x${h}, pressed at ${press}, seed ${seed}`;
          const arrival = make(scene(w, h, press, seed));
          assert.equal(shown(arrival, 0, points), 0, `${where}: new page shows before it starts`);
          const half = shown(arrival, 0.5, points);
          assert.ok(half > 0 && half < points.length, `${where}: half way shows ${half} of ${points.length} points`);
          assert.equal(shown(arrival, 1, points), points.length, `${where}: the end leaves part of the screen on the old theme`);
          if (arrival.kind === "ink") assert.ok(arrival.lead > 0 && arrival.lead < arrival.trail, `${where}: the new page must show before the ink thins`);
        }
      }
    }
  });
}

// A canvas that takes every call and gives back more of itself (a gradient,
// a path), so each arrival's painting runs without a browser.
const canvas = new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : canvas), set: () => true, apply: () => canvas, construct: () => canvas });
globalThis.Path2D = canvas;

for (const [id, { make }] of Object.entries(ARRIVALS)) {
  test(`${id} paints every frame and cuts the new page with a well-formed path`, () => {
    for (const [w, h] of [[1366, 768], [390, 844]]) {
      const view = scene(w, h, [0.7, 0.4], 9), arrival = make(view);
      assert.deepEqual(paintFrame(arrival, 0, canvas, view), { clipPath: "inset(50%)", maskImage: "none" }, `${id}: the first frame hides the new page`);
      for (const p of [0.02, 0.2, 0.5, 0.8, 0.97, 1]) {
        const style = paintFrame(arrival, p, canvas, view);
        assert.ok(!/NaN|undefined|Infinity/.test(style.clipPath + style.maskImage), `${id} at ${p}: ${(style.clipPath + style.maskImage).slice(0, 80)}`);
        if (arrival.kind === "soft") {
          if (style.maskImage !== "none") assert.match(style.maskImage, /^radial-gradient\(circle at [-\d.]+px [-\d.]+px,#000 [\d.]+px,transparent [\d.]+px\)/);
        } else if (style.clipPath !== "inset(50%)") {
          assert.match(style.clipPath, /^path\((evenodd,)?"M-?[\d.]+ -?[\d.]+(L-?[\d.]+ -?[\d.]+|ZM-?[\d.]+ -?[\d.]+)*Z"\)$/, `${id} at ${p}`);
        }
      }
      const last = paintFrame(arrival, 1, canvas, view);
      assert.ok(arrival.kind === "soft" ? last.maskImage !== "none" : last.clipPath.startsWith("path("), `${id}: the last frame shows the new page`);
    }
  });
}

console.log(`theme arrival: ${passed} checks passed`);
