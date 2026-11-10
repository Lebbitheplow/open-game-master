// The argument door every GM tool call passes once before any gate or
// handler reads it (src/lib/dm/arg-coerce.ts doorArgs, through turn.ts
// modelCallArguments): what each slip becomes, read without a database.
// The gap sweep of 2026-11-09 found each one read one way at one door and
// another way at the next (scripts/test-enforce-sweep-modelio-fuzz.mjs walks
// every tool with them).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { doorArgs } = await import("../src/lib/dm/arg-coerce.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const sheets = [
  { id: "a1", name: "Mira" },
  { id: "b2", name: "Brann" },
];
const properties = {
  characterId: { type: "string" },
  characterIds: { type: "array" },
  targetCharacterIds: { type: "array" },
  hours: { type: "number" },
  qty: { type: "integer" },
  advantage: { type: "string", enum: ["none", "advantage", "disadvantage"] },
  magical: { type: "boolean" },
  value: { type: "string" },
  reason: { type: "string" },
  items: { type: "array" },
  objectives: { type: "array", items: { type: "string" } },
};
const door = (args) => {
  const out = doorArgs(JSON.stringify(args), { properties, sheets });
  return "refusal" in out ? out.refusal : JSON.parse(out.rawArguments);
};

test("null for any field is the field left out, at the top and in a list's entries", () => {
  assert.deepEqual(door({ hours: null, reason: "the road" }), { reason: "the road" });
  assert.deepEqual(door({ items: [{ name: "Rope", qty: null }] }), { items: [{ name: "Rope" }] });
});

test("an empty number, yes/no or fixed choice is left out; an empty text stays a value", () => {
  assert.deepEqual(door({ hours: "", qty: "", advantage: "", magical: "" }), {});
  // The console's "left empty to clear them" (catalog-party.ts update_sheet value).
  assert.deepEqual(door({ value: "" }), { value: "" });
});

test("one value where a list is asked is a list of one, and a list of one text where one text is asked is that text", () => {
  assert.deepEqual(door({ items: { name: "Rope" } }), { items: [{ name: "Rope" }] });
  assert.deepEqual(door({ reason: ["listening at the door"] }), { reason: "listening at the door" });
  // Two entries are not guessed between: the handler's parse refuses them by name.
  assert.deepEqual(door({ reason: ["one", "two"] }), { reason: ["one", "two"] });
});

// The console's "Objectives, one per line" (catalog-binder.ts) is one text:
// a list of that one text made a quest of one two-line objective, and
// tick_objective found neither line.
test("a text where a list of texts is asked is its lines, and where a list of characters is asked its lines or commas", () => {
  assert.deepEqual(door({ objectives: "Ask at the inn\r\n Search the mill \n" }), { objectives: ["Ask at the inn", "Search the mill"] });
  assert.deepEqual(door({ objectives: "Ask at the inn, then the mill" }), { objectives: ["Ask at the inn, then the mill"] }, "a comma is no break in a text");
  assert.deepEqual(door({ characterIds: "a1, Brann" }), { characterIds: ["a1", "b2"] });
  assert.deepEqual(door({ characterIds: "Mira\nb2" }), { characterIds: ["a1", "b2"] });
  assert.deepEqual(door({ items: "Rope\nTorch" }), { items: ["Rope\nTorch"] }, "a list of things not texts is a list of one");
});

test("a character named by name reaches their id, so the AI's gate and the handler read the same sheet", () => {
  assert.deepEqual(door({ characterId: "mira" }), { characterId: "a1" });
  assert.deepEqual(door({ characterId: "a1" }), { characterId: "a1" });
  // A ref that names nobody is left for the handler, which lists who there is.
  assert.deepEqual(door({ characterId: "Zed" }), { characterId: "Zed" });
});

test("a list of character ids is refused at the first one that names nobody, with who there is, and nothing is done", () => {
  const refused = door({ characterIds: ["a1", "b"] });
  assert.equal(refused.retry, true);
  assert.match(refused.error, /Unknown characterIds "b"/);
  assert.match(refused.error, /Mira \(a1\)/);
  assert.match(refused.error, /Brann \(b2\)/);
  assert.deepEqual(door({ characterIds: ["a1", "Brann"] }), { characterIds: ["a1", "b2"] });
  assert.equal(door({ targetCharacterIds: ["A1"] }).retry, true, "an id in another case is no id");
});

// cast_buff's Bless on an ogre the party dominates: its enemy id is no
// character's, and the handler takes it (turn.ts hands the door
// cast-buff-allies.ts sideAllyInList, the handler's own lookup).
test("an id the tool's handler takes though it is no character's passes the list, the actor read by name first; any other is still refused", () => {
  const asked = [];
  const alsoNames = (key, ref, args) => {
    asked.push([key, ref, args.characterId]);
    return key === "targetCharacterIds" && ref === "ogre-1" && args.characterId === "a1";
  };
  const read = (args) => {
    const out = doorArgs(JSON.stringify(args), { properties, sheets, alsoNames });
    return "refusal" in out ? out.refusal : JSON.parse(out.rawArguments);
  };
  assert.deepEqual(read({ targetCharacterIds: ["ogre-1", "Brann"], characterId: "Mira" }), { targetCharacterIds: ["ogre-1", "b2"], characterId: "a1" });
  assert.deepEqual(asked, [["targetCharacterIds", "ogre-1", "a1"]], "a character's id or name is never asked of it");
  assert.match(read({ characterId: "a1", targetCharacterIds: ["goblin-2"] }).error, /Unknown targetCharacterIds "goblin-2"/);
  assert.match(read({ characterId: "a1", characterIds: ["ogre-1"] }).error, /Unknown characterIds "ogre-1"/);
});

test("a name two sheets share names neither", () => {
  const twins = doorArgs(JSON.stringify({ characterId: "Mira" }), { properties, sheets: [...sheets, { id: "c3", name: "Mira" }] });
  assert.deepEqual(JSON.parse(twins.rawArguments), { characterId: "Mira" });
});

test("the words true and false are the booleans, as strictBooleanArgs reads them", () => {
  assert.deepEqual(door({ magical: "false", items: [{ name: "Rope", magical: "TRUE" }] }), { magical: false, items: [{ name: "Rope", magical: true }] });
});

test("arguments that are not a JSON object are handed back for the handler to refuse", () => {
  assert.deepEqual(doorArgs("{not json", { properties, sheets }), { rawArguments: "{not json" });
  assert.deepEqual(doorArgs("[]", { properties, sheets }), { rawArguments: "[]" });
});

console.log(`tool-door: ${passed} tests passed`);
