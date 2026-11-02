// The enemy NPC plates painted per race and presentation (PR 710,
// public/assets/placeholders/enemy-npc/) are drawn only when a race is
// recorded, and nothing recorded one: NPCs had no race and a foe from
// start_encounter had none either, so every bandit stayed the one bandit.
// An NPC now has a race (set_npc, the console, the NPC form, bundles), a
// nameless foe takes a race and a gender from start_encounter, a Cast NPC
// fighting draws from their own record, and an ally the GM puts on the
// board or into the order draws the face the Cast gives them.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-npc-race-faces");
const { storedRace, NPC_RACE_OPTIONS } = await import("../src/lib/npc-race.ts");
const { npcPlaceholder, monsterPlaceholder } = await import("../src/lib/placeholders.ts");
const { listNpcs, createNpcFromDraft } = await import("../src/lib/db/npcs.ts");
const { normalizeNpcDraft, draftFrom } = await import("../src/lib/npcs/forge.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { createBattleMap, getBattleMapForEncounter, insertToken } = await import("../src/lib/db/battle-maps.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { trackedNpcFace } = await import("../src/lib/db/npc-faces.ts");
const { handleSetNpc } = await import("../src/lib/dm/social-tools.ts");
const { parseFightRoster } = await import("../src/lib/dm/encounter-template-logic.ts");

const BASE = "/assets/placeholders";

await test("a race is stored as its SRD id, read from an id, a name or the plain word, and never guessed", () => {
  assert.equal(storedRace("half_orc"), "half_orc");
  assert.equal(storedRace("Half-Orc"), "half_orc");
  assert.equal(storedRace("Elf (Wood)"), "wood_elf");
  assert.equal(storedRace("wood elf"), "wood_elf");
  assert.equal(storedRace("Elf"), "high_elf", "the plain word is the people's first subrace");
  assert.equal(storedRace("dwarf"), "hill_dwarf");
  assert.equal(storedRace("Unknown"), "");
  assert.equal(storedRace("lizard-man"), "", "a people the list does not have is not recorded as a near one");
  assert.equal(storedRace(undefined), "");
  assert.ok(NPC_RACE_OPTIONS.some((option) => option.value === "tiefling"));
});

await test("an NPC's face reads their role, then their race and presentation, and keeps the old faces otherwise", () => {
  assert.equal(npcPlaceholder("merchant", "Ana", { race: "high_elf" }), `${BASE}/npc/merchant.webp`, "a role plate still wins");
  assert.equal(npcPlaceholder("bandit", "Ana", { race: "wood_elf", gender: "Female" }), `${BASE}/enemy-npc/bandit-elf-feminine.webp`);
  assert.equal(npcPlaceholder("archer", "Ana", { race: "hill_dwarf", gender: "Male" }), `${BASE}/enemy-npc/archer-dwarf-masculine.webp`);
  assert.equal(npcPlaceholder("bandit", "Ana"), `${BASE}/monster/bandit.webp`, "no race: the role token, as before");
  assert.equal(npcPlaceholder("", "Ana", { race: "half_orc", gender: "Female" }), `${BASE}/character-race/half-orc-feminine.webp`);
  assert.equal(npcPlaceholder("", "Ana"), npcPlaceholder(null, "Ana"), "nothing recorded: the face by name, as before");
});

await test("a console fight line carries a race and a gender, and a monster's own name is left whole", () => {
  assert.deepEqual(parseFightRoster("bandit race elf gender female x4"), [{ monster: "bandit", count: 4, race: "elf", gender: "female" }]);
  assert.deepEqual(parseFightRoster("bandit as Raider race half-orc"), [{ monster: "bandit", count: 1, name: "Raider", race: "half-orc" }]);
  assert.deepEqual(parseFightRoster("Race Car Golem x2"), [{ monster: "Race Car Golem", count: 2 }]);
});

await test("the fight view's race and gender pick the bandit plate for that race", () => {
  const look = { slug: "bandit", name: "Bandit", race: "half_orc", gender: "Nonbinary" };
  assert.equal(monsterPlaceholder("humanoid", look), `${BASE}/enemy-npc/bandit-half-orc-neutral.webp`);
});

const world = await openWorld();
world.addHero({ class: "fighter", level: 3, maxHp: 28 });
const npc = (name) => listNpcs(world.campaignId).find((entry) => entry.name === name);

await test("set_npc records a race, keeps it when a later call leaves it out, and says so when it cannot read one", async () => {
  const written = await world.invoke("set_npc", { name: "Brakka", gender: "Female", race: "Half-Orc" });
  assert.equal(written.ok, true, written.error);
  assert.equal(npc("Brakka").race, "half_orc");
  await world.invoke("set_npc", { name: "Brakka", attitude: "friendly", race: "Unknown" });
  assert.equal(npc("Brakka").race, "half_orc", "a later call without one, or with Unknown, never clears it");
  // The AI GM's own call, which a free word reaches; the console's Race is a
  // select, and refuses a value outside it as every select does.
  const odd = handleSetNpc(world.campaign(), JSON.stringify({ name: "Sss'thar", gender: "Male", race: "lizard-man" }));
  assert.equal(odd.ok, true, "an unreadable race never refuses the NPC");
  assert.match(odd.note, /not a race the server knows/);
  assert.equal(npc("Sss'thar").race, "");
});

await test("the NPC form's draft carries the race, and one the server does not know reads as unrecorded", () => {
  const made = normalizeNpcDraft({ name: "Ilya", race: "wood_elf", role: "archer" });
  assert.ok("draft" in made, made.error);
  assert.equal(made.draft.race, "wood_elf");
  const row = createNpcFromDraft(world.campaignId, made.draft);
  assert.equal(row.race, "wood_elf");
  assert.equal(draftFrom(row).race, "wood_elf");
  const odd = normalizeNpcDraft({ name: "Odd", race: "starborn" });
  assert.equal(odd.draft.race, "");
});

await test("start_encounter gives nameless foes the race and gender it was told, and the fight view carries them", async () => {
  // The console's lines, as a human GM types them.
  const opened = await world.invoke("start_encounter", { enemies: "bandit race elf gender female x2\nbandit race somebody" });
  assert.equal(opened.ok, true, opened.error);
  const rows = world.enemies();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(0, 2).map((row) => [row.race, row.gender]), [["high_elf", "Female"], ["high_elf", "Female"]]);
  assert.equal(rows[2].race, undefined, "a race the server cannot read leaves the face as it was, never the fight refused");
  const shown = activePublicEncounter(world.campaignId).enemies;
  assert.deepEqual([shown[0].race, shown[0].gender], ["high_elf", "Female"]);
  assert.equal(monsterPlaceholder(shown[0].type, { slug: shown[0].slug, name: shown[0].name, race: shown[0].race, gender: shown[0].gender }), `${BASE}/enemy-npc/bandit-elf-feminine.webp`);
  assert.equal(shown[2].race, undefined);
});

await test("an ally the GM puts on the board draws the face the Cast gives them; a stranger keeps a face by name", async () => {
  const encounter = world.encounter();
  const map =
    getBattleMapForEncounter(encounter.id) ??
    createBattleMap({ campaignId: world.campaignId, encounterId: encounter.id, width: 6, height: 6, terrain: ".".repeat(36), ambient: "dark", theme: "dungeon", lights: [], seed: 1 });
  insertToken({ mapId: map.id, campaignId: world.campaignId, kind: "npc", refId: "ally-ilya", name: "Ilya", x: 0, y: 0 });
  insertToken({ mapId: map.id, campaignId: world.campaignId, kind: "npc", refId: "ally-nobody", name: "A Passer-by", x: 1, y: 0 });
  const view = buildPlayerMapView(world.campaignId, world.owner.id, { fullVision: true });
  const tokens = new Map(view.tokens.map((token) => [token.refId, token]));
  assert.equal(tokens.get("ally-ilya").face, `${BASE}/enemy-npc/archer-elf-neutral.webp`);
  assert.equal(tokens.get("ally-nobody").face, undefined);
  assert.equal(trackedNpcFace(world.campaignId, { name: "Brakka" }), `${BASE}/character-race/half-orc-feminine.webp`);
});

await test("a Cast NPC fighting draws from their own record, so an edit there shows at once", async () => {
  await world.invoke("end_encounter", { summary: "The bandits scatter." });
  const made = normalizeNpcDraft({ name: "Grell", role: "bandit", gender: "Male", race: "hill_dwarf", statBlock: "bandit" });
  createNpcFromDraft(world.campaignId, made.draft);
  const opened = await world.invoke("start_encounter", { enemies: [{ monster: "Grell", race: "elf" }] });
  assert.equal(opened.ok, true, opened.error);
  const shown = activePublicEncounter(world.campaignId).enemies.find((enemy) => enemy.name === "Grell");
  assert.deepEqual([shown.race, shown.gender], ["hill_dwarf", "Male"], "the record wins over the call");
  await world.invoke("set_npc", { name: "Grell", race: "Half-Orc" });
  const again = activePublicEncounter(world.campaignId).enemies.find((enemy) => enemy.name === "Grell");
  assert.equal(again.race, "half_orc", "a race the story corrects shows on the foe in the running fight");
});

finish();
