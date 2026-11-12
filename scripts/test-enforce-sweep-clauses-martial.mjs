// The clause ledger's table-driven martial probes: the clauses of the authored
// fighter, barbarian, monk and rogue subclass features
// (src/lib/srd/subclasses.json) that state how many uses a counter has, which
// rest gives them back, what training the feature grants, or that rolling
// initiative returns a use. scripts/clauses/martial.json names each probe
// here as "<kind>:<class>::<Feature>"; the number each one holds the engine
// to is the one the stored text states, written in the tables below.
//
// A row of a table no clause names fails the suite (clauseSuite's orphan
// check), and so does a clause naming a row the tables do not hold.
import assert from "node:assert/strict";
import { clauseSuite, openRig, readLedger, prof, MOD } from "./lib/sweep-clauses-martial.mjs";

const KNOWN = {};
const SKIP = {};
const { probe, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);

// The number of uses the text states, at a level: a count, "pb" (the
// proficiency bonus), "2pb", or an ability ("str", "con", "wis": its
// modifier, minimum one). `at` lists the levels the text names a step at.
const USES = {
  "fighter::Combat Superiority": { id: "sub_superiority_dice", at: [[3, 4], [7, 5], [15, 6]], rest: "short" },
  "fighter::Arcane Shot": { id: "sub_arcane_shot", at: [[3, 2]], rest: "short" },
  "fighter::Unwavering Mark": { id: "sub_unwavering_mark", at: [[3, "str"]], rest: "long", low: { str: 8 } },
  "fighter::Warding Maneuver": { id: "sub_warding_maneuver", at: [[7, "con"]], rest: "long", low: { con: 8 } },
  "fighter::Fighting Spirit": { id: "sub_fighting_spirit", at: [[3, 3]], rest: "long" },
  "fighter::Strength before Death": { id: "sub_strength_before_death", at: [[18, 1]], rest: "long" },
  "fighter::Unleash Incarnation": { id: "sub_unleash_incarnation", at: [[3, "con"]], rest: "long", low: { con: 8 } },
  "fighter::Shadow Martyr": { id: "sub_shadow_martyr", at: [[10, 1]], rest: "short" },
  "fighter::Reclaim Potential": { id: "sub_reclaim_potential", at: [[15, "con"]], rest: "long", low: { con: 8 } },
  "fighter::Psionic Power (Psi Warrior)": { id: "sub_psionic_recovery", at: [[3, 1]], rest: "short" },
  "fighter::Giant's Might": { id: "sub_giants_might", at: [[3, "pb"], [9, "pb"], [17, "pb"]], rest: "long" },
  "fighter::Runic Shield": { id: "sub_runic_shield", at: [[7, "pb"], [13, "pb"]], rest: "long" },
  "barbarian::Consult the Spirits": { id: "sub_consult_the_spirits", at: [[10, 1]], rest: "short" },
  "barbarian::Zealous Presence": { id: "sub_zealous_presence", at: [[10, 1]], rest: "long" },
  "barbarian::Infectious Fury": { id: "sub_infectious_fury", at: [[10, "pb"], [17, "pb"]], rest: "long" },
  "barbarian::Call the Hunt": { id: "sub_call_the_hunt", at: [[14, "pb"], [17, "pb"]], rest: "long" },
  "barbarian::Magic Awareness": { id: "sub_magic_awareness", at: [[3, "pb"], [9, "pb"]], rest: "long" },
  "barbarian::Bolstering Magic": { id: "sub_bolstering_magic", at: [[6, "pb"], [13, "pb"]], rest: "long" },
  "monk::Hand of Ultimate Mercy": { id: "sub_wholeness_of_body_mercy", at: [[17, 1]], rest: "long" },
  "monk::Breath of the Dragon": { id: "sub_breath_of_the_dragon", at: [[3, "pb"], [9, "pb"]], rest: "long" },
  "monk::Wings Unfurled": { id: "sub_wings_unfurled", at: [[6, "pb"], [13, "pb"]], rest: "long" },
  "monk::Aspect of the Wyrm": { id: "sub_aspect_of_the_wyrm", at: [[11, 1]], rest: "long" },
  "rogue::Spell Thief": { id: "sub_spell_thief", at: [[17, 1]], rest: "long" },
  "rogue::Master Duelist": { id: "sub_master_duelist", at: [[17, 1]], rest: "short" },
  "rogue::Unerring Eye": { id: "sub_unerring_eye", at: [[13, "wis"]], rest: "long", low: { wis: 8 } },
  "rogue::Wails from the Grave": { id: "sub_wails_from_the_grave", at: [[3, "pb"], [9, "pb"]], rest: "long" },
  "rogue::Ghost Walk": { id: "sub_ghost_walk", at: [[13, 1]], rest: "long" },
  "rogue::Psychic Veil": { id: "sub_psychic_veil", at: [[13, 1]], rest: "long" },
  "rogue::Rend Mind": { id: "sub_rend_mind", at: [[17, 1]], rest: "long" },
  "rogue::Psionic Power (Soulknife)": { id: "sub_psionic_energy", at: [[3, "2pb"], [5, "2pb"], [17, "2pb"]], rest: "long" },
};
// The rest that gives a counter back, where the clause is about the refill
// alone: the counter and the rest.
const REFILL = {
  "fighter::Combat Superiority": { id: "sub_superiority_dice", level: 3, rest: "short" },
  "fighter::Arcane Shot": { id: "sub_arcane_shot", level: 3, rest: "short" },
  "fighter::Psionic Power (Psi Warrior)": { id: "sub_psionic_energy", level: 3, rest: "long" },
};
// Rolling initiative with the counter empty gives one use back.
const INIT_REFILL = {
  "fighter::Relentless": { id: "sub_superiority_dice", level: 15 },
  "fighter::Ever-Ready Shot": { id: "sub_arcane_shot", level: 15 },
  "fighter::Tireless Spirit": { id: "sub_fighting_spirit", level: 10 },
};
// The training a feature grants: the grant by the feature's name, and what
// its spec must name.
const TRAINING = {
  "fighter::Student of War": [/"tools":1/, /carpenter.s tools/, /smith.s tools/],
  "fighter::Arcane Archer Lore": [/arcana/i, /nature/i],
  "fighter::Bonus Proficiency (Cavalier)": [/animal_handling/i, /history/i, /insight/i, /performance/i, /persuasion/i, /language/i],
  "fighter::Bonus Proficiency (Samurai)": [/history/i, /insight/i, /performance/i, /persuasion/i, /language/i],
  "fighter::Bonus Proficiencies (Rune Knight)": [/smith/i, /giant/i],
  "barbarian::Giant's Power": [/giant/i],
  "monk::Bonus Proficiencies (Drunken Master)": [/performance/i, /brewer/i],
  "monk::Path of the Kensei": [/calligrapher|painter/i],
  "monk::Implements of Mercy": [/insight/i, /medicine/i, /herbalism/i],
  "monk::Draconic Disciple": [/draconic/i],
  "rogue::Bonus Proficiencies (Assassin)": [/disguise/i, /poisoner/i],
  "rogue::Master of Intrigue": [/disguise/i, /forgery/i, /dice set/i, /"languages":2/],
  "rogue::Survivalist": [/nature/i, /survival/i, /expertise/i],
};

const ledger = readLedger();
const r = await openRig();
const { world, kit, hero, sheet, max, used, setUsed } = r;
const training = await import("../src/lib/srd/subclass-training.ts");
const modOf = (score) => Math.floor((score - 10) / 2);
const entryOf = (key) => {
  const entry = ledger[key];
  assert.ok(entry, `${key}: no ledger entry`);
  return entry;
};
const holder = (key, level, abilities = {}) => {
  const entry = entryOf(key);
  return hero(key.split("::")[0], entry.group, level, { abilities });
};
const wanted = (spec, level, abilities = {}) => {
  if (typeof spec === "number") return spec;
  if (spec === "pb") return prof(level);
  if (spec === "2pb") return 2 * prof(level);
  return Math.max(1, modOf(abilities[spec] ?? 10 + 2 * MOD));
};
async function rest(kind) {
  await kit.endFight();
  const out = await world.invoke("take_rest", { kind });
  assert.equal(out.ok, true, `a ${kind} rest was refused: ${out.error}`);
}
async function refillsOn(who, id, kind) {
  setUsed(who, id, 1);
  await rest("short");
  const afterShort = used(who, id);
  if (kind === "short") {
    assert.equal(afterShort, 0, `${id}: a short rest gave nothing back`);
    return;
  }
  assert.equal(afterShort, 1, `${id}: a short rest gave back a use the text keeps for a long rest`);
  await rest("long");
  assert.equal(used(who, id), 0, `${id}: a long rest gave nothing back`);
}

for (const [key, row] of Object.entries(USES)) {
  await probe(`uses:${key}`, async () => {
    for (const [level, spec] of row.at) {
      const who = holder(key, level);
      assert.equal(max(who, row.id), wanted(spec, level), `${key} at level ${level}: ${row.id} holds ${max(who, row.id)} uses`);
    }
    if (row.low) {
      const [level] = row.at[0];
      const low = holder(key, level, row.low);
      assert.equal(max(low, row.id), 1, `${key} with ${JSON.stringify(row.low)}: minimum one use`);
    }
    await refillsOn(holder(key, row.at[0][0]), row.id, row.rest);
  });
}

for (const [key, row] of Object.entries(REFILL)) {
  await probe(`refill:${key}`, async () => {
    await refillsOn(holder(key, row.level), row.id, row.rest);
  });
}

for (const [key, row] of Object.entries(INIT_REFILL)) {
  await probe(`init-refill:${key}`, async () => {
    const who = holder(key, row.level);
    const top = max(who, row.id);
    assert.ok(top > 0, `${row.id} missing`);
    await kit.endFight();
    setUsed(who, row.id, top);
    await r.roll(who, { kind: "initiative" });
    assert.equal(used(who, row.id), top - 1, `with every use spent, rolling initiative gave ${top - used(who, row.id)} back`);
    setUsed(who, row.id, 0);
    await r.roll(who, { kind: "initiative" });
    assert.equal(used(who, row.id), 0, "with uses left, initiative changes nothing");
  });
}

for (const [key, patterns] of Object.entries(TRAINING)) {
  await probe(`training:${key}`, () => {
    const entry = entryOf(key);
    const name = key.split("::")[1];
    const grants = training.subclassGrants([{ id: key.split("::")[0], level: entry.level, subclass: entry.group }]);
    const grant = grants.find((g) => g.name === name);
    assert.ok(grant, `no training grant named ${name}: [${grants.map((g) => g.name).join(", ")}]`);
    const spec = JSON.stringify(grant.spec);
    for (const pattern of patterns) assert.match(spec, pattern, `${name}'s grant names nothing like ${pattern}: ${spec.slice(0, 300)}`);
  });
}

finish();
