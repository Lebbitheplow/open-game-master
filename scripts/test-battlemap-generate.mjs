// Procedural battle-map generation: determinism, borders, spawn
// connectivity, and steering by the place's scene kind.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { CLOSE_OPENING_TILES, generateBattleMap, fnv1a, mulberry32, spotsForTokens, tilesBetweenSides } = await import("../src/lib/battlemap/generate.ts");
const { TERRAIN, blocksMove, tileIndex } = await import("../src/lib/battlemap/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const base = { seed: fnv1a("encounter-1"), pcCount: 4, enemyCount: 3 };

test("same seed generates identical maps", () => {
  const a = generateBattleMap({ ...base, scene: "crypt" });
  const b = generateBattleMap({ ...base, scene: "crypt" });
  assert.equal(a.terrain, b.terrain);
  assert.deepEqual(a.pcSpawns, b.pcSpawns);
  assert.deepEqual(a.enemySpawns, b.enemySpawns);
});

test("different seeds differ", () => {
  const a = generateBattleMap({ ...base, scene: "plains" });
  const b = generateBattleMap({ ...base, seed: fnv1a("encounter-2"), scene: "plains" });
  assert.notEqual(a.terrain, b.terrain);
});

test("borders are walls", () => {
  const map = generateBattleMap({ ...base, scene: "forest" });
  for (let x = 0; x < map.width; x += 1) {
    assert.equal(map.terrain[tileIndex(map.width, x, 0)], TERRAIN.wall);
    assert.equal(map.terrain[tileIndex(map.width, x, map.height - 1)], TERRAIN.wall);
  }
  for (let y = 0; y < map.height; y += 1) {
    assert.equal(map.terrain[tileIndex(map.width, 0, y)], TERRAIN.wall);
    assert.equal(map.terrain[tileIndex(map.width, map.width - 1, y)], TERRAIN.wall);
  }
});

test("requested spawn counts are honored", () => {
  for (const scene of ["cave", "swamp", "tavern", "river", null]) {
    const map = generateBattleMap({ ...base, scene });
    assert.equal(map.pcSpawns.length, 4, scene);
    assert.equal(map.enemySpawns.length, 3, scene);
  }
});

test("all spawns are mutually reachable", () => {
  for (const seedText of ["e1", "e2", "e3", "e4", "e5"]) {
    const map = generateBattleMap({ ...base, seed: fnv1a(seedText), scene: "cave" });
    const seen = new Set();
    const queue = [map.pcSpawns[0]];
    seen.add(tileIndex(map.width, map.pcSpawns[0].x, map.pcSpawns[0].y));
    while (queue.length) {
      const { x, y } = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const idx = tileIndex(map.width, nx, ny);
        if (
          nx >= 0 && ny >= 0 && nx < map.width && ny < map.height &&
          !seen.has(idx) && map.terrain[idx] !== TERRAIN.wall
        ) {
          seen.add(idx);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    for (const spot of [...map.pcSpawns, ...map.enemySpawns]) {
      assert.ok(seen.has(tileIndex(map.width, spot.x, spot.y)), `${seedText} spawn unreachable`);
    }
  }
});

test("a fight indoors or from ambush opens thirty feet apart unless the story said how far", () => {
  const nearest = (map) => Math.min(...map.enemySpawns.flatMap((enemy) => map.pcSpawns.map((pc) => Math.max(Math.abs(pc.x - enemy.x), Math.abs(pc.y - enemy.y)))));
  for (let seed = 1; seed <= 6; seed += 1) {
    assert.equal(nearest(generateBattleMap({ ...base, seed, scene: "tavern" })), CLOSE_OPENING_TILES, `tavern, seed ${seed}`);
    assert.equal(nearest(generateBattleMap({ ...base, seed, scene: "plains", ambush: true })), CLOSE_OPENING_TILES, `ambush, seed ${seed}`);
    assert.equal(nearest(generateBattleMap({ ...base, seed, scene: "tavern", enemyDistanceTiles: 2 })), 2, `told, seed ${seed}`);
  }
});

test("the scene kind shapes terrain, light and rough ground", () => {
  const cave = generateBattleMap({ ...base, scene: "cave" });
  assert.equal(cave.theme, "cave");
  assert.equal(cave.ambient, "dark");
  const swamp = generateBattleMap({ ...base, scene: "swamp" });
  assert.ok(swamp.terrain.includes(TERRAIN.water));
  const day = generateBattleMap({ ...base, scene: "plains" });
  assert.equal(day.ambient, "bright");
  assert.equal(day.lights.length, 0);
  const tavern = generateBattleMap({ ...base, scene: "tavern" });
  assert.equal(tavern.theme, "interior");
  assert.equal(tavern.ambient, "dim");
  // A place nobody classified is an open field.
  assert.equal(generateBattleMap({ ...base, scene: null }).theme, "field");
  // Rough ground: a desert is the same field with more of it.
  const rough = (scene) => [...generateBattleMap({ ...base, scene }).terrain].filter((ch) => ch === TERRAIN.difficult).length;
  assert.ok(rough("desert") > rough("plains"));
  // A person building a map on purpose outranks the scene.
  const told = generateBattleMap({ ...base, scene: "cave", theme: "forest", ambient: "bright" });
  assert.equal(told.theme, "forest");
  assert.equal(told.ambient, "bright");
});

test("spawns never sit on walls or stack", () => {
  const map = generateBattleMap({ ...base, scene: "dungeon" });
  const taken = new Set();
  for (const spot of [...map.pcSpawns, ...map.enemySpawns]) {
    const idx = tileIndex(map.width, spot.x, spot.y);
    assert.notEqual(map.terrain[idx], TERRAIN.wall);
    assert.ok(!taken.has(idx));
    taken.add(idx);
  }
});

// Issue 741: past the board's edge the enemies had no spawn at all, and the
// fight opened with no tokens. A fight holds eight enemies at most.
const LONG_SCENES = ["cave", "forest", "swamp", "tavern", "river", "dungeon", "plains", null];

test("a long opening distance still gives every token its own walkable tile", () => {
  for (const feet of [60, 100, 200, 600]) {
    for (const scene of LONG_SCENES) {
      for (let seed = 1; seed <= 40; seed += 1) {
        for (const enemyCount of [1, 3, 8]) {
          const map = generateBattleMap({ seed, scene, pcCount: 4, enemyCount, enemyDistanceTiles: feet / 5 });
          const label = `${feet} ft, ${scene}, seed ${seed}, ${enemyCount} enemies`;
          assert.equal(map.pcSpawns.length, 4, label);
          assert.equal(map.enemySpawns.length, enemyCount, label);
          const all = [...map.pcSpawns, ...map.enemySpawns].map((spot) => tileIndex(map.width, spot.x, spot.y));
          assert.equal(new Set(all).size, all.length, `${label}: tokens stacked`);
          all.forEach((tile) => assert.ok(!blocksMove(map.terrain[tile]), `${label}: on a wall`));
        }
      }
    }
  }
});

test("a distance the board cannot hold opens at the farthest it has, on the ground the seed drew", () => {
  // The fallback that clears the board's middle is for a board with no room,
  // not for a long distance: it changed the ground under the fight, opening a
  // band of walls that the same seed drew at a distance the board holds.
  const walls = (map) => [...map.terrain].filter((tile) => tile === TERRAIN.wall).length;
  let same = 0;
  let boards = 0;
  for (const scene of LONG_SCENES) {
    for (let seed = 1; seed <= 20; seed += 1) {
      const far = generateBattleMap({ seed, scene, pcCount: 4, enemyCount: 3, enemyDistanceTiles: 120 });
      const apart = tilesBetweenSides(far.pcSpawns, far.enemySpawns);
      assert.ok(apart >= CLOSE_OPENING_TILES && apart < 120, `${scene}, seed ${seed}: ${apart} tiles`);
      const held = generateBattleMap({ seed, scene, pcCount: 4, enemyCount: 3, enemyDistanceTiles: 4 });
      boards += 1;
      same += walls(held) === walls(far) ? 1 : 0;
    }
  }
  // A corridor carved to a walled-off enemy can differ; the ground does not.
  assert.ok(same >= boards * 0.8, `${same} of ${boards} boards kept their walls`);
});

test("a distance the board holds is kept exactly", () => {
  for (const scene of ["forest", "plains", "river"]) {
    for (let seed = 1; seed <= 20; seed += 1) {
      const map = generateBattleMap({ seed, scene, pcCount: 4, enemyCount: 3, enemyDistanceTiles: 10 });
      assert.equal(tilesBetweenSides(map.pcSpawns, map.enemySpawns), 10, `${scene}, seed ${seed}`);
    }
  }
});

test("a token with no spawn stands on open ground of its own, never on nothing", () => {
  const map = generateBattleMap({ ...base, scene: "plains" });
  const taken = new Set();
  const party = spotsForTokens(map, map.pcSpawns.slice(0, 1), 4, taken);
  const enemies = spotsForTokens(map, [], 3, taken);
  const all = [...party, ...enemies];
  assert.equal(all.length, 7);
  assert.equal(new Set(all.map((spot) => tileIndex(map.width, spot.x, spot.y))).size, 7);
  all.forEach((spot) => assert.ok(!blocksMove(map.terrain[tileIndex(map.width, spot.x, spot.y)])));
  assert.deepEqual(party[0], map.pcSpawns[0]);
});

test("mulberry32 is deterministic", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 10; i += 1) {
    assert.equal(a(), b());
  }
});

console.log(`test-battlemap-generate: ${passed} tests passed.`);
