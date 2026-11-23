// A mount with a rider on it is a creature on the board (issues 1036 and
// 1055).
//
// The pair stands on one token, the rider's (ruling 1 of each issue), so the
// pieces on the board (db/battle-maps.ts listTokens) hold no entry for the
// mount. Every rule that read that list to ask who stands where passed the
// mount over: a Fireball over a goblin on a wolf burned the goblin alone,
// and a search of the list for the wolf's own id found nobody.
//
// "An area that catches both creatures resolves each one separately"
// (issue 1055, ruling 6). The rules that ask who stands where now read
// listStandings, where a ridden mount stands under its own id on its
// rider's token.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { caster, closeTables } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { holdTurn, mapOf, nextTurn, OPEN, zonesOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-ridden-mount-standings");
const { listHiddenRefIds, listStandings, listTokens, setTokenHidden } = await import("../src/lib/db/battle-maps.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { liveZones, saveZones } = await import("../src/lib/dm/zone-store.ts");
const { characterShootsInMelee } = await import("../src/lib/dm/attack-spatial.ts");
const { lashOut } = await import("../src/lib/dm/confusion.ts");
const { serializeMapForPrompt } = await import("../src/lib/battlemap/serialize.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { moveTokenFreely, readTemplate } = await import("../src/lib/dm/board.ts");

const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const live = (world, id) => world.enemies().find((enemy) => enemy.id === id);
const NL = String.fromCharCode(10);
const has = (world, id, condition) => live(world, id).conditions.includes(condition);

// A hero at (`heroAt`,4) and a goblin on a wolf at (12,4), on an open board.
// The order is the hero, the rider, the mount, with the pointer on the hero.
async function pair(who, { heroAt = 4, mount = "wolf" } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(who);
  await world.beginFight([{ monster: "goblin", mount }]);
  const up = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const under = world.enemies().find((enemy) => enemy.id === up?.ridesEnemyId);
  assert.ok(up && under, "setup: the fight has no rider on a mount");
  await layMap(world, OPEN(), { [hero.id]: { x: heroAt, y: 4 }, [up.id]: { x: 12, y: 4 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(hero.id), entry(up.id), entry(under.id)], turnIndex: 0, turnBudget: null, reactionsUsed: [] });
  world.clearDice();
  world.diceLog();
  return { world, hero, rider: up, mount: under };
}

// Both sturdy enough to stand a Fireball, so what each lost can be read.
async function sturdy(world, ...enemies) {
  const kit = await combatKit(world);
  for (const enemy of enemies) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
}

// ---- the list itself ----

await test("A ridden mount stands on the board under its own id, on its rider's token and before its rider; the pieces on the board stay one.", async () => {
  const { world, rider, mount } = await pair(caster("wizard", "int", ["Fireball"]));
  const map = mapOf(world);
  assert.equal(listTokens(map.id).filter((token) => token.kind === "enemy").length, 1, "the pair is not one piece on the board");
  const standing = listStandings(map.id).filter((token) => token.kind === "enemy");
  assert.deepEqual(standing.map((token) => token.refId), [mount.id, rider.id]);
  const [under, up] = standing;
  assert.equal(under.id, up.id, "the mount does not stand on its rider's token");
  assert.deepEqual([under.x, under.y, under.name], [12, 4, mount.displayName]);
});

await test("A mount under a rider the GM keeps hidden is hidden with it.", async () => {
  const { world, rider, mount } = await pair(caster("wizard", "int", ["Fireball"]));
  const map = mapOf(world);
  assert.deepEqual(listHiddenRefIds(map.id), []);
  setTokenHidden(ownToken(world, rider.id).id, true);
  assert.deepEqual([...listHiddenRefIds(map.id)].sort(), [mount.id, rider.id].sort(), "the mount of a hidden rider reads as shown");
});

// ---- areas ----

await test("A blast laid on the board catches the mount and its rider, each one separately (Fireball).", async () => {
  const { world, hero, rider, mount } = await pair(caster("wizard", "int", ["Fireball"]));
  await sturdy(world, rider, mount);
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Fireball", level: 3, atX: 13, atY: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(live(world, rider.id).currentHp < 300, "the fire missed the rider");
  assert.ok(live(world, mount.id).currentHp < 300, "the fire passed over the mount under its rider");
});

await test("A mount named for an area it does not stand in is refused, as its rider is.", async () => {
  const { world, hero, mount } = await pair(caster("wizard", "int", ["Shatter"]));
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Shatter", level: 2, enemyIds: [mount.id], atX: 20, atY: 4 });
  world.clearDice();
  assert.equal(out.ok, false, "a mount 40 feet from the burst was taken as inside it");
  assert.equal(live(world, mount.id).currentHp, live(world, mount.id).maxHp);
});

await test("An area that catches whoever stands on it as it is laid catches the mount with its rider (Entangle).", async () => {
  const { world, hero, rider, mount } = await pair(caster("druid", "wis", ["Entangle"]));
  // Each one's Strength save, failed.
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Entangle", level: 1, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(has(world, rider.id, "restrained"), "the vines missed the rider");
  assert.ok(has(world, mount.id, "restrained"), "the vines passed over the mount under its rider");
});

await test("A template the GM measures on the board names the mount and its rider, caught by a square of the pair's space that is not its corner.", async () => {
  const { world, rider, mount } = await pair(caster("wizard", "int", ["Fireball"]), { mount: "warhorse" });
  // The warhorse holds (12,4) to (13,5); a 5-foot burst at (14,6) covers
  // (13,5) and never the pair's corner.
  const readout = readTemplate(world.campaign(), { shape: "sphere", origin: { x: 14, y: 6 }, target: { x: 14, y: 6 }, sizeFeet: 5 });
  assert.ok(readout, "setup: no board to measure on");
  const caught = readout.caught.map((entry) => entry.enemyId).filter(Boolean).sort();
  assert.deepEqual(caught, [mount.id, rider.id].sort(), `the template caught ${JSON.stringify(readout.caught)}`);
});

await test("The ground that shakes at the end of its caster's turn throws the mount down as well as its rider (Earthquake).", async () => {
  const { world, hero, rider, mount } = await pair(caster("cleric", "wis", ["Earthquake"], [], 15), { heroAt: 2 });
  world.dice(...new Array(12).fill(20));
  const cast = await world.invoke("use_spell_slot", { characterId: hero.id, spell: "Earthquake", level: 8, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Earthquake"), "setup: the area is laid");
  assert.equal(has(world, mount.id, "prone"), false, "setup: the mount fell as the spell was cast");
  holdTurn(world, hero.id);
  world.dice(...new Array(8).fill(1));
  nextTurn(world);
  world.clearDice();
  assert.ok(has(world, mount.id, "prone"), "the mount under its rider kept its feet with no save");
  assert.ok(has(world, rider.id, "prone"), "the rider kept its feet");
});

await test("An aura held by a ridden mount lies around the square the pair stands on.", async () => {
  const { world, mount } = await pair(caster("wizard", "int", ["Fireball"]));
  const map = mapOf(world);
  saveZones(map.id, [{ id: "aura-mount", spell: "Spirit Guardians", casterId: mount.id, casterKind: "enemy", casterName: mount.displayName, origin: { x: 0, y: 0 }, toward: null, cells: [], concentration: false, castRound: world.encounter().round, untilRound: null, slotLevel: 3, dc: 13 }]);
  const [aura] = liveZones(mapOf(world), world.encounter());
  assert.ok(aura, "setup: the aura does not hold");
  assert.ok(aura.cells.includes(4 * map.width + 12), "the aura of a ridden mount covers no squares");
});

// ---- reach, and a creature looked up by its own id ----

await test("A mount whose rider cannot act still threatens the archer beside the pair.", async () => {
  const { world, hero, rider } = await pair(caster("wizard", "int", ["Fireball"]), { heroAt: 11 });
  assert.equal(characterShootsInMelee(world.encounter().id, hero.id, []), true, "setup: the pair beside the archer does not threaten");
  const kit = await combatKit(world);
  kit.setEnemy(rider.id, { conditions: ["stunned"] });
  assert.equal(characterShootsInMelee(world.encounter().id, hero.id, []), true, "with its rider stunned, the mount beside the archer threatens nobody");
});

await test("A confused creature beside a pair may lash out at the mount as well as the rider.", async () => {
  const { world, hero, mount } = await pair(caster("wizard", "int", ["Fireball"]), { heroAt: 11 });
  // Two creatures in reach, so the die picks: a 1 is the first of them.
  world.dice(1);
  const line = lashOut(world.campaign(), world.encounter(), "sheet", hero.id, hero.name);
  assert.equal(world.clearDice(), 0, `the mount was no creature in reach, so no die picked: ${line}`);
  assert.ok(line.includes(mount.displayName), line);
});

await test("An attack refused for range names the mount among the foes it does reach, and an unknown name is answered with the mount's among those on the board.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { str: 16, dex: 12, con: 14 }, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  await world.beginFight([{ monster: "goblin", mount: "wolf" }, { monster: "goblin" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const mount = world.enemies().find((enemy) => enemy.id === rider.ridesEnemyId);
  const far = world.enemies().find((enemy) => enemy.id !== rider.id && enemy.id !== mount.id);
  await layMap(world, OPEN(), { [hero.id]: { x: 11, y: 4 }, [rider.id]: { x: 12, y: 4 }, [far.id]: { x: 20, y: 4 } });
  holdTurn(world, hero.id);
  world.clearDice();
  const out = await world.invoke("pc_attack", { characterId: hero.id, enemyId: far.id, targetEnemyId: far.id });
  world.clearDice();
  assert.equal(out.ok, false);
  assert.match(out.error, /Within reach: /, out.error);
  assert.ok(out.error.split("Within reach: ")[1].includes(mount.displayName), `the mount beside the attacker is not named as in reach: ${out.error}`);
  const lost = await world.invoke("move_token", { token: "Nobody By That Name", x: 1, y: 1 });
  assert.equal(lost.ok, false);
  assert.ok(lost.error.includes(mount.displayName), `the mount is not among the names the board holds: ${lost.error}`);
});

await test("A creature that Dashes toward a ridden mount by its name walks beside the pair, where the name was refused as nobody on the board.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { str: 16, dex: 12, con: 14 } });
  await world.beginFight([{ monster: "goblin", mount: "wolf" }, { monster: "goblin" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const mount = world.enemies().find((enemy) => enemy.id === rider.ridesEnemyId);
  const far = world.enemies().find((enemy) => enemy.id !== rider.id && enemy.id !== mount.id);
  await layMap(world, OPEN(), { [hero.id]: { x: 2, y: 8 }, [rider.id]: { x: 12, y: 4 }, [far.id]: { x: 20, y: 4 } });
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === far.id), turnBudget: null });
  world.clearDice();
  const out = await world.invoke("take_action", { enemyId: far.id, action: "dash", toward: mount.displayName });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const now = ownToken(world, far.id);
  assert.ok(Math.max(Math.abs(now.x - 12), Math.abs(now.y - 4)) <= 1, `the goblin stopped at (${now.x},${now.y}), not beside the pair`);
});

// ---- what the GM's model and the players' board are told ----

await test("The board written out for the GM's model has a line for the mount, with its own id and conditions, under the letter the pair shares.", async () => {
  const { world, rider, mount } = await pair(caster("wizard", "int", ["Fireball"]));
  const map = mapOf(world);
  const text = serializeMapForPrompt({ ...map, terrain: map.drawnTerrain }, listStandings(map.id), new Map([[mount.id, "prone"]]));
  const line = text.split(NL).find((entry) => entry.startsWith("Combatants: "));
  const entries = line.replace("Combatants: ", "").split("; ");
  const under = entries.find((entry) => entry.includes(`[enemyId=${mount.id}]`));
  const up = entries.find((entry) => entry.includes(`[enemyId=${rider.id}]`));
  assert.ok(under, `the mount has no line among the combatants: ${line}`);
  assert.match(under, /at \(12,4\) \[prone\]$/, under);
  const letter = under.split("=")[0];
  assert.equal(up.split("=")[0], letter, "the pair does not share one letter");
  assert.ok(!up.includes("[prone]"), "the mount's condition was written on its rider");
  // The rows of the grid, their row numbers cut off.
  const grid = text.split(NL).filter((entry) => /^[ 0-9][0-9] \S+$/.test(entry)).map((entry) => entry.slice(3)).join("");
  assert.equal(grid.split(letter).length - 1, 1, `the pair is not drawn once: ${grid}`);
});

// ---- newcomers set down beside a Large pair ----

const squaresOf = (token, size) => Array.from({ length: size * size }, (_, index) => `${token.x + (index % size)},${token.y + Math.floor(index / size)}`);

await test("Reinforcements come in outside the whole space of a pair on a Large mount, and an ogre among them on four open squares of its own.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(caster("wizard", "int", ["Fireball"]));
  await world.beginFight([{ monster: "goblin", mount: "warhorse" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  // In the corner, so every square a step from the pair's corner is the pair's own.
  await layMap(world, OPEN(), { [hero.id]: { x: 20, y: 6 }, [rider.id]: { x: 0, y: 0 } });
  const before = new Set(world.enemies().map((enemy) => enemy.id));
  const out = await world.invoke("add_enemies", { enemies: [{ monster: "goblin" }, { monster: "ogre" }] });
  assert.equal(out.ok, true, out.error);
  const pairSpace = new Set(squaresOf(ownToken(world, rider.id), 2));
  const newcomers = world.enemies().filter((enemy) => !before.has(enemy.id));
  assert.equal(newcomers.length, 2, "setup: the two did not arrive");
  const spaces = newcomers.map((enemy) => squaresOf(ownToken(world, enemy.id), /ogre/i.test(enemy.displayName) ? 2 : 1));
  for (const space of spaces) {
    assert.ok(space.every((square) => !pairSpace.has(square)), `a newcomer at ${space.join(" ")} stands inside the pair's space`);
  }
  assert.ok(spaces[0].every((square) => !spaces[1].includes(square)), `the newcomers overlap: ${spaces.join(" | ")}`);
});

await test("The GM's hand cannot set a token down on a square of a Large pair's space that is not its corner.", async () => {
  const { world, hero } = await pair(caster("wizard", "int", ["Fireball"]), { mount: "warhorse" });
  const heroToken = ownToken(world, hero.id);
  const out = moveTokenFreely(world.campaign(), heroToken.id, 13, 5);
  assert.ok("error" in out, `the hero was set down inside the warhorse's space: ${JSON.stringify(out)}`);
  assert.deepEqual([ownToken(world, hero.id).x, ownToken(world, hero.id).y], [heroToken.x, heroToken.y]);
});

// ---- a character's own mount (issue 1036) ----

await test("A character's independent mount stands under its own sheet on its rider's token: its turn lights the pair's figure, and a blast over the pair burns both.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const paladin = world.addHero(caster("paladin", "cha", ["Find Steed"], [], 5, { speed: 30, maxHp: 60 }));
  const wizard = world.addHero(caster("wizard", "int", ["Fireball"]));
  const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(cast.ok, true, cast.error);
  const steed = world.sheets().find((sheet) => sheet.summon?.spell === "Find Steed");
  const [enemy] = await fightDummies(world, 1, { heroFaces: { [paladin.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [paladin.id]: { x: 12, y: 3 }, [steed.id]: { x: 13, y: 3 }, [wizard.id]: { x: 2, y: 3 }, [enemy.id]: { x: 22, y: 8 } });
  holdTurn(world, paladin.id);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse", controlled: false });
  assert.equal(up.ok, true, up.error);
  const map = mapOf(world);
  assert.equal(ownToken(world, steed.id), null, "setup: the steed kept a token of its own");
  const [under, rider] = listStandings(map.id).filter((token) => token.refId === steed.id || token.refId === paladin.id);
  assert.deepEqual([under.refId, under.kind, rider.refId, under.id], [steed.id, "pc", paladin.id, rider.id]);
  holdTurn(world, steed.id);
  const view = buildPlayerMapView(world.campaignId, world.owner.id, { fullVision: true });
  assert.equal(view.turn?.tokenId, rider.id, "the steed's turn lights no figure on the players' board");
  const before = { steed: world.sheet(steed.id).currentHp, paladin: world.sheet(paladin.id).currentHp };
  holdTurn(world, wizard.id);
  const fire = await world.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fireball", level: 3, atX: rider.x, atY: rider.y });
  world.clearDice();
  assert.equal(fire.ok, true, fire.error);
  assert.ok(world.sheet(paladin.id).currentHp < before.paladin, "the fire missed the rider");
  // A steed the fire drops to 0 is gone from the table.
  const burnt = world.sheet(steed.id);
  assert.ok(!burnt || burnt.currentHp < before.steed, "the fire passed over the steed under its rider");
});

closeTables();
finish();
