// Processing speed (issue 255): the admin's Fast setting reaches a direct
// OpenAI API call as service_tier "fast" for the role it was set for, never
// reaches any other server, records what the provider says ran, and falls
// back to standard speed (said so) when the provider refuses the tier. The
// agent programs get Fast through their own per-session switches.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-speed-tier-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const tier = await import("../src/lib/speed-tier.ts");
const { translate } = await import("../src/lib/messages-logic.ts");
// The refusal reasons are the dictionary's; the tests read them in English, the source.
const t = (key, vars) => translate("en", key, vars);
const { speedStatus } = await import("../src/lib/speed-status.ts");
const { requestCustomMessage } = await import("../src/lib/model-client.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { claudeArgs } = await import("../src/lib/harness/adapters/claude.ts");

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`ok: ${name}`);
};

// ---- the rules ----
assert.equal(typeof tier.openAiFastModel, "undefined", "no model is judged by its name");
for (const model of ["gpt-6.1-sol", "gpt-4.1", "my-finetune", "ft:gpt-6-sol:org::abc"]) {
  assert.equal(tier.apiSpeedEligibility(t, { endpointKind: "openai", model }).ok, true, model);
}
assert.equal(tier.apiSpeedEligibility(t, { endpointKind: "openai", model: "  " }).ok, false, "a model has to be named");
assert.equal(tier.apiSpeedEligibility(t, { endpointKind: "openrouter", model: "gpt-6.1-sol" }).ok, false);
assert.equal(tier.apiSpeedEligibility(t, { endpointKind: "local", model: "gpt-6.1-sol" }).ok, false);
ok("Fast is offered on OpenAI's API for any named model, and nowhere else");

const claudeModels = [{ id: "opus", fast: true }, { id: "sonnet" }];
assert.equal(tier.agentSpeedEligibility(t, { harnessId: "claude", model: "opus", models: claudeModels }).ok, true);
assert.equal(tier.agentSpeedEligibility(t, { harnessId: "claude", model: "sonnet", models: claudeModels }).ok, false, "listed without Fast");
assert.equal(tier.agentSpeedEligibility(t, { harnessId: "claude", model: "claude-opus-4-8", models: claudeModels }).ok, false, "not listed on this sign-in");
assert.equal(tier.agentSpeedEligibility(t, { harnessId: "claude", model: "", models: claudeModels }).ok, false, "the program's default may be any model");
assert.equal(tier.agentSpeedEligibility(t, { harnessId: "codex", model: "gpt-6.1-sol", models: [{ id: "gpt-6.1-sol", fast: true }] }).ok, true);
assert.equal(tier.agentSpeedEligibility(t, { harnessId: "codex", model: "gpt-6-mini", models: [{ id: "gpt-6-mini" }] }).ok, false);
assert.equal(tier.agentSpeedEligibility(t, { harnessId: "opencode", model: "anything", models: [] }).ok, false);
assert.equal(tier.effectiveSpeedWord("priority"), "fast");
assert.equal(tier.effectiveSpeedWord("default"), "standard");
assert.equal(tier.effectiveSpeedWord(""), null);
ok("the agent programs offer Fast only where their own switch exists");

const settings = JSON.parse(claudeArgs({ systemPromptPath: "/tmp/p", model: "claude-opus-5-5", effort: "", mcpConfigPath: null, fast: true })[claudeArgs({ systemPromptPath: "/tmp/p", model: "", effort: "", mcpConfigPath: null }).indexOf("--settings") + 1]);
assert.deepEqual(settings, { disableAllHooks: true, fastMode: true });
const plain = claudeArgs({ systemPromptPath: "/tmp/p", model: "claude-opus-5-5", effort: "", mcpConfigPath: null });
assert.deepEqual(JSON.parse(plain[plain.indexOf("--settings") + 1]), { disableAllHooks: true }, "the default sends nothing new");
ok("Claude Code is asked for fast mode in its session-only settings");

// ---- the requests ----
const seen = [];
let answerTier = "priority";
let refuseTier = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const { hostname, pathname } = new URL(String(url));
  const body = JSON.parse(init.body);
  seen.push({ host: hostname, path: pathname, body });
  if (refuseTier && body.service_tier) {
    return Response.json(
      { error: { message: "Unsupported parameter: 'service_tier' is not supported with this model.", param: "service_tier", code: "unsupported_parameter" } },
      { status: 400 },
    );
  }
  if (pathname.endsWith("/responses")) {
    return Response.json({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Fast reply." }] }], service_tier: body.service_tier ? answerTier : "default", usage: { input_tokens: 5, output_tokens: 2 } });
  }
  return Response.json({ choices: [{ message: { role: "assistant", content: "Fast reply." }, finish_reason: "stop" }], service_tier: body.service_tier ? answerTier : "default", usage: { prompt_tokens: 5, completion_tokens: 2 } });
};

const OPENAI = "https://api.openai.com/v1";
const call = (base, model, role) => requestCustomMessage(base, model, "sk-test", [{ role: "user", content: "hi" }], { role });
const last = () => seen.at(-1).body;

saveGlobalConfig({ text: { customBaseUrl: OPENAI, customModel: "gpt-6-sol", speed: "", utilityBaseUrl: OPENAI, utilityModel: "gpt-6-luna", utilitySpeed: "" } });
await call(OPENAI, "gpt-6-sol", "story");
assert.equal(last().service_tier, undefined, "provider default sends no tier");
ok("provider default leaves the payload as it was");

saveGlobalConfig({ text: { speed: "fast" } });
await call(OPENAI, "gpt-6-sol", "story");
assert.equal(last().service_tier, "fast");
assert.equal(speedStatus().story?.effective, "fast");
assert.equal(speedStatus().story?.reported, "priority");
await call(OPENAI, "gpt-6-luna", "utility");
assert.equal(last().service_tier, undefined, "the utility model has its own setting");
saveGlobalConfig({ text: { utilitySpeed: "fast" } });
await call(OPENAI, "gpt-6-luna", "utility");
assert.equal(last().service_tier, "fast");
ok("Fast reaches the story and the utility model each by its own setting");

await call("https://openrouter.ai/api/v1", "openai/gpt-6-sol", "story");
assert.equal(last().service_tier, undefined, "OpenRouter never sees the field");
await call("http://127.0.0.1:8001/v1", "gpt-6-sol", "story");
assert.equal(last().service_tier, undefined, "a local server never sees the field");
await call("https://api.openai.com/v1/", "gpt-6-sol", "story");
ok("no other server is sent the tier");

answerTier = "default";
await call(OPENAI, "gpt-6-sol", "story");
assert.equal(speedStatus().story?.effective, "standard", "a downgrade is never shown as Fast");
ok("a call the provider ran at standard speed is recorded as standard");

refuseTier = true;
answerTier = "priority";
const before = seen.length;
// A model without the tier: the provider's own 400 is what tells, never a
// list of names (one kept here said gpt-4.1 had none; OpenAI runs it at
// "priority").
const refused = await call(OPENAI, "a-model-without-fast", "story");
assert.equal(refused.message?.content, "Fast reply.", "the turn still answered");
const [first, retry] = seen.slice(before);
assert.equal(first.body.service_tier, "fast");
assert.equal(retry.body.service_tier, undefined, "the retry went out at standard speed");
assert.match(speedStatus().story?.refused ?? "", /refused the Fast tier/);
assert.equal(speedStatus().story?.effective, "standard");
ok("a refused Fast tier falls back to standard speed, and the panel says so");

globalThis.fetch = realFetch;
removeTempDir(dir);
console.log(`test-speed-tier: ${passed} passed`);
