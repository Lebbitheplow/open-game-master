// A mounted character fills the mount's space on the board (issue 1055).
//
// A character's token was always one square, so a rider on a Large warhorse
// stood in one square of the four the horse fills. The maintainer's ruling on
// the pair: "One token, in the mount's space ... the pair fills the mount's
// space", and for characters: "A Large horse that fills one square is wrong
// the same way."
//
// What each test holds:
//   - the token's size comes from the mount record, for a mount on record
//     and for a creature mount, controlled or independent;
//   - every square of the space is held: nobody else is set down in it;
//   - reach, opportunity attacks and areas are measured from the whole space;
//   - mounting takes a space that still covers the rider's square, and is
//     refused, with nothing spent, where there is no room for one;
//   - getting down gives the one square back;
//   - a walk taken back and a GM turn reverted leave the board as it was;
//   - a fight that begins with a rider already up seats the pair in a space
//     of its own.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { holdTurn, mapOf, OPEN, place, tokenOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-mounted-space");
const { listTokens } = await import("../src/lib/db/battle-maps.ts");
const { listEnemies } = await import("../src/lib/db/encounters.ts");
const { getMounts } = await import("../src/lib/db/mounts.ts");
const { tilesApart, tokenFootprint } = await import("../src/lib/dm/board-reach.ts");
const { buildPlayerMapView, footprintLookup, occupiedTiles } = await import("../src/lib/battlemap/view.ts");
const { creaturesInBlast, spellAreaShape } = await import("../src/lib/dm/aoe-shape.ts");
const { approachForCompanion } = await import("../src/lib/dm/companion-approach.ts");
const { getEnemy } = await import("../src/lib/db/encounters.ts");
const footprints = await import("../src/lib/battlemap/footprint.ts");

const RIDER = { ...FIGHTER, speed: 30 };
const PALADIN = () => caster("paladin", "cha", ["Find Steed"], [], 5, { speed: 30 });
const at = (world, refId) => [tokenOf(world, refId).x, tokenOf(world, refId).y];
const sizeOf = (world, refId) => tokenFootprint(tokenOf(world, refId));
// The squares every token but `except` holds, as the walk and the placement doors read them.
const heldBy = (world, except = null) => {
  const map = mapOf(world);
  const lookup = footprintLookup(new Map(listEnemies(world.encounter().id).map((enemy) => [enemy.id, enemy])));
  return occupiedTiles(map, listTokens(map.id), except ? tokenOf(world, except) : null, lookup);
};
const square = (world, x, y) => y * mapOf(world).width + x;

// A fighter first in the order on a board of the test's drawing, one enemy on it.
async function table({ rows = OPEN(), rider = { x: 5, y: 3 }, enemy = { x: 20, y: 7 }, heroes = [RIDER] } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const sheets = heroes.map((hero) => world.addHero(hero));
  const [foe] = await fightDummies(world, 1, { heroFaces: { [sheets[0].id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, rows, { [sheets[0].id]: rider, [foe.id]: enemy, ...Object.fromEntries(sheets.slice(1).map((sheet, index) => [sheet.id, { x: 1 + index, y: 8 }])) });
  return { world, hero: sheets[0], sheets, foe };
}

async function mounted(setup) {
  const seat = await table(setup);
  const up = await seat.world.invoke("mount_up", { characterId: seat.hero.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  return { ...seat, up };
}

// Mounting and getting down are once a move: the rider's next turn, for the test that does both.
const getDown = (world, sheet) => {
  holdTurn(world, sheet.id);
  return world.invoke("dismount", { characterId: sheet.id });
};

const post = async (world, sheet, name, body) => {
  const route = await world.route(`campaigns/[campaignId]/battle-map/${name}`);
  world.signIn({ id: sheet.userId });
  const response = await route.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/${name}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
};

await test("A rider's token is sized by the mount: Large is two squares a side, Huge three, and a Medium pony under a small rider is still one.", () => {
  assert.equal(typeof footprints.riderFootprint, "function", "there is no reading of a rider's space");
  assert.equal(footprints.riderFootprint({ size: "large" }), 2);
  assert.equal(footprints.riderFootprint({ size: "huge" }), 3);
  assert.equal(footprints.riderFootprint({ size: "medium" }), 1);
  assert.equal(footprints.riderFootprint(undefined), 1, "a character on foot is not one square");
  // The spaces that still cover the rider's square, their own square first.
  assert.deepEqual(footprints.anchorsCovering({ x: 5, y: 3 }, 2)[0], { x: 5, y: 3 });
  assert.equal(footprints.anchorsCovering({ x: 5, y: 3 }, 2).length, 4);
  assert.ok(footprints.anchorsCovering({ x: 5, y: 3 }, 3).every((anchor) => anchor.x <= 5 && anchor.x >= 3 && anchor.y <= 3 && anchor.y >= 1));
});

await test("A character on a Large warhorse covers four squares: the token, the squares nobody else may take, and what the board draws.", async () => {
  const { world, hero } = await mounted();
  assert.equal(sizeOf(world, hero.id), 2, "the rider's token is still one square");
  assert.deepEqual(at(world, hero.id), [5, 3], "a rider with open ground around them was moved to mount");
  const held = heldBy(world);
  for (const [x, y] of [[5, 3], [6, 3], [5, 4], [6, 4]]) {
    assert.ok(held.has(square(world, x, y)), `(${x},${y}) of the pair's space is free for anyone to stand in`);
  }
  const view = buildPlayerMapView(world.campaignId, hero.userId);
  assert.equal(view.tokenFootprint[tokenOf(world, hero.id).id], 2, "the board draws the rider in one square");
});

await test("Nobody is set down in a square of the pair's space: an enemy pushed onto the far corner is refused.", async () => {
  const { world, hero, foe } = await mounted();
  const pushed = await world.invoke("move_token", { token: foe.id, x: 6, y: 4, forced: true });
  assert.equal(pushed.ok, false, "an enemy was set down inside the space the horse fills");
  assert.match(pushed.error, /occupied/);
  assert.equal(sizeOf(world, hero.id), 2);
});

await test("Reach is measured from the pair's space: an enemy against the horse's far side is within 5 feet, and is struck with no walk.", async () => {
  const { world, hero, foe } = await mounted({ enemy: { x: 7, y: 4 } });
  assert.equal(tilesApart(tokenOf(world, hero.id), tokenOf(world, foe.id)), 1, "an enemy against the horse's flank is measured from the rider's corner square");
  const swing = await world.invoke("pc_attack", { characterId: hero.id, attacks: [{ targetEnemyId: foe.id }] });
  assert.equal(swing.ok, true, swing.error);
  assert.deepEqual(at(world, hero.id), [5, 3], "the rider walked to reach an enemy already beside the horse");
});

await test("A companion whose horse's far side is against its target is in reach already: the server's turn for it does not walk the pair.", async () => {
  const { world, hero, foe } = await mounted({ enemy: { x: 7, y: 4 } });
  assert.equal(tilesApart(tokenOf(world, hero.id), tokenOf(world, foe.id)), 1, "setup: the enemy is not against the horse's flank");
  const walked = approachForCompanion(world.campaign(), world.encounter(), world.sheet(hero.id), getEnemy(foe.id));
  assert.equal(walked, null, `a companion already in reach was walked: ${walked}`);
  assert.deepEqual(at(world, hero.id), [5, 3], "the pair stepped off a square it could already strike from");
});

await test("Riding out of an enemy's reach provokes its opportunity attack when the pair's last square leaves it.", async () => {
  const { world, hero, foe } = await mounted({ enemy: { x: 7, y: 3 } });
  const before = world.sheet(hero.id).currentHp;
  world.clearDice();
  world.dice(20, 20, 6, 6);
  const walk = await post(world, hero, "move", { x: 3, y: 3 });
  world.clearDice();
  assert.equal(walk.status, 200, JSON.stringify(walk.json).slice(0, 300));
  assert.ok((walk.json.opportunityAttacks ?? []).length > 0, `the enemy beside the horse's flank let the pair ride off: ${JSON.stringify(walk.json.opportunityAttacks)}`);
  assert.ok(world.sheet(hero.id).currentHp < before || getMounts(world.campaignId)[hero.id], "setup: the swing was made at the pair");
  assert.ok(foe.id);
});

await test("An area that covers only the horse's far corner catches the rider; on foot at the same square it does not.", async () => {
  const { world, hero } = await mounted();
  const fireball = spellAreaShape("Fireball");
  assert.ok(fireball, "setup: Fireball has an area");
  const caught = (x) => {
    const out = creaturesInBlast({ encounterId: world.encounter().id, casterId: "nobody", casterName: "A trap", label: "Fireball", area: fireball, rangeFeet: null, at: { x, y: 4 } });
    return Boolean(out && !("error" in out) && out.characterIds.includes(hero.id));
  };
  const farthest = [...Array(16).keys()].map((step) => 22 - step).find(caught);
  assert.ok(farthest, "setup: no Fireball along the row caught the pair");
  const down = await getDown(world, hero);
  assert.equal(down.ok, true, down.error);
  assert.deepEqual(at(world, hero.id), [5, 3]);
  assert.equal(caught(farthest), false, "the blast that reached only the horse's far corner was read from the rider's corner square alone");
});

await test("Getting down gives the one square back: the token is one square and the rest of the space is free again.", async () => {
  const { world, hero, foe } = await mounted();
  const down = await getDown(world, hero);
  assert.equal(down.ok, true, down.error);
  assert.equal(sizeOf(world, hero.id), 1, "a character on foot still fills the horse's space");
  assert.deepEqual(at(world, hero.id), [5, 3]);
  assert.equal(buildPlayerMapView(world.campaignId, hero.userId).tokenFootprint[tokenOf(world, hero.id).id], undefined);
  const stepped = await world.invoke("move_token", { token: foe.id, x: 6, y: 4, forced: true });
  assert.equal(stepped.ok, true, stepped.error);
});

await test("Mounting where the rider's own square cannot be the space's corner takes a space that still covers their square.", async () => {
  const { world, hero } = await mounted({ rider: { x: 23, y: 8 } });
  assert.deepEqual(at(world, hero.id), [22, 7], "the pair's space runs off the board, or left the square the rider stood on");
  assert.equal(sizeOf(world, hero.id), 2);
});

await test("With no room for the mount's space the mount is refused with the reason, and nothing is spent.", async () => {
  // A corridor one square wide: no space two squares a side holds the rider's square.
  const rows = OPEN();
  rows[0] = "#".repeat(24);
  rows[2] = "#".repeat(24);
  const { world, hero } = await table({ rows, rider: { x: 5, y: 1 } });
  const up = await world.invoke("mount_up", { characterId: hero.id, mount: "Warhorse" });
  assert.equal(up.ok, false, "a Large horse was mounted in a corridor one square wide");
  assert.match(up.error, /no room to mount/);
  assert.match(up.error, /Nothing was spent/);
  assert.equal(getMounts(world.campaignId)[hero.id], undefined, "the refused mount was put on record");
  assert.equal(tokenOf(world, hero.id).movedThisRound, 0, "the refused mount took movement");
  // The same turn, on open ground: the once-a-move mark was not taken either.
  place(world, hero.id, 5, 5);
  const again = await world.invoke("mount_up", { characterId: hero.id, mount: "Warhorse" });
  assert.equal(again.ok, true, again.error);
  assert.equal(sizeOf(world, hero.id), 2);
});

await test("A creature in the way leaves no room either: an ally standing in the only space is not mounted over.", async () => {
  const rows = OPEN();
  rows[0] = "#".repeat(24);
  rows[3] = "#".repeat(24);
  const { world, hero, sheets } = await table({ rows, rider: { x: 5, y: 1 }, heroes: [RIDER, { ...FIGHTER, name: "Squire" }] });
  // Rows 1 and 2 are open; the ally and the enemy between them hold a square of every space around the rider.
  place(world, sheets[1].id, 5, 2);
  const up = await world.invoke("mount_up", { characterId: hero.id, mount: "Warhorse" });
  assert.equal(up.ok, false, "a horse was mounted on top of an ally");
  assert.match(up.error, /no room to mount/);
});

await test("A walk taken back puts the pair where it stood, still in its four squares.", async () => {
  const { world, hero } = await mounted();
  const spent = tokenOf(world, hero.id).movedThisRound;
  const walk = await post(world, hero, "move", { x: 9, y: 3 });
  assert.equal(walk.status, 200, JSON.stringify(walk.json).slice(0, 300));
  assert.deepEqual(at(world, hero.id), [9, 3]);
  assert.ok(heldBy(world).has(square(world, 10, 4)), "the pair's space did not walk with it");
  const undone = await post(world, hero, "undo");
  assert.equal(undone.status, 200, JSON.stringify(undone.json).slice(0, 300));
  assert.deepEqual(at(world, hero.id), [5, 3]);
  assert.equal(tokenOf(world, hero.id).movedThisRound, spent, "the walk's movement did not come back");
  assert.equal(sizeOf(world, hero.id), 2);
  assert.equal(undone.json.view.tokenFootprint[tokenOf(world, hero.id).id], 2);
});

await test("Reverting the GM turn that mounted puts the board back as the turn found it: the rider on foot, on their own square.", async () => {
  const { world, hero } = await table({ rider: { x: 23, y: 8 } });
  const before = snapshot();
  const up = await world.invoke("mount_up", { characterId: hero.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  assert.deepEqual(at(world, hero.id), [22, 7], "setup: mounting in the corner did not shift the token");
  await revertTurn(world, up.turnId);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.deepEqual(at(world, hero.id), [23, 8]);
  assert.equal(sizeOf(world, hero.id), 1);
});

await test("A creature mount gives its rider's token its space too, controlled or acting on its own.", async () => {
  for (const controlled of [true, false]) {
    const world = await openWorld({ gameSettings: { ttsEnabled: false } });
    const paladin = world.addHero(PALADIN());
    const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
    assert.equal(cast.ok, true, cast.error);
    const steed = world.sheets().find((sheet) => sheet.summon?.spell === "Find Steed");
    const [foe] = await fightDummies(world, 1, { heroFaces: { [paladin.id]: 20 } });
    castOnOwnTurn(world);
    await layMap(world, OPEN(), { [paladin.id]: { x: 3, y: 3 }, [steed.id]: { x: 4, y: 3 }, [foe.id]: { x: 20, y: 7 } });
    const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse", controlled });
    assert.equal(up.ok, true, up.error);
    assert.equal(getMounts(world.campaignId)[paladin.id].sheetId, steed.id, "setup: the steed is not the mount");
    assert.equal(sizeOf(world, paladin.id), 2, `the rider on a ${controlled ? "controlled" : "independent"} creature mount is one square`);
    // Asked by the mount's own id, as its walk asks, the pair's space is the same.
    assert.equal(tokenFootprint({ kind: "pc", refId: steed.id }), 2, "the mount under its rider is read as one square");
    // The steed's own square was free for the pair: it is the pair.
    assert.deepEqual(at(world, paladin.id), [3, 3]);
    const down = await getDown(world, paladin);
    assert.equal(down.ok, true, down.error);
    assert.equal(sizeOf(world, paladin.id), 1);
    const own = listTokens(mapOf(world).id).find((token) => token.refId === steed.id);
    assert.ok(own, "the steed has no square of its own after its rider got down");
    assert.ok(own.x !== 3 || own.y !== 3, "the steed stands on its rider");
  }
});

await test("A fight that begins with a rider already up seats the pair in a space of its own: no square of it is shared or off the ground.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const rider = world.addHero(RIDER);
  world.addHero({ ...FIGHTER, name: "Squire" });
  world.addHero({ ...FIGHTER, name: "Page" });
  const up = await world.invoke("mount_up", { characterId: rider.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  await world.beginFight([{ monster: "goblin", count: 2 }], { heroFaces: { [rider.id]: 20 } });
  const map = mapOf(world);
  const token = tokenOf(world, rider.id);
  assert.equal(tokenFootprint(token), 2);
  assert.ok(footprints.footprintFits(map.width, map.height, token, 2), "the pair's space runs off the board");
  const others = heldBy(world, rider.id);
  for (const tile of footprints.footprintTiles(token, 2)) {
    assert.ok(!others.has(square(world, tile.x, tile.y)), `(${tile.x},${tile.y}) of the pair's space is somebody else's square`);
    assert.ok(![..."#|"].includes(map.terrain[square(world, tile.x, tile.y)]), `(${tile.x},${tile.y}) of the pair's space is a wall`);
  }
});

await test("A prepared map laid under a running fight seats the pair on its new ground: no square of the space on rock.", async () => {
  const { world, hero } = await mounted();
  const { createPreparedMap } = await import("../src/lib/db/prepared-maps.ts");
  const { deployPreparedMap } = await import("../src/lib/dm/map-library.ts");
  // Column 6 is rock on the new map: the rider's own square stays open, the horse's half does not.
  const rows = OPEN().map((row) => `${row.slice(0, 6)}#${row.slice(7)}`);
  const prepared = createPreparedMap({ campaignId: world.campaignId, name: "The wall", width: 24, height: rows.length, terrain: rows.join(""), ambient: "bright", theme: "field", seed: 1 });
  const laid = deployPreparedMap(world.campaign(), prepared.id);
  assert.equal(laid.ok, true, laid.error);
  const map = mapOf(world);
  const token = tokenOf(world, hero.id);
  assert.equal(tokenFootprint(token), 2);
  for (const tile of footprints.footprintTiles(token, 2)) {
    assert.notEqual(map.terrain[square(world, tile.x, tile.y)], "#", `(${tile.x},${tile.y}) of the pair's space is rock on the new map`);
  }
});

await test("A generated map laid under a running fight seats the pair too: the party's spawn squares sit side by side, and the horse is not set over a friend or a wall.", async () => {
  const { world, hero } = await mounted({ heroes: [RIDER, { ...FIGHTER, name: "Squire" }, { ...FIGHTER, name: "Page" }] });
  const { applyStudioMap } = await import("../src/lib/dm/map-studio.ts");
  for (const seed of [11, 12, 13]) {
    const laid = applyStudioMap(world.campaign(), { seed, theme: "dungeon" });
    assert.equal(laid.ok, true, laid.error);
    const map = mapOf(world);
    const token = tokenOf(world, hero.id);
    assert.ok(footprints.footprintFits(map.width, map.height, token, 2), `seed ${seed}: the pair's space runs off the board`);
    const others = heldBy(world, hero.id);
    for (const tile of footprints.footprintTiles(token, 2)) {
      assert.ok(!others.has(square(world, tile.x, tile.y)), `seed ${seed}: (${tile.x},${tile.y}) of the pair's space is somebody else's square`);
      assert.ok(![..."#|"].includes(map.terrain[square(world, tile.x, tile.y)]), `seed ${seed}: (${tile.x},${tile.y}) of the pair's space is a wall`);
    }
  }
});

await test("A prepared fight's entry square seats the pair: the party set down by the entry leaves the horse room, clear of friends.", async () => {
  const { world, hero } = await mounted({ heroes: [RIDER, { ...FIGHTER, name: "Squire" }, { ...FIGHTER, name: "Page" }] });
  const { applyTemplateExtras } = await import("../src/lib/dm/template-apply.ts");
  const { EMPTY_TEMPLATE_EXTRAS } = await import("../src/lib/dm/encounter-template-logic.ts");
  applyTemplateExtras(world.campaign(), world.owner.id, { name: "The gate", enemies: [], extras: { ...EMPTY_TEMPLATE_EXTRAS, entry: { x: 10, y: 4 } } });
  const map = mapOf(world);
  const token = tokenOf(world, hero.id);
  assert.ok(footprints.footprintFits(map.width, map.height, token, 2), "the pair's space runs off the board");
  const others = heldBy(world, hero.id);
  for (const tile of footprints.footprintTiles(token, 2)) {
    assert.ok(!others.has(square(world, tile.x, tile.y)), `(${tile.x},${tile.y}) of the pair's space is somebody else's square`);
  }
});

closeTables();
finish();
