// Builder sweep, part 2: every feat the builder's picker lists, taken at a
// 4th-level improvement.
//
// The picker judges a feat's prerequisite as the save does (featPrereqs.ts),
// its card asks for the picks the feat leaves open (FeatChoicesFields from
// feat-grant-text.ts), and the server checks both again (legality/features.ts,
// feat-grants.ts). For each feat, against four ordinary characters (a human
// fighter, a high elf wizard, a halfling rogue, a dragonborn paladin):
//
//   taken    on the first character the picker lets take it, with every pick
//            its card asks for made from the card's own lists, the gate passes
//            and the server stores it with the feat on the sheet
//   fill     on that character with the feat chosen and nothing else, "Fill
//            what's left" ends in a character the gate passes: the fill's
//            promise covers the picks of a feat the player chose
//   prereq   on the first character the picker blocks it for, the same build
//            sent anyway is refused by the server: the picker is no stricter
//            than the rules
//
// A feat no character here may take has no taken or fill row, and the suite
// says how many there were.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { doors, key } from "./lib/sweep-builder.mjs";
import * as known from "./lib/sweep-builder-known-feats.mjs";

const nopack = process.env.CONTENT_DB_PATH === "/nonexistent";
const prefix = nopack ? "nopack-feat" : "feat";
const rows = sweepRows(`test-enforce-sweep-builder-${nopack ? "feats-nopack" : "feats"}`, {
  KNOWN: expand((nopack ? known.KNOWN_FEATS_NOPACK : known.KNOWN_FEATS) ?? []),
  SKIP: (nopack ? known.SKIP_FEATS_NOPACK : known.SKIP_FEATS) ?? {},
});
const sweep = await openFillSweep();
const sb = sweep.library;
const door = doors({ creation: sweep.libraryCreation });
const { builderFeatJudge, judgeEntry, entryPrerequisite } = await import("../src/app/characters/builder/featPrereqs.ts");
const { packFeatText } = await import("../src/lib/srd/feat-text.ts");
const { featGrantSpec } = await import("../src/lib/srd/feat-grant-text.ts");
const { authoredFeatDesc } = await import("../src/lib/srd/feat-effects.ts");
const { withFeatChoice } = await import("../src/lib/schemas/sheet.ts");
const { SRD_SKILLS } = await import("../src/lib/srd/index.ts");
const { optionFeatureName } = await import("../src/lib/srd/options.ts");
// The feat texts and prerequisites by the textKey of the name, as
// useFeatDescs hands them to the builder: keyed by the lowercased name, an
// apostrophe's feat (Destiny's Call) reached the builder with no text at all.
const { textKey } = await import("../src/lib/language/text-logic.ts");

// The picker's rows (useContentSearch on feats), every page.
const feats = [];
for (let offset = 0; offset < 3000; offset += 100) {
  const page = (await sb.content("feats", `limit=100&offset=${offset}`)).results ?? [];
  feats.push(...page);
  if (page.length < 100) break;
}
assert.ok(feats.length > 20, `the feat picker lists only ${feats.length} feats`);

// By id: the pack spells a species "high-elf" where the bundled list has "high_elf".
const raceNamed = (pattern) => sb.races.find((race) => pattern.test(race.id))?.id;
const CANDIDATES = [
  { classId: "fighter", raceId: raceNamed(/^human$/i), backgroundId: "soldier" },
  { classId: "wizard", raceId: raceNamed(/^high[-_]elf$/i), backgroundId: "sage" },
  { classId: "rogue", raceId: raceNamed(/^lightfoot/i), backgroundId: "criminal" },
  { classId: "paladin", raceId: raceNamed(/^dragonborn$/i), backgroundId: "noble" },
];
// Each character whole at 4th level, for the picker's verdict. The rows
// themselves start from the feat chosen and nothing else: a fill that placed
// the improvement's points first would have prepared spells by a score the
// feat then takes back.
const bases = [];
for (const candidate of CANDIDATES) {
  assert.ok(candidate.raceId, `no species for the ${candidate.classId}`);
  const { fields } = await sb.fill(sb.fresh({ level: 4, ...candidate }));
  // The improvement open again: the picker judges a feat for that slot.
  bases.push({ ...candidate, fields: { ...fields, asiChoices: [] } });
}

const LANGUAGES = ["Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc", "Draconic", "Celestial", "Infernal"];
const TOOLS = ["smith's tools", "herbalism kit", "cook's utensils", "tinker's tools", "disguise kit", "lute", "dice set"];
const WEAPONS = ["Longsword", "Rapier", "Longbow", "Battleaxe", "Greatsword", "Shortbow"];
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

function descOf(row) {
  return authoredFeatDesc(row.name) ?? packFeatText(row.data ?? {}).desc ?? "";
}

// The character and the judge the builder hands its pickers and its gate
// (CharacterBuilder.tsx builds it from the same facts).
function judged(fields, row) {
  const built = sb.derive(fields);
  const facts = {
    state: built.state,
    derived: built.derived,
    race: sb.races.find((race) => race.id === fields.raceId),
    klass: sb.classes.find((klass) => klass.id === fields.classId),
    background: sb.backgrounds.find((background) => background.id === fields.backgroundId),
  };
  const featJudge = builderFeatJudge(facts, { [textKey(row.name)]: entryPrerequisite(row) });
  // The save check as the wizard runs it, the judge with it: enforce-builder's
  // own gate passes none, and without one no feat's prerequisite is read.
  const blocker = facts.race && facts.klass && facts.background ? sb.builder.submit.validateBuilder({ ...facts, featJudge }) : built.blocker;
  return { built: { ...built, blocker }, featJudge };
}

function verdict(base, row, featDescs) {
  return judgeEntry(judged({ ...base.fields, featDescs }, row).featJudge, row, true);
}

const ATTACK_CANTRIPS = ["Fire Bolt", "Ray of Frost", "Eldritch Blast", "Sacred Flame", "Chill Touch", "Shocking Grasp", "Produce Flame", "Thorn Whip"];
const RITUALS = ["Detect Magic", "Identify", "Find Familiar", "Alarm", "Comprehend Languages", "Unseen Servant", "Purify Food and Drink", "Speak with Animals", "Detect Poison and Disease"];

// Every pick the card asks for, from the card's own lists: the training, the
// damage type, and the spells a feat teaches.
async function picksFor(spec, built) {
  const held = {
    skills: new Set(built.derived.training.skills.map(key)),
    languages: new Set(built.derived.training.languages.map(key)),
    tools: new Set((built.derived.training.tools ?? []).map(key)),
    weapons: new Set((built.derived.training.weapons ?? []).map(key)),
  };
  const picks = {};
  let any = spec.any ?? 0;
  const anyFirst = (spec.anyKinds ?? [])[0];
  const take = (kind, own, from) => {
    const count = own + (anyFirst === kind ? any : 0);
    if (anyFirst === kind) any = 0;
    if (count <= 0) return;
    const list = from.filter((entry) => !held[kind]?.has(key(entry))).slice(0, count);
    if (list.length) picks[kind] = list;
  };
  take("skills", spec.skills, spec.skillsFrom.length ? spec.skillsFrom : SRD_SKILLS.map((skill) => skill.id));
  take("languages", spec.languages, LANGUAGES);
  take("tools", spec.tools, spec.toolsFrom.length ? spec.toolsFrom : TOOLS);
  take("weapons", spec.weapons, spec.weaponsFrom.length ? spec.weaponsFrom : WEAPONS);
  if (spec.expertise > 0) picks.expertise = [...held.skills, ...(picks.skills ?? [])].slice(0, spec.expertise);
  if (spec.damageTypes.length) picks.damageType = spec.damageTypes[0];
  const taught = spec.taught;
  if (taught.cantrips || taught.spells) {
    const list = (taught.lists.length ? taught.lists : ["wizard"]).find((entry) => entry === "wizard") ?? taught.lists[0] ?? "wizard";
    if (taught.listChoice) picks.list = list;
    const known = new Set([...(built.state.cantrips ?? []), ...(built.state.spells ?? [])].map(key));
    const pool = (await sb.spellPool(list, Math.max(1, taught.spellLevel))).filter((spell) => !known.has(key(spell.name)));
    if (taught.cantrips) {
      const cantrips = pool.filter((spell) => spell.level === 0 && (!taught.attackCantrip || ATTACK_CANTRIPS.includes(spell.name)));
      picks.cantrips = cantrips.slice(0, taught.cantrips).map((spell) => spell.name);
    }
    if (taught.spells) {
      const spells = pool.filter(
        (spell) =>
          spell.level === taught.spellLevel &&
          (!taught.schools.length || taught.schools.includes(key(spell.school))) &&
          (!taught.ritualBook || RITUALS.includes(spell.name)),
      );
      picks.spells = spells.slice(0, taught.spells).map((spell) => spell.name);
    }
    picks.ability = "int";
  }
  return picks;
}

// The option slots a feat opens (Martial Adept's maneuvers), first names
// whose prerequisite the character meets.
function optionPicksFor(built, fields) {
  const picks = [...(fields.optionPicks ?? [])];
  for (const slot of built.derived.optionSlots ?? []) {
    const open = slot.options.filter((option) => !option.half && !option.req && !slot.chosen.includes(option.n));
    for (const option of open.slice(0, Math.floor(slot.remaining))) picks.push(optionFeatureName(slot.kind, option.n));
  }
  return picks;
}

let untaken = 0;
for (const row of feats) {
  const featDescs = { [textKey(row.name)]: descOf(row) };
  const verdicts = bases.map((base) => ({ base, verdict: verdict(base, row, featDescs) }));
  const open = verdicts.find((entry) => !entry.verdict?.blocked);
  const shut = verdicts.find((entry) => entry.verdict?.blocked);
  const chosen = (base, ability) => ({ ...base.fields, featDescs, asiChoices: [{ mode: "feat", feat: row.name, ...(ability ? { ability } : {}) }] });

  // The ability a half-feat raises, where it leaves one to choose: the first
  // the gate takes.
  const withAbility = (base, extra = {}) => {
    let last = null;
    for (const ability of [undefined, ...ABILITIES]) {
      const fields = { ...chosen(base, ability), ...extra };
      const built = sb.derive(fields);
      last = { fields, built };
      if (!built.blocker || !/abilit|score|raise/i.test(built.blocker.message)) break;
    }
    return last;
  };

  if (open) {
    // "Fill what's left" on the character with the feat chosen and nothing
    // else: both rows read it.
    const start = sb.fresh({ level: 4, classId: open.base.classId, raceId: open.base.raceId, backgroundId: open.base.backgroundId, ...chosen({ fields: {} }) });
    const filled = (await sb.fill(start)).fields;
    const withFeatAbility = (extra = {}) => {
      let last = null;
      for (const ability of [undefined, ...ABILITIES]) {
        const fields = { ...filled, ...extra, asiChoices: [{ mode: "feat", feat: row.name, ...(ability ? { ability } : {}) }] };
        const { built } = judged(fields, row);
        last = { fields, built };
        if (!built.blocker || !/abilit|score|raise/i.test(built.blocker.message)) break;
      }
      return last;
    };
    await rows.row(`${prefix}:${row.name}:taken`, async () => {
      const first = withFeatAbility();
      const spec = featGrantSpec(featDescs[textKey(row.name)]);
      const featChoices = withFeatChoice(first.fields.featChoices ?? {}, row.name, await picksFor(spec, first.built));
      const optionPicks = optionPicksFor(first.built, first.fields);
      const { fields, built } = withFeatAbility({ featChoices, optionPicks });
      assert.equal(built.blocker, null, `gate (${open.base.classId}): with every pick the card lists made, the builder still refuses: ${JSON.stringify(built.blocker)} :: picks ${JSON.stringify(featChoices)}`);
      const stored = await door.library(built);
      assert.ok(stored.ok, `library (${open.base.classId}): the server refused what the gate passed (${stored.status}): ${stored.error} :: asi ${JSON.stringify(fields.asiChoices)} picks ${JSON.stringify(featChoices)}`);
      assert.ok(stored.sheet.feats.some((feat) => key(feat) === key(row.name)), `library: stored without the feat: ${JSON.stringify(stored.sheet.feats)}`);
    });
    await rows.row(`${prefix}:${row.name}:fill`, async () => {
      const { built } = withFeatAbility();
      // The maintainer's decision R12 (/tmp/odm-gapstudy/WAVE1.md, wave 1):
      // "'Fill what's left' fills a feat's taught spells and damage types
      // too." A fill that stopped at Magic Initiate's spells or Elemental
      // Adept's damage type was held as keeping its word before; it no
      // longer is.
      assert.equal(built.blocker, null, `fill (${open.base.classId}): after the fill the builder still refuses the save: ${JSON.stringify(built.blocker)}`);
    });
  } else {
    untaken += 1;
  }
  if (shut) {
    await rows.row(`${prefix}:${row.name}:prereq`, async () => {
      const { built } = withAbility(shut.base);
      assert.ok(built.result, "the blocked build has no payload to send");
      const stored = await door.library({ level: built.result.level, sheet: built.result.sheet });
      assert.ok(!stored.ok, `the picker blocks ${row.name} for the ${shut.base.classId} (${shut.verdict.note}) and the server stored it`);
    });
  }
}
console.log(`${feats.length} feats listed; ${untaken} that none of the four characters may take`);

sweep.close();
rows.finish();
