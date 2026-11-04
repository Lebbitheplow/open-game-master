// Issue 743: a fight the story set inside a building on an outdoor place was
// drawn on open ground, with no way to say the party is inside and the enemies
// outside. start_encounter's building draws one on the finished board. Every
// side and number of openings, across seeds, scenes, parties and rosters: walls
// that seal the room but for its openings, one door, the windows asked for,
// the party inside, the enemies on the named side and able to walk in. A board
// with no building comes out as it did before, byte for byte.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-fight-in-building");

const { BUILDING_SIDES, MAX_OPENINGS, buildingSkin, drawBuilding, holdsBuilding } = await import("../src/lib/battlemap/building.ts");
const { CLOSE_OPENING_TILES, fnv1a, generateBattleMap, sceneTheme, tilesBetweenSides } = await import("../src/lib/battlemap/generate.ts");
const { TERRAIN, blocksMove, blocksMoveFor, blocksSight, moveCost, tileIndex } = await import("../src/lib/battlemap/types.ts");
const { footprintTiles } = await import("../src/lib/battlemap/footprint.ts");
const { findPath } = await import("../src/lib/battlemap/movement.ts");
const { coverBetween, hasLineOfSight } = await import("../src/lib/battlemap/los.ts");
const { sceneIds } = await import("../src/lib/ambience/catalog.ts");
const { getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { endEncounter, getActiveEncounter } = await import("../src/lib/db/encounters.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { startEncounterTool } = await import("../src/lib/dm/encounter-tool-defs.ts");
const { compactTool } = await import("../src/lib/dm/tool-profiles.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const { getCurrentLocation, setLocationLinks, upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { normalizeArgs } = await import("../src/lib/dm/invoke.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");

const SEEDS = [1, 7, 42, 99, 1234, 2026, 90210, 3141592];
const SCENES = [null, ...sceneIds().filter((scene) => holdsBuilding(scene))];
// The app seats eight players, and companions come on top of that; a fight takes
// eight enemies.
const TABLES = [[1, 8], [4, 3], [8, 8], [16, 8]];

const draw = (seed, scene, enemySide, openings, party, footprints, distance, size = {}) => {
  const base = generateBattleMap({ seed, scene, pcCount: party, enemyCount: footprints.length, enemyDistanceTiles: distance, ...size });
  return drawBuilding(base, { plan: { enemySide, openings }, seed, pcCount: party, enemyFootprints: footprints, enemyDistanceTiles: distance });
};
const inBox = ({ x0, y0, x1, y1 }, { x, y }) => x > x0 && x < x1 && y > y0 && y < y1;
const onRing = ({ x0, y0, x1, y1 }, { x, y }) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x === x0 || x === x1 || y === y0 || y === y1);
const pastFront = ({ x0, y0, x1, y1 }, side, { x, y }) =>
  side === "east" ? x > x1 : side === "west" ? x < x0 : side === "south" ? y > y1 : y < y0;
const board = (map) => Array.from({ length: map.height }, (_, y) => map.terrain.slice(y * map.width, (y + 1) * map.width)).join("\n");

function assertBuilding(map, side, openings, party, footprints, label) {
  const { building: house, width, height, terrain } = map;
  const at = (spot) => terrain[tileIndex(width, spot.x, spot.y)];
  const context = `${label}\n${board(map)}`;

  // Every token on its own walkable tile.
  assert.equal(map.pcSpawns.length, party, `party short: ${context}`);
  assert.equal(map.enemySpawns.length, footprints.length, `enemies short: ${context}`);
  const held = new Set();
  const stand = (spot, footprint = 1) => {
    for (const tile of footprintTiles(spot, footprint)) {
      const index = tileIndex(width, tile.x, tile.y);
      assert.ok(!blocksMove(terrain[index]), `a token stands on ${terrain[index]} at ${tile.x},${tile.y}: ${context}`);
      assert.ok(!held.has(index), `two tokens share ${tile.x},${tile.y}: ${context}`);
      held.add(index);
    }
  };
  map.pcSpawns.forEach((spot) => stand(spot));
  map.enemySpawns.forEach((spot, index) => stand(spot, footprints[index]));

  // The party inside, the enemies outside on the named side.
  map.pcSpawns.forEach((spot) => assert.ok(inBox(house, spot), `a character outside: ${context}`));
  map.enemySpawns.forEach((spot, index) => {
    for (const tile of footprintTiles(spot, footprints[index])) {
      assert.ok(pastFront(house, side, tile), `an enemy not on the ${side}: ${context}`);
    }
  });

  // One door, the windows asked for, all on the walls, and nothing else open.
  const doorTiles = house.door.map((spot) => tileIndex(width, spot.x, spot.y));
  const windowTiles = house.windows.map((spot) => tileIndex(width, spot.x, spot.y));
  assert.equal(new Set(doorTiles).size, Math.max(1, Math.max(1, ...footprints) - 1), `door width: ${context}`);
  assert.equal(new Set(windowTiles).size, openings - 1, `windows: ${context}`);
  for (let y = house.y0; y <= house.y1; y += 1) {
    for (let x = house.x0; x <= house.x1; x += 1) {
      if (!onRing(house, { x, y })) {
        continue;
      }
      const index = tileIndex(width, x, y);
      const expected = doorTiles.includes(index) ? TERRAIN.door : windowTiles.includes(index) ? TERRAIN.lowwall : TERRAIN.wall;
      assert.equal(terrain[index], expected, `the wall at ${x},${y}: ${context}`);
    }
  }
  house.door.forEach((spot) => assert.ok(pastFront(house, side, { x: spot.x + (side === "east" ? 1 : side === "west" ? -1 : 0), y: spot.y + (side === "south" ? 1 : side === "north" ? -1 : 0) }), `the door does not face the enemies: ${context}`));

  // The rim of the board is whole.
  for (let x = 0; x < width; x += 1) {
    assert.equal(terrain[tileIndex(width, x, 0)], TERRAIN.wall);
    assert.equal(terrain[tileIndex(width, x, height - 1)], TERRAIN.wall);
  }
  for (let y = 0; y < height; y += 1) {
    assert.equal(terrain[tileIndex(width, 0, y)], TERRAIN.wall);
    assert.equal(terrain[tileIndex(width, width - 1, y)], TERRAIN.wall);
  }

  // Each enemy walks to the party, with the party's tiles held.
  const partyTiles = new Set(map.pcSpawns.map((spot) => tileIndex(width, spot.x, spot.y)));
  map.enemySpawns.forEach((spot, index) => {
    const footprint = footprints[index];
    const goal = house.door[0];
    // A Huge creature cannot stand in a doorway with the party crowding the far
    // side of it, and need not: it fights from the step, or waits for room.
    const path = findPath(terrain, width, height, footprint > 2 ? new Set() : partyTiles, spot, goal, footprint, false, { squeeze: footprint > 1 });
    assert.ok(path, `enemy ${index} (footprint ${footprint}) cannot reach the door: ${context}`);
  });
  // And the door tile opens on the room: a walker gets beside someone.
  const beside = new Set();
  for (const pc of map.pcSpawns) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        beside.add(tileIndex(width, pc.x + dx, pc.y + dy));
      }
    }
  }
  const reach = new Set(doorTiles);
  const queue = [...doorTiles];
  let touches = doorTiles.some((tile) => beside.has(tile));
  while (queue.length && !touches) {
    const here = queue.shift();
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const next = here + dy * width + dx;
        if (!reach.has(next) && !partyTiles.has(next) && inBox(house, { x: next % width, y: Math.floor(next / width) }) && !blocksMove(terrain[next])) {
          reach.add(next);
          queue.push(next);
          touches ||= beside.has(next);
        }
      }
    }
  }
  assert.ok(touches, `nobody inside can be reached from the door: ${context}`);

  // Close the door and a walker has no way in: the ring has no gap, on the
  // diagonal either. A flier still crosses a window.
  const shut = terrain.split("");
  doorTiles.forEach((tile) => {
    shut[tileIndex(width, tile % width, Math.floor(tile / width))] = TERRAIN.wall;
  });
  assert.equal(findPath(shut.join(""), width, height, new Set(), map.enemySpawns[0], map.pcSpawns[0]), null, `the room leaks with the door shut: ${context}`);
  if (house.windows.length) {
    assert.ok(findPath(shut.join(""), width, height, new Set(), map.enemySpawns[0], map.pcSpawns[0], 1, true), `a flier cannot cross a window: ${context}`);
  }
}

await test("every side and number of openings holds, across seeds, scenes, parties and rosters", () => {
  let boards = 0;
  for (const side of BUILDING_SIDES) {
    for (let openings = 1; openings <= MAX_OPENINGS; openings += 1) {
      for (const seed of SEEDS) {
        for (const scene of SCENES) {
          for (const [party, roster] of TABLES) {
            const footprints = new Array(roster).fill(1);
            assertBuilding(draw(seed, scene, side, openings, party, footprints), side, openings, party, footprints, `${side} ${openings} seed ${seed} ${scene} party ${party} enemies ${roster}`);
            boards += 1;
          }
        }
      }
    }
  }
  assert.ok(boards > 5000, `only ${boards} boards`);
});

await test("a creature larger than the door still walks in, and no token stands half in a fence", () => {
  const rosters = [[2], [2, 2, 1, 1], [3], [3, 2, 1], [4], [2, 2, 2, 2, 2, 2, 2, 2], [4, 3, 2, 1]];
  for (const side of BUILDING_SIDES) {
    for (let openings = 1; openings <= MAX_OPENINGS; openings += 1) {
      for (const seed of SEEDS) {
        for (const scene of [null, "forest", "swamp", "river"]) {
          for (const footprints of rosters) {
            assertBuilding(draw(seed, scene, side, openings, 8, footprints), side, openings, 8, footprints, `${side} ${openings} seed ${seed} ${scene} roster ${footprints}`);
          }
        }
      }
    }
  }
});

// Four Gargantuan creatures do not fit in the yard of a board 15 tiles deep,
// and eight fit nowhere apart. Each still gets ground its size can stand on,
// outside the house: before, the short spawn list left the board to put the
// rest on single tiles near the first enemy, and each later enemy took the
// spot drawn for the one before it.
await test("a roster too big for the yard stands beside the house, each on ground its size fits", () => {
  for (const side of BUILDING_SIDES) {
    for (const seed of SEEDS) {
      for (const footprints of [[4, 4, 4, 4], [4, 1, 4, 1, 4, 1, 4, 1], new Array(8).fill(4)]) {
        const map = draw(seed, "forest", side, 2, 8, footprints);
        const label = `${side} seed ${seed} roster ${footprints}\n${board(map)}`;
        assert.equal(map.enemySpawns.length, footprints.length, `enemies short: ${label}`);
        const held = new Set();
        map.enemySpawns.forEach((spot, index) => {
          for (const tile of footprintTiles(spot, footprints[index])) {
            assert.ok(tile.x > 0 && tile.y > 0 && tile.x < map.width - 1 && tile.y < map.height - 1, `off the board: ${label}`);
            assert.ok(!blocksMove(map.terrain[tileIndex(map.width, tile.x, tile.y)]), `in a wall or a fence: ${label}`);
            const { x0, y0, x1, y1 } = map.building;
            assert.ok(!(tile.x >= x0 && tile.x <= x1 && tile.y >= y0 && tile.y <= y1), `inside the house: ${label}`);
            const at = tileIndex(map.width, tile.x, tile.y);
            // Only a roster no board seats apart shares ground.
            assert.ok(footprints.length === 8 && footprints.every((size) => size === 4) || !held.has(at), `two on one tile: ${label}`);
            held.add(at);
          }
        });
      }
    }
  }
});

await test("the party's size grows the building, and the smallest and largest boards hold it", () => {
  const area = (map) => (map.building.x1 - map.building.x0 - 1) * (map.building.y1 - map.building.y0 - 1);
  assert.equal(area(draw(7, null, "east", 2, 1, [1])), 16, "the smallest house");
  assert.ok(area(draw(7, null, "east", 2, 16, [1])) >= 16 * 1.5, "sixteen characters and no more room");
  for (const side of BUILDING_SIDES) {
    for (const size of [{ width: 12, height: 10 }, { width: 24, height: 18 }]) {
      for (const seed of SEEDS) {
        for (let openings = 1; openings <= MAX_OPENINGS; openings += 1) {
          const footprints = new Array(8).fill(1);
          assertBuilding(draw(seed, "forest", side, openings, 8, footprints, undefined, size), side, openings, 8, footprints, `${side} ${openings} seed ${seed} ${size.width}x${size.height}`);
        }
      }
    }
  }
});

await test("walls stop sight and give cover; a door and a window do not stop sight, and a window gives half cover right behind it", () => {
  // As los.ts and movement.ts read the tiles, not as this module assumes.
  assert.ok(blocksSight(TERRAIN.wall) && !blocksSight(TERRAIN.door) && !blocksSight(TERRAIN.lowwall));
  assert.ok(blocksMove(TERRAIN.wall) && !blocksMove(TERRAIN.door) && blocksMove(TERRAIN.lowwall));
  assert.ok(!blocksMoveFor(TERRAIN.lowwall, true) && blocksMoveFor(TERRAIN.wall, true));
  assert.equal(moveCost(TERRAIN.door), 1);
  const map = draw(42, null, "east", 2, 1, [1]);
  const { building: house, terrain, width, height } = map;
  const [window] = house.windows;
  assert.equal(window.x, house.x1, "the first window is on the wall the enemies face");
  const inside = { x: window.x - 1, y: window.y };
  const outside = { x: window.x + 3, y: window.y };
  assert.ok(hasLineOfSight(terrain, width, outside.x, outside.y, inside.x, inside.y), "no sight through a window");
  assert.equal(coverBetween(terrain, width, height, outside.x, outside.y, inside.x, inside.y), 2);
  const wallRow = [house.y0 + 1, house.y0 + 2, house.y0 + 3, house.y0 + 4].find(
    (y) => terrain[tileIndex(width, house.x1, y)] === TERRAIN.wall,
  );
  assert.ok(!hasLineOfSight(terrain, width, house.x1 + 2, wallRow, house.x1 - 1, wallRow), "sight through a wall");
  const [door] = house.door;
  assert.ok(hasLineOfSight(terrain, width, door.x + 2, door.y, door.x - 1, door.y), "no sight through the open door");
});

await test("the enemies open 30 feet off, at the distance asked, or as far as the yard holds", () => {
  for (const side of BUILDING_SIDES) {
    for (const seed of SEEDS) {
      const apart = (distance) => {
        const map = draw(seed, null, side, 2, 4, [1, 1, 1], distance);
        return tilesBetweenSides(map.pcSpawns, map.enemySpawns);
      };
      assert.equal(apart(undefined), CLOSE_OPENING_TILES, `${side} ${seed} default`);
      assert.equal(apart(5), 5, `${side} ${seed} 25 feet`);
      // A wall stands between them: nobody is closer than across it.
      assert.equal(apart(1), 2, `${side} ${seed} arm's length`);
      assert.equal(apart(2), 2, `${side} ${seed} 10 feet`);
      const far = apart(120);
      assert.ok(far >= CLOSE_OPENING_TILES && far < 120, `${side} ${seed} far: ${far}`);
    }
  }
});

await test("the same seed draws the same building, and a different one need not", () => {
  const one = draw(42, "forest", "north", 3, 4, [1, 1]);
  assert.deepEqual(draw(42, "forest", "north", 3, 4, [1, 1]), one);
  const others = SEEDS.map((seed) => draw(seed, "forest", "north", 3, 4, [1, 1]).building.door[0].x);
  assert.ok(new Set(others).size > 1, "the door never moves");
});

// Taken from the generator before this change: a board with no building is
// what it was, tile for tile and token for token.
const GOLDEN = {
  "1|": 1295855558,
  "7|forest": 1862215976,
  "42|swamp": 673953763,
  "99|river": 2674639420,
  "1234|tavern": 1523022243,
  "2026|cave": 514262636,
  "90210|desert": 749521068,
  "3141592|mountain": 3919724924,
};

await test("a board with no building is byte-identical to the one the generator drew before", () => {
  for (const [key, expected] of Object.entries(GOLDEN)) {
    const [seed, scene] = key.split("|");
    const map = generateBattleMap({ seed: Number(seed), scene: scene || null, pcCount: 4, enemyCount: 3 });
    assert.equal(fnv1a(JSON.stringify(map)), expected, key);
  }
});

// ---- through start_encounter ----

const world = await openWorld();
for (let hero = 0; hero < 4; hero += 1) {
  world.addHero();
}
const ROSTER = [{ monster: "goblin", count: 3 }];
const open = (args) => world.invoke("start_encounter", { enemies: ROSTER, summary: "A mob at the door", ...args });
const close = () => endEncounter(world.encounter().id, "test");
const boardNow = () => {
  const map = getBattleMapForEncounter(world.encounter().id);
  const tokens = listTokens(map.id);
  return { map, pcs: tokens.filter((token) => token.kind === "pc"), foes: tokens.filter((token) => token.kind === "enemy") };
};
const encounters = () => getDatabase().prepare("SELECT COUNT(*) AS n FROM encounters").get().n;
const maps = () => getDatabase().prepare("SELECT COUNT(*) AS n FROM battle_maps").get().n;

for (const [label, building, field] of [
  ["a word", "inside", "building"],
  ["true", true, "building"],
  ["no side", { openings: 2 }, "building.enemySide"],
  ["a side off the compass", { enemySide: "up" }, "building.enemySide"],
  ["a capital", { enemySide: "East" }, "building.enemySide"],
  ["no openings", { enemySide: "east", openings: 0 }, "building.openings"],
  ["too many openings", { enemySide: "east", openings: 5 }, "building.openings"],
  ["half an opening", { enemySide: "east", openings: 1.5 }, "building.openings"],
  ["openings as text", { enemySide: "east", openings: "2" }, "building.openings"],
  ["an unknown key", { enemySide: "east", pgInside: true }, "building"],
  ["a list", [{ enemySide: "east" }], "building"],
]) {
  await test(`${label} is a clear error to retry, and no fight is created`, async () => {
    const before = [encounters(), maps()];
    const result = await open({ building });
    assert.equal(result.ok, false);
    assert.equal(result.retry, true, JSON.stringify(result));
    assert.match(result.error, new RegExp(field.replace(".", "\\.")));
    assert.match(result.error, /enemySide is north, east, south or west, openings is 1 to 4/);
    assert.equal(getActiveEncounter(world.campaignId), null);
    assert.deepEqual([encounters(), maps()], before);
  });
}

// A weak model's flat call, as the salvage path reads it: the console's form
// never sends one.
const flatCall = (args) => {
  const sheets = world.sheets();
  const turn = createDmTurn(world.campaignId, []);
  return applyEncounterCall(world.campaign(), turn, "start_encounter", JSON.stringify(args), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet]))).result;
};

await test("a wrong building is refused on the flat call too, not dropped", () => {
  const result = flatCall({ monster: "goblin", building: { enemySide: "up" } });
  assert.equal(result.retry, true, JSON.stringify(result));
  assert.match(result.error, /building\.enemySide/);
  assert.equal(getActiveEncounter(world.campaignId), null);
});

await test("the flat call keeps a good building", () => {
  const result = flatCall({ monster: "goblin", building: { enemySide: "west" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const { foes, pcs } = boardNow();
  assert.ok(Math.max(...foes.map((foe) => foe.x)) < Math.min(...pcs.map((pc) => pc.x)));
  close();
});

await test("null leaves the building out, as it does the other fields", async () => {
  const result = await open({ building: null });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.result.building, undefined);
  assert.equal(boardNow().map.skin.id, "");
  assert.deepEqual(boardNow().map.skin.bind, {});
  close();
});

await test("start_encounter with no building draws what the generator drew, with no skin", async () => {
  const result = await open({});
  assert.equal(result.ok, true, result.error);
  const { map } = boardNow();
  const drawn = generateBattleMap({ seed: map.seed, scene: null, pcCount: 4, enemyCount: 3 });
  assert.equal(map.terrain, drawn.terrain);
  assert.deepEqual(map.skin.bind, {});
  assert.equal(result.result.building, undefined);
  close();
});

for (const enemySide of BUILDING_SIDES) {
  await test(`a building with the enemies to the ${enemySide} stands on the board, and the result says so`, async () => {
    const result = await open({ building: { enemySide, openings: 3 } });
    assert.equal(result.ok, true, result.error);
    const { map, pcs, foes } = boardNow();
    assert.ok(map.terrain.includes(TERRAIN.door));
    assert.equal(pcs.length, 4);
    assert.equal(foes.length, 3);
    assert.match(result.result.building, new RegExp(`enemies outside to the ${enemySide}\\. Its door faces ${enemySide}\\.`));
    assert.match(result.result.building, /2 windows look/);
    assert.equal(map.skin.bind["#"], "wall-wood-log");
    assert.equal(map.theme, "field");
    const axis = enemySide === "east" || enemySide === "west" ? "x" : "y";
    const sign = enemySide === "east" || enemySide === "south" ? 1 : -1;
    assert.ok(Math.min(...foes.map((foe) => foe[axis] * sign)) > Math.max(...pcs.map((pc) => pc[axis] * sign)), "the enemies are not on that side");
    assert.equal(tilesBetweenSides(pcs, foes), CLOSE_OPENING_TILES);
    close();
  });
}

await test("openings left out is a door and one window", async () => {
  const result = await open({ building: { enemySide: "east" } });
  assert.equal(result.ok, true, result.error);
  assert.match(result.result.building, /1 window looks east/);
  close();
});

await test("the one way in is a door alone", async () => {
  const result = await open({ building: { enemySide: "east", openings: 1 } });
  assert.equal(result.ok, true, result.error);
  assert.match(result.result.building, /It has no windows/);
  close();
});

await test("distanceFeet is met when the yard holds it, and the distance line is truthful when it does not", async () => {
  const met = await open({ building: { enemySide: "east" }, distanceFeet: 40 });
  assert.equal(met.ok, true, met.error);
  assert.equal(tilesBetweenSides(boardNow().pcs, boardNow().foes), 8);
  assert.equal(met.result.distance, undefined);
  close();
  // Arm's length cannot be: a wall stands between them.
  const near = await open({ building: { enemySide: "east" }, distanceFeet: 5 });
  assert.equal(near.ok, true, near.error);
  const nearly = tilesBetweenSides(boardNow().pcs, boardNow().foes) * 5;
  assert.equal(nearly, 10);
  assert.match(near.result.distance, new RegExp(`wall stands between them, so the nearest enemy stands ${nearly} feet from the party, not 5`));
  close();
  // Past the board: 741's line, with the distance the board holds.
  const far = await open({ building: { enemySide: "north" }, distanceFeet: 600 });
  assert.equal(far.ok, true, far.error);
  const apart = tilesBetweenSides(boardNow().pcs, boardNow().foes) * 5;
  assert.match(far.result.distance, new RegExp(`cannot hold 600 feet: the nearest enemy stands ${apart} feet`));
  close();
});

await test("an ambush and a named surprise keep their rolls and stand as a building does", async () => {
  for (const args of [{ ambush: "enemies" }, { ambush: "party" }, { surprised: "party" }]) {
    const result = await open({ building: { enemySide: "south" }, ...args });
    assert.equal(result.ok, true, result.error);
    assert.equal(tilesBetweenSides(boardNow().pcs, boardNow().foes), CLOSE_OPENING_TILES);
    close();
  }
});

await test("from still sets which of the party stands nearest the door", async () => {
  for (const from of ["ahead", "behind"]) {
    const result = await open({ building: { enemySide: "east" }, from });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.result.formation !== undefined);
    close();
  }
});

await test("an outdoor scene is the ground outside the building", async () => {
  const result = await open({ building: { enemySide: "east" }, scene: "forest" });
  assert.equal(result.ok, true, result.error);
  assert.equal(boardNow().map.theme, "forest");
  assert.equal(boardNow().map.skin.bind["#"], "wall-wood-log");
  close();
});

for (const scene of ["tavern", "temple", "cave", "crypt"]) {
  await test(`scene ${scene} is refused with a building: it is ${sceneTheme(scene)}, and no fight is created`, async () => {
    const before = encounters();
    const result = await open({ building: { enemySide: "east" }, scene });
    assert.equal(result.ok, false);
    assert.equal(result.retry, true);
    assert.match(result.error, new RegExp(`scene "${scene}" is already indoors or underground`));
    assert.equal(encounters(), before);
  });
}

await test("scene tavern with no building still draws the whole interior", async () => {
  const result = await open({ scene: "tavern" });
  assert.equal(result.ok, true, result.error);
  assert.equal(boardNow().map.theme, "interior");
  close();
});

await test("a place that is itself indoors gets its building on open ground", async () => {
  upsertCurrentLocation({ campaignId: world.campaignId, name: "The Sign of the Goat" });
  setLocationLinks(getCurrentLocation(world.campaignId).id, { ambience: { bed: "tavern", music: "" } });
  const inside = await open({});
  assert.equal(inside.ok, true, inside.error);
  assert.equal(boardNow().map.theme, "interior");
  close();
  const result = await open({ building: { enemySide: "west" } });
  assert.equal(result.ok, true, result.error);
  assert.equal(boardNow().map.theme, "field");
  assert.match(result.result.building, /inside a building/);
  close();
  setLocationLinks(getCurrentLocation(world.campaignId).id, { ambience: null });
});

await test("someone absent is not drawn in the building, and stands on a free tile when they arrive", async () => {
  const late = world.addHero({ name: "Cora Vale" });
  const result = await open({ absent: ["Cora Vale"], building: { enemySide: "south" } });
  assert.equal(result.ok, true, result.error);
  assert.match(result.result.absent, /Cora Vale/);
  assert.match(result.result.building, /inside a building/);
  const before = boardNow();
  assert.equal(before.pcs.some((pc) => pc.refId === late.id), false, "an absent character has a token");
  assert.equal(before.map.terrain.split("").filter((tile) => tile === TERRAIN.door).length > 0, true, board(before.map));
  const rolled = await world.invoke("request_roll", { characterId: late.id, kind: "initiative", reason: "initiative" });
  assert.equal(rolled.ok, true, rolled.error);
  const { map, pcs, foes } = boardNow();
  const arrived = pcs.find((pc) => pc.refId === late.id);
  assert.ok(arrived, "the arrival has no token");
  assert.equal(blocksMove(map.terrain[tileIndex(map.width, arrived.x, arrived.y)]), false, board(map));
  const others = [...pcs, ...foes].filter((token) => token !== arrived);
  assert.equal(others.some((token) => token.x === arrived.x && token.y === arrived.y), false, "the arrival stands on someone");
  close();
});

await test("a large creature on the roster gets a door it can squeeze through", async () => {
  const result = await world.invoke("start_encounter", { enemies: [{ monster: "ogre" }], building: { enemySide: "east" } });
  assert.equal(result.ok, true, result.error);
  const { map, foes, pcs } = boardNow();
  const door = map.terrain.indexOf(TERRAIN.door);
  const path = findPath(map.terrain, map.width, map.height, new Set(pcs.map((pc) => tileIndex(map.width, pc.x, pc.y))), foes[0], { x: door % map.width, y: Math.floor(door / map.width) }, 2, false, { squeeze: true });
  assert.ok(path, board(map));
  close();
});

await test("the other settings' field skins keep their own built walls", () => {
  assert.deepEqual(buildingSkin(null, "field").bind, { "#": "wall-wood-log", "+": "door-wood-plain" });
  assert.equal(buildingSkin("cyberpunk", "field"), null);
});

await test("the GM is told when to use it, and the compact cut keeps what the engine reads", () => {
  const compact = compactTool(startEncounterTool).function.parameters.properties.building;
  assert.match(compact.description, /Party inside a building, enemies outside on enemySide/);
  assert.deepEqual(compact.properties.enemySide.enum, BUILDING_SIDES);
  assert.equal(compact.properties.openings.maximum, MAX_OPENINGS);
  assert.deepEqual(compact.required, ["enemySide"]);
  assert.match(compact.properties.openings.description, /A door, then windows/);
});

await test("the console's two questions meet the handler's one argument", () => {
  const entry = adjudication("start_encounter");
  assert.deepEqual(normalizeArgs(entry, { enemies: "goblin", buildingEnemySide: "east", buildingOpenings: "3" }).building, { enemySide: "east", openings: 3 });
  assert.deepEqual(normalizeArgs(entry, { enemies: "goblin", buildingEnemySide: "north" }).building, { enemySide: "north" });
  const none = normalizeArgs(entry, { enemies: "goblin", buildingEnemySide: "", buildingOpenings: "3" });
  assert.equal(none.building, undefined);
  assert.equal(none.buildingOpenings, undefined);
  const ways = entry.fields.find((field) => field.name === "buildingOpenings");
  assert.deepEqual(ways.onlyWhen.equals, [...BUILDING_SIDES]);
  assert.equal(ways.host.feature, "fightInBuilding");
  assert.equal(SERVER_FEATURES.fightInBuilding, true);
});

finish();
