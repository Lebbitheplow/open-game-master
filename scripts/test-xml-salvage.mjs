// XML tool-call salvage: the model's native <tool_call><function=...>
// dialect leaked as text (llama-server extraction miss) becomes synthetic
// calls, and every tag is stripped from narration and speech.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { salvageXmlToolCalls } = await import("../src/lib/dm/rolls.ts");
const { stripToolText } = await import("../src/lib/dm/tool-text.ts");
const { createStreamingArtifactFilter } = await import("../src/lib/story-prompt.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function args(result, index = 0) {
  return JSON.parse(result.calls[index].rawArguments);
}

// The exact leak observed live during combat testing.
const LIVE_LEAK = `<tool_call>
<function=enemy_attack>
<parameter=enemyId>
fc44185a-24e9-4b0f-8ab4-82b23e858f03
</parameter>
<parameter=targetCharacterId>
c7badbb8-4ebf-443e-a626-d8a63663584f
</parameter>
<parameter=advantage>
none
</parameter>
</function>
</tool_call>`;

test("the exact live leak becomes an enemy_attack call", () => {
  const result = salvageXmlToolCalls(LIVE_LEAK);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, "enemy_attack");
  assert.deepEqual(args(result), {
    enemyId: "fc44185a-24e9-4b0f-8ab4-82b23e858f03",
    targetCharacterId: "c7badbb8-4ebf-443e-a626-d8a63663584f",
    advantage: "none",
  });
  assert.equal(result.text, "");
});

test("leak mid-narration preserves surrounding prose", () => {
  const result = salvageXmlToolCalls(
    `The drone pivots toward Avery, targeting lasers converging.\n\n${LIVE_LEAK}\n\nThe alley falls silent.`,
  );
  assert.equal(result.calls.length, 1);
  assert.ok(result.text.includes("targeting lasers"));
  assert.ok(result.text.includes("falls silent"));
  assert.ok(!result.text.includes("<"), result.text);
});

test("JSON dialect inside tool_call", () => {
  const result = salvageXmlToolCalls(
    '<tool_call>\n{"name": "damage_enemy", "arguments": {"enemyId": "e1", "amount": 12, "type": "fire"}}\n</tool_call>',
  );
  assert.equal(result.calls[0].name, "damage_enemy");
  assert.deepEqual(args(result), { enemyId: "e1", amount: 12, type: "fire" });
});

test("value coercion: ints, booleans, JSON arrays", () => {
  const result = salvageXmlToolCalls(
    `<tool_call><function=start_encounter><parameter=enemies>[{"monster":"goblin","count":3}]</parameter><parameter=summary>Ambush</parameter></function></tool_call>`,
  );
  const parsed = args(result);
  assert.deepEqual(parsed.enemies, [{ monster: "goblin", count: 3 }]);
  assert.equal(parsed.summary, "Ambush");

  const nums = salvageXmlToolCalls(
    `<tool_call><function=damage_enemy><parameter=enemyId>e1</parameter><parameter=amount>15</parameter></function></tool_call>`,
  );
  assert.equal(args(nums).amount, 15);
});

test("multiple blocks in one reply", () => {
  const result = salvageXmlToolCalls(
    `<tool_call><function=damage_enemy><parameter=enemyId>e1</parameter><parameter=amount>8</parameter></function></tool_call>\nBetween attacks.\n<tool_call><function=enemy_attack><parameter=enemyId>e2</parameter><parameter=targetCharacterId>c1</parameter></function></tool_call>`,
  );
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].name, "damage_enemy");
  assert.equal(result.calls[1].name, "enemy_attack");
  assert.equal(result.text, "Between attacks.");
});

test("bare function block without tool_call wrapper", () => {
  const result = salvageXmlToolCalls(
    `<function=move_token><parameter=name>Cyber-Mastiff 1</parameter><parameter=x>4</parameter><parameter=y>7</parameter></function>`,
  );
  assert.equal(result.calls[0].name, "move_token");
  assert.deepEqual(args(result), { name: "Cyber-Mastiff 1", x: 4, y: 7 });
});

test("unknown function name is stripped but not dispatched", () => {
  const result = salvageXmlToolCalls(
    `<tool_call><function=summon_dragon><parameter=size>huge</parameter></function></tool_call>The air stills.`,
  );
  assert.equal(result.calls.length, 0);
  assert.equal(result.text, "The air stills.");
});

test("truncated block still salvages and strips", () => {
  const result = salvageXmlToolCalls(
    `<tool_call>\n<function=damage_enemy>\n<parameter=enemyId>\ne1\n</parameter>\n<parameter=amount>\n9`,
  );
  assert.equal(result.calls.length, 1);
  assert.deepEqual(args(result), { enemyId: "e1", amount: 9 });
  assert.ok(!result.text.includes("<"));
});

test("orphaned tags strip without crashing", () => {
  const result = salvageXmlToolCalls("The blow lands.</tool_call></function></parameter>");
  assert.equal(result.calls.length, 0);
  assert.equal(result.text, "The blow lands.");
});

test("plain narration with angle brackets is untouched", () => {
  const text = "The sign reads <KEEP OUT> in flaking paint.";
  const result = salvageXmlToolCalls(text);
  assert.equal(result.calls.length, 0);
  assert.equal(result.text, text);
});

test("stripToolText removes XML blocks and move_token brackets", () => {
  const stripped = stripToolText(
    `A tense beat. ${LIVE_LEAK} Then chaos. [move_token name=Wolf x=3 y=2]`,
  );
  assert.ok(!stripped.includes("<"));
  assert.ok(!stripped.includes("move_token"));
  assert.ok(stripped.includes("A tense beat."));
  assert.ok(stripped.includes("Then chaos."));
});

// ---- the Anthropic-style dialect (issue 794) --------------------------------
// An agent program behind the harness provider wrote a call into its final
// message as text. Only a call that hands the floor to the players runs; a
// call read from prose must not change the game.
const PROSE = "The road forks under the pines.";
const param = (name, value) => `<parameter name="${name}">${value}</parameter>`;
const invoke = (name, ...params) => `<invoke name="${name}">\n${params.join("\n")}\n</invoke>`;
const ASK = invoke(
  "mcp__odm__request_player_input",
  param("characterIds", '["c1"]'),
  param("prompt", "Which way, and when do you leave?"),
);

test("the shape in the issue gives clean prose and one input request", () => {
  const result = salvageXmlToolCalls(`${PROSE}\n\n${ASK}`);
  assert.equal(result.text, PROSE);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, "request_player_input");
  assert.deepEqual(args(result), { characterIds: ["c1"], prompt: "Which way, and when do you leave?" });
});

test("every prefix a harness shows names the same tool", () => {
  for (const name of [
    "request_player_input",
    "mcp__odm__request_player_input",
    "mcp__my_server__request_player_input",
    "odm_request_player_input",
  ]) {
    const result = salvageXmlToolCalls(`${PROSE} ${invoke(name, param("characterIds", '["c1"]'))}`);
    assert.equal(result.calls[0]?.name, "request_player_input", name);
    assert.equal(result.text, PROSE);
  }
});

test("tags with a namespace prefix are read and stripped", () => {
  const block = ASK.replaceAll("<invoke", "<x:invoke")
    .replaceAll("</invoke", "</x:invoke")
    .replaceAll("<parameter", "<x:parameter")
    .replaceAll("</parameter", "</x:parameter");
  const result = salvageXmlToolCalls(`${PROSE}\n<x:function_calls>\n${block}\n</x:function_calls>`);
  assert.equal(result.text, PROSE);
  assert.deepEqual(args(result), { characterIds: ["c1"], prompt: "Which way, and when do you leave?" });
});

test("a mutation or a roll written as text is stripped and not dispatched", () => {
  for (const name of ["clear_condition", "modify_gold", "apply_damage", "request_roll"]) {
    for (const full of [name, `mcp__odm__${name}`]) {
      const result = salvageXmlToolCalls(`${PROSE}\n\n${invoke(full, param("characterId", "c1"), param("amount", "5"))}`);
      assert.deepEqual(result.calls, [], full);
      assert.equal(result.text, PROSE, full);
      assert.equal(stripToolText(`${PROSE}${invoke(full, param("amount", "5"))}`), PROSE, full);
    }
  }
});

test("a wrapper holding a mutation and an input request runs only the input request", () => {
  const result = salvageXmlToolCalls(
    `${PROSE}\n\n<function_calls>\n${invoke("mcp__odm__apply_damage", param("amount", "9"))}\n${ASK}\n</function_calls>\n\nThe wind drops.`,
  );
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, "request_player_input");
  assert.equal(result.text, `${PROSE}\n\nThe wind drops.`);
});

test("a truncated block is stripped to the end and not dispatched", () => {
  for (const cut of [
    '<invoke name="mcp__odm__request_player_input">\n<parameter name="characterIds">["c1"',
    '<function_calls>\n<invoke name="mcp__odm__request_player_input">\n<parameter name="prompt">Which way',
    '<invoke name="mcp__odm__request_pl',
    "<invoke name",
    "<invoke",
    "<function_calls",
  ]) {
    const result = salvageXmlToolCalls(`${PROSE}\n\n${cut}`);
    assert.deepEqual(result.calls, [], cut);
    assert.equal(result.text, PROSE, cut);
    assert.equal(stripToolText(`${PROSE}${cut}`).trim(), PROSE, cut);
  }
});

test("a whole call before a truncated one still runs", () => {
  const result = salvageXmlToolCalls(`${PROSE}\n<function_calls>\n${ASK}\n<invoke name="mcp__odm__apply_dam`);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, "request_player_input");
  assert.equal(result.text, PROSE);
});

test("an unknown tool is stripped and not dispatched", () => {
  const result = salvageXmlToolCalls(`${invoke("mcp__odm__summon_dragon", param("size", "huge"))}The air stills.`);
  assert.deepEqual(result.calls, []);
  assert.equal(result.text, "The air stills.");
});

test("orphaned tags of the dialect strip without crashing", () => {
  const result = salvageXmlToolCalls(`The blow lands.</invoke></function_calls>${param("x", "1")}`);
  assert.deepEqual(result.calls, []);
  assert.equal(result.text, "The blow lands.");
});

test("prose that only looks like the dialect is untouched", () => {
  for (const text of [
    "The scroll says to <invoke the gods> before dawn, then rest.",
    "An <invoke> rune and a <parameter> glyph glow. 3 < 5 and 7 > 2.",
    "Runes of <invocation name=\"old\"> line the door, and more follow.",
  ]) {
    const result = salvageXmlToolCalls(text);
    assert.deepEqual(result.calls, [], text);
    assert.equal(result.text, text);
    assert.equal(stripToolText(text), text);
  }
});

test("the other dialects still dispatch beside the new one", () => {
  const result = salvageXmlToolCalls(`${LIVE_LEAK}\n${ASK}`);
  assert.deepEqual(result.calls.map((call) => call.name), ["enemy_attack", "request_player_input"]);
  assert.equal(result.text, "");
});

const streamed = (chunks) => {
  const filter = createStreamingArtifactFilter();
  return chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();
};

test("the draft never shows the block, however the chunks split it", () => {
  const block = `${PROSE}\n\n<function_calls>\n${ASK}\n</function_calls>\n\nThe wind drops.`;
  for (const size of [1, 2, 3, 5, 7, 16, 64, block.length]) {
    const chunks = [];
    for (let at = 0; at < block.length; at += size) {
      chunks.push(block.slice(at, at + size));
    }
    assert.equal(streamed(chunks).trim(), PROSE, `chunks of ${size}`);
  }
  assert.equal(streamed([`${PROSE} `, "<x:inv", 'oke name="apply_damage">', "</x:invoke>"]).trim(), PROSE);
});

test("the draft keeps prose that only looks like the dialect", () => {
  // The second line names a "name" with no "=": stripToolText keeps it, so
  // the draft must not hold everything after it back either.
  for (const text of [
    "The scroll says to <invoke the gods> before dawn. 3 < 5.",
    'The priest cries "<invoke name of the drowned king>" and the water stills.',
  ]) {
    assert.equal(stripToolText(text), text);
    for (const size of [1, 4, text.length]) {
      const chunks = [];
      for (let at = 0; at < text.length; at += size) {
        chunks.push(text.slice(at, at + size));
      }
      assert.equal(streamed(chunks), text, `chunks of ${size}`);
    }
  }
});

console.log(`test-xml-salvage: ${passed} passed`);
