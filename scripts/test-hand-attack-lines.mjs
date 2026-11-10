// The Hand reads the helpers the engine applies, so a card cannot drift from
// the roll (gap sweep repair, package handview): the damage riders pc_attack
// folds (attack-damage-riders.ts), the conditions on the attack roll
// (attack-roll-extras.ts), a thrown or ranged weapon's two ranges and the
// long range's disadvantage (attack-rules.ts), sight as the roll reads it
// (attack-sight.ts, sent by the board view), Rapid Strike only with
// advantage, the heal bonus (heal-bonus.ts), the components as cast
// (castComponents: Archdruid), and the board's own verdicts on a Hide and a
// Silence. Each case failed before the fix. Pure: no database.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { previewRows, intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const { aimedCard, attackOddsWithDice, shotRange } = await import("../src/lib/battlemap/hand-odds.ts");
const { attackDamageRiders, attackOnHitDice } = await import("../src/lib/dm/attack-damage-riders.ts");
const { spellAttackLines } = await import("../src/lib/battlemap/hand-attack-lines.ts");
const { attackRollExtras, splitRollSuffix } = await import("../src/lib/dm/attack-roll-extras.ts");
const { healAdditions, healModifier } = await import("../src/lib/dm/heal-bonus.ts");
const { grappleHandsProblem, silenceRefusal } = await import("../src/lib/dm/cast-rules.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { spellMechFor } = await import("../src/lib/srd/spell-mechanics.ts");
const { attackOdds } = await import("../src/lib/srd/odds.ts");

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

function sheet(overrides = {}) {
  return {
    id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Kael", race: "human", class: "fighter", subclass: "", background: "", alignment: "", gender: "",
    level: 4, xp: 0,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 14, cha: 12 },
    maxHp: 36, currentHp: 36, tempHp: 0, ac: 16, acOverride: false, speed: 30,
    hitDice: { die: "d10", total: 4, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple", "martial"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [], spellcasting: null,
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}
const item = (name, extra = {}) => ({ name, qty: 1, ...extra });
const feature = (name) => ({ name, source: "class" });
const byId = (cards, id) => cards.find((card) => card.id === id);
const mine = (extra = {}) => ({
  ...FRESH_TURN,
  table: { round: 2, orderReady: true, acting: { id: "s1", name: "Kael" }, surprised: { acting: [], reacting: [] } },
  ...extra,
});
const goblin = { id: "e1", name: "Goblin 1", kind: "enemy", cr: 0.25, conditions: [] };
const BOLT = { "fire bolt": { level: 0, school: "evocation", castingTime: "1 action", range: "120 feet", concentration: false, desc: "Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage.", higherLevel: "" } };

const toHitRow = (rows) => rows.find((row) => row.key === "To hit")?.value ?? "";

// ---- the damage riders ----

test("a paladin's longsword card carries Improved Divine Smite's 1d8, as pc_attack folds it", () => {
  const paladin = sheet({ class: "paladin", level: 11, classes: [{ id: "paladin", level: 11 }], features: [feature("Improved Divine Smite")], equipment: [item("Longsword", { equipped: true })] });
  const card = byId(deriveHand(paladin, mine()), "attack:longsword");
  assert.match(card.damage, /\+1d8/);
  assert.match(card.description, /Improved Divine Smite \+1d8 radiant/);
});

test("the card's riders are attackDamageRiders' own, a once-a-turn one until the turn spends it", () => {
  const cleric = sheet({ class: "cleric", subclass: "Life Domain", level: 8, classes: [{ id: "cleric", level: 8, subclass: "Life Domain" }], features: [feature("Divine Strike")], equipment: [item("Mace", { equipped: true })] });
  const card = byId(deriveHand(cleric, mine()), "attack:mace");
  const riders = attackDamageRiders({ sheet: cleric, profile: { damageExpression: "1d6+3", ranged: false, ability: "str", riderNotes: [] }, riders: { damageRiders: [{ feature: "Divine Strike", dice: "1d8", type: "", when: "weapon", oncePerTurn: true }] }, kind: "weapon" });
  assert.equal(riders.featureRiders[0]?.type, "radiant");
  assert.match(card.damage, /\+1d8/);
  assert.match(card.description, /Divine Strike \+1d8 radiant on the first hit this turn/);
  const spent = byId(deriveHand(cleric, mine({ marks: ["rider:divine strike"] })), "attack:mace");
  assert.doesNotMatch(spent.damage, /1d8/);
});

test("a raging Frenzy card adds the Rage bonus, as the Attack action's card does", () => {
  const berserker = sheet({ class: "barbarian", subclass: "Path of the Berserker", level: 5, classes: [{ id: "barbarian", level: 5, subclass: "Path of the Berserker" }], features: [feature("Rage"), feature("Frenzy")], conditions: ["raging", "frenzied"], equipment: [item("Greataxe", { equipped: true })] });
  const cards = deriveHand(berserker, mine({ attacksMade: 1, actionUsed: true }));
  const frenzy = cards.find((card) => card.id.startsWith("attack:greataxe:frenzy"));
  assert.ok(frenzy, "a Frenzy card is dealt");
  assert.match(frenzy.damage, /\+2$/);
});

test("Hex rides a spell attack's damage, as pc_attack adds it", () => {
  const warlock = sheet({ class: "warlock", level: 5, classes: [{ id: "warlock", level: 5 }], conditions: ["hexing"], spellcasting: { ability: "cha", slots: {}, known: [], prepared: [], cantrips: ["Fire Bolt"], pact: { level: 3, max: 2, used: 0 } } });
  const card = byId(deriveHand(warlock, mine(), { spells: BOLT }), "spell:fire bolt");
  assert.match(card.rules, /\+1d6 necrotic/);
  assert.equal(spellAttackLines(warlock, 6, false).onHit, "+1d6");
  // Hunter's Mark rides a weapon's hit only (attackOnHitDice, as pc_attack reads it).
  assert.equal(spellAttackLines(sheet({ conditions: ["hunter's mark (caster)"] }), 6, false).onHit, attackOnHitDice(sheet({ conditions: ["hunter's mark (caster)"] }), "spell", false).suffix);
});

// ---- the roll ----

test("a blessed attacker's card names Bless's d4 beside its bonus, and the odds count it", () => {
  assert.deepEqual(splitRollSuffix("+1d4-1d4+2"), { flat: 2, dice: "+1d4-1d4" });
  const blessed = sheet({ conditions: ["blessed"], equipment: [item("Longsword", { equipped: true })] });
  assert.equal(attackRollExtras(blessed).diceSuffix, "+1d4");
  const card = byId(deriveHand(blessed, mine()), "attack:longsword");
  assert.equal(card.toHitDice, "+1d4");
  assert.match(card.roll, /^\+5\+1d4 to hit$/);
  const plain = attackOdds({ attackBonus: 5, ac: 13, advantage: "none" }).hit;
  const withDie = attackOddsWithDice({ attackBonus: 5, dice: "+1d4", ac: 13, advantage: "none" }).hit;
  assert.ok(withDie > plain);
  assert.match(toHitRow(previewRows(card, goblin, blessed.conditions)), /^\+5\+1d4 vs AC ~13/);
});

// ---- range ----

test("a thrown dagger says both ranges, and its preview puts 30 feet at disadvantage", () => {
  const rogue = sheet({ equipment: [item("Dagger", { equipped: true })] });
  const card = byId(deriveHand(rogue, mine()), "attack:dagger");
  assert.equal(card.range, "5 ft / 20/60 ft");
  assert.equal(shotRange(card.shot, 5), "reach");
  assert.equal(shotRange(card.shot, 20), "normal");
  assert.equal(shotRange(card.shot, 30), "long");
  assert.equal(shotRange(card.shot, 65), "beyond");
  const far = { ...goblin, edge: { cover: 0, flanking: false, adjacent: false, feet: 30 } };
  assert.match(toHitRow(previewRows(card, far, [])), /· disadvantage$/);
  const near = { ...goblin, edge: { cover: 0, flanking: false, adjacent: false, feet: 15 } };
  assert.doesNotMatch(toHitRow(previewRows(card, near, [])), /disadvantage/);
  const bow = byId(deriveHand(sheet({ equipment: [item("Shortbow", { equipped: true }), item("Arrows", { qty: 20 })] }), mine()), "attack:shortbow");
  assert.equal(bow.range, "80/320 ft");
});

// ---- sight ----

test("the preview reads sight as the roll does: the light's sources and Feral Senses' conditions", () => {
  const ranger = sheet({ equipment: [item("Longsword", { equipped: true })] });
  const card = byId(deriveHand(ranger, mine()), "attack:longsword");
  const edge = { cover: 0, flanking: false, adjacent: true, feet: 5 };
  // In magical darkness the target cannot see a Feral Senses ranger, who
  // loses nothing for not seeing it: advantage.
  const dark = { ...goblin, edge, sight: { light: ["advantage"], attacker: [], target: [], targetSees: false } };
  assert.match(toHitRow(previewRows(card, dark, [])), /· advantage$/);
  // An invisible foe whose invisibility Feral Senses drops from the roll.
  const unseen = { ...goblin, conditions: ["invisible"], edge, sight: { light: [], attacker: [], target: [], targetSees: true } };
  assert.doesNotMatch(toHitRow(previewRows(card, unseen, [])), /disadvantage/);
  // An Assassin's advantage on a creature yet to act cancels against the dark.
  const both = { ...goblin, advantage: ["Assassinate"], edge, sight: { light: ["disadvantage", "advantage"], attacker: [], target: [], targetSees: false } };
  assert.doesNotMatch(toHitRow(previewRows(card, both, [])), /advantage|disadvantage/);
});

test("Rapid Strike is shut as dealt and opened by an aim with advantage", () => {
  const samurai = sheet({ subclass: "Samurai", level: 15, classes: [{ id: "fighter", level: 15 }], features: [feature("Rapid Strike")], equipment: [item("Longsword")] });
  const card = byId(deriveHand(samurai, mine()), "attack:longsword");
  const rapid = (target) => target.options.find((option) => option.id === "rapidStrike");
  assert.ok(rapid(card).disabled);
  const prone = { ...goblin, conditions: ["prone"], edge: { cover: 0, flanking: false, adjacent: true } };
  assert.equal(rapid(aimedCard(card, prone, [])).disabled, null);
  assert.equal(intentBody(aimedCard(card, prone, []), prone, [], { options: ["rapidStrike"] }).attack.rapidStrike, true);
});

// ---- the basics ----

test("Grapple is shut with both hands full, in take_action's words", () => {
  const full = sheet({ equipment: [item("Longsword", { equipped: true }), item("Shield", { equipped: true })] });
  const grapple = byId(deriveHand(full, mine()), "basic:grapple");
  assert.equal(grapple.disabled, grappleHandsProblem(full).error);
  assert.equal(byId(deriveHand(sheet({ equipment: [item("Longsword", { equipped: true })] }), mine()), "basic:grapple").disabled, null);
});

test("Hide is shut with the board's verdict, and left to the GM out of a fight", () => {
  const seen = "Kael cannot hide: Goblin 1 sees them clearly. They move out of its sight, behind cover or into darkness first, then hide.";
  const hide = byId(deriveHand(sheet(), mine(), { board: { hide: seen } }), "basic:hide");
  assert.equal(hide.disabled, seen);
  assert.equal(directCardCall({ card: "basic", action: "hide" }, "s1", { inFight: false }), null);
  assert.equal(directCardCall({ card: "basic", action: "hide" }, "s1", { inFight: true })?.name, "take_action");
});

test("Ready with its trigger and the card's first pick, an attack, goes to take_action in a fight", () => {
  const call = directCardCall({ card: "basic", action: "ready", trigger: "the goblin moves" }, "s1", { inFight: true });
  assert.deepEqual(call, { name: "take_action", args: { characterId: "s1", action: "ready", trigger: "the goblin moves" } });
  assert.equal(directCardCall({ card: "basic", action: "ready", trigger: "the goblin moves" }, "s1", { inFight: false }), null);
});

// ---- spells ----

test("a verbal spell is shut inside the Silence the board says the caster stands in", () => {
  const wizard = sheet({ class: "wizard", classes: [{ id: "wizard", level: 4 }], spellcasting: { ability: "int", slots: {}, known: [], prepared: [], cantrips: ["Fire Bolt"] } });
  const open = byId(deriveHand(wizard, mine(), { spells: BOLT }), "spell:fire bolt");
  assert.equal(open.disabled, null);
  const hushed = byId(deriveHand(wizard, mine(), { spells: BOLT, board: { silence: { by: "Mage" } } }), "spell:fire bolt");
  assert.equal(hushed.disabled, silenceRefusal("Kael", "Mage", "Fire Bolt").error);
});

test("an Archdruid's druid spells are open with both hands full, as the cast guard casts them", () => {
  const druid = (features) => sheet({
    class: "druid", level: 20, classes: [{ id: "druid", level: 20 }], features,
    proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: ["light", "medium", "shields"], weapons: ["simple", "scimitar"] },
    equipment: [item("Scimitar", { equipped: true }), item("Shield", { equipped: true })],
    spellcasting: { ability: "wis", slots: {}, known: [], prepared: [], cantrips: ["Produce Flame"] },
  });
  const flame = { "produce flame": { level: 0, school: "conjuration", castingTime: "1 action", range: "Self", concentration: false, desc: "You can hurl it at a creature within 30 feet of you. Make a ranged spell attack. On a hit, the target takes 1d8 fire damage.", higherLevel: "" } };
  assert.match(byId(deriveHand(druid([]), mine(), { spells: flame }), "spell:produce flame").disabled ?? "", /free hand/);
  assert.equal(byId(deriveHand(druid([feature("Archdruid")]), mine(), { spells: flame }), "spell:produce flame").disabled, null);
});

test("the heal bonus is heal-bonus.ts's: Disciple of Life, no modifier for Aura of Vitality", () => {
  assert.equal(spellMechFor(["Aura of Vitality"]).healNoModifier, true);
  assert.equal(healModifier({ dc: 14, proficiencyBonus: 3, noModifier: true }), 0);
  assert.equal(healModifier({ dc: 18, proficiencyBonus: 6 }), 4);
  const life = sheet({ class: "cleric", features: [feature("Disciple of Life")] });
  assert.equal(healAdditions(life, 1, { wis: 2 }).flat, 3);
  const cleric = sheet({ class: "cleric", subclass: "Life Domain", classes: [{ id: "cleric", level: 4, subclass: "Life Domain" }], features: [feature("Disciple of Life")], spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, known: [], prepared: ["Cure Wounds"], cantrips: [] } });
  const cure = { "cure wounds": { level: 1, school: "evocation", castingTime: "1 action", range: "Touch", concentration: false, desc: "A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.", higherLevel: "" } };
  // WIS 14 (+2) and Disciple of Life at a 1st level slot (+3).
  assert.equal(byId(deriveHand(cleric, mine(), { spells: cure }), "spell:cure wounds").damage, "1d8+5");
});

console.log(`hand attack lines: ${passed} passed`);
