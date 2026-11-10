// Sweep, modelio (2): every reader of a backend's error text that triggers a
// fallback, probed with what real backends answer for OTHER causes.
//
// 0.32.0 to 0.33.0: a chat template threw on one tool's schema, the 500 said
// "Function is not a bool value", toolsUnsupportedByServer matched "function"
// and every turn was retried without tools, in silence (#861). The fix named
// that one text. This suite keeps a corpus of refusals, each with the cause
// its backend means, and asks every classifier of every row:
//
//   toolsUnsupportedByServer   true only when the server has no function
//                              calling (the one case the retry without tools
//                              is for)
//   contextOverflowWindow      a number only when the request was too big for
//                              the window
//   unsupportedParamFromError  the body field a strict backend refused, when
//                              it is one the client may drop
//   rolesMustAlternate         only the template's own complaint
//
// and, for the rows where a classifier is wrong in the harmful direction,
// plays a whole GM turn against a backend that answers that refusal once: the
// turn must not finish on a call that carried no tools.
//
// The corpus is the registry here: a new backend's refusal is one more row.
// Each row says where its text comes from; texts are the backends' own
// wording, with ids and counts filled in.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { failure, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-modelio-errors");
const { toolsUnsupportedByServer, unsupportedParamFromError } = await import("../src/lib/dm/sampling-logic.ts");
const { contextOverflowWindow } = await import("../src/lib/model-client.ts");
const { rolesMustAlternate } = await import("../src/lib/chat-roles-logic.ts");

const json = (value) => JSON.stringify(value);
const oai = (message, extra = {}) => json({ error: { message, type: "invalid_request_error", param: null, code: null, ...extra } });

// cause: "no-tools" | "overflow" | "param:<field>" | "roles" | "other".
// e2e: play a turn against this refusal (only where the retry it triggers
// can succeed and change what the table gets).
const CORPUS = [
  // ---- the server really has no function calling ----
  { id: "ollama-no-tools", status: 400, cause: "no-tools", source: "Ollama's OpenAI endpoint, a model without tool support", body: oai("registry.ollama.ai/library/gemma3:12b does not support tools", { type: "api_error" }) },
  { id: "openrouter-no-tool-endpoints", status: 404, cause: "no-tools", source: "OpenRouter, no provider of the model takes tools", body: json({ error: { message: "No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing", code: 404 } }) },
  { id: "llamacpp-no-jinja", status: 500, cause: "no-tools", source: "llama-server started without --jinja", body: json({ error: { code: 500, message: "tools param requires --jinja flag", type: "server_error" } }) },
  { id: "vllm-no-tool-parser", status: 400, cause: "no-tools", source: "vLLM started without a tool-call parser", body: json({ object: "error", message: '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', type: "BadRequestError", param: null, code: 400 }) },

  // ---- the server has tools; something else went wrong, in words that hold "tool" or "function" ----
  {
    id: "groq-tool-use-failed", status: 400, cause: "other", e2e: true,
    source: "Groq, the model wrote a malformed call (code tool_use_failed); a fresh call usually succeeds",
    body: json({ error: { message: "Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details.", type: "invalid_request_error", code: "tool_use_failed", failed_generation: '<function=request_roll>{"characterId": "abc", "kind": "check"' } }),
  },
  {
    id: "description-too-long", status: 400, cause: "other", e2e: true,
    source: "OpenAI's validation of a function description, as an OpenAI-compatible host repeats it (Azure OpenAI, proxies): the text more_tools draws on a compact table",
    body: oai("Invalid 'tools[26].function.description': string too long. Expected a string with maximum length 1024, but got a string with length 1247 instead.", { param: "tools[26].function.description", code: "string_above_max_length" }),
  },
  {
    id: "gemini-unknown-schema-key", status: 400, cause: "other", e2e: true,
    source: "Gemini's API refusing a JSON Schema key it does not know in a tool's parameters",
    body: json({ error: { code: 400, message: "Invalid JSON payload received. Unknown name \"additionalProperties\" at 'tools[0].function_declarations[17].parameters.properties[9].value.items': Cannot find field.", status: "INVALID_ARGUMENT" } }),
  },
  {
    id: "gemini-call-order", status: 400, cause: "other",
    source: "Gemini, the history's call and result turns are out of the order it takes",
    body: json({ error: { code: 400, message: "Please ensure that function call turn comes immediately after a user turn or after a function response turn.", status: "INVALID_ARGUMENT" } }),
  },
  {
    id: "openai-unanswered-tool-call", status: 400, cause: "other",
    source: "OpenAI's validation of the messages, as OpenAI-compatible hosts repeat it: a call in the history has no result",
    body: oai("An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: call_Ab12Cd34", { param: "messages.[5].role" }),
  },
  {
    id: "openai-orphan-tool-message", status: 400, cause: "other",
    source: "OpenAI's validation of the messages: a tool result with no call before it (the misspelling is OpenAI's)",
    body: oai("Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.", { param: "messages.[3].role" }),
  },
  {
    id: "mistral-tool-call-id", status: 400, cause: "other",
    source: "Mistral's API, which takes tool call ids of nine letters and digits only",
    body: json({ object: "error", message: "Tool call id was call_request_roll_17 but must be a-z, A-Z, 0-9, with a length of 9.", type: "invalid_request_error", param: null, code: null }),
  },
  {
    id: "anthropic-tool-use-without-result", status: 400, cause: "other",
    source: "Anthropic's API (OpenAI-compatible endpoint), a call in the history has no result",
    body: json({ type: "error", error: { type: "invalid_request_error", message: "messages.4: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01A09q90qw90lq917835lq9. Each `tool_use` block must have a corresponding `tool_result` block in the next message." } }),
  },
  {
    id: "llamacpp-bad-call-in-history", status: 500, cause: "other",
    source: "llama-server, an earlier call's arguments in the history do not parse",
    body: json({ error: { code: 500, message: "Failed to parse tool call arguments as JSON: [json.exception.parse_error.101] parse error at line 1, column 38: syntax error while parsing value - unexpected end of input; expected '\"'", type: "server_error" } }),
  },
  {
    id: "model-not-supported", status: 400, cause: "other",
    source: "a host answering for a model it does not serve (GitHub Models' wording)",
    body: json({ error: { code: "model_not_supported", message: "The requested model is not supported." } }),
  },

  // ---- unrelated refusals: every classifier answers no ----
  { id: "openai-bad-key", status: 401, cause: "other", source: "OpenAI's wording for a wrong key", body: oai("Incorrect API key provided: sk-abc***********xyz. You can find your API key at https://platform.openai.com/account/api-keys.", { code: "invalid_api_key" }) },
  { id: "openai-rate-limit", status: 429, cause: "other", source: "OpenAI's tokens-per-minute limit", body: oai("Rate limit reached for gpt-4o in organization org-abc on tokens per min (TPM): Limit 30000, Used 21000, Requested 12000. Please try again in 6s. Visit https://platform.openai.com/account/rate-limits to learn more.", { type: "tokens", code: "rate_limit_exceeded" }) },
  { id: "openrouter-free-limit", status: 429, cause: "other", source: "OpenRouter's daily limit on free models", body: json({ error: { message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", code: 429 } }) },
  { id: "llamacpp-loading", status: 503, cause: "other", source: "llama-server while the model loads", body: json({ error: { code: 503, message: "Loading model", type: "unavailable_error" } }) },
  { id: "anthropic-rate-limit", status: 429, cause: "other", source: "Anthropic's input-token rate limit", body: json({ type: "error", error: { type: "rate_limit_error", message: "This request would exceed the rate limit for your organization of 30,000 input tokens per minute. For details, refer to: https://docs.anthropic.com/en/api/rate-limits." } }) },
  { id: "azure-content-filter", status: 400, cause: "other", source: "Azure OpenAI's content filter", body: oai("The response was filtered due to the prompt triggering Azure OpenAI's content management policy. Please modify your prompt and retry.", { code: "content_filter" }) },

  // ---- the request was larger than the window ----
  { id: "llamacpp-overflow", status: 400, cause: "overflow", window: 16384, source: "llama-server", body: json({ error: { code: 400, message: "request (18210 tokens) exceeds the available context size (16384 tokens), try increasing it", type: "exceed_context_size_error", n_prompt_tokens: 18210, n_ctx: 16384 } }) },
  { id: "openai-overflow", status: 400, cause: "overflow", window: 8192, source: "OpenAI and the servers that copy its wording (vLLM, DeepSeek)", body: oai("This model's maximum context length is 8192 tokens. However, your messages resulted in 9120 tokens. Please reduce the length of the messages.", { param: "messages", code: "context_length_exceeded" }) },
  { id: "openrouter-overflow", status: 400, cause: "overflow", window: 131072, source: "OpenRouter", body: json({ error: { message: "This endpoint's maximum context length is 131072 tokens. However, you requested about 140211 tokens (135115 of text input, 5096 in the output). Please reduce the length of either one, or use the \"middle-out\" transform to compress your prompt automatically.", code: 400 } }) },
  { id: "anthropic-overflow", status: 400, cause: "overflow", source: "Anthropic", body: json({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 210532 tokens > 200000 maximum" } }) },
  { id: "groq-overflow", status: 400, cause: "overflow", source: "Groq", body: oai("Please reduce the length of the messages or completion.", { param: "messages", code: "context_length_exceeded" }) },
  { id: "mistral-overflow", status: 400, cause: "overflow", source: "Mistral", body: json({ object: "error", message: "Prompt contains 40960 tokens and 0 draft tokens, too large for model with 32768 maximum context length", type: "invalid_request_error", param: null, code: null }) },
  {
    id: "lmstudio-overflow", status: 400, cause: "overflow",
    source: "LM Studio (the wording, slip included, is LM Studio's)",
    body: json({ error: "Trying to keep the first 5210 tokens when context the overflows. However, the model is loaded with context length of only 4096 tokens, which is not enough. Try to load the model with a larger context length, or provide a shorter input" }),
  },
  {
    id: "gemini-overflow", status: 400, cause: "overflow",
    source: "Gemini",
    body: json({ error: { code: 400, message: "The input token count (1250112) exceeds the maximum number of tokens allowed (1048575).", status: "INVALID_ARGUMENT" } }),
  },
  {
    id: "xai-overflow", status: 400, cause: "overflow",
    source: "xAI",
    body: json({ code: "Client specified an invalid argument", error: "This model's maximum prompt length is 131072 but the request contains 150322 tokens." }),
  },
  {
    id: "tgi-overflow", status: 422, cause: "overflow",
    source: "Hugging Face text-generation-inference and the hosts built on it",
    body: json({ error: "Input validation error: `inputs` tokens + `max_new_tokens` must be <= 8193. Given: 8000 `inputs` tokens and 1024 `max_new_tokens`", error_type: "validation" }),
  },

  // ---- a strict backend refused one body field ----
  { id: "openai-unsupported-parameter", status: 400, cause: "param:max_tokens", source: "OpenAI, a reasoning model", body: oai("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", { param: "max_tokens", code: "unsupported_parameter" }) },
  { id: "venice-zod-unrecognized", status: 400, cause: "param:chat_template_kwargs", source: "Venice (zod), the case PR #623 added", body: json({ error: "Invalid request", issues: [{ code: "unrecognized_keys", keys: ["chat_template_kwargs"], path: [], message: "Unrecognized key(s) in object: 'chat_template_kwargs'" }] }) },
  {
    id: "pydantic-extra-forbidden", status: 422, cause: "param:chat_template_kwargs",
    source: "a backend that validates its body with pydantic and forbids extra fields (Mistral's API; FastAPI servers): the field every non-OpenAI host is sent",
    body: json({ object: "error", message: { detail: [{ type: "extra_forbidden", loc: ["body", "chat_template_kwargs"], msg: "Extra inputs are not permitted", input: { enable_thinking: false } }] }, type: "invalid_request_error", param: null, code: null }),
  },
  {
    id: "fastapi-extra-forbidden", status: 422, cause: "param:top_k",
    source: "the same refusal as FastAPI writes it bare",
    body: json({ detail: [{ type: "extra_forbidden", loc: ["body", "top_k"], msg: "Extra inputs are not permitted", input: 40 }] }),
  },
  {
    id: "gemini-unknown-body-field", status: 400, cause: "param:presence_penalty",
    source: "Gemini's OpenAI-compatible endpoint refusing a body field it does not know",
    body: json({ error: { code: 400, message: "Invalid JSON payload received. Unknown name \"presence_penalty\": Cannot find field.", status: "INVALID_ARGUMENT" } }),
  },

  // ---- the chat template takes user and assistant in turn ----
  { id: "llamacpp-roles-alternate", status: 500, cause: "roles", source: "llama-server, Mistral's and Gemma 3's templates", body: json({ error: { code: 500, message: "Conversation roles must alternate user/assistant/user/assistant/...", type: "server_error" } }) },
];

// What fails today, by row id (`<classifier>:<corpus id>`).
const READS_TOOLS_OFF = (text) => ({
  rule: "The retry without tools is for a server with no function calling and nothing else (src/lib/dm/sampling-logic.ts toolsUnsupportedByServer: 'the one case the retry without tools in model-client.ts is for').",
  where: "src/lib/dm/sampling-logic.ts toolsUnsupportedByServer (/tool|function|not support/i over any error body, at any status)",
  severity: "medium",
  note: text,
});
const MISSES_OVERFLOW = (who) => ({
  rule: "A request bigger than the server's window is answered as the fitter's own capacity refusal, so the caller can refit once and the table reads what to change rather than a bare 400 (src/lib/model-client.ts).",
  where: "src/lib/model-client.ts contextOverflowWindow",
  severity: "low",
  note: `${who}'s wording for an overflow is not recognised: the turn fails with "Backend request failed" and the window is never learned.`,
});
const MISSES_PARAM = (who) => ({
  rule: "A strict backend that rejects one named body field has that field dropped and the call retried, 'so a model family ODM has never heard of still runs instead of costing the table its turn' (src/lib/model-client.ts).",
  where: "src/lib/dm/sampling-logic.ts unsupportedParamFromError (reads OpenAI's error.param, zod's unrecognized_keys and six message patterns)",
  severity: "medium",
  note: `${who}: the refusal names the field and it is one the client may drop, but the reader returns null, so every call to that host fails.`,
});
const KNOWN = {
  "tools-off:llamacpp-no-jinja": {
    rule: "A server with no function calling is retried without tools (docs/text-backends.md: '--jinja enables tool calling'; llama-server without it answers 'tools param requires --jinja flag', tools/server/server-common.cpp).",
    where: "src/lib/dm/sampling-logic.ts toolsUnsupportedByServer (the /While executing|jinja/ exclusion added for #861 also matches the flag's name)",
    severity: "low",
    note: "The #861 exclusion for template errors reads the word jinja anywhere, so the one llama-server refusal that does mean 'no tools' is now a failed turn. Failing loudly may be the better answer here; recorded because the reader's own contract says otherwise and no test names this text.",
  },
  "tools-off:groq-tool-use-failed": READS_TOOLS_OFF("Groq's tool_use_failed (the model wrote one bad call) is read as 'no function calling'."),
  "tools-off:description-too-long": READS_TOOLS_OFF("A host refusing one tool's description length is read as 'no function calling'."),
  "tools-off:gemini-unknown-schema-key": READS_TOOLS_OFF("Gemini refusing a schema key is read as 'no function calling'."),
  "tools-off:gemini-call-order": READS_TOOLS_OFF("A refusal about the order of the history's turns is read as 'no function calling'."),
  "tools-off:openai-unanswered-tool-call": READS_TOOLS_OFF("A history with an unanswered call is read as 'no function calling'."),
  "tools-off:openai-orphan-tool-message": READS_TOOLS_OFF("A history with an orphan tool result is read as 'no function calling'."),
  "tools-off:mistral-tool-call-id": READS_TOOLS_OFF("Mistral's rule on call ids is read as 'no function calling'."),
  "tools-off:anthropic-tool-use-without-result": READS_TOOLS_OFF("Anthropic's unanswered tool_use is read as 'no function calling'."),
  "tools-off:llamacpp-bad-call-in-history": READS_TOOLS_OFF("llama-server failing to parse an earlier call is read as 'no function calling'."),
  "tools-off:model-not-supported": { ...READS_TOOLS_OFF("'The requested model is not supported' holds 'not support': the call is sent again without tools and fails the same way."), severity: "low" },
  "overflow:lmstudio-overflow": MISSES_OVERFLOW("LM Studio"),
  "overflow:gemini-overflow": MISSES_OVERFLOW("Gemini"),
  "overflow:xai-overflow": MISSES_OVERFLOW("xAI"),
  "overflow:tgi-overflow": MISSES_OVERFLOW("text-generation-inference"),
  "param:pydantic-extra-forbidden": MISSES_PARAM("pydantic's extra_forbidden as Mistral's API returns it, for chat_template_kwargs, which every host that is not OpenAI is sent"),
  "param:fastapi-extra-forbidden": MISSES_PARAM("pydantic's extra_forbidden as FastAPI returns it"),
  "param:gemini-unknown-body-field": { ...MISSES_PARAM("Gemini's 'Unknown name' for a body field"), severity: "low" },
  "e2e:groq-tool-use-failed": {
    rule: "A turn whose backend has function calling never finishes on a call that carried no tools: 'a retry without tools would turn [it] into a narrator running with no request_roll and no engines, in silence. Such a turn fails loudly instead' (src/lib/dm/sampling-logic.ts).",
    where: "src/lib/model-client.ts requestCustomMessage (the retry without tools, logged by console.warn only) and src/lib/dm/sampling-logic.ts toolsUnsupportedByServer",
    severity: "high",
    note: "Groq's tool_use_failed once: the same call goes out again with no tools, the reply is prose, the turn is stored as done and nothing on the table or the turn says tools were off.",
  },
  "e2e:description-too-long": {
    rule: "A turn whose backend has function calling never finishes on a call that carried no tools.",
    where: "src/lib/model-client.ts requestCustomMessage; src/lib/dm/sampling-logic.ts toolsUnsupportedByServer; src/lib/dm/tool-profiles.ts moreToolsTool (the 1,247-character description that draws this refusal)",
    severity: "high",
    note: "With the compact profile's more_tools over 1,024 characters, a host that enforces OpenAI's cap answers this on every call, and every turn runs with no tools.",
  },
  "e2e:gemini-unknown-schema-key": {
    rule: "A turn whose backend has function calling never finishes on a call that carried no tools.",
    where: "src/lib/model-client.ts requestCustomMessage; src/lib/dm/sampling-logic.ts toolsUnsupportedByServer",
    severity: "high",
    note: "A provider that refuses one schema keyword answers this on every call: the #861 failure again, from a different text.",
  },
};

const SKIP = {};

async function row(id, fn) {
  if (SKIP[id]) return;
  if (KNOWN[id]) await gap(id, KNOWN[id], fn);
  else await test(id, fn);
}

let rows = 0;
for (const entry of CORPUS) {
  const paramWanted = entry.cause.startsWith("param:") ? entry.cause.slice(6) : null;
  // Checked in the order model-client.ts asks them: the window, then the
  // field, then the tools. A row is asked every classifier; the ones before
  // its own cause must answer no, and its own must answer yes.
  rows += 1;
  await row(`overflow:${entry.id}`, () => {
    const got = contextOverflowWindow(entry.body);
    if (entry.cause === "overflow") {
      assert.notEqual(got, null, `${entry.source}: an overflow read as something else: ${entry.body.slice(0, 160)}`);
      if (entry.window) assert.equal(got, entry.window, `${entry.source}: the window it names`);
    } else {
      assert.equal(got, null, `${entry.source}: read as a context overflow`);
    }
  });
  rows += 1;
  await row(`param:${entry.id}`, () => {
    const got = unsupportedParamFromError(entry.body);
    assert.equal(got, paramWanted, `${entry.source}: the field to drop`);
  });
  rows += 1;
  await row(`tools-off:${entry.id}`, () => {
    // A refusal an earlier reader takes never reaches this one.
    if (entry.cause === "overflow" || paramWanted) {
      return;
    }
    const got = toolsUnsupportedByServer("local", entry.body);
    assert.equal(got, entry.cause === "no-tools", `${entry.source}: ${got ? "read as a server with no function calling" : "not read as a server with no function calling"}: ${entry.body.slice(0, 200)}`);
  });
  rows += 1;
  await row(`roles:${entry.id}`, () => {
    assert.equal(rolesMustAlternate(entry.body), entry.cause === "roles", entry.source);
  });
  rows += 1;
  await row(`openai-host:${entry.id}`, () => {
    assert.equal(toolsUnsupportedByServer("openai", entry.body), false, "OpenAI implements tools on every chat model");
  });
}

// ---- a whole turn against the refusal ---------------------------------------

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const hero = world.addHero({ name: "Kara", class: "fighter", level: 3 });
const model = await fakeModel();
model.pointAt(world);
const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");

for (const entry of CORPUS.filter((item) => item.e2e)) {
  rows += 1;
  const message = JSON.parse(entry.body).error.message;
  model.script([failure(entry.status, message), reply({ text: "Kara pushes the door and it swings wide onto a dark hall." })]);
  const stored = await model.turn(world, "I push the door open and look inside.", hero.id, hero.userId);
  const turn = getDmTurn(getLatestDmTurnId(world.campaignId));
  const calls = model.requests.map((body) => (Array.isArray(body.tools) ? body.tools.length : 0));
  await row(`e2e:${entry.id}`, () => {
    assert.ok(calls.length >= 1 && calls[0] > 0, `the first call carried tools (${calls})`);
    const bare = calls.slice(1).some((count) => count === 0);
    assert.ok(
      !(bare && turn?.status === "done" && stored),
      `${entry.source}: the backend refused once, the call went out again with no tools (${calls.join(", ")} tools per call), and the turn was stored as "${turn?.status}" with the narration "${String(stored?.content ?? "").slice(0, 60)}": nothing on the turn says its tools were off`,
    );
  });
}
model.close();

console.log(`  rows: ${rows} (${CORPUS.length} refusals x 5 readers, ${CORPUS.filter((item) => item.e2e).length} whole turns); skipped ${Object.keys(SKIP).length}`);
world.close();
finish();
