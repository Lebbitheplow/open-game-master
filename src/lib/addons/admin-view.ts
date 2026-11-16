import { ADDON_PERMISSIONS, addonFit, CONTRIBUTION_KINDS, type AddonManifest, type ContributionKind, type SettingField } from "@/lib/addons/manifest";
import type { InstallOutcome } from "@/lib/addons/install";
import { conflictReason, hostFacts, listInstalledAddons, needsSetup, type AddonStatus, type InstalledAddon } from "@/lib/addons/installed";
import { githubUpdate } from "@/lib/addons/github";
import { addonRegistryUrl, fetchAddonRegistry, DEFAULT_ADDON_REGISTRY_URL } from "@/lib/addons/registry";
import { sourceFacts, type RegistryAddon } from "@/lib/addons/registry-index";
import { catalogCredit, type AddonCredit } from "@/lib/addons/credits";
import { modifiesClash, type AddonModifies } from "@/lib/addons/manifest-parts";
import { installedCredit } from "@/lib/addons/offered";
import { installableParts, partViews, type PartView } from "@/lib/addons/parts";
import { runningAddonIds } from "@/lib/addons/runtime";
import { downloadApplies, effectiveSettings, missingRequiredSettings } from "@/lib/addons/settings";
import { runningSetup, setupIfDue } from "@/lib/addons/setup";
import { taskView, type TaskView } from "@/lib/addons/tasks";
import { readAddonConfig, type AddonState } from "@/lib/addons/store";
import { addonSupport, type AddonSupport } from "@/lib/addons/support";
import { serverEnv } from "@/lib/server-env";

// The admin panel's picture of addons (GET /api/admin/addons): the installed
// ones with their state, the catalog beside them, and the server-wide
// switches. Secrets are never sent back: the panel learns only whether one
// is set, and a blank field leaves it as it is.

export type AdminAddon = {
  id: string;
  source: AddonState["source"];
  status: AddonStatus;
  problem: string;
  running: boolean;
  enabled: boolean;
  granted: string[];
  installedAt: string;
  version: string;
  settings: Record<string, string | number | boolean>;
  secretsSet: string[];
  manifest: {
    name: string;
    version: string;
    description: string;
    author: string;
    homepage: string;
    license: string;
    runtime: AddonManifest["runtime"]["kind"];
    permissions: string[];
    settings: SettingField[];
    requires: Array<{ program: string; minVersion: string; hint: string; url: string }>;
    contributes: Record<ContributionKind, string[]>;
  } | null;
  // A newer version in the catalog, or a newer release or commit on GitHub,
  // when there is one.
  update: string;
  // Where its files came from: the GitHub repository (owner first, for the
  // card to name), and the release or commit.
  origin: { owner: string; repo: string; url: string; label: string } | null;
  setup: {
    has: boolean;
    needed: boolean;
    error: string;
    diskMB: number;
    steps: string[];
    // The setup running now, for the card to follow after a reload.
    task: TaskView | null;
  };
  // Required settings still empty, by label.
  missingSettings: string[];
  // Addons it cannot run beside (declared by either), installed or not, and
  // whether that one is on now.
  conflicts: Array<{ id: string; name: string; reason: string; on: boolean }>;
  // Shared resources its runs take turns for.
  exclusive: string[];
  // What it changes in the app (two that replace the same thing conflict).
  modifies: AddonModifies[];
  // Its parts: size here, chosen or not, and why one cannot be fetched.
  parts: PartView[];
  // Its creator and their repository, for the card to credit.
  credit: AddonCredit;
};

export type CatalogAddon = RegistryAddon & {
  installed: boolean;
  credit: AddonCredit;
  fit: { ok: boolean; reason: string };
  // Installed addons it cannot run beside.
  clashes: Array<{ name: string; reason: string }>;
};

export type AdminAddonsState = {
  support: AddonSupport;
  host: { platform: string; arch: string; serverVersion: string };
  permissions: typeof ADDON_PERMISSIONS;
  config: { registryUrl: string; envRegistryUrl: string; defaultRegistryUrl: string; allowFiles: boolean };
  installed: AdminAddon[];
  // `bundled`: GitHub could not be reached, so this is the list this version
  // shipped with.
  catalog: { url: string; error: string; skipped: number; bundled: boolean; addons: CatalogAddon[] };
};

function maskSettings(fields: SettingField[], values: AddonState["settings"]) {
  const settings: Record<string, string | number | boolean> = {};
  const secretsSet: string[] = [];
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === "secret") {
      if (typeof value === "string" && value) secretsSet.push(field.key);
      continue;
    }
    if (value !== undefined) settings[field.key] = value;
  }
  return { settings, secretsSet };
}

function originOf(addon: InstalledAddon, listed: RegistryAddon | undefined): AdminAddon["origin"] {
  const github = addon.state.github;
  if (addon.source === "github" && github) {
    const facts = sourceFacts({ repo: github.repo, path: github.path, commit: github.commit || github.tag, tag: github.tag });
    if (!facts) return null;
    const url = github.tag && !github.commit ? `https://github.com/${github.repo}/releases/tag/${encodeURIComponent(github.tag)}` : facts.url;
    return { ...facts, url, label: github.tag ? `release ${github.tag}` : `${github.ref} at ${github.commit.slice(0, 7)}` };
  }
  if (addon.source === "registry" && listed?.source) {
    const facts = sourceFacts(listed.source);
    return facts ? { ...facts, label: listed.source.tag || listed.source.commit.slice(0, 7) } : null;
  }
  return null;
}

// What its setup does on this computer with the settings it has now (a
// download for another platform, or for a quality tier not chosen, is left
// out).
function setupSteps(manifest: AddonManifest, saved: AddonState["settings"], parts: string[]): string[] {
  const setup = manifest.setup;
  if (!setup) return [];
  const facts = hostFacts();
  const settings = effectiveSettings(manifest.settings, saved);
  const steps: string[] = [];
  if (setup.python) steps.push(`Python packages from ${setup.python.requirements}`);
  for (const download of setup.downloads) {
    if (!downloadApplies(download, `${facts.platform}-${facts.arch}`, settings, parts)) continue;
    const part = download.part ? manifest.parts.find((entry) => entry.id === download.part)?.title : "";
    steps.push(`download ${download.id}${part ? ` for ${part}` : ""} (${Math.max(1, Math.round(download.bytes / 1024 / 1024))} MB)`);
  }
  if (setup.tool) steps.push("a step of its own");
  return steps;
}

function conflictsOf(addon: InstalledAddon, all: InstalledAddon[]): AdminAddon["conflicts"] {
  const out: AdminAddon["conflicts"] = [];
  for (const other of all) {
    if (other.id === addon.id) continue;
    const reason = conflictReason(addon, other);
    if (reason) out.push({ id: other.id, name: other.manifest?.name ?? other.id, reason, on: other.state.enabled });
  }
  // Declared against addons this server does not have, so the admin knows
  // before installing one.
  for (const entry of addon.manifest?.conflicts ?? []) {
    if (!out.some((known) => known.id === entry.id)) out.push({ id: entry.id, name: entry.id, reason: entry.reason, on: false });
  }
  return out;
}

export function adminAddon(
  addon: InstalledAddon,
  running: Set<string>,
  catalog: RegistryAddon[],
  githubUpdates: Map<string, string> = new Map(),
  all: InstalledAddon[] = listInstalledAddons(),
): AdminAddon {
  const manifest = addon.manifest;
  const masked = maskSettings(manifest?.settings ?? [], addon.state.settings);
  const listed = catalog.find((entry) => entry.id === addon.id);
  const setupTask = runningSetup(addon.id);
  const facts = hostFacts();
  const platformKey = `${facts.platform}-${facts.arch}`;
  const withManifest = manifest ? { ...addon, manifest } : null;
  return {
    id: addon.id,
    source: addon.source,
    status: addon.status,
    problem: addon.problem,
    running: running.has(addon.id),
    enabled: addon.state.enabled,
    granted: addon.state.granted,
    installedAt: addon.state.installedAt,
    version: manifest?.version ?? addon.state.version,
    ...masked,
    manifest: manifest
      ? {
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          homepage: manifest.homepage ?? "",
          license: manifest.license,
          runtime: manifest.runtime.kind,
          permissions: manifest.permissions,
          settings: manifest.settings,
          requires: manifest.requires.map((entry) => ({
            program: entry.program,
            minVersion: entry.minVersion ?? "",
            hint: entry.hint,
            url: entry.url ?? "",
          })),
          contributes: Object.fromEntries(
            CONTRIBUTION_KINDS.map((kind) => [kind, manifest.contributes[kind].map((entry) => entry.title)]),
          ) as Record<ContributionKind, string[]>,
        }
      : null,
    update:
      addon.source === "github"
        ? (githubUpdates.get(addon.id) ?? "")
        : listed && addon.source === "registry" && listed.version !== (manifest?.version ?? addon.state.version)
          ? `v${listed.version}`
          : "",
    origin: originOf(addon, listed),
    setup: {
      has: Boolean(manifest?.setup),
      // Not yet run for these files, whatever else it is waiting for.
      needed: manifest ? needsSetup(manifest, addon.state) : false,
      error: addon.state.setupError,
      diskMB: manifest?.setup?.diskMB ?? 0,
      steps: withManifest ? setupSteps(withManifest.manifest, addon.state.settings, installableParts(withManifest, platformKey)) : [],
      task: setupTask ? taskView(setupTask) : null,
    },
    missingSettings: manifest ? missingRequiredSettings(manifest.settings, addon.state.settings).map((field) => field.label) : [],
    conflicts: conflictsOf(addon, all),
    exclusive: manifest?.exclusive ?? [],
    modifies: manifest?.modifies ?? [],
    parts: withManifest ? partViews(withManifest, platformKey) : [],
    credit: installedCredit(addon),
  };
}

export async function adminAddonsState(): Promise<AdminAddonsState> {
  const config = readAddonConfig();
  const support = addonSupport();
  const host = hostFacts();
  const url = support.supported ? addonRegistryUrl() : "";
  const fetched = url ? await fetchAddonRegistry(url) : null;
  const catalog = fetched?.ok ? fetched.addons : [];
  const installed = listInstalledAddons();
  const running = new Set(runningAddonIds());
  const installedIds = new Set(installed.map((addon) => addon.id));
  // Each GitHub-installed addon looks for a newer release or commit (cached
  // for a while in src/lib/addons/github.ts).
  const githubUpdates = new Map(
    await Promise.all(
      installed
        .filter((addon) => addon.source === "github" && addon.state.github)
        .map(async (addon) => [addon.id, await githubUpdate(addon.state.github!)] as [string, string]),
    ),
  );
  return {
    support,
    host,
    permissions: ADDON_PERMISSIONS,
    config: {
      registryUrl: config.registryUrl,
      envRegistryUrl: serverEnv("ADDON_REGISTRY_URL"),
      defaultRegistryUrl: DEFAULT_ADDON_REGISTRY_URL,
      allowFiles: config.allowFiles,
    },
    installed: installed.map((addon) => adminAddon(addon, running, catalog, githubUpdates, installed)),
    catalog: {
      url,
      error: fetched && !fetched.ok ? fetched.error : "",
      skipped: fetched?.ok ? fetched.skipped : 0,
      bundled: Boolean(fetched?.ok && fetched.bundled),
      addons: catalog.map((entry) => {
        const fit = addonFit(
          { apiVersion: entry.apiVersion, platforms: entry.platforms, minServerVersion: entry.minServerVersion, runtime: { kind: "node", entry: "x", args: [] } },
          host,
        );
        // Either side may say it: the entry names an installed addon, an
        // installed addon names the entry, or both replace the same thing.
        const clashes = installed
          .filter((addon) => addon.id !== entry.id)
          .map((addon) => ({
            name: addon.manifest?.name ?? addon.id,
            reason:
              entry.conflicts.find((conflict) => conflict.id === addon.id)?.reason ??
              addon.manifest?.conflicts.find((conflict) => conflict.id === entry.id)?.reason ??
              modifiesClash(entry.modifies, addon.manifest?.modifies ?? []),
          }))
          .filter((clash) => clash.reason);
        return {
          ...entry,
          installed: installedIds.has(entry.id),
          credit: catalogCredit(entry),
          fit: fit.ok ? { ok: true, reason: "" } : fit,
          clashes,
        };
      }),
    },
  };
}

// The answer to any install: what went in, the permissions it newly asks
// for, and the setup it started.
export async function installedResponse(outcome: InstallOutcome & { label?: string }, user: { id: string }) {
  if (!outcome.ok) {
    return Response.json({ error: outcome.error, replaces: outcome.replaces ?? null }, { status: outcome.status });
  }
  return Response.json({
    installed: { id: outcome.manifest.id, name: outcome.manifest.name, version: outcome.manifest.version },
    updated: outcome.updated,
    newPermissions: outcome.newPermissions,
    from: outcome.label ?? "",
    setupTask: await setupIfDue(outcome.manifest.id, user),
  });
}
