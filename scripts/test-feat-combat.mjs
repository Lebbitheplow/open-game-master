// What the combat feats do, as src/lib/srd/feat-combat.ts reads them from
// sheet.feats (issue #125): the -5/+10 trade of Great Weapon Master and
// Sharpshooter, Sharpshooter's and Spell Sniper's cover and range, Crossbow
// Expert's and Gunner's shot in melee, Elemental Adept's type and dice
// floor, Dungeon Delver's notice, Defensive Duelist's bonus, the prompt tag.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  defensiveDuelistBonus, dungeonDelverNotices, elementalAdeptApplies, elementalAdeptType, featEngineTag, floorDamageDice,
  featBonusAttack, isPolearm, ONE_HANDED_ATTACKED, powerAttackFeat, shootsFreelyInMelee, shotIgnoresCover, shotIgnoresLongRange, spellIgnoresCover, spellRangeFactor,
} = await import("../src/lib/srd/feat-combat.ts");
const { featGrantSpec, featPicksOwed, applyFeatGrants } = await import("../src/lib/srd/feat-grants.ts");
const { authoredFeatDesc, engineFeatNamed } = await import("../src/lib/srd/feat-effects.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const sheet = (feats, extra = {}) => ({ feats, features: [], ...extra });

test("the -5/+10 trade belongs to the feat that fits the weapon", () => {
  const melee = { weaponAttack: true, ranged: false, heavy: true, proficient: true };
  const shot = { weaponAttack: true, ranged: true, heavy: false, proficient: true };
  assert.equal(powerAttackFeat(sheet(["Great Weapon Master"]), melee).feat, "Great Weapon Master");
  assert.equal(powerAttackFeat(sheet(["Sharpshooter"]), shot).feat, "Sharpshooter");
  assert.match(powerAttackFeat(sheet([]), melee).refused.error, /none of them/);
  assert.match(powerAttackFeat(sheet(["Great Weapon Master"]), shot).refused.error, /needs Sharpshooter/);
  assert.match(powerAttackFeat(sheet(["Sharpshooter"]), melee).refused.error, /needs Great Weapon Master/);
  assert.match(powerAttackFeat(sheet(["Great Weapon Master"]), { ...melee, heavy: false }).refused.error, /heavy melee weapon/);
  assert.match(powerAttackFeat(sheet(["Great Weapon Master"]), { ...melee, weaponAttack: false }).refused.error, /spell attack/);
  // A feat written as a feature (a DM's tool) counts the same.
  assert.equal(powerAttackFeat(sheet([], { features: [{ name: "Great Weapon Master" }] }), melee).feat, "Great Weapon Master");
});

test("cover, long range and a foe at the elbow", () => {
  assert.equal(shotIgnoresCover(sheet(["Sharpshooter"])), true);
  assert.equal(shotIgnoresLongRange(sheet(["Sharpshooter"])), true);
  assert.equal(shotIgnoresCover(sheet(["Spell Sniper"])), false);
  assert.equal(spellIgnoresCover(sheet(["Spell Sniper"])), true);
  assert.equal(spellRangeFactor(sheet(["Spell Sniper"])), 2);
  assert.equal(spellRangeFactor(sheet([])), 1);
  assert.equal(shootsFreelyInMelee(sheet(["Crossbow Expert"])), true);
  assert.equal(shootsFreelyInMelee(sheet(["Gunner"])), true);
  assert.equal(shootsFreelyInMelee(sheet(["Sharpshooter"])), false);
});

test("Elemental Adept names its type on the sheet, and floors the dice of that type at 2", () => {
  const spec = featGrantSpec(authoredFeatDesc("Elemental Adept"));
  assert.deepEqual(spec.damageTypes, ["acid", "cold", "fire", "lightning", "thunder"]);
  assert.equal(featPicksOwed("Elemental Adept", spec, undefined), "Elemental Adept: pick a damage type.");
  assert.equal(featPicksOwed("Elemental Adept", spec, { damageType: "fire" }), null);
  const wrong = applyFeatGrants({
    proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
    feats: [{ name: "Elemental Adept", desc: authoredFeatDesc("Elemental Adept") }],
    choices: { "elemental adept": { damageType: "necrotic" } },
    strict: true,
  });
  assert.ok(wrong.problems.some((line) => /"necrotic" is not a damage type Elemental Adept offers/.test(line)), wrong.problems.join(" | "));
  const adept = sheet(["Elemental Adept"], { featChoices: { "elemental adept": { damageType: "Fire" } } });
  assert.equal(elementalAdeptType(adept), "fire");
  assert.equal(elementalAdeptApplies(adept, "fire"), true);
  assert.equal(elementalAdeptApplies(adept, "cold"), false);
  assert.equal(elementalAdeptType(sheet(["Elemental Adept"])), null, "no type picked, no feat");
  assert.equal(floorDamageDice("8d6"), "8d6f2");
  assert.equal(floorDamageDice("2d10+3"), "2d10f2+3");
  assert.equal(floorDamageDice("1d8+1d6-1"), "1d8f2+1d6f2-1");
  assert.equal(floorDamageDice("4d6kh3"), "4d6kh3f2");
  assert.equal(floorDamageDice("2d6f3"), "2d6f3", "a higher floor stays");
  assert.equal(floorDamageDice("12"), "12");
});

test("Dungeon Delver notices traps and secret doors; Defensive Duelist needs the feat and a finesse weapon in hand", () => {
  const delver = sheet(["Dungeon Delver"]);
  assert.equal(dungeonDelverNotices(delver, "traps_and_secret_doors"), true);
  assert.equal(dungeonDelverNotices(delver, undefined), false);
  assert.equal(dungeonDelverNotices(sheet([]), "traps_and_secret_doors"), false);
  const duelist = sheet(["Defensive Duelist"], { equipment: [{ name: "Rapier", qty: 1, equipped: true }] });
  assert.equal(defensiveDuelistBonus(duelist, 3), 3);
  assert.equal(defensiveDuelistBonus(sheet(["Defensive Duelist"], { equipment: [{ name: "Rapier", qty: 1 }] }), 3), null, "not in hand");
  assert.equal(defensiveDuelistBonus(sheet(["Defensive Duelist"], { equipment: [{ name: "Greatsword", qty: 1, equipped: true }] }), 3), null, "not finesse");
  assert.equal(defensiveDuelistBonus(sheet([], { equipment: [{ name: "Rapier", qty: 1, equipped: true }] }), 3), null);
});

test("the prompt tags the feats the server applies", () => {
  assert.equal(featEngineTag("Great Weapon Master"), "[pc_attack powerAttack]");
  assert.equal(featEngineTag("Defensive Duelist"), "[use_reaction]");
  assert.equal(featEngineTag("Elemental Adept"), "[server]");
  assert.equal(featEngineTag("Fey Touched"), "[cast tools]");
  // Actor's advantage is the check engine's now (issue #147); Keen Mind stays the DM's.
  assert.equal(featEngineTag("Actor"), "[server]");
  assert.equal(featEngineTag("Keen Mind"), null);
});

// The builder tells the player what the table applies of a feat from this
// tag, and said "Nothing of this feat is applied by the table" of Savage
// Attacker while attack-swing.ts rolled its second damage (play-test
// 2026-11-07); the GM's prompt reads the same tag ("the server applies what
// its tag names"). So the tag follows the engines both ways: every feat any
// engine under src/lib asks for by name carries one (Martial Adept's
// maneuvers, Elven Accuracy's third d20, Inspiring Leader's and Metamagic
// Adept's counters, Telepathic's free cast and the content pack's check
// riders were missed too), and every name the tag lists is one an engine
// reads, never a promise the table does not keep.
test("the tag follows the engines: every feat they run carries one, and every tagged feat is run", async () => {
  for (const feat of ["Savage Attacker", "Poisoner", "Athlete", "Chef", "Healer", "Elven Accuracy", "Eldritch Adept"]) {
    assert.equal(featEngineTag(feat), "[server]", feat);
  }
  assert.equal(featEngineTag("Martial Adept"), "[pc_attack maneuver]");
  assert.equal(featEngineTag("Inspiring Leader"), "[use_resource]");
  assert.equal(featEngineTag("Metamagic Adept"), "[use_resource]");
  assert.equal(featEngineTag("Telepathic"), "[cast tools]");
  assert.equal(featEngineTag("Telekinetic"), "[cast tools]");
  assert.equal(featEngineTag("Stalwart"), "[server]");
  assert.equal(featEngineTag("Floriographer"), "[server]");

  const root = new URL("../src/lib/", import.meta.url);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) walk(url);
      else if (/\.ts$/.test(entry.name)) files.push(url);
    }
  };
  walk(root);
  const read = (url) => readFileSync(url, "utf8").replace(/\r\n/g, "\n");
  const combat = read(new URL("srd/feat-combat.ts", root));
  const tagBody = combat.slice(combat.indexOf("export function featEngineTag"), combat.indexOf("\n}\n", combat.indexOf("export function featEngineTag")));
  // Every name an engine asks for: holdsFeat and hasFeat calls, the check
  // riders, the option slots a feat opens, the counters keyed to a feat.
  const named = new Set();
  for (const url of files) {
    const text = read(url);
    for (const match of text.matchAll(/(?:holdsFeat|hasFeat)\(\s*[\w.?]+\s*,\s*"([^"]+)"/g)) named.add(match[1].toLowerCase());
  }
  for (const match of combat.matchAll(/\bfeat: "([^"]+)"/g)) named.add(match[1].toLowerCase());
  for (const match of combat.matchAll(/held\("([^"]+)"\)/g)) named.add(match[1].toLowerCase());
  const resources = read(new URL("srd/class-resources.ts", root));
  for (const match of resources.matchAll(/displayName: "[^"]*\((Martial Adept|Metamagic Adept)\)"|match: \["(inspiring leader)"/g)) named.add((match[1] ?? match[2]).toLowerCase());
  for (const match of read(new URL("srd/feature-effects.ts", root)).matchAll(/isNamed\(name, "(Elven Accuracy)"\)/g)) named.add(match[1].toLowerCase());
  // Not feats: an Eldritch Invocation the ritual book also reads.
  named.delete("book of ancient secrets");
  assert.ok(named.size > 50, `read ${named.size} feat names from the engines`);
  const untagged = [...named].filter((feat) => !featEngineTag(feat)).sort();
  assert.deepEqual(untagged, [], `run by the engines but untagged: ${untagged.join(", ")}`);

  // And the other way: each name the tag lists is read somewhere outside it
  // (FEAT_TWINS' names are a lookup, not a reading), or its own text is
  // what the feat spell engine reads (Fey Touched's misty step).
  const { featSpellSpec, featSpellsAnything } = await import("../src/lib/srd/feat-spells.ts");
  const effects = read(new URL("srd/feat-effects.ts", root));
  const twins = effects.slice(effects.indexOf("export const FEAT_TWINS"), effects.indexOf("// ---- a table's workshop feats ----"));
  const elsewhere = files
    .map((url) => {
      if (url.pathname.endsWith("srd/feat-combat.ts")) return combat.replace(tagBody, "");
      if (url.pathname.endsWith("srd/feat-effects.ts")) return effects.replace(twins, "");
      return read(url);
    })
    .join("\n")
    .toLowerCase();
  const listed = [...new Set([...tagBody.matchAll(/"([a-z][a-z' -]+)"/g)].map((match) => match[1]))];
  assert.ok(listed.length > 40, `read ${listed.length} names from the tag`);
  const bySpellText = (name) => featSpellsAnything(featSpellSpec(authoredFeatDesc(name) ?? ""));
  const unread = listed.filter((name) => !elsewhere.includes(`"${name}"`) && !named.has(name) && !bySpellText(name)).sort();
  assert.deepEqual(unread, [], `tagged but no engine reads it: ${unread.join(", ")}`);
});

// A feat the engines run one rule of keeps its text's reading on the
// Reference page: the tag would otherwise have hidden Floriographer's
// training behind "hand-written" (feat-reading-logic.ts).
test("a content pack's check-rider feat is tagged and still read from its text", async () => {
  const { readFeat } = await import("../src/lib/content/feat-reading-logic.ts");
  const reading = readFeat({ name: "Floriographer", slug: "floriographer", documentSlug: "a5e", data: { desc: "You gain proficiency in the Nature skill. You have advantage on Investigation checks to notice a hidden message of a visual kind." } });
  assert.notEqual(reading.source, "hand-written");
});

// A weapon is the SRD row it swings as (AttackProfile's base), never the name
// it is carried under: an "Oathbow" or a "Balestra a mano" is what its row is.
test("Polearm Master and Crossbow Expert read the SRD weapon, not the carried name", () => {
  assert.equal(isPolearm("Glaive"), true);
  assert.equal(isPolearm("Spear of the Dark Sun"), false, "a carried name is no base");
  assert.equal(isPolearm(undefined), false);
  const budget = { oncePerTurn: [ONE_HANDED_ATTACKED], dashed: false };
  const expert = sheet(["Crossbow Expert"]);
  assert.equal(featBonusAttack(expert, budget, { weaponAttack: true, melee: false, weapon: "Hand Crossbow" }), "Crossbow Expert");
  assert.equal(featBonusAttack(expert, budget, { weaponAttack: true, melee: false, weapon: "Light Crossbow" }), null);
  assert.equal(featBonusAttack(expert, budget, { weaponAttack: true, melee: false, weapon: undefined }), null);
});

console.log(`${passed} checks passed`);
