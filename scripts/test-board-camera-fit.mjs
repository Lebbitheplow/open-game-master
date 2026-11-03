// The board's resting view (src/lib/battlemap/camera-fit.ts, issue 87): a
// board in a frame as tall as itself rests as it always did, and a board in
// a fixed window is shrunk until all of it shows.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { fitCamera, minZoomFor, clampZoomTo, MIN_ZOOM, MAX_ZOOM } = await import("../src/lib/battlemap/camera-fit.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

test("a frame sized by its own board rests on the plain view", () => {
  // 20 by 15 tiles in a 400 px panel: the frame is 300 px tall.
  assert.deepEqual(fitCamera({ width: 400, height: 300 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0 });
  // Rounding either way is still the plain view.
  assert.deepEqual(fitCamera({ width: 401, height: 300 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0 });
});

test("a frame taller than its board rests on the plain view, the board in the middle of it", () => {
  // The enlarged tabletop: 400 px wide, 900 tall, a 300 px board centred.
  assert.deepEqual(fitCamera({ width: 400, height: 900 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 300 });
  // A pixel of rounding slack is still the plain view, not half a pixel down.
  assert.deepEqual(fitCamera({ width: 400, height: 301 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0.5 });
});


test("a short window shrinks the board to show all of it, centred", () => {
  // The fight stage on a 1080p screen: 1188 by 562 for a 4:3 board.
  const fit = fitCamera({ width: 1188, height: 562 }, { width: 20, height: 15 });
  assert.ok(Math.abs(fit.zoom - 562 / 891) < 1e-9);
  assert.equal(fit.y, 0);
  // The board's width at that zoom, centred in the frame.
  assert.ok(Math.abs(fit.x - (1188 - 1188 * fit.zoom) / 2) < 1e-9);
  // And it does fill the height exactly.
  assert.ok(Math.abs(891 * fit.zoom - 562) < 1e-9);
});

test("a frame with no size yet is the plain view, not a division by zero", () => {
  assert.deepEqual(fitCamera({ width: 0, height: 0 }, { width: 20, height: 15 }), { zoom: 1, x: 0, y: 0 });
  assert.deepEqual(fitCamera({ width: 400, height: 300 }, { width: 0, height: 0 }), { zoom: 1, x: 0, y: 0 });
});

test("the view may zoom out as far as the fit, and no further than before otherwise", () => {
  assert.equal(minZoomFor({ zoom: 1, x: 0, y: 0 }), MIN_ZOOM);
  assert.equal(minZoomFor({ zoom: 0.3, x: 10, y: 0 }), 0.3);
  assert.equal(clampZoomTo(0.1, 0.3), 0.3);
  assert.equal(clampZoomTo(0.1, MIN_ZOOM), MIN_ZOOM);
  assert.equal(clampZoomTo(9, MIN_ZOOM), MAX_ZOOM);
  assert.equal(clampZoomTo(1.5, MIN_ZOOM), 1.5);
});

// The docked initiative strip stands in the frame's top left corner (PR 770
// moved it off the board below the docked layout only). A board that fills
// the frame put its first tiles under it.
const covers = (fit, frameWidth, board, clear) => {
  const tile = (frameWidth * fit.zoom) / board.width;
  // Tile 0,0's box in frame pixels against the corner.
  return fit.x < clear.width && fit.y < clear.height && fit.x + tile > 0 && fit.y + tile > 0;
};

test("a board that fills its frame rests clear of the corner's strip", () => {
  const strip = { width: 148, height: 90 };
  // A square board in a square frame: the plain fit starts at 0,0.
  const plain = fitCamera({ width: 400, height: 400 }, { width: 20, height: 20 });
  assert.ok(covers(plain, 400, { width: 20 }, strip), "the plain fit has tile 0,0 under the strip");
  const fit = fitCamera({ width: 400, height: 400 }, { width: 20, height: 20 }, strip);
  assert.ok(!covers(fit, 400, { width: 20 }, strip), `tile 0,0 is clear of the strip (${JSON.stringify(fit)})`);
  // Whole inside the frame.
  assert.ok(fit.x >= 0 && fit.y >= 0 && fit.x + 400 * fit.zoom <= 400 + 1e-9 && fit.y + 400 * fit.zoom <= 400 + 1e-9);
  // Below it, the larger of the two: 310 of 400 px tall against 252 wide.
  assert.ok(Math.abs(fit.zoom - 310 / 400) < 1e-9 && fit.y === 90);
});

test("a board in a wide frame rests beside the strip when that keeps it larger", () => {
  const strip = { width: 148, height: 90 };
  // 20 by 15 tiles in a 1188 by 562 frame: the fit is 750 wide, centred, so
  // its margin (219 px) already clears the strip and nothing moves.
  assert.deepEqual(fitCamera({ width: 1188, height: 562 }, { width: 20, height: 15 }, strip), fitCamera({ width: 1188, height: 562 }, { width: 20, height: 15 }));
  // A board as wide as that frame's height allows, with no margin left: it
  // moves beside the strip rather than shrinking under it.
  const frame = { width: 800, height: 600 };
  const fit = fitCamera(frame, { width: 20, height: 15 }, strip);
  assert.ok(!covers(fit, 800, { width: 20 }, strip), `tile 0,0 is clear (${JSON.stringify(fit)})`);
  assert.ok(fit.x + 800 * fit.zoom <= 800 + 1e-9 && fit.y + 600 * fit.zoom <= 600 + 1e-9, "whole inside the frame");
});

test("no strip, or one the margin already clears, leaves the fit as it was", () => {
  assert.deepEqual(fitCamera({ width: 400, height: 900 }, { width: 20, height: 15 }, null), { zoom: 1, x: 0, y: 300 });
  assert.deepEqual(fitCamera({ width: 400, height: 900 }, { width: 20, height: 15 }, { width: 148, height: 90 }), { zoom: 1, x: 0, y: 300 });
  assert.deepEqual(fitCamera({ width: 400, height: 300 }, { width: 20, height: 15 }, { width: 0, height: 0 }), { zoom: 1, x: 0, y: 0 });
});

console.log(`\n${passed} board fit checks passed`);
