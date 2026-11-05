// One look per figure on the board (src/lib/actor-sex-logic.ts): the
// gender its flat face reads is the gender a 3D board view's model reads,
// so the two never disagree. PR 745 gave the 3D view a `sex` and PR 747
// gave foes a `gender` for their plates; they are one stored gender and a
// derived sex. A nameless foe told none gets a pick from its own row id,
// stored when it arrives, so it survives a rename, damage, a new form and a
// return; a Cast NPC's look is the Cast's, read live; a hand-placed figure
// is the Cast NPC of that name, else a stranger with a pick from its ref.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-actor-sex");
const world = await openWorld();
const kit = await combatKit(world);
const { getEnemy, renameEnemy, patchEnemyHp, insertEnemy } = await import("../src/lib/db/encounters.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { handleAddEnemies } = await import("../src/lib/dm/encounter-spawn.ts");
const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { writeEnemyForm } = await import("../src/lib/db/enemy-form.ts");
const { upsertNpc, createNpcFromDraft } = await import("../src/lib/db/npcs.ts");
const { normalizeNpcDraft } = await import("../src/lib/npcs/forge.ts");
const { insertToken } = await import("../src/lib/db/battle-maps.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { addAdhocToken } = await import("../src/lib/dm/board.ts");
const { boardSnapshot } = await import("../src/lib/addons/board-bridge.ts");
const { pickedGender, foeLook } = await import("../src/lib/actor-sex-logic.ts");
const { monsterPlaceholder } = await import("../src/lib/placeholders.ts");
const { startEncounterTool } = await import("../src/lib/dm/encounter-tool-defs.ts");
const { addEnemiesTool } = await import("../src/lib/dm/encounter-spawn.ts");

world.addHero({ class: "fighter", level: 5, proficiencies: TRAINED });
await world.beginFight([
  { monster: "bandit", name: "Woman", gender: "Female", cr: 0.125 },
  { monster: "bandit", name: "Man", gender: "Male", cr: 0.125 },
  { monster: "bandit", count: 3, cr: 0.125 },
]);
kit.openField();
const enemies = world.enemies();
const view = () => buildPlayerMapView(world.campaignId, world.owner.id, { fullVision: true });
const tokenOf = (predicate) => view().tokens.find(predicate);

await test("the pick is stable from a saved id, and a squad of them varies", () => {
  assert.equal(new Set(Array.from({ length: 16 }, (_, i) => pickedGender(`actor-${i}`))).size, 2);
  assert.equal(pickedGender("same"), pickedGender("same"));
  assert.deepEqual(foeLook({ id: "a", gender: "Nonbinary" }, null), { race: "", gender: "Nonbinary" });
  assert.deepEqual(foeLook({ id: "a", race: "half_orc" }, null), { race: "half_orc", gender: pickedGender("a") });
  assert.deepEqual(foeLook({ id: "a", gender: "Male" }, { race: "high_elf", gender: "" }), { race: "high_elf", gender: "" }, "a Cast NPC's record, unrecorded or not");
});

await test("one gender argument, the app's own words, and no second one for the same thing", () => {
  for (const tool of [startEncounterTool, addEnemiesTool]) {
    const item = tool.function.parameters.properties.enemies.items.properties;
    assert.deepEqual(item.gender.enum, ["Female", "Male", "Nonbinary"]);
    assert.equal(item.sex, undefined, `${tool.function.name} takes no sex beside gender`);
  }
});

await test("a nameless foe keeps the gender it was told, or a pick from its own row id, never its name", () => {
  assert.equal(enemies[0].gender, "Female");
  assert.equal(enemies[1].gender, "Male");
  const unnamed = enemies.slice(2);
  assert.equal(new Set(unnamed.map((enemy) => enemy.slug)).size, 1, "three of one kind, told nothing");
  for (const enemy of unnamed) assert.equal(enemy.gender, pickedGender(enemy.id), "each keyed on its own id");
  assert.equal(enemies[0].stats.sex, undefined, "nothing rides in the stat block a new form replaces");
});

await test("the look survives reload, renaming, damage and a new form", () => {
  const enemy = enemies[2];
  renameEnemy(enemy.id, "Renamed");
  patchEnemyHp(enemy.id, Math.max(1, enemy.currentHp - 1), "alive");
  writeEnemyForm(enemy.id, { ...enemy.stats, ac: 15 });
  assert.equal(getEnemy(enemy.id).gender, enemy.gender);
  assert.equal(tokenOf((token) => token.refId === enemy.id).sex, enemy.gender);
});

await test("a foe's flat face and its 3D model read one gender", () => {
  // Raced, so its plate has a presentation to compare.
  const shown = activePublicEncounter(world.campaignId).enemies;
  const snap = boardSnapshot(view(), "combat-tabletop", { canDirect: true, appearance: "miniatures" });
  for (const enemy of shown) {
    const face = monsterPlaceholder(enemy.type, { slug: enemy.slug, name: enemy.name, race: "human", gender: enemy.gender });
    const sex = snap.tokens.find((token) => token.kind === "enemy" && view().tokens.find((t) => t.id === token.id)?.refId === enemy.id)?.sex;
    const presentation = /-(masculine|feminine|neutral)\.webp$/.exec(face)?.[1];
    assert.equal(presentation, sex === "Female" ? "feminine" : sex === "Male" ? "masculine" : "neutral", `${enemy.name}: ${face} against ${sex}`);
  }
});

// The kit's walls and the fight's foes stand where they were put, and one of
// them on a square asked for here refused the figure about one run in ten:
// a figure takes the first open square from the one it asks for.
function placeFigure(input) {
  const board = kit.map();
  const squares = board.width * board.height;
  for (let step = 0; step < squares; step += 1) {
    const at = (input.y * board.width + input.x + step) % squares;
    const placed = addAdhocToken(world.campaign(), { ...input, x: at % board.width, y: Math.floor(at / board.width) });
    if (placed.ok) {
      return placed;
    }
  }
  return { error: `no open square for ${input.name}` };
}

await test("figures on the board carry the Cast's gender, a stranger its own pick, and nothing hidden reaches a player", () => {
  upsertNpc({ campaignId: world.campaignId, name: "Scout Ada", gender: "Female" });
  upsertNpc({ campaignId: world.campaignId, name: "Scout Ben", gender: "Male" });
  upsertNpc({ campaignId: world.campaignId, name: "Scout Ari" });
  for (const [index, name] of ["Scout Ada", "Scout Ben", "Scout Ari", "Passer-by"].entries()) {
    assert.equal(placeFigure({ kind: "npc", name, x: 2 + index, y: 2 }).ok, true);
  }
  assert.equal(placeFigure({ kind: "npc", name: "Secret", x: 8, y: 8, hidden: true }).ok, true);
  assert.equal(placeFigure({ kind: "prop", name: "Crate", x: 7, y: 7 }).ok, true);
  const snap = boardSnapshot(view(), "combat-tabletop", { canDirect: true, appearance: "miniatures" });
  const sexOf = (name) => snap.tokens.find((token) => token.name === name);
  assert.equal(sexOf("Scout Ada").sex, "Female");
  assert.equal(sexOf("Scout Ben").sex, "Male");
  assert.equal(Object.hasOwn(sexOf("Scout Ari"), "sex"), false, "a Cast NPC whose gender is not recorded is not guessed");
  const stranger = view().tokens.find((token) => token.name === "Passer-by");
  assert.equal(stranger.sex, pickedGender(stranger.refId));
  assert.equal(Object.hasOwn(sexOf("Crate"), "sex"), false, "props have none");
  const player = buildPlayerMapView(world.campaignId, world.owner.id);
  assert(!player.tokens.some((token) => token.name === "Secret"), "a hidden figure never reaches a player's projection");
});

await test("a figure the GM puts on the board is the Cast NPC of that whole name", () => {
  // The board's own placement: an ad hoc ref (npc:<uuid>), never an NPC id.
  assert.equal(placeFigure({ kind: "npc", name: "Corin Vale", x: 6, y: 3 }).ok, true);
  const ref = tokenOf((token) => token.name === "Corin Vale").refId;
  const told = pickedGender(ref) === "Female" ? "Male" : "Female";
  upsertNpc({ campaignId: world.campaignId, name: "Corin Vale", gender: told });
  assert.equal(tokenOf((token) => token.name === "Corin Vale").sex, told);
});

await test("someone recorded as nonbinary is drawn with the ordinary model and the neutral face", async () => {
  const npc = upsertNpc({ campaignId: world.campaignId, name: "Sable", gender: "Nonbinary" });
  assert.equal(placeFigure({ kind: "npc", name: "Sable", x: 7, y: 3 }).ok, true);
  assert.equal(Object.hasOwn(tokenOf((token) => token.name === "Sable"), "sex"), false);
  const cast = insertEnemy({ campaignId: world.campaignId, encounterId: world.encounter().id, slug: "bandit", displayName: npc.name, initiative: 1, stats: enemies[0].stats, npcId: npc.id });
  insertToken({ mapId: kit.map().id, campaignId: world.campaignId, kind: "enemy", refId: cast.id, name: npc.name, x: 8, y: 3 });
  assert.equal(Object.hasOwn(tokenOf((token) => token.refId === cast.id), "sex"), false);
  const added = await world.invoke("add_enemies", { enemies: [{ monster: "bandit", name: "Told", gender: "Nonbinary" }] });
  assert.equal(added.ok, true, added.error);
  const told = world.enemies().find((enemy) => enemy.displayName === "Told");
  assert.equal(told.gender, "Nonbinary");
  assert.equal(Object.hasOwn(tokenOf((token) => token.refId === told.id) ?? {}, "sex"), false);
});

await test("a gender the server cannot read never refuses the fight; the foe takes its own pick", async () => {
  const added = await world.invoke("add_enemies", { enemies: [{ monster: "bandit", name: "Odd", gender: "invalid" }] });
  assert.equal(added.ok, true, added.error);
  const odd = world.enemies().find((enemy) => enemy.displayName === "Odd");
  assert.equal(odd.gender, pickedGender(odd.id));
});

await test("new and older returning foes keep their look in a later fight", async () => {
  const original = enemies[1];
  const legacy = enemies[3];
  // A row written before the column: the board drew it with its id's pick.
  getDatabase().prepare("UPDATE encounter_enemies SET gender = '' WHERE id = ?").run(legacy.id);
  assert.equal(tokenOf((token) => token.refId === legacy.id).sex, pickedGender(legacy.id));
  await kit.endFight();
  await world.beginFight([{ monster: "bandit", returning: original.id }, { monster: "bandit", returning: legacy.id }]);
  const back = world.enemies();
  assert.equal(back.find((enemy) => enemy.carriedFrom === original.id).gender, "Male");
  assert.equal(back.find((enemy) => enemy.carriedFrom === legacy.id).gender, pickedGender(legacy.id));
});

await test("a Cast NPC's gender recorded after their first fight shows in that fight and the next", async () => {
  await kit.endFight();
  const draft = normalizeNpcDraft({ name: "Cast raider", gender: "", statBlock: "bandit" });
  const npc = createNpcFromDraft(world.campaignId, draft.draft);
  await world.beginFight([{ monster: npc.name, gender: "Female" }]);
  kit.openField();
  const first = world.enemies()[0];
  assert.equal(first.npcId, npc.id);
  const foe = () => tokenOf((token) => token.kind === "enemy");
  assert.equal(Object.hasOwn(foe(), "sex"), false, "the Cast says nothing yet, and a call does not speak for it");
  upsertNpc({ campaignId: world.campaignId, name: npc.name, gender: "Male" });
  assert.equal(foe().sex, "Male", "the running fight follows the record");
  assert.equal(activePublicEncounter(world.campaignId).enemies[0].gender, "Male", "and so does the flat face");
  await kit.endFight();
  await world.beginFight([{ monster: npc.name }]);
  kit.openField();
  assert.equal(world.enemies()[0].carriedFrom, first.id);
  assert.equal(foe().sex, "Male");
});

await test("a weak model's flat call keeps the gender for a start and for reinforcements", async () => {
  await kit.endFight();
  const campaign = world.campaign();
  const sheets = world.sheets();
  const turn = createDmTurn(world.campaignId, [], "ai");
  const started = applyEncounterCall(campaign, turn, "start_encounter", JSON.stringify({ monster: "bandit", gender: "Female", cr: 0.125 }), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), { realDiceUserIds: new Set(), toolCallId: null });
  assert.equal(started.result.error, undefined);
  assert.equal(world.enemies()[0].gender, "Female");
  const added = handleAddEnemies(campaign, JSON.stringify({ monster: "bandit", name: "Another", gender: "Male", cr: 0.125 }), sheets);
  assert.equal(added.error, undefined);
  assert.equal(world.enemies().find((enemy) => enemy.displayName === "Another").gender, "Male");
});

await kit.endFight();
world.close();
finish();
