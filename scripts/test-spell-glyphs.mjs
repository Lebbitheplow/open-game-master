// A spell card's glyph and the words beside it (issue 845,
// src/lib/battlemap/spell-glyph-logic.ts): every spell the manifest lists
// wears a glyph without the content pack, the name table holds only what the
// engine's rows do not already say, a workshop block is read before the
// published spell, every glyph is a painting that ships, and the words
// beside it are the area or the count the dealt card carries. Pure.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..");
const glyphs = await import("../src/lib/battlemap/spell-glyph-logic.ts");
const { SPELL_GLYPH_NAMES } = await import("../src/lib/battlemap/spell-glyph-names.ts");
const { spellMechFor } = await import("../src/lib/srd/spell-mechanics.ts");
const { bakedSpellMech } = await import("../src/lib/content/baked-spells.ts");
const { namedSpellGlyph } = await import("../src/lib/battlemap/hand-spells.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { handCardArtwork } = await import("../src/lib/battlemap/card-art.ts");
const { iconCandidates } = await import("../src/lib/icons.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");

const { SPELL_GLYPHS, spellGlyph, glyphFromMech, spellGlyphSrc, spellTargetWords, targetLines, spellGlyphLabel } = glyphs;

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
  passed += 1;
}

const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, "src/lib/srd/manifest/spells.json"), "utf8")).spells;
// The row the card reads with no pack: authored or overridden, else baked.
const rowOf = (name) => spellMechFor([name]) ?? bakedSpellMech(name);

test("every spell in the manifest wears a glyph without the content pack", () => {
  assert.ok(MANIFEST.length >= 500, `${MANIFEST.length} spells`);
  const unknown = MANIFEST.filter((spell) => namedSpellGlyph(spell.n) === "unknown").map((spell) => spell.n);
  assert.deepEqual(unknown, []);
  for (const spell of MANIFEST) assert.ok(SPELL_GLYPHS.includes(namedSpellGlyph(spell.n)), spell.n);
});

test("the glyphs players will meet most read as the council chose them", () => {
  const expected = {
    Fireball: "fire",
    "Fire Bolt": "fire",
    "Ray of Frost": "cold",
    "Magic Missile": "force",
    "Eldritch Blast": "force",
    "Sacred Flame": "radiant",
    "Inflict Wounds": "necrotic",
    "Chill Touch": "necrotic",
    "Poison Spray": "poison",
    Thunderwave: "thunder",
    "Lightning Bolt": "lightning",
    "Vicious Mockery": "psychic",
    "Ice Storm": "cold",
    "Searing Smite": "fire",
    "Spiritual Weapon": "force",
    "Cure Wounds": "heal",
    "Healing Word": "heal",
    Revivify: "heal",
    "Lesser Restoration": "restore",
    "Greater Restoration": "restore",
    "Remove Curse": "restore",
    Shield: "guard",
    "Mage Armor": "guard",
    Sanctuary: "guard",
    Counterspell: "dispel",
    "Dispel Magic": "dispel",
    Bless: "buff",
    Haste: "buff",
    Bane: "debuff",
    "Hold Person": "debuff",
    Sleep: "debuff",
    "Find Familiar": "summon",
    "Conjure Animals": "summon",
    "Misty Step": "teleport",
    "Dimension Door": "teleport",
    "Detect Magic": "detection",
    Identify: "detection",
    "Mage Hand": "utility",
    Light: "utility",
    "Chromatic Orb": "choice",
    "Dragon's Breath": "choice",
    "Chaos Bolt": "choice",
  };
  const wrong = Object.entries(expected)
    .filter(([name, glyph]) => namedSpellGlyph(name) !== glyph)
    .map(([name, glyph]) => `${name}: ${namedSpellGlyph(name)}, not ${glyph}`);
  assert.deepEqual(wrong, []);
});

test("the name table holds only what the rows do not already say, each spell once", () => {
  const manifest = new Set(MANIFEST.flatMap((spell) => [spell.n, ...(spell.a ?? [])].map(textKey)));
  const seen = new Map();
  const problems = [];
  for (const [glyph, names] of Object.entries(SPELL_GLYPH_NAMES)) {
    assert.ok(SPELL_GLYPHS.includes(glyph), glyph);
    for (const name of names) {
      if (!manifest.has(textKey(name))) problems.push(`${name} is not a manifest spell`);
      if (seen.has(textKey(name))) problems.push(`${name} is under ${seen.get(textKey(name))} and ${glyph}`);
      seen.set(textKey(name), glyph);
      // An entry the rules already give would hide a row that changed.
      if (glyphFromMech(rowOf(name)) === glyph) problems.push(`${name}: its row already reads ${glyph}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("a row is read by its damage first, then by what it does", () => {
  assert.equal(glyphFromMech({ resolution: "save", damageType: "fire" }), "fire");
  assert.equal(glyphFromMech({ resolution: "attack", damageType: "Piercing" }), "physical");
  assert.equal(glyphFromMech({ resolution: "attack", damageType: "cold", condition: { name: "slowed" } }), "cold", "damage leads a hold");
  assert.equal(glyphFromMech({ resolution: "heal" }), "heal");
  assert.equal(glyphFromMech({ resolution: "utility", revive: { hp: "one", withinMinutes: 1 } }), "heal");
  assert.equal(glyphFromMech({ resolution: "utility", cures: { all: false, conditions: ["poisoned"] } }), "restore");
  assert.equal(glyphFromMech({ resolution: "summon" }), "summon");
  assert.equal(glyphFromMech({ resolution: "save", condition: { name: "frightened" } }), "debuff");
  assert.equal(glyphFromMech({ resolution: "buff", buff: { condition: "blessed", target: "allies", rounds: 10 } }), "buff");
  assert.equal(glyphFromMech({ resolution: "utility" }), null);
  assert.equal(glyphFromMech({ resolution: "save", damageType: "sonic" }), null, "a type with no painting says nothing");
  assert.equal(glyphFromMech(null), null);
});

test("a workshop spell is read by its own block, then by the spell it runs as, else unknown", () => {
  const cold = { resolution: "save", damageType: "cold" };
  assert.equal(spellGlyph({ name: "Frostball", runsAs: "Fireball", ownBlock: true, mech: cold }), "cold");
  assert.equal(spellGlyph({ name: "Frostball", runsAs: "Fireball", ownBlock: true, mech: { resolution: "utility" }, published: rowOf("Fireball") }), "fire");
  assert.equal(spellGlyph({ name: "Kael's Quiet Step", runsAs: "Misty Step", mech: null }), "teleport");
  assert.equal(spellGlyph({ name: "Kael's Quiet Step", mech: null }), "unknown", "nobody said what it does");
  assert.equal(spellGlyph({ name: "Kael's Warm Hands", mech: { resolution: "heal" } }), "heal", "a pack spell whose text the reader placed");
  // A spell's other names find it: the SRD drops the wizard's name.
  assert.equal(spellGlyph({ name: "chromatic orb", mech: null }), "choice");
});

test("every glyph is a painting that ships, under the square budget, and only those", () => {
  const dir = path.join(ROOT, "public/assets/icons/glyph");
  const shipped = readdirSync(dir).filter((file) => file.startsWith("spell-")).sort();
  assert.deepEqual(shipped, SPELL_GLYPHS.map((glyph) => `spell-${glyph}.webp`).sort());
  for (const glyph of SPELL_GLYPHS) {
    const file = path.join(ROOT, "public", spellGlyphSrc(glyph));
    assert.ok(existsSync(file), glyph);
    assert.ok(statSync(file).size <= 48 * 1024, `${glyph} is over 48 KiB`);
  }
  // The provenance names every glyph and the file it ships as.
  const provenance = JSON.parse(readFileSync(path.join(ROOT, "docs/art/spell-glyphs-2026-11-10/provenance.json"), "utf8"));
  assert.deepEqual(provenance.glyphs.map((entry) => entry.glyph).sort(), [...SPELL_GLYPHS].sort());
  for (const entry of provenance.glyphs) assert.equal(`/${entry.file.replace(/^public\//, "")}`, spellGlyphSrc(entry.glyph));
});

test("a screen reader hears the glyph in words", () => {
  assert.equal(spellGlyphLabel("fire"), "fire damage");
  assert.equal(spellGlyphLabel("physical"), "weapon damage");
  assert.equal(spellGlyphLabel("choice"), "damage type of your choice");
  // An effect is said in plain words, as the card's own lines are: "buff"
  // and "debuff" are game jargon, and "heal" or "summon" read as a verb.
  assert.equal(spellGlyphLabel("heal"), "healing");
  assert.equal(spellGlyphLabel("restore"), "ends a condition");
  assert.equal(spellGlyphLabel("guard"), "protection");
  assert.equal(spellGlyphLabel("dispel"), "ends a spell");
  assert.equal(spellGlyphLabel("buff"), "boon");
  assert.equal(spellGlyphLabel("debuff"), "hindrance");
  assert.equal(spellGlyphLabel("summon"), "summoning");
  assert.equal(spellGlyphLabel("teleport"), "teleportation");
  assert.equal(spellGlyphLabel("detection"), "detection");
  assert.equal(spellGlyphLabel("utility"), "utility");
  assert.equal(spellGlyphLabel("unknown"), "");
});

test("the words name an area, a count or whom the casting takes, and nothing for none", () => {
  const blast = (shape, feet, self = false) => ({ target: "none", area: { blast: { shape, feet, self } } });
  assert.equal(spellTargetWords(blast("sphere", 20)), "20-ft sphere");
  assert.equal(spellTargetWords(blast("cone", 60, true)), "60-ft cone");
  assert.equal(spellTargetWords(blast("line", 100, true)), "100-ft line");
  assert.equal(spellTargetWords(blast("cube", 15, true)), "15-ft cube");
  assert.equal(spellTargetWords(blast("sphere", 30, true)), "30 ft around you");
  assert.equal(spellTargetWords({ target: "none", area: { shape: "wall", feet: 60 } }), "60-ft wall");
  assert.equal(spellTargetWords({ target: "none", area: { shape: "aura", feet: 15 } }), "15 ft around you");
  assert.equal(spellTargetWords({ target: "enemy", shares: { count: 3, unit: "creature", stack: false } }), "Up to 3");
  assert.equal(spellTargetWords({ target: "enemy", shares: { count: 3, unit: "dart", stack: true } }), "3 darts");
  assert.equal(spellTargetWords({ target: "enemy", shares: { count: 1, unit: "beam", stack: true } }), "1 creature", "one beam is one creature");
  assert.equal(spellTargetWords({ target: "self" }), "You");
  assert.equal(spellTargetWords({ target: "ally" }), "1 creature");
  assert.equal(spellTargetWords({ target: "none" }), "");
});

test("the words break after the size or count, so the number reads first", () => {
  assert.deepEqual(targetLines("20-ft sphere"), ["20-ft", "sphere"]);
  assert.deepEqual(targetLines("3 darts"), ["3", "darts"]);
  assert.deepEqual(targetLines("30 ft around you"), ["30 ft", "around you"]);
  assert.deepEqual(targetLines("Up to 3"), ["Up to 3"]);
  assert.deepEqual(targetLines("You"), ["You"]);
  assert.deepEqual(targetLines(""), []);
});

// A wizard's dealt cards, with no pack: the words come from the engine's own
// card (its area, its shares, its target), so they say what this casting does.
const wizard = {
  id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
  name: "Mira", race: "human", class: "wizard", subclass: "", background: "", alignment: "", gender: "",
  level: 11, xp: 0,
  abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
  maxHp: 60, currentHp: 60, tempHp: 0, ac: 12, acOverride: false, speed: 30,
  hitDice: { die: "d6", total: 11, spent: 0 }, classes: [], hitDicePools: null,
  proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple"] },
  equipment: [], gold: 0, copper: 0, feats: [], features: [],
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 3, used: 0 }, 5: { max: 2, used: 0 } },
    prepared: ["Fireball", "Magic Missile", "Web", "Cone of Cold", "Hold Person", "Fire Bolt", "Mage Hand", "Misty Step", "Shield", "Chromatic Orb", "Blur"],
    known: [],
  },
  conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
  deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
  isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
};

test("a dealt spell card carries its glyph and the words for what it takes", () => {
  const hand = deriveHand(wizard, FRESH_TURN);
  const face = (name) => {
    const card = hand.find((entry) => entry.name === name);
    assert.ok(card, `${name} is dealt`);
    return [card.glyph, card.targetWords ?? ""];
  };
  assert.deepEqual(face("Fireball"), ["fire", "20-ft sphere"]);
  assert.deepEqual(face("Cone of Cold"), ["cold", "60-ft cone"]);
  assert.deepEqual(face("Web"), ["debuff", "20-ft cube"]);
  assert.deepEqual(face("Magic Missile"), ["force", "3 darts"]);
  assert.deepEqual(face("Fire Bolt"), ["fire", "1 creature"]);
  assert.deepEqual(face("Mage Hand"), ["utility", ""]);
  // The engine aims Misty Step at nothing; its "Self" range is on the
  // card's top line already.
  assert.deepEqual(face("Misty Step"), ["teleport", ""]);
  assert.deepEqual(face("Blur"), ["buff", "You"]);
  assert.deepEqual(face("Chromatic Orb"), ["choice", "1 creature"]);
  // A card that is not a spell keeps its painting.
  const strike = hand.find((entry) => !entry.glyph);
  assert.ok(strike, "the basic actions are dealt too");
  // The More sheet's row shows the same glyph as the card.
  const fireball = hand.find((entry) => entry.name === "Fireball");
  assert.deepEqual(iconCandidates(handCardArtwork(fireball)), [spellGlyphSrc("fire")]);
});

// The glyph and its words are styled by class names of their own: the words
// first wore "hand-target", the aim bar's target buttons' class, and gave
// those buttons their nowrap, their gold and a font sized from a container
// they are not in, so a button spread over the board (dominated-sides).
test("the glyph's class names are worn by the card's glyph alone", () => {
  const face = readFileSync(path.join(ROOT, "src/app/campaigns/[campaignId]/HandCardFace.tsx"), "utf8");
  const art = face.slice(face.indexOf("function SpellGlyphArt"), face.indexOf("export function HandPreviewRows"));
  const classes = [...art.matchAll(/className="([^"]+)"/g)].flatMap((match) => match[1].split(" ")).filter((name) => name !== "hand-art-icon");
  assert.ok(classes.length >= 2, "the glyph and its words have class names");
  const dir = path.join(ROOT, "src/app");
  const files = readdirSync(dir, { recursive: true }).filter((file) => /\.tsx$/.test(file) && !file.endsWith("HandCardFace.tsx"));
  for (const file of files) {
    const text = readFileSync(path.join(dir, file), "utf8");
    for (const name of classes) assert.ok(!new RegExp(`["'\\s]${name}["'\\s]`).test(text), `${file} wears ${name}, the spell glyph's own class`);
  }
});

console.log(`spell glyphs: ${passed} checks passed`);
