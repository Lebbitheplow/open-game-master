// What the board is told about the mount under a mounted token (issue 1055).
//
// A mounted pair is two creatures on one token, the rider's. "If the mount
// provokes an opportunity attack while you're on it, the attacker can target
// you or the mount" (SRD 5.1, Mounted Combat), and a tap that aims at the
// pair asks which of the two. The board's view carried the rider's health
// word and conditions for that token and nothing about the mount, so the
// plate and the chooser could not say how hurt the mount was.
//
// What each test holds, read from the view the board is sent:
//   - a shown pair's token carries its mount: the mount's id, name, health
//     word and its own conditions, apart from the rider's, and no numbers;
//   - a pair the GM hides, or one the viewer cannot see, carries nothing to
//     a player, and all of it to the GM;
//   - a mounted character's token carries the mount on record: its name, and
//     a health word only where the record keeps hit points;
//   - a steed that is a creature's sheet is read from that sheet.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { OPEN, tokenOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-mounted-pair-plate");
const { setTokenHidden } = await import("../src/lib/db/battle-maps.ts");
const { getMounts, setMount } = await import("../src/lib/db/mounts.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");

const HERO = () => caster("paladin", "cha", ["Find Steed"], [], 5, { speed: 30 });
const playerView = (world, hero) => buildPlayerMapView(world.campaignId, hero.userId);
const gmView = (world) => buildPlayerMapView(world.campaignId, world.owner.id, { fullVision: true });

// A hero and a goblin on a wolf ten squares off, on a board of the test's
// drawing. The goblin is unhurt and frightened; the wolf is at 20 of 60 and
// prone.
async function pair(rows = OPEN()) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(HERO());
  await world.beginFight([{ monster: "goblin", mount: "wolf" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const mount = world.enemies().find((enemy) => enemy.id === rider?.ridesEnemyId);
  assert.ok(rider && mount, "setup: the fight has no rider on a mount");
  const kit = await combatKit(world);
  kit.setEnemy(rider.id, { maxHp: 60, currentHp: 60, conditions: ["frightened"] });
  kit.setEnemy(mount.id, { maxHp: 60, currentHp: 20, conditions: ["prone"] });
  await layMap(world, rows, { [hero.id]: { x: 2, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  return { world, hero, rider, mount, token: tokenOf(world, rider.id) };
}

await test("A pair's token carries its mount to a player: the mount's id and name, its own health word and its own conditions, and no numbers.", async () => {
  const { world, hero, rider, mount, token } = await pair();
  const view = playerView(world, hero);
  assert.ok(view.tokens.some((shown) => shown.id === token.id), "setup: the player does not see the pair");
  const carried = view.tokenMounts?.[token.id];
  assert.ok(carried, "the pair's token says nothing of the mount under the rider");
  assert.equal(carried.refId, mount.id);
  assert.equal(carried.name, mount.displayName);
  assert.equal(carried.health, "bloodied", "the mount's health word is not the mount's own");
  assert.equal(view.tokenHealth[token.id], "unharmed", "the rider's health word changed");
  assert.deepEqual(carried.conditions?.map((row) => row.id), ["prone"], "the mount's conditions are not its own");
  assert.deepEqual(view.tokenConditions[token.id]?.map((row) => row.id), ["frightened"], "the rider's conditions carry the mount's");
  assert.deepEqual(Object.keys(carried).sort(), ["conditions", "health", "name", "refId"], "the mount's entry carries more than a player is shown of the rider");
  assert.equal(rider.ridesEnemyId, mount.id);
});

await test("A mount with no conditions carries none, and one that is unhurt reads unharmed.", async () => {
  const { world, hero, mount, token } = await pair();
  const kit = await combatKit(world);
  kit.setEnemy(mount.id, { maxHp: 60, currentHp: 60, conditions: [] });
  const carried = playerView(world, hero).tokenMounts?.[token.id];
  assert.ok(carried, "the pair's token says nothing of the mount under the rider");
  assert.equal(carried.health, "unharmed");
  assert.equal(carried.conditions, undefined);
});

await test("A pair the GM hides carries nothing about the mount to a player, and the GM's own view keeps it.", async () => {
  const { world, hero, mount, token } = await pair();
  setTokenHidden(token.id, true);
  const view = playerView(world, hero);
  assert.ok(!view.tokens.some((shown) => shown.id === token.id), "setup: the hidden pair is on the player's board");
  assert.deepEqual(view.tokenMounts ?? {}, {}, "a hidden pair's mount reached a player");
  assert.ok(!JSON.stringify(view).includes(mount.id), "the hidden mount's id is somewhere in the player's view");
  const full = gmView(world);
  assert.equal(full.tokenMounts?.[token.id]?.refId, mount.id, "the GM's view lost the hidden pair's mount");
  assert.equal(full.tokenMounts?.[token.id]?.health, "bloodied");
});

await test("A pair behind a wall the player cannot see past carries nothing about the mount, until the GM's view, which sees all.", async () => {
  const rows = OPEN().map((row) => `${row.slice(0, 7)}#${row.slice(8)}`);
  const { world, hero, mount, token } = await pair(rows);
  const view = playerView(world, hero);
  assert.ok(!view.tokens.some((shown) => shown.id === token.id), "setup: the player sees the pair through the wall");
  assert.deepEqual(view.tokenMounts ?? {}, {}, "an unseen pair's mount reached a player");
  assert.ok(!JSON.stringify(view).includes(mount.id), "the unseen mount's id is somewhere in the player's view");
  assert.equal(gmView(world).tokenMounts?.[token.id]?.name, mount.displayName);
});

await test("A rider whose mount is dead carries no mount: the token is the rider's alone.", async () => {
  const { world, hero, mount, token } = await pair();
  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare("UPDATE encounter_enemies SET status = 'dead', current_hp = 0 WHERE id = ?").run(mount.id);
  assert.equal(playerView(world, hero).tokenMounts?.[token.id], undefined);
});

await test("A mounted character's token carries the mount on record: its name, and the health word of the hit points the record keeps.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero({ ...FIGHTER, speed: 30 });
  const [foe] = await fightDummies(world, 1, { heroFaces: { [hero.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [hero.id]: { x: 5, y: 3 }, [foe.id]: { x: 12, y: 3 } });
  const before = playerView(world, hero);
  assert.equal(before.tokenMounts?.[tokenOf(world, hero.id).id], undefined, "a character on foot carries a mount");
  const up = await world.invoke("mount_up", { characterId: hero.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  const token = tokenOf(world, hero.id);
  const record = getMounts(world.campaignId)[hero.id];
  assert.ok(typeof record.hp === "number" && typeof record.maxHp === "number", "setup: the warhorse on record keeps no hit points");
  const carried = playerView(world, hero).tokenMounts?.[token.id];
  assert.ok(carried, "the mounted character's token says nothing of the mount");
  assert.equal(carried.name, "Warhorse");
  assert.equal(carried.health, "unharmed");
  assert.equal(carried.refId, undefined, "a mount on record is no creature on the board");
  // The record's own hit points, as a blow to the mount leaves them.
  setMount(world.campaignId, hero.id, { ...record, hp: Math.floor(record.maxHp / 3) });
  assert.equal(playerView(world, hero).tokenMounts?.[token.id]?.health, "bloodied");
  // A beast the GM wrote with no numbers has no health to show.
  setMount(world.campaignId, hero.id, { ref: "old-bess", name: "Old Bess", speed: record.speed, controlled: true, size: record.size });
  const named = playerView(world, hero).tokenMounts?.[token.id];
  assert.equal(named?.name, "Old Bess");
  assert.equal(named?.health, undefined, "a mount with no hit points on record was given a health word");
});

await test("A steed that is a creature's own sheet is read from that sheet: its health word and its conditions, apart from its rider's.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const paladin = world.addHero(HERO());
  const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(cast.ok, true, cast.error);
  const steed = world.sheets().find((sheet) => sheet.summon?.spell === "Find Steed");
  const [foe] = await fightDummies(world, 1, { heroFaces: { [paladin.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [paladin.id]: { x: 3, y: 3 }, [steed.id]: { x: 4, y: 3 }, [foe.id]: { x: 12, y: 3 } });
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  assert.equal(getMounts(world.campaignId)[paladin.id].sheetId, steed.id, "setup: the steed is not the mount");
  world.patch(steed.id, { currentHp: Math.floor(steed.maxHp / 5), conditions: ["poisoned"] });
  world.patch(paladin.id, { conditions: ["frightened"] });
  const token = tokenOf(world, paladin.id);
  const view = playerView(world, paladin);
  const carried = view.tokenMounts?.[token.id];
  assert.ok(carried, "the paladin's token says nothing of the steed under her");
  assert.equal(carried.refId, steed.id);
  assert.equal(carried.name, steed.name);
  assert.equal(carried.health, "critical");
  assert.deepEqual(carried.conditions?.map((row) => row.id), ["poisoned"]);
  assert.deepEqual(view.tokenConditions[token.id]?.map((row) => row.id), ["frightened"], "the rider's conditions carry the steed's");
  assert.equal(view.tokenHealth[token.id], "unharmed");
});

closeTables();
finish();
