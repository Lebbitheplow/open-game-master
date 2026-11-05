// Sight and cover are read along lines from a corner of the attacker's space
// to the corners of one square of the target's (src/lib/battlemap/sight-lines.ts).
// The SRD says what cover means ("completely concealed" is total cover) and
// leaves the grid to the table; these boards pin how this one measures it, and
// that the fog of war, an attack and a creature's cover all agree.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { blockedLines, lineClear } = await import("../src/lib/battlemap/sight-lines.ts");
const { computeFov, coverBetween, coverBetweenSpaces, hasLineOfSight, hasLineOfSightBetween, perceivesToken } = await import(
  "../src/lib/battlemap/los.ts"
);
const { tileIndex } = await import("../src/lib/battlemap/types.ts");

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

function board(rows) {
  return { terrain: rows.join(""), width: rows[0].length, height: rows.length };
}
const sees = (map, a, b) => hasLineOfSight(map.terrain, map.width, a[0], a[1], b[0], b[1]);
const cover = (map, a, b) => coverBetween(map.terrain, map.width, map.height, a[0], a[1], b[0], b[1]);

test("one pillar straight on the line stops the shot; step a row aside and it is only cover", () => {
  for (const column of [1, 5, 9]) {
    const rows = ["...........", "...........", "...........", "..........."];
    rows[1] = `${".".repeat(column)}#${".".repeat(10 - column)}`;
    const map = board(rows);
    assert.equal(sees(map, [0, 1], [10, 1]), false, `straight on, pillar at column ${column}`);
    assert.equal(sees(map, [10, 1], [0, 1]), false, `the other way, pillar at column ${column}`);
  }
  const map = board(["...........", ".....#.....", "...........", "..........."]);
  assert.equal(sees(map, [0, 2], [10, 1]), true, "the shooter a row aside");
  assert.equal(cover(map, [0, 2], [10, 1]), 2);
  assert.equal(sees(map, [0, 3], [10, 3]), true, "two rows aside");
  assert.equal(cover(map, [0, 3], [10, 3]), 0);
});

test("a wall square beside a window does not let a shot along its face through", () => {
  // Row 1's wall at column 4, an opening above it: the old lines' edge case.
  const map = board(["....|....", "....#....", "....#...."]);
  assert.equal(sees(map, [2, 1], [5, 1]), false);
  assert.equal(sees(map, [5, 1], [2, 1]), false);
});

test("a wall across the whole line is total cover", () => {
  const map = board(["....#....", "....#....", "....#...."]);
  assert.equal(sees(map, [0, 1], [8, 1]), false);
  assert.equal(sees(map, [8, 1], [0, 1]), false);
});

test("a gap one square wide lets the shot through, off line as well as on it", () => {
  const map = board(["....#....", ".........", "....#...."]);
  assert.equal(sees(map, [0, 1], [8, 1]), true);
  assert.equal(cover(map, [0, 1], [8, 1]), 0);
  // At a slant, through the same gap.
  assert.equal(sees(map, [0, 2], [8, 0]), true);
});

test("a corridor's own walls neither blind nor cover the creatures in it", () => {
  const map = board(["#########", ".........", "#########"]);
  assert.equal(sees(map, [0, 1], [8, 1]), true);
  assert.equal(cover(map, [0, 1], [8, 1]), 0);
});

test("a diagonal run of wall is a wall, even where its squares only touch at the corners", () => {
  const map = board(["...#", "..#.", ".#..", "#..."]);
  assert.equal(sees(map, [0, 0], [3, 3]), false, "far side of the diagonal");
  assert.equal(sees(map, [1, 1], [2, 2]), false, "next to each other across it");
  const walls = (x, y) => map.terrain[tileIndex(4, x, y)] === "#";
  assert.equal(lineClear({ x: 1, y: 3 }, { x: 3, y: 1 }, walls, true), false, "pinched where they touch");
});

test("a line cannot run along the seam between two wall squares", () => {
  const map = board([".....", "..#..", "..#..", "....."]);
  // Row 2's top edge at y = 2 runs between (2,1) and (2,2).
  const walls = (x, y) => map.terrain[tileIndex(5, x, y)] === "#";
  assert.equal(lineClear({ x: 0, y: 2 }, { x: 5, y: 2 }, walls), false, "for sight");
  assert.equal(lineClear({ x: 0, y: 2 }, { x: 5, y: 2 }, walls, true), false, "for cover");
  // Along the outer face of the pair, one wall on one side: it grazes.
  assert.equal(lineClear({ x: 2, y: 0 }, { x: 2, y: 4 }, walls), false, "for sight");
  assert.equal(lineClear({ x: 2, y: 0 }, { x: 2, y: 4 }, walls, true), true, "for cover");
});

test("sight answers the same whichever creature asks, on every pair of squares", () => {
  const map = board([
    "..#.....#.....",
    "......#.......",
    ".#.......#..#.",
    "....#.........",
    "...........#..",
    ".#....#.......",
    "........#...#.",
    "...#..........",
  ]);
  for (let ay = 0; ay < map.height; ay += 1) {
    for (let ax = 0; ax < map.width; ax += 1) {
      for (let by = 0; by < map.height; by += 1) {
        for (let bx = 0; bx < map.width; bx += 1) {
          assert.equal(sees(map, [ax, ay], [bx, by]), sees(map, [bx, by], [ax, ay]), `(${ax},${ay}) and (${bx},${by})`);
        }
      }
    }
  }
});

test("the fog of war shows exactly the squares an attack can reach", () => {
  const map = board([
    "..#.....#.....",
    "......#.......",
    ".#.......#..#.",
    "....#.........",
    "...........#..",
    ".#....#.......",
    "........#...#.",
    "...#..........",
  ]);
  for (const [x, y] of [[0, 0], [5, 3], [13, 7], [7, 4]]) {
    const fov = computeFov(map.terrain, map.width, map.height, x, y, 20);
    for (let ty = 0; ty < map.height; ty += 1) {
      for (let tx = 0; tx < map.width; tx += 1) {
        assert.equal(fov.has(tileIndex(map.width, tx, ty)), sees(map, [x, y], [tx, ty]), `(${x},${y}) to (${tx},${ty})`);
      }
    }
  }
});

test("the fog of war shows every wall of the room, its corners too, and nothing behind them", () => {
  const map = board([
    "###########",
    "###########",
    "##.......##",
    "##.......##",
    "##.......##",
    "###########",
    "###########",
  ]);
  for (const [x, y] of [[2, 2], [5, 3], [8, 4]]) {
    const fov = computeFov(map.terrain, map.width, map.height, x, y, 20);
    for (let ty = 1; ty <= 5; ty += 1) {
      for (let tx = 1; tx <= 9; tx += 1) {
        assert.equal(fov.has(tileIndex(map.width, tx, ty)), true, `(${tx},${ty}) from (${x},${y})`);
      }
    }
    for (let tx = 0; tx < map.width; tx += 1) {
      assert.equal(fov.has(tileIndex(map.width, tx, 0)), false, `behind the top wall at column ${tx}`);
      assert.equal(fov.has(tileIndex(map.width, tx, 6)), false, `behind the bottom wall at column ${tx}`);
    }
    for (let ty = 0; ty < map.height; ty += 1) {
      assert.equal(fov.has(tileIndex(map.width, 0, ty)), false, `behind the left wall at row ${ty}`);
      assert.equal(fov.has(tileIndex(map.width, 10, ty)), false, `behind the right wall at row ${ty}`);
    }
  }
});

test("a corner seals a target, not the wall that makes it: the nook's floor stays out of sight", () => {
  // From the open side the walls show and the floor behind their sealed corner does not.
  const map = board([".....", "...#.", "..#..", "....."]);
  const fov = computeFov(map.terrain, map.width, map.height, 0, 0, 20);
  assert.equal(fov.has(tileIndex(5, 3, 1)), true, "one wall of the corner");
  assert.equal(fov.has(tileIndex(5, 2, 2)), true, "the other wall of the corner");
  assert.equal(fov.has(tileIndex(5, 3, 2)), false, "the floor tucked behind them");
});

test("a Large creature round a pillar shows by the square that sticks out", () => {
  const rows = Array.from({ length: 12 }, () => ".".repeat(12));
  rows[7] = `${".".repeat(8)}#${".".repeat(3)}`;
  const map = board(rows);
  const ogre = [
    { x: 8, y: 4 },
    { x: 9, y: 4 },
    { x: 8, y: 5 },
    { x: 9, y: 5 },
  ];
  const viewer = { x: 8, y: 10 };
  const visible = computeFov(map.terrain, map.width, map.height, viewer.x, viewer.y, 20);
  assert.equal(visible.has(tileIndex(map.width, 8, 4)), false, "the corner its token is anchored on is hidden");
  assert.equal(perceivesToken(map, viewer, ogre[0], visible), false, "one square behind the pillar");
  assert.equal(perceivesToken(map, viewer, ogre[0], visible, ogre), true, "the whole creature");
  assert.equal(hasLineOfSightBetween(map.terrain, map.width, [viewer], ogre), true);
});

test("the fog of war stops at its radius", () => {
  const map = board([".........."]);
  const fov = computeFov(map.terrain, map.width, map.height, 0, 0, 3);
  assert.equal(fov.has(tileIndex(10, 3, 0)), true);
  assert.equal(fov.has(tileIndex(10, 4, 0)), false);
});

test("an open corner is half cover, a target tucked into a nook three-quarters or better", () => {
  // Wall to the target's left only, seen from a slant: two lines blocked.
  const map = board([".....", "...#.", "..#..", "....."]);
  assert.equal(cover(map, [0, 3], [3, 2]), 2);
  // Walled on the two sides the attacker comes from, with the corner sealed.
  assert.equal(sees(map, [0, 0], [3, 2]), false);
  assert.equal(cover(map, [0, 0], [3, 2]), 5);
});

test("three lines blocked is three-quarters cover and the shot still lands", () => {
  // One pillar on the slant between them, so only one corner of the target shows.
  const map = board([".......", "...#...", ".......", "......."]);
  const count = blockedLines([{ x: 0, y: 2 }], [{ x: 6, y: 0 }], (x, y) => map.terrain[tileIndex(7, x, y)] === "#");
  assert.equal(count, 3);
  assert.equal(sees(map, [0, 2], [6, 0]), true);
  assert.equal(cover(map, [0, 2], [6, 0]), 5);
});

test("cover depends on who is tucked behind what: the one beside the pillar has it, the other does not", () => {
  const map = board(["........", ".....#..", "........"]);
  assert.equal(cover(map, [0, 2], [6, 0]), 2, "target behind the pillar");
  assert.equal(cover(map, [6, 0], [0, 2]), 0, "attacker beside it, target in the open");
});

test("a Large target is seen and covered by the square the attacker sees best", () => {
  // A wall hides the two near-row squares of a two-by-two creature at (6,1);
  // its lower squares stick out below the wall's end.
  const map = board(["........", "....#...", "........", "........"]);
  const ogre = [
    { x: 6, y: 1 },
    { x: 7, y: 1 },
    { x: 6, y: 2 },
    { x: 7, y: 2 },
  ];
  const archer = [{ x: 0, y: 1 }];
  assert.equal(hasLineOfSightBetween(map.terrain, map.width, archer, ogre), true);
  assert.equal(coverBetweenSpaces(map.terrain, map.width, map.height, archer, ogre), 0);
});

test("a Large target behind a long wall is still concealed", () => {
  const map = board(["....#...", "....#...", "....#...", "....#..."]);
  const ogre = [
    { x: 6, y: 1 },
    { x: 7, y: 1 },
    { x: 6, y: 2 },
    { x: 7, y: 2 },
  ];
  assert.equal(hasLineOfSightBetween(map.terrain, map.width, [{ x: 0, y: 1 }], ogre), false);
});

test("a creature stops lines without hiding the target: its own squares and the attacker's do not count", () => {
  const onLine = (x, y) => x === 5 && y === 1;
  assert.equal(blockedLines([{ x: 0, y: 1 }], [{ x: 10, y: 1 }], onLine), 2, "straight behind it");
  const offLine = (x, y) => x === 5 && y === 4;
  assert.equal(blockedLines([{ x: 0, y: 1 }], [{ x: 10, y: 1 }], offLine), 0, "well to one side");
  const onAttacker = (x, y) => x === 0 && y === 1;
  assert.equal(blockedLines([{ x: 0, y: 1 }], [{ x: 10, y: 1 }], onAttacker), 0, "the attacker's own square");
  const onTarget = (x, y) => x === 10 && y === 1;
  assert.equal(blockedLines([{ x: 0, y: 1 }], [{ x: 10, y: 1 }], onTarget), 0, "the target's own square");
});

test("toe to toe nothing is between them, and a target standing in a doorway is seen", () => {
  const map = board(["#+#", "...", "#.#"]);
  assert.equal(cover(map, [1, 1], [1, 0]), 0);
  assert.equal(sees(map, [1, 2], [1, 0]), true);
});

test("the board's outer edge is no wall", () => {
  const map = board(["....", "....", "...."]);
  assert.equal(cover(map, [0, 0], [3, 2]), 0, "a target in the far corner of an empty room");
  assert.equal(cover(map, [3, 2], [0, 0]), 0);
  assert.equal(sees(map, [0, 0], [3, 0]), true);
});

console.log(`test-sight-lines: ${passed} tests passed.`);
