// The light off the board comes from the place's scene, the fixed kind the
// location tools store as its bed: a crypt is dark at noon and a tavern lit
// at midnight whatever language the place is named in. A place whose scene
// does not settle it is read by its English words at an English table only
// (the places written before there was a scene, and the moves made without
// one), and is otherwise left for the DM to name (src/lib/dm/notice-logic.ts
// PLACE_KIND_OF_SCENE and englishPlaceKind, place-light.ts).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-place-light-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { PLACE_KIND_OF_SCENE, offBoardLight } = await import("../src/lib/dm/notice-logic.ts");
const { offBoardAmbient } = await import("../src/lib/dm/place-light.ts");
const { sceneIds } = await import("../src/lib/ambience/catalog.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, updateGameSettings } = await import("../src/lib/db/campaigns.ts");
const { getClock, setClockInstant } = await import("../src/lib/db/clock.ts");
const { setLocationLinks, upsertCurrentLocation } = await import("../src/lib/db/locations.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });

const atHour = (hour) => {
  const day = Math.floor(getClock(campaign.id).instant / 1440) + 1;
  setClockInstant(campaign.id, day * 1440 + hour * 60);
};
const goTo = (name, scene) => {
  const place = upsertCurrentLocation({ campaignId: campaign.id, name });
  if (scene !== undefined) {
    setLocationLinks(place.id, { ambience: scene === null ? null : { bed: scene, music: "" } });
  }
};

// The same places in five table languages: only the scene decides.
const PLACES = {
  crypt: ["The Kings' Crypt", "Cripta dei Re", "La Crypte des Rois", "La Cripta de los Reyes", "Die Königsgruft"],
  tavern: ["The Gilded Goose", "Locanda dell'Oca d'Oro", "L'Auberge de l'Oie Dorée", "La Posada del Ganso Dorado", "Gasthaus zur Goldenen Gans"],
  forest: ["The Old Wood", "Il Bosco Antico", "La Vieille Forêt", "El Bosque Viejo", "Der Alte Wald"],
};

test("every scene the location tools offer is mapped to a place kind or to none, so a new bed is decided before it ships", () => {
  assert.deepEqual(Object.keys(PLACE_KIND_OF_SCENE).sort(), [...sceneIds()].sort());
});

test("a crypt is dark at noon, in every language its name is written in", () => {
  atHour(12);
  for (const name of PLACES.crypt) {
    goTo(name, "crypt");
    assert.equal(offBoardAmbient(campaign.id), "dark", name);
  }
});

test("a tavern is lit at midnight, in every language", () => {
  atHour(0);
  for (const name of PLACES.tavern) {
    goTo(name, "tavern");
    assert.equal(offBoardAmbient(campaign.id), "bright", name);
  }
});

test("a forest follows the hour: bright at noon, dim at dusk, dark at midnight, in every language", () => {
  for (const name of PLACES.forest) {
    goTo(name, "forest");
    atHour(12);
    assert.equal(offBoardAmbient(campaign.id), "bright", name);
    atHour(20);
    assert.equal(offBoardAmbient(campaign.id), "dim", name);
    atHour(23);
    assert.equal(offBoardAmbient(campaign.id), "dark", name);
  }
});

const speaking = (tableLanguage) => updateGameSettings(campaign.id, { tableLanguage });

test("at an English table a place with no scene is still read by its English words, as every place was before the scene", () => {
  speaking("english");
  atHour(12);
  for (const name of ["The Sunken Crypt", "Goblin Cave"]) {
    goTo(name, null);
    assert.equal(offBoardAmbient(campaign.id), "dark", name);
  }
  atHour(0);
  goTo("The Prancing Pony Inn", null);
  assert.equal(offBoardAmbient(campaign.id), "bright");
  goTo("The King's Road", null);
  assert.equal(offBoardAmbient(campaign.id), "dark");
  // A place its words do not settle is left to the DM.
  goTo("Thornfield", null);
  assert.equal(offBoardAmbient(campaign.id), null);
  // The scene wins over the words wherever it settles the light.
  goTo("The Crypt", "tavern");
  assert.equal(offBoardAmbient(campaign.id), "bright");
});

test("at a table in another language a place with no scene gives no light shift, whatever words its name holds", () => {
  atHour(12);
  for (const tableLanguage of ["italian", "french", "spanish", "german"]) {
    speaking(tableLanguage);
    for (const name of ["The Sunken Crypt", "Goblin Cave", ...PLACES.crypt]) {
      goTo(name, null);
      assert.equal(offBoardAmbient(campaign.id), null, `${tableLanguage}: ${name}`);
    }
  }
  speaking("english");
});

test("a scene that does not settle the light (a crowd, underwater, arcane) leaves it to the DM, or at an English table to the place's words", () => {
  atHour(12);
  for (const scene of ["crowd", "underwater", "arcane"]) {
    speaking("italian");
    goTo(`Somewhere ${scene}`, scene);
    assert.equal(offBoardAmbient(campaign.id), null, scene);
    speaking("english");
    goTo(`Somewhere ${scene}`, scene);
    assert.equal(offBoardAmbient(campaign.id), null, scene);
    goTo(`The ${scene} cellar`, scene);
    assert.equal(offBoardAmbient(campaign.id), "dark", scene);
  }
});

test("a light the DM names wins over the scene", () => {
  atHour(12);
  goTo("Cripta dei Re", "crypt");
  assert.equal(offBoardAmbient(campaign.id, "bright"), "bright");
  assert.equal(offBoardAmbient(campaign.id, "dim"), "dim");
});

test("a prepared map's open sky wins over the scene; a roofed map with no scene is lit", () => {
  assert.equal(offBoardLight({ hour: 12, place: { scene: "crypt", outdoors: true } }), "bright");
  assert.equal(offBoardLight({ hour: 23, place: { scene: "tavern", outdoors: true } }), "dark");
  assert.equal(offBoardLight({ hour: 23, place: { scene: null, outdoors: false } }), "bright");
  assert.equal(offBoardLight({ hour: 12, place: { scene: "cave", outdoors: false } }), "dark");
});

test("with no place recorded the party is under the sky, as before", () => {
  assert.equal(offBoardLight({ hour: 12, place: null }), "bright");
  assert.equal(offBoardLight({ hour: 23, place: null }), "dark");
});

process.chdir(os.tmpdir());
removeTempDir(dir);
console.log(`place light: ${passed} passed`);
