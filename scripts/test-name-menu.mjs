// The composer's @ menu (issue 650): where an @ starts a name, which names
// each voice is offered, how a query finds them, and how the chosen name is
// written into the box. Pure: no database, no server.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { mentionAt, nameChoices, matchNames, nameMenuAt, insertName, searchKey, NAME_MENU_LIMIT } = await import(
  "../src/app/campaigns/[campaignId]/name-menu-logic.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const party = [{ name: "Kara" }, { name: "Brom Ironfist" }, { name: "Wisp", summon: { by: "Kara" } }];
const cast = [
  { name: "Sildar Hallwinter", aliases: ["Sildar"], known: true },
  { name: "Fàbbro Neri", aliases: ["the Blacksmith"], known: true },
  { name: "Iarno Albrek", known: false },
];
const places = [{ name: "Phandalin" }, { name: "Tresendar Manor" }, { name: "Neverwinter Wood" }];

test("an @ at the start, after a space or an opening mark starts a name; inside a word it is text", () => {
  assert.deepEqual(mentionAt("@", 1), { start: 0, query: "" });
  assert.deepEqual(mentionAt("I greet @Sil", 12), { start: 8, query: "Sil" });
  assert.deepEqual(mentionAt('"@Sil', 5), { start: 1, query: "Sil" });
  assert.deepEqual(mentionAt("(@br", 4), { start: 1, query: "br" });
  assert.equal(mentionAt("mail bob@example.com", 20), null);
  assert.equal(mentionAt("no at sign here", 15), null);
});

test("a space straight after the @, a line break, a second @ or a very long query is not a name", () => {
  assert.equal(mentionAt("meet @ noon", 11), null);
  assert.equal(mentionAt("@Sil\nand", 8), null);
  assert.equal(mentionAt("@@", 2), null);
  assert.equal(mentionAt(`@${"a".repeat(41)}`, 42), null);
  assert.deepEqual(mentionAt("@Sildar Hall", 12), { start: 0, query: "Sildar Hall" }, "names have spaces in them");
});

test("only the text before the caret counts", () => {
  assert.deepEqual(mentionAt("@Sil and more", 4), { start: 0, query: "Sil" });
  assert.equal(mentionAt("Kara @", 4), null);
});

test("a character's voice is offered the party, the people the table knows and the places; never a summon or a stranger", () => {
  const names = nameChoices({ sheets: party, cast, places, storyVoice: false });
  assert.deepEqual(
    names.map((choice) => `${choice.group}:${choice.name}`),
    [
      "party:Kara",
      "party:Brom Ironfist",
      "people:Sildar Hallwinter",
      "people:Fàbbro Neri",
      "places:Phandalin",
      "places:Tresendar Manor",
      "places:Neverwinter Wood",
    ],
  );
  assert.ok(!names.some((choice) => choice.unmet));
});

test("the story's voice is offered the whole cast it holds, the not yet introduced marked", () => {
  const names = nameChoices({ sheets: party, cast, places, storyVoice: true });
  const iarno = names.find((choice) => choice.name === "Iarno Albrek");
  assert.deepEqual(iarno, { name: "Iarno Albrek", group: "people", unmet: true });
  assert.equal(names.find((choice) => choice.name === "Sildar Hallwinter")?.unmet, undefined);
});

test("an older host's unmarked cast is never offered in a character's voice", () => {
  const unmarked = cast.map((member) => ({ name: member.name, ...(member.aliases ? { aliases: member.aliases } : {}) }));
  assert.ok(!nameChoices({ sheets: party, cast: unmarked, places, storyVoice: false }).some((choice) => choice.group === "people"));
  const told = nameChoices({ sheets: party, cast: unmarked, places, storyVoice: true }).filter((choice) => choice.group === "people");
  assert.equal(told.length, 3, "the story's voice holds them anyway");
  assert.ok(!told.some((choice) => choice.unmet), "and nothing says who is new");
});

test("each name is offered once, the party's spelling first", () => {
  const names = nameChoices({ sheets: [{ name: "Seren" }], cast: [{ name: "seren", known: true }], places: [{ name: "Seren" }], storyVoice: false });
  assert.deepEqual(names, [{ name: "Seren", group: "party" }]);
});

test("a query ignores case, accents and apostrophes, finds a word inside a name, and finds an alias", () => {
  const names = nameChoices({ sheets: party, cast, places, storyVoice: false });
  assert.deepEqual(matchNames(names, "fab").map((choice) => choice.name), ["Fàbbro Neri"]);
  assert.deepEqual(matchNames(names, "FÀBB").map((choice) => choice.name), ["Fàbbro Neri"]);
  assert.deepEqual(matchNames(names, "hallw").map((choice) => choice.name), ["Sildar Hallwinter"]);
  assert.deepEqual(matchNames(names, "blacksm").map((choice) => choice.name), ["Fàbbro Neri"], "by the alias, written by the name");
  assert.deepEqual(matchNames(names, "sildar hall").map((choice) => choice.name), ["Sildar Hallwinter"]);
  assert.equal(searchKey("Fàbbro Neri"), "fabbro neri");
  const town = nameChoices({ sheets: [], cast: [], places: [{ name: "Thundertree's Côte" }], storyVoice: false });
  for (const typed of ["thundertrees", "thundertree's", "Thundertree’s co", "cote"]) {
    assert.deepEqual(matchNames(town, typed).map((choice) => choice.name), ["Thundertree's Côte"], typed);
  }
});

test("groups keep their order; within one, a name that starts with the query comes before one that holds it", () => {
  const names = nameChoices({
    sheets: [{ name: "Thorn" }],
    cast: [{ name: "Old Thom", known: true }, { name: "Thomas", known: true }],
    places: [{ name: "Thornwood" }],
    storyVoice: false,
  });
  assert.deepEqual(
    matchNames(names, "tho").map((choice) => choice.name),
    ["Thorn", "Thomas", "Old Thom", "Thornwood"],
  );
  assert.deepEqual(matchNames(names, "").map((choice) => choice.name), ["Thorn", "Old Thom", "Thomas", "Thornwood"], "an empty query lists them by name");
});

test("the list is capped to what a phone shows above its keyboard", () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ name: `Guard ${index + 1}`, known: true }));
  const names = nameChoices({ sheets: [], cast: many, places: [], storyVoice: false });
  assert.equal(matchNames(names, "gu").length, NAME_MENU_LIMIT);
  assert.equal(matchNames(names, "gu")[1].name, "Guard 2", "numbers by value");
});

test("the menu steps aside once the sentence goes on past a name it cannot find", () => {
  const names = nameChoices({ sheets: party, cast, places, storyVoice: false });
  assert.equal(nameMenuAt("@Sil", 4, names)?.matches.length, 1);
  assert.deepEqual(nameMenuAt("@zz", 3, names)?.matches, [], "a word still being typed shows that nothing matches");
  assert.equal(nameMenuAt("@zz is here", 11, names), null);
  assert.equal(nameMenuAt("@Sildar is", 10, names), null);
  assert.equal(nameMenuAt("@Sildar Hall", 12, names)?.matches[0].name, "Sildar Hallwinter");
});

test("the chosen name replaces the @ and what was typed, with one space after it", () => {
  assert.deepEqual(insertName("I greet @sil", 8, 12, "Sildar Hallwinter"), { text: "I greet Sildar Hallwinter ", caret: 26 });
  assert.deepEqual(insertName("I greet @sil and go", 8, 12, "Sildar Hallwinter"), { text: "I greet Sildar Hallwinter and go", caret: 26 });
  assert.deepEqual(insertName("@sil's sword", 0, 4, "Sildar"), { text: "Sildar's sword", caret: 6 }, "a possessive needs no space");
  assert.deepEqual(insertName("Ask @sil, then", 4, 8, "Sildar"), { text: "Ask Sildar, then", caret: 10 });
  assert.deepEqual(insertName("@sildar", 0, 4, "Sildar Hallwinter"), { text: "Sildar Hallwinter ", caret: 18 }, "the rest of the word the caret stood in goes too");
});

console.log(`${passed} name menu tests passed`);
