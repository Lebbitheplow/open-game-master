// What the doors sweeps (scripts/test-enforce-sweep-doors*.mjs) share: the
// whole database read as one value (so "refused" can be held to "and nothing
// changed"), a way back to a stored state (so one staged fight serves a whole
// matrix), the staged table itself, and the two tool doors.
//
// Import scripts/lib/enforce-world.mjs first, as every enforcement suite does.
//
//   const db = await dbTools();
//   const before = db.snapshot();
//   ... a call ...
//   db.changed(before)        // ["character_sheets: 1 row changed", ...]
//   db.restore(before);       // the table as it stood
import { combatKit, DUMMY, TRAINED } from "./enforce-combat.mjs";
import { cleric, wizard } from "./enforce-spells.mjs";

// Tables a refused call may write without anything having happened in the
// game, each with the reason it is left out of "the database unchanged".
export const BOOKKEEPING = {
  dm_turns: "invokeEngine opens (and closes) a person's turn for every call, refused or not (invoke.ts humanTurnFor)",
  dm_turn_trace: "the trace of the call itself",
  campaign_events: "the stream's replay log: a refusal publishes nothing a seat keeps, but ephemeral rows age out here",
  sqlite_sequence: "SQLite's own counter",
  sessions: "the sign-in a route handler is called with (enforce-world.mjs signIn)",
};

export async function dbTools() {
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const db = getDatabase();
  const tableRows = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  // Virtual tables and their shadow tables are rebuilt by their triggers.
  const virtual = tableRows.filter((row) => /^CREATE VIRTUAL/i.test(row.sql ?? "")).map((row) => row.name);
  const names = tableRows
    .map((row) => row.name)
    .filter((name) => !virtual.includes(name) && !virtual.some((v) => name.startsWith(`${v}_`)));

  const key = (rows) => JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));

  function snapshot() {
    const out = new Map();
    for (const name of names) {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all();
      out.set(name, { rows, key: key(rows) });
    }
    return out;
  }

  // The tables that differ from a snapshot, bookkeeping left out, each with
  // what changed in a few words.
  function changed(before, { all = false } = {}) {
    const out = [];
    for (const name of names) {
      if (!all && BOOKKEEPING[name]) {
        continue;
      }
      const rows = db.prepare(`SELECT * FROM "${name}"`).all();
      const was = before.get(name);
      if (!was || key(rows) === was.key) {
        continue;
      }
      out.push(`${name}: ${describe(was.rows, rows)}`);
    }
    return out;
  }

  function describe(was, now) {
    if (was.length !== now.length) {
      return `${was.length} -> ${now.length} rows`;
    }
    const cols = new Set();
    for (let index = 0; index < was.length; index += 1) {
      for (const col of Object.keys(now[index] ?? {})) {
        if (key(was[index]?.[col]) !== key(now[index]?.[col])) {
          cols.add(col);
        }
      }
    }
    return `changed ${[...cols].join(", ")}`;
  }

  // Back to a snapshot, every table that differs rewritten whole. Foreign
  // keys are off while it runs (a parent row deleted must not take its
  // children, which are restored from their own table).
  function restore(before) {
    const differs = names.filter((name) => {
      const was = before.get(name);
      return was && key(db.prepare(`SELECT * FROM "${name}"`).all()) !== was.key;
    });
    if (!differs.length) {
      return;
    }
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      for (const name of differs) {
        const was = before.get(name);
        db.exec(`DELETE FROM "${name}"`);
        if (!was.rows.length) {
          continue;
        }
        const cols = Object.keys(was.rows[0]);
        const insert = db.prepare(
          `INSERT INTO "${name}" (${cols.map((col) => `"${col}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        );
        for (const row of was.rows) {
          insert.run(...cols.map((col) => row[col]));
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

  return { db, names, snapshot, changed, restore };
}

// ---- the staged table ----

export const BROM = {
  name: "Brom", class: "fighter", level: 5, maxHp: 44,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
  proficiencies: { ...TRAINED, saves: ["str", "con"], skills: ["athletics", "perception", "stealth"] },
  equipment: [
    { name: "Longsword", qty: 1, equipped: true },
    { name: "Shield", qty: 1, equipped: true },
    { name: "Chain Mail", qty: 1, equipped: true },
    { name: "Dagger", qty: 2 },
    { name: "Potion of Healing", qty: 2 },
    { name: "Rope, hempen (50 feet)", qty: 1 },
  ],
  gold: 50,
  features: [
    { name: "Second Wind", source: "class" },
    { name: "Action Surge", source: "class" },
    { name: "Extra Attack", source: "class" },
    { name: "Fighting Style: Defense", source: "choice" },
  ],
};

// Three heroes, each a player's own (the owner keeps the GM's chair and no
// character), two dummies, initiative in with the heroes first in the order
// they were added, Brom beside the first dummy and everyone else in reach of
// a spell and out of reach of a blade.
export async function stageFight(world, { enemies = 2, pet = true, absent = null, last = null, bromIs = {} } = {}) {
  const brom = world.addHero({ user: world.addUser(), ...BROM, ...bromIs });
  const priest = cleric(5);
  const sera = world.addHero({
    user: world.addUser(), name: "Sera", maxHp: 33, gold: 50, ...priest,
    spellcasting: { ...priest.spellcasting, cantrips: [...priest.spellcasting.cantrips, "Spare the Dying"] },
    equipment: [...(priest.equipment ?? []), { name: "Healer's Kit", qty: 1 }, { name: "Mace", qty: 1 }],
  });
  const wren = world.addHero({ user: world.addUser(), name: "Wren", maxHp: 27, gold: 50, ...wizard(5) });
  const heroes = { brom, sera, wren };
  const kit = await combatKit(world);
  if (pet) {
    const called = await world.invoke("summon_pet", { characterId: brom.id, kind: "other", form: "Mastiff", name: "Biter", hp: 9, ac: 12 });
    if (!called.ok) {
      throw new Error(`the stage's pet was refused: ${called.error}`);
    }
  }
  // `last`: that hero rolls under the enemies, so the enemies act between
  // the other heroes and them. `absent`: the story has that hero elsewhere.
  const heroFaces = { [brom.id]: 19, [sera.id]: 17, [wren.id]: 16 };
  if (last) {
    heroFaces[heroes[last].id] = 1;
  }
  if (absent) {
    // Opened by hand: world.beginFight asks initiative of everyone the
    // opening left out, which is how the story brings an absent hero in.
    world.clearDice();
    world.dice(3, ...Object.keys(heroes).filter((key) => key !== absent).map((key) => heroFaces[heroes[key].id]));
    const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: enemies }], absent: [heroes[absent].id] });
    world.clearDice();
    if (!started.ok || !world.encounter().awayIds.includes(heroes[absent].id) || !world.encounter().orderReady) {
      throw new Error(`the away stage did not open: ${started.error ?? JSON.stringify(world.encounter().awayIds)}`);
    }
    for (const enemy of world.enemies()) {
      kit.setEnemy(enemy.id, { ac: DUMMY.ac, maxHp: DUMMY.maxHp, stats: { ...DUMMY } });
    }
    kit.openField();
    kit.scatter();
    world.diceLog();
  } else {
    await kit.fight(enemies, { heroFaces, enemyFace: last ? 10 : 3 });
  }
  const foes = world.enemies();
  const spots = { brom: [5, 5], sera: [4, 5], wren: [3, 5] };
  for (const [key, [x, y]] of Object.entries(spots)) {
    if (key !== absent) {
      kit.place(heroes[key].id, x, y);
    }
  }
  kit.place(foes[0].id, 5, 6);
  if (foes[1]) {
    kit.place(foes[1].id, 9, 5);
  }
  if (!absent && !last) {
    kit.giveTurn(brom.id);
  }
  return { world, kit, brom, sera, wren, foes, DUMMY };
}

// On a stage built with `last`, the hero before the enemies ends their turn:
// the pointer walks past the enemies still to act and rests on the last hero
// (src/lib/dm/enemies-due.ts), whose turn is held until they have acted.
export async function passToEnemies(t, lastKey) {
  const tools = await import("../../src/lib/dm/encounter-tools.ts");
  const { world } = t;
  const last = t[lastKey];
  const before = world.encounter().order.filter((entry) => entry.kind === "pc" && entry.characterId !== last.id).at(-1);
  t.kit.giveTurn(before.characterId);
  tools.endOwnTurn(world.campaignId, world.sheet(before.characterId).userId);
  const now = world.encounter();
  if (now.order[now.turnIndex].characterId !== last.id || !(now.legendary.due ?? []).length || now.legendary.turnStart !== last.id) {
    throw new Error(`the stage did not hand the turn to the enemies: pointer on ${now.order[now.turnIndex].name}, due ${JSON.stringify(now.legendary.due)}`);
  }
  return now;
}

// ---- the two tool doors ----

export async function doors(world) {
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const { createDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { getSheetById } = await import("../../src/lib/db/sheets.ts");
  return {
    // The GM console's form, a person in the chair.
    console: (name, args) => invokeEngine(world.campaign(), { kind: "human", userId: world.owner.id }, { name, args }),
    // The AI GM's tool call on a turn of its own, after the acting
    // character's player has spoken (src/lib/dm/player-word.ts).
    ai: async (name, args, speakerId) => {
      const speaker = speakerId ? getSheetById(speakerId) : null;
      if (speaker) {
        world.say("player", "I do it now.", speaker);
      }
      const turn = createDmTurn(world.campaignId, [], "ai");
      return invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
    },
  };
}

// One line for a finding's "observed": the answer a door gave.
export function answer(outcome) {
  if (outcome.ok) {
    return `ok ${JSON.stringify(outcome.result).slice(0, 160)}`;
  }
  const kind = outcome.retry ? "retry" : outcome.refused ? `refused:${outcome.refused}` : "no kind";
  return `[${kind}] ${String(outcome.error).slice(0, 200)}`;
}
