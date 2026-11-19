// Antigravity CLI (Google's `agy`), driven through its headless print mode
// with stream-json in and out: one conversation per run, one line per turn
// on stdin (https://antigravity.google/docs/cli/headless).
//
// NOT YET RUN signed in. Built from Antigravity's documentation and from
// agy 1.5.12 itself, unsigned (its --help, its release notes and the errors
// it gives before a sign-in), so the admin page marks its lockdown unproven
// until a Test the table run passes. Unsigned, agy 1.5.12 takes these flags
// and settings (a malformed --settings fails before the sign-in), and loads
// the run's agent file: it lists it among its agents, and refuses one whose
// mcpServers is not a list or whose excludeDefaultComponents is not a
// boolean. Unknown keys pass silently, so the rest waits on a real turn.
//
// Lockdown, "removed": each run brings its own custom agent, a file in the
// run's empty folder selected with --agent. `excludeDefaultComponents` drops
// Antigravity's default prompt sections and every built-in tool;
// `inheritCustomizations: false` keeps the admin's own skills, rules,
// plugins, subagents and MCP servers out; ODM's MCP server is the agent's
// only one. --settings, for this run alone and never saved, denies commands,
// file access and web reads, allows only ODM's MCP tools, and starts in the
// Default mode, where no reviewer approves a command on the admin's behalf.
// The init event's tool list is checked on every run, and so is every tool
// step: anything but ODM's tools stops the turn.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseJsonLine, runProgram, spawnProgram } from "../process.ts";
import type { HarnessAdapter, HarnessModel, HarnessStartOptions } from "../types.ts";

export const ANTIGRAVITY_AGENT = "odm-dm";

// Antigravity names an eager MCP tool mcp_<server>_<tool>.
export const ANTIGRAVITY_MCP_PREFIX = "mcp_odm_";

// The tools a run may report besides ODM's own: Antigravity's door to a
// lazily loaded MCP tool, which reaches only the servers the agent has, and
// that is ODM's alone.
const ANTIGRAVITY_DOORS = new Set(["call_mcp_tool"]);

export const ANTIGRAVITY_ENV = {
  AGY_CLI_HIDE_LOGO: "1",
  // Keeps the signed-in account's address out of what the program writes.
  AGY_CLI_HIDE_ACCOUNT_INFO: "1",
};

// The run's own settings (--settings: "settings for this session only,
// never saved"). Deny wins over allow, so ODM's tools are allowed by server
// and nothing else is. agentMode "" is the Default mode: Auto would let a
// reviewer model approve commands without asking.
export function antigravitySettings(): Record<string, unknown> {
  return {
    agentMode: "",
    permissions: {
      allow: ["mcp(odm/*)"],
      deny: ["command(*)", "read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)"],
    },
  };
}

// Pure, so scripts/test-harness-antigravity.mjs can pin every flag. A bare
// -p takes the next argument as its prompt, so the prompt is attached empty:
// the turns arrive on stdin.
export function antigravityArgs(options: { model: string; effort: string }): string[] {
  const args = [
    "-p=",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--agent",
    ANTIGRAVITY_AGENT,
    "--disable-slash-commands",
    "--settings",
    JSON.stringify(antigravitySettings()),
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  return args;
}

// The run's custom agent. JSON scalars are YAML too, so every value is
// written as JSON and nothing a prompt or URL holds can break the
// frontmatter. The body is the agent's system prompt; Antigravity reads it
// in H1 sections, so it opens with the one its own example uses.
export function antigravityAgentFile(options: {
  system: string;
  mcp: { url: string; token: string } | null;
  toolNames?: readonly string[];
}): string {
  const lines = [
    "---",
    `name: ${JSON.stringify(ANTIGRAVITY_AGENT)}`,
    `description: ${JSON.stringify("Open Game Master's storyteller")}`,
    "mainAgent: true",
    "subagent: false",
    "excludeDefaultComponents: true",
    "inheritCustomizations: false",
    "inheritMcp: false",
    `commandExecutionPolicy: ${JSON.stringify("off")}`,
  ];
  if (options.mcp) {
    // Loaded up front by name where the run says which tools it serves: a
    // lazy tool's schema is read from a file, and this agent has no file
    // tools to read it with.
    const tools = Object.fromEntries((options.toolNames ?? []).map((name) => [name, { eager: true }]));
    const server = {
      name: "odm",
      serverUrl: options.mcp.url,
      headers: { Authorization: `Bearer ${options.mcp.token}` },
      // A slow engine call must not time out inside the program before ODM
      // answers it.
      timeoutSeconds: 600,
      ...(Object.keys(tools).length ? { tools } : {}),
    };
    lines.push(`mcpServers: ${JSON.stringify([server])}`);
  }
  lines.push("---", "", "# System Prompt", "", options.system, "");
  return lines.join("\n");
}

// The lines of `agy models` that name a model: the slug `--model` takes,
// then whatever the line says about it. Progress lines ("Fetching available
// models...") and headings ("Available models:") are not models.
export function parseAntigravityModels(output: string): HarnessModel[] {
  const models: HarnessModel[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim().replace(/^[-*•]\s*/, "");
    if (!line || line.endsWith("...") || line.endsWith(":")) {
      continue;
    }
    const match = /^([a-z0-9][a-z0-9._:/-]*)(?:\s+(.*))?$/i.exec(line);
    if (!match || !/[-.\d]/.test(match[1]) || models.some((entry) => entry.id === match[1])) {
      continue;
    }
    const rest = (match[2] ?? "").replace(/^[-–:(\s]+|[)\s]+$/g, "");
    models.push({ id: match[1], label: rest || match[1] });
  }
  return models;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolName(entry: unknown): string {
  if (typeof entry === "string") {
    return entry;
  }
  return textOf((entry as { name?: unknown } | null)?.name);
}

// Whether a tool a run reports is one ODM allows.
export function antigravityToolAllowed(name: string): boolean {
  return name.startsWith(ANTIGRAVITY_MCP_PREFIX) || ANTIGRAVITY_DOORS.has(name);
}

function errorKind(message: string): "signed-out" | "limit" | "crash" {
  if (/authenticat|sign ?in|log ?in|credential/i.test(message)) {
    return "signed-out";
  }
  if (/quota|credits|limit|429|exhausted/i.test(message)) {
    return "limit";
  }
  return "crash";
}

async function start(options: HarnessStartOptions) {
  // A file in the run's own scratch folder, readable only by this user and
  // deleted with the folder, so neither the token nor a campaign's long
  // prompt appears on a command line.
  const agentsDir = path.join(options.cwd, ".agents", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    path.join(agentsDir, `${ANTIGRAVITY_AGENT}.md`),
    antigravityAgentFile({ system: options.system, mcp: options.mcp, toolNames: options.toolNames }),
    { mode: 0o600 },
  );
  let turnText = "";
  let closed = false;
  const toolSteps = new Set<string>();
  const stop = (message: string) => {
    options.onEvent({ type: "error", kind: "lockdown", message });
    program.kill();
  };
  const program = spawnProgram(options.binary, antigravityArgs({ model: options.model, effort: options.effort }), {
    cwd: options.cwd,
    env: { ...options.env, ...ANTIGRAVITY_ENV },
    onLine: (line) => {
      const event = parseJsonLine(line);
      if (!event) {
        return;
      }
      // Each event carries its payload under its own name ({"event":
      // "result", "result": {...}}); a flat one is read the same way.
      const kind = textOf(event.event);
      const body = (event[kind] && typeof event[kind] === "object" ? event[kind] : event) as Record<string, unknown>;
      if (kind === "init") {
        const tools = Array.isArray(body.tools) ? body.tools.map(toolName).filter(Boolean) : [];
        const stray = tools.filter((tool) => !antigravityToolAllowed(tool));
        if (stray.length) {
          stop(`Antigravity started with its own tools still on (${stray.slice(0, 4).join(", ")}), so the turn was stopped.`);
          return;
        }
        if (options.mcp && !tools.length) {
          options.onEvent({
            type: "error",
            kind: "crash",
            message: "Antigravity started without the game engine's tools, so it could not run the table.",
          });
          program.kill();
          return;
        }
        options.onEvent({ type: "ready", tools });
        return;
      }
      if (kind === "step_update") {
        const stepType = textOf(body.step_type);
        const name = textOf(body.tool_name) || toolName((body.tool_info as Record<string, unknown> | undefined) ?? null);
        if (stepType === "tool" || name) {
          if (name && !antigravityToolAllowed(name)) {
            stop(`Antigravity reached for its own tool ${name}, so the turn was stopped.`);
            return;
          }
          // A new tool round: what it wrote before was not the narration.
          const step = String(body.step_index ?? name);
          if (!toolSteps.has(step)) {
            toolSteps.add(step);
            turnText = "";
            options.onEvent({ type: "tool_round" });
          }
          return;
        }
        const text = textOf(body.text_delta);
        if (text && (stepType === "agent_response" || !stepType)) {
          turnText += text;
          options.onEvent({ type: "delta", text });
        }
        return;
      }
      if (kind === "result") {
        const text = turnText.trim() || textOf(body.response).trim();
        turnText = "";
        toolSteps.clear();
        if (body.status !== "SUCCESS" || body.finished_reason) {
          const message = textOf(body.error) || `Antigravity stopped (${String(body.finished_reason ?? body.status)}).`;
          options.onEvent({ type: "error", kind: errorKind(message), message });
          return;
        }
        const usage = body.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
        options.onEvent({
          type: "turn_end",
          text,
          usage: {
            inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
            outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
          },
        });
      }
    },
    onExit: (code) => {
      if (!closed) {
        const tail = program.stderrTail();
        if (code !== 0 && tail) {
          options.onEvent({
            type: "error",
            kind: errorKind(tail),
            message: tail.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400),
          });
        }
        options.onEvent({ type: "exit", code });
      }
    },
  });
  return {
    send(text: string) {
      program.write(JSON.stringify({ event: "user", message: { content: text } }));
    },
    close() {
      closed = true;
      program.kill();
    },
  };
}

export const antigravityAdapter: HarnessAdapter = {
  id: "antigravity",
  label: "Antigravity CLI",
  binaryNames: ["agy"],
  installHint: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  installHintWindows: "irm https://antigravity.google/cli/install.ps1 | iex",
  // Run once as the user the server runs as: it prints a sign-in link when
  // there is no browser, and keeps the sign-in for later runs.
  signInHint: "agy",
  lockdown: "removed",
  paints: false,
  async probe(binary, env) {
    const version = await runProgram(binary, ["--version"], env, 15_000);
    const installed = version.code === 0;
    if (!installed) {
      return { installed: false, auth: { state: "unknown" }, models: [] };
    }
    // `agy models` answers without a sign-in ("Please sign in to view
    // available models"), where a turn would wait on one.
    const listed = await runProgram(binary, ["models"], { ...env, ...ANTIGRAVITY_ENV }, 30_000);
    const text = `${listed.stdout}\n${listed.stderr}`;
    const signedOut = /sign in|authentication required|not signed in|log in/i.test(text) && listed.code !== 0;
    const models = listed.code === 0 ? parseAntigravityModels(listed.stdout) : [];
    return {
      installed,
      version: version.stdout.trim().split(/\s+/).pop(),
      auth: signedOut
        ? { state: "signed-out" }
        : { state: models.length ? "ready" : "unknown", kind: env.GEMINI_API_KEY ? "api-key" : "subscription" },
      // No list of our own when `agy models` gives none: a name written
      // here would outlive the model it names.
      models,
      lockdownProven: false,
      message: signedOut
        ? "The Antigravity CLI is installed but not signed in on this machine."
        : models.length
          ? undefined
          : "Could not read the Antigravity CLI's model list (`agy models` gave none). Type the model's name, or leave it blank for its own default.",
    };
  },
  start,
};
