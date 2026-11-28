// A server start re-derives every character sheet while the database is
// still opening (src/lib/db/core.ts resyncSheets). The rules it runs read
// the workshop: a workshop species' row for its size, traits and spells, a
// workshop class's table for its features. Issue #1129: the species read
// asked getDatabase for the database that was still opening, which opened
// the file again and ran the whole schema pass again inside the first,
// without end, so a server holding one character of a workshop species never
// answered after its next resync. And the workshop's classes were registered
// only after that first open, so the resync read a workshop class as a class
// with no features and wrote the sheet back without them.
//
// Each boot here is a real new process over the same database, started the
// way the server starts (scripts/lib/boot-server-db.mjs).
//
// The last two hold the same open to its other promises: a schema pass run
// again over a database already open (what a development reload does) is
// one pass, and an open that fails leaves no handle behind.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";

const { createHomebrew } = await import("../src/lib/db/homebrew.ts");
const { workshopClassId } = await import("../src/lib/homebrew/class-data.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { openDatabase } = await import("../src/lib/db/driver.ts");
const { registerSpeciesReader } = await import("../src/lib/srd/race-id.ts");
const { serverSpeciesRules } = await import("../src/lib/characters/species-rules.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const world = await openWorld();
const db = getDatabase();

const species = createHomebrew(world.owner.id, {
  kind: "race",
  name: "Marsh Folk",
  data: {
    desc: "Folk of the reed beds.",
    size: "Small",
    speed: { walk: 30 },
    asi: [{ attributes: ["Dexterity"], value: 2 }],
    languages: ["Common"],
    traits: "**_Reed Step._** You cross a marsh without slowing.",
    spells: { ability: "wis", spells: [{ spell: "Misty Step", level: 3 }] },
    variants: {
      label: "Water",
      options: [{ name: "Brackish", spells: { ability: "wis", spells: [{ spell: "Light", level: 1 }] } }],
    },
  },
});
const klass = createHomebrew(world.owner.id, {
  kind: "class",
  name: "Spellblade",
  data: {
    desc: "A warrior who folds a wizard's spells into the swing of a blade.",
    hitDie: 10,
    saves: ["str", "int"],
    skillChoices: { count: 2, from: ["arcana", "athletics", "history", "perception"] },
    armor: ["light", "medium"],
    weapons: ["simple", "martial"],
    tools: [],
    casterType: "half",
    spellListFrom: "wizard",
    spellAbility: "int",
    subclassLevel: 3,
    levels: {
      1: [{ n: "Arcane Strike", d: "Once a turn, a weapon hit deals an extra 1d8 force damage." }],
      5: [{ n: "Extra Attack", d: "Attack twice when you take the Attack action." }],
    },
  },
});

const raceId = `homebrew:${species.id}`;
const marshFolk = world.addHero({ name: "Sedge", race: raceId, class: "fighter", level: 5 });
const spellblade = world.addHero({ name: "Vane", class: workshopClassId(klass.id), level: 5 });
const human = world.addHero({ name: "Brannoc", class: "fighter", level: 5 });
// A content pack's species is read through the same reader, from the pack.
// CI has no pack, so that hero sits at the table only where one is.
const heroes = [marshFolk, spellblade, human];
if (world.hasPack) {
  heroes.push(world.addHero({ name: "Mirri", race: "catfolk", class: "fighter", level: 5 }));
}

// A handle of the test's own for every read and write below: the last tests
// close the one getDatabase gave out.
function openRaw() {
  const raw = openDatabase(process.env.SQLITE_DB_PATH);
  if (raw.encrypted) {
    raw.pragma("cipher='chacha20'");
    raw.pragma(`key='${process.env.DB_ENCRYPTION_KEY}'`);
  }
  return raw;
}

const stored = (id) =>
  db.prepare("SELECT features_json, resources_json, proficiencies_json FROM character_sheets WHERE id = ?").get(id);
const names = (id) => JSON.parse(stored(id).features_json).map((feature) => feature.name);
const healthy = Object.fromEntries(heroes.map((hero) => [hero.id, stored(hero.id)]));
const resynced = new RegExp(`resynced ${heroes.length} character sheets`);

// A start that never answers is the failure: the boot is given a minute,
// many times what it takes, and killed after it. Returns all it printed.
function boot(env = {}) {
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, "lib", "boot-server-db.mjs")], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: Number(process.env.BOOT_TIMEOUT_MS) || 60_000,
    killSignal: "SIGKILL",
  });
  const printed = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  assert.equal(run.status, 0, run.error ? `the start did not finish: ${run.error.message}\n${printed.slice(-2000)}` : printed.slice(-2000));
  return printed;
}

test("the sheets hold what the workshop gave them", () => {
  assert.ok(names(spellblade.id).includes("Arcane Strike"), JSON.stringify(names(spellblade.id)));
  assert.ok(names(spellblade.id).includes("Extra Attack"));
  assert.match(healthy[marshFolk.id].resources_json, /racial_/, healthy[marshFolk.id].resources_json);
});

test("a server holding a character of a workshop species starts, opening its database once", () => {
  const log = boot();
  assert.match(log, resynced);
  assert.equal(log.match(/resynced \d+ character sheets/g).length, 1, log);
  assert.match(log, /opened the world database 1 time\(s\)/);
});

test("that start leaves every sheet as it was stored", () => {
  for (const hero of heroes) {
    assert.deepEqual(stored(hero.id), healthy[hero.id], hero.name);
  }
});

test("a workshop class's features are regranted by the start, not taken", () => {
  db.prepare("UPDATE character_sheets SET features_json = '[]' WHERE id = ?").run(spellblade.id);
  boot();
  assert.deepEqual(names(spellblade.id), JSON.parse(healthy[spellblade.id].features_json).map((feature) => feature.name));
});

test("a workshop species' free cast keeps the use it spent across a start", () => {
  const resources = JSON.parse(healthy[marshFolk.id].resources_json);
  const counter = Object.keys(resources).find((id) => id.startsWith("racial_"));
  resources[counter] = { ...resources[counter], used: resources[counter].max };
  db.prepare("UPDATE character_sheets SET resources_json = ? WHERE id = ?").run(JSON.stringify(resources), marshFolk.id);
  boot();
  assert.deepEqual(JSON.parse(stored(marshFolk.id).resources_json)[counter], resources[counter]);
});

test("a production start resyncs once, then skips the pass on the next start", () => {
  const production = { NODE_ENV: "production", ODM_BUILD_TIME: "build-1", ODM_BUILD_COMMIT: "abc" };
  assert.match(boot(production), resynced);
  assert.doesNotMatch(boot(production), /resynced/);
});

test("a sheet the start cannot re-derive stays as stored, and the log says so", () => {
  const abilities = db.prepare("SELECT abilities_json FROM character_sheets WHERE id = ?").get(human.id).abilities_json;
  const set = db.prepare("UPDATE character_sheets SET abilities_json = ? WHERE id = ?");
  set.run("{ not json", human.id);
  try {
    assert.match(boot(), /1 character sheets could not be re-derived and stay as stored/);
    assert.deepEqual(stored(human.id), healthy[human.id]);
  } finally {
    set.run(abilities, human.id);
  }
  assert.doesNotMatch(boot(), /could not be re-derived/);
});

// A development reload loads the database module again while the database
// stays open: the new copy runs the schema pass over the open handle, and a
// rule that asks it for the database mid-pass must be handed that handle,
// not sent through the pass again.
await (async () => {
  const reloaded = await import("../src/lib/db/core.ts?reloaded");
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  registerSpeciesReader((raceId) => {
    assert.equal(reloaded.getDatabase(), db);
    return serverSpeciesRules(raceId);
  });
  try {
    assert.equal(reloaded.getDatabase(), db);
  } finally {
    console.log = log;
    registerSpeciesReader(serverSpeciesRules);
  }
  test("a schema pass over a database already open runs once, whatever asks for the database inside it", () => {
    assert.equal(lines.filter((line) => /resynced \d+ character sheets/.test(line)).length, 1, lines.join("\n"));
  });
})();

// A schema pass that fails: messages turned into a view, which the pass
// cannot index. Each failed open used to leave its handle open, three files
// a call, until the process had none left to give.
test("an open that fails leaves no handle on the file, and the next open works once the fault is gone", () => {
  db.pragma("foreign_keys = OFF");
  db.exec("ALTER TABLE messages RENAME TO messages_kept; CREATE VIEW messages AS SELECT * FROM messages_kept;");
  db.close();
  globalThis.__localRoleplayDb = undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.throws(() => getDatabase(), /views may not be indexed/);
  }
  // Linux lists a process's open files; elsewhere the repair below is the
  // check (Windows will not rename a table under an open handle's lock).
  if (fs.existsSync("/proc/self/fd")) {
    const held = fs.readdirSync("/proc/self/fd").filter((fd) => {
      try {
        return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(process.env.SQLITE_DB_PATH);
      } catch {
        return false;
      }
    });
    assert.equal(held.length, 0, `${held.length} handles left open`);
  }
  const raw = openRaw();
  raw.pragma("foreign_keys = OFF");
  raw.exec("DROP VIEW messages; ALTER TABLE messages_kept RENAME TO messages;");
  raw.close();
  assert.ok(getDatabase().prepare("SELECT COUNT(*) AS n FROM character_sheets").get().n >= 3);
});

world.close();
console.log(`\n${passed} boot-workshop-sheets tests passed.`);
