// What the scripts/test-enforce-sweep-clauses-martial*.mjs suites share: the
// clause ledger (scripts/clauses/martial.json) read as the table the suites
// walk, and a table to run a clause on.
//
// The ledger splits the stored text of every authored fighter, barbarian,
// monk and rogue subclass feature (src/lib/srd/subclasses.json) into its
// smallest promises. A clause is `held` (a run showed the engine obeying it),
// a `gap` (a run showed it does not), `left` (roleplay or information, with
// the written reason) or `flavor`. A clause that is held or a gap names the
// probe that ran it: an existing suite's test, another sweep's gap, or a
// probe of these suites, "scripts/<file>: <probe id>".
//
//   const { probe, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
//   await probe("eldritch-strike-next-save", async () => { ... });
//   finish();
//
// A probe whose id has an entry in KNOWN runs through gap(): the suite is
// green today and fails the day the engine starts holding the clause. Every
// other probe runs through test(). The ledger and the suite must agree both
// ways: a clause pointing at a probe nobody registered, a probe no clause
// points at, a KNOWN probe whose clauses say `held`, each fails the suite.
//
// SWEEP_CLAUSES_SURVEY=1 prints every probe's outcome and never fails: the
// way a new probe's first run is read.
// SWEEP_CLAUSES_FINDINGS=<file> rewrites that file's lines for this suite,
// one JSON object per open gap, with what the run observed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWorld } from "./enforce-world.mjs";
import { suite } from "./enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./enforce-combat.mjs";
import { kit as conditionsKit } from "./enforce-conditions.mjs";

export const SLICE = ["fighter", "barbarian", "monk", "rogue"];
export const SOURCE = "src/lib/srd/subclasses.json";
const here = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = path.join(here, "../clauses/martial.json");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(here, "../../src/lib/srd", relative), "utf8"));

export const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);
export const readLedger = () => JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8"));

// Every feature of the slice, in the table's order.
export function sliceFeatures() {
  const out = [];
  const table = readJson("subclasses.json").classes;
  for (const classId of SLICE) {
    for (const subclass of table[classId]) {
      for (const [level, features] of Object.entries(subclass.levels)) {
        for (const feature of features) {
          out.push({ key: `${classId}::${feature.n}`, classId, subclass: subclass.name, level: Number(level), name: feature.n, text: feature.d, sha: sha(feature.d) });
        }
      }
    }
  }
  return out;
}

// The ledger's clauses that name a probe of `file`, by probe id.
export function clausesPointingAt(file, ledger = readLedger()) {
  const out = new Map();
  for (const [key, entry] of Object.entries(ledger)) {
    for (const clause of entry.clauses) {
      const probe = String(clause.probe ?? "");
      if (probe.startsWith(`${file}: `)) {
        const id = probe.slice(file.length + 2);
        out.set(id, [...(out.get(id) ?? []), { key, clause }]);
      }
    }
  }
  return out;
}

const SEVERITY = new Set(["high", "medium", "low"]);

// KNOWN[probeId] = { severity, kind, where, note, paths?, fix?, files?, area? }
// SKIP[probeId]  = why the probe cannot run here (its clauses stay `gap` with
//                  read_only: true).
export async function clauseSuite(metaUrl, KNOWN = {}, SKIP = {}) {
  const file = `scripts/${path.basename(fileURLToPath(metaUrl))}`;
  const name = path.basename(file, ".mjs");
  const { test, gap, finish } = suite(name);
  const ledger = readLedger();
  const pointed = clausesPointingAt(file, ledger);
  const survey = Boolean(process.env.SWEEP_CLAUSES_SURVEY);
  const ran = new Set();
  const observed = new Map();
  const tally = { held: 0, gap: 0, skipped: 0 };

  const ruleOf = (rows) =>
    rows.map(({ key, clause }) => `"${clause.c}" (${SOURCE}, ${key})`).join("; ");

  async function probe(id, fn) {
    if (ran.has(id)) {
      await test(`${id}: a probe id used twice`, () => assert.fail(`probe "${id}" is registered twice in ${name}`));
      return;
    }
    ran.add(id);
    const rows = pointed.get(id) ?? [];
    if (survey) {
      try {
        await fn();
        console.log(`  PASS ${id}${KNOWN[id] ? "   <-- KNOWN says gap" : ""}`);
      } catch (error) {
        const kind = error?.code === "ERR_ASSERTION" ? "FAIL" : "THREW";
        console.log(`  ${kind} ${id}${KNOWN[id] ? " (known)" : "   <-- no KNOWN entry"}: ${String(kind === "THREW" ? error?.stack : error?.message).split("\n").slice(0, kind === "THREW" ? 4 : 1).join(" | ").slice(0, 600)}`);
      }
      if (!rows.length) console.log(`  ORPHAN ${id}: no ledger clause points at it`);
      return;
    }
    if (!rows.length) {
      await test(`${id}: no clause of scripts/clauses/martial.json names this probe`, () => assert.fail("add the clause, or drop the probe"));
      return;
    }
    if (SKIP[id]) {
      tally.skipped += 1;
      console.log(`  SKIP ${id}: ${SKIP[id]}`);
      await test(`${id}: a skipped probe's clauses are gaps marked read_only`, () => {
        for (const { key, clause } of rows) assert.ok(clause.is === "gap" && clause.read_only === true, `${key}: "${clause.c}" is ${clause.is}`);
      });
      return;
    }
    const known = KNOWN[id];
    const wanted = known ? "gap" : "held";
    const wrong = rows.filter(({ clause }) => clause.is !== wanted);
    if (wrong.length) {
      await test(`${id}: the ledger and the suite disagree`, () =>
        assert.fail(`${wrong.map(({ key, clause }) => `${key} "${clause.c}" is ${clause.is}`).join("; ")}, and the suite runs the probe as ${wanted}`));
      return;
    }
    if (!known) {
      tally.held += 1;
      await test(`${id}: ${ruleOf(rows)}`, fn);
      return;
    }
    if (!SEVERITY.has(known.severity) || !known.where || !known.kind) {
      await test(`${id}: a KNOWN entry needs severity, kind and where`, () => assert.fail(JSON.stringify(known)));
      return;
    }
    tally.gap += 1;
    await gap(id, { rule: ruleOf(rows), where: known.where, severity: known.severity, note: known.note }, async () => {
      try {
        await fn();
      } catch (error) {
        if (error?.code === "ERR_ASSERTION") observed.set(id, String(error.message).split("\n")[0].slice(0, 700));
        throw error;
      }
    });
  }

  function writeFindings() {
    const target = process.env.SWEEP_CLAUSES_FINDINGS;
    if (!target) return;
    const kept = fs.existsSync(target)
      ? fs.readFileSync(target, "utf8").split("\n").filter((line) => line.trim() && !JSON.parse(line).repro.startsWith(`${file} `))
      : [];
    const mine = [...observed.entries()].map(([id, saw]) => {
      const known = KNOWN[id];
      const rows = pointed.get(id) ?? [];
      return JSON.stringify({
        id: `clauses-martial-${id}`,
        severity: known.severity,
        kind: known.kind,
        area: known.area ?? [...new Set(rows.map(({ key }) => `${ledger[key].group}: ${key.split("::")[1]}`))].join("; "),
        rule: ruleOf(rows),
        observed: `${saw}${known.note ? ` ${known.note}` : ""}`,
        paths: known.paths ?? "No path holds it.",
        where: known.where,
        repro: `${file} gap ${id}`,
        fix_hint: known.fix ?? "",
        files: known.files ?? [],
        read_only: false,
        ruling: known.ruling ?? null,
        pinned: known.pinned ?? null,
        in_flight_pr: known.pr ?? null,
      });
    });
    fs.writeFileSync(target, [...kept, ...mine].join("\n") + "\n");
  }

  function done() {
    if (survey) {
      console.log(`${name}: survey of ${ran.size} probes`);
      return;
    }
    const problems = [];
    for (const id of pointed.keys()) if (!ran.has(id)) problems.push(`the ledger names probe "${id}", which this suite never ran`);
    for (const id of Object.keys(KNOWN)) if (!ran.has(id)) problems.push(`KNOWN["${id}"] names no probe`);
    for (const id of Object.keys(SKIP)) if (!ran.has(id)) problems.push(`SKIP["${id}"] names no probe`);
    console.log(`${name}: ${ran.size} probes: ${tally.held} held, ${tally.gap} gaps, ${tally.skipped} skipped`);
    writeFindings();
    if (problems.length) throw new Error(`${name}: ${problems.join("; ")}`);
    finish();
  }

  return { probe, test, finish: done, file, ledger };
}

// ---- the table ----

export const ABILITIES = { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 };
export const MOD = 3;
export const prof = (level) => 2 + Math.floor((level - 1) / 4);

// One small table of its own (a campaign in the suite's one database): a
// probe that walks turns opens a rig for its two or three heroes, so the
// order holds nobody else.
export async function openRig() {
  const world = await openWorld({ campaign: { maxPlayers: 120 } });
  const kit = await combatKit(world);
  const turns = await conditionsKit(world);
  const rollsDb = await import("../../src/lib/db/rolls.ts");
  const { pcMoveBudget } = await import("../../src/lib/battlemap/view.ts");
  const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");

  // A hero of a seat of their own: every ability 16 unless said, sturdy, at
  // the level the clause is about.
  const hero = (classId, subclass, level, extra = {}) =>
    world.addHero({
      class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
      portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
      ...extra, abilities: { ...ABILITIES, ...(extra.abilities ?? {}) },
    });

  // A fresh fight: `first` on their own turn at (5, 5), the first dummy
  // beside them at (6, 5), the rest of the dummies 2 tiles on, everybody else
  // parked on one far tile. `cast` places the others the clause is about:
  // [[who, x, y], ...]. Every counter of the cast is whole again.
  async function stage(first, { enemies = 1, cast = [], hp = 300, heroHp = 80 } = {}) {
    await kit.endFight();
    const faces = Object.fromEntries(world.sheets().map((sheet) => [sheet.id, sheet.id === first.id ? 19 : 3]));
    await kit.fight(enemies, { heroFaces: faces });
    const board = kit.map();
    const named = new Set([first.id, ...cast.map(([who]) => who.id)]);
    for (const sheet of world.sheets()) {
      if (!named.has(sheet.id) && kit.token(sheet.id)) kit.place(sheet.id, board.width - 1, board.height - 1);
    }
    const foes = world.enemies();
    foes.forEach((enemy, at) => {
      kit.setEnemy(enemy.id, { maxHp: hp, currentHp: hp });
      kit.place(enemy.id, 6 + at * 2, 5);
    });
    kit.place(first.id, 5, 5);
    for (const [who, x, y] of cast) kit.place(who.id, x, y);
    for (const id of named) {
      const sheet = world.sheet(id);
      world.patch(id, {
        currentHp: Math.min(heroHp, sheet.maxHp), tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, exhaustion: 0, concentratingOn: null,
        resources: Object.fromEntries(Object.entries(sheet.resources ?? {}).map(([key, state]) => [key, { ...state, used: 0 }])),
      });
    }
    kit.giveTurn(first.id);
    kit.freshRound();
    world.clearDice();
    world.diceLog();
    return foes.map((enemy) => kit.enemy(enemy.id));
  }

  // A call with its dice forced. `faces` is a list, or one face every die the
  // call rolls takes (2: a d20 that fails and dice a test can count; 20: a
  // d20 that succeeds and every die at its most).
  async function forced(faces, run) {
    world.clearDice();
    world.dice(...(Array.isArray(faces) ? faces : new Array(40).fill(faces)));
    try {
      return await run();
    } finally {
      world.clearDice();
    }
  }
  const spend = (who, resource, args = {}, faces = 2) =>
    forced(faces, () => world.invoke("use_resource", { characterId: who.id, resource, ...args }));
  const react = (who, feature, args = {}, faces = 2) =>
    forced(faces, () => world.invoke("use_reaction", { characterId: who.id, feature, ...args }));
  const act = (who, action, args = {}, faces = 2) =>
    forced(faces, () => world.invoke("take_action", { characterId: who.id, action, ...args }));
  const swing = (who, enemy, faces = [15, 4, 4, 4, 4, 4, 4, 4, 4], args = {}) => kit.swing(who.id, enemy.id, faces, args);
  // The dummy's club at a hero: 16 on the die is a 20 to hit, 4 + 2 damage.
  async function enemyHits(enemy, target, faces = [16, 4], args = {}) {
    kit.freshRound();
    const out = await forced(faces, () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id, ...args }));
    assert.equal(out.ok, true, `the staged enemy attack was refused: ${out.error}`);
    return out.result;
  }
  // A roll asked of a hero with the d20 forced; the stored result.
  async function roll(who, args, faces = [10, 10]) {
    const out = await forced(faces, () => world.invoke("request_roll", { characterId: who.id, reason: "a clause probe", ...args }));
    assert.equal(out.ok, true, `request_roll was refused: ${out.error}`);
    return out.result;
  }

  // Ends turns, each unplayed, until `who` holds the floor again: the walk a
  // duration is measured by ("until the start of your next turn").
  function untilTurnOf(who) {
    for (let step = 0; step < 60; step += 1) {
      world.clearDice();
      world.dice(...new Array(8).fill(1));
      turns.skipTurn();
      world.clearDice();
      if (turns.pointer().id === who.id) return world.encounter();
    }
    throw new Error(`the order never came back to ${world.sheet(who.id).name}`);
  }
  // Ends the turn of whoever holds the floor, unplayed.
  function endTurn() {
    world.clearDice();
    world.dice(...new Array(8).fill(1));
    turns.skipTurn();
    world.clearDice();
    return turns.pointer();
  }

  // The player's own move on the board (the route their click reaches): the
  // enemies they leave take their opportunity attacks. Returns the status.
  async function walk(who, x, y, faces = [15, 4, 15, 4]) {
    world.signIn({ id: world.sheet(who.id).userId });
    const response = await forced(faces, () =>
      moveRoute.POST(
        new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x, y }) }),
        { params: Promise.resolve({ campaignId: world.campaignId }) },
      ),
    );
    return response.status;
  }
  // The squares the board lights for a hero's move right now.
  const moveTiles = (who) => pcMoveBudget(world.campaignId, world.encounter(), kit.map(), world.sheet(who.id), kit.token(who.id)).tiles;

  const rage = (who) => {
    const sheet = world.sheet(who.id);
    world.patch(who.id, { conditions: [...new Set([...sheet.conditions, "raging"])], conditionMeta: { ...sheet.conditionMeta, raging: { rounds: 10 } } });
  };
  const give = (who, condition, meta = { rounds: 10 }) => {
    const sheet = world.sheet(who.id);
    world.patch(who.id, { conditions: [...new Set([...sheet.conditions, condition])], conditionMeta: { ...sheet.conditionMeta, [condition]: meta } });
  };
  const setUsed = (who, id, used) => {
    const sheet = world.sheet(who.id);
    assert.ok(sheet.resources?.[id], `${sheet.name} holds no counter ${id}: ${Object.keys(sheet.resources ?? {}).join(", ")}`);
    world.patch(who.id, { resources: { ...sheet.resources, [id]: { ...sheet.resources[id], used } } });
  };

  const sheet = (who) => world.sheet(who.id);
  const foe = (enemy) => kit.enemy(enemy.id);
  const used = (who, id) => world.sheet(who.id).resources?.[id]?.used ?? null;
  const max = (who, id) => world.sheet(who.id).resources?.[id]?.max ?? null;
  const budget = () => world.encounter()?.turnBudget ?? {};
  const has = (who, condition) => world.sheet(who.id).conditions.some((entry) => entry === condition || entry.startsWith(`${condition} (`));
  const foeHas = (enemy, condition) => kit.enemy(enemy.id).conditions.some((entry) => entry === condition || entry.startsWith(`${condition} (`));
  const d20s = (result) => result?.dice?.find((term) => term.sides === 20)?.dice?.length ?? 0;
  const diceOf = (rollRecord, sides) =>
    (rollRecord?.breakdown?.terms ?? []).filter((term) => term.sides === sides).reduce((sum, term) => sum + term.dice.length, 0);
  const lastRoll = (kind, characterId, detail = "") =>
    rollsDb.listRecentRolls(world.campaignId, 40).find((entry) => entry.kind === kind && (!characterId || entry.characterId === characterId) && String(entry.detail ?? "").includes(detail)) ?? null;
  const rollBy = (kind, characterId, enemy) =>
    rollsDb.listRecentRolls(world.campaignId, 40).find((entry) => entry.kind === kind && entry.characterId === characterId && entry.attacker?.id === enemy.id) ?? null;
  const show = (out) => (out?.ok ? JSON.stringify(out.result).slice(0, 320) : `refused: ${String(out?.error).slice(0, 320)}`);
  // Chooses an option of a feature outside a fight ("Totem Spirit" -> Bear).
  async function choose(who, feature, variant) {
    await kit.endFight();
    const out = await world.invoke("use_resource", { characterId: who.id, resource: feature, variant });
    assert.equal(out.ok, true, `choosing ${variant} for ${feature} was refused: ${out.error}`);
  }

  return {
    world, kit, turns, hero, stage, forced, spend, react, act, swing, enemyHits, roll, rage, give, setUsed, choose, untilTurnOf, endTurn, walk, moveTiles,
    sheet, foe, used, max, budget, has, foeHas, d20s, diceOf, lastRoll, rollBy, show, d20Faces,
  };
}
