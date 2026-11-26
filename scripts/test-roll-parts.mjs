// A roll read by its parts (src/lib/roll-parts.ts, issue #1064).
//
// Rules read a roll's sentence back: the weapon of a character's last attack,
// the skill or ability of a check, the ability of a failed save and what it
// was against, the save that keeps concentration, dice rolled at the table.
// A card reworded, or written in another language, quietly broke the rule.
// Those facts are stored as fields now, and this holds how they are read:
//
//   - a roll that has parts is read by its fields alone. Each case here gives
//     it a sentence that says something else, and a sentence that names the
//     fact beside parts that do not: the words never decide;
//   - a roll stored before its parts (`parts: null`) is read by its sentence,
//     as it always was.
//
// The sites that read rolls through these functions are held, each on its
// own path, by scripts/test-enforce-roll-parts-sites.mjs.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { attackParts, checkParts, rollAbility, rollDecidesSurprise, rollKeepsConcentration, rollPhysical, rollResists, rollSkill, rollWeaponRow, saveParts } = await import("../src/lib/roll-parts.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// What an attack is made with, as its roll's fields say it, beside words of
// the case's own: the builder's parts make the roll's words too (step 2,
// scripts/test-roll-words.mjs), and these cases need words that disagree.
const GOBLIN = { kind: "enemy", id: "a-goblin", name: "Goblin" };
const madeWith = (attack) => ({ used: attackParts(attack, GOBLIN).used });

// A roll as stored now, and one stored before its parts were.
const stored = (detail, parts = {}) => ({ detail, parts });
const before = (detail) => ({ detail, parts: null });

test("a check's skill is its field, whatever its words say, and an old roll's is read from its words", () => {
  assert.equal(rollSkill(stored("Persuasion, to talk the guard round", checkParts({ skill: "athletics" })), ["athletics", "persuasion"]), "athletics");
  assert.equal(rollSkill(stored("Grapple: athletics"), ["athletics"]), null, "a roll with parts was matched by its words");
  assert.equal(rollSkill(stored("athletics", checkParts({ skill: "athletics" })), ["stealth"]), null);
  assert.equal(rollSkill(before("Grapple: athletics"), ["acrobatics", "athletics"]), "athletics");
  assert.equal(rollSkill(before("Sleight of Hand, to palm the key"), ["sleight_of_hand"]), "sleight_of_hand");
  assert.equal(rollSkill(before("Grapple: athletics"), ["stealth"]), null);
});

test("with no list, a check's skill is whichever its field names, and none for a check made with a bare ability", () => {
  assert.equal(rollSkill(stored("Athletics to climb the wall", checkParts({ skill: "stealth" }))), "stealth");
  assert.equal(rollSkill(stored("Stealth past the guard", checkParts({ ability: "dex" }))), null);
  assert.equal(rollSkill(stored("Stealth past the guard")), null, "a roll with parts was matched by its words");
  assert.equal(rollSkill(before("Stealth past the guard")), "stealth");
  assert.equal(rollSkill(before("Strength check to lift the gate")), null);
});

test("a skill check is not a bare check of the ability behind it", () => {
  assert.equal(rollAbility(stored("athletics", checkParts({ skill: "athletics" }))), null);
  assert.equal(rollAbility(stored("str", checkParts({ ability: "str" }))), "str");
});

test("a save's ability is its field, whatever its words say, and an old roll's is read from its words", () => {
  assert.equal(rollAbility(stored("DEX save against Fireball", saveParts("wis"))), "wis");
  assert.equal(rollAbility(stored("DEX save against Fireball")), null, "a roll with parts was matched by its words");
  assert.equal(rollAbility(stored("a save", saveParts("wis")), ["str", "dex"]), null);
  assert.equal(rollAbility(before("Aria: DEX save against Fireball")), "dex");
  assert.equal(rollAbility(before("dex")), "dex");
  assert.equal(rollAbility(before("Strength check to force the door")), "str");
  assert.equal(rollAbility(before("a Dexterity check, then STR"), ["str"]), "str");
  assert.equal(rollAbility(before("death save")), null);
});

test("what a save was against is its field, and an old roll's is what follows vs in its words", () => {
  assert.equal(rollResists(stored("CON save vs. frightened", { ...saveParts("con"), resists: "poison" })), "poison");
  assert.equal(rollResists(stored("CON save vs. frightened", saveParts("con"))), undefined, "a roll with parts was matched by its words");
  assert.equal(rollResists(before("CON save vs. frightened")), "frightened");
  assert.equal(rollResists(before("CON save")), undefined);
});

test("the save that keeps concentration says so in a field, and an old one in its words", () => {
  assert.equal(rollKeepsConcentration(stored("a save against the storm", saveParts("con", "concentration"))), true);
  assert.equal(rollKeepsConcentration(stored("CON save to keep concentration (Bless)", saveParts("con"))), false, "a roll with parts was matched by its words");
  assert.equal(rollKeepsConcentration(before("CON save to keep concentration (Bless)")), true);
  assert.equal(rollKeepsConcentration(before("CON save to keep concentration in Sleet Storm")), true);
  assert.equal(rollKeepsConcentration(before("CON save against Poison Spray")), false);
});

// The Stealth a fight's opening rolls for its ambush is not the one the GM
// asked for earlier in the same turn (encounter-open.ts stealthThisTurn).
test("the Stealth an ambush rolls says so in a field, and an old one in its words", () => {
  assert.equal(rollDecidesSurprise(stored("Bran keeps to the fog", { ...checkParts({ skill: "stealth" }), purpose: "surprise" })), true);
  assert.equal(rollDecidesSurprise(stored("stealth, lying in wait", checkParts({ skill: "stealth" }))), false, "a roll with parts was matched by its words");
  assert.equal(rollDecidesSurprise(before("stealth, lying in wait")), true);
  assert.equal(rollDecidesSurprise(before("stealth")), false);
});

test("the weapon of an attack is the carried row its field names, and an old roll's is the one its words open with", () => {
  const carried = [{ name: "Longsword" }, { name: "Longbow +1" }];
  assert.equal(rollWeaponRow(stored("Longsword vs Goblin", madeWith({ name: "Longbow +1", base: "Longbow" })), carried)?.name, "Longbow +1");
  assert.equal(rollWeaponRow(stored("Longsword vs Goblin"), carried), null, "a roll with parts was matched by its words");
  // A spell that shares a carried row's name is no weapon in hand.
  assert.equal(rollWeaponRow(stored("Longsword vs Goblin", madeWith({ name: "Longsword", spell: true })), carried), null);
  // Sold since: the row is no longer carried.
  assert.equal(rollWeaponRow(stored("Glaive vs Goblin", madeWith({ name: "Glaive", base: "Glaive" })), carried), null);
  assert.equal(rollWeaponRow(before("Longbow +1 vs Goblin"), carried)?.name, "Longbow +1");
  assert.equal(rollWeaponRow(before("Bite vs Aria"), carried), null);
});

test("an attack's weapon is stored by the name it is carried under and by the content row it is", () => {
  assert.deepEqual(madeWith({ name: "Longbow +1", base: "Longbow" }), { used: { kind: "weapon", key: "longbow", name: "Longbow +1" } });
  assert.deepEqual(madeWith({ name: "unarmed strike" }), { used: { kind: "weapon", name: "unarmed strike" } });
  assert.deepEqual(madeWith({ name: "Fire Bolt", spell: true }), { used: { kind: "spell", name: "Fire Bolt" } });
  // And by whom it is against, with the mark that these parts make its words.
  assert.deepEqual(attackParts({ name: "Longbow +1", base: "Longbow" }, GOBLIN, "opportunity"), {
    used: { kind: "weapon", key: "longbow", name: "Longbow +1" },
    targets: [GOBLIN],
    aim: "vs",
    notes: [{ engine: "opportunity" }],
    worded: 1,
  });
});

test("dice rolled at the table are a field, and an old roll's are the last words of its sentence", () => {
  assert.equal(rollPhysical(stored("a save", { physical: true })), true);
  assert.equal(rollPhysical(stored("a save (physical)")), false, "a roll with parts was matched by its words");
  assert.equal(rollPhysical(before("a save (physical)")), true);
  assert.equal(rollPhysical(before("a save")), false);
});

console.log(`\n${passed} roll parts tests passed`);
