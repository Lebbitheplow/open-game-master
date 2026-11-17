import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildChildEnv, leaksServerSecret } from "@/lib/harness/child-env";
import { childPath } from "@/lib/harness/discover";
import { ADDON_API_VERSION, type AddonManifest } from "@/lib/addons/manifest";
import { onWindows } from "@/lib/host-platform";
import { McpClient, type McpTool, type ProgressUpdate } from "@/lib/addons/mcp-client";
import { addonDataDir, resolveInside } from "@/lib/addons/paths";
import { grantedPermission, hostFacts, readyAddon, serverVersion, type InstalledAddon } from "@/lib/addons/installed";
import { pythonRequirement, checkRequirement } from "@/lib/addons/requirements";
import { answerSampling, type SamplingContext } from "@/lib/addons/sampling";
import { withExclusive } from "@/lib/addons/resources";
import { effectiveSettings } from "@/lib/addons/settings";
import { installableParts } from "@/lib/addons/parts";
import type { AddonTask } from "@/lib/addons/tasks";

// Running addons. Each is one long-lived program, started the first time
// something needs it and stopped after it has been idle a while, so a server
// with ten addons installed is not running ten programs nobody is using.
//
// Calls to one addon run one at a time, in the order they came. Two reasons:
// a sampling request from the addon belongs to the call in flight (stdio
// carries no other way to tell), and the heavy addons this exists for
// (Blender, a PDF pipeline) would only fight over the machine if run side by
// side.
//
// What reaches the program: an environment built from an allowlist (none of
// the server's keys, src/lib/harness/child-env.ts), its own folders, its
// settings as JSON, and the arguments of each call. What comes back is
// checked by the caller against the extension point's contract before
// anything is written.

const IDLE_STOP_MS = 10 * 60_000;
const START_TIMEOUT_MS = 60_000;
// A call that reports nothing for this long is presumed stuck.
const QUIET_LIMIT_MS = 5 * 60_000;
const CALL_LIMIT_MS = 60 * 60_000;
const LOG_LINES = 300;

type Running = {
  id: string;
  version: string;
  client: McpClient;
  tools: Map<string, McpTool>;
  startedAt: number;
  lastUsed: number;
  queue: Promise<unknown>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  // The call in flight, which owns any sampling request that arrives.
  current: { addon: InstalledAddon; sampling: SamplingContext } | null;
};

type RuntimeState = {
  running: Map<string, Promise<Running>>;
  logs: Map<string, string[]>;
};

declare global {
  var __odmAddonRuntime: RuntimeState | undefined;
}

function state(): RuntimeState {
  return (globalThis.__odmAddonRuntime ??= { running: new Map(), logs: new Map() });
}

export function addonLog(id: string, line: string) {
  const logs = state().logs;
  const lines = logs.get(id) ?? [];
  lines.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
  logs.set(id, lines);
}

export function readAddonLog(id: string): string[] {
  return [...(state().logs.get(id) ?? [])];
}

export function runningAddonIds(): string[] {
  return [...state().running.keys()];
}

async function command(addon: InstalledAddon & { manifest: AddonManifest }): Promise<{ command: string; args: string[] }> {
  const runtime = addon.manifest.runtime;
  if (runtime.kind === "node") {
    const entry = resolveInside(addon.dir, runtime.entry);
    if (!entry) throw new Error(`Its entry ${runtime.entry} is not inside the package.`);
    // The server's own Node: the desktop app's Electron runs it as Node
    // (src/lib/harness/process.ts sets ELECTRON_RUN_AS_NODE for this).
    return { command: process.execPath, args: [entry, ...runtime.args] };
  }
  if (runtime.kind === "python") {
    const entry = resolveInside(addon.dir, runtime.entry);
    if (!entry) throw new Error(`Its entry ${runtime.entry} is not inside the package.`);
    // The environment its setup built, when it has one.
    const venv = venvPython(addon.id);
    if (venv) return { command: venv, args: ["-u", entry, ...runtime.args] };
    const check = await checkRequirement(pythonRequirement(runtime.minVersion), addon.state.settings);
    if (!check.ok) throw new Error(`${check.problem} ${check.hint}`.trim());
    const python = check.found;
    // The Windows launcher picks Python 3 with -3.
    const launcher = /(^|[\\/])py(\.exe)?$/i.test(python) ? ["-3"] : [];
    return { command: python, args: [...launcher, "-u", entry, ...runtime.args] };
  }
  const facts = hostFacts();
  const relative = runtime.executables[`${facts.platform}-${facts.arch}`];
  const program = relative ? resolveInside(addon.dir, relative) : null;
  if (!program) throw new Error(`It ships no program for ${facts.platform}-${facts.arch}.`);
  await chmod(program, 0o755).catch(() => undefined);
  return { command: program, args: [...runtime.args] };
}

// The python of the environment an addon's setup made, if there is one.
export function venvPython(id: string): string | null {
  const data = addonDataDir(id);
  if (!data) return null;
  const candidate = onWindows() ? path.join(data, ".venv", "Scripts", "python.exe") : path.join(data, ".venv", "bin", "python");
  return existsSync(candidate) ? candidate : null;
}

async function environment(addon: InstalledAddon & { manifest: AddonManifest }, program: string): Promise<Record<string, string>> {
  const parent = process.env as Record<string, string | undefined>;
  const base = buildChildEnv(parent, "addon", await childPath(program));
  const leaked = leaksServerSecret(base, parent);
  if (leaked) throw new Error(`Refused to start it: ${leaked} would have reached it.`);
  const dataDir = addonDataDir(addon.id) ?? addon.dir;
  const venv = venvPython(addon.id);
  return {
    ...base,
    ...(venv ? { VIRTUAL_ENV: path.dirname(path.dirname(venv)), PATH: `${path.dirname(venv)}${path.delimiter}${base.PATH ?? ""}` } : {}),
    ODM_ADDON_ID: addon.id,
    ODM_ADDON_VERSION: addon.manifest.version,
    ODM_ADDON_DIR: addon.dir,
    ODM_ADDON_DATA_DIR: dataDir,
    // Files its board views may load by name (src/app/api/addons/[addonId]/
    // assets): a model library, sprite sheets.
    ODM_ADDON_PUBLIC_DIR: path.join(dataDir, "public"),
    ODM_ADDON_SETTINGS: JSON.stringify(effectiveSettings(addon.manifest.settings, addon.state.settings ?? {})),
    // The parts the admin chose that can be fetched here, as a JSON list.
    ODM_ADDON_PARTS: JSON.stringify(installableParts(addon, `${hostFacts().platform}-${hostFacts().arch}`)),
    ODM_ADDON_API_VERSION: String(ADDON_API_VERSION),
    ODM_SERVER_VERSION: serverVersion(),
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

async function start(addon: InstalledAddon & { manifest: AddonManifest }): Promise<Running> {
  const { command: program, args } = await command(addon);
  const env = await environment(addon, program);
  // Its data folder exists before it starts; the addon owns what is in it.
  await mkdir(env.ODM_ADDON_PUBLIC_DIR, { recursive: true });
  addonLog(addon.id, `starting ${addon.manifest.name} ${addon.manifest.version}`);
  let running: Running | null = null;
  const client = new McpClient(program, args, { cwd: addon.dir, env }, {
    onLog: (line) => addonLog(addon.id, line),
    onExit: (code, tail) => {
      addonLog(addon.id, code === null ? "could not be started" : `stopped (exit code ${code})`);
      if (code !== 0 && code !== null && tail.trim()) {
        addonLog(addon.id, tail.trim().split(/\r?\n/).slice(-5).join(" | "));
      }
      const current = state().running.get(addon.id);
      if (running && current) {
        void current.then((entry) => {
          if (entry === running) state().running.delete(addon.id);
        });
      }
    },
    onRequest: async (method, params) => {
      if (method === "ping") return {};
      if (method === "roots/list") return { roots: [] };
      if (method === "elicitation/create") return { action: "decline" };
      if (method === "sampling/createMessage") {
        const owner = running?.current;
        if (!owner) throw new Error("Sampling is only answered while one of this addon's calls is running.");
        if (!grantedPermission(owner.addon, "ai.text")) {
          throw new Error("This addon was not given the storyteller permission (ai.text).");
        }
        return answerSampling(params, owner.sampling);
      }
      throw new Error(`This server does not answer ${method}.`);
    },
  });
  const capabilities = grantedPermission(addon, "ai.text") ? { sampling: {} } : {};
  try {
    await client.initialize(serverVersion(), capabilities, START_TIMEOUT_MS);
    const tools = await client.listTools(START_TIMEOUT_MS);
    running = {
      id: addon.id,
      version: addon.manifest.version,
      client,
      tools: new Map(tools.map((tool) => [tool.name, tool])),
      startedAt: Date.now(),
      lastUsed: Date.now(),
      queue: Promise.resolve(),
      idleTimer: null,
      current: null,
    };
    addonLog(addon.id, `ready: ${tools.map((tool) => tool.name).join(", ") || "no tools"}`);
    return running;
  } catch (error) {
    client.kill();
    throw new Error(
      `${addon.manifest.name} did not start: ${error instanceof Error ? error.message : String(error)}${
        client.program.stderrTail().trim() ? ` (${client.program.stderrTail().trim().split(/\r?\n/).slice(-2).join(" ")})` : ""
      }`,
    );
  }
}

async function ensure(addon: InstalledAddon & { manifest: AddonManifest }): Promise<Running> {
  const runtime = state();
  const existing = runtime.running.get(addon.id);
  if (existing) {
    const entry = await existing.catch(() => null);
    if (entry && entry.client.running && entry.version === addon.manifest.version) return entry;
    runtime.running.delete(addon.id);
    entry?.client.kill();
  }
  const started = start(addon);
  runtime.running.set(addon.id, started);
  started.catch(() => runtime.running.delete(addon.id));
  return started;
}

function armIdleStop(entry: Running) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    if (entry.current) return;
    addonLog(entry.id, "idle, stopping");
    entry.client.kill();
    state().running.delete(entry.id);
  }, IDLE_STOP_MS);
  entry.idleTimer.unref?.();
}

export type CallOptions = {
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
  sampling: SamplingContext;
  // The setup tool, which runs before setup has finished.
  forSetup?: boolean;
  // The run this call belongs to: it waits its turn for the addon's
  // `exclusive` resources (src/lib/addons/resources.ts) and says so there.
  task?: AddonTask;
};

// Calls one of an addon's tools and resolves with the raw MCP result. The
// caller checks it against the extension point's contract.
export async function callAddonTool(
  addonId: string,
  tool: string,
  args: Record<string, unknown>,
  options: CallOptions,
): Promise<unknown> {
  const ready = readyAddon(addonId, { forSetup: options.forSetup });
  if (!ready.ok) throw new Error(ready.error);
  // Waiting for a shared resource comes first, before the program is even
  // started, and the addon is looked at again once it is this run's turn.
  if (options.task && ready.addon.manifest.exclusive.length) {
    const { task, ...rest } = options;
    return withExclusive(ready.addon.manifest.exclusive, task, () => callAddonTool(addonId, tool, args, rest));
  }
  const entry = await ensure(ready.addon);
  if (!entry.tools.has(tool)) {
    throw new Error(`${ready.addon.manifest.name} has no tool named ${tool}; it offers ${[...entry.tools.keys()].join(", ") || "none"}.`);
  }
  const run = async () => {
    if (options.signal?.aborted) throw new Error("Cancelled.");
    entry.current = { addon: ready.addon, sampling: options.sampling };
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let callId = -1;
    const armQuiet = () => {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(() => entry.client.cancel(callId, "The addon reported nothing for five minutes."), QUIET_LIMIT_MS);
    };
    try {
      const call = entry.client.request("tools/call", { name: tool, arguments: args }, {
        timeoutMs: CALL_LIMIT_MS,
        onProgress: (update) => {
          armQuiet();
          options.onProgress?.(update);
        },
      });
      callId = call.id;
      armQuiet();
      const onAbort = () => entry.client.cancel(call.id, "Cancelled.");
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        return await call.promise;
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
      }
    } finally {
      if (quiet) clearTimeout(quiet);
      entry.current = null;
      entry.lastUsed = Date.now();
      armIdleStop(entry);
    }
  };
  const result = entry.queue.then(run, run);
  entry.queue = result.catch(() => undefined);
  return result;
}

// Stops an addon's program, if it is running: before an update swaps its
// folder, when it is switched off or removed, and when its settings change
// (they are read once, at start).
export async function stopAddon(id: string): Promise<void> {
  const runtime = state();
  const existing = runtime.running.get(id);
  if (!existing) return;
  runtime.running.delete(id);
  const entry = await existing.catch(() => null);
  if (entry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    await entry.client.stop();
    addonLog(id, "stopped by the server");
  }
}

// Starts the addon (if needed) and lists its tools: the admin panel's
// "Test it" button, and how an author sees their manifest and their program
// agree.
export async function probeAddon(addonId: string): Promise<{ ok: true; tools: string[]; server: string } | { ok: false; error: string }> {
  const ready = readyAddon(addonId);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const entry = await ensure(ready.addon);
    armIdleStop(entry);
    const info = entry.client.serverInfo;
    return { ok: true, tools: [...entry.tools.keys()], server: `${info.name} ${info.version}`.trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

