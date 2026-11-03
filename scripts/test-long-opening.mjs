// Issue 741: start_encounter with a distance past the board's edge threw after
// the encounter and its map were written, and the fight went on with no tokens
// on a black board. Every distance now opens with one token per character and
// per enemy on walkable ground, the tool result says how far apart they really
// stand when the board fell short, and a map is never left without its tokens.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-long-opening");

const { getDatabase } = await import("../src/lib/db/core.ts");
const { endEncounter } = await import("../src/lib/db/encounters.ts");
const { getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { blocksMove, tileIndex } = await import("../src/lib/battlemap/types.ts");
const { tilesBetweenSides } = await import("../src/lib/battlemap/generate.ts");

const world = await openWorld();
for (let hero = 0; hero < 4; hero += 1) {
  world.addHero();
}
const ROSTER = [{ monster: "goblin", count: 3 }];
const open = (distanceFeet) => world.invoke("start_encounter", { enemies: ROSTER, summary: "Raiders on the ridge", distanceFeet });
const close = () => endEncounter(world.encounter().id, "test");

for (const feet of [60, 100, 200, 600]) {
  await test(`${feet} feet opens with every token on its own walkable tile, and says how far`, async () => {
    const started = await open(feet);
    assert.equal(started.ok, true, started.error);
    const map = getBattleMapForEncounter(world.encounter().id);
    const tokens = listTokens(map.id);
    const pcs = tokens.filter((token) => token.kind === "pc");
    const foes = tokens.filter((token) => token.kind === "enemy");
    assert.equal(pcs.length, 4);
    assert.equal(foes.length, world.enemies().length);
    assert.equal(foes.length, 3);
    const tiles = tokens.map((token) => tileIndex(map.width, token.x, token.y));
    assert.equal(new Set(tiles).size, tiles.length, "two tokens share a tile");
    tiles.forEach((tile) => assert.ok(!blocksMove(map.terrain[tile]), "a token stands on a wall"));
    // What the tool says is what the board shows.
    const apart = tilesBetweenSides(pcs, foes) * 5;
    if (apart < feet) {
      assert.match(started.result.distance, new RegExp(`cannot hold ${feet} feet: the nearest enemy stands ${apart} feet`));
    } else {
      assert.equal(apart, feet);
      assert.equal(started.result.distance, undefined);
    }
    close();
  });
}

await test("600 feet is past every board, so the result always says so", async () => {
  const started = await open(600);
  assert.match(started.result.distance, /cannot hold 600 feet/);
  close();
});

await test("a distance the board holds is met and adds no line", async () => {
  const started = await open(30);
  assert.equal(started.result.distance, undefined);
  const map = getBattleMapForEncounter(world.encounter().id);
  const tokens = listTokens(map.id);
  assert.equal(tilesBetweenSides(tokens.filter((token) => token.kind === "pc"), tokens.filter((token) => token.kind === "enemy")), 6);
  close();
});

await test("a failure placing the tokens leaves no map and no open fight, and the next try opens", async () => {
  const db = getDatabase();
  db.exec("CREATE TRIGGER refuse_tokens BEFORE INSERT ON battle_tokens BEGIN SELECT RAISE(ABORT, 'no tokens today'); END");
  const outcome = await open(60).catch((error) => ({ ok: false, error: String(error) }));
  db.exec("DROP TRIGGER refuse_tokens");
  assert.equal(outcome.ok, false);
  const row = db.prepare("SELECT id FROM encounters WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(world.campaignId);
  assert.equal(getBattleMapForEncounter(row.id), null, "an empty map was left behind");
  assert.equal(world.encounter(), null, "a fight stayed open with no board");
  const again = await open(60);
  assert.equal(again.ok, true, again.error);
  assert.equal(listTokens(getBattleMapForEncounter(world.encounter().id).id).length, 7);
});

finish();
