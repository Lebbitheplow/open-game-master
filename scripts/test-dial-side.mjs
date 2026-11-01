// A figure's dial opens away from a frame edge it would cross: left near the
// right edge (where the camera buttons sit), right near the left, and up or
// down where both sides have room (src/lib/battlemap/dial-side.ts).
import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);
const { dialSide, DIAL_REACH, DIAL_CENTRE } = await import("../src/lib/battlemap/dial-side.ts");

const frame = { left: 0, top: 0, right: 400, bottom: 300 };
assert.equal(dialSide({ x: 200, y: 200 }, frame), "up", "room all round: up, as before");
assert.equal(dialSide({ x: 200, y: 60 }, frame), "down", "near the top: down");
assert.equal(dialSide({ x: 360, y: 150 }, frame), "left", "near the right edge, under the camera buttons: left");
assert.equal(dialSide({ x: 40, y: 150 }, frame), "right", "near the left edge: right");
assert.equal(dialSide({ x: 360, y: 40 }, frame), "left", "a corner: away from the side edge");
// A frame narrower than the dial: the side with more room.
assert.equal(dialSide({ x: 90, y: 150 }, { left: 0, top: 0, right: 200, bottom: 300 }), "right");
assert.equal(dialSide({ x: 110, y: 150 }, { left: 0, top: 0, right: 200, bottom: 300 }), "left");
// Exactly the reach is room enough.
assert.equal(dialSide({ x: DIAL_REACH, y: 200 }, { left: 0, top: 0, right: DIAL_REACH * 2, bottom: 300 }), "up");
// Zoomed in, the dial reaches further on screen, so it turns sooner.
assert.equal(dialSide({ x: 200, y: 200 }, frame, 1), "up");
assert.equal(dialSide({ x: 200, y: 200 }, { left: 0, top: 0, right: 400, bottom: 300 }, 2), "left", "at 2x the reach is 240px: neither side has it");
assert.equal(dialSide({ x: 300, y: 150 }, frame, 0.5), "up", "zoomed out, 100px from the edge is room enough");
assert.equal(DIAL_CENTRE.left, Math.PI);
assert.equal(DIAL_CENTRE.up, -Math.PI / 2);
console.log("ok: a figure's dial opens away from a frame edge it would cross");
