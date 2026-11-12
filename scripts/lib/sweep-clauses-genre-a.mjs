// The clause ledger of the cyberpunk, dark fantasy and horror classes, run.
//
// scripts/clauses/genre-<genre>.json holds one entry per class and subclass
// feature of src/lib/classes/<genre>-features.json: the stored text split into
// its smallest promises, each marked held, gap, left or flavor. This module
// walks the CATALOG (not the ledger), so a feature added next month fails the
// suite until it has an entry, and a feature whose text changed fails on its
// sha until its clauses are read again. A clause that carries a `run` is
// played against the engine: `held` through test(), `gap` through gap(), so
// the ledger's gaps are the suite's known gaps and a fix cannot land without
// its clause turning to held (the ratchet).
//
// Import this before anything from src/ (it imports enforce-world.mjs through
// sweep-spends.mjs).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { openSpendsRig, readChanges } from "./sweep-spends.mjs";
import { seedDice, heroInput } from "./enforce-world.mjs";
import { TRAINED } from "./enforce-combat.mjs";
import { suite } from "./enforce-harness.mjs";

const ROOT = new URL("../../", import.meta.url);
const readJson = (file) => JSON.parse(fs.readFileSync(new URL(file, ROOT), "utf8"));

export const GENRES = ["cyberpunk", "dark-fantasy", "horror"];
export const sha12 = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
export const ledgerPath = (genre) => `scripts/clauses/genre-${genre}.json`;
export const loadLedger = (genre) => readJson(ledgerPath(genre));

// Every feature of a genre catalog, base class and subclass, in file order.
export function catalog(genre) {
  const source = `src/lib/classes/${genre}-features.json`;
  const out = [];
  for (const [classId, table] of Object.entries(readJson(source).classes)) {
    const push = (levels, group) => {
      for (const [level, list] of Object.entries(levels)) {
        for (const feature of list) {
          out.push({ key: `${classId}::${feature.n}`, genre, source, classId, group, level: Number(level), name: feature.n, text: feature.d });
        }
      }
    };
    push(table.levels, classId);
    push(table.subclass.levels, table.subclass.name);
  }
  return out;
}

// The scores every holder is built with: modifiers a probe can tell apart
// from a use count of one and from each other where a text names two.
export const SCORES = { str: 18, dex: 14, con: 16, int: 20, wis: 16, cha: 14 };
export const mod = (ability) => Math.floor((SCORES[ability] - 10) / 2);
export const prof = (level) => 2 + Math.floor((level - 1) / 4);

// assert.equal with the two numbers in the first line of the message, which is
// the line a gap records as what was observed.
export function eq(actual, expected, label) {
  assert.equal(actual, expected, `${label}: the engine gives ${JSON.stringify(actual)}, the text ${JSON.stringify(expected)}`);
}

// A refused or failed SETUP call is the probe breaking, never the rule.
export function must(out, what) {
  if (!out?.ok) {
    throw new Error(`${what} was refused: ${out?.error}`);
  }
  return out;
}

export async function openClauseRig() {
  const rig = await openSpendsRig();
  const { world, kit, reader, base, ally, fallen } = rig;
  const srd = await import(new URL("src/lib/srd/index.ts", ROOT).href);
  const rollsDb = await import(new URL("src/lib/db/rolls.ts", ROOT).href);

  const fresh = () => {
    reader.restore(base);
    seedDice(11);
    world.clearDice();
    world.diceLog();
  };

  // A holder as the class table builds one at this level: createSheet grants
  // the features and the counters. No armor, a longsword, armor class derived.
  function hero(classId, level, extra = {}) {
    const table = rig.classes.CUSTOM_CLASS_FEATURES[classId];
    return world.addHero({
      user: world.owner,
      name: "Holder",
      class: classId,
      level,
      subclass: level >= table.subclassLevel ? table.subclasses[0].name : "",
      abilities: SCORES,
      maxHp: 100,
      acOverride: false,
      proficiencies: TRAINED,
      portrait: { url: "/uploads/test.png" },
      equipment: [{ name: "Longsword", qty: 1, equipped: true }],
      ...extra,
    });
  }

  // One fight: the holder at (5,5) with the floor, a foe beside them, a foe
  // 70 feet off, a hurt ally beside them and an ally at 0 hit points.
  async function stage(ctx, opts = {}) {
    fresh();
    const made = hero(ctx.classId, opts.level ?? ctx.level, opts.extra ?? {});
    await kit.fight(2, { heroFaces: { [made.id]: 19, [ally.id]: 12, [fallen.id]: 11 } });
    const [near, far] = world.enemies();
    for (const enemy of [near, far]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
    const board = kit.map();
    const farX = Math.min(board.width - 1, 19);
    kit.place(made.id, 5, 5);
    kit.place(near.id, 5, 6);
    kit.place(ally.id, 4, 5);
    kit.place(fallen.id, 6, 5);
    kit.place(far.id, farX, 5);
    // A clear lane to the far foe for a shot or a spell: nobody within 5 feet
    // of the holder but the hurt ally, and nobody standing in the line.
    if (opts.lane) {
      kit.place(near.id, 5, 13);
      kit.place(fallen.id, 4, 4);
    }
    world.patch(made.id, { currentHp: opts.hp ?? 100, tempHp: 0 });
    world.patch(ally.id, { currentHp: 20 });
    world.patch(fallen.id, { currentHp: 0, conditions: ["unconscious", "prone"], conditionMeta: {}, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    kit.giveTurn(made.id);
    world.clearDice();
    world.diceLog();
    return { holder: world.sheet(made.id), near, far, ally, fallen, farFeet: (farX - 5) * 5 };
  }

  // The floor on the near foe: the holder off their turn, their reaction fresh.
  function foesTurn(scene) {
    const encounter = world.encounter();
    const place = encounter.order.findIndex((entry) => entry.enemyId === scene.near.id);
    rig.encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [] });
  }

  // The near foe's club against a character: `face` on the d20 (+4), `die` on
  // the d6 (+2). Returns the tool's result.
  async function clubs(scene, target, face = 16, die = 4) {
    foesTurn(scene);
    kit.freshRound();
    world.clearDice();
    world.dice(face, die);
    const out = await world.invoke("enemy_attack", { enemyId: scene.near.id, targetCharacterId: target.id });
    world.clearDice();
    return must(out, "the staged club swing").result;
  }

  const budget = () => world.encounter()?.turnBudget ?? {};
  const hp = (id) => world.sheet(id).currentHp;
  const foeHp = (id) => kit.enemy(id).currentHp;
  const lastRoll = () => rollsDb.listRecentRolls(world.campaignId, 1)[0] ?? null;

  return { ...rig, srd, fresh, hero, stage, foesTurn, clubs, budget, hp, foeHp, lastRoll, readChanges };
}

const isAssertion = (error) => error?.name === "AssertionError" || error?.code === "ERR_ASSERTION";
const STATUSES = new Set(["held", "gap", "left", "flavor"]);

// What an entry must be before any of its clauses is played.
function checkEntry(feature, entry) {
  assert.ok(entry, `no ledger entry for ${feature.key}: split its text into clauses in ${ledgerPath(feature.genre)}`);
  assert.equal(entry.sha, sha12(feature.text), `${feature.key}: the stored text changed (its sha is now ${sha12(feature.text)}); read its clauses again`);
  assert.equal(entry.level, feature.level, `${feature.key}: level`);
  assert.equal(entry.group, feature.group, `${feature.key}: group`);
  assert.ok(Array.isArray(entry.clauses) && entry.clauses.length, `${feature.key}: no clauses`);
  for (const clause of entry.clauses) {
    assert.ok(feature.text.includes(clause.c), `${feature.key}: "${clause.c}" is not in the stored text`);
    assert.ok(STATUSES.has(clause.is), `${feature.key}: status "${clause.is}"`);
    if (clause.is === "held") assert.ok(clause.by && clause.probe, `${feature.key}: a held clause names what holds it and the probe that ran`);
    if (clause.is === "gap") assert.ok(clause.probe || clause.read_only, `${feature.key}: a gap names its probe, or says what stopped the run`);
    if (clause.is === "left") assert.ok(clause.why, `${feature.key}: a clause left to the GM quotes the written reason`);
  }
  // Together the clauses cover the text: every part between two stops holds,
  // or lies inside, a clause.
  for (const part of feature.text.replace(/\.$/, "").split(/;\s+|\.\s+(?=[A-Z])/)) {
    const covered = entry.clauses.some((clause) => part.includes(clause.c) || clause.c.includes(part));
    assert.ok(covered, `${feature.key}: no clause covers "${part}"`);
  }
}

// Runs one genre's ledger. `probes` maps a run's kind to (rig, run, feature).
export async function runLedger(genre, probes, extras = []) {
  const name = `test-enforce-sweep-clauses-genre-a-${genre}`;
  const { test, gap, finish } = suite(name);
  const rig = await openClauseRig();
  const ledger = loadLedger(genre);
  const features = catalog(genre);
  const discover = process.env.SWEEP_CLAUSES_DISCOVER;
  const seen = {};
  const counts = { features: 0, clauses: 0, held: 0, gap: 0, left: 0, flavor: 0, played: 0, pointed: 0, readOnly: 0 };

  await test("every ledger entry is a feature of the catalog", () => {
    const known = new Set(features.map((feature) => feature.key));
    const stale = Object.keys(ledger).filter((key) => !known.has(key));
    assert.deepEqual(stale, [], `entries for features the catalog no longer has: ${stale.join(", ")}`);
  });

  for (const feature of features) {
    const entry = ledger[feature.key];
    counts.features += 1;
    let sound = true;
    await test(`${feature.key}: the ledger holds the feature as stored`, () => {
      try {
        checkEntry(feature, entry);
      } catch (error) {
        sound = false;
        throw error;
      }
    });
    if (!sound) continue;
    for (const [index, clause] of entry.clauses.entries()) {
      counts.clauses += 1;
      counts[clause.is] += 1;
      if (clause.is === "gap" && clause.read_only) counts.readOnly += 1;
      if (!clause.run) {
        if (clause.is === "gap" && !clause.read_only) counts.pointed += 1;
        continue;
      }
      const id = `${feature.key}#${index}`;
      const probe = probes[clause.run.k];
      const play = async () => {
        if (!probe) throw new Error(`no probe of kind "${clause.run.k}"`);
        await probe(rig, clause.run, feature);
      };
      counts.played += 1;
      if (discover) {
        try {
          await play();
          seen[id] = "pass";
        } catch (error) {
          seen[id] = isAssertion(error) ? `fail: ${String(error.message).split("\n")[0]}` : `error: ${String(error?.stack ?? error).split("\n").slice(0, 4).join(" | ")}`;
        }
      } else if (clause.is === "held") {
        await test(id, play);
      } else if (clause.is === "gap") {
        await gap(id, { rule: `"${clause.c}" (${feature.name}, ${feature.source})`, where: clause.where ?? "src/lib/srd/feature-effects.ts", severity: clause.sev ?? "medium" }, play);
      } else {
        await test(id, () => assert.fail(`a ${clause.is} clause carries a probe; it is held or a gap`));
      }
    }
  }

  for (const extra of extras) {
    await extra({ rig, test, gap, features, ledger, discover, seen });
  }

  rig.close();
  if (discover) {
    fs.writeFileSync(discover, JSON.stringify(seen, null, 1));
    console.log(`${name}: discovery of ${counts.played} probes written to ${discover}`);
    return;
  }
  // The clauses no probe of this suite plays, and why: SKIP, counted.
  console.log(
    `${name}: ${counts.features} features, ${counts.clauses} clauses (${counts.held} held, ${counts.gap} gap, ${counts.left} left, ${counts.flavor} flavor); ` +
      `${counts.played} played here; skipped: ${counts.pointed} gaps another sweep's probe holds (their probe field names it), ` +
      `${counts.readOnly} gaps read only (each says what stopped the run), ${counts.left + counts.flavor} left or flavor (nothing to play)`,
  );
  finish();
}
