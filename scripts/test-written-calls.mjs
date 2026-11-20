// A call the narrator wrote out in words instead of making it (issue 1025):
// gpt-oss-20b on llama.cpp ended a campaign's opening scene on its
// request_player_input arguments, one to a line, and the table read and
// heard "characterIds: [...]" and "prompt: ...". Here:
// - argument lines, as YAML or as assignments, under a tool's name or in a
//   code fence, and a tool written as a function, are found and cut from what
//   the table reads, hears and the model reads back, live and stored;
// - a story's own lines with a colon stay ("Bram: ...", "Note: ...");
// - the turn's salvage runs the call they name or fit;
// - the tools the leak list was missing are cut, salvaged and read as tool
//   talk like the others.
// Usage: node scripts/test-written-calls.mjs
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { stripToolText } = await import("../src/lib/dm/tool-text.ts");
const { findArgumentLines, findFunctionCalls, withoutWrittenCalls } = await import("../src/lib/dm/written-calls.ts");
const { salvageWrittenCalls, salvageJsonToolCalls } = await import("../src/lib/dm/json-salvage.ts");
const { salvageTextualToolCalls, salvageXmlToolCalls } = await import("../src/lib/dm/rolls.ts");
const { withoutToolTalk } = await import("../src/lib/dm/narration-tidy-logic.ts");
const { createStreamingArtifactFilter } = await import("../src/lib/story-prompt.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const ID = "6d4778d9-3ebc-41ca-805d-4b388f6764a5";
const PROSE = "The rain falls harder, as if urging the hero to decide.";
const ASK = `characterIds: ["${ID}"]\nprompt: "What will the hero do next?"`;
const tool = (name, properties, required = []) => ({
  type: "function",
  function: { name, parameters: { type: "object", properties: Object.fromEntries(properties.map((key) => [key, {}])), required } },
});
const TOOLS = [
  tool("request_player_input", ["characterIds", "prompt"], ["characterIds"]),
  tool("send_whisper", ["characterIds", "message"], ["characterIds", "message"]),
  tool("request_roll", ["characterId", "kind", "skill", "dc", "reason"], ["characterId", "kind"]),
];
const args = (call) => JSON.parse(call.rawArguments);

// Streams the text a few characters at a time, as a provider's chunks arrive.
function streamed(text, size = 3) {
  const filter = createStreamingArtifactFilter();
  let out = "";
  for (let at = 0; at < text.length; at += size) {
    out += filter.push(text.slice(at, at + size));
  }
  return out + filter.flush();
}

test("the reported reply: argument lines after the prose are found with their values", () => {
  const [block] = findArgumentLines(`${PROSE}\n\n${ASK}`);
  assert.deepEqual(block.args, { characterIds: [ID], prompt: "What will the hero do next?" });
  assert.equal(block.tool, null);
});

test("the reported reply never reaches the table, stored or streamed", () => {
  const reply = `${PROSE}\n\n${ASK}`;
  assert.equal(stripToolText(reply), PROSE);
  assert.equal(streamed(reply).trim(), PROSE);
  assert.equal(streamed(reply, 1).trim(), PROSE);
});

test("the turn's salvage runs the lines as the one call they fit, and cuts them", () => {
  const salvaged = salvageWrittenCalls(`${PROSE}\n\n${ASK}`, TOOLS);
  assert.equal(salvaged.text, PROSE);
  assert.deepEqual(salvaged.calls.map((call) => call.name), ["request_player_input"]);
  assert.deepEqual(args(salvaged.calls[0]), { characterIds: [ID], prompt: "What will the hero do next?" });
});

test("assignments, a YAML list, a tool's name above and a code fence around are the same call", () => {
  const shapes = [
    `characterIds=["${ID}"]\nprompt="What will the hero do next?"`,
    `characterIds:\n  - ${ID}\nprompt: What will the hero do next?`,
    `request_player_input:\n  characterIds: ["${ID}"]\n  prompt: "What will the hero do next?"`,
    `\`\`\`yaml\n${ASK}\n\`\`\``,
    `- characterIds: ["${ID}"]\n- prompt: "What will the hero do next?"`,
  ];
  for (const shape of shapes) {
    const reply = `${PROSE}\n\n${shape}`;
    const salvaged = salvageWrittenCalls(reply, TOOLS);
    assert.equal(salvaged.text, PROSE, shape);
    assert.deepEqual(salvaged.calls.map((call) => call.name), ["request_player_input"], shape);
    assert.deepEqual(args(salvaged.calls[0]).characterIds, [ID], shape);
    assert.equal(stripToolText(reply), PROSE, shape);
    assert.equal(streamed(reply).trim(), PROSE, shape);
  }
});

test("a whisper written as lines runs as the whisper and the table never reads the secret", () => {
  const reply = `${PROSE}\n\ncharacterIds: ["${ID}"]\nmessage: "The demon in your blood stirs."`;
  const salvaged = salvageWrittenCalls(reply, TOOLS);
  assert.deepEqual(salvaged.calls.map((call) => call.name), ["send_whisper"]);
  assert.equal(salvaged.text, PROSE);
  assert.equal(stripToolText(reply), PROSE);
  assert.ok(!streamed(reply).includes("demon"));
});

test("a roll written as lines runs as the roll", () => {
  const salvaged = salvageWrittenCalls(`${PROSE}\n\ncharacterId: ${ID}\nkind: skill\nskill: perception\ndc: 13`, TOOLS);
  assert.deepEqual(salvaged.calls.map((call) => call.name), ["request_roll"]);
  assert.deepEqual(args(salvaged.calls[0]), { characterId: ID, kind: "skill", skill: "perception", dc: 13 });
  assert.equal(salvaged.text, PROSE);
});

test("lines no tool fits are cut when they hold an id, and never run", () => {
  const salvaged = salvageWrittenCalls(`${PROSE}\n\ncharacterId: ${ID}\namount: 5`, TOOLS);
  assert.equal(salvaged.calls.length, 0);
  assert.equal(salvaged.text, PROSE);
});

test("a tool written as a function runs and goes, its arguments as assignments or JSON", () => {
  for (const written of [
    `request_player_input(characterIds=["${ID}"], prompt="What, now?")`,
    `request_player_input({"characterIds":["${ID}"],"prompt":"What, now?"})`,
    `request_player_input(characterIds: ["${ID}"], prompt: "What, now?")`,
  ]) {
    const reply = `${PROSE}\n\n${written}`;
    const salvaged = salvageWrittenCalls(reply, TOOLS);
    assert.deepEqual(salvaged.calls.map((call) => call.name), ["request_player_input"], written);
    assert.deepEqual(args(salvaged.calls[0]), { characterIds: [ID], prompt: "What, now?" }, written);
    assert.equal(salvaged.text, PROSE, written);
    assert.equal(stripToolText(reply), PROSE, written);
    assert.equal(streamed(reply).trim(), PROSE, written);
  }
  // Cut short: nothing after the opener is story.
  assert.equal(stripToolText(`${PROSE} request_roll(characterId="${ID}", kind=`), PROSE);
  assert.equal(findFunctionCalls(`${PROSE} request_roll(characterId="${ID}"`)[0].args, null);
});

test("a fence left empty once its JSON call is cut goes too", () => {
  const reply = `${PROSE}\n\n\`\`\`json\n{"characterIds":["${ID}"],"prompt":"What now?"}\n\`\`\``;
  const salvaged = salvageJsonToolCalls(reply, TOOLS);
  assert.deepEqual(salvaged.calls.map((call) => call.name), ["request_player_input"]);
  assert.equal(salvaged.text, PROSE);
  assert.equal(stripToolText(reply), PROSE);
  assert.equal(streamed(reply).trim(), PROSE);
  // A fence with something in it is the story's.
  assert.equal(stripToolText("A note:\n```\nMeet at dawn.\n```"), "A note:\n```\nMeet at dawn.\n```");
});

test("a story's own lines with a colon or a bracket stay, live and stored", () => {
  const stories = [
    `${PROSE}\n\nBram: "Hold the rope, I said."`,
    `${PROSE}\n\nNote: the bridge is out.`,
    `${PROSE}\n\nnote: the bridge is out.\nprompt: what now?`,
    "The sign reads:\n- closed: until dawn\n- open: never",
    "You move forward. The set of keys jingles; the end is near.",
    "and then: silence.",
    "She hums (softly) as the request goes unanswered.",
  ];
  for (const story of stories) {
    assert.equal(withoutWrittenCalls(story), story, story);
    assert.equal(stripToolText(story), story, story);
    assert.equal(streamed(story), story, story);
    assert.equal(streamed(story, 1), story, story);
    assert.equal(salvageWrittenCalls(story, TOOLS).text, story, story);
  }
});

test("the tools the leak list was missing are cut, salvaged and read as tool talk", () => {
  const bracket = salvageTextualToolCalls(`${PROSE} [set_quest title="Find the ferryman" status=active]`);
  assert.equal(bracket.text, PROSE);
  assert.deepEqual(bracket.calls.map((call) => call.name), ["set_quest"]);
  assert.equal(stripToolText(`${PROSE} [open_shop name=Smithy]`).trim(), PROSE);
  const xml = salvageXmlToolCalls(`${PROSE}<tool_call><function=open_shop><parameter=name>Smithy</parameter></function></tool_call>`);
  assert.deepEqual(xml.calls.map((call) => call.name), ["open_shop"]);
  assert.equal(withoutToolTalk(`${PROSE} Next I should call set_weather for the storm.`), PROSE);
});

console.log(`PASS: ${passed} written-call checks`);
