// A roll's words, made from its parts (src/lib/roll-words.ts, issue #1064).
//
// A roll's `detail` was a sentence its site wrote by hand, in English. The
// sites of a family that has moved write none: they say what the roll is in
// fields, and one module makes the words, in the reader's language. The
// first family is a character's own attacks and their damage. This holds:
//
//   - the English is the sentence each site wrote before, word for word.
//     Each case writes the old sentence out as the site built it, beside
//     the parts the site hands the door now;
//   - a French table reads the card in French: the weapon or spell by its
//     row's name, the engine's note and the joining words by the
//     dictionaries. A name nobody has translated reads in English;
//   - nothing a person or the model typed is ever put into another
//     language: a name with no key is shown as written, whatever the
//     dictionaries hold for that word. A name the engine itself wrote is a
//     row the engine names (an unarmed strike, a weapon swung as an
//     improvised one, the spell an attack is), and reads in French as it
//     did under the reader this replaces;
//   - a creature the table has not seen is "someone unseen" in the words,
//     as it always was, and neither its name nor its id is sent;
//   - a roll whose parts make its words is shown by its fields alone,
//     whatever its stored sentence says, and one whose site still writes
//     its sentence, or stored before its parts, is shown by that sentence;
//   - a waiting card of a family that has not moved shows its sentence
//     exactly as written;
//   - a roll handed neither a sentence nor parts that make its words is
//     refused.
//
// The second family is a creature's own attacks and their damage (issue
// #1121). This holds as well:
//
//   - a creature's action is stored by the name its stat block gives it,
//     and a French table reads it through the creature attack names, then
//     the weapons and the spells, never through the interface's dictionary:
//     a bundled creature's, a homebrew one's and a beast form's alike;
//   - every attack of the bundled bestiary reads as it did under the reader
//     this replaces, or better.
//
// The sites themselves are held, on their own paths and both doors, by
// scripts/test-enforce-roll-words.mjs and the dice-site sweep.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { translate } = await import("../src/lib/i18n/translate.ts");
// The catalog and the name tables as a server process installs them.
await import("../src/lib/i18n/fr-catalog.ts");
await import("../src/lib/i18n/es-catalog.ts");
const { hideNames } = await import("../src/lib/hidden-names-logic.ts");
const { pendingReason, pendingWords, rollAgainst, rollCardLabel, rollChronicleLead, rollToastLead } = await import("../src/lib/roll-labels.ts");
const { actionParts, actionUsed, attackParts, checkParts, foeTarget, keptTarget, noted, riderNote, sheetTarget, strikeParts, swingParts, swingUsed } = await import("../src/lib/roll-parts.ts");
const { contentName } = await import("../src/lib/content/names.ts");
const { ACTION_NAMES_FR, WEAPON_NAMES_FR } = await import("../src/lib/content/names-fr.ts");
const { DAMAGE_TYPES } = await import("../src/lib/dm/damage-logic.ts");
const CREATURES = JSON.parse(readFileSync(new URL("../src/lib/srd/srd-creatures.json", import.meta.url), "utf8"));
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { ACTION_WORDS_VERSION, cardLine, cardReason, makesWords, PHYSICAL, ROLL_NOTES, rollSentence, rollWords, seatSentences, wordParts, WORDS_VERSION } = await import("../src/lib/roll-words.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const translator = (locale) => Object.assign((key, vars) => translate(locale, key, vars), { locale });
const en = translator("en");
const fr = translator("fr");
const es = translator("es");

const GOBLIN = { id: "a-goblin", displayName: "Goblin" };
const ARIA = { kind: "sheet", id: "aria", name: "Aria" };
const longsword = { name: "Longsword", base: "Longsword" };
const spellRow = (name) => ({ kind: "spell", name });
const weaponRow = (name) => ({ kind: "weapon", name });
const fireBolt = { name: "Fire Bolt", spell: true, row: spellRow("Fire Bolt") };
const acidArrow = { name: "Acid Arrow", spell: true, row: spellRow("Acid Arrow") };
// The engine's own name for a strike with no weapon (attack-logic.ts).
const unarmed = { name: "Unarmed strike", row: weaponRow("Unarmed strike") };
const atDoor = (parts, physical = false) => (physical ? { ...parts, physical: true } : parts);

// ---- the English is the sentence each site wrote ----

// Each row: the site, the sentence it built by hand before, and the parts
// it hands the door now.
const SITES = [
  ["pc_attack, a weapon's attack roll and its damage (pc-attack-resolve.ts strikeToHit)", rollAgainst("Longsword", "Goblin"), attackParts(longsword, foeTarget(GOBLIN))],
  ["pc_attack, a weapon carried under another name than its row's", rollAgainst("Longsword +1", "Goblin"), attackParts({ name: "Longsword +1", base: "Longsword" }, foeTarget(GOBLIN))],
  ["pc_attack, a spell attack", rollAgainst("Fire Bolt", "Goblin"), attackParts(fireBolt, foeTarget(GOBLIN))],
  ["pc_attack, a spell only the model named", rollAgainst("Ember Lash", "Goblin"), attackParts({ name: "Ember Lash", spell: true }, foeTarget(GOBLIN))],
  ["pc_attack, an unarmed strike", rollAgainst("Unarmed strike", "Goblin"), attackParts(unarmed, foeTarget(GOBLIN))],
  ["pc_attack, a carried weapon swung as an improvised one", rollAgainst("Longbow", "Goblin"), attackParts({ name: "Longbow", row: weaponRow("Longbow") }, foeTarget(GOBLIN))],
  ["pc_attack, an object picked up by a name of the model's", rollAgainst("Log", "Goblin"), attackParts({ name: "Log" }, foeTarget(GOBLIN))],
  ["pc_attack, the half a spell deals on a miss (pc-attack-resolve.ts, pc-attack-parked.ts)", rollAgainst(`${"Acid Arrow"} (half on a miss)`, "Goblin"), noted(attackParts(acidArrow, foeTarget(GOBLIN)), "half_on_miss")],
  ["an opportunity attack and its damage (opportunity-strike.ts)", rollAgainst(`${"Longsword"} (opportunity attack)`, "Goblin"), attackParts(longsword, foeTarget(GOBLIN), "opportunity")],
  ["a weapon swung at a named object (object-damage.ts)", rollAgainst("Longsword", "a door"), attackParts(longsword, { kind: "object", name: "a door" })],
  ["a weapon swung at an object nobody named", rollAgainst("Longsword", undefined ?? "an object"), attackParts(longsword, { kind: "object" })],
];

test("each site of the first family stores the sentence it wrote by hand before, word for word", () => {
  for (const [site, before, parts] of SITES) {
    assert.equal(rollSentence({ parts }), before, site);
    // Dice rolled at the table: the door wrote its mark after the words.
    assert.equal(rollSentence({ parts: atDoor(parts, true) }), `${before} ${PHYSICAL}`, `${site}, on the player's own dice`);
    // And the three surfaces read the same English as they did.
    const roll = { kind: "attack", detail: rollSentence({ parts }), attacker: ARIA, parts };
    assert.equal(rollCardLabel(en, roll, "Aria"), `Aria · Attack roll (${before})`, site);
    assert.equal(rollToastLead(en, roll, "Aria"), `Aria · ${before}`, site);
    assert.equal(rollChronicleLead(en, roll, "Aria"), `Aria · ${before}`, site);
  }
});

test("a character fighting the party is struck as a character, a creature as a creature", () => {
  assert.deepEqual(foeTarget({ id: "e1", displayName: "Goblin 2", slug: "goblin" }), { kind: "enemy", id: "e1", name: "Goblin 2" });
  assert.deepEqual(foeTarget({ id: "s1", displayName: "Borin", slug: "sheet" }), { kind: "sheet", id: "s1", name: "Borin" });
});

// ---- a French table reads the card in French ----

const card = (parts, kind = "attack", t = fr) => rollCardLabel(t, { kind, detail: rollSentence({ parts }), attacker: ARIA, parts }, "Aria");

test("a French table's card says the weapon, the note and the joining words in French", () => {
  assert.equal(card(attackParts(longsword, foeTarget(GOBLIN))), "Aria · Jet d’attaque (Épée longue c/ Goblin)");
  assert.equal(card(attackParts(longsword, foeTarget(GOBLIN)), "damage"), `Aria · ${translate("fr", "Damage")} (Épée longue c/ Goblin)`);
  assert.equal(card(attackParts(fireBolt, foeTarget(GOBLIN))), "Aria · Jet d’attaque (Trait de feu c/ Goblin)");
  // The note is the engine's own, so the dictionary finds it. Read as a
  // sentence, "Longsword (opportunity attack)" was no weapon the reader
  // knew, and the whole card stayed English.
  assert.equal(card(attackParts(longsword, foeTarget(GOBLIN), "opportunity")), "Aria · Jet d’attaque (Épée longue (attaque d’opportunité) c/ Goblin)");
  // A missed attack is "un raté" in the dictionary, as elsewhere in the app.
  assert.equal(card(noted(attackParts(acidArrow, foeTarget(GOBLIN)), "half_on_miss")), "Aria · Jet d’attaque (Flèche acide (moitié sur un raté) c/ Goblin)");
  assert.equal(card(attackParts(longsword, { kind: "object" })), "Aria · Jet d’attaque (Épée longue c/ un objet)");
  assert.equal(card(atDoor(attackParts(longsword, foeTarget(GOBLIN)), true)), "Aria · Jet d’attaque (Épée longue c/ Goblin (dés physiques))");
  // The toast and the chronicle's line, from the same parts.
  const roll = { kind: "attack", detail: "", requestedBy: "dm", attacker: ARIA, parts: attackParts(longsword, foeTarget(GOBLIN), "opportunity") };
  assert.equal(rollToastLead(fr, roll, "Aria"), "Aria · Épée longue (attaque d’opportunité) c/ Goblin");
  assert.equal(rollChronicleLead(fr, roll, "Aria"), "Aria · Épée longue (attaque d’opportunité) c/ Goblin");
});

test("what was used is put into French by its key alone, where it is carried under its row's own name", () => {
  const words = (attack) => rollWords(fr, attackParts(attack, foeTarget(GOBLIN)));
  // The crossbows' rows are keyed the other way round (content/names.ts).
  assert.equal(words({ name: "Light Crossbow", base: "Light Crossbow" }), "Arbalète légère c/ Goblin");
  // A name typed in another case is still its row's name.
  assert.equal(words({ name: "fire bolt", spell: true, row: spellRow("Fire Bolt") }), "Trait de feu c/ Goblin");
  // An attack a spell grants strikes under the spell's own name, and is its row.
  assert.equal(words({ name: "Spiritual Weapon", row: spellRow("Spiritual Weapon") }), "Arme spirituelle c/ Goblin");
  assert.equal(attackParts({ name: "Spiritual Weapon", row: spellRow("Spiritual Weapon") }, foeTarget(GOBLIN)).used.kind, "spell");
  // Carried under another name than its row's: the name it is carried
  // under, as written. A Flame Tongue is not shown as a longsword.
  assert.equal(words({ name: "Flame Tongue", base: "Longsword" }), "Flame Tongue c/ Goblin");
  assert.equal(words({ name: "Longsword +1", base: "Longsword" }), "Longsword +1 c/ Goblin");
  assert.equal(words({ name: "Grandfather's Blade", base: "Longsword" }), "Grandfather's Blade c/ Goblin");
  // A pack's weapon: a key, and no French name. English, as everywhere.
  assert.equal(words({ name: "Plasma Cutter", base: "Plasma Cutter" }), "Plasma Cutter c/ Goblin");
});

test("a name a person or the model typed is never put into another language, whatever the dictionaries hold for the word", () => {
  const weapon = (name) => rollWords(fr, attackParts({ name }, foeTarget(GOBLIN)));
  const spell = (name) => rollWords(fr, attackParts({ name, spell: true }, foeTarget(GOBLIN)));
  // Each of these is a line of the app's dictionary, or a row of a names
  // table under another kind: an improvised "Log" is no "Journal".
  for (const name of ["Log", "Turn", "Close", "Back", "Save", "Custom", "Hide", "Light", "Bite", "Longbow"]) {
    assert.equal(weapon(name), `${name} c/ Goblin`, `an improvised weapon called ${name}`);
    assert.equal(spell(name), `${name} c/ Goblin`, `a spell only the model named, called ${name}`);
  }
  // The dictionary does hold some of them: the rule, not luck, keeps them.
  assert.equal(translate("fr", "Log"), "Journal");
  assert.equal(translate("fr", "Bite"), "Morsure");
  // A target is named as it was when the roll was made.
  assert.equal(rollWords(fr, attackParts(longsword, { kind: "object", name: "Log" })), "Épée longue c/ Log");
  assert.equal(rollWords(fr, attackParts(longsword, { kind: "enemy", name: "Light" })), "Épée longue c/ Light");
});

test("a name the engine itself wrote is a row it names, and reads in French as it did under the reader this replaces", () => {
  // The reader of sentences, which a roll with no parts still goes through:
  // what a French table read for these words before the sites moved.
  const before = (words) => rollCardLabel(fr, { kind: "attack", detail: words, attacker: ARIA, parts: null }, "Aria");
  const now = (attack, target = foeTarget(GOBLIN), note) => card(attackParts(attack, target, note));
  // The engine's own name for a strike with no weapon.
  assert.equal(now(unarmed), "Aria · Jet d’attaque (Attaque à mains nues c/ Goblin)");
  assert.equal(now(unarmed), before("Unarmed strike vs Goblin"));
  assert.deepEqual(attackParts(unarmed, foeTarget(GOBLIN)).used, { kind: "weapon", key: "unarmed strike", name: "Unarmed strike" });
  // A carried weapon swung as an improvised one keeps no profile of its
  // own, and is still the weapon its name says.
  assert.equal(now({ name: "Longbow", row: weaponRow("Longbow") }), "Aria · Jet d’attaque (Arc long c/ Goblin)");
  assert.equal(now({ name: "Longbow", row: weaponRow("Longbow") }), before("Longbow vs Goblin"));
  // Every SRD weapon swung as itself.
  for (const weapon of SRD_WEAPONS) {
    assert.equal(now({ name: weapon.name, base: weapon.name }), before(`${weapon.name} vs Goblin`), weapon.name);
  }
  // An attack a spell grants, wherever it is made: at a creature, at an
  // object, as an opportunity attack. Every site reads the profile through
  // swingParts, so none drops the row the profile names.
  const granted = { weapon: "Spiritual Weapon", toHit: 5, named: spellRow("Spiritual Weapon") };
  assert.equal(card(swingParts(granted, foeTarget(GOBLIN))), "Aria · Jet d’attaque (Arme spirituelle c/ Goblin)");
  assert.equal(card(swingParts(granted, { kind: "object", name: "a door" })), "Aria · Jet d’attaque (Arme spirituelle c/ a door)");
  assert.equal(card(swingParts(granted, { kind: "object", name: "a door" })), before("Spiritual Weapon vs a door"));
  assert.equal(card(swingParts(granted, foeTarget(GOBLIN), { note: "opportunity" })), "Aria · Jet d’attaque (Arme spirituelle (attaque d’opportunité) c/ Goblin)");
  // What a profile or a record says is all read: the weapon it swings as,
  // the row its name is, and whether it is a spell attack with no row.
  assert.deepEqual(swingParts({ weapon: "Longsword +1", base: "Longsword" }, foeTarget(GOBLIN)).used, { kind: "weapon", key: "longsword", name: "Longsword +1" });
  assert.deepEqual(swingParts({ weapon: "Ember Lash" }, foeTarget(GOBLIN), { spell: true }).used, { kind: "spell", name: "Ember Lash" });
  assert.deepEqual(swingParts({ weapon: "Fire Bolt", named: spellRow("Fire Bolt") }, foeTarget(GOBLIN), { spell: true }).used, { kind: "spell", key: "fire bolt", name: "Fire Bolt" });
});

// ---- a creature the table has not seen ----

test("a hidden creature is \"someone unseen\" in the words, lower case as before, and a seat is sent neither its name nor its id", () => {
  const parts = attackParts(longsword, foeTarget({ id: "enemy-7", displayName: "Lurker" }), "opportunity");
  const roll = { id: "r1", kind: "attack", detail: rollSentence({ parts }), attacker: ARIA, parts };
  // As the table is sent it (src/lib/table-delivery.ts tablePayloadFor).
  const hidden = new Set(["enemy-7"]);
  const sent = hideNames({ roll }, ["Lurker"], { ids: hidden }).roll;
  assert.deepEqual(sent.parts.targets, [{ kind: "unseen" }]);
  assert.equal(JSON.stringify(sent).includes("enemy-7"), false, "the hidden creature's id rode the roll");
  assert.equal(JSON.stringify(sent).includes("Lurker"), false, "the hidden creature's name rode the roll");
  assert.equal(sent.detail, "Longsword (opportunity attack) vs someone unseen");
  // The card reads as it did when it was shown by its sentence.
  assert.equal(rollCardLabel(en, sent, "Aria"), "Aria · Attack roll (Longsword (opportunity attack) vs someone unseen)");
  assert.equal(rollCardLabel(fr, sent, "Aria"), "Aria · Jet d’attaque (Épée longue (attaque d’opportunité) c/ quelqu’un hors de vue)");
  // The seats owed the creature are sent the roll as it was stored.
  assert.equal(hideNames({ roll }, []).roll, roll);
  // An object's name is a person's words: a hidden name in it is replaced
  // where it stands, and the object stays an object.
  const door = attackParts(longsword, { kind: "object", name: "the Lurker's door" });
  assert.deepEqual(hideNames({ roll: { parts: door } }, ["Lurker"], { ids: hidden }).roll.parts.targets, [{ kind: "object", name: "the someone unseen's door" }]);
  // A creature the table sees, beside one it does not.
  const both = { ...parts, targets: [{ kind: "enemy", id: "e1", name: "Goblin" }, { kind: "enemy", id: "enemy-7", name: "Lurker" }] };
  assert.deepEqual(hideNames({ roll: { parts: both } }, ["Lurker"], { ids: hidden }).roll.parts.targets, [{ kind: "enemy", id: "e1", name: "Goblin" }, { kind: "unseen" }]);
});

test("a hidden creature is matched by what it is: a seen creature whose name holds a hidden one's is still itself", () => {
  // "Bandit" is hidden, the "Bandit Captain" stands in plain sight.
  const hidden = new Set(["bandit-1"]);
  const captain = { kind: "enemy", id: "captain-1", name: "Bandit Captain" };
  const atCaptain = attackParts(longsword, captain);
  const sent = hideNames({ roll: { kind: "attack", detail: rollSentence({ parts: atCaptain }), attacker: ARIA, parts: atCaptain } }, ["Bandit"], { ids: hidden }).roll;
  assert.deepEqual(sent.parts.targets, [captain], "the Captain the table sees was sent as unseen");
  assert.equal(rollCardLabel(en, sent, "Aria"), "Aria · Attack roll (Longsword vs Bandit Captain)");
  // The hidden one, by its id.
  const atBandit = attackParts(longsword, { kind: "enemy", id: "bandit-1", name: "Bandit" });
  assert.deepEqual(hideNames({ roll: { parts: atBandit } }, ["Bandit"], { ids: hidden }).roll.parts.targets, [{ kind: "unseen" }]);
  // Hidden under a name a seen creature also answers to: no text is its
  // alone (namesToHide keeps the name), and it is still matched by its id.
  const twin = attackParts(longsword, { kind: "enemy", id: "bandit-1", name: "Goblin" });
  assert.deepEqual(hideNames({ roll: { parts: twin } }, [], { ids: hidden }).roll.parts.targets, [{ kind: "unseen" }]);
  assert.deepEqual(hideNames({ roll: { parts: attackParts(longsword, { kind: "enemy", id: "goblin-2", name: "Goblin" }) } }, [], { ids: hidden }).roll.parts.targets, [{ kind: "enemy", id: "goblin-2", name: "Goblin" }]);
  // A waiting card is sent its targets by name alone: the whole name, never
  // a part of it.
  assert.deepEqual(hideNames({ pendingRoll: { parts: wordParts(atCaptain) } }, ["Bandit"], { ids: hidden }).pendingRoll.parts.targets, [{ kind: "enemy", name: "Bandit Captain" }]);
  assert.deepEqual(hideNames({ pendingRoll: { parts: wordParts(atBandit) } }, ["Bandit"], { ids: hidden }).pendingRoll.parts.targets, [{ kind: "unseen" }]);
});

// ---- which rolls are shown by their fields ----

test("a roll whose parts make its words is shown by its fields alone, whatever its stored sentence says", () => {
  const parts = attackParts(longsword, foeTarget(GOBLIN));
  const roll = { kind: "attack", detail: "Mace vs Ogre", attacker: ARIA, parts };
  assert.equal(rollCardLabel(en, roll, "Aria"), "Aria · Attack roll (Longsword vs Goblin)");
  assert.equal(rollCardLabel(fr, roll, "Aria"), "Aria · Jet d’attaque (Épée longue c/ Goblin)");
  assert.equal(rollSentence(roll), "Longsword vs Goblin", "the sentence stored for such a roll is built from its parts");
});

test("a roll whose site still writes its sentence, one stored before its parts, and one worded by a later version are shown by that sentence", () => {
  // Parts that say only what a rule reads back (step 1) make no words.
  const check = { kind: "skill_check", detail: "perception", attacker: null, parts: checkParts({ skill: "perception" }) };
  assert.equal(rollCardLabel(en, check, "Aria"), "Aria · Skill check (perception)");
  assert.equal(rollSentence(check), "perception");
  const bare = { kind: "saving_throw", detail: "CON save to keep concentration (Bless)", attacker: null, parts: {} };
  assert.equal(rollCardLabel(en, bare, "Aria"), "Aria · Saving throw (CON save to keep concentration (Bless))");
  // Stored before the column: the reader puts what it can into French, as before.
  const old = { kind: "attack", detail: "Longsword vs Goblin", attacker: ARIA, parts: null };
  assert.equal(rollCardLabel(en, old, "Aria"), "Aria · Attack roll (Longsword vs Goblin)");
  assert.equal(rollCardLabel(fr, old, "Aria"), "Aria · Jet d’attaque (Épée longue c/ Goblin)");
  assert.equal(rollSentence({ detail: "Longsword vs Goblin", parts: null }), "Longsword vs Goblin");
  // A newer server's row, whose fields may mean something this build does
  // not know: its English sentence is always stored, and is what is shown.
  assert.equal(WORDS_VERSION, 1);
  const later = { kind: "attack", detail: "Longsword vs Goblin, from above", attacker: ARIA, parts: { ...attackParts(longsword, foeTarget(GOBLIN)), worded: ACTION_WORDS_VERSION + 1 } };
  assert.equal(makesWords(later.parts), false);
  assert.equal(rollCardLabel(en, later, "Aria"), "Aria · Attack roll (Longsword vs Goblin, from above)");
  // The mark of step 2's first build, before it was a number, is no version.
  assert.equal(makesWords({ ...attackParts(longsword, foeTarget(GOBLIN)), worded: true }), false);
});

test("a roll handed neither a sentence nor parts that make its words is refused, so none is stored with no words", () => {
  assert.throws(() => rollSentence({}), /neither/);
  assert.throws(() => rollSentence({ parts: checkParts({ skill: "perception" }) }), /neither/);
  assert.throws(() => rollSentence({ parts: null }), /neither/);
  // A sentence that is empty is still a sentence its site chose.
  assert.equal(rollSentence({ detail: "" }), "");
});

// ---- a roll card waiting on its player's dice ----

test("a waiting card of this family is worded as its roll will be, and is sent the fields that make its words and no more", () => {
  const parts = attackParts(longsword, foeTarget(GOBLIN), "opportunity");
  const waiting = (reason) => ({ detail: rollSentence({ parts }), reason, parts });
  assert.equal(pendingWords(fr, waiting("")), "Épée longue (attaque d’opportunité) c/ Goblin");
  assert.equal(pendingWords(en, waiting("")), "Longsword (opportunity attack) vs Goblin");
  // What the card is sent of its parts: the fields that make its words,
  // nothing a rule reads back from the roll once it lands, and no id.
  const sent = wordParts({ ...parts, purpose: "concentration", resists: "poison" });
  assert.deepEqual(sent, { ...parts, targets: [{ kind: "enemy", name: "Goblin" }] });
  assert.equal(wordParts(checkParts({ skill: "perception" })), undefined);
  assert.equal(wordParts(null), undefined);
  // The card and the landed roll are worded from the same fields: every
  // site's parts read the same once cut down to what a card is sent.
  for (const [site, , made] of SITES) {
    for (const t of [en, fr]) {
      assert.equal(rollWords(t, wordParts(atDoor(made, true))), rollWords(t, atDoor(made, true)), site);
    }
  }
});

test("a waiting card that was given no reason of its own does not say its words twice, nor once in English under a French title", () => {
  const parts = attackParts(longsword, foeTarget(GOBLIN), "opportunity");
  const words = rollSentence({ parts });
  // The card carries its words again as its reason (character-roll.ts).
  const copied = { detail: words, reason: words, parts };
  // Under a title that says the words: nothing.
  assert.equal(pendingReason(en, copied, true), "");
  assert.equal(pendingReason(fr, copied, true), "");
  // On a card with no such title (the after-the-roll card): the words, once,
  // in the reader's language; in English the same line as before.
  assert.equal(pendingReason(en, copied, false), words);
  assert.equal(pendingReason(fr, copied, false), "Épée longue (attaque d’opportunité) c/ Goblin");
  // A reason of the site's own is shown as it was written.
  const own = { detail: words, reason: "Before you enter your dice: reroll any die of 2 or less once (Great Weapon Fighting).", parts };
  assert.equal(pendingReason(fr, own, true), own.reason);
  assert.equal(pendingReason(fr, own, false), own.reason);
});

// The line a waiting card of this family says under its title, as each site
// wrote it by hand before (pc-attack-parked.ts, opportunity-strike.ts), and
// the steps as attack-damage-dice.ts wrote them.
const STEPS = [{ step: "reroll_low", below: 2 }, { step: "brutal" }, { step: "savage" }, { step: "piercer" }, { step: "empower", dice: 3 }];
const STEPS_BEFORE = [
  "reroll any die of 2 or less once (Great Weapon Fighting)",
  "roll the damage a second time and keep the better total (Brutal Attack)",
  "roll the weapon's dice a second time and keep the better total (Savage Attacker)",
  "reroll the lowest damage die once and keep the new roll (Piercer)",
  "reroll up to 3 of the damage dice and keep the new rolls (Empowered Spell)",
];
const stepsBefore = (steps) => `Before you enter your dice: ${steps.join(", then ")}.`;

test("a waiting card's own line is made from its fields: in English the line its site wrote by hand before, word for word, and in French the same line", () => {
  const goblin = foeTarget(GOBLIN);
  const weapon = "Longsword";
  const acid = rollWords(fr, { used: attackParts(acidArrow, goblin).used, worded: WORDS_VERSION });
  assert.notEqual(acid, "Acid Arrow", "the dictionary has no French name for the spell this case reads");
  const LINES = [
    ["attack", attackParts(longsword, goblin), [], `${weapon} attack against ${GOBLIN.displayName}`, "Épée longue : attaque contre Goblin"],
    ["damage", attackParts(longsword, goblin), [], `${weapon} damage against ${GOBLIN.displayName}`, "Épée longue : dégâts contre Goblin"],
    ["damage", attackParts(acidArrow, goblin, "half_on_miss"), [], `Acid Arrow half damage against ${GOBLIN.displayName}`, `${acid} : demi-dégâts contre Goblin`],
    [
      "damage",
      attackParts(longsword, goblin),
      STEPS.slice(2, 4),
      `${weapon} damage against ${GOBLIN.displayName}. ${stepsBefore(STEPS_BEFORE.slice(2, 4))}`,
      "Épée longue : dégâts contre Goblin. Avant de saisir tes dés : lance les dés de l’arme une seconde fois et garde le meilleur total (Savage Attacker), puis relance une fois le dé de dégâts le plus bas et garde le nouveau résultat (Piercer).",
    ],
    [
      "damage",
      attackParts(longsword, goblin, "opportunity"),
      STEPS.slice(0, 1),
      `${weapon} damage against ${GOBLIN.displayName} (opportunity attack). ${stepsBefore(STEPS_BEFORE.slice(0, 1))}`,
      "Épée longue : dégâts contre Goblin (attaque d’opportunité). Avant de saisir tes dés : relance une fois tout dé de 2 ou moins (Great Weapon Fighting).",
    ],
  ];
  for (const [kind, parts, steps, before, french] of LINES) {
    assert.equal(cardLine(en, kind, parts, { steps }), before);
    // The reason kept with the card, which GAME STATE, a connected agent and
    // a client not yet updated read: the same English.
    assert.equal(cardReason({ kind, parts, line: { steps } }), before);
    assert.equal(cardLine(fr, kind, parts, { steps }), french);
    // The card, as a seat is sent it: its reason in English, its line in
    // fields, and the reader's language under either title.
    const sent = { kind, detail: rollSentence({ parts }), reason: before, parts: wordParts(parts), carry: { line: { steps } } };
    for (const titled of [true, false]) {
      assert.equal(pendingReason(en, sent, titled), before);
      assert.equal(pendingReason(fr, sent, titled), french);
    }
  }
  // Every step, in the order they are said.
  assert.equal(cardLine(en, "damage", attackParts(longsword, goblin), { steps: STEPS }), `${weapon} damage against ${GOBLIN.displayName}. ${stepsBefore(STEPS_BEFORE)}`);
  for (const step of STEPS) {
    assert.notEqual(cardLine(fr, "damage", attackParts(longsword, goblin), { steps: [step] }), cardLine(en, "damage", attackParts(longsword, goblin), { steps: [step] }), `the step "${step.step}" has no French line`);
  }
  // A typed name in the line is shown as written, and a step this build
  // does not know reads as its id.
  assert.equal(cardLine(fr, "damage", attackParts({ name: "Log" }, { kind: "object", name: "the gate" }), { steps: [] }), "Log : dégâts contre the gate");
  assert.equal(cardLine(en, "damage", attackParts(longsword, goblin), { steps: [{ step: "later" }] }), `${weapon} damage against Goblin. Before you enter your dice: later.`);
});

test("a card with no line of its own keeps the reason its site wrote, or its words again; a line beside parts that make no words is not one", () => {
  const parts = attackParts(longsword, foeTarget(GOBLIN));
  assert.equal(cardReason({ kind: "attack", parts }), "Longsword vs Goblin");
  assert.equal(cardReason({ kind: "attack", parts, reason: "Why it is rolled" }), "Why it is rolled");
  assert.equal(cardReason({ kind: "skill_check", detail: "Perception", reason: "To spot the tripwire" }), "To spot the tripwire");
  assert.equal(cardReason({ kind: "skill_check", detail: "Perception" }), "Perception");
  assert.equal(cardReason({ kind: "skill_check", detail: "Perception", parts: checkParts({ skill: "perception" }), line: { steps: [] } }), "Perception");
  assert.throws(() => cardReason({ kind: "custom" }), /neither/);
  // A kind with no sentence of its own says the roll's words.
  assert.equal(cardLine(en, "saving_throw", parts, { steps: [] }), "Longsword vs Goblin");
});

test("a roll whose parts make its words takes its sentences from them as a seat is sent it: a seen creature whose name holds a hidden one's keeps its name in the sentence too", () => {
  const bandit = { id: "bandit", displayName: "Bandit" };
  const captain = { id: "captain", displayName: "Bandit Captain" };
  const names = ["Bandit"];
  const ids = new Set(["bandit"]);
  const landed = (foe, physical = false) => {
    const parts = atDoor(attackParts(longsword, foeTarget(foe)), physical);
    return { kind: "attack", detail: rollSentence({ parts }), parts };
  };
  // The text replacement alone, as before: it cannot tell the two apart.
  assert.equal(hideNames(landed(captain), names, { ids }).detail, "Longsword vs someone unseen Captain");
  assert.equal(hideNames(landed(captain), names, { ids, reword: seatSentences }).detail, "Longsword vs Bandit Captain");
  assert.equal(hideNames(landed(bandit), names, { ids, reword: seatSentences }).detail, "Longsword vs someone unseen");
  assert.equal(hideNames(landed(bandit, true), names, { ids, reword: seatSentences }).detail, `Longsword vs someone unseen ${PHYSICAL}`);
  // A creature hidden under a name a seen one answers to: by its id alone.
  assert.equal(hideNames(landed(bandit), [], { ids, reword: seatSentences }).detail, "Longsword vs someone unseen");
  // A waiting card, sent by name: its sentence and its own line.
  const card = (foe, line) => {
    const parts = attackParts(longsword, foeTarget(foe));
    return { kind: "attack", detail: rollSentence({ parts }), reason: cardReason({ kind: "attack", parts, ...(line ? { line } : {}) }), parts: wordParts(parts), ...(line ? { carry: { line } } : {}) };
  };
  const line = { steps: [] };
  assert.deepEqual(
    (({ detail, reason }) => ({ detail, reason }))(hideNames(card(bandit, line), names, { ids, reword: seatSentences })),
    { detail: "Longsword vs someone unseen", reason: "Longsword attack against someone unseen" },
  );
  assert.deepEqual(
    (({ detail, reason }) => ({ detail, reason }))(hideNames(card(captain, line), names, { ids, reword: seatSentences })),
    { detail: "Longsword vs Bandit Captain", reason: "Longsword attack against Bandit Captain" },
  );
  // A card with no line of its own still carries its words as its reason,
  // so the card does not say them twice.
  const copied = hideNames(card(bandit), names, { ids, reword: seatSentences });
  assert.equal(copied.reason, copied.detail);
  assert.equal(pendingReason(fr, copied, true), "");
  // Nothing hidden: the same object, as before.
  const seen = landed(captain);
  assert.equal(hideNames(seen, ["Wolf"], { ids: new Set(["wolf"]), reword: seatSentences }), seen);
  // A roll whose site still writes its sentence keeps the text replacement.
  const written = { kind: "saving_throw", detail: "DEX save vs Bandit", parts: {} };
  assert.equal(hideNames(written, names, { ids, reword: seatSentences }).detail, "DEX save vs someone unseen");
});

test("a waiting card of a family that has not moved shows its sentence and its reason exactly as written, in any language", () => {
  // The reader of stored rolls would turn each of these: "c/ Fireball",
  // "sur the guard", "Lumière", "Savoir si sur peut passer".
  for (const detail of ["DEX save vs Fireball", "persuasion on the guard", "Light", "Savoir si on peut passer", "sleight_of_hand"]) {
    for (const parts of [undefined, null, {}, checkParts({ skill: "perception" })]) {
      assert.equal(pendingWords(fr, { detail, reason: detail, parts }), detail);
      assert.equal(pendingWords(en, { detail, reason: detail, parts }), detail);
      // Its reason repeats its words, and is shown, as before.
      assert.equal(pendingReason(fr, { detail, reason: detail, parts }, true), detail);
      assert.equal(pendingReason(fr, { detail, reason: detail, parts }, false), detail);
    }
  }
});

// ---- the second family: a creature's own attacks and their damage ----

// A creature's own action is stored by the name its stat block gives it,
// with no key, and its words look that name up in the creature attack names,
// then the weapons and the spells (issue #1121). Each row below: the site,
// the sentence it built by hand before, and the parts it hands the door now.
const ARIA_STRUCK = sheetTarget({ id: "aria", name: "Aria" });
const REX = keptTarget("pet", { name: "Rex" });
const THUNDER = keptTarget("mount", { name: "Thunder" });
const GOBLIN_ROLLS = { kind: "enemy", id: "a-goblin", name: "Goblin" };
const bite = { name: "Bite" };
const beastBite = { weapon: "Wolf Bite", named: { kind: "action", name: "Bite" } };
const riderOf = (damageType) => `${damageType ?? "rider"}`;
const CREATURE_SITES = [
  ["enemy_attack, a creature's attack roll and its damage (enemy-attack.ts)", rollAgainst(bite.name, "Aria"), actionParts(bite, ARIA_STRUCK)],
  ["a creature's attack at another creature (enemy-strike.ts), and one a Cloud Rune turns (cloud-rune.ts)", rollAgainst(bite.name, "Goblin"), actionParts(bite, foeTarget(GOBLIN))],
  ["what a creature's hit goes on to deal, by its damage type (enemy-hit.ts, enemy-hit-rows.ts)", rollAgainst(`${bite.name} (${riderOf("poison")})`, "Aria"), actionParts(bite, ARIA_STRUCK, riderNote("poison"))],
  ["the same, where its stat block names no type", rollAgainst(`${bite.name} (${riderOf(undefined)})`, "Aria"), actionParts(bite, ARIA_STRUCK, riderNote(undefined))],
  ["the same, by a word of the stat block's own", rollAgainst(`${bite.name} (${riderOf("Rot")})`, "Aria"), actionParts(bite, ARIA_STRUCK, riderNote("Rot"))],
  ["a creature's opportunity attack and its damage (opportunity.ts)", rollAgainst(`${bite.name} (opportunity attack)`, "Aria"), actionParts(bite, ARIA_STRUCK, "opportunity")],
  ["the same at a creature that walks off (opportunity-sides.ts)", rollAgainst(`${bite.name} (opportunity attack)`, "Goblin"), actionParts(bite, foeTarget(GOBLIN), "opportunity")],
  ["the same at a pet that pulls away (opportunity-pets.ts)", rollAgainst(`${bite.name} (opportunity attack)`, "Rex"), actionParts(bite, REX, "opportunity")],
  ["a creature's attack at a pet, and a hit's damage that is no critical (pet-strike.ts)", rollAgainst(bite.name, "Rex"), actionParts(bite, REX, false)],
  ["what such a hit goes on to deal (pet-strike.ts)", rollAgainst(`${bite.name} (rider)`, "Rex"), actionParts(bite, REX, "rider")],
  ["a creature's attack at a mount and its damage (mount-combat.ts)", rollAgainst(bite.name, "Thunder"), actionParts(bite, THUNDER)],
  ["what such a hit goes on to deal (mount-blow.ts)", rollAgainst(`${bite.name} (rider)`, "Thunder"), actionParts(bite, THUNDER, "rider")],
  ["a pet's attack and its damage (pet-tools.ts)", rollAgainst(bite.name, "Goblin"), actionParts(bite, foeTarget(GOBLIN))],
  ["a pet's damage on a critical hit (pet-tools.ts)", rollAgainst(`${bite.name}${" (CRIT)"}`, "Goblin"), actionParts(bite, foeTarget(GOBLIN), "crit")],
  ["what a pet's hit goes on to deal (natural-onhit.ts)", rollAgainst(`${"Rex's Bite"} (${riderOf("poison")})`, "Goblin"), strikeParts(actionUsed(bite, "Rex's Bite"), foeTarget(GOBLIN), [riderNote("poison")])],
  ["a beast form's natural attack and its damage (natural-attack.ts, through pc_attack)", rollAgainst("Wolf Bite", "Goblin"), swingParts(beastBite, foeTarget(GOBLIN))],
  ["a beast form's opportunity attack (opportunity-strike.ts)", rollAgainst(`${"Wolf Bite"} (opportunity attack)`, "Goblin"), swingParts(beastBite, foeTarget(GOBLIN), { note: "opportunity" })],
  ["what a beast form's hit goes on to deal (natural-onhit.ts)", rollAgainst(`${"Wolf Bite"} (${riderOf("poison")})`, "Goblin"), strikeParts(swingUsed(beastBite), foeTarget(GOBLIN), [riderNote("poison")])],
];

test("each site of the second family stores the sentence it wrote by hand before, word for word, with the creature in front of its card", () => {
  for (const [site, before, parts] of CREATURE_SITES) {
    assert.equal(rollSentence({ parts }), before, site);
    assert.equal(parts.used.kind, "action", site);
    const roll = { kind: "attack", detail: rollSentence({ parts }), attacker: GOBLIN_ROLLS, parts };
    assert.equal(rollCardLabel(en, roll, undefined), `Goblin · Attack roll (${before})`, site);
    assert.equal(rollToastLead(en, { ...roll, requestedBy: "dm" }, undefined), `Goblin · ${before}`, site);
    assert.equal(rollChronicleLead(en, roll, undefined), `Goblin · ${before}`, site);
  }
});

test("one sentence of the second family changed: a critical hit's damage on a pet says its note before the pet, where every other note sits", () => {
  // pet-strike.ts wrote the note after the whole sentence; pet-tools.ts,
  // for the same critical the other way round, wrote it after the attack.
  const before = `${rollAgainst(bite.name, "Rex")}${" (CRIT)"}`;
  assert.equal(before, "Bite vs Rex (CRIT)");
  assert.equal(rollSentence({ parts: actionParts(bite, REX, "crit") }), "Bite (CRIT) vs Rex");
});

test("a creature's action is stored by its stat block's name with no key, and a note that does not hold is left out", () => {
  assert.deepEqual(actionParts(bite, ARIA_STRUCK), { used: { kind: "action", name: "Bite" }, targets: [{ kind: "sheet", id: "aria", name: "Aria" }], aim: "vs", worded: ACTION_WORDS_VERSION });
  assert.deepEqual(actionParts(bite, REX, false, null, undefined).notes, undefined);
  assert.deepEqual(actionParts(bite, REX, false && "crit", "rider").notes, [{ engine: "rider" }]);
  // A pet and a mount are kept on a character's sheet: a name, and no id.
  assert.deepEqual(REX, { kind: "pet", name: "Rex" });
  assert.deepEqual(THUNDER, { kind: "mount", name: "Thunder" });
  // A waiting card would be sent them by name, as it is any target.
  assert.deepEqual(wordParts(actionParts(bite, THUNDER)).targets, [{ kind: "mount", name: "Thunder" }]);
  // Carried under more than its own name, the key says which attack it is.
  assert.deepEqual(actionUsed(bite), { kind: "action", name: "Bite" });
  assert.deepEqual(actionUsed(bite, "Rex's Bite"), { kind: "action", key: "bite", name: "Rex's Bite" });
  assert.deepEqual(swingParts(beastBite, foeTarget(GOBLIN)).used, { kind: "action", key: "bite", name: "Wolf Bite" });
  assert.deepEqual(swingUsed(beastBite), { kind: "action", key: "bite", name: "Wolf Bite" });
  // A spell attack is a spell whatever its profile was built from, and an
  // action's name is no spell's key.
  assert.deepEqual(swingParts(beastBite, foeTarget(GOBLIN), { spell: true }).used, { kind: "spell", name: "Wolf Bite" });
});

test("a creature's action under its stat block's name makes a version of the words of its own, so an app built before it shows the roll by its sentence, and every other roll stays in the first", () => {
  // A reader takes a roll's words from its parts only in a version it
  // knows (makesWords). One built before this family knows the first alone:
  // handed a creature's roll it falls back to the stored sentence, where it
  // already read a goblin's "Scimitar" as "Cimeterre". Marked with the first
  // version, the same roll would have read "Scimitar" there, and a critical
  // hit's note as its id.
  assert.equal(ACTION_WORDS_VERSION, 2);
  for (const [site, , parts] of CREATURE_SITES) {
    // An action carried under more than its own name has a key (a beast
    // form's, a pet's rider): that reader shows it as written, with its
    // note in French, as it did. In the second version it would lose the
    // note's French and a waiting card's whole line.
    assert.equal(parts.worded, parts.used.key ? WORDS_VERSION : ACTION_WORDS_VERSION, site);
    assert.equal(makesWords(parts), true, site);
  }
  for (const [site, , parts] of SITES) {
    assert.equal(parts.worded, WORDS_VERSION, site);
    assert.equal(makesWords(parts), true, site);
  }
  assert.equal(actionParts(bite, ARIA_STRUCK, "crit").worded, ACTION_WORDS_VERSION);
  assert.equal(swingParts(beastBite, foeTarget(GOBLIN), { note: "opportunity" }).worded, WORDS_VERSION);
  assert.equal(strikeParts(actionUsed(bite, "Rex's Bite"), foeTarget(GOBLIN), [riderNote("poison")]).worded, WORDS_VERSION);
  // No roll in the first version carries a note that version did not have.
  for (const [site, , parts] of [...SITES, ...CREATURE_SITES]) {
    if (parts.worded === WORDS_VERSION) {
      assert.equal((parts.notes ?? []).some((note) => note.engine === "crit"), false, site);
    }
  }
});

test("a note's id this build does not know reads as its id and is never looked up, whatever the dictionary or an object holds under it", () => {
  const withNote = (engine) => ({ ...actionParts(bite, ARIA_STRUCK), notes: [{ engine }] });
  assert.equal(translate("fr", "Close"), "Fermer");
  assert.equal(rollWords(fr, withNote("Close")), "Morsure (Close) c/ Aria");
  assert.equal(rollWords(fr, withNote("toString")), "Morsure (toString) c/ Aria");
  assert.equal(rollWords(en, withNote("constructor")), "Bite (constructor) vs Aria");
});

const creatureCard = (parts, kind = "attack", t = fr) => rollCardLabel(t, { kind, detail: rollSentence({ parts }), attacker: GOBLIN_ROLLS, parts }, undefined);

test("a French table reads a creature's attack in French: the attack by the creature attack names, its note by the dictionaries", () => {
  assert.equal(creatureCard(actionParts(bite, ARIA_STRUCK)), "Goblin · Jet d’attaque (Morsure c/ Aria)");
  assert.equal(creatureCard(actionParts(bite, ARIA_STRUCK), "damage"), `Goblin · ${translate("fr", "Damage")} (Morsure c/ Aria)`);
  // Read as a sentence, "Bite (opportunity attack)" was nothing the reader
  // knew, and neither was "Bite".
  assert.equal(creatureCard(actionParts(bite, ARIA_STRUCK, "opportunity")), "Goblin · Jet d’attaque (Morsure (attaque d’opportunité) c/ Aria)");
  assert.equal(creatureCard(actionParts(bite, ARIA_STRUCK, riderNote("poison")), "damage"), `Goblin · ${translate("fr", "Damage")} (Morsure (poison) c/ Aria)`);
  assert.equal(rollWords(fr, actionParts({ name: "Claw" }, ARIA_STRUCK, riderNote("fire"))), "Griffe (feu) c/ Aria");
  assert.equal(rollWords(fr, actionParts(bite, REX, "rider")), "Morsure (effet additionnel) c/ Rex");
  assert.equal(rollWords(fr, actionParts(bite, REX, "crit")), "Morsure (CRITIQUE) c/ Rex");
  // A word of the stat block's own is shown as written.
  assert.equal(rollWords(fr, actionParts(bite, ARIA_STRUCK, riderNote("Rot"))), "Morsure (Rot) c/ Aria");
  // A beast form's and a pet's: the attack's name where it stands, and the
  // creature's as written.
  assert.equal(rollWords(fr, swingParts(beastBite, foeTarget(GOBLIN))), "Wolf Morsure c/ Goblin");
  assert.equal(rollWords(fr, strikeParts(actionUsed(bite, "Rex's Bite"), foeTarget(GOBLIN), [riderNote("poison")])), "Rex's Morsure (poison) c/ Goblin");
  assert.equal(rollWords(fr, strikeParts(actionUsed({ name: "Tail Spike" }, "Giant Manticore Tail Spike"), foeTarget(GOBLIN))), "Giant Manticore Piquant caudal c/ Goblin");
  // A key the name does not end with says nothing: the name as written.
  assert.equal(rollWords(fr, strikeParts({ kind: "action", key: "claw", name: "Wolf Bite" }, foeTarget(GOBLIN))), "Wolf Bite c/ Goblin");
  // "rider" is a mount's rider elsewhere in the app: the note has a line of
  // its own, and the plain word none.
  assert.equal(translate("fr", "rider"), "rider");
  // The toast and the chronicle's line, from the same parts.
  const roll = { kind: "attack", detail: "", requestedBy: "dm", attacker: GOBLIN_ROLLS, parts: actionParts(bite, ARIA_STRUCK, "opportunity") };
  assert.equal(rollToastLead(fr, roll, undefined), "Goblin · Morsure (attaque d’opportunité) c/ Aria");
  assert.equal(rollChronicleLead(fr, roll, undefined), "Goblin · Morsure (attaque d’opportunité) c/ Aria");
});

test("a Spanish table reads a creature's attack by its English name, as Spanish has no creature attack names, and its notes and joining words in Spanish", () => {
  const card = (parts, kind = "attack") => creatureCard(parts, kind, es);
  assert.equal(card(actionParts(bite, ARIA_STRUCK)), `Goblin · ${translate("es", "Attack roll")} (Bite ${translate("es", "vs", { context: "roll.aim" })} Aria)`);
  assert.equal(rollWords(es, actionParts({ name: "Scimitar" }, ARIA_STRUCK)), "Scimitar contra Aria");
  assert.equal(rollWords(es, actionParts(bite, ARIA_STRUCK, "opportunity")), "Bite (ataque de oportunidad) contra Aria");
  assert.equal(rollWords(es, actionParts(bite, ARIA_STRUCK, riderNote("poison"))), "Bite (veneno) contra Aria");
  // The note "rider" has its Spanish under the note's own context, as in French.
  assert.equal(rollWords(es, actionParts(bite, REX, "rider")), "Bite (efecto adicional) contra Rex");
  assert.equal(rollWords(es, actionParts(bite, REX, "crit")), "Bite (CRÍTICO) contra Rex");
  // A beast form's and a pet's attack, carried under more than its own name.
  assert.equal(rollWords(es, swingParts(beastBite, foeTarget(GOBLIN))), "Wolf Bite contra Goblin");
  assert.equal(rollWords(es, strikeParts(actionUsed(bite, "Rex's Bite"), foeTarget(GOBLIN), [riderNote(null)])), "Rex's Bite (efecto adicional) contra Goblin");
});

test("a creature's action is looked up by its name in the creature attack names, the weapons and the spells, and never as a word of the interface", () => {
  const words = (name) => rollWords(fr, actionParts({ name }, ARIA_STRUCK));
  // A stat block's attack named like a weapon reads by the weapons table,
  // as it did when it was read as a sentence.
  assert.equal(words("Scimitar"), "Cimeterre c/ Aria");
  assert.equal(words("Light Crossbow"), "Arbalète légère c/ Aria");
  // One named for a spell reads by the spells table, as it did.
  assert.equal(words("Fire Bolt"), "Trait de feu c/ Aria");
  // A name typed in another case is still that attack.
  assert.equal(words("bite"), "Morsure c/ Aria");
  // The dictionary holds "Horn" as an instrument and "Touch" as a spell's
  // range; the attack names say what a unicorn and a fire elemental do.
  assert.equal(translate("fr", "Touch"), "Contact");
  assert.equal(words("Horn"), "Corne c/ Aria");
  assert.equal(words("Touch"), "Contact c/ Aria");
  // A homebrew creature's attack is looked up the same way, by its name.
  // One named like a word of the interface stays as its author wrote it: no
  // names table holds it.
  for (const name of ["Log", "Turn", "Close", "Back", "Save", "Custom", "Hide", "Shadow Lash"]) {
    assert.equal(words(name), `${name} c/ Aria`, `a homebrew attack called ${name}`);
  }
  assert.equal(translate("fr", "Turn"), "Trahison");
  assert.equal(translate("fr", "Log"), "Journal");
  // In English nothing is looked up.
  assert.equal(rollWords(en, actionParts(bite, ARIA_STRUCK)), "Bite vs Aria");
  // The same name under another kind is not an action's: a weapon nobody
  // keyed is still shown as written (the first family's rule).
  assert.equal(rollWords(fr, attackParts({ name: "Bite" }, foeTarget(GOBLIN))), "Bite c/ Goblin");
});

test("every attack of the bundled bestiary reads as it did under the reader this replaces, or better, and the common ones read in French", () => {
  const before = (words) => rollCardLabel(fr, { kind: "attack", detail: words, attacker: GOBLIN_ROLLS, parts: null }, undefined);
  const names = new Map();
  for (const creature of Object.values(CREATURES.creatures)) {
    for (const attack of creature.attacks ?? []) {
      names.set(attack.name, (names.get(attack.name) ?? 0) + 1);
    }
  }
  assert.ok(names.size >= 90, `the bestiary's attacks were not read: ${names.size} names`);
  let french = 0;
  let total = 0;
  for (const [name, count] of names) {
    const english = `Goblin · Jet d’attaque (${name} c/ Aria)`;
    const old = before(rollAgainst(name, "Aria"));
    const now = creatureCard(actionParts({ name }, ARIA_STRUCK));
    // What the reader of sentences put into French (a weapon's name), the
    // parts put into the same French.
    if (old !== english) {
      assert.equal(now, old, name);
    }
    total += count;
    french += now === english ? 0 : count;
  }
  for (const name of ["Bite", "Claw", "Claws", "Tail", "Slam", "Hooves", "Beak", "Talons", "Gore", "Sting", "Ram", "Rock", "Tentacle", "Constrict", "Fist"]) {
    assert.notEqual(creatureCard(actionParts({ name }, ARIA_STRUCK)), `Goblin · Jet d’attaque (${name} c/ Aria)`, `${name} has no French name`);
  }
  // Nine attacks in ten: a name with no line reads in English, and fails
  // nothing.
  assert.ok(french / total > 0.9, `${french} of ${total} attacks of the bestiary read in French`);
});

test("the creature attack names are keyed as a name is looked up, and none repeats a weapon's line", () => {
  for (const [key, name] of Object.entries(ACTION_NAMES_FR)) {
    assert.match(key, /^[a-z0-9]+(-[a-z0-9]+)*$/, key);
    assert.ok(name.trim(), key);
    // An attack named like a weapon reads through the weapons table: a
    // second line for it here could only disagree with the first.
    // Asked as the weapons table is: the crossbows' lines are keyed the
    // other way round.
    const spoken = key.replaceAll("-", " ");
    assert.equal(contentName("weapons", spoken, "fr"), spoken, `${key} is a weapon's line too`);
    assert.equal(key in WEAPON_NAMES_FR, false, `${key} is a weapon's line too`);
  }
  assert.equal(ACTION_NAMES_FR.bite, "Morsure");
});

test("what a creature's hit goes on to deal is said by its damage type where it is one of the engine's thirteen", () => {
  for (const type of DAMAGE_TYPES) {
    assert.deepEqual(riderNote(type), { engine: type }, type);
    assert.equal(ROLL_NOTES[type], type);
    assert.notEqual(rollWords(fr, actionParts(bite, ARIA_STRUCK, riderNote(type))), "", type);
  }
  assert.deepEqual(riderNote(undefined), { engine: "rider" });
  assert.deepEqual(riderNote(null), { engine: "rider" });
  assert.deepEqual(riderNote("  "), { engine: "rider" });
  // Written as the stat block has it: another case is another word, shown
  // as written, so the English sentence is the one the site wrote.
  assert.deepEqual(riderNote("Poison"), { typed: "Poison" });
  assert.deepEqual(riderNote("shadow"), { typed: "shadow" });
  // A word every object has is no damage type.
  assert.deepEqual(riderNote("constructor"), { typed: "constructor" });
});

test("a hidden creature a creature attacks is \"someone unseen\" to a seat not owed it, and a seen one named like it keeps its name", () => {
  const hidden = new Set(["bandit-1"]);
  const at = (foe) => {
    const parts = actionParts(bite, foeTarget(foe), "opportunity");
    return { id: "r", kind: "attack", detail: rollSentence({ parts }), attacker: { kind: "enemy", id: "wolf-1", name: "Wolf" }, parts };
  };
  const reword = seatSentences;
  const unseen = hideNames({ roll: at({ id: "bandit-1", displayName: "Bandit" }) }, ["Bandit"], { ids: hidden, reword }).roll;
  assert.deepEqual(unseen.parts.targets, [{ kind: "unseen" }]);
  assert.equal(unseen.detail, "Bite (opportunity attack) vs someone unseen");
  assert.equal(JSON.stringify(unseen).includes("bandit-1"), false, "the hidden creature's id rode the roll");
  assert.equal(rollCardLabel(fr, unseen, undefined), "Wolf · Jet d’attaque (Morsure (attaque d’opportunité) c/ quelqu’un hors de vue)");
  const seen = hideNames({ roll: at({ id: "captain-1", displayName: "Bandit Captain" }) }, ["Bandit"], { ids: hidden, reword }).roll;
  assert.deepEqual(seen.parts.targets, [{ kind: "enemy", id: "captain-1", name: "Bandit Captain" }]);
  assert.equal(seen.detail, "Bite (opportunity attack) vs Bandit Captain");
  assert.equal(rollCardLabel(fr, seen, undefined), "Wolf · Jet d’attaque (Morsure (attaque d’opportunité) c/ Bandit Captain)");
});

// ---- the notes ----

test("an engine's note is one of the engine's own, by its id; a typed note is shown as written; a roll says more than one in order", () => {
  // The first family's two, the second's two, and the thirteen damage types.
  assert.deepEqual(Object.keys(ROLL_NOTES).sort(), ["crit", "half_on_miss", "opportunity", "rider", ...DAMAGE_TYPES].sort());
  const base = attackParts(longsword, foeTarget(GOBLIN));
  assert.equal(rollWords(en, { ...base, notes: [{ typed: "from the rafters" }] }), "Longsword (from the rafters) vs Goblin");
  // A person's words are theirs: the dictionary is not asked, even for a
  // line it holds ("Bite" is "Morsure" when the engine says it).
  assert.equal(rollWords(fr, { ...base, notes: [{ typed: "Bite" }] }), "Épée longue (Bite) c/ Goblin");
  // A typed note that reads like an engine's is still typed.
  assert.equal(rollWords(fr, { ...base, notes: [{ typed: "opportunity attack" }] }), "Épée longue (opportunity attack) c/ Goblin");
  // A note a newer server stored reads as its id, here and in French.
  assert.equal(rollWords(fr, { ...base, notes: [{ engine: "a_later_note" }] }), "Épée longue (a_later_note) c/ Goblin");
  // Two notes, each said, in the order they were given.
  const both = noted(attackParts(acidArrow, foeTarget(GOBLIN), "opportunity"), "half_on_miss");
  assert.deepEqual(both.notes, [{ engine: "opportunity" }, { engine: "half_on_miss" }]);
  assert.equal(rollWords(en, both), "Acid Arrow (opportunity attack) (half on a miss) vs Goblin");
  assert.equal(rollWords(fr, both), "Flèche acide (attaque d’opportunité) (moitié sur un raté) c/ Goblin");
});

test("an area's roll joins its creatures with the other aim, and a roll that names nobody says only what was used", () => {
  const fireball = { used: { kind: "spell", key: "fireball", name: "Fireball" }, targets: [{ kind: "enemy", name: "Goblin 1" }, { kind: "enemy", name: "Goblin 2" }], aim: "on", worded: WORDS_VERSION };
  assert.equal(rollWords(en, fireball), "Fireball on Goblin 1, Goblin 2");
  assert.equal(rollWords(fr, fireball), "Boule de feu sur Goblin 1, Goblin 2");
  assert.equal(rollWords(en, { used: { kind: "spell", name: "Fireball" }, aim: "on", worded: WORDS_VERSION }), "Fireball");
  assert.equal(rollWords(en, {}), "");
});

console.log(`\n${passed} roll words tests passed`);
