import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import packageJson from "../../../package.json";
import {
  ADDON_ID,
  ADDON_PERMISSION_IDS,
  addonFit,
  addonManifestSchema,
  describeManifestError,
  type AddonManifest,
} from "@/lib/addons/manifest";
import { modifiesClash } from "@/lib/addons/manifest-parts";
import { packageDir } from "@/lib/addons/paths";
import { missingRequiredSettings } from "@/lib/addons/settings";
import { readAddonConfig, type AddonState } from "@/lib/addons/store";
import { addonSupport, hostArch } from "@/lib/addons/support";
import { hostPlatform } from "@/lib/host-platform";
import { compareNames } from "@/lib/language/text-logic";
import { serverEnv } from "@/lib/server-env";

// The addons this server has, read from both halves: the state the admin
// set (src/lib/addons/store.ts) and the packages on disk. An addon is only
// "ready" when its files are there, its manifest reads, it fits this
// server, it is switched on, the admin accepted the permissions it asks for
// now (an update that asks for more waits for a new yes), its required
// settings are filled in, its setup has finished, and no addon it conflicts
// with is switched on.
//
// Development folders named in ODM_ADDON_DEV_DIRS are listed beside the
// installed ones (source "dev"), read live from the author's working copy so
// an edit needs no repackaging. They are for the person writing an addon,
// on their own server; the panel marks them.

export type AddonStatus =
  | "ready"
  | "disabled"
  | "needs-approval"
  | "needs-settings"
  | "needs-setup"
  | "conflict"
  | "missing-files"
  | "broken"
  | "unfit"
  | "unsupported";

export type InstalledAddon = {
  id: string;
  dir: string;
  source: AddonState["source"];
  state: AddonState;
  manifest: AddonManifest | null;
  status: AddonStatus;
  // Why it is not ready, in words for the admin.
  problem: string;
};

export function serverVersion(): string {
  return packageJson.version;
}

export function hostFacts() {
  return { platform: hostPlatform(), arch: hostArch(), serverVersion: serverVersion() };
}

type CachedManifest = { mtimeMs: number; size: number; result: { manifest: AddonManifest } | { error: string } };

declare global {
  var __odmAddonManifests: Map<string, CachedManifest> | undefined;
}

// Reads <dir>/addon.json, remembered until the file changes.
export function readManifestAt(dir: string): { manifest: AddonManifest } | { error: string } {
  const file = path.join(dir, "addon.json");
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return { error: "Its files are missing from this server. Reinstall it." };
  }
  const cache = (globalThis.__odmAddonManifests ??= new Map());
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.result;
  }
  let result: CachedManifest["result"];
  try {
    const parsed = addonManifestSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    result = parsed.success
      ? { manifest: parsed.data }
      : { error: `Its addon.json does not read: ${describeManifestError(parsed.error)}` };
  } catch {
    result = { error: "Its addon.json is not valid JSON." };
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  return result;
}

export function devAddonDirs(): string[] {
  return serverEnv("ODM_ADDON_DEV_DIRS")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function samePermissions(granted: string[], asked: string[]): boolean {
  const known = new Set(granted);
  return asked.every((permission) => known.has(permission));
}

function describe(
  id: string,
  dir: string,
  source: AddonState["source"],
  state: AddonState,
): InstalledAddon {
  const read = readManifestAt(dir);
  const base = { id, dir, source, state };
  if ("error" in read) {
    const missing = read.error.startsWith("Its files are missing");
    return { ...base, manifest: null, status: missing ? "missing-files" : "broken", problem: read.error };
  }
  const manifest = read.manifest;
  if (manifest.id !== id) {
    return { ...base, manifest: null, status: "broken", problem: `Its addon.json names "${manifest.id}", not "${id}".` };
  }
  const support = addonSupport();
  if (!support.supported) {
    return { ...base, manifest, status: "unsupported", problem: support.reason };
  }
  const fit = addonFit(manifest, hostFacts());
  if (!fit.ok) {
    return { ...base, manifest, status: "unfit", problem: fit.reason };
  }
  if (!state.enabled) {
    return { ...base, manifest, status: "disabled", problem: "" };
  }
  if (!samePermissions(state.granted, manifest.permissions)) {
    return {
      ...base,
      manifest,
      status: "needs-approval",
      problem: "This version asks for permissions you have not accepted yet.",
    };
  }
  const missing = missingRequiredSettings(manifest.settings, state.settings);
  if (missing.length) {
    return {
      ...base,
      manifest,
      status: "needs-settings",
      problem: `Fill in its settings before it is set up: ${missing.map((field) => field.label).join(", ")}.`,
    };
  }
  if (needsSetup(manifest, state)) {
    return {
      ...base,
      manifest,
      status: "needs-setup",
      problem: state.setupError ? `Its setup did not finish: ${state.setupError}` : "Run its setup before it is used.",
    };
  }
  return { ...base, manifest, status: "ready", problem: "" };
}

const BLANK_STATE: AddonState = {
  version: "",
  source: "dev",
  github: null,
  setupVersion: "",
  setupError: "",
  sha256: "",
  installedAt: "",
  enabled: false,
  granted: [],
  settings: {},
  parts: null,
  fetchedFrom: null,
};

export function listInstalledAddons(): InstalledAddon[] {
  const config = readAddonConfig();
  const out: InstalledAddon[] = [];
  const seen = new Set<string>();
  // A development folder wins over an installed copy of the same id, which
  // is what an author working on an update wants.
  for (const dir of devAddonDirs()) {
    const read = readManifestAt(dir);
    const id = "manifest" in read ? read.manifest.id : path.basename(dir);
    if (!ADDON_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const saved = config.addons[id];
    out.push(describe(id, dir, "dev", saved ? { ...saved, source: "dev" } : BLANK_STATE));
  }
  for (const [id, state] of Object.entries(config.addons)) {
    if (seen.has(id) || state.source === "dev") continue;
    const dir = packageDir(id);
    if (!dir) continue;
    seen.add(id);
    out.push(describe(id, dir, state.source, state));
  }
  return markConflicts(out).sort((a, b) => compareNames(a.manifest?.name ?? a.id, b.manifest?.name ?? b.id));
}

// Switched on, and able to run but for its own setup or settings: what a
// conflict is measured against.
const LIVE: AddonStatus[] = ["ready", "needs-approval", "needs-settings", "needs-setup", "conflict"];

function live(addon: InstalledAddon): boolean {
  return addon.state.enabled && Boolean(addon.manifest) && LIVE.includes(addon.status);
}

// Why two addons cannot run together, or "": whichever of them names the
// other under `conflicts`, or both replacing the same thing under
// `modifies`, which needs neither to know the other.
export function conflictReason(a: Pick<InstalledAddon, "id" | "manifest">, b: Pick<InstalledAddon, "id" | "manifest">): string {
  return (
    a.manifest?.conflicts.find((entry) => entry.id === b.id)?.reason ??
    b.manifest?.conflicts.find((entry) => entry.id === a.id)?.reason ??
    modifiesClash(a.manifest?.modifies ?? [], b.manifest?.modifies ?? [])
  );
}

// The switched-on addons this one cannot run beside.
export function conflictsWith(addon: Pick<InstalledAddon, "id" | "manifest">, all: InstalledAddon[]): Array<{ id: string; name: string; reason: string }> {
  return all
    .filter((other) => other.id !== addon.id && live(other))
    .map((other) => ({ id: other.id, name: other.manifest?.name ?? other.id, reason: conflictReason(addon, other) }))
    .filter((entry) => entry.reason);
}

// Two switched-on addons that conflict (an update that started declaring
// it, a restored backup): neither runs until one is switched off. Switching
// one on beside the other is refused before it gets here.
function markConflicts(list: InstalledAddon[]): InstalledAddon[] {
  return list.map((addon) => {
    if (!live(addon)) return addon;
    const clashes = conflictsWith(addon, list);
    if (!clashes.length) return addon;
    const names = clashes.map((entry) => `${entry.name} (${entry.reason})`).join("; ");
    return { ...addon, status: "conflict" as const, problem: `It cannot run beside ${names}. Switch one of them off.` };
  });
}

export function findInstalledAddon(id: string): InstalledAddon | null {
  return listInstalledAddons().find((addon) => addon.id === id) ?? null;
}

// Whether this version's setup has yet to finish.
export function needsSetup(manifest: AddonManifest, state: AddonState): boolean {
  return Boolean(manifest.setup) && state.setupVersion !== manifest.version;
}

// An addon that may run right now, or why not. Its own setup may start it
// before setup has finished (that is what setup is for), and nothing else may.
export function readyAddon(
  id: string,
  options: { forSetup?: boolean } = {},
): { ok: true; addon: InstalledAddon & { manifest: AddonManifest } } | { ok: false; error: string } {
  const addon = findInstalledAddon(id);
  if (!addon) {
    return { ok: false, error: "That addon is not installed on this server." };
  }
  const runnable = addon.status === "ready" || (options.forSetup === true && addon.status === "needs-setup");
  if (!runnable || !addon.manifest) {
    return {
      ok: false,
      error: addon.problem || `${addon.manifest?.name ?? id} is switched off. An admin can switch it on under Admin, Addons.`,
    };
  }
  return { ok: true, addon: addon as InstalledAddon & { manifest: AddonManifest } };
}

// The permissions an addon was granted that the server enforces.
export function grantedPermission(addon: InstalledAddon, permission: (typeof ADDON_PERMISSION_IDS)[number]): boolean {
  return Boolean(addon.manifest?.permissions.includes(permission) && addon.state.granted.includes(permission));
}
