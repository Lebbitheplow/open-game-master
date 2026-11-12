// Reading a context window out of /props. The fixtures below are the actual
// responses from a llama.cpp --models-preset router (llama-server 8001,
// qwen3.6-35b launched with c = 65536), because this parsing fails silently:
// a miss looks like an under-budgeted prompt, never an error.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  buildPropsUrl,
  contextCacheKey,
  knownContextWindow,
  normalizeBaseUrl,
  OPENAI_CONTEXT_TOKENS,
  paramsFromModelName,
  probeMissUnreachable,
  readContextWindow,
  readModelParams,
  readRememberedWindows,
  rememberWindow,
  REMEMBERED_WINDOWS_MAX,
} from "../src/lib/dm/context-probe-logic.ts";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

// Captured live from /props?model=qwen3.6-35b
const ROUTER_WITH_MODEL = { default_generation_settings: { n_ctx: 65536 } };
// Captured live from a bare /props on the same router
const ROUTER_BARE = { default_generation_settings: { n_ctx: 0 } };
// Single-model llama.cpp builds report it at the top level.
const SINGLE_MODEL = { n_ctx: 32768, default_generation_settings: { n_ctx: 32768 } };

check("the real router response yields the launch -c", () => {
  assert.equal(readContextWindow(ROUTER_WITH_MODEL), 65536);
});

check("a bare router response is a miss, not a window of zero", () => {
  // This is the trap: the router answers 200 with n_ctx 0 for itself. Reading
  // that as a real value would budget a prompt at zero tokens.
  assert.equal(readContextWindow(ROUTER_BARE), null);
});

check("a top-level n_ctx is read too", () => {
  assert.equal(readContextWindow(SINGLE_MODEL), 32768);
  assert.equal(readContextWindow({ n_ctx: 8192 }), 8192);
});

check("junk and absence both resolve to a miss", () => {
  assert.equal(readContextWindow(null), null);
  assert.equal(readContextWindow(undefined), null);
  assert.equal(readContextWindow({}), null);
  assert.equal(readContextWindow({ n_ctx: "65536" }), null, "a string is not a window");
  assert.equal(readContextWindow({ n_ctx: -1 }), null);
  assert.equal(readContextWindow({ n_ctx: Number.NaN }), null);
});

check("a fractional window is floored rather than passed through", () => {
  assert.equal(readContextWindow({ n_ctx: 4096.9 }), 4096);
});

check("the props url carries the model, which is what makes a router answer", () => {
  assert.equal(
    buildPropsUrl("http://127.0.0.1:8001/v1", "qwen3.6-35b"),
    "http://127.0.0.1:8001/props?model=qwen3.6-35b",
  );
});

check("the /v1 suffix and trailing slashes are stripped", () => {
  assert.equal(normalizeBaseUrl("http://x:8001/v1/"), "http://x:8001");
  assert.equal(normalizeBaseUrl("http://x:8001///"), "http://x:8001");
  assert.equal(normalizeBaseUrl("  http://x:8001  "), "http://x:8001");
  assert.equal(normalizeBaseUrl(""), "");
});

check("model ids are url-encoded", () => {
  assert.match(buildPropsUrl("http://x:8001", "a b/c"), /model=a%20b%2Fc/);
});

check("no base url means no request to make", () => {
  assert.equal(buildPropsUrl("", "m"), "");
});

check("the cache key separates models sharing one port", () => {
  // --models-max 1 means several models share a base URL, each with its own
  // -c; caching on base URL alone would hand one model's window to another.
  const a = contextCacheKey("http://127.0.0.1:8001/v1", "qwen3.6-35b");
  const b = contextCacheKey("http://127.0.0.1:8001/v1", "qwen3.6-27b");
  assert.notEqual(a, b);
  assert.equal(a, contextCacheKey("http://127.0.0.1:8001", "qwen3.6-35b"), "normalized");
});

check("OpenAI's shared floor is 128K; the catalog sizes anything smaller (scripts/test-model-registry.mjs)", () => {
  assert.equal(OPENAI_CONTEXT_TOKENS, 128_000);
});

// Captured live from /v1/models on a single-model llama-server (Qwen3.5 9B
// Q8_0, b1-ff5a233), trimmed to the fields read.
const LLAMA_MODELS = {
  object: "list",
  data: [
    {
      id: "qwen3.5-9b-q8",
      aliases: ["qwen3.5-9b-q8"],
      object: "model",
      owned_by: "llamacpp",
      meta: { vocab_type: 2, n_vocab: 248320, n_ctx: 81920, n_ctx_train: 262144, n_embd: 4096, n_params: 8953803264, size: 9516533760, ftype: "Q8_0" },
    },
  ],
};

check("the model's size comes from llama-server's /v1/models", () => {
  assert.equal(readModelParams(LLAMA_MODELS, "qwen3.5-9b-q8"), 8953803264);
  assert.equal(readModelParams(LLAMA_MODELS, ""), 8953803264, "no name: the only model listed");
  assert.equal(readModelParams(LLAMA_MODELS, "anything"), 8953803264, "a single-model server answers to any name");
  const router = { data: [{ id: "a", meta: { n_params: 9e9 } }, { id: "b", meta: { n_params: 35e9 } }, { id: "c" }] };
  assert.equal(readModelParams(router, "b"), 35e9, "a router: the entry named");
  assert.equal(readModelParams(router, "c"), null, "an unloaded model reports no size");
  assert.equal(readModelParams(router, "z"), null, "a name a router does not list is not guessed");
  assert.equal(readModelParams({ data: [{ id: "x" }] }, "x"), null, "vLLM, LM Studio: no meta");
  assert.equal(readModelParams(null, "x"), null);
  assert.equal(readModelParams({ data: [{ id: "x", meta: { n_params: "9e9" } }] }, "x"), null);
});

check("a name that states the size is read for it, the whole model's first", () => {
  assert.equal(paramsFromModelName("qwen3.5-9b-q8"), 9e9);
  assert.equal(paramsFromModelName("gemma4:12b-it-qat"), 12e9);
  assert.equal(paramsFromModelName("Qwen3-30B-A3B-Instruct"), 30e9);
  assert.equal(paramsFromModelName("llama3.1:8b"), 8e9);
  assert.equal(paramsFromModelName("phi-3.5-mini"), null);
  assert.equal(paramsFromModelName("gemma4:e4b-it-qat"), null, "an effective size is not the whole model");
  assert.equal(paramsFromModelName("mixtral-8x7b"), null);
  assert.equal(paramsFromModelName(""), null);
});

// Issue #925: the app's own llama-server was not listening yet when the
// first turn after an update probed it, and nothing remembered the 65,536
// it had reported before the restart.
check("a window learned in this process wins, else the saved one, else none", () => {
  assert.equal(knownContextWindow({ window: 32768 }, { window: 65536, at: 1 }), 32768);
  assert.equal(knownContextWindow({ window: 0 }, { window: 65536, at: 1 }), 65536, "a miss is not news of the window");
  assert.equal(knownContextWindow(undefined, { window: 65536, at: 1 }), 65536);
  assert.equal(knownContextWindow(undefined, undefined), null);
  assert.equal(knownContextWindow({ window: 0 }, { window: 0, at: 1 }), null);
});

check("the saved row is read defensively and written only when it changes", () => {
  assert.deepEqual(readRememberedWindows(null), {});
  assert.deepEqual(readRememberedWindows([1, 2]), {});
  assert.deepEqual(readRememberedWindows({ a: { window: 65536.5, at: 5 }, b: { window: "x", at: 1 }, c: null, d: { window: 0, at: 1 } }), { a: { window: 65536, at: 5 } });
  const one = rememberWindow({}, "k", 65536, 10);
  assert.deepEqual(one, { k: { window: 65536, at: 10 } });
  assert.equal(rememberWindow(one, "k", 65536, 20), null, "the same number again writes nothing");
  assert.deepEqual(rememberWindow(one, "k", 32768, 20), { k: { window: 32768, at: 20 } });
  assert.deepEqual(rememberWindow(one, "k", 0, 20), {}, "a window forgotten is taken out");
  assert.equal(rememberWindow({}, "k", 0, 20), null);
  let many = {};
  for (let index = 0; index < REMEMBERED_WINDOWS_MAX + 5; index += 1) {
    many = rememberWindow(many, `k${index}`, 4096, index);
  }
  assert.equal(Object.keys(many).length, REMEMBERED_WINDOWS_MAX);
  assert.ok(!many.k0 && many[`k${REMEMBERED_WINDOWS_MAX + 4}`], "the oldest go first");
});

check("only a server that is not up counts as unreachable", () => {
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  assert.equal(probeMissUnreachable({ error: refused }), true);
  assert.equal(probeMissUnreachable({ status: 503 }), true, "llama-server while it loads the model");
  assert.equal(probeMissUnreachable({ status: 404 }), false, "a server that is not llama.cpp answered");
  assert.equal(probeMissUnreachable({ status: 0 }), false, "a body that would not parse");
  assert.equal(probeMissUnreachable({ error: new DOMException("slow", "TimeoutError") }), false, "too slow is not down");
});

// The probe itself, against a server on this machine, with the database a
// restart keeps.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-context-probe-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
delete process.env.OPENAI_COMPAT_CONTEXT;
register("./lib/register-alias.mjs", import.meta.url);
const client = await import("../src/lib/model-client.ts");

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((resolve) => server.close(resolve)) };
}
const settingsAt = (url, model) => ({ textProvider: "custom", localTextModel: "", customBaseUrl: url, customModel: model });

try {
  {
    const server = await serve((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(request.url.startsWith("/props") ? JSON.stringify({ default_generation_settings: { n_ctx: 65536 } }) : "{}");
    });
    const settings = settingsAt(server.url, "qwen3.6-35b");
    assert.equal(await client.probeCustomContextWindow(server.url, "", "qwen3.6-35b"), 65536);
    // A restart: the process forgets, the server is not up yet.
    client.forgetContextWindows();
    await server.close();
    assert.equal(client.storyContextTokens(settings), 65536, "the saved window was forgotten with the process");
    assert.equal(client.storyWindowAssumed(settings), false);
    assert.equal(await client.probeCustomContextWindow(server.url, "", "qwen3.6-35b"), 65536, "a refused probe keeps the saved window");
    assert.equal(client.storyEndpointUnreachable(settings), true);
    assert.equal(client.storyContextTokens(settings), 65536);
    // A refusal that named no size forgets it everywhere, so the same number
    // is not packed against again after the next restart.
    client.learnContextWindow(server.url, "qwen3.6-35b", null);
    client.forgetContextWindows();
    assert.equal(client.storyContextTokens(settings), client.DEFAULT_CUSTOM_CONTEXT_TOKENS);
    passed += 1;
  }
  {
    const server = await serve(() => {});
    const url = server.url;
    await server.close();
    const settings = settingsAt(url, "never-seen");
    assert.equal(await client.probeCustomContextWindow(url, "", "never-seen"), null);
    assert.equal(client.storyEndpointUnreachable(settings), true, "nothing listening and nothing saved");
    assert.equal(client.storyWindowAssumed(settings), true);
    assert.equal(client.storyContextTokens(settings), client.DEFAULT_CUSTOM_CONTEXT_TOKENS);
    passed += 1;
  }
  {
    let status = 503;
    const server = await serve((request, response) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(status === 200 ? JSON.stringify({ n_ctx: 32768 }) : JSON.stringify({ error: { message: "Loading model" } }));
    });
    const settings = settingsAt(server.url, "loading");
    assert.equal(await client.probeCustomContextWindow(server.url, "", "loading"), null);
    assert.equal(client.storyEndpointUnreachable(settings), true, "a server still loading its model is not up");
    // Asked again at once, not two minutes later: the server is up now.
    status = 200;
    assert.equal(await client.probeCustomContextWindow(server.url, "", "loading"), 32768);
    assert.equal(client.storyEndpointUnreachable(settings), false);
    status = 404;
    client.forgetContextWindows();
    const other = settingsAt(server.url, "not-llama");
    assert.equal(await client.probeCustomContextWindow(server.url, "", "not-llama"), null);
    assert.equal(client.storyEndpointUnreachable(other), false, "a server that answered 404 is up, only not llama.cpp");
    await server.close();
    passed += 1;
  }
} finally {
  removeTempDir(dir);
}

console.log(`context-probe: ${passed} tests passed`);
