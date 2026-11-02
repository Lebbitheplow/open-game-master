// A figure's dial opens away from a frame edge it would cross: up where there
// is room above and to both sides, down where there is room below, else left
// or right; and zoomed in on a large figure it widens to clear it, as far as
// the frame has room (src/lib/battlemap/dial-side.ts).
import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);
const { fitDial, dialRadius, DIAL_RADIUS, DIAL_CENTRE } = await import("../src/lib/battlemap/dial-side.ts");

const frame = { left: 0, top: 0, right: 400, bottom: 300 };
const side = (x, y, box = frame, half = 0) => fitDial({ x, y }, box, half).side;

assert.equal(side(200, 200), "up", "room all round: up, as before");
assert.equal(side(200, 60), "down", "near the top: down");
assert.equal(side(360, 150), "left", "near the right edge, under the camera buttons: left");
assert.equal(side(40, 150), "right", "near the left edge: right");
// A frame narrower than the dial: the ordinary arc on the roomier side.
const narrow = { left: 0, top: 0, right: 200, bottom: 300 };
assert.deepEqual(fitDial({ x: 90, y: 150 }, narrow), { side: "right", radius: DIAL_RADIUS, fits: false, close: 72 });
assert.equal(side(110, 150, narrow), "left");
// Exactly the reach is room enough; a pixel short is not.
assert.equal(side(150, 200, { left: 0, top: 0, right: 300, bottom: 300 }), "up");
assert.equal(side(151, 200, { left: 0, top: 0, right: 300, bottom: 300 }), "left");

// Zoomed in on a large figure: the arc widens to clear it.
assert.equal(dialRadius(16), DIAL_RADIUS, "an ordinary figure: the ordinary arc");
assert.equal(dialRadius(70), 98, "a figure 140px across: its half and a gap for its badges");
const big = { left: 0, top: 0, right: 800, bottom: 600 };
assert.deepEqual(fitDial({ x: 400, y: 300 }, big, 70), { side: "up", radius: 98, fits: true, close: 114 }, "room for the wide arc");
// A short frame: as wide as fits, then no wider.
const short = { left: 0, top: 0, right: 800, bottom: 200 };
const squeezed = fitDial({ x: 400, y: 120 }, short, 70);
assert.equal(squeezed.side, "up");
assert.equal(squeezed.radius, 80, "120px above the figure leaves room for an 80px arc and its names");
assert.ok(squeezed.fits);
assert.equal(squeezed.close, 64, "Close, 96px below at that radius, is drawn in to stay whole above the frame's bottom 80px down");

// Close, across the figure from the arc, stays whole inside the frame: cut
// off, it was out of reach, and focusing it scrolled the frame.
assert.equal(fitDial({ x: 200, y: 200 }, frame).close, 72, "room below: 16px past the radius");
const low = fitDial({ x: 200, y: 250 }, frame);
assert.equal(low.side, "up");
assert.equal(low.close, 34, "50px above the frame's bottom: drawn in so its 28px round ends 2px inside");
assert.equal(fitDial({ x: 360, y: 150 }, frame).close, 24, "an arc opening left keeps Close inside the right edge, 40px away");

assert.equal(DIAL_CENTRE.left, Math.PI);
assert.equal(DIAL_CENTRE.up, -Math.PI / 2);
console.log("ok: a figure's dial opens away from a frame edge it would cross, and widens to clear a large figure as far as it fits");
