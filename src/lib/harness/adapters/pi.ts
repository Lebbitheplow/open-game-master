// Pi (the `pi` coding agent), driven in its RPC mode: JSON commands on
// stdin, its session events on stdout (pi's docs/rpc.md and docs/json.md).
//
// Lockdown, "removed": the program starts with an allowlist naming only
// ODM's MCP tools (`--tools mcp__odm__*`, or `--no-tools` for a plain
// completion), so none of its built-in tools (read, bash, edit, write) is
// on; extensions, skills, prompt templates, themes and context files are not
// loaded; the admin's own MCP servers are switched off for the run; and the
// working folder is the run's empty scratch directory. Every system message
// it reports names the tools it was given (`toolsAdded`), and a run whose
// list holds anything else is stopped.
//
// The ODM server reaches it as a project MCP server: a `.pi/mcp.json` in the
// scratch folder, read because the run is started with `--approve`. The
// token stays out of the file and off the command line: the file names an
// environment variable only this child is given.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJsonLine, runProgram, spawnProgram } from "../process.ts";
import { HARNESS_EFFORTS, type HarnessAdapter, type HarnessModel, type HarnessStartOptions } from "../types.ts";

export const PI_ENV = {
  PI_OFFLINE: "1",
  PI_SKIP_VERSION_CHECK: "1",
  PI_TELEMETRY: "0",
};

const TOKEN_VARIABLE = "ODM_MCP_TOKEN";
const ODM_TOOL_PREFIX = "mcp__odm__";

// Pure, so scripts/test-harness-pi.mjs can pin it.
export function piArgs(options: { systemPromptPath: string; model: string; effort: string; mcp: boolean }): string[] {
  return [
    "--mode",
    "rpc",
    "--no-session",
    "--approve",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-themes",
    // MCP support is one of Pi's built-in extensions, which --no-extensions
    // switches off with the rest; a run with ODM's tools loads it alone.
    ...(options.mcp ? ["-e", "builtin:mcp", "--tools", `${ODM_TOOL_PREFIX}*`] : ["--no-tools", "--no-mcp"]),
    "--system-prompt",
    options.systemPromptPath,
    ...(options.model ? ["--model", options.model] : []),
    ...(options.effort ? ["--thinking", options.effort] : []),
  ];
}

// The admin's own MCP servers, by name, so the run's project file can
// switch each of them off. Pi reads them from its config folder.
function ownServerNames(env: Record<string, string>): string[] {
  const dir = env.PI_CODING_AGENT_DIR || path.join(env.HOME || os.homedir(), ".pi", "agent");
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, "mcp.json"), "utf8")) as { mcpServers?: Record<string, unknown> };
    return Object.keys(parsed.mcpServers ?? {});
  } catch {
    return [];
  }
}

// The run's project MCP file: ODM's server with its tools declared to the
// model directly, every other server off, and no codemode in front of them.
export function piMcpConfig(url: string, ownServers: readonly string[]): string {
  const servers: Record<string, unknown> = {};
  for (const name of ownServers) {
    if (name !== "odm") {
      servers[name] = { enabled: false };
    }
  }
  servers.odm = {
    url,
    headers: { Authorization: `Bearer \${${TOKEN_VARIABLE}}` },
    exposure: "direct",
    description: "Open Game Master: the game's own tools.",
  };
  return JSON.stringify({ autoEnableCodemode: false, mcpServers: servers }, null, 2);
}

// `pi --list-models`: a table of provider, model, context, max-out,
// thinking, images. Ids carry their provider, so two providers' models of
// the same name stay apart; a model that thinks offers every effort. Only
// the rows under the header count: a Pi signed in nowhere prints a sentence
// ("No models available. Use /login ...") on stdout instead, which would
// otherwise read as a model and show the program as ready.
export function parsePiModels(output: string): HarnessModel[] {
  const models: HarnessModel[] = [];
  let header = false;
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns[0] === "provider" && columns[1] === "model") {
      header = true;
      continue;
    }
    if (!header || columns.length < 5) {
      continue;
    }
    const [provider, model, context, , thinking] = columns;
    const id = `${provider}/${model}`;
    if (!/^[\w.-]+$/.test(provider) || models.some((entry) => entry.id === id)) {
      continue;
    }
    const size = /^(\d+(?:\.\d+)?)([KM])$/i.exec(context ?? "");
    models.push({
      id,
      label: `${model} (${provider})`,
      ...(size ? { contextTokens: Math.round(Number(size[1]) * (size[2].toUpperCase() === "M" ? 1_000_000 : 1_000)) } : {}),
      efforts: thinking === "yes" ? [...HARNESS_EFFORTS] : [],
    });
  }
  return models;
}

// The tools a system message gives the run (`toolsAdded`): the first one
// declares the opening set, a later one the MCP tools that connected since.
export function piToolsOf(message: Record<string, unknown>): string[] {
  const tools = message.toolsAdded;
  return Array.isArray(tools) ? tools.map((tool) => (typeof tool === "string" ? tool : String((tool as { name?: unknown }).name ?? ""))).filter(Boolean) : [];
}

function errorKind(message: string) {
  return /limit|quota|429|usage/i.test(message) ? ("limit" as const) : /log ?in|auth|credential|401|403/i.test(message) ? ("signed-out" as const) : ("crash" as const);
}

async function start(options: HarnessStartOptions) {
  const systemPromptPath = path.join(options.cwd, "odm-system-prompt.md");
  writeFileSync(systemPromptPath, options.system, { mode: 0o600 });
  const env: Record<string, string> = { ...options.env, ...PI_ENV };
  if (options.mcp) {
    mkdirSync(path.join(options.cwd, ".pi"), { recursive: true });
    writeFileSync(path.join(options.cwd, ".pi", "mcp.json"), piMcpConfig(options.mcp.url, ownServerNames(options.env)), { mode: 0o600 });
    env[TOKEN_VARIABLE] = options.mcp.token;
  }
  const args = piArgs({ systemPromptPath, model: options.model, effort: options.effort, mcp: Boolean(options.mcp) });
  let turnText = "";
  let closed = false;
  let ready = false;
  let failed = "";
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let sent = 0;

  const program = spawnProgram(options.binary, args, {
    cwd: options.cwd,
    env,
    onLine: (line) => {
      const event = parseJsonLine(line);
      if (!event) {
        return;
      }
      const type = event.type;
      if (type === "response") {
        if (event.success === false) {
          options.onEvent({ type: "error", kind: errorKind(String(event.error ?? "")), message: `Pi refused the ${String(event.command)} command: ${String(event.error ?? "")}`.slice(0, 400) });
        }
        return;
      }
      if (type === "message_start") {
        const message = (event.message ?? {}) as Record<string, unknown>;
        if (message.role === "system") {
          const tools = piToolsOf(message);
          const stray = tools.filter((tool) => !tool.startsWith(ODM_TOOL_PREFIX));
          if (stray.length) {
            options.onEvent({
              type: "error",
              kind: "lockdown",
              message: `Pi started with its own tools still on (${stray.slice(0, 4).join(", ")}), so the turn was stopped.`,
            });
            program.kill();
            return;
          }
          if (!ready) {
            ready = true;
            options.onEvent({ type: "ready", tools });
          }
        }
        return;
      }
      if (type === "message_update") {
        const inner = (event.assistantMessageEvent ?? {}) as { type?: unknown; delta?: unknown };
        if (inner.type === "text_delta" && typeof inner.delta === "string" && inner.delta) {
          turnText += inner.delta;
          options.onEvent({ type: "delta", text: inner.delta });
        }
        return;
      }
      if (type === "tool_execution_start") {
        // A new tool round: what was written before it was not the
        // narration (src/lib/harness/bridge.ts keeps it as a draft).
        turnText = "";
        options.onEvent({ type: "tool_round" });
        return;
      }
      if (type === "message_end") {
        const message = (event.message ?? {}) as Record<string, unknown>;
        if (message.role !== "assistant") {
          return;
        }
        const counted = (message.usage ?? {}) as { input?: unknown; output?: unknown; cost?: { total?: unknown } };
        usage = {
          inputTokens: usage.inputTokens + (typeof counted.input === "number" ? counted.input : 0),
          outputTokens: usage.outputTokens + (typeof counted.output === "number" ? counted.output : 0),
          costUsd: usage.costUsd + (typeof counted.cost?.total === "number" ? counted.cost.total : 0),
        };
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          failed = String(message.errorMessage ?? `Pi stopped (${String(message.stopReason)}).`);
        } else {
          failed = "";
        }
        return;
      }
      if (type === "agent_settled") {
        const text = turnText.trim();
        const spent = usage;
        turnText = "";
        usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
        if (failed) {
          options.onEvent({ type: "error", kind: errorKind(failed), message: failed.slice(0, 400) });
          failed = "";
          return;
        }
        options.onEvent({ type: "turn_end", text, usage: { ...spent, costUsd: spent.costUsd || undefined } });
      }
    },
    onExit: (code) => {
      if (!closed) {
        const tail = program.stderrTail();
        if (code !== 0 && tail) {
          options.onEvent({
            type: "error",
            kind: /not logged in|log in|authenticat|oauth|no api key/i.test(tail) ? "signed-out" : "crash",
            message: tail.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400),
          });
        }
        options.onEvent({ type: "exit", code });
      }
    },
  });

  return {
    send(text: string) {
      sent += 1;
      turnText = "";
      program.write(JSON.stringify({ id: `odm-${sent}`, type: "prompt", message: text }));
    },
    close() {
      closed = true;
      program.kill();
    },
  };
}

export const piAdapter: HarnessAdapter = {
  id: "pi",
  label: "Pi",
  binaryNames: ["pi"],
  installHint: "npm install -g @earendil-works/pi-coding-agent",
  signInHint: "pi auth login <provider>",
  lockdown: "removed",
  paints: false,
  async probe(binary, env) {
    const version = await runProgram(binary, ["--version"], { ...env, ...PI_ENV }, 15_000);
    const installed = version.code === 0;
    if (!installed) {
      return { installed: false, auth: { state: "unknown" }, models: [] };
    }
    const listed = await runProgram(binary, ["--list-models"], { ...env, ...PI_ENV }, 30_000);
    const models = parsePiModels(listed.stdout);
    return {
      installed,
      version: version.stdout.trim().split(/\s+/).pop(),
      // Pi lists only the models of providers it is signed in to.
      auth: models.length ? { state: "ready", kind: "subscription" } : { state: "signed-out" },
      models,
      defaultEfforts: [...HARNESS_EFFORTS],
      lockdownProven: false,
      message: models.length ? undefined : "Pi lists no models: sign it in to a provider on this machine (`pi auth login <provider>`), then check again.",
    };
  },
  start,
};
