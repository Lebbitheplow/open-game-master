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
const { storedRace, raceWords, NPC_RACE_OPTIONS } = await import("../src/lib/npc-race.ts");
const { npcPlaceholder, monsterPlaceholder } = await import("../src/lib/placeholders.ts");
const { listNpcs, createNpcFromDraft, updateNpcFromDraft } = await import("../src/lib/db/npcs.ts");
const { normalizeNpcDraft, draftFrom } = await import("../src/lib/npcs/forge.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { createBattleMap, getBattleMapForEncounter, insertToken } = await import("../src/lib/db/battle-maps.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { castLookup, npcFace } = await import("../src/lib/db/npc-faces.ts");
const { handleSetNpc, npcRosterForPrompt } = await import("../src/lib/dm/social-tools.ts");
const { parseFightRoster } = await import("../src/lib/dm/encounter-template-logic.ts");
const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
const { handleAddEnemies } = await import("../src/lib/dm/encounter-spawn.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");

const BASE = "/assets/placeholders";

// The apps' screens can open an older host, which drops a race unread and
// reads "bandit race elf" as one unknown monster: the race controls and the
// fight line's race words wait for a host that keeps them.
await test("the race controls wait for a host that keeps a race", async () => {
  const fs = await import("node:fs");
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  const { fieldForHost } = await import("../src/lib/dm/catalog-types.ts");
  const { RACE_FIELD } = await import("../src/lib/dm/catalog-world.ts");
  const { COMBAT_ADJUDICATIONS } = await import("../src/lib/dm/catalog-combat.ts");
  assert.equal(SERVER_FEATURES.npcRace, true, "this server keeps a race");
  const older = { story: { configured: true, reachable: true }, utility: { configured: true }, images: { configured: false, reachable: false, backend: "comfyui" }, tts: { configured: false, reachable: false }, stt: { configured: false }, voice: { enabled: false, mode: "off" } };
  assert.equal(hostOffers(older, "npcRace"), false);
  assert.equal(fieldForHost(RACE_FIELD, () => false), null, "no Race in Write an NPC on an older host");
  assert.equal(fieldForHost(RACE_FIELD, () => true), RACE_FIELD);
  for (const name of ["start_encounter", "add_enemies"]) {
    const field = COMBAT_ADJUDICATIONS.find((entry) => entry.name === name).fields.find((entry) => entry.name === "enemies");
    assert.match(fieldForHost(field, () => true).help, /race elf/);
    assert.doesNotMatch(fieldForHost(field, () => false).help, /race/, `${name}'s line says nothing of races on an older host`);
  }
  // A Windows checkout writes CRLF: the pattern below reads the file's lines.
  assert.match(fs.readFileSync(new URL("../src/app/workshop/cast/NpcEditorFields.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"), /const keepsRace = hostOffers\(useCapabilities\(\), "npcRace"\);[\s\S]*\{keepsRace \? \(\n\s+<span className="w-full sm:w-48">\n\s+<Select<string>\n\s+label="Race"/);
});

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
  const reads = (words) => Boolean(storedRace(words));
  assert.deepEqual(parseFightRoster("bandit race elf gender female x4", reads), [{ monster: "bandit", count: 4, race: "elf", gender: "female" }]);
  assert.deepEqual(parseFightRoster("bandit as Raider race half-orc", reads), [{ monster: "bandit", count: 1, name: "Raider", race: "half-orc" }]);
  assert.deepEqual(parseFightRoster("Race Car Golem x2", reads), [{ monster: "Race Car Golem", count: 2 }]);
  // Two words, the longest reading first.
  assert.deepEqual(parseFightRoster("bandit race wood elf x2", reads), [{ monster: "bandit", count: 2, race: "wood elf" }]);
  // A homebrew foe with the word in its name is that foe, not a "Serpent"
  // told to be of the race "Warrior".
  assert.deepEqual(parseFightRoster("Serpent Race Warrior cr 2 x2", reads), [{ monster: "Serpent Race Warrior", count: 2, cr: 2 }]);
});

// Every race of the SRD 5.1, as a GM or the AI would write it, reads as
// its own stored id: the nine and their four subraces, the plain word on
// the subrace the builder lists first.
await test("every SRD 5.1 race and subrace reads as its own id", () => {
  const srd = {
    Dwarf: "hill_dwarf", "Hill Dwarf": "hill_dwarf", "Dwarf (Hill)": "hill_dwarf",
    Elf: "high_elf", "High Elf": "high_elf", "Elf (High)": "high_elf",
    Halfling: "lightfoot_halfling", "Lightfoot Halfling": "lightfoot_halfling",
    Human: "human", Dragonborn: "dragonborn",
    Gnome: "rock_gnome", "Rock Gnome": "rock_gnome",
    "Half-Elf": "half_elf", "half elf": "half_elf", "Half-Orc": "half_orc", Tiefling: "tiefling",
  };
  for (const [told, id] of Object.entries(srd)) assert.equal(storedRace(told), id, told);
});

await test("a band of a people reads as one of them", () => {
  assert.equal(storedRace("elves"), "high_elf");
  assert.equal(storedRace("Wood Elves"), "wood_elf");
  assert.equal(storedRace("half-orcs"), "half_orc");
  assert.equal(storedRace("dwarves"), "hill_dwarf");
  assert.equal(storedRace("gnomes"), "rock_gnome");
  assert.equal(storedRace("Warrior"), "");
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
  // The narrator is told who they are, so it does not call the half-orc
  // the board draws a human.
  assert.equal(npcRosterForPrompt(world.campaignId).find((entry) => entry.name === "Brakka").identity, "Female, Half-Orc");
  assert.equal(raceWords("wood_elf"), "Wood Elf");
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
  const opened = await world.invoke("start_encounter", { enemies: "bandit race elves gender female x2" });
  assert.equal(opened.ok, true, opened.error);
  const added = await world.invoke("add_enemies", { enemies: [{ monster: "bandit", race: "somebody" }] });
  assert.equal(added.ok, true, added.error);
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
  assert.equal(npcFace(castLookup(world.campaignId).byName("Brakka")), `${BASE}/character-race/half-orc-feminine.webp`);
});

await test("a workshop bundle carries an NPC's race out and back in, and one this server does not know reads as unrecorded", () => {
  const shop = createWorkshop(world.owner.id, { title: "Race round trip" }).id;
  createNpcFromDraft(shop, normalizeNpcDraft({ name: "Tamsin", race: "wood_elf", role: "archer", gender: "Female" }).draft);
  const out = exportWorkshopBundle(shop, { name: "Race round trip", blurb: "One elf.", inspiredBy: "Original work" });
  assert.ok(out.bundle, out.error);
  assert.equal(out.bundle.npcs.find((entry) => entry.name === "Tamsin").race, "wood_elf");
  const text = JSON.stringify(out.bundle);
  const read = readBundle(text);
  assert.ok(!("error" in read), read.error);
  const landed = importWorkshopBundle(world.owner.id, read.bundle);
  assert.ok(landed.workshopId, landed.error);
  assert.equal(listNpcs(landed.workshopId).find((entry) => entry.name === "Tamsin").race, "wood_elf");
  const odd = readBundle(text.replace('"race":"wood_elf"', '"race":"starborn"'));
  assert.equal(odd.bundle.npcs.find((entry) => entry.name === "Tamsin").race, "");
});

await test("a weak model's flat call keeps the race and gender, for a start and for reinforcements", async () => {
  await world.invoke("end_encounter", { summary: "The bandits scatter." });
  const campaign = world.campaign();
  const sheets = world.sheets();
  const turn = createDmTurn(world.campaignId, [], "ai");
  const started = applyEncounterCall(campaign, turn, "start_encounter", JSON.stringify({ monster: "bandit", race: "dwarf", gender: "Male" }), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), { realDiceUserIds: new Set(), toolCallId: null });
  assert.equal(started.result.error, undefined, started.result.error);
  assert.deepEqual([world.enemies()[0].race, world.enemies()[0].gender], ["hill_dwarf", "Male"]);
  const added = handleAddEnemies(campaign, JSON.stringify({ monster: "bandit", name: "Lookout", race: "half-orc", gender: "Female" }), sheets);
  assert.equal(added.error, undefined, added.error);
  const lookout = world.enemies().find((enemy) => enemy.displayName === "Lookout");
  assert.deepEqual([lookout.race, lookout.gender], ["half_orc", "Female"]);
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

// An app built before the Race select saves the people panel's form with no
// race at all: that is the race left as it was, not one cleared, or every
// edit from an older app would wipe the face the race picked.
await test("a people-panel save with no race keeps the race, and an empty one clears it", () => {
  const made = normalizeNpcDraft({ name: "Maelis", race: "high_elf", role: "archer", gender: "Female" });
  const row = createNpcFromDraft(world.campaignId, made.draft);
  const older = normalizeNpcDraft({ name: "Maelis", role: "archer", gender: "Female", trait: "keeps the north gate" });
  assert.equal("error" in older, false);
  assert.equal(updateNpcFromDraft(world.campaignId, row.id, older.draft).race, "high_elf", "an older app's save kept the race");
  const cleared = normalizeNpcDraft({ name: "Maelis", role: "archer", gender: "Female", race: "" });
  assert.equal(updateNpcFromDraft(world.campaignId, row.id, cleared.draft).race, "", "a picked blank race clears it");
});

finish();
