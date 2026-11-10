// The clause ledger of the "divine" slice (scripts/clauses/divine.json): every
// authored subclass feature of the cleric, paladin, druid, ranger and
// artificer (src/lib/srd/subclasses.json), split into its smallest promises,
// each one held by a run, open as a gap, or left to the GM with the written
// reason.
//
// The coverage guard (src/lib/srd/authored-coverage.ts) calls a feature
// covered once it has any one hook. This walks the text instead: the ledger is
// the table, and the suites (scripts/test-enforce-sweep-clauses-divine*.mjs)
// run one check for every clause that names them. A clause marked held is a
// test(); a clause marked gap is a gap(), green today and failing the day the
// engine starts holding it.
//
// A feature is staged once (a scene) and answers with one check for each
// clause it speaks for:
//
//   SCENES["cleric::Warding Flare"] = async (rig) => {
//     ...stage, act, read the table...
//     return { reaction: () => assert.ok(...), uses: () => assert.equal(...) };
//   };
//
// and a clause points at "scripts/<suite>.mjs :: cleric::Warding Flare#reaction".
//
// Import this before anything from src/ (it imports enforce-world.mjs).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { openWorld } from "./enforce-world.mjs";
import { combatKit, TRAINED } from "./enforce-combat.mjs";
import { suite } from "./enforce-harness.mjs";
import { tableReader } from "./sweep-spends.mjs";

const ROOT = new URL("../../", import.meta.url);
const load = (file) => import(new URL(`src/${file}`, ROOT).href);
const readJson = (file) => JSON.parse(fs.readFileSync(new URL(file, ROOT), "utf8"));

export const SLICE = ["cleric", "paladin", "druid", "ranger", "artificer"];
export const LEDGER_FILE = "scripts/clauses/divine.json";
export const STATUSES = ["held", "gap", "left", "flavor"];

// ---- the table: the slice's features, and the ledger written for them ----

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

// Every feature of the slice in the order the file holds them. A name a class
// uses in more than one subclass (Divine Strike, Potent Spellcasting, Extra
// Attack) is keyed "class::Feature@Subclass"; every other "class::Feature".
export function sliceFeatures() {
  const classes = readJson("src/lib/srd/subclasses.json").classes;
  const out = [];
  for (const classId of SLICE) {
    const counts = new Map();
    for (const subclass of classes[classId] ?? []) {
      for (const list of Object.values(subclass.levels)) {
        for (const feature of list) counts.set(feature.n, (counts.get(feature.n) ?? 0) + 1);
      }
    }
    for (const subclass of classes[classId] ?? []) {
      for (const [level, list] of Object.entries(subclass.levels)) {
        for (const feature of list) {
          const key = counts.get(feature.n) > 1 ? `${classId}::${feature.n}@${subclass.name}` : `${classId}::${feature.n}`;
          out.push({ key, classId, group: subclass.name, level: Number(level), name: feature.n, text: feature.d, sha: sha(feature.d) });
        }
      }
    }
  }
  return out;
}

export const loadLedger = () => readJson(LEDGER_FILE);

// Words that make a stretch of rules text a promise (the coverage guard's own
// list, src/lib/srd/authored-coverage.ts MECHANICAL, with ranges and counts).
const MECHANICAL =
  /advantage|disadvantage|[+-]\d|\d|resistan|immun|\bd\d+\b|bonus action|reaction|hit points?|regain|speed|saving throw|\bsaves?\b|AC\b|armor class|critical|extra attack|damage|initiative|darkvision|modifier|spell slot|teleport|\bfly|flying|prone|charmed|frightened|incapacitat|stunned|cantrip|proficien|per (?:short|long) rest|once per|times per|invisible|restrained|turned|banished|vulnerab|heal/i;

// What is wrong with the ledger as a record of the slice: a feature with no
// entry, an entry whose text has changed since it was read (sha), a clause
// that is not the feature's own words, a status without what it must carry,
// and mechanical words no clause covers.
export function ledgerProblems(ledger = loadLedger()) {
  const problems = [];
  const features = sliceFeatures();
  const keys = new Set(features.map((feature) => feature.key));
  for (const key of Object.keys(ledger)) {
    if (!keys.has(key)) problems.push(`${key}: no such feature in the slice`);
  }
  for (const feature of features) {
    const entry = ledger[feature.key];
    if (!entry) {
      problems.push(`${feature.key}: no ledger entry`);
      continue;
    }
    if (entry.sha !== feature.sha) problems.push(`${feature.key}: the text changed (sha ${feature.sha}, ledger ${entry.sha}); read it again`);
    if (entry.group !== feature.group || entry.level !== feature.level) problems.push(`${feature.key}: group or level differs from the file`);
    if (!entry.clauses?.length) problems.push(`${feature.key}: no clauses`);
    const covered = new Array(feature.text.length).fill(false);
    for (const clause of entry.clauses ?? []) {
      const at = feature.text.indexOf(clause.c);
      if (at < 0) {
        problems.push(`${feature.key}: clause is not in the text: "${clause.c}"`);
        continue;
      }
      // Every occurrence: a clause such as "within 30 feet" may speak for two.
      for (let from = at; from >= 0; from = feature.text.indexOf(clause.c, from + 1)) covered.fill(true, from, from + clause.c.length);
      if (!STATUSES.includes(clause.is)) problems.push(`${feature.key}: "${clause.c}" has status ${clause.is}`);
      if (clause.is === "held" && !(clause.by && clause.probe)) problems.push(`${feature.key}: held "${clause.c}" needs by and probe`);
      if (clause.is === "gap" && !clause.probe && !(clause.read_only && clause.why)) problems.push(`${feature.key}: gap "${clause.c}" needs a probe, or read_only with why`);
      if (clause.is === "gap" && !clause.read_only && !(clause.severity && clause.where)) problems.push(`${feature.key}: gap "${clause.c}" needs severity and where`);
      if (clause.is === "left" && !clause.why) problems.push(`${feature.key}: left "${clause.c}" needs why`);
    }
    let rest = "";
    for (let at = 0; at <= feature.text.length; at += 1) {
      if (at < feature.text.length && !covered[at]) {
        rest += feature.text[at];
      } else if (rest) {
        if (MECHANICAL.test(rest)) problems.push(`${feature.key}: no clause covers "${rest.trim()}"`);
        rest = "";
      }
    }
  }
  return problems;
}

// The clauses that name a suite's own checks: "scripts/<file> :: <feature key>#<check>".
export function clausesFor(file, ledger = loadLedger()) {
  const prefix = `scripts/${file} :: `;
  const out = [];
  for (const [key, entry] of Object.entries(ledger)) {
    for (const clause of entry.clauses ?? []) {
      if (clause.probe?.startsWith(prefix)) out.push({ key, entry, clause, id: clause.probe.slice(prefix.length) });
    }
  }
  return out;
}

export const tally = (ledger = loadLedger()) => {
  const counts = { features: 0, clauses: 0, held: 0, gap: 0, left: 0, flavor: 0, read_only: 0 };
  for (const entry of Object.values(ledger)) {
    counts.features += 1;
    for (const clause of entry.clauses ?? []) {
      counts.clauses += 1;
      counts[clause.is] += 1;
      if (clause.read_only) counts.read_only += 1;
    }
  }
  return counts;
};

// ---- the rig: one table, put back before every scene ----

const CASTING = { cleric: "wis", druid: "wis", paladin: "cha", ranger: "wis", artificer: "int" };
// A casting modifier that is never the proficiency bonus of the level, so
// "a Wisdom-modifier number of times" and "a proficiency-bonus number of
// times" cannot pass for one another: +5, or +4 at levels 13 to 16.
export const castingScore = (level) => (level >= 13 && level <= 16 ? 18 : 20);
export const modOf = (score) => Math.floor((score - 10) / 2);
export const profOf = (level) => 2 + Math.floor((level - 1) / 4);
const slots = () => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => [String(level), { max: 3, used: 0 }]));

export async function openClauseRig() {
  const world = await openWorld({ campaign: { maxPlayers: 40 } });
  const kit = await combatKit(world);
  const { getDatabase } = await load("lib/db/core.ts");
  const encounters = await load("lib/db/encounters.ts");
  const rolls = await load("lib/db/rolls.ts");
  const campaigns = await load("lib/db/campaigns.ts");
  const training = await load("lib/srd/subclass-training.ts");
  const features = await load("lib/srd/features.ts");
  const srd = await load("lib/srd/index.ts");
  const authored = await load("lib/srd/authored-effects.ts");
  const reader = tableReader(getDatabase());

  // Five seats made once: a hero is a sheet of one of them, so a scene makes
  // no account of its own.
  const seats = [world.owner];
  for (let index = 1; index < 5; index += 1) {
    const user = world.addUser("seat");
    campaigns.setCampaignStatus(world.campaignId, "lobby");
    const joined = campaigns.joinByInviteCode(user.id, world.campaign().inviteCode);
    campaigns.setCampaignStatus(world.campaignId, "active");
    assert.ok(!("error" in joined), `could not seat a player: ${joined.error}`);
    seats.push(user);
  }
  const base = reader.snapshot();
  let seated = 0;
  let escorted = false;
  // What a scene saw, kept beside its checks' answers in a discovery run.
  const notes = {};
  let noting = "";
  const note = (label, value) => {
    notes[`${noting}: ${label}`] = value;
  };

  function reset(scene = noting) {
    noting = scene;
    escorted = false;
    reader.restore(base);
    world.clearDice();
    world.diceLog();
    seated = 0;
  }

  // A hero of the slice at a level, with a sturdy body, every training, a
  // longsword in hand, a casting score of +5 (or +4) and the other two mental
  // scores at +0, so a number taken from the wrong ability shows.
  function hero(classId, subclass, level, extra = {}) {
    const casting = CASTING[classId] ?? null;
    const score = castingScore(level);
    const abilities = { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10, ...(casting ? { [casting]: score } : {}), ...(extra.abilities ?? {}) };
    const { abilities: _abilities, spells, pick, ...rest } = extra;
    const made = world.addHero({
      user: seats[seated % (seats.length - 1)],
      name: `${subclass || classId} ${level}`,
      class: classId, subclass: subclass ?? "", level, abilities, maxHp: 100, ac: 12, acOverride: true,
      proficiencies: TRAINED, portrait: { url: "/uploads/test.png" },
      equipment: [{ name: "Longsword", qty: 1, equipped: true }],
      ...(casting ? { spellcasting: { ability: casting, slots: slots(), prepared: spells?.prepared ?? [], known: spells?.known ?? [], cantrips: spells?.cantrips ?? [] } } : {}),
      ...rest,
    });
    seated += 1;
    if (pick) choose(made, pick[0], pick[1]);
    return made;
  }

  // An option chosen for a feature, written as the builder's pick writes it.
  function choose(who, feature, value) {
    const sheet = world.sheet(who.id);
    world.patch(who.id, { features: sheet.features.map((entry) => (entry.name === feature ? { ...entry, name: `${feature} (${value})` } : entry)) });
  }

  // A fight with `first` holding the floor at (5,5), the first dummy beside
  // them at (5,6) and any other 50 feet off at (15,5); the other heroes stand
  // where the scene puts them (kit.fight parks them along the far edge).
  async function fight(first, { enemies = 1, stats = null, hp = 300 } = {}) {
    if (world.encounter()) await kit.endFight();
    // start_encounter refuses a fight too deadly for the party, and two
    // dummies are that to one low-level hero: a 20th-level fighter stands at
    // the board's far edge and takes no part.
    if (enemies > 1 && !escorted) {
      world.addHero({ user: seats[seats.length - 1], name: "Escort", class: "fighter", level: 20, maxHp: 200, portrait: { url: "/uploads/test.png" } });
      escorted = true;
    }
    const heroFaces = Object.fromEntries(world.sheets().map((sheet) => [sheet.id, sheet.id === first.id ? 19 : 3]));
    await kit.fight(enemies, { heroFaces });
    const list = world.enemies();
    list.forEach((enemy, index) => {
      kit.setEnemy(enemy.id, { maxHp: hp, currentHp: hp, ...(stats ? { stats } : {}) });
      kit.place(enemy.id, index === 0 ? 5 : 15, index === 0 ? 6 : 5 + (index - 1) * 2);
    });
    kit.place(first.id, 5, 5);
    kit.giveTurn(first.id);
    world.clearDice();
    world.diceLog();
    return list.map((enemy) => kit.enemy(enemy.id));
  }

  // The pointer on an enemy: every hero is off their turn, reactions fresh.
  function foesTurn(enemy) {
    const encounter = world.encounter();
    const place = encounter.order.findIndex((entry) => entry.enemyId === enemy.id);
    assert.ok(place >= 0, "the enemy has no place in the order");
    encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [] });
  }

  // The dummy's club at a hero: faces are the d20 and the d6 (1d6+2, +4 to hit).
  async function enemyHits(enemy, target, faces = [16, 4], args = {}) {
    kit.freshRound();
    world.clearDice();
    world.dice(...faces);
    const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id, ...args });
    world.clearDice();
    return out;
  }

  const call = async (name, args, faces = []) => {
    world.clearDice();
    world.diceLog();
    if (faces.length) world.dice(...faces);
    const out = await world.invoke(name, args);
    const unused = world.clearDice();
    return { ...out, result: out.result ?? {}, error: out.ok ? "" : String(out.error ?? ""), unused, rolled: world.diceLog() };
  };
  const spend = (who, resource, args = {}, faces = []) => call("use_resource", { characterId: who.id, resource, ...args }, faces);
  const react = (who, feature, args = {}, faces = []) => call("use_reaction", { characterId: who.id, feature, ...args }, faces);
  const channel = (who, variant, args = {}, faces = []) => spend(who, "Channel Divinity", { variant, ...args }, faces);
  const damage = (who, amount, type, args = {}) => call("apply_damage", { characterId: who.id, amount, type, ...args });
  const save = (who, ability, args = {}, faces = []) => call("request_roll", { characterId: who.id, kind: "saving_throw", ability, dc: 15, reason: "a clause check", ...args }, faces);
  const check = (who, skill, args = {}, faces = []) => call("request_roll", { characterId: who.id, kind: "skill_check", skill, dc: 15, reason: "a clause check", ...args }, faces);
  const rest = (kind) => call("take_rest", { kind });

  const hp = (who) => world.sheet(who.id).currentHp;
  const res = (who, id) => world.sheet(who.id).resources?.[id] ?? null;
  const conditions = (who) => world.sheet(who.id).conditions ?? [];
  const has = (who, name) => authored.hasCondition(world.sheet(who.id), name);
  const meta = (who, name) => {
    const all = world.sheet(who.id).conditionMeta ?? {};
    const key = Object.keys(all).find((entry) => entry === name || entry.startsWith(`${name} (`) || entry.startsWith(`${name}:`));
    return key ? all[key] : null;
  };
  const budget = () => world.encounter()?.turnBudget ?? null;
  const reacted = (who) => world.encounter()?.reactionsUsed.includes(who.id) ?? false;
  const d20s = (result) => result?.dice?.find((term) => term.sides === 20)?.dice?.length ?? 0;
  const lastRolls = (count = 12) => rolls.listRecentRolls(world.campaignId, count);
  const diceIn = (roll, sides) => (roll?.breakdown?.terms ?? []).filter((term) => term.sides === sides).reduce((sum, term) => sum + term.dice.length, 0);
  const setUsed = (who, id, used) => {
    const sheet = world.sheet(who.id);
    world.patch(who.id, { resources: { ...sheet.resources, [id]: { ...sheet.resources[id], used } } });
  };

  // A counter at the level it arrives: its size, and which rest gives it back.
  async function counterFacts(classId, subclass, level, id, extra = {}) {
    const who = hero(classId, subclass, level, extra);
    const start = res(who, id);
    if (!start) return { who, max: null, afterShort: null, afterLong: null };
    setUsed(who, id, start.max);
    await rest("short");
    const afterShort = res(who, id)?.used ?? null;
    setUsed(who, id, start.max);
    await rest("long");
    const afterLong = res(who, id)?.used ?? null;
    return { who, max: start.max, afterShort, afterLong };
  }

  // What a subclass feature trains its character in, as the creation and
  // level-up doors read it (src/lib/srd/subclass-training.ts).
  function grantOf(classId, subclass, level, name) {
    return training.subclassGrants([{ id: classId, level, subclass }]).find((grant) => grant.name === name) ?? null;
  }
  function trained(classId, subclass, level, choices = {}) {
    const grants = training.subclassGrants([{ id: classId, level, subclass }]);
    const blank = { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] };
    return training.applySubclassTraining({ proficiencies: blank, grants, choices, strict: false, picksMayWait: true });
  }

  // The player's own End Turn, and whose turn it is then.
  const endTurnOf = (who) => kit.endTurn(world.sheet(who.id).userId);
  const pointer = () => kit.current();
  const texts = new Map(sliceFeatures().map((feature) => [feature.key, feature.text]));
  const textOf = (key) => texts.get(key) ?? "";
  const feetApart = (a, b) => {
    const from = kit.token(a.id);
    const to = kit.token(b.id);
    return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) * 5;
  };

  return {
    endTurnOf, pointer, textOf, feetApart,
    world, kit, seats, reset, hero, choose, fight, foesTurn, enemyHits, call, spend, react, channel, damage, save, check, rest,
    hp, res, conditions, has, meta, budget, reacted, d20s, lastRolls, diceIn, setUsed, counterFacts, grantOf, trained,
    features, srd, authored, encounters, load, note, notes,
    enemy: (id) => kit.enemy(id),
    close: () => world.close(),
  };
}

// ---- the runner ----

const ruleOf = ({ entry, clause }) => `${entry.name} (${entry.group} ${entry.level}): "${clause.c}" (src/lib/srd/subclasses.json)`;

// Runs every check the ledger asks this suite for. With SWEEP_CLAUSES_DISCOVER
// set to a path, nothing is judged: each scene's checks are run and what they
// answered is written there, which is how a clause's first status is found.
export async function runClauseSuite(file, scenes) {
  const name = file.replace(/\.mjs$/, "");
  const { test, gap, finish } = suite(name);
  const ledger = loadLedger();
  const asked = clausesFor(file, ledger);
  const discover = process.env.SWEEP_CLAUSES_DISCOVER;
  const rig = await openClauseRig();
  const seen = {};
  const byId = new Map();
  for (const row of asked) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);

  // The ratchet on the table itself: a feature added to the slice, or words
  // changed under an entry, fails every divine suite until the ledger reads
  // it again.
  if (!discover) {
    await test(`${LEDGER_FILE} has an entry for every feature of the slice, in the words stored today`, () => assert.deepEqual(ledgerProblems(ledger), []));
  }

  for (const [sceneKey, scene] of Object.entries(scenes)) {
    rig.reset(sceneKey);
    let checks = null;
    let threw = null;
    try {
      checks = await scene(rig);
    } catch (error) {
      threw = error;
    }
    if (discover) {
      if (threw) {
        seen[`${sceneKey}#*`] = { is: "error", message: String(threw?.stack ?? threw).split("\n").slice(0, 4).join(" | ") };
        continue;
      }
      for (const [check, fn] of Object.entries(checks)) {
        try {
          await fn();
          seen[`${sceneKey}#${check}`] = { is: "pass" };
        } catch (error) {
          const assertion = error?.name === "AssertionError" || error?.code === "ERR_ASSERTION";
          seen[`${sceneKey}#${check}`] = { is: assertion ? "assert" : "error", message: String(assertion ? error.message : error?.stack ?? error).split("\n").slice(0, 3).join(" | ").slice(0, 500) };
        }
      }
      continue;
    }
    if (threw) {
      await test(`${sceneKey} (the scene)`, () => {
        throw threw;
      });
      continue;
    }
    for (const [check, fn] of Object.entries(checks)) {
      const id = `${sceneKey}#${check}`;
      const rows = byId.get(id);
      if (!rows) {
        await test(id, () => assert.fail(`no clause of ${LEDGER_FILE} names this check`));
        continue;
      }
      byId.delete(id);
      const statuses = new Set(rows.map((row) => row.clause.is));
      if (statuses.size > 1) {
        await test(id, () => assert.fail("the clauses naming this check disagree on its status"));
      } else if (statuses.has("held")) {
        await test(`${ruleOf(rows[0])} [${id}]`, fn);
      } else {
        const { clause } = rows[0];
        await gap(id, { rule: ruleOf(rows[0]), where: clause.where, severity: clause.severity, ...(clause.note ? { note: clause.note } : {}) }, fn);
      }
    }
  }
  if (discover) {
    const all = fs.existsSync(discover) ? JSON.parse(fs.readFileSync(discover, "utf8")) : {};
    all[file] = seen;
    all[`${file} notes`] = rig.notes;
    fs.writeFileSync(discover, JSON.stringify(all, null, 1));
    console.log(`${name}: discovered ${Object.keys(seen).length} checks`);
    rig.close();
    return;
  }
  for (const id of byId.keys()) {
    await test(id, () => assert.fail("the ledger names a check this suite does not run"));
  }
  console.log(`${name}: ${asked.length} clauses of ${LEDGER_FILE} across ${Object.keys(scenes).length} scenes`);
  rig.close();
  finish();
}

export { assert };
