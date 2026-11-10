// The turn journal (src/lib/db/turn-journal.ts): every write a GM turn makes
// to the table's state is kept with the turn by the database's own
// triggers, whatever code wrote it, so "Revert this turn" takes back exactly
// what the turn did and nothing else.
//
// The guard: a table nobody classed is journaled (the safe default), a
// classed name the schema no longer has fails here, a journaled table with
// no primary key (no trigger can name its rows) fails here, and a raw write
// under a turn, one no helper wrote, comes back with the revert. Run again
// with the built-in engine (node:sqlite, the Android app's) as a child.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { revertTurn } from "./lib/sweep-lifecycle.mjs";
import { stage } from "./lib/sweep-lifecycle-stage.mjs";

const child = process.argv.includes("--engine-child");
const { test, finish } = suite(child ? "test-turn-journal (node:sqlite)" : "test-turn-journal");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { RECORD_TABLES, OWN_REVERT_TABLES, OUTSIDE_TABLES, journaledTables } = await import("../src/lib/db/turn-journal.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { planRowsRevert } = await import("../src/lib/dm/turn-rows-logic.ts");

const db = () => getDatabase();
const tableNames = () => db().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((row) => row.name);
const kept = (turnId) => db().prepare(`SELECT tbl, row_id, before_json FROM turn_rows WHERE turn_id = ?`).all(turnId);

// A turn of the console's, run by hand: what the work inside writes is the
// turn's.
async function inTurn(world, fn) {
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => fn());
  return turn.id;
}

function npc(world, name) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db()
    .prepare(`INSERT INTO npcs (id, campaign_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, world.campaignId, name, now, now);
  return id;
}

if (!child) {
  await test("every classed table is in the schema, and every journaled one has its three triggers", async () => {
    await stage("calm");
    const names = new Set(tableNames());
    const classed = [...Object.keys(RECORD_TABLES), ...Object.keys(OWN_REVERT_TABLES), ...Object.keys(OUTSIDE_TABLES)];
    assert.deepEqual(classed.filter((name) => !names.has(name)), [], "a classed table the schema no longer has: drop it from turn-journal.ts");
    assert.equal(new Set(classed).size, classed.length, "a table classed twice");
    const triggers = new Set(db().prepare(`SELECT name FROM sqlite_temp_master WHERE type = 'trigger'`).all().map((row) => row.name));
    const missing = journaledTables([...names]).flatMap((table) =>
      ["u", "d", "i"].filter((kind) => !triggers.has(`odm_tj_${kind}_${table}`)).map((kind) => `${table} (${kind})`),
    );
    assert.deepEqual(missing, [], "a journaled table no trigger keeps (it needs a primary key, or a class with a reason in turn-journal.ts)");
    for (const table of ["character_sheets", "campaigns", "npcs", "relationships", "quests", "character_events", "encounters"]) {
      assert.ok(journaledTables([...names]).includes(table), `${table} is journaled`);
    }
  });
}

await test("a raw write under a turn is kept and taken back; outside every turn nothing is kept", async () => {
  const { world } = await stage("calm");
  const count = () => db().prepare(`SELECT COUNT(*) AS n FROM turn_rows`).get().n;
  const was = count();
  const id = npc(world, "Old Marta");
  db().prepare(`UPDATE npcs SET name = 'Marta the Elder' WHERE id = ?`).run(id);
  assert.equal(count(), was, "no turn, nothing kept");
  const turnId = await inTurn(world, () => {
    db().prepare(`UPDATE npcs SET name = 'Marta the Witch' WHERE id = ?`).run(id);
    db().prepare(`UPDATE npcs SET name = 'Marta the Queen' WHERE id = ?`).run(id);
  });
  const rows = kept(turnId);
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].before_json).name, "Marta the Elder", "the first image wins");
  const out = await revertTurn(world, turnId);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(db().prepare(`SELECT name FROM npcs WHERE id = ?`).get(id).name, "Marta the Elder");
});

await test("an INSERT OR REPLACE under a turn keeps the row it replaced, and a row the turn made goes", async () => {
  const { world } = await stage("calm");
  const id = npc(world, "Brannoc");
  const turnId = await inTurn(world, () => {
    const row = db().prepare(`SELECT * FROM npcs WHERE id = ?`).get(id);
    const columns = Object.keys(row);
    const replace = db().prepare(`INSERT OR REPLACE INTO npcs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
    replace.run(...columns.map((column) => (column === "name" ? "Brannoc the Bold" : row[column])));
    replace.run(...columns.map((column) => (column === "name" ? "Brannoc the Lost" : row[column])));
    npc(world, "A stranger");
  });
  assert.equal(JSON.parse(kept(turnId).find((row) => row.row_id === id).before_json).name, "Brannoc");
  const out = await revertTurn(world, turnId);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const names = db().prepare(`SELECT name FROM npcs WHERE campaign_id = ? ORDER BY name`).all(world.campaignId).map((row) => row.name);
  assert.deepEqual(names, ["Brannoc"]);
});

if (!child) {
  await test("only the columns the turn changed go back: a later change to another column stands", async () => {
    const { world } = await stage("calm");
    const id = npc(world, "Ilse");
    const turnId = await inTurn(world, () => db().prepare(`UPDATE npcs SET name = 'Ilse Grey' WHERE id = ?`).run(id));
    db().prepare(`UPDATE npcs SET trait = 'Owes the party a favour.' WHERE id = ?`).run(id);
    const out = await revertTurn(world, turnId);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    const row = db().prepare(`SELECT name, trait FROM npcs WHERE id = ?`).get(id);
    assert.deepEqual([row.name, row.trait], ["Ilse", "Owes the party a favour."]);
  });

  await test("the rules: a column the turn changed and something changed again since is asked about, and goes back", () => {
    const row = {
      table: "npcs",
      rowId: "n",
      before: { id: "n", name: "Ilse", notes: "" },
      after: { id: "n", name: "Ilse Grey", notes: "" },
      now: { id: "n", name: "Ilse the Red", notes: "x" },
      encounterId: null,
    };
    const plan = planRowsRevert([row], new Map());
    assert.deepEqual(plan.updates, [{ table: "npcs", rowId: "n", values: { name: "Ilse" } }]);
    assert.match(plan.warnings.join(" "), /Since this turn, 1 NPC changed again/);
  });

  await test("a turn that ended a fight with another fight on since is refused, saying why, and changes nothing", async () => {
    const { world, kit, hero, e1, e2 } = await stage("fight");
    await world.invoke("enemy_flees", { enemyId: e2.id, reason: "routed" });
    kit.setEnemy(e1.id, { currentHp: 1 });
    const blow = await world.invoke("apply_damage", { enemyId: e1.id, amount: 70, type: "fire" });
    assert.ok(blow.ok, blow.error);
    assert.equal(world.encounter(), null, "the blow ended the fight");
    world.dice(3, 15, 15);
    const next = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
    assert.ok(next.ok, next.error);
    const out = await revertTurn(world, blow.turnId);
    assert.equal(out.status, 400);
    assert.match(out.json.error, /another fight has begun since/);
    assert.equal(world.encounter()?.id, next.result?.encounterId ?? world.encounter()?.id);
    assert.ok(world.sheet(hero.id));
  });
}

if (!child) {
  await test("the same journal runs on the built-in engine (node:sqlite)", () => {
    const run = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--engine-child"], {
      env: { ...process.env, ODM_SQLITE_DRIVER: "node" },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `${run.stdout.slice(-1500)}\n${run.stderr.slice(-1500)}`);
  });
}

finish();
