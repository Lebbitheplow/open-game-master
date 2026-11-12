// The clause ledger's rig for the arcane slice (wizard, sorcerer, warlock,
// bard): scripts/clauses/arcane.json holds every authored subclass feature of
// those classes split into its smallest promises, and the suites
// scripts/test-enforce-sweep-clauses-arcane-*.mjs run one probe per clause that
// can be run. This file is what those suites share: the ledger's own checks
// (every feature has an entry, the text has not moved, every clause is a piece
// of the text, every mechanical word of the text sits in a clause), a table
// with one holder per build, and the small verbs a probe is written in.
//
// Import enforce-world.mjs first.
import assert from "node:assert/strict";
import { keepThrownCards } from "./kept-rolls.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { TRAINED } from "./enforce-combat.mjs";
import { limitsTable } from "./sweep-limits-world.mjs";

export const SLICE = ["wizard", "sorcerer", "warlock", "bard"];
export const LEDGER_PATH = new URL("../clauses/arcane.json", import.meta.url);
const SRC = new URL("../../src/lib/srd/subclasses.json", import.meta.url);

// Six different modifiers, so a probe tells the Intelligence a rule names from
// the Charisma another does: STR 0, DEX +2, CON +1, INT +3, WIS -1, CHA +4.
export const SCORES = { str: 10, dex: 14, con: 12, int: 16, wis: 8, cha: 18 };
export const MOD = Object.fromEntries(Object.entries(SCORES).map(([key, score]) => [key, Math.floor((score - 10) / 2)]));
export const prof = (level) => 2 + Math.floor((level - 1) / 4);
const CASTS_WITH = { wizard: "int", sorcerer: "cha", warlock: "cha", bard: "cha" };
export const spellDc = (classId, level) => 8 + prof(level) + MOD[CASTS_WITH[classId]];

// The full caster's slots at a level (SRD 5.1, the class tables).
const FULL = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
export const slotsAt = (level) => Object.fromEntries(FULL[level - 1].map((max, at) => [at + 1, { max, used: 0 }]));

// ---- the ledger ----

export const sha12 = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);

// Every authored feature of the slice, as stored: key to { group, level, text }.
// Two subclasses of one class may share a feature's name (Extra Attack: Valor
// and Swords); the key then carries the subclass, "bard::Extra Attack@College of Swords".
export function sliceFeatures() {
  const data = JSON.parse(fs.readFileSync(SRC, "utf8")).classes;
  const out = new Map();
  for (const classId of SLICE) {
    for (const subclass of data[classId]) {
      for (const [level, features] of Object.entries(subclass.levels)) {
        for (const feature of features) {
          const plain = `${classId}::${feature.n}`;
          const key = out.has(plain) ? `${plain}@${subclass.name}` : plain;
          out.set(key, { classId, group: subclass.name, level: Number(level), name: feature.n, text: feature.d });
        }
      }
    }
  }
  return out;
}

export const loadLedger = () => JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));

// The words that make a stretch of text a promise the engine could break
// (src/lib/srd/authored-coverage.ts MECHANICAL, written out here so the check
// does not move when that pattern does).
const MECHANICAL =
  /advantage|disadvantage|\+\d|resistan|immun|\d+d\d+|\bd\d+\b|bonus action|reaction|temporary hit points|hit points?|regain|speed|saving throw|\bsave\b|\bAC\b|armor class|critical|attack twice|damage|initiative|darkvision|modifier|spell slot|teleport|\bfly|flying|prone|charmed|frightened|incapacitat|stunned|cantrip|proficien|per (?:short|long) rest|once per|times per|\d+ feet|\d+-foot/i;

// What is wrong with the ledger against the stored text, as a list of lines
// (empty when it is sound).
export function ledgerProblems(ledger = loadLedger()) {
  const problems = [];
  const features = sliceFeatures();
  for (const [key, feature] of features) {
    const entry = ledger[key];
    if (!entry) {
      problems.push(`${key}: no entry (a feature added to subclasses.json needs its clauses written)`);
      continue;
    }
    if (entry.sha !== sha12(feature.text)) {
      problems.push(`${key}: the stored text changed (sha ${sha12(feature.text)}, the ledger has ${entry.sha}); read it again and re-split its clauses`);
      continue;
    }
    if (entry.group !== feature.group || entry.level !== feature.level) {
      problems.push(`${key}: the ledger says ${entry.group} level ${entry.level}, the table ${feature.group} level ${feature.level}`);
    }
    let rest = feature.text;
    for (const clause of entry.clauses ?? []) {
      if (!feature.text.includes(clause.c)) {
        problems.push(`${key}: clause is not a piece of the text: "${clause.c}"`);
        continue;
      }
      rest = rest.split(clause.c).join(" | ");
      if (!["held", "gap", "left", "flavor"].includes(clause.is)) problems.push(`${key}: clause "${clause.c.slice(0, 40)}" has status ${clause.is}`);
      if (clause.is === "held" && (!clause.by || !clause.probe)) problems.push(`${key}: held clause "${clause.c.slice(0, 40)}" needs by and probe`);
      if (clause.is === "gap" && !clause.probe && !clause.read_only) problems.push(`${key}: gap clause "${clause.c.slice(0, 40)}" needs a probe or read_only`);
      if (clause.is === "left" && !clause.why) problems.push(`${key}: left clause "${clause.c.slice(0, 40)}" needs the written reason`);
    }
    if (!entry.clauses?.length) problems.push(`${key}: no clauses`);
    // What no clause took must hold no mechanical word.
    for (const piece of rest.split(" | ")) {
      const found = MECHANICAL.exec(piece);
      if (found) problems.push(`${key}: "${found[0]}" in "${piece.trim().slice(0, 70)}" sits in no clause`);
    }
  }
  for (const key of Object.keys(ledger)) {
    if (!features.has(key)) problems.push(`${key}: the ledger has an entry no feature answers to`);
  }
  return problems;
}

// The clauses of the ledger whose probe names this suite file, each as
// { key, entry, clause, id }: "scripts/<suite>.mjs :: <id>".
export function clausesFor(suiteFile, ledger = loadLedger()) {
  const out = [];
  for (const [key, entry] of Object.entries(ledger)) {
    for (const clause of entry.clauses) {
      const [file, id] = String(clause.probe ?? "").split(" :: ");
      if (file === `scripts/${suiteFile}` && id) out.push({ key, entry, clause, id });
    }
  }
  return out;
}

// ---- the table ----

export async function clauseRig(world) {
  const table = await limitsTable(world);
  const { kit } = table;
  const made = new Map();
  const features = await import("../../src/lib/srd/features.ts");
  const srd = await import("../../src/lib/srd/index.ts");
  const authored = await import("../../src/lib/srd/authored-effects.ts");
  const more = await import("../../src/lib/srd/authored-effects-more.ts");
  const view = await import("../../src/lib/battlemap/view.ts");

  // One holder per build: a subclass at a level, its own seat, the SCORES
  // above, the full caster's slots, and whatever the probe adds. `tag` keeps
  // two holders of one build apart (one whose option is chosen, one not).
  // What every holder of a subclass is made with (its spells, its weapon),
  // whichever probe asks for one first.
  const outfits = new Map();
  const outfit = (classId, subclass, extra) => outfits.set(`${classId}/${subclass}`, extra);
  function holder(classId, subclass, level = 20, extra = {}, tag = "") {
    const key = `${classId}/${subclass}/${level}/${tag}`;
    if (!made.has(key)) {
      const { spells = [], cantrips = [], ...rest } = { ...(outfits.get(`${classId}/${subclass}`) ?? {}), ...extra };
      made.set(key, table.hero({
        class: classId, subclass, level, abilities: SCORES, proficiencies: TRAINED, name: `${subclass.split(" ").pop()} ${level}${tag ? ` ${tag}` : ""}`,
        spellcasting: { ability: CASTS_WITH[classId] ?? "int", slots: slotsAt(level), prepared: spells, known: spells, cantrips },
        ...rest,
      }));
    }
    return made.get(key);
  }

  const sheet = (who) => world.sheet(who.id);
  const foe = (enemy) => kit.enemy(enemy.id);
  const hp = (who) => sheet(who).currentHp + (sheet(who).tempHp ?? 0);
  const counter = (who, id) => sheet(who).resources?.[id] ?? null;
  const left = (who, id) => (counter(who, id)?.max ?? 0) - (counter(who, id)?.used ?? 0);
  const budget = () => world.encounter()?.turnBudget ?? null;
  const reacted = (who) => world.encounter()?.reactionsUsed.includes(who.id) ?? false;
  const show = (out) => (out.ok ? JSON.stringify(out.result).slice(0, 320) : `REFUSED ${String(out.error).slice(0, 320)}`);

  async function call(name, args, faces = []) {
    world.clearDice();
    world.diceLog();
    world.dice(...faces);
    // A roll that waits on what the caster holds is kept as it lies.
    const out = await keepThrownCards(world, await world.invoke(name, args));
    const unused = world.clearDice();
    out.rolled = world.diceLog();
    out.unused = unused;
    return out;
  }
  const spend = (who, resource, args = {}, faces = []) => call("use_resource", { characterId: who.id, resource, ...args }, faces);
  const react = (who, feature, args = {}, faces = []) => call("use_reaction", { characterId: who.id, feature, ...args }, faces);
  // Damage of a type to a character; answers what it took off hit points and
  // temporary hit points together.
  async function hurt(who, amount, type, extra = {}) {
    const before = hp(who);
    const out = await call("apply_damage", { characterId: who.id, amount, type, ...extra });
    assert.equal(out.ok, true, `apply_damage refused: ${out.error}`);
    return before - hp(who);
  }
  // A save or a check asked of a character with its faces forced: how many
  // d20s were thrown, and the result.
  async function roll(who, args, faces = [11, 11]) {
    const out = await call("request_roll", { characterId: who.id, reason: "probe", ...args }, faces);
    return { out, d20s: out.rolled.filter((die) => die.sides === 20).length, total: out.result?.total ?? out.result?.roll?.total ?? null };
  }
  const refill = (who) => {
    const now = sheet(who);
    world.patch(who.id, {
      currentHp: now.maxHp, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, exhaustion: 0, concentratingOn: null,
      resources: Object.fromEntries(Object.entries(now.resources ?? {}).map(([id, state]) => [id, { ...state, used: 0 }])),
      spellcasting: now.spellcasting ? { ...now.spellcasting, slots: Object.fromEntries(Object.entries(now.spellcasting.slots ?? {}).map(([lv, slot]) => [lv, { ...slot, used: 0 }])) } : now.spellcasting,
    });
  };
  // The holder on their own fresh turn at (5, 5), `count` dummies beside them
  // to the east, whoever else is named a square west and on.
  async function stage(who, { count = 1, others = [], first = who } = {}) {
    const foes = await table.stage([who, ...others], { count, first });
    kit.place(who.id, 5, 5);
    others.forEach((other, at) => kit.place(other.id, 4 - at, 5));
    foes.forEach((enemy, at) => kit.place(enemy.id, 6 + at, 5));
    refill(who);
    kit.giveTurn(first.id);
    kit.freshTurn();
    return foes;
  }
  const feetBetween = (a, b) => {
    const [one, two] = [kit.token(a.id), kit.token(b.id)];
    return Math.max(Math.abs(one.x - two.x), Math.abs(one.y - two.y)) * 5;
  };
  // A rest out of a fight, for everybody.
  async function rest(kind) {
    await kit.endFight();
    const out = await call("take_rest", { kind });
    assert.equal(out.ok, true, `take_rest refused: ${out.error}`);
    return out;
  }
  // The flying and swimming speeds the authored layer gives a sheet now.
  const speeds = (who) => {
    const now = sheet(who);
    return authored.authoredSpeeds(now, now.speed ?? 30);
  };
  // Ends the turn of whoever holds the floor: a hero's own End Turn, or the
  // enemies' turns handed on unplayed.
  function endCurrent() {
    const current = kit.current();
    if (current?.characterId) return kit.endTurn(world.sheet(current.characterId).userId);
    kit.handOnEnemies();
    return null;
  }
  // Ends turns until it is this hero's turn again (a whole round when it is
  // theirs now). Every sheet of the world is in the order, so this may end
  // dozens of turns.
  function cycleTo(who) {
    for (let step = 0; step < 400; step += 1) {
      endCurrent();
      if (kit.current()?.characterId === who.id) return step + 1;
    }
    throw new Error(`the order never came back to ${who.id}`);
  }
  const darkvisionFeet = (who) => view.sheetDarkvisionTiles(sheet(who)) * 5;

  return {
    world, table, kit, holder, outfit, sheet, foe, hp, counter, left, budget, reacted, show, call, spend, react, hurt, roll, refill, stage,
    feetBetween, rest, speeds, darkvisionFeet, endCurrent, cycleTo, features, srd, authored, more,
  };
}

// ---- probes many features share ----

// Built on a rig: the bystander every probe may lean on, a spellcasting
// enemy, and the four shapes most counters' clauses take.
export async function sharedProbes(rig) {
  const { world, kit, holder, sheet, counter, spend, stage, show } = rig;
  const spellcasting = await import("../../src/lib/dm/monster-spellcasting.ts");
  let bystander = null;
  const friend = () => (bystander ??= rig.table.hero({ class: "fighter", subclass: "Champion", level: 5, name: "Friend" }));
  // A dummy that casts: a 9th-level wizard's block (DC 14).
  const BLOCK = "The goblin is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). It has the following wizard spells prepared:\nCantrips (at will): fire bolt\n1st level (4 slots): magic missile, burning hands\n3rd level (3 slots): fireball, counterspell\n5th level (1 slot): cone of cold";
  const mage = (enemy) => kit.setEnemy(enemy.id, { stats: { ...rig.foe(enemy).stats, spellcasting: spellcasting.parseSpellcasting(BLOCK, "Spellcasting"), traits: [`Spellcasting: ${BLOCK}`] } });
  const drain = (who, id) => {
    const now = sheet(who);
    world.patch(who.id, { resources: { ...now.resources, [id]: { ...now.resources[id], used: now.resources[id].max } } });
  };
  const freeReactions = () => kit.saveEncounter({ ...world.encounter(), reactionsUsed: [] });

  // A counter's size at the levels given: { level: max }.
  const uses = (build, id, sizes) => async () => {
    for (const [level, max] of Object.entries(sizes)) {
      const who = holder(build[0], build[1], Number(level), {}, build[2] ?? "");
      assert.equal(counter(who, id)?.max, max, `${id} at ${build[1]} level ${level}`);
    }
  };

  // What a rest gives back. Every probe of this shape is drained and rested
  // in one pass (a short rest, then a long one), since a rest is the table's.
  const restSpecs = [];
  let restSeen = null;
  async function runRests() {
    const seen = new Map();
    await kit.endFight();
    const each = (fn) => restSpecs.forEach((spec) => fn(spec, holder(spec.build[0], spec.build[1], spec.build[2] ?? 20, {}, spec.build[3] ?? "")));
    each((spec, who) => { if (counter(who, spec.id)) drain(who, spec.id); });
    await rig.rest("short");
    each((spec, who) => seen.set(spec, { max: counter(who, spec.id)?.max ?? 0, afterShort: counter(who, spec.id)?.used }));
    each((spec, who) => { if (counter(who, spec.id)) drain(who, spec.id); });
    await rig.rest("long");
    each((spec, who) => { seen.get(spec).afterLong = counter(who, spec.id)?.used; });
    return seen;
  }
  const rests = (build, id, recharge) => {
    const spec = { build, id, recharge };
    restSpecs.push(spec);
    return async () => {
      restSeen ??= await runRests();
      const seen = restSeen.get(spec);
      assert.ok(seen.max >= 1, `${id}: no such counter on ${build[1]}'s sheet`);
      assert.equal(seen.afterShort, recharge === "short" ? 0 : seen.max, `${id} spent, after a short rest (uses spent of ${seen.max})`);
      assert.equal(seen.afterLong, 0, `${id} spent, after a long rest`);
    };
  };

  // Everything a spend could have moved besides its own counter and the turn.
  const scene = (who, foes) => JSON.stringify({
    heroes: world.sheets().length,
    who: [sheet(who).currentHp, sheet(who).tempHp, sheet(who).conditions, sheet(who).concentratingOn, kit.token(who.id)?.x, kit.token(who.id)?.y, sheet(who).spellcasting?.prepared?.length, sheet(who).equipment?.length],
    friend: [sheet(friend()).currentHp, sheet(friend()).tempHp, sheet(friend()).conditions],
    foes: foes.map((enemy) => [rig.foe(enemy).currentHp, rig.foe(enemy).conditions]),
    tokens: world.enemies().length,
  });
  // A gap's shape: the feature is spent and the engine moves nothing else.
  const movesSomething = (build, name, args = () => ({})) => async () => {
    const who = holder(build[0], build[1], build[2] ?? 20, build[4] ?? {}, build[3] ?? "");
    const foes = await stage(who, { others: [friend()] });
    const before = scene(who, foes);
    const out = await spend(who, name, args(foes, who));
    if (!out.ok) throw new Error(`${name} was refused: ${out.error}`);
    assert.notEqual(scene(who, foes), before, `only the counter and the turn moved; the result is words for the GM: ${show(out).slice(0, 220)}`);
  };
  // A gap's shape: the feature has no door of its own name.
  const hasDoor = (build, name, args = () => ({})) => async () => {
    const who = holder(build[0], build[1], build[2] ?? 20, build[4] ?? {}, build[3] ?? "");
    const foes = await stage(who, { others: [friend()] });
    const out = await spend(who, name, args(foes, who));
    assert.equal(out.ok, true, `use_resource "${name}": ${String(out.error).slice(0, 200)}`);
  };
  // A gap's shape: with the free use gone, the text's other price buys one more.
  const buysAnother = (build, name, id, price) => async () => {
    const who = holder(build[0], build[1], build[2] ?? 20, build[4] ?? {}, build[3] ?? "");
    const foes = await stage(who, { others: [friend()] });
    drain(who, id);
    const out = await spend(who, name, { targetEnemyId: foes[0].id });
    assert.equal(out.ok, true, `with every ${price} still on the sheet: ${String(out.error).slice(0, 200)}`);
  };
  return { friend, mage, drain, freeReactions, uses, rests, movesSomething, hasDoor, buysAnother, scene };
}

// ---- the suite ----

// Runs one suite file's clauses: every clause of the ledger whose probe names
// the file. `modules` are the probe files' exports: probes(rig, shared)
// answering { PROBES, KNOWN }. A held clause is a test; a gap clause is a
// gap() whose meta comes from KNOWN[id]; a probe no clause names, a clause
// with no probe, and a gap with no KNOWN entry all fail the suite.
export async function runClauseSuite(suiteFile, modules) {
  const { suite } = await import("./enforce-harness.mjs");
  const { openWorld } = await import("./enforce-world.mjs");
  const name = suiteFile.replace(/\.mjs$/, "");
  const { test, gap, finish } = suite(name);
  const world = await openWorld({ campaign: { maxPlayers: 90 } });
  const rig = await clauseRig(world);
  const shared = await sharedProbes(rig);
  const PROBES = {};
  const KNOWN = {};
  for (const makeProbes of modules) {
    const made = makeProbes(rig, shared);
    Object.assign(PROBES, made.PROBES);
    Object.assign(KNOWN, made.KNOWN);
  }
  const wanted = new Map();
  for (const row of clausesFor(suiteFile)) wanted.set(row.id, [...(wanted.get(row.id) ?? []), row]);
  const only = process.env.SWEEP_CLAUSES_ONLY ? new RegExp(process.env.SWEEP_CLAUSES_ONLY) : null;
  let clauses = 0;
  for (const [id, rows] of wanted) {
    clauses += rows.length;
    if (only && !only.test(id)) continue;
    const rule = rows.map((row) => `"${row.clause.c}" (src/lib/srd/subclasses.json, ${row.key})`).join(" / ");
    const statuses = [...new Set(rows.map((row) => row.clause.is))];
    const probe = PROBES[id];
    if (!probe || statuses.length !== 1) {
      await test(`${id}: ${rule}`, () => { throw new Error(probe ? `one probe answers clauses of two statuses (${statuses.join(", ")})` : "the ledger names a probe this suite does not have"); });
    } else if (statuses[0] === "gap") {
      const known = KNOWN[id];
      if (!known) await test(`${id}: ${rule}`, () => { throw new Error("a gap clause needs its KNOWN entry (where, severity, note)"); });
      else await gap(id, { rule, where: known.where, severity: known.severity, note: known.note }, () => probe());
    } else {
      await test(`${id}: ${rule}`, () => probe());
    }
  }
  // The ledger read against the stored text, and every probe a clause names
  // written somewhere (scripts/lib/clause-probes.mjs): a clause that points at
  // a suite nobody wrote is run by nothing.
  await test("the ledger is sound against the stored text, and every probe it names exists", async () => {
    assert.deepEqual(ledgerProblems(), []);
    const { probeProblems } = await import("./clause-probes.mjs");
    assert.deepEqual(probeProblems("arcane.json").map(({ key, c, why }) => `${key} "${c.slice(0, 40)}": ${why}`), []);
  });
  await test("every probe and every KNOWN entry answers a clause of the ledger", () => {
    assert.deepEqual(Object.keys(PROBES).filter((id) => !wanted.has(id)), [], "probes no clause names");
    assert.deepEqual(Object.keys(KNOWN).filter((id) => !wanted.has(id) || wanted.get(id)[0].clause.is !== "gap"), [], "KNOWN entries for clauses that are not gaps");
  });
  console.log(`${name}: ${wanted.size} probes for ${clauses} clauses of scripts/clauses/arcane.json${only ? ` (only ${only})` : ""}`);
  world.close();
  finish();
}
