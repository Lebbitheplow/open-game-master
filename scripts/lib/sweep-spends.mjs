// The gap sweep's "spends" generator: every limited-use thing a character can
// spend, walked from the tables the engine already has, through every door a
// table spends it by, with the whole database read before and after.
//
// The suites before this one were written feature by feature, on one path:
// a counter counted as covered once any hook named it. This walks the rows
// instead (RESOURCE_DEFS, the authored spends and reactions), builds a real
// holder at the level the row arrives, stages one fight (a foe beside the
// holder, a foe far off, a hurt ally beside them, an ally at 0 hit points) and
// plays the row by its id, by its name, from its Hand card and, for a
// reaction, through use_reaction after each trigger a hit can stage. What
// moved in the database says what the spend did:
//
//   DEAD               accepted, and only the counter and the turn's cost moved,
//                      on a row the engine says it resolves
//   GUIDANCE_ONLY      accepted, only the counter and the cost moved, and the
//                      text states a number or a condition the GM is left to apply
//   SPENT_ON_REFUSAL   refused, yet something was written
//   ID_NAME_DRIFT      the id and the name do different things
//   CARD_DRIFT         the Hand card's own call does something else than the id
//   NEEDS_PICK         the card cannot send the variant or target the engine asks
//   TRIGGER_AS_CARD    the text opens with a trigger, the Hand deals it on the
//                      holder's own turn and nothing checks the trigger
//   TRIGGER_UNCHECKED  a reaction accepted with nothing staged to react to
//   UNREACHED          no door and no staging got the row accepted
//   THROWS             a door threw instead of answering
//
// Import this before anything from src/ (it imports enforce-world.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld, seedDice } from "./enforce-world.mjs";
import { combatKit, TRAINED } from "./enforce-combat.mjs";

const SRC = new URL("../../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const readJson = (file) => JSON.parse(fs.readFileSync(new URL(file, SRC), "utf8"));

// ---- the database, read whole ----

// Tables that only keep a record of what happened: a row there is not the
// spend doing something. A roll stored is noted apart (the engine rolled).
const LOG_TABLES = new Set([
  "sheet_audit", "rolls", "campaign_events", "campaign_messages", "dm_turns", "turn_changes", "turn_rows",
  "notifications", "character_events", "fight_events",
]);
const NOISE_COLUMNS = new Set(["updated_at", "updatedAt", "next_seq", "seq", "waiting_seq", "last_seq", "event_seq"]);

export function tableReader(db) {
  const names = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .filter((row) => !/^CREATE VIRTUAL/i.test(row.sql ?? ""))
    .map((row) => row.name);
  const virtual = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL%'")
    .all()
    .map((row) => row.name);
  const tables = names.filter((name) => !virtual.some((v) => name.startsWith(`${v}_`)));
  const info = new Map(
    tables.map((name) => {
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all();
      const pk = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
      return [name, { columns: columns.map((column) => column.name), pk }];
    }),
  );
  const read = new Map(tables.map((name) => [name, db.prepare(`SELECT * FROM "${name}"`)]));

  function snapshot() {
    const out = new Map();
    for (const name of tables) {
      const rows = read.get(name).all();
      out.set(name, { rows, json: rows.map((row) => JSON.stringify(row)) });
    }
    return out;
  }

  function restore(saved) {
    const now = snapshot();
    const changed = tables.filter((name) => {
      const a = saved.get(name).json;
      const b = now.get(name).json;
      return a.length !== b.length || a.some((row, index) => row !== b[index]);
    });
    if (!changed.length) return;
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      for (const name of changed) {
        db.exec(`DELETE FROM "${name}"`);
        const { columns } = info.get(name);
        const insert = db.prepare(
          `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        );
        for (const row of saved.get(name).rows) {
          insert.run(...columns.map((column) => row[column] ?? null));
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  const keyOf = (name, row, index) => {
    const { pk } = info.get(name);
    return pk.length ? pk.map((column) => row[column]).join("|") : `#${index}`;
  };

  const parsed = (value) => {
    if (typeof value !== "string" || !/^[\[{]/.test(value)) return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  // Leaves that differ, as dotted paths, three levels into a JSON column.
  function leafDiff(before, after, path, out, depth = 0) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const objects = before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after);
    if (!objects || depth >= 3) {
      out.push({ path, before, after });
      return;
    }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      leafDiff(before[key], after[key], path ? `${path}.${key}` : key, out, depth + 1);
    }
  }

  function diff(a, b) {
    const changes = [];
    for (const name of tables) {
      const before = a.get(name);
      const after = b.get(name);
      if (before.json.length === after.json.length && before.json.every((row, index) => row === after.json[index])) continue;
      const old = new Map(before.rows.map((row, index) => [keyOf(name, row, index), row]));
      const seen = new Set();
      after.rows.forEach((row, index) => {
        const key = keyOf(name, row, index);
        seen.add(key);
        const was = old.get(key);
        if (!was) {
          changes.push({ table: name, key, column: "*", path: "+row", before: null, after: row });
          return;
        }
        for (const column of info.get(name).columns) {
          if (NOISE_COLUMNS.has(column) || was[column] === row[column]) continue;
          const leaves = [];
          leafDiff(parsed(was[column]), parsed(row[column]), "", leaves);
          for (const leaf of leaves) {
            changes.push({ table: name, key, column, path: leaf.path, before: leaf.before, after: leaf.after });
          }
        }
      });
      for (const [key, row] of old) {
        if (!seen.has(key)) changes.push({ table: name, key, column: "*", path: "-row", before: row, after: null });
      }
    }
    return changes;
  }

  return { tables, snapshot, restore, diff };
}

// ---- what the text states ----

// A number or a condition a spend's text promises: dice, a save, hit points,
// a condition by name, advantage, resistance, a distance moved.
const MECHANIC = new RegExp(
  [
    "\\b\\d+d\\d+\\b", "\\bd(?:3|4|6|8|10|12|20)s?\\b", "\\bDC\\b", "saving throw", "\\b(?:STR|DEX|CON|INT|WIS|CHA|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) save", "\\bsaves? (?:or|against|halves|for half)",
    "hit points?", "\\bHP\\b", "\\bregains?\\b", "\\bheals?\\b", "\\badvantage\\b", "\\bdisadvantage\\b", "resistan", "\\bimmun", "[+-]\\d",
    "frightened", "charmed", "stunned", "\\bprone\\b", "restrained", "blinded", "deafened", "invisible", "paralyzed", "poisoned", "incapacitated", "grappled",
    "\\bdamage\\b", "additional (?:action|attack)", "extra (?:action|attack|melee attack)", "teleport[^.]{0,40}\\d+ ?(?:ft|feet)", "fly(?:ing)? speed", "speed (?:rises|increases|is doubled|doubles)",
    "\\breroll", "\\bAC\\b", "armor class", "\\bcritical\\b", "spell slot", "automatic(?:ally)? hits?", "automatic hit", "drops? to 1\\b", "makes? (?:one|an|a) (?:\\w+ )?attack",
  ].join("|"),
  "i",
);
export const statesMechanic = (text) => MECHANIC.test(text ?? "");

// ---- the rig ----

const ABILITIES = { str: 16, dex: 16, con: 14, int: 16, wis: 16, cha: 16 };
const CASTING_ABILITY = {
  bard: "cha", cleric: "wis", druid: "wis", paladin: "cha", ranger: "wis", sorcerer: "cha", warlock: "cha", wizard: "int", artificer: "int",
};
// A pick the builder's owed choices write as a feature of its own.
const EXTRA_FEATURES = { "Draconic Bloodline": ["Dragon Ancestor: Red"] };
const slots = () => Object.fromEntries([1, 2, 3, 4, 5].map((level) => [String(level), { max: 3, used: 1 }]));

export async function openSpendsRig() {
  const world = await openWorld({ campaign: { maxPlayers: 400 } });
  const kit = await combatKit(world);
  const { getDatabase } = await load("lib/db/core.ts");
  const db = getDatabase();
  const reader = tableReader(db);
  const encounters = await load("lib/db/encounters.ts");
  const { activePublicEncounter } = await load("lib/db/encounter-view.ts");
  const { deriveHand, FRESH_TURN } = await load("lib/battlemap/hand.ts");
  const { turnFromEncounter } = await load("lib/battlemap/hand-table.ts");
  const { reactionCards } = await load("lib/battlemap/hand-react.ts");
  const { directCardCalls } = await load("lib/dm/intent-logic.ts");
  const resources = await load("lib/srd/class-resources.ts");
  const authored = await load("lib/srd/authored-effects.ts");
  const features = await load("lib/srd/features.ts");
  const classes = await load("lib/classes/index.ts");
  const { textKey } = await load("lib/language/text-logic.ts");

  // The two who stand with every holder: a hurt ally beside them and one at 0.
  const ally = world.addHero({ name: "Ally Near", class: "fighter", subclass: "Champion", level: 5, abilities: ABILITIES, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
  const fallen = world.addHero({ name: "Ally Down", class: "fighter", subclass: "Champion", level: 5, abilities: ABILITIES, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
  const base = reader.snapshot();

  function heroFor(build) {
    const casting = CASTING_ABILITY[build.classId] ?? (classes.findCustomClass(build.classId)?.spellListFrom ? "int" : null);
    const hero = world.addHero({
      user: world.owner,
      name: "Holder",
      class: build.classId,
      subclass: build.subclass ?? "",
      level: build.level,
      race: build.race ?? "human",
      ...(build.racialChoices ? { racialChoices: build.racialChoices } : {}),
      feats: build.feats ?? [],
      features: build.features ?? [],
      abilities: ABILITIES,
      maxHp: 100,
      proficiencies: TRAINED,
      portrait: { url: "/uploads/test.png" },
      equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }],
      ...(casting ? { spellcasting: { ability: casting, slots: slots(), prepared: [], known: [], cantrips: [] } } : {}),
    });
    // An option a gate asks for ("Totem Spirit (Bear)"), written as the
    // builder's pick writes it: in the feature's own name.
    // The builder leaves no option unpicked, so neither does a holder: every
    // feature with options carries one ("Storm Aura (Desert)"), the first
    // unless the row asks for another, and a Draconic sorcerer an ancestor.
    const sheet = world.sheet(hero.id);
    const picks = new Map();
    for (const held of authored.heldAuthored(sheet)) {
      const choose = (held.entry.spends ?? []).find((spend) => spend.does.kind === "choose");
      if (choose && !held.choice) picks.set(textKey(held.name), choose.does.options[0]);
    }
    if (build.pick) picks.set(textKey(build.pick.feature), build.pick.value);
    const extra = EXTRA_FEATURES[build.subclass ?? ""] ?? [];
    if (picks.size || extra.length) {
      world.patch(hero.id, {
        features: [
          ...sheet.features.map((feature) => (picks.has(textKey(feature.name)) ? { ...feature, name: `${feature.name} (${picks.get(textKey(feature.name))})` } : feature)),
          ...extra.map((name) => ({ name, classId: build.classId, source: "class" })),
        ],
      });
    }
    return hero;
  }

  // One fight for a build: the holder at (5,5) with the floor, a foe beside
  // them, a foe as far off as the board goes, the hurt ally beside them and
  // the fallen one a square further.
  async function stage(build) {
    const began = Date.now();
    try {
      return await stageOnce(build);
    } finally {
      times.stages += 1;
      times.stageMs += Date.now() - began;
    }
  }
  async function stageOnce(build) {
    reader.restore(base);
    seedDice(11);
    const holder = heroFor(build);
    await kit.fight(2, { heroFaces: { [holder.id]: 19, [ally.id]: 12, [fallen.id]: 11 } });
    const [near, far] = world.enemies();
    for (const enemy of [near, far]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
    const board = kit.map();
    const farX = Math.min(board.width - 1, 5 + 16);
    kit.place(holder.id, 5, 5);
    kit.place(near.id, 5, 6);
    kit.place(ally.id, 4, 5);
    kit.place(fallen.id, 6, 5);
    kit.place(far.id, farX, 5);
    world.patch(holder.id, { currentHp: 70, tempHp: 0 });
    world.patch(ally.id, { currentHp: 20 });
    // As apply_damage leaves a hero it drops (src/lib/dm/death.ts).
    world.patch(fallen.id, { currentHp: 0, conditions: ["unconscious", "prone"], conditionMeta: {}, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    kit.giveTurn(holder.id);
    world.clearDice();
    world.diceLog();
    return { holder: world.sheet(holder.id), near, far, ally, fallen, farFeet: (farX - 5) * 5, snapshot: reader.snapshot() };
  }

  // The pointer on a foe: the holder is off their turn, their reaction fresh.
  function foesTurn(scene) {
    const encounter = world.encounter();
    const place = encounter.order.findIndex((entry) => entry.enemyId === scene.near.id);
    encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [] });
  }

  // One call from a staged scene: the scene put back, the dice seeded, the
  // call made, and everything that moved.
  const times = { attempts: 0, attemptMs: 0, stages: 0, stageMs: 0, restoreMs: 0 };
  async function attempt(scene, from, name, args) {
    const began = Date.now();
    try {
      return await attemptOnce(scene, from, name, args);
    } finally {
      times.attempts += 1;
      times.attemptMs += Date.now() - began;
    }
  }
  async function attemptOnce(scene, from, name, args) {
    const t0 = Date.now();
    reader.restore(from);
    times.restoreMs += Date.now() - t0;
    seedDice(7);
    world.clearDice();
    world.diceLog();
    let out;
    try {
      out = await world.invoke(name, args);
    } catch (error) {
      return { name, args, threw: String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "), ok: false, changes: [] };
    }
    const changes = reader.diff(from, reader.snapshot());
    return { name, args, ok: Boolean(out?.ok), error: out?.ok ? null : String(out?.error ?? ""), kind: out?.ok ? null : out?.refused ? "refused" : out?.retry ? "retry" : "other", result: out?.ok ? out.result : null, changes, dice: world.diceLog().length };
  }

  function turnOf(sheet, myTurn) {
    return turnFromEncounter(activePublicEncounter(world.campaignId), sheet, { myTurn });
  }

  return {
    world, kit, db, reader, base, ally, fallen, stage, foesTurn, attempt, turnOf, textKey, times,
    deriveHand, FRESH_TURN, reactionCards, directCardCalls, activePublicEncounter,
    resources, authored, features, classes, encounters,
    close: () => world.close(),
  };
}

// ---- reading what moved ----

// The parts of a turn budget that are the cost of acting, not what a feature gave.
const COST_KEYS = /^(?:actionUsed|bonusUsed|reactionUsed|oncePerTurn|ownerId|turnKey|round|attacksMade|attacksAllowed|spent|log|notes?)\b/;

// Sorts a call's changes: the counters of the holder, the cost of the turn,
// the record tables, and everything else, which is the spend doing something.
export function readChanges(scene, changes) {
  const out = { counters: [], cost: [], effects: [], rolls: 0, logs: 0 };
  for (const change of changes) {
    if (change.table === "rolls") {
      out.rolls += 1;
      continue;
    }
    if (LOG_TABLES.has(change.table)) {
      out.logs += 1;
      continue;
    }
    if (change.table === "character_sheets" && change.key === scene.holder.id && /^resources/.test(change.column)) {
      out.counters.push(change);
      continue;
    }
    if (change.table === "encounters" && /^(?:turn_budget|reactions_used)/.test(change.column)) {
      if (/^reactions_used/.test(change.column) || COST_KEYS.test(change.path) || change.path === "") {
        // A budget written whole (null before): its grants count as effects.
        if (change.path === "" && change.after && typeof change.after === "object" && !Array.isArray(change.after)) {
          const grants = Object.entries(change.after).filter(([key, value]) => !COST_KEYS.test(key) && value && !(Array.isArray(value) && !value.length));
          if (grants.length) out.effects.push({ ...change, path: grants.map(([key]) => key).join(","), after: Object.fromEntries(grants) });
        }
        out.cost.push(change);
        continue;
      }
    }
    if (change.table === "campaigns") {
      // The campaign row's counters (the next sequence number) tick on every write.
      if (/seq/i.test(change.column) || /seq/i.test(change.path)) continue;
    }
    out.effects.push(change);
  }
  return out;
}

const brief = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

// What a call did, in a line a person can read and two calls can be compared by.
export function signature(scene, tried) {
  if (!tried) return "no call";
  if (tried.threw) return `THREW ${tried.threw}`;
  const read = readChanges(scene, tried.changes);
  const who = (change) => {
    if (change.table === "character_sheets") return change.key === scene.holder.id ? "holder" : change.key === scene.ally.id ? "ally" : change.key === scene.fallen.id ? "fallen" : "sheet?";
    if (change.table === "encounter_enemies") return change.key === scene.near.id ? "near" : change.key === scene.far.id ? "far" : "enemy?";
    return change.table;
  };
  const part = (list) => list.map((change) => `${who(change)}.${change.column}${change.path ? `.${change.path}` : ""}=${brief(change.after)}`).sort().join("; ");
  const names = new Map([[scene.holder.id, "<holder>"], [scene.ally.id, "<ally>"], [scene.fallen.id, "<fallen>"], [scene.near.id, "<near>"], [scene.far.id, "<far>"]]);
  return `${tried.ok ? "ok" : tried.kind} | counters: ${part(read.counters)} | cost: ${part(read.cost)} | effects: ${part(read.effects)} | rolls ${read.rolls}`
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => names.get(id) ?? "<id>");
}

export { ABILITIES, LOG_TABLES, assert, readJson, SRC };
