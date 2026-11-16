// Pi as the server's agent program (src/lib/harness/adapters/pi.ts). Stub
// programs stand in for `pi`:
//   - Its models come from `pi --list-models`, with their provider, window and
//     efforts; a Pi that lists none is signed out.
//   - A run with ODM's tools loads Pi's MCP support alone and allows only
//     ODM's tools; a plain completion has no tools and no MCP at all.
//   - The run's MCP file names ODM's server with the token by variable only,
//     and switches the admin's own servers off.
//   - A run whose system message offers any tool but ODM's is stopped.
//   - Its RPC events become the bridge's: text, tool rounds, the turn's end
//     with usage, and a provider error.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { piAdapter, piArgs, piMcpConfig, parsePiModels } = await import("../src/lib/harness/adapters/pi.ts");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-pi-test-"));
const env = { PATH: process.env.PATH ?? "", HOME: dir };

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}
const unix = process.platform !== "win32";

const LISTING = `provider      model           context  max-out  thinking  images
anthropic     claude-opus-5   1M       128K     yes       yes
openai-codex  gpt-6-luna      272K     128K     yes       yes
local         tiny            32K      8K       no        no
`;

function stub(name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

await test("the models come from --list-models, with provider, window and efforts", async () => {
  const models = parsePiModels(LISTING);
  assert.deepEqual(
    models.map((model) => [model.id, model.contextTokens, model.efforts.length]),
    [
      ["anthropic/claude-opus-5", 1_000_000, 5],
      ["openai-codex/gpt-6-luna", 272_000, 5],
      ["local/tiny", 32_000, 0],
    ],
  );
});

await test("a run with ODM's tools loads MCP alone and allows only ODM's tools; a completion has none", async () => {
  const tools = piArgs({ systemPromptPath: "/s.md", model: "openai-codex/gpt-6-luna", effort: "low", mcp: true });
  for (const flag of ["--mode", "--no-session", "--approve", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates"]) {
    assert.ok(tools.includes(flag), flag);
  }
  assert.equal(tools[tools.indexOf("-e") + 1], "builtin:mcp");
  assert.equal(tools[tools.indexOf("--tools") + 1], "mcp__odm__*");
  assert.equal(tools[tools.indexOf("--model") + 1], "openai-codex/gpt-6-luna");
  assert.equal(tools[tools.indexOf("--thinking") + 1], "low");
  const plain = piArgs({ systemPromptPath: "/s.md", model: "", effort: "", mcp: false });
  assert.ok(plain.includes("--no-tools") && plain.includes("--no-mcp"));
  assert.ok(!plain.includes("-e") && !plain.includes("--model") && !plain.includes("--thinking"));
});

await test("the run's MCP file has the token by variable only and the admin's own servers off", async () => {
  const config = JSON.parse(piMcpConfig("http://127.0.0.1:3005/api/mcp", ["rea", "cloudflare"]));
  assert.equal(config.autoEnableCodemode, false);
  assert.deepEqual(config.mcpServers.rea, { enabled: false });
  assert.deepEqual(config.mcpServers.cloudflare, { enabled: false });
  assert.equal(config.mcpServers.odm.url, "http://127.0.0.1:3005/api/mcp");
  assert.equal(config.mcpServers.odm.headers.Authorization, "Bearer ${ODM_MCP_TOKEN}");
  assert.equal(config.mcpServers.odm.exposure, "direct");
});

if (unix) {
  await test("a Pi that lists models is ready; one that lists none is signed out", async () => {
    const ready = await piAdapter.probe(stub("pi-ready", `case "$1" in --version) echo "1.5.2";; --list-models) cat <<'L'\n${LISTING}L\n;; esac`), env);
    assert.equal(ready.installed, true);
    assert.equal(ready.version, "1.5.2");
    assert.equal(ready.auth.state, "ready");
    assert.equal(ready.models.length, 3);
    const out = await piAdapter.probe(stub("pi-out", `case "$1" in --version) echo "1.5.2";; --list-models) echo "provider model context max-out thinking images";; esac`), env);
    assert.equal(out.auth.state, "signed-out");
    assert.match(out.message, /pi auth login/);
  });

  // A stub RPC session: reads the prompt, then replays the given events.
  const session = (name, events) =>
    stub(name, `read line\n${events.map((event) => `echo '${JSON.stringify(event)}'`).join("\n")}\nsleep 1`);
  const run = (binary) =>
    new Promise((resolve) => {
      const seen = [];
      const cwd = fs.mkdtempSync(path.join(dir, "run-"));
      let session;
      const done = () => {
        session?.close();
        resolve(seen);
      };
      piAdapter
        .start({
          binary,
          system: "rules",
          model: "openai-codex/gpt-6-luna",
          effort: "low",
          mcp: { url: "http://127.0.0.1:1/api/mcp", token: "secret" },
          cwd,
          env,
          onEvent: (event) => {
            seen.push(event);
            if (["turn_end", "error", "exit"].includes(event.type)) {
              done();
            }
          },
        })
        .then((started) => {
          session = started;
          started.send("Go.");
        });
    });
  const system = (tools) => ({ type: "message_start", message: { role: "system", toolsAdded: tools.map((name) => ({ name })) } });
  const assistantEnd = (stopReason, extra = {}) => ({
    type: "message_end",
    message: { role: "assistant", stopReason, usage: { input: 70, output: 6, cost: { total: 0.001 } }, ...extra },
  });
  const delta = (text) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });

  await test("a run offered any tool but ODM's is stopped", async () => {
    const events = await run(session("pi-stray", [system(["mcp__odm__roll", "bash"])]));
    const error = events.find((event) => event.type === "error");
    assert.equal(error?.kind, "lockdown");
    assert.match(error.message, /bash/);
    assert.ok(!events.some((event) => event.type === "ready"));
  });

  await test("its events become the bridge's: text, a tool round, the turn's end with usage", async () => {
    const events = await run(
      session("pi-turn", [
        system(["mcp__odm__roll"]),
        delta("Let me "),
        { type: "tool_execution_start", toolName: "mcp__odm__roll" },
        assistantEnd("toolUse"),
        delta("The door "),
        delta("creaks."),
        assistantEnd("stop"),
        { type: "agent_settled", aborted: false },
      ]),
    );
    assert.deepEqual(events.find((event) => event.type === "ready")?.tools, ["mcp__odm__roll"]);
    assert.ok(events.some((event) => event.type === "tool_round"));
    const end = events.find((event) => event.type === "turn_end");
    assert.equal(end?.text, "The door creaks.");
    assert.deepEqual(end.usage, { inputTokens: 140, outputTokens: 12, costUsd: 0.002 });
    const file = JSON.parse(fs.readFileSync(path.join(fs.readdirSync(dir).filter((entry) => entry.startsWith("run-")).map((entry) => path.join(dir, entry)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], ".pi", "mcp.json"), "utf8"));
    assert.ok(!JSON.stringify(file).includes("secret"), "the token is not written to the file");
  });

  await test("a provider error ends the turn as an error", async () => {
    const events = await run(
      session("pi-limit", [system([]), assistantEnd("error", { errorMessage: "429 usage limit reached" }), { type: "agent_settled", aborted: false }]),
    );
    const error = events.find((event) => event.type === "error");
    assert.equal(error?.kind, "limit");
    assert.ok(!events.some((event) => event.type === "turn_end"));
  });
} else {
  console.log("skip: the stub programs (Windows)");
}

removeTempDir(dir);
console.log(`test-harness-pi: ${passed} passed`);
