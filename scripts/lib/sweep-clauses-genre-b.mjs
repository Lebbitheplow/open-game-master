// The clause ledger of the mystery, post-apocalyptic and steampunk classes,
// run: scripts/clauses/genre-<genre>.json holds one entry for every class and
// subclass feature of src/lib/classes/<genre>-features.json, its text split
// into the promises it makes, and this walks the catalog against it.
//
// The coverage guard counts a feature as covered once it has any hook. Here
// every clause has a status of its own:
//   held    a probe below ran it and the engine did what the words say
//   gap     the engine does not, and the probe (a gap() here, or the repro of
//           the sweep that already found it) says how that shows
//   left    information or roleplay the GM adjudicates, with where that is written
//   flavor  no mechanical content
//
// A clause with a kind (`k`) is run by PROBES[k] with its parameters (`p`):
// held clauses as test(), gap clauses as gap(), so the suite is green today,
// fails when a held clause stops holding and fails when a gap closes. Each
// feature is also asked what its NAME answers to in the engine beyond its
// text (strayHooks): a genre feature that shares its name with another
// class's feature must not run as that one.
//
// The catalog is the generator: a feature added to a catalog file, or a
// sentence changed (the entry keeps the hash of the text it was split from),
// fails the suite until the ledger has it.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import "./enforce-world.mjs";
import { suite } from "./enforce-harness.mjs";
import { clausesRig, PROBES, strayHooks } from "./sweep-clauses-genre-b-probes.mjs";

export const GENRES = ["mystery", "post-apocalyptic", "steampunk"];
const ROOT = new URL("../../", import.meta.url);
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, ROOT), "utf8"));

export const sourceOf = (genre) => `src/lib/classes/${genre}-features.json`;
export const ledgerFile = (genre) => `scripts/clauses/genre-${genre}.json`;
export const suiteFile = (genre) => `scripts/test-enforce-sweep-clauses-genre-b-${genre}.mjs`;
export const sha12 = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);

// Every feature of one catalog, class features first, in the catalog's order.
export function catalogRows(genre) {
  const rows = [];
  for (const [classId, table] of Object.entries(read(sourceOf(genre)).classes)) {
    for (const [group, levels, subclass] of [[classId, table.levels, false], [table.subclass.name, table.subclass.levels, true]]) {
      for (const [level, features] of Object.entries(levels)) {
        for (const feature of features) {
          rows.push({ key: `${classId}::${feature.n}`, genre, classId, group, subclass, level: Number(level), name: feature.n, text: feature.d, sha: sha12(feature.d) });
        }
      }
    }
  }
  return rows;
}

export const readLedger = (genre) => read(ledgerFile(genre));

// Where a gap of each kind would be closed, and how much it costs the table.
export const KIND_META = {
  uses: { where: "scripts/generate-class-resources.mjs parseUses (and src/lib/classes/resources.json, which it writes)", severity: "medium" },
  action_cost: { where: "scripts/generate-class-resources.mjs parseAction", severity: "medium" },
  fx: { where: "scripts/generate-class-resources.mjs parseFx and src/lib/srd/class-resources.ts effectFromFx", severity: "medium" },
  fx_heal: { where: "scripts/generate-class-resources.mjs parseFx (heal_target) and src/lib/dm/resource-tools.ts", severity: "medium" },
  spend_moves: { where: "src/lib/dm/resource-tools.ts computeUseResource (the narrative arm) and the row's fx in src/lib/classes/resources.json", severity: "medium" },
  resist: { where: "src/lib/dm/pc-defenses.ts pcResistances / pcImmunities (src/lib/srd/feature-effects.ts parseFeatureEffects is never run over the genre catalogs)", severity: "medium" },
  save_adv: { where: "src/lib/srd/trait-rules.ts heldSaveTraits", severity: "medium" },
  immune_cond: { where: "src/lib/srd/trait-rules.ts featureConditionImmunities", severity: "medium" },
  ac: { where: "src/lib/srd/index.ts acBreakdownFor", severity: "medium" },
  init: { where: "src/lib/srd/feature-effects.ts FEATURE_EFFECTS (initiative_bonus) and src/lib/srd/trait-rules.ts initiativeAdvantage", severity: "medium" },
  speed: { where: "src/lib/srd/index.ts speedFor (speed_bonus)", severity: "low" },
  skill: { where: "src/lib/dm/rolls.ts resolveRollExpression (skill riders)", severity: "medium" },
  extra_attack: { where: "src/lib/srd/feature-effects.ts FEATURE_EFFECTS (extra_attack)", severity: "medium" },
  rider: { where: "src/lib/dm/pc-attack-resolve.ts (damage riders) and src/lib/srd/feature-effects.ts FEATURE_EFFECTS (weapon_damage_rider)", severity: "medium" },
  bonus_route: { where: "src/lib/dm/bonus-routes.ts and src/lib/srd/authored-effects-genre.ts", severity: "medium" },
  spend_row: { where: "src/lib/srd/authored-effects-genre.ts GENRE_AUTHORED", severity: "medium" },
  take_hit: { where: "src/lib/srd/authored-effects-genre.ts GENRE_AUTHORED and src/lib/dm/authored-reactions.ts", severity: "medium" },
  halve_hit: { where: "src/lib/dm/reaction-tools.ts uncannyDodge", severity: "medium" },
  riposte: { where: "src/lib/dm/authored-reactions.ts (kind attack) and src/lib/srd/authored-effects-genre.ts", severity: "high" },
  evasion: { where: "src/lib/dm/aoe-characters.ts", severity: "medium" },
  no_surprise: { where: "src/lib/dm/encounter-open.ts (who is surprised)", severity: "medium" },
  subclass: { where: "src/lib/srd/features.ts populateFeatures", severity: "medium" },
  casting: { where: "src/lib/classes/*.json (spellListFrom, spellAbility)", severity: "medium" },
  fall: { where: "src/lib/dm/mutations.ts apply_damage (fallFeet)", severity: "low" },
  escape_adv: { where: "src/lib/dm/action-tools.ts take_action (escape)", severity: "low" },
  reckless: { where: "src/lib/dm/pc-attack-options.ts (reckless is the barbarian's by name)", severity: "medium" },
  pistol_blade: { where: "src/lib/dm/feature-bonus-attacks.ts", severity: "medium" },
  surge: { where: "src/lib/dm/cast-rules.ts SURGE_FEATURES", severity: "medium" },
  route_counter: { where: "src/lib/dm/bonus-routes.ts VANISH_COUNTER", severity: "medium" },
  expertise: { where: "src/lib/srd/features.ts EXPERTISE_GRANTS (rogue and bard only)", severity: "medium" },
  stray: { where: "src/lib/srd/authored-effects.ts heldAuthored (borrowedRow), src/lib/srd/feature-effects.ts effectsFor and the name checks in src/lib/dm/combat-features.ts", severity: "high" },
  no_floor: { where: "src/lib/srd/authored-effects.ts heldAuthored (borrowedRow gives a genre feature another class's row of the same name)", severity: "high" },
  unhooked: { where: "src/lib/srd/feature-effects.ts FEATURE_EFFECTS or src/lib/srd/authored-effects-genre.ts GENRE_AUTHORED (the genre catalogs are read for counters only)", severity: "medium" },
};

const STATUSES = new Set(["held", "gap", "left", "flavor"]);

// What of the text no clause covers, without its punctuation and joining words.
function uncovered(text, clauses) {
  const covered = new Array(text.length).fill(false);
  for (const clause of clauses) {
    let at = text.indexOf(clause.c);
    while (at >= 0) {
      for (let index = at; index < at + clause.c.length; index += 1) covered[index] = true;
      at = text.indexOf(clause.c, at + 1);
    }
  }
  return [...text].filter((_, index) => !covered[index]).join("").replace(/\b(?:and|or)\b/g, "").replace(/[\s;:,.()]/g, "");
}

export async function runLedger(genre) {
  const name = `test-enforce-sweep-clauses-genre-b-${genre}`;
  const { test, gap, finish } = suite(name);
  const rows = catalogRows(genre);
  const ledger = readLedger(genre);
  const discover = process.env.SWEEP_CLAUSES_DISCOVER;
  const found = [];

  await test("every feature of the catalog has an entry, split from the text as it is stored today", () => {
    const wrong = [];
    for (const row of rows) {
      const entry = ledger[row.key];
      if (!entry) wrong.push(`${row.key} has no entry`);
      else if (entry.sha !== row.sha) wrong.push(`${row.key}: the text changed since it was split (${entry.sha} then, ${row.sha} now)`);
      else if (entry.level !== row.level || entry.group !== row.group) wrong.push(`${row.key}: level or group differs`);
    }
    const known = new Set(rows.map((row) => row.key));
    for (const key of Object.keys(ledger)) if (!known.has(key)) wrong.push(`${key} is in the ledger and not in the catalog`);
    assert.deepEqual(wrong, [], wrong.slice(0, 8).join("; "));
  });

  await test("each clause is the text's own words, and together the clauses cover every sentence", () => {
    const wrong = [];
    for (const row of rows) {
      const clauses = ledger[row.key]?.clauses ?? [];
      for (const clause of clauses) {
        if (!row.text.includes(clause.c)) wrong.push(`${row.key}: "${clause.c}" is not in the text`);
      }
      const rest = uncovered(row.text, clauses);
      if (rest) wrong.push(`${row.key}: no clause covers "${rest}"`);
    }
    assert.deepEqual(wrong, [], wrong.slice(0, 8).join("; "));
  });

  await test("a held or gap clause names the probe that ran it, a left clause where the reason is written", () => {
    const wrong = [];
    for (const row of rows) {
      for (const [index, clause] of (ledger[row.key]?.clauses ?? []).entries()) {
        const tag = `${row.key}#${index}`;
        if (!STATUSES.has(clause.is)) wrong.push(`${tag}: status ${clause.is}`);
        if ((clause.is === "held" || clause.is === "gap") && !clause.probe) wrong.push(`${tag}: no probe`);
        if (clause.is === "held" && !clause.by) wrong.push(`${tag}: held by nothing`);
        if (clause.is === "held" && !clause.k && !/^scripts\/test-/.test(clause.probe)) wrong.push(`${tag}: held with no run`);
        if (clause.is === "left" && !clause.why) wrong.push(`${tag}: left with no reason`);
        if (clause.k && !PROBES[clause.k]) wrong.push(`${tag}: no probe of kind ${clause.k}`);
        if (clause.k && !["held", "gap"].includes(clause.is)) wrong.push(`${tag}: a ${clause.is} clause with a probe`);
      }
    }
    assert.deepEqual(wrong, [], wrong.slice(0, 8).join("; "));
  });

  const rig = await clausesRig();
  let ran = 0;
  for (const row of rows) {
    const entry = ledger[row.key];
    if (!entry) continue;
    for (const [index, clause] of entry.clauses.entries()) {
      if (!clause.k) continue;
      ran += 1;
      const id = `${row.key}#${index}:${clause.k}`;
      const run = async () => {
        try {
          await PROBES[clause.k](rig, row, clause.p ?? {});
        } finally {
          rig.reset();
        }
      };
      if (discover) {
        try {
          await run();
          found.push({ id, key: row.key, index, k: clause.k, pass: true });
        } catch (error) {
          const asserted = error?.name === "AssertionError" || error?.code === "ERR_ASSERTION";
          found.push({ id, key: row.key, index, k: clause.k, pass: false, threw: !asserted, msg: String(error?.message ?? error).split("\n")[0].slice(0, 300) });
        }
      } else if (clause.is === "held") {
        await test(id, run);
      } else {
        const meta = KIND_META[clause.k];
        await gap(id, { rule: `"${clause.c}" (${sourceOf(genre)}, ${row.key})`, where: clause.where ?? meta.where, severity: clause.sev ?? meta.severity, ...(clause.note ? { note: clause.note } : {}) }, run);
      }
    }
    // The name: nothing answers to it that the text does not say. A row whose
    // clauses already ask this (kind stray, no_floor) is not asked twice.
    if (entry.clauses.some((clause) => clause.k === "stray")) continue;
    const expected = entry.name ?? {};
    const id = `${row.key}:name`;
    const run = async () => {
      try {
        const stray = await strayHooks(rig, row, expected);
        assert.deepEqual(stray, [], `by its name the engine also gives ${row.name}: ${stray.join("; ")}`);
      } finally {
        rig.reset();
      }
    };
    if (discover) {
      try {
        await run();
      } catch (error) {
        found.push({ id, key: row.key, index: -1, k: "name", pass: false, threw: !(error?.name === "AssertionError" || error?.code === "ERR_ASSERTION"), msg: String(error?.message ?? error).split("\n")[0].slice(0, 400) });
      }
    } else if (expected.stray) {
      // Known: another feature of the same name runs for this one.
      await gap(id, { rule: `${row.name}: "${row.text}" (${sourceOf(genre)}, ${row.key}); its name gives it nothing more`, where: KIND_META.stray.where, severity: expected.sev ?? "high", note: expected.stray }, run);
    } else {
      await test(id, run);
    }
  }
  rig.world.close();
  if (discover) {
    fs.writeFileSync(discover, found.map((line) => JSON.stringify(line)).join("\n") + "\n");
    console.log(`${name}: discovery wrote ${found.length} lines`);
    return;
  }
  const counts = { held: 0, gap: 0, left: 0, flavor: 0 };
  for (const entry of Object.values(ledger)) for (const clause of entry.clauses) counts[clause.is] += 1;
  console.log(`${name}: ${rows.length} features, ${Object.values(counts).reduce((a, b) => a + b, 0)} clauses (${counts.held} held, ${counts.gap} gap, ${counts.left} left, ${counts.flavor} flavor); ${ran} clauses probed here, 0 rows skipped`);
  finish();
}
