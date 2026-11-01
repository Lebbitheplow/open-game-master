// Claude Code, driven through its own CLI in headless stream-json mode.
//
// Lockdown: `--tools ""` removes every built-in tool (proven on 2.1.278: the
// init event lists only mcp__odm__* tools), `--strict-mcp-config` ignores the
// admin's own MCP servers, `--setting-sources ""` loads no user or project
// settings, hooks or CLAUDE.md, and `--permission-mode dontAsk` refuses
// anything that was not pre-approved. The init event's tool list is checked
// on every run, and a run that reports any other tool is killed.

import { writeFileSync } from "node:fs";
import os from "node:os";
import { noteSpeed } from "@/lib/speed-status";
import path from "node:path";
import { THIS_TURN_HEADING } from "../../prompt-boundary.ts";
import { parseJsonLine, runProgram, spawnProgram } from "../process.ts";
import { isHarnessEffort } from "../types.ts";
import type { HarnessAdapter, HarnessEffort, HarnessModel, HarnessStartOptions } from "../types.ts";

export const CLAUDE_MCP_PREFIX = "mcp__odm__";

type InitializeModel = {
  value?: string;
  displayName?: string;
  description?: string;
  resolvedModel?: string;
  supportsFastMode?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
};

// The effort levels Claude Code lists for a model; none when it says the
// model takes no effort, and no list when it does not say.
function claudeEfforts(entry: InitializeModel): HarnessEffort[] | undefined {
  if (entry.supportsEffort === false) {
    return [];
  }
  return entry.supportedEffortLevels?.filter(isHarnessEffort);
}

// The models of an `initialize` answer: the ones this sign-in offers, under
// the names `--model` takes. "default" is left out because both pickers
// already offer the program's own default; its effort levels are what a
// blank model offers. An answer without a list throws, so the card says the
// list could not be read.
export function parseClaudeModels(models: unknown): { models: HarnessModel[]; defaultEfforts?: HarnessEffort[] } {
  if (!Array.isArray(models)) {
    throw new Error("its answer carried no model list");
  }
  const entries = models as InitializeModel[];
  const programDefault = entries.find((entry) => entry.value === "default");
  const defaultEfforts = programDefault ? claudeEfforts(programDefault) : undefined;
  const listed = entries.flatMap((entry) => {
    if (!entry.value || entry.value === "default") {
      return [];
    }
    const name = entry.displayName || entry.value;
    const efforts = claudeEfforts(entry);
    // "Opus 5.5 · Best for everyday, complex tasks" names the version the
    // alias stands for; a variant's own name ("Opus (1M context)") is kept.
    const head = entry.description?.includes(" · ") ? entry.description.split(" · ")[0] : "";
    // Which one is light is the catalog's call, by price, asked about the
    // model the alias stands for (src/lib/model-registry/catalog.ts).
    return [
      {
        id: entry.value,
        label: head.startsWith(name) ? head : name,
        fast: entry.supportsFastMode === true,
        ...(entry.resolvedModel ? { catalogId: entry.resolvedModel } : {}),
        ...(efforts ? { efforts } : {}),
      },
    ];
  });
  return { models: listed, ...(defaultEfforts ? { defaultEfforts } : {}) };
}

const MODELS_REQUEST_ID = "odm-models";

// Asks Claude Code which models it offers: the `initialize` control request
// the Agent SDK's supportedModels() sends, answered before any model call.
// It is started with a turn's own flags, so a flag this version no longer
// takes fails here, on the admin card, rather than at a table; with no model
// call there is no system prompt to give it, and nothing to leave behind.
export function probeClaudeModels(
  binary: string,
  env: Record<string, string>,
  timeoutMs = 20_000,
): Promise<ReturnType<typeof parseClaudeModels>> {
  return new Promise<ReturnType<typeof parseClaudeModels>>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: ReturnType<typeof parseClaudeModels> | Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      program.kill();
      if (outcome instanceof Error) {
        reject(outcome);
      } else {
        resolve(outcome);
      }
    };
    const program = spawnProgram(binary, claudeArgs({ systemPromptPath: null, model: "", effort: "", mcpConfigPath: null }), {
      cwd: os.tmpdir(),
      env: { ...env, ...CLAUDE_ENV },
      onLine: (line) => {
        const event = parseJsonLine(line);
        const response = event?.type === "control_response" ? (event.response as Record<string, unknown> | undefined) : undefined;
        if (response?.request_id !== MODELS_REQUEST_ID) {
          return;
        }
        if (response.subtype !== "success") {
          finish(new Error(typeof response.error === "string" ? response.error : "it refused the request"));
          return;
        }
        try {
          finish(parseClaudeModels((response.response as Record<string, unknown> | undefined)?.models));
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      },
      onExit: (code) => {
        const tail = program.stderrTail().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400);
        finish(new Error(tail || `it exited with code ${String(code)}`));
      },
    });
    const timer = setTimeout(() => finish(new Error("it did not answer in time")), timeoutMs);
    program.write(JSON.stringify({ type: "control_request", request_id: MODELS_REQUEST_ID, request: { subtype: "initialize" } }));
  });
}

// Pure, so scripts/test-harness-logic.mjs can pin every lockdown flag.
export function claudeArgs(options: {
  systemPromptPath: string | null;
  model: string;
  effort: string;
  mcpConfigPath: string | null;
  // Fast mode for this session only (issue 255): Claude Code's own setting,
  // given in --settings so the user's saved default is never touched.
  fast?: boolean;
}): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    ...(options.systemPromptPath ? ["--system-prompt-file", options.systemPromptPath] : []),
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--settings",
    JSON.stringify({ disableAllHooks: true, ...(options.fast ? { fastMode: true } : {}) }),
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
  if (options.mcpConfigPath) {
    args.push("--mcp-config", options.mcpConfigPath, "--allowedTools", `${CLAUDE_MCP_PREFIX}*`);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  return args;
}

export const CLAUDE_ENV = {
  // The claude.ai connectors and an open IDE would both add tools.
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
  // The advisor is a server tool (a second model that reads the whole
  // conversation), so it never shows in the init event's tool list that the
  // lockdown checks; Claude Code attaches it unasked.
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
  // A program reading the table's story sends nothing beyond its model
  // requests: no telemetry, error reports, feature-flag fetches or
  // auto-updates.
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  // A slow engine call must not time out inside the program before ODM
  // answers it.
  MCP_TOOL_TIMEOUT: "600000",
  MCP_TIMEOUT: "30000",
};

// Claude Code (2.1.275+) caches the system prompt file in two blocks, split
// at a line holding only this marker, which it then removes: the part above
// it, the campaign's static rules, is read from the cache on later turns
// instead of written again. Only the first occurrence is swapped: the DM
// rules come before anything a player writes, so a player who types the
// heading cannot move the split. Through Bedrock, Vertex or a gateway
// Claude Code sends one block, as without the marker.
// https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
export function withCacheBoundary(system: string): string {
  return system.replace(THIS_TURN_HEADING, "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function start(options: HarnessStartOptions) {
  let mcpConfigPath: string | null = null;
  if (options.mcp) {
    // A file in the run's own scratch folder, readable only by this user and
    // deleted with the folder, so the token never appears on a command line.
    mcpConfigPath = path.join(options.cwd, "odm-mcp.json");
    writeFileSync(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          odm: {
            type: "http",
            url: options.mcp.url,
            headers: { Authorization: `Bearer ${options.mcp.token}` },
          },
        },
      }),
      { mode: 0o600 },
    );
  }
  // The system prompt goes by file as well. A campaign's prompt runs to
  // tens of kilobytes, and Windows caps a whole command line at 32 K
  // characters (Linux caps one argument at 128 K), so on argv the program
  // could not start at all.
  const systemPromptPath = path.join(options.cwd, "odm-system-prompt.md");
  writeFileSync(systemPromptPath, withCacheBoundary(options.system), { mode: 0o600 });
  const args = claudeArgs({
    systemPromptPath,
    model: options.model,
    effort: options.effort,
    mcpConfigPath,
    fast: Boolean(options.speed),
  });
  let turnText = "";
  let closed = false;
  const program = spawnProgram(options.binary, args, {
    cwd: options.cwd,
    env: { ...options.env, ...CLAUDE_ENV },
    onLine: (line) => {
      const event = parseJsonLine(line);
      if (!event) {
        return;
      }
      if (event.type === "system" && event.subtype === "init") {
        const tools = Array.isArray(event.tools) ? event.tools.map(String) : [];
        const stray = tools.filter((tool) => !tool.startsWith(CLAUDE_MCP_PREFIX));
        if (stray.length) {
          options.onEvent({
            type: "error",
            kind: "lockdown",
            message: `Claude Code started with its own tools still on (${stray.slice(0, 4).join(", ")}), so the turn was stopped.`,
          });
          program.kill();
          return;
        }
        const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
        const odm = servers.find((server) => (server as { name?: unknown }).name === "odm") as
          | { status?: unknown }
          | undefined;
        if (options.mcp && odm && odm.status !== "connected") {
          options.onEvent({
            type: "error",
            kind: "crash",
            message: `Claude Code could not reach the game engine (MCP status: ${String(odm.status)}).`,
          });
          program.kill();
          return;
        }
        options.onEvent({ type: "ready", tools });
        return;
      }
      if (event.type === "stream_event") {
        const inner = event.event as { type?: unknown; delta?: { type?: unknown; text?: unknown } } | undefined;
        if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta") {
          const text = textOf(inner.delta.text);
          if (text) {
            turnText += text;
            options.onEvent({ type: "delta", text });
          }
        }
        return;
      }
      if (event.type === "rate_limit_event") {
        const info = event.rate_limit_info as
          | { utilization?: unknown; resetsAt?: unknown; rateLimitType?: unknown; status?: unknown }
          | undefined;
        if (info && typeof info.utilization === "number") {
          options.onEvent({
            type: "rate_limit",
            utilization: info.utilization,
            resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
            window: typeof info.rateLimitType === "string" ? info.rateLimitType : undefined,
          });
        }
        return;
      }
      if (event.type === "result") {
        const usage = event.usage as { input_tokens?: unknown; output_tokens?: unknown; speed?: unknown } | undefined;
        // What the session ran at, where Claude Code passes the API's word
        // for it on (usage.speed: "fast" or "standard").
        if (options.speed) {
          noteSpeed(options.speed.role === "utility" ? "agent-utility" : "agent-story", {
            model: options.model,
            reported: typeof usage?.speed === "string" ? usage.speed : null,
          });
        }
        const text = turnText.trim() || textOf(event.result).trim();
        turnText = "";
        if (event.is_error === true || (event.subtype !== "success" && event.subtype !== undefined)) {
          const message = textOf(event.result) || `Claude Code stopped (${String(event.subtype)}).`;
          options.onEvent({
            type: "error",
            kind: /limit|quota|usage/i.test(message) ? "limit" : /log ?in|auth|credential/i.test(message) ? "signed-out" : "crash",
            message,
          });
          return;
        }
        options.onEvent({
          type: "turn_end",
          text,
          usage: {
            inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
            outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
            costUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined,
          },
        });
        return;
      }
      if (event.type === "assistant") {
        // A whole message arrives after its deltas; text already streamed is
        // not counted twice. The deltas are the record.
        return;
      }
    },
    onExit: (code) => {
      if (!closed) {
        const tail = program.stderrTail();
        if (code !== 0 && tail) {
          options.onEvent({
            type: "error",
            // "OAuth session expired and could not be refreshed" is a
            // sign-in that ran out (issue #713).
            kind: /not logged in|log in|authenticat|oauth/i.test(tail) ? "signed-out" : "crash",
            message: tail.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400),
          });
        }
        options.onEvent({ type: "exit", code });
      }
    },
  });
  return {
    send(text: string) {
      program.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }));
    },
    close() {
      closed = true;
      program.kill();
    },
  };
}

export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  label: "Claude Code",
  binaryNames: ["claude"],
  installHint: "curl -fsSL https://claude.ai/install.sh | bash",
  installHintWindows: "irm https://claude.ai/install.ps1 | iex",
  signInHint: "claude auth login",
  lockdown: "removed",
  paints: false,
  // The system prompt is a file (start below), split at the cache boundary
  // into two cached blocks: the older transcript in the second block is
  // written again only when a chunk of it closes.
  settledTranscript: true,
  async probe(binary, env) {
    const version = await runProgram(binary, ["--version"], env, 15_000);
    const installed = version.code === 0;
    const status = installed ? await runProgram(binary, ["auth", "status"], env, 20_000) : null;
    let auth: { state: "ready" | "signed-out" | "unknown"; kind?: "subscription" | "api-key"; plan?: string; account?: string } = {
      state: "unknown",
    };
    if (status) {
      try {
        const body = JSON.parse(status.stdout) as {
          loggedIn?: boolean;
          authMethod?: string;
          subscriptionType?: string;
          email?: string;
        };
        auth = body.loggedIn
          ? {
              state: "ready",
              kind: body.authMethod === "claude.ai" ? "subscription" : "api-key",
              plan: body.subscriptionType ? body.subscriptionType : undefined,
              account: body.email,
            }
          : { state: "signed-out" };
      } catch {
        auth = { state: status.code === 0 ? "ready" : "signed-out" };
      }
      if (env.ANTHROPIC_API_KEY && auth.state !== "ready") {
        auth = { state: "ready", kind: "api-key" };
      }
    }
    const notes: string[] = [];
    if (installed && auth.state === "signed-out") {
      notes.push("Claude Code is installed but not signed in on this machine.");
    }
    const { models, defaultEfforts } = installed
      ? await probeClaudeModels(binary, env).catch((error: Error) => {
          notes.push(`Claude Code did not list its models (${error.message}).`);
          return { models: [], defaultEfforts: undefined };
        })
      : { models: [], defaultEfforts: undefined };
    return {
      installed,
      version: installed ? version.stdout.trim().split(/\s+/)[0] : undefined,
      auth,
      models,
      defaultEfforts,
      lockdownProven: true,
      message: notes.length > 0 ? notes.join(" ") : undefined,
    };
  },
  start,
};
