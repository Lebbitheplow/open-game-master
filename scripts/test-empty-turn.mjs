// A DM turn that ends with no narration: the table is told why. A refused
// player action gives its reason, a loosely written spell gets told what it
// was missing, and nothing leaks from the DM's other tools.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { EMPTY_TURN_LINE, RESOLVED_TURN_LINE, emptyTurnLine } = await import("../src/lib/dm/empty-turn.ts");
const { notReadyReason } = await import("../src/lib/srd/spell-prep.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const call = (id, name) => ({
  role: "assistant",
  content: "",
  tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
});
const result = (id, body) => ({ role: "tool", tool_call_id: id, content: JSON.stringify(body) });

const LEVELS = { ambush: 1, "fire bolt": 0, shield: 1 };
const mage = (text) => ({
  text,
  spells: ["Fire Bolt", "Ambush", "Shield"],
  levelOf: (spell) => LEVELS[spell.toLowerCase()] ?? null,
  notReady: () => null,
});

test("a refused spell says why, first sentence only", () => {
  const line = emptyTurnLine([
    call("a", "cast_buff"),
    result("a", {
      error: 'No content pack knows "Guardian Angel". If it grants an effect, apply it with set_condition.',
      refused: "rules",
    }),
  ]);
  assert.match(line, /^The GM could not resolve that: No content pack knows "Guardian Angel"\. You can/);
  assert.ok(!line.includes("set_condition"));
});

test("the last refusal wins, and beats reading the message", () => {
  const line = emptyTurnLine(
    [
      call("a", "use_spell_slot"),
      result("a", { error: "No level 3 slot left.", refused: "rules" }),
      call("b", "cast_buff"),
      result("b", { error: "Bless is not on Ada's spell list; they cannot cast it.", refused: "rules" }),
    ],
    mage("use the ambush spell"),
  );
  assert.match(line, /Bless is not on Ada's spell list/);
});

test("a spell the message names as the sheet does gets its slot and an example, in any language", () => {
  for (const text of ["use the ambush spell", "usa la magia Ambush", "lance le sort ambush sur l'orc"]) {
    const line = emptyTurnLine([], mage(text));
    assert.match(line, /could not resolve Ambush\. Try again with the spell, slot and target spelled out/, text);
    assert.match(line, /"I cast Ambush using a level 1 slot on myself\."/, text);
  }
});

test("a cantrip is never asked for a slot", () => {
  const line = emptyTurnLine([], mage("cast fire bolt"));
  assert.ok(!line.includes("slot on myself"));
  assert.match(line, /"I cast Fire Bolt on myself\."/);
});

test("a message naming no spell on the sheet gets the plain hint, which says what a spell needs", () => {
  for (const text of ["cast guardian angel", "lancio un incantesimo", "I open the door"]) {
    const line = emptyTurnLine([], mage(text));
    assert.match(line, /Try again saying plainly what your character does/, text);
    assert.match(line, /its name as it is on your sheet, the slot level and the target/, text);
  }
});

test("a spell waiting for the long rest says so", () => {
  const player = { ...mage("cast ambush"), notReady: (spell) => `${spell} is chosen but not prepared yet.` };
  assert.equal(emptyTurnLine([], player), "The GM could not resolve that: Ambush is chosen but not prepared yet.");
});

test("only a rules refusal reaches the table: a retry or a limit is the model's to answer", () => {
  const refused = (body) => emptyTurnLine([call("a", "pc_attack"), result("a", body)]);
  assert.match(refused({ error: "Kara is at 0 HP and cannot attack.", refused: "rules" }), /Kara is at 0 HP/);
  assert.equal(refused({ error: "Unknown targetEnemyId; use one from GAME STATE.", retry: true }), EMPTY_TURN_LINE);
  assert.equal(refused({ error: "Encounter action limit reached for this turn.", refused: "limit" }), EMPTY_TURN_LINE);
});

test("an action that went through and was never narrated says so, never 'try again'", () => {
  const hit = { attacker: "Avery", target: "Goblin 3", hit: true, damage: 4, ok: true };
  // Out of reach, a move, then the swing lands: the latest action wins.
  const line = emptyTurnLine(
    [
      call("a", "pc_attack"),
      result("a", { error: "Avery is 30 ft from Goblin 3, out of melee reach (5 ft).", refused: "rules" }),
      call("b", "pc_attack"),
      result("b", hit),
    ],
    mage("I attack the goblin"),
  );
  assert.equal(line, RESOLVED_TURN_LINE);
  assert.equal(emptyTurnLine([call("a", "buy_item"), result("a", { ok: true, item: "Torch" })], mage("I buy a torch")), RESOLVED_TURN_LINE);
  // A refusal after the swing is the latest word.
  assert.match(
    emptyTurnLine([call("a", "pc_attack"), result("a", hit), call("b", "pc_attack"), result("b", { error: "Avery has already made all 1 of their attack this turn.", refused: "rules" })]),
    /already made all 1 of their attack/,
  );
  // The DM's own tools going through are not the player's action.
  assert.equal(emptyTurnLine([call("a", "set_npc"), result("a", { ok: true })]), EMPTY_TURN_LINE);
});

const callWith = (id, name, args) => ({
  role: "assistant",
  content: "",
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

test("a character's area spell that went through and was never narrated says so, never 'try again'", () => {
  // A live model did this with Ice Storm: the damage landed, the slot was
  // spent, and the table was told to try again.
  const blast = [callWith("a", "aoe_damage", { casterCharacterId: "s1", spell: "Fire Bolt" }), result("a", { ok: true, results: [] })];
  assert.equal(emptyTurnLine(blast, mage("I cast Fire Bolt at them")), RESOLVED_TURN_LINE);
  // Refused by the rules, it gives its reason as any cast does.
  const refused = [callWith("a", "aoe_damage", { casterCharacterId: "s1", spell: "Shield" }), result("a", { error: "No level 1 slot left.", refused: "rules" })];
  assert.match(emptyTurnLine(refused, mage("I cast Shield")), /^The GM could not resolve that: No level 1 slot left\./);
});

test("a healing spell that went through says so too, whoever cast it", () => {
  const cure = [callWith("a", "heal", { characterId: "s1", spell: "Shield" }), result("a", { ok: true })];
  assert.equal(emptyTurnLine(cure, mage("I cast Shield on myself")), RESOLVED_TURN_LINE);
  const byAnother = [callWith("a", "heal", { characterId: "s2", casterId: "s1" }), result("a", { ok: true })];
  assert.equal(emptyTurnLine(byAnother, mage("I heal Bram")), RESOLVED_TURN_LINE);
});

test("a creature's area spell, a trap's and the GM's own healing are not the player's action", () => {
  const notYours = (name, args) => emptyTurnLine([callWith("a", name, args), result("a", { ok: true })]);
  assert.equal(notYours("aoe_damage", { casterEnemyId: "e1", spell: "Ice Storm" }), EMPTY_TURN_LINE);
  assert.equal(notYours("aoe_damage", { damage: "2d6", saveAbility: "dex", dc: 12 }), EMPTY_TURN_LINE);
  assert.equal(notYours("heal", { characterId: "s1", amount: 5 }), EMPTY_TURN_LINE);
  // And its refusal stays hidden: it can name what the table should not see.
  const hidden = emptyTurnLine([callWith("a", "aoe_damage", { casterEnemyId: "e1", spell: "Ice Storm" }), result("a", { error: "The mage has no slot.", refused: "rules" })]);
  assert.equal(hidden, EMPTY_TURN_LINE);
  // Arguments that do not parse are no action of the player's.
  const garbled = emptyTurnLine([{ role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "aoe_damage", arguments: "{oops" } }] }, result("a", { ok: true })]);
  assert.equal(garbled, EMPTY_TURN_LINE);
});

test("a basic card's action that went through says so, never 'try again'; an enemy's is not the player's", () => {
  // The calls the Hand's basic cards resolve to (intent-logic.ts directCardCalls).
  const played = [
    ["take_action", { characterId: "s1", action: "dash" }],
    ["end_turn", { characterId: "s1" }],
    ["dismount", { characterId: "s1" }],
    ["handle_item", { characterId: "s1", action: "equip", item: "Shield" }],
    ["stabilize", { characterId: "s2", healerId: "s1" }],
    ["clear_condition", { characterId: "s1", condition: "Prone" }],
  ];
  for (const [name, args] of played) {
    assert.equal(emptyTurnLine([callWith("a", name, args), result("a", { ok: true })], mage("I dash to the door")), RESOLVED_TURN_LINE, name);
  }
  const refused = [callWith("a", "take_action", { characterId: "s1", action: "dash" }), result("a", { error: "Ada has no action left this turn.", refused: "rules" })];
  assert.match(emptyTurnLine(refused, mage("I dash")), /^The GM could not resolve that: Ada has no action left this turn\./);
  // An enemy's action, and the DM ending a character's other condition.
  const notYours = (name, args) => emptyTurnLine([callWith("a", name, args), result("a", { ok: true })]);
  assert.equal(notYours("take_action", { action: "dodge", enemyId: "e1" }), EMPTY_TURN_LINE);
  assert.equal(notYours("clear_condition", { characterId: "s1", condition: "poisoned" }), EMPTY_TURN_LINE);
});

test("anything else gets a plain hint, and no player keeps the old line", () => {
  assert.equal(emptyTurnLine([call("a", "reveal_item"), result("a", { error: "The ring is a mimic." })]), EMPTY_TURN_LINE);
  assert.equal(emptyTurnLine([]), EMPTY_TURN_LINE);
});

test("a spell waiting for the rest or only in the book is named as such", () => {
  const casting = {
    ability: "int",
    slots: {},
    known: [],
    prepared: ["Shield"],
    cantrips: [],
    pending: ["Sleep"],
    spellbook: ["Shield", "Sleep", "Identify"],
  };
  assert.match(notReadyReason(casting, "sleep")?.error, /after the next long rest/);
  assert.match(notReadyReason(casting, "Identify")?.error, /in the spellbook but not prepared/);
  assert.equal(notReadyReason(casting, "Fireball"), null);
  // Shield is written in the book AND prepared: it is ready, not blocked.
  assert.equal(notReadyReason(casting, "shield"), null);
});

console.log(`test-empty-turn: ${passed} tests passed.`);
