// The clause ledger's probes for the lineages of src/lib/srd/races.json,
// made from the table: every row's walking speed, and every row whose traits
// name a damage resistance or immunity, run through a hero of that lineage.
// scripts/clauses/species.json names each probe, "species.<id>.<what>"; a row
// added to races.json gets its probes here the day it lands, and the ledger
// check fails until its entry is written.
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const { srdRaceOptions } = await import("../src/lib/characters/options.ts");
const RACES = JSON.parse(fs.readFileSync(new URL("../src/lib/srd/races.json", import.meta.url), "utf8")).races;
const TYPES = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];

// The damage types a row's traits say it resists or is immune to, read off
// the words: "Hellish Resistance (fire)", "Fire Resistance", "resistance to
// poison damage", "Celestial Resistance (necrotic and radiant)", "immune to
// disease, poison".
export function resistedTypes(row) {
  const out = new Map();
  for (const trait of row.traits) {
    const text = trait.toLowerCase();
    if (!/resist|immune/.test(text)) continue;
    for (const type of TYPES) {
      if (!text.includes(type)) continue;
      const immune = new RegExp(`immune to[^)]*\\b${type}\\b`).test(text) && !/adv\. vs poison/.test(text);
      out.set(type, { trait, immune });
    }
  }
  return out;
}

// The conditions a row's traits give save advantage against: "adv. vs
// poison" (Dwarven Resilience, Stout Resilience), "adv. vs frightened"
// (Brave), "adv. vs charm" (Fey Ancestry).
export function savedAgainst(row) {
  const out = new Set();
  for (const trait of row.traits) {
    const text = trait.toLowerCase();
    if (/adv\. vs poison/.test(text)) out.add("poisoned");
    if (/adv\. vs frightened/.test(text)) out.add("frightened");
    if (/adv\. vs charm/.test(text)) out.add("charmed");
  }
  return [...out];
}

const P = {};
for (const row of RACES) {
  // The builder stores the lineage's speed on the sheet (the race option it
  // offers, src/lib/characters/options.ts srdRaceOptions) and the engine
  // reads the sheet: the speed is what both doors carry.
  P[`species.${row.id}.speed`] = async () => {
    const offered = srdRaceOptions().find((option) => option.id === row.id);
    assert.ok(offered, `the builder offers no ${row.name}`);
    const t = await rig.table();
    const who = t.hero({ class: "fighter", level: 1, race: row.id, equipment: [], speed: offered.speed });
    assert.deepEqual([offered.speed, t.speed(who)], [row.speed, row.speed], `${row.name}: walking speed offered by the builder, then read by the engine`);
  };
  const guarded = savedAgainst(row);
  if (guarded.length) {
    P[`species.${row.id}.save-advantage`] = async () => {
      const t = await rig.table();
      const who = t.hero({ class: "fighter", level: 1, race: row.id, equipment: [] });
      const rolled = {};
      for (const against of guarded) {
        const save = await t.roll(who, { kind: "saving_throw", ability: against === "poisoned" ? "con" : "wis", dc: 10, against }, [15, 3]);
        assert.equal(save.ok, true, save.error);
        rolled[against] = save.faces.length;
      }
      const plain = await t.roll(who, { kind: "saving_throw", ability: "wis", dc: 10 }, [15, 3]);
      assert.deepEqual({ ...rolled, none: plain.faces.length }, { ...Object.fromEntries(guarded.map((against) => [against, 2])), none: 1 }, `${row.name}: d20s on a save against each condition its traits name, and on a plain save`);
    };
  }
  const resisted = resistedTypes(row);
  if (!resisted.size) continue;
  P[`species.${row.id}.resistance`] = async () => {
    const t = await rig.table();
    const who = t.hero({ class: "fighter", level: 1, race: row.id, equipment: [], maxHp: 60 });
    const lost = {};
    for (const [type, { immune }] of resisted) {
      t.patch(who, { currentHp: 60 });
      const out = await t.damage(who, 10, type);
      assert.equal(out.ok, true, out.error);
      lost[type] = [60 - t.sheet(who).currentHp, immune ? 0 : 5];
    }
    const wrong = Object.entries(lost).filter(([, [got, want]]) => got !== want);
    assert.deepEqual(wrong, [], `${row.name}: 10 damage of each type took ${JSON.stringify(lost)} ([taken, wanted])`);
  };
}

// The probes above by name, for the ledger's probe check (it finds a probe
// by its name in this file); the run holds the table to the list.
const NAMES = [
  "species.hill_dwarf.speed", "species.mountain_dwarf.speed", "species.high_elf.speed", "species.wood_elf.speed", "species.drow.speed",
  "species.lightfoot_halfling.speed", "species.stout_halfling.speed", "species.human.speed", "species.variant_human.speed", "species.dragonborn.speed",
  "species.rock_gnome.speed", "species.forest_gnome.speed", "species.deep_gnome.speed", "species.half_elf.speed", "species.half_orc.speed",
  "species.tiefling.speed", "species.aasimar.speed", "species.goliath.speed", "species.firbolg.speed", "species.tabaxi.speed", "species.kenku.speed",
  "species.tortle.speed", "species.fire_genasi.speed", "species.water_genasi.speed", "species.air_genasi.speed", "species.earth_genasi.speed",
  "species.changeling.speed", "species.warforged.speed", "species.goblin.speed", "species.bugbear.speed", "species.lizardfolk.speed", "species.orc.speed",
  "species.stout_halfling.resistance", "species.tiefling.resistance", "species.aasimar.resistance", "species.fire_genasi.resistance",
  "species.water_genasi.resistance", "species.air_genasi.resistance", "species.warforged.resistance",
  "species.hill_dwarf.save-advantage", "species.mountain_dwarf.save-advantage", "species.high_elf.save-advantage", "species.wood_elf.save-advantage", "species.drow.save-advantage", "species.lightfoot_halfling.save-advantage", "species.stout_halfling.save-advantage",
];
assert.deepEqual(Object.keys(P).sort(), [...NAMES].sort(), "the table makes other probes than NAMES lists: a row of races.json was added or changed");

await runOrSurvey("scripts/test-enforce-sweep-clauses-species.mjs", P);
