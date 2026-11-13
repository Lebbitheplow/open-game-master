// Retrying a halted DM turn: when it is safe, where the turn re-enters the
// bounded call loop, and repairing a conversation that stopped mid tool loop.
import assert from "node:assert/strict";
import {
  assistantTextOf,
  carriedDirectorBlock,
  checkRetryEligible,
  danglingToolCallIds,
  promptOutgrown,
  retryCallIndex,
  rewindHaltedCall,
} from "../src/lib/dm/retry-turn-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const failedTurn = { id: "t1", campaignId: "c1", status: "failed", callIndex: 2 };
function eligibility(overrides = {}) {
  return checkRetryEligible({
    campaignId: "c1",
    campaignActive: true,
    turn: failedTurn,
    latestTurnId: "t1",
    openPendingRollCount: 0,
    ...overrides,
  });
}

test("a failed turn that is still the latest one may be retried", () => {
  assert.deepEqual(eligibility(), { ok: true });
});

test("an unknown turn is a 404", () => {
  const result = eligibility({ turn: null });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("a turn from another campaign is a 404, not someone else's retry", () => {
  const result = eligibility({ turn: { ...failedTurn, campaignId: "c2" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("an inactive campaign refuses", () => {
  const result = eligibility({ campaignActive: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("a turn that already succeeded is never retried", () => {
  const result = eligibility({ turn: { ...failedTurn, status: "done" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /already finished/);
});

test("a running turn refuses, which is also the two-players-at-once case", () => {
  const result = eligibility({ turn: { ...failedTurn, status: "running" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /already working/);
});

test("a parked turn points at the dice instead", () => {
  const result = eligibility({ turn: { ...failedTurn, status: "awaiting_rolls" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /waiting on dice/);
});

test("a failed turn with dice still out points at the dice too", () => {
  const result = eligibility({ openPendingRollCount: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /waiting on dice/);
});

test("a turn the story moved past refuses", () => {
  const result = eligibility({ latestTurnId: "t2" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /moved on/);
});

test("no turns recorded at all still allows the retry", () => {
  // Defensive: latestTurnId is null only if the turn row vanished mid-request.
  assert.deepEqual(eligibility({ latestTurnId: null }), { ok: true });
});

test("call index resumes where the turn stopped", () => {
  assert.equal(retryCallIndex(0, 4), 0);
  assert.equal(retryCallIndex(2, 4), 2);
});

test("an exhausted budget resumes at the forced-narration call", () => {
  assert.equal(retryCallIndex(4, 4), 3);
  assert.equal(retryCallIndex(9, 4), 3);
});

test("nonsense call indexes clamp instead of looping forever", () => {
  assert.equal(retryCallIndex(-1, 4), 0);
  assert.equal(retryCallIndex(Number.NaN, 4), 0);
  assert.equal(retryCallIndex(2.7, 4), 2);
  assert.equal(retryCallIndex(3, 1), 0);
});

test("a fully answered conversation has nothing dangling", () => {
  const dangling = danglingToolCallIds([
    { role: "system", content: "rules" },
    { role: "user", content: "I open the door." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1" }, { id: "call_2" }],
    },
    { role: "tool", tool_call_id: "call_1", content: "{}" },
    { role: "tool", tool_call_id: "call_2", content: "{}" },
  ]);
  assert.deepEqual(dangling, []);
});

test("a turn that threw partway leaves its unanswered calls, in order", () => {
  const dangling = danglingToolCallIds([
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1" }, { id: "call_2" }, { id: "call_3" }],
    },
    { role: "tool", tool_call_id: "call_2", content: "{}" },
  ]);
  assert.deepEqual(dangling, ["call_1", "call_3"]);
});

test("tool calls without ids are invisible to the repair", () => {
  const dangling = danglingToolCallIds([
    { role: "assistant", content: "", tool_calls: [{ function: { name: "request_roll" } }] },
  ]);
  assert.deepEqual(dangling, []);
});

test("an id asked for twice is only repaired once", () => {
  const dangling = danglingToolCallIds([
    { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
    { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
  ]);
  assert.deepEqual(dangling, ["call_1"]);
});

test("malformed conversations do not throw", () => {
  assert.deepEqual(danglingToolCallIds([]), []);
  assert.deepEqual(danglingToolCallIds([null, undefined]), []);
  assert.deepEqual(
    danglingToolCallIds([{ role: "assistant", content: "", tool_calls: "not an array" }]),
    [],
  );
});

test("narration the conversation never echoed is dropped, with its call", () => {
  // The crash landed after the model wrote a paragraph and before turn.ts
  // echoed that call, so the retried model cannot see the paragraph.
  const rewind = rewindHaltedCall({
    narrationParts: ["The door groans open on a cold stairwell."],
    callIndex: 1,
    assistantText: "",
  });
  assert.equal(rewind.rewound, true);
  assert.deepEqual(rewind.narrationParts, []);
  assert.equal(rewind.callIndex, 0);
});

test("narration the conversation does echo is kept", () => {
  const rewind = rewindHaltedCall({
    narrationParts: ["Torches gutter in the draft."],
    callIndex: 2,
    assistantText: "  Torches gutter in the draft.\n\nI will ask for a roll.  ",
  });
  assert.equal(rewind.rewound, false);
  assert.deepEqual(rewind.narrationParts, ["Torches gutter in the draft."]);
  assert.equal(rewind.callIndex, 2);
});

test("narration with an aside cut from its opening still matches its echo", () => {
  // The aside ("I'll set the hour first.") stands in the echo but not in the
  // kept narration, so the kept text's first 48 characters never occur there
  // as written; its first sentence does.
  const rewind = rewindHaltedCall({
    narrationParts: ["Fog rolls in. The ferry bell rings twice across the black water."],
    callIndex: 2,
    assistantText: "Fog rolls in. I'll set the hour first. The ferry bell rings twice across the black water.",
  });
  assert.equal(rewind.rewound, false);
  assert.equal(rewind.callIndex, 2);
});

test("only the trailing part is ever in question", () => {
  const rewind = rewindHaltedCall({
    narrationParts: ["Echoed beat.", "Lost beat."],
    callIndex: 3,
    assistantText: "Echoed beat.",
  });
  assert.deepEqual(rewind.narrationParts, ["Echoed beat."]);
  assert.equal(rewind.callIndex, 2);
});

test("a turn that never narrated rewinds nothing", () => {
  const rewind = rewindHaltedCall({ narrationParts: [], callIndex: 1, assistantText: "" });
  assert.equal(rewind.rewound, false);
  assert.equal(rewind.callIndex, 1);
});

test("the call index never goes below zero", () => {
  const rewind = rewindHaltedCall({ narrationParts: ["x"], callIndex: 0, assistantText: "" });
  assert.equal(rewind.callIndex, 0);
});

test("assistant text collects only assistant prose", () => {
  const text = assistantTextOf([
    { role: "system", content: "rules" },
    { role: "assistant", content: "First." },
    { role: "tool", tool_call_id: "call_1", content: "{}" },
    { role: "assistant", content: "Second." },
    { role: "assistant", content: [{ type: "image_url" }] },
  ]);
  assert.equal(text, "First.\nSecond.");
});

// Issue #925: a prompt packed against the 16K stand-in while the narrator
// was down, replayed by Retry once the server was up at 64K.
const PROMPT = [
  { role: "system", content: "rules" },
  { role: "user", content: "state" },
  { role: "assistant", content: "An older narration the history rendered." },
  { role: "user", content: "[Kara | attempt] I try the crystal on the chains." },
];
function built(overrides = {}) {
  return {
    callIndex: 0,
    narrationParts: [],
    conversation: PROMPT,
    contextTrace: { window: { tokens: 16_384, assumed: true }, shape: { promptMessages: PROMPT.length } },
    ...overrides,
  };
}
const known = { tokens: 65_536, assumed: false };

test("a never-answered prompt built on a guess is rebuilt once the window is known", () => {
  assert.equal(promptOutgrown(built(), known), true);
  // The history renders past GM lines as assistant messages: only what comes
  // after the prompt counts as the turn having happened.
  assert.equal(promptOutgrown(built({ conversation: [...PROMPT, { role: "user", content: "[System] Your last attempt..." }] }), known), true, "a retry note is not an answer");
});

test("a known window that has grown rebuilds too; one that has not, or a guess, replays", () => {
  const sixteen = { window: { tokens: 16_384, assumed: false }, shape: { promptMessages: PROMPT.length } };
  assert.equal(promptOutgrown(built({ contextTrace: sixteen }), known), true, "16K known, now 64K");
  assert.equal(promptOutgrown(built({ contextTrace: sixteen }), { tokens: 16_384, assumed: false }), false, "the same window");
  assert.equal(promptOutgrown(built(), { tokens: 16_384, assumed: true }), false, "still only a guess: nothing better to build on");
  assert.equal(promptOutgrown(built({ contextTrace: { ...sixteen, window: { tokens: 65_536, assumed: false } } }), { tokens: 32_768, assumed: false }), false, "a window that shrank is fitted per call");
});

test("a turn that already happened in any part is replayed, never rebuilt", () => {
  assert.equal(promptOutgrown(built({ callIndex: 1 }), known), false, "a call the model answered");
  assert.equal(promptOutgrown(built({ narrationParts: ["The chains hum."] }), known), false, "narration banked");
  const call = { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "roll_check", arguments: "{}" } }] };
  assert.equal(promptOutgrown(built({ conversation: [...PROMPT, call] }), known), false, "an assistant message past the prompt");
  assert.equal(promptOutgrown(built({ conversation: [...PROMPT, { role: "tool", tool_call_id: "c1", content: "{}" }] }), known), false, "a tool result past the prompt");
});

test("a row from before the window was kept is replayed as before", () => {
  assert.equal(promptOutgrown(built({ contextTrace: { shape: { promptMessages: PROMPT.length } } }), known), false);
  assert.equal(promptOutgrown(built({ contextTrace: null }), known), false);
  assert.equal(promptOutgrown(built({ contextTrace: { window: { tokens: 16_384, assumed: true } } }), known), false, "no shape: the prompt's end is unknown");
});

test("the director's steer a rebuilt prompt carries is its last message, only when one rode", () => {
  const steer = "[Director] Make the sage speak first.";
  const withSteer = [...PROMPT, { role: "user", content: steer }];
  assert.equal(
    carriedDirectorBlock({ conversation: withSteer, contextTrace: { blocks: [{ id: "director" }], shape: { promptMessages: withSteer.length } } }),
    steer,
  );
  assert.equal(carriedDirectorBlock({ conversation: PROMPT, contextTrace: { blocks: [{ id: "history" }], shape: { promptMessages: PROMPT.length } } }), undefined);
  assert.equal(carriedDirectorBlock({ conversation: PROMPT, contextTrace: null }), undefined);
});

console.log(`${passed} retry turn tests passed`);
