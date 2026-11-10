// The spell table as the lifecycle sweep walks it: every bundled spell whose
// mechanics row lays a condition, a buff or a pool of hit points, with the
// duration its SRD text prints, a way to cast it from its real source, and a
// picture of everything a spell can leave on a table (conditions, the areas
// on the board, concentration), so a test can say "all of it went, and
// nothing else did".
//
// Import scripts/lib/enforce-world.mjs before this file.
import fs from "node:fs";
import path from "node:path";
import { caster } from "./enforce-spell-kit.mjs";
import { TRAINED } from "./enforce-combat.mjs";
import { stage } from "./sweep-lifecycle-stage.mjs";

const { spellMechFor, authoredSpellRow } = await import("../../src/lib/srd/spell-mechanics.ts");
const facts = await import("../../src/lib/srd/spell-facts.ts");
const { textKey } = await import("../../src/lib/language/text-logic.ts");
const maps = await import("../../src/lib/db/battle-maps.ts");
const { getDatabase } = await import("../../src/lib/db/core.ts");

const book = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../src/lib/rulebook/srd-5.1.json"), "utf8"),
);
const PAGES = new Map(book.pages.filter((page) => page.kind === "spell").map((page) => [textKey(page.title), page]));

// "Concentration, up to 1 minute" -> { concentration: true, rounds: 10 }.
// rounds: null for Instantaneous and Special, Infinity for "Until dispelled".
export function readDuration(line) {
  const text = String(line ?? "").trim();
  const concentration = /^concentration/i.test(text);
  const match = /(\d+)\s+(round|minute|hour|day)s?/i.exec(text.replace(/\bone\b/i, "1"));
  let rounds = null;
  if (match) {
    const each = { round: 1, minute: 10, hour: 600, day: 14400 }[match[2].toLowerCase()];
    rounds = Number(match[1]) * each;
  } else if (/until dispelled/i.test(text)) {
    rounds = Infinity;
  }
  return { text, concentration, rounds };
}

// The SRD page of a spell (src/lib/rulebook/srd-5.1.json), or the authored
// row's own words for a spell the SRD does not carry.
export function spellText(name) {
  for (const candidate of facts.spellNamesOf(name)) {
    const page = PAGES.get(textKey(candidate));
    if (page) {
      const duration = /\*\*Duration:\*\*\s*([^\n]+)/.exec(page.md)?.[1] ?? "";
      return { source: `SRD 5.1, ${page.title}`, duration, md: page.md };
    }
  }
  const authored = authoredSpellRow(name);
  if (authored) {
    return {
      source: `src/lib/srd/authored-spells.json, ${authored.name}`,
      duration: `${authored.concentration && !/^concentration/i.test(authored.duration ?? "") ? "Concentration, up to " : ""}${authored.duration ?? ""}`,
      md: authored.desc,
    };
  }
  return null;
}

export function spellRows() {
  const rows = [];
  for (const name of facts.bundledSpellNames()) {
    const mech = spellMechFor([name]);
    if (!mech || !(mech.condition || mech.buff || mech.hitPointPool)) {
      continue;
    }
    const fact = facts.bundledSpellFacts(name);
    const text = spellText(name);
    rows.push({
      name,
      mech,
      level: fact?.level ?? 0,
      concentration: Boolean(fact?.concentration),
      range: fact?.range ?? null,
      text,
      printed: text ? readDuration(text.duration) : null,
      kind: mech.buff ? "buff" : mech.condition ? "condition" : "pool",
    });
  }
  return rows;
}

// A level-17 wizard holding every spell of the table, whoever's list it is on
// (the engine reads the prepared list, not the class list), and the fighter
// they cast on.
export function casters(rows) {
  return [
    {
      name: "Kara",
      class: "fighter",
      level: 5,
      maxHp: 44,
      abilities: { str: 16, dex: 14, con: 14 },
      proficiencies: { ...TRAINED, saves: ["str", "con"] },
      equipment: [
        { name: "Longsword", qty: 1, equipped: true },
        { name: "Longbow", qty: 1 },
        { name: "Arrows (20)", qty: 1 },
        { name: "Quarterstaff", qty: 1 },
      ],
    },
    {
      name: "Mira",
      maxHp: 120,
      gold: 5000,
      // The costly components the table's spells name, each a line with its worth.
      equipment: [
        { name: "Tiny reliquary", qty: 1, worth: 1000 },
        { name: "Miniature platinum sword", qty: 1, worth: 250 },
        { name: "Object engraved with a symbol of the Outer Planes", qty: 1, worth: 500 },
        { name: "Undead eyeball encased in a gem", qty: 1, worth: 150 },
        { name: "Jade circlet", qty: 1, worth: 1500 },
        { name: "Diamond dust", qty: 1, worth: 100 },
        { name: "Ointment for the eyes", qty: 1, worth: 25 },
        { name: "Platinum ring", qty: 2, worth: 50 },
        { name: "Gem-encrusted bowl", qty: 1, worth: 1000 },
      ],
      ...caster("wizard", "int", [...new Set([...rows.map((row) => row.name), ...SWAPS])], [], 17),
    },
  ];
}

// Everything a spell can leave on the table, as a set of words.
export function carriedState(ctx) {
  const state = new Set();
  for (const sheet of ctx.world.sheets()) {
    for (const condition of sheet.conditions ?? []) {
      state.add(`${sheet.name} has ${condition}`);
    }
    if (sheet.concentratingOn) {
      state.add(`${sheet.name} concentrates on ${sheet.concentratingOn}`);
    }
  }
  for (const enemy of ctx.world.enemies()) {
    for (const condition of enemy.conditions ?? []) {
      state.add(`${enemy.displayName} has ${condition}`);
    }
  }
  const encounter = ctx.world.encounter();
  const map = encounter ? maps.getBattleMapForEncounter(encounter.id) : null;
  if (map) {
    const row = getDatabase().prepare(`SELECT spell_zones_json, zones_json FROM battle_maps WHERE id = ?`).get(map.id);
    for (const column of ["spell_zones_json", "zones_json"]) {
      let zones = [];
      try {
        zones = JSON.parse(row?.[column] || "[]");
      } catch {
        zones = [];
      }
      for (const zone of Array.isArray(zones) ? zones : Object.values(zones ?? {})) {
        state.add(`an area of ${zone?.spell ?? zone?.name ?? zone?.label ?? zone?.id ?? "?"} on the board`);
      }
    }
  }
  const effects = getDatabase().prepare(`SELECT name, target_id FROM active_effects WHERE campaign_id = ?`).all(ctx.world.campaignId);
  for (const effect of effects) {
    state.add(`effect ${effect.name} on ${effect.target_id}`);
  }
  return state;
}

export const added = (before, after) => [...after].filter((entry) => !before.has(entry));

// The meta the cast wrote for a condition, wherever it landed.
export function metaOf(ctx, condition) {
  for (const holder of [...ctx.world.sheets(), ...ctx.world.enemies()]) {
    const found = Object.entries(holder.conditionMeta ?? {}).find(([name]) => name === condition);
    if (found) {
      return found[1];
    }
  }
  return null;
}

// Concentration spells on the caster herself, to swap to.
const SWAPS = ["Blur", "Expeditious Retreat", "Divine Favor"];

// Creature types a spell's text asks of its target.
const TARGET_TYPE = { "Dominate Beast": "beast", "Animal Friendship": "beast" };
// Spells whose buff rides on a marked foe.
const MARKS_A_FOE = new Set(["Hunter's Mark", "Hex"]);
// A form the spell's own picker needs.
const FORM = { Polymorph: "Wolf", "Animal Shapes": "Wolf", "True Polymorph": "Wolf", Shapechange: "Wolf" };

// "allies" that leave the caster out: she must stay able to cast.
const OTHERS_ONLY = new Set(["Animal Shapes"]);



// One casting of a row from its real source: the wizard, on her turn in a
// fight (or at rest for `calm`), at the first dummy or on the fighter.
export async function castRow(row, kind = "fight", { inside = false } = {}) {
  const ctx = await stage(kind, { heroes: casters([row]) });
  const { world, kit, hero, mage, e1 } = ctx;
  if (kind === "fight" && row.kind === "buff") {
    kit.place(mage.id, 6, 6);
  } else if (kind === "fight") {
    // A spell cast at a foe: the fighter stands beside the foe, where an area
    // laid around it will catch them on their turn, and the wizard stands as
    // far back as the spell's range lets her, out of her own area.
    const range = row.range?.kind === "feet" ? row.range.feet : row.range?.kind === "touch" ? 5 : 10;
    // `inside`: beside the foe instead, in the area she lays around it.
    const back = inside ? 1 : range >= 60 ? 9 : range >= 30 ? 5 : range > 5 ? 2 : 1;
    kit.place(e1.id, 12, 5);
    kit.place(ctx.e2.id, 12, 12);
    kit.place(hero.id, 13, 5);
    kit.place(mage.id, 12 - back, 5);
  }
  if (kind === "fight") {
    // Hit points enough to live through a minute of a spell's own damage; a
    // pool of hit points (Sleep, Color Spray) needs few.
    const hp = row.kind === "pool" ? 8 : Math.min(900, row.mech.condition?.hpAtMost ?? 900);
    kit.setEnemy(e1.id, { maxHp: hp, currentHp: hp, stats: { type: TARGET_TYPE[row.name] ?? "humanoid" } });
    kit.giveTurn(mage.id);
  }
  // A mark on each holder that no spell laid: what "nothing else goes" reads.
  world.patch(hero.id, { conditions: ["marked by the test"] });
  const before = carriedState(ctx);
  const level = row.level || undefined;
  const variant = FORM[row.name] ?? row.mech.buff?.variants?.[0] ?? null;
  const laid = row.mech.condition?.variants?.[0] ?? null;
  world.clearDice();
  let out;
  if (row.name === "Absorb Elements" && kind === "fight") {
    // A reaction: its trigger is a hit of fire, staged as the server records one.
    world.patch(mage.id, { currentHp: world.sheet(mage.id).currentHp - 6 });
    await world.hitBy(mage.id, { enemyId: e1.id, name: e1.displayName, total: 19, vsAc: 12, raw: 6, type: "fire" });
    out = await world.invoke("use_reaction", { characterId: mage.id, feature: "Absorb Elements", hit: e1.id, level: 1 });
  } else if (row.kind === "buff") {
    const target = row.mech.buff.target;
    out = await world.invoke("cast_buff", {
      characterId: mage.id,
      spell: row.name,
      ...(level ? { level } : {}),
      ...(target === "self" ? {} : { targetCharacterIds: target === "allies" && !OTHERS_ONLY.has(row.name) ? [hero.id, mage.id] : [hero.id] }),
      ...(variant ? { variant } : {}),
      ...(MARKS_A_FOE.has(row.name) && e1 ? { targetEnemyId: e1.id } : {}),
    });
  } else if (kind === "fight" && row.mech.resolution === "attack") {
    // An attack roll lands on an 18; every save after it is a 1.
    world.dice(18, ...new Array(24).fill(1));
    out = await world.invoke("pc_attack", { characterId: mage.id, targetEnemyId: e1.id, spell: row.name, ...(level ? { level } : {}) });
  } else if (kind === "fight") {
    // Every save is a 1; a pool of hit points rolls high enough to take the dummy.
    world.dice(...new Array(24).fill(row.kind === "pool" ? 8 : 1));
    out = await world.invoke("cast_at_enemy", {
      characterId: mage.id,
      targetEnemyId: e1.id,
      spell: row.name,
      ...(level ? { level } : {}),
      ...(row.mech.save ? { saveAbility: row.mech.save } : {}),
      ...(laid ? { condition: laid } : {}),
    });
    if (!out.ok && /aoe_damage/.test(out.error ?? "")) {
      world.clearDice();
      world.dice(...new Array(24).fill(1));
      out = await world.invoke("aoe_damage", { casterCharacterId: mage.id, spell: row.name, ...(level ? { level } : {}), enemyIds: [e1.id] });
    }
  } else {
    out = { ok: false, error: "a spell cast at a foe needs a fight" };
  }
  world.clearDice();
  world.diceLog();
  const after = carriedState(ctx);
  return { ctx, out, before, after, carried: added(before, after) };
}

// ---- the ways a spell ends ----

// What of a casting must be gone once the spell has ended: every condition,
// area and concentration it laid. Falling prone is the one thing a spell
// leaves behind by the rules (a creature knocked down stands up itself).
export const mustGo = (carried) => carried.filter((entry) => !/ has prone$/.test(entry));

// The caster takes up another concentration spell.
export async function swapConcentration(cast, row) {
  const { world, kit, mage } = cast.ctx;
  const other = SWAPS.find((name) => name !== row.name);
  if (world.encounter()) {
    kit.giveTurn(mage.id);
  }
  const out = await world.invoke("cast_buff", {
    characterId: mage.id,
    spell: other,
  });
  return { out, other };
}

// The caster drops to 0 hit points, no further.
export function dropCaster(cast) {
  const { world, mage } = cast.ctx;
  const sheet = world.sheet(mage.id);
  world.dice(1);
  return world.invoke("apply_damage", { characterId: mage.id, amount: sheet.currentHp + (sheet.tempHp ?? 0), type: "force" });
}

export function stunCaster(cast) {
  const { world, mage } = cast.ctx;
  return world.invoke("set_condition", { characterId: mage.id, condition: "stunned", rounds: 2 });
}

// Every condition on the table that names the row's spell as what laid it,
// whenever it was laid: at the cast, or later by the spell's area on someone
// who walked in or began a turn there.
export function strays(cast, row) {
  const names = new Set(facts.spellNamesOf(row.name).map((name) => textKey(name)));
  const found = [];
  for (const holder of [...cast.ctx.world.sheets(), ...cast.ctx.world.enemies()]) {
    for (const [condition, meta] of Object.entries(holder.conditionMeta ?? {})) {
      for (const instance of [meta, ...(meta?.others ?? [])]) {
        if (instance?.spell && names.has(textKey(instance.spell)) && (holder.conditions ?? []).includes(condition) && condition !== "prone") {
          found.push(`${holder.name ?? holder.displayName} has ${condition} (laid by ${instance.spell})`);
        }
      }
    }
  }
  return found;
}

// The words of `carried` still true of the table.
export function left(cast, carried = mustGo(cast.carried)) {
  const now = carriedState(cast.ctx);
  return carried.filter((entry) => now.has(entry));
}

// ---- walking time ----

const { kit: conditionsKit } = await import("./enforce-conditions.mjs");

// The order walked until the round turns over, `count` times; every save a
// creature makes on the way is a 1.
export function walkRounds(cast, count) {
  const { world } = cast.ctx;
  const turns = conditionsKit(world);
  for (let wrap = 0; wrap < count; wrap += 1) {
    const round = world.encounter()?.round;
    if (round === undefined) {
      throw new Error("the fight ended while the rounds were walked");
    }
    for (let turn = 0; turn < 12 && world.encounter()?.round === round; turn += 1) {
      world.clearDice();
      world.dice(...new Array(8).fill(1));
      turns.skipTurn();
    }
    world.clearDice();
    if (world.encounter()?.round !== round + 1) {
      throw new Error(`the round did not turn over from ${round}`);
    }
  }
}

// One runner for the spell suites: a row's check is a test, or a gap when
// KNOWN names it, and a report line when SWEEP_REPORT is set.
export function runner({ name, harness, known, rules, report }) {
  return async function check(row, checkName, fn) {
    const id = `${row.name}/${checkName}`;
    const entry = known[id];
    const run = async () => {
      try {
        await fn();
      } catch (error) {
        report?.push({ id, error: String(error?.message ?? error).split("\n")[0].slice(0, 500), assertion: error?.code === "ERR_ASSERTION" });
        // A staging check that fails is the suite breaking, never a known gap.
        if (/^setup:/.test(String(error?.message ?? ""))) {
          throw new Error(error.message);
        }
        throw error;
      }
    };
    if (entry) {
      await harness.gap(`${name}:${id}`, { rule: rules[checkName](row), where: entry.where, severity: entry.severity, note: entry.note }, run);
    } else {
      await harness.test(id, run);
    }
  };
}

// A casting that must go through: a refusal is the row not walked.
export async function mustCast(row, kind = "fight", options = {}) {
  const made = await castRow(row, kind, options);
  if (!made.out.ok) {
    throw new Error(`${row.name} was refused, so the row was not walked: ${made.out.error}`);
  }
  return made;
}

// A second caster's copy of a spell cast at the same foe: the call castRow
// makes for a condition row, from another sheet.
export async function castAtFoe(ctx, sheet, row) {
  const { world, kit, e1 } = ctx;
  kit.giveTurn(sheet.id);
  world.clearDice();
  world.dice(...new Array(24).fill(1));
  const laid = row.mech.condition?.variants?.[0] ?? null;
  const out = await world.invoke("cast_at_enemy", {
    characterId: sheet.id,
    targetEnemyId: e1.id,
    spell: row.name,
    ...(row.level ? { level: row.level } : {}),
    ...(row.mech.save ? { saveAbility: row.mech.save } : {}),
    ...(laid ? { condition: laid } : {}),
  });
  world.clearDice();
  world.diceLog();
  return out;
}
