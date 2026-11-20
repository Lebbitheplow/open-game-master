// Antigravity CLI (Google's `agy`), driven through its headless print mode
// with stream-json in and out: one conversation per run, one line per turn
// on stdin (https://antigravity.google/docs/cli/headless).
//
// Built from Antigravity's documentation and agy 1.5.12 itself, then run
// signed in by a contributor (PR #1046: Test the table and a test picture);
// the maintainers have not run it signed in, so the admin page marks its
// lockdown unproven until a Test the table run passes on that machine.
//
// NOT SUPPORTED OR TESTED by Open Game Master: agy loads at most 20,000
// tokens of tool definitions and drops the largest first, so it cannot hold
// the full tool set (about 28K) and is played on the compact profile
// (reducedTools below; src/lib/harness/types.ts says what that changes).
//
// Lockdown, "removed": each run brings its own custom agent, a file in the
// run's empty folder selected with --agent. `excludeDefaultComponents` drops
// Antigravity's default prompt sections and every built-in tool;
// `inheritCustomizations: false` keeps the admin's own skills, rules,
// plugins, subagents and MCP servers out; ODM's MCP server is the agent's
// only one. --settings, for this run alone and never saved, denies commands,
// file access and web reads, allows only ODM's MCP tools, and starts in the
// Default mode, where no reviewer approves a command on the admin's behalf.
// Signed in, agy lists its built-in tools in the init event before it
// connects to ODM's server, so that list is reported, not checked; every
// tool step is checked, and anything but ODM's tools stops the turn.

import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJsonLine, runProgram, spawnProgram } from "../process.ts";
import { HARNESS_EFFORTS, isHarnessEffort, type HarnessAdapter, type HarnessEffort, type HarnessModel, type HarnessStartOptions } from "../types.ts";

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
export const ANTIGRAVITY_IMAGE_TOOL = "generate_image";

const BASE_DENIED_TOOLS = [
  "command(*)",
  "read_file(*)",
  "write_file(*)",
  "read_url(*)",
  "execute_url(*)",
  "manage_task(*)",
  "schedule(*)",
  "run_workflow(*)",
  "invoke_subagent(*)",
  "define_subagent(*)",
  "send_message(*)",
  "browser_*(*)",
  "search_web(*)",
  "search_marketplace(*)",
  "ask_question(*)",
];

export function antigravitySettings(images = false): Record<string, unknown> {
  return {
    agentMode: "",
    permissions: {
      allow: images ? [`${ANTIGRAVITY_IMAGE_TOOL}(*)`] : ["mcp(odm/*)"],
      deny: images ? [...BASE_DENIED_TOOLS] : [...BASE_DENIED_TOOLS, `${ANTIGRAVITY_IMAGE_TOOL}(*)`],
    },
  };
}

function splitAntigravityModelEffort(id: string): { base: string; effort: HarnessEffort } | null {
  const dash = id.lastIndexOf("-");
  if (dash <= 0) return null;
  const tail = id.slice(dash + 1);
  return isHarnessEffort(tail) ? { base: id.slice(0, dash), effort: tail } : null;
}

// Pure, so scripts/test-harness-antigravity.mjs can pin every flag. A bare
// -p takes the next argument as its prompt, so the prompt is attached empty:
// the turns arrive on stdin.
export function antigravityArgs(options: { model: string; effort: string; images?: boolean }): string[] {
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
    JSON.stringify(antigravitySettings(Boolean(options.images))),
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort && !splitAntigravityModelEffort(options.model)) {
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
  images?: boolean;
}): string {
  const lines = [
    "---",
    `name: ${JSON.stringify(ANTIGRAVITY_AGENT)}`,
    `description: ${JSON.stringify("Open Game Master's storyteller")}`,
    "mainAgent: true",
    "subagent: false",
    `excludeDefaultComponents: ${options.images ? "false" : "true"}`,
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
  const effortsById = new Map<string, Set<HarnessEffort>>();
  for (const raw of output.split("\n")) {
    const line = raw.trim().replace(/^[-*•]\s*/, "");
    if (!line || line.endsWith("...") || line.endsWith(":")) {
      continue;
    }
    const match = /^([a-z0-9][a-z0-9._:/-]*)(?:\s+(.*))?$/i.exec(line);
    if (!match || !/[-.\d]/.test(match[1])) {
      continue;
    }
    let rest = (match[2] ?? "").replace(/^[-–:\s]+|\s+$/g, "");
    if (rest.startsWith("(") && rest.endsWith(")")) {
      rest = rest.slice(1, -1).trim();
    }
    const split = splitAntigravityModelEffort(match[1]);
    const id = split ? split.base : match[1];
    let label = rest || match[1];
    if (split && label.endsWith(")")) {
      const open = label.lastIndexOf(" (");
      if (open > 0 && label.length - open - 3 === split.effort.length) {
        label = label.slice(0, open);
      }
    }
    if (split) {
      let set = effortsById.get(id);
      if (!set) {
        set = new Set<HarnessEffort>();
        effortsById.set(id, set);
      }
      set.add(split.effort);
    }
    if (!models.some((entry) => entry.id === id)) {
      models.push({ id, label });
    }
  }
  return models.map((model) => {
    const set = effortsById.get(model.id);
    return {
      ...model,
      efforts: set ? HARNESS_EFFORTS.filter((effort) => set.has(effort)) : [],
    };
  });
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseAntigravityDefaultEfforts(output: string): HarnessEffort[] | undefined {
  for (const line of output.split("\n")) {
    const parsed = parseJsonLine(line.trim());
    const command = parsed?.command as { data?: { adjustable?: unknown; available?: unknown } } | undefined;
    const data = command?.data;
    if (!data || typeof data !== "object") continue;
    if (data.adjustable === false) return [];
    if (Array.isArray(data.available)) {
      return data.available.filter(isHarnessEffort);
    }
  }
  return undefined;
}

export function parseAntigravityQuota(output: string): { utilization: number; resetsAt?: number; window?: string } | null {
  let best: { utilization: number; resetsAt?: number; window?: string } | null = null;
  for (const line of output.split("\n")) {
    const parsed = parseJsonLine(line.trim());
    const command = parsed?.command as {
      data?: { groups?: Array<{ buckets?: Array<{ remaining_fraction?: unknown; reset_time?: unknown; window?: unknown }> }> };
    } | undefined;
    const groups = command?.data?.groups;
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const bucket of group?.buckets ?? []) {
        if (typeof bucket?.remaining_fraction !== "number") continue;
        const utilization = Math.max(0, Math.min(1, 1 - bucket.remaining_fraction));
        if (!best || utilization > best.utilization) {
          const parsedReset = Date.parse(textOf(bucket.reset_time));
          const window = textOf(bucket.window);
          best = {
            utilization,
            ...(Number.isFinite(parsedReset) ? { resetsAt: parsedReset } : {}),
            ...(window ? { window } : {}),
          };
        }
      }
    }
  }
  return best;
}

function toolName(entry: unknown): string {
  if (typeof entry === "string") {
    return entry;
  }
  return textOf((entry as { name?: unknown } | null)?.name);
}

// Whether a tool a run reports is one ODM allows.
export function antigravityToolAllowed(name: string, images = false): boolean {
  if (images) {
    return name === ANTIGRAVITY_IMAGE_TOOL;
  }
  return name.startsWith(ANTIGRAVITY_MCP_PREFIX) || ANTIGRAVITY_DOORS.has(name);
}

function imageMimeFromPath(filePath: string, bytes: Buffer): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

// The conversation id names a folder under agy's own, so only a plain id is
// used: nothing a run prints can point the lookup anywhere else.
export function safeConversationId(id: string): string {
  return /^[\w-]{1,128}$/.test(id) ? id : "";
}

function findGeneratedImage(
  conversationId: string,
  imageName: string,
  env: Record<string, string | undefined>,
): { filePath: string; bytes: Buffer; mime: string } | null {
  if (!safeConversationId(conversationId)) return null;
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const dirs = [
    path.join(home, ".gemini", "antigravity-cli", "brain", conversationId),
    path.join(home, ".gemini", "antigravity", "brain", conversationId),
  ];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const candidates = names
      .filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry))
      .map((entry) => {
        const filePath = path.join(dir, entry);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(filePath).mtimeMs;
        } catch {}
        return { entry, filePath, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const preferred = imageName
      ? candidates.find((c) => c.entry.startsWith(imageName)) ?? candidates[0]
      : candidates[0];
    if (preferred) {
      try {
        const bytes = readFileSync(preferred.filePath);
        if (bytes.length > 0) {
          return { filePath: preferred.filePath, bytes, mime: imageMimeFromPath(preferred.filePath, bytes) };
        }
      } catch {}
    }
  }
  return null;
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

const QUOTA_EVERY_MS = 5 * 60_000;
let lastQuotaAt = 0;

function quotaDue(now = Date.now()): boolean {
  if (now - lastQuotaAt < QUOTA_EVERY_MS) return false;
  lastQuotaAt = now;
  return true;
}

async function start(options: HarnessStartOptions) {
  // A file in the run's own scratch folder, readable only by this user and
  // deleted with the folder, so neither the token nor a campaign's long
  // prompt appears on a command line.
  const images = Boolean(options.images);
  const agentsDir = path.join(options.cwd, ".agents", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    path.join(agentsDir, `${ANTIGRAVITY_AGENT}.md`),
    antigravityAgentFile({ system: options.system, mcp: options.mcp, toolNames: options.toolNames, images }),
    { mode: 0o600 },
  );
  let turnText = "";
  let closed = false;
  let conversationId = "";
  const emittedImages = new Set<string>();
  const toolSteps = new Set<string>();
  const stop = (message: string) => {
    options.onEvent({ type: "error", kind: "lockdown", message });
    quota?.kill();
    program.kill();
  };
  const emitImageIfPresent = (imageName = "") => {
    if (!images || !conversationId) return;
    const hit = findGeneratedImage(conversationId, imageName, options.env);
    if (hit && !emittedImages.has(hit.filePath)) {
      emittedImages.add(hit.filePath);
      options.onEvent({ type: "image", bytes: hit.bytes, mime: hit.mime });
    }
  };
  const program = spawnProgram(options.binary, antigravityArgs({ model: options.model, effort: options.effort, images }), {
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
      const cid = safeConversationId(textOf(event.conversation_id) || textOf(body.conversation_id));
      if (cid) {
        conversationId = cid;
      }
      if (kind === "init") {
        // agy reports its built-in tool catalog in init.tools and connects to
        // mcpServers after init, so mcp_odm_* tools are not listed here yet.
        // permissions.deny + the step_update check below enforce lockdown.
        const tools = Array.isArray(body.tools) ? body.tools.map(toolName).filter(Boolean) : [];
        options.onEvent({ type: "ready", tools });
        return;
      }
      if (kind === "step_update") {
        const stepType = textOf(body.step_type);
        const name = textOf(body.tool_name) || toolName((body.tool_info as Record<string, unknown> | undefined) ?? null);
        if (stepType === "tool" || name) {
          if (name && !antigravityToolAllowed(name, images)) {
            stop(`Antigravity reached for its own tool ${name}, so the turn was stopped.`);
            return;
          }
          if (images && name === ANTIGRAVITY_IMAGE_TOOL && textOf(body.state) === "DONE") {
            const params = (body.tool_info as { parameters?: { ImageName?: unknown } } | undefined)?.parameters;
            emitImageIfPresent(textOf(params?.ImageName));
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
        if (images && emittedImages.size === 0) {
          emitImageIfPresent();
        }
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
  // The plan's usage, read at most once every QUOTA_EVERY_MS across runs:
  // a summary or a reader call needs no fresh count of its own.
  const quota = quotaDue()
    ? spawnProgram(options.binary, ["-p", "/quota", "--output-format", "json"], {
        cwd: agentsDir,
        env: { ...options.env, ...ANTIGRAVITY_ENV },
        onLine: (line) => {
          if (closed) return;
          const rate = parseAntigravityQuota(line);
          if (rate) {
            options.onEvent({ type: "rate_limit", ...rate });
          }
        },
        onExit: () => undefined,
      })
    : null;
  return {
    send(text: string) {
      program.write(JSON.stringify({ event: "user", message: { content: text } }));
    },
    close() {
      closed = true;
      quota?.kill();
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
  paints: true,
  reducedTools: true,
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
    const effortOut = models.length
      ? await runProgram(binary, ["-p", "/effort", "--output-format", "json"], { ...env, ...ANTIGRAVITY_ENV }, 10_000)
      : null;
    const defaultEfforts = effortOut?.code === 0 ? parseAntigravityDefaultEfforts(effortOut.stdout) : undefined;
    return {
      installed,
      version: version.stdout.trim().split(/\s+/).pop(),
      auth: signedOut
        ? { state: "signed-out" }
        : { state: models.length ? "ready" : "unknown", kind: env.GEMINI_API_KEY ? "api-key" : "subscription" },
      // No list of our own when `agy models` gives none: a name written
      // here would outlive the model it names.
      models,
      ...(defaultEfforts ? { defaultEfforts } : {}),
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
