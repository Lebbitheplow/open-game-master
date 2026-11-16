import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { archiveContentHash, readArchiveManifest, unpackArchive } from "@/lib/addons/archive";
import { linkFor, parseGitHubLink, resolveGitHubLink, type GitHubLink } from "@/lib/addons/github";
import { hostFacts, readManifestAt } from "@/lib/addons/installed";
import { addonFit, addonManifestSchema, describeManifestError, type AddonManifest } from "@/lib/addons/manifest";
import { addonDataDir, packageDir, packagesDir, resolveInside } from "@/lib/addons/paths";
import { chosenParts } from "@/lib/addons/settings";
import type { RegistryAddon } from "@/lib/addons/registry-index";
import { fetchAddonFolder, githubReader, readRepoFile, type RepoFile, type RepoReader } from "@/lib/addons/repo-fetch";
import { stopAddon } from "@/lib/addons/runtime";
import { cancelSetup, setupRunning } from "@/lib/addons/setup";
import { addonState, forgetAddonState, setAddonState, type AddonState, type GitHubOrigin } from "@/lib/addons/store";
import { serverEnv } from "@/lib/server-env";

// Installing, updating and removing addons. Admin-only at every route that
// reaches here. An addon comes from its repository at one commit, fetched
// file by file (from the addon list, or a GitHub link the admin pasted), or
// from a .zip of its folder the admin picked. An install is all or nothing:
// the files are checked (manifest, fit, safe paths, git's hashes, the audited
// content hash for the list, the files the manifest names) beside the live
// copy, and only then swapped in.

export type InstallOutcome =
  | { ok: true; manifest: AddonManifest; updated: boolean; newPermissions: string[] }
  // `replaces`: an addon with this id is installed from somewhere else, and
  // the install waits for the admin to say to replace it.
  | { ok: false; status: number; error: string; replaces?: { id: string; name: string; from: string } };

const busy = new Set<string>();

function fail(status: number, error: string): InstallOutcome {
  return { ok: false, status, error };
}

// Where an installed copy came from, in words for the admin.
function describeSource(state: AddonState): string {
  if (state.source === "registry") return "the addon list";
  if (state.source === "github" && state.github) return `GitHub (${state.github.repo}${state.github.path ? `/${state.github.path}` : ""})`;
  return "a file";
}

// Whether an install comes from where the installed copy did: the catalog
// again, the same repository and folder, or a file again (an author
// reinstalling their own build). Anything else is a different addon that
// happens to share the id, or a fork of it, and replacing it is the admin's
// call.
function sameSource(previous: AddonState, source: AddonState["source"], github?: GitHubOrigin): boolean {
  if (previous.source !== source) return false;
  if (source !== "github") return true;
  return (
    (previous.github?.repo ?? "").toLowerCase() === (github?.repo ?? "").toLowerCase() &&
    (previous.github?.path ?? "") === (github?.path ?? "")
  );
}

// The files a manifest promises, checked in the unpacked folder: the
// program for this platform and every board view's page.
function missingFiles(manifest: AddonManifest, dir: string, platformKey: string): string | null {
  const wanted: string[] = [];
  if (manifest.runtime.kind === "executable") {
    const program = manifest.runtime.executables[platformKey];
    if (program) wanted.push(program);
  } else {
    wanted.push(manifest.runtime.entry);
  }
  for (const view of manifest.contributes.boardViews) wanted.push(view.entry);
  for (const relative of wanted) {
    const resolved = resolveInside(dir, relative);
    if (!resolved || !existsSync(resolved)) return relative;
  }
  return null;
}

type InstallSource = Exclude<AddonState["source"], "dev">;
// Where on GitHub the files came from, for an install from a link; `id` for
// an update, which must hold the addon it updates; `replace` when the admin
// agreed to replace a copy of this id that came from somewhere else.
// `parts`: the parts the admin picked before an install from the list
// (left out, an update keeps the ones chosen before).
type From = { github?: GitHubOrigin; id?: string; replace?: boolean; parts?: string[]; fetchedFrom?: AddonState["fetchedFrom"] };
// An entry on the addon list: the files must be the ones that were audited.
type Expected = Pick<RegistryAddon, "id" | "version" | "contentSha256">;

type Plan = { target: string; dataDir: string; previous: AddonState | null; replacing: boolean };

function readManifest(raw: unknown): { manifest: AddonManifest } | InstallOutcome {
  const parsed = addonManifestSchema.safeParse(raw);
  return parsed.success ? { manifest: parsed.data } : fail(400, `That addon's addon.json does not read: ${describeManifestError(parsed.error)}`);
}

// Everything that can be said from the manifest alone, before a file lands.
function preflight(manifest: AddonManifest, source: InstallSource, expected: Expected | undefined, from: From): Plan | InstallOutcome {
  if (expected && (manifest.id !== expected.id || manifest.version !== expected.version)) {
    return fail(409, `The list has ${expected.id} ${expected.version}, but the repository holds ${manifest.id} ${manifest.version} at that commit. Nothing was installed.`);
  }
  if (from.id && manifest.id !== from.id) {
    return fail(409, `The repository now holds ${manifest.id}, not ${from.id}. Nothing was installed.`);
  }
  const fit = addonFit(manifest, hostFacts());
  if (!fit.ok) return fail(400, fit.reason);
  const target = packageDir(manifest.id);
  const dataDir = addonDataDir(manifest.id);
  if (!target || !dataDir) return fail(400, "That addon has an unusable id.");
  const previous = addonState(manifest.id);
  if (previous?.source === "dev") {
    return fail(409, `${manifest.id} is loaded from a development folder (ODM_ADDON_DEV_DIRS) on this server.`);
  }
  const replacing = Boolean(previous) && !sameSource(previous!, source, from.github);
  if (replacing && !from.replace) {
    const existing = readManifestAt(target);
    const name = "manifest" in existing ? existing.manifest.name : manifest.id;
    return {
      ok: false,
      status: 409,
      error: `${name} (${manifest.id}) is already installed from ${describeSource(previous!)}. Replace it with this one?`,
      replaces: { id: manifest.id, name, from: describeSource(previous!) },
    };
  }
  if (busy.has(manifest.id)) return fail(409, "That addon is already being installed.");
  if (setupRunning(manifest.id)) return fail(409, "Its setup is running. Let it finish, or cancel it, before installing over it.");
  return { target, dataDir, previous, replacing };
}

type Staged = { ok: true; contentSha256: string } | { ok: false; status: number; error: string };

// Windows refuses to move a folder while anything still holds a file in it
// (EBUSY/EPERM): a program that has just been told to stop, an indexer, a
// virus scanner. The move is tried again for a few seconds before it fails.
async function renameWhenFree(from: string, to: string): Promise<void> {
  const codes = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!codes.has(code) || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 + attempt * 50));
    }
  }
}

// Puts the files beside the live copy with `stage`, checks them, and only
// then swaps them in. All or nothing.
async function stageAndSwap(
  manifest: AddonManifest,
  plan: Plan,
  source: InstallSource,
  from: From,
  stage: (staging: string) => Promise<Staged>,
): Promise<InstallOutcome> {
  const facts = hostFacts();
  busy.add(manifest.id);
  const staging = path.join(packagesDir(), `.staging-${crypto.randomUUID()}`);
  const retired = path.join(packagesDir(), `.retired-${crypto.randomUUID()}`);
  try {
    await mkdir(packagesDir(), { recursive: true });
    const staged = await stage(staging);
    if (!staged.ok) return fail(staged.status, staged.error);
    const missing = missingFiles(manifest, staging, `${facts.platform}-${facts.arch}`);
    if (missing) return fail(400, `The manifest names ${missing}, which is not in the addon's folder.`);
    // The running copy is stopped before its folder moves.
    await stopAddon(manifest.id);
    const updated = existsSync(plan.target);
    if (updated) await renameWhenFree(plan.target, retired);
    await renameWhenFree(staging, plan.target);
    await mkdir(plan.dataDir, { recursive: true });
    // A replacement from somewhere else is new code: it starts switched off
    // and asks for its permissions again. Its settings and data folder stay,
    // which is what moving to a fork of the same addon wants.
    const { previous, replacing } = plan;
    const granted = replacing ? [] : (previous?.granted ?? []);
    const parts = from.parts ? chosenParts(manifest, from.parts) : (previous?.parts ?? null);
    const sameParts = chosenParts(manifest, parts).join("|") === chosenParts(manifest, previous?.parts ?? null).join("|");
    setAddonState(manifest.id, {
      version: manifest.version,
      source,
      github: from.github ?? null,
      fetchedFrom: from.fetchedFrom ?? null,
      parts,
      // Different files, or different parts, mean the setup runs again, even
      // at the same version (a branch moves on without bumping it).
      setupVersion: previous?.sha256 === staged.contentSha256 && sameParts ? previous.setupVersion : "",
      setupError: "",
      sha256: staged.contentSha256,
      installedAt: new Date().toISOString(),
      enabled: replacing ? false : (previous?.enabled ?? false),
      granted,
      settings: previous?.settings ?? {},
    });
    return {
      ok: true,
      manifest,
      updated,
      newPermissions: manifest.permissions.filter((permission) => !granted.includes(permission)),
    };
  } catch (error) {
    return fail(500, `Could not write the addon to disk: ${error instanceof Error ? error.message : "unknown error"}.`);
  } finally {
    busy.delete(manifest.id);
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await rm(retired, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

// An addon's folder from its repository at one commit, file by file
// (src/lib/addons/repo-fetch.ts): addon.json first, so a wrong id, version
// or platform is refused before anything else is fetched.
export async function installFromRepo(
  reader: RepoReader,
  source: InstallSource,
  expected: Expected | undefined,
  from: From = {},
): Promise<InstallOutcome> {
  let files: RepoFile[];
  let raw: unknown;
  try {
    files = await reader.list();
    const manifestFile = files.find((file) => file.path === "addon.json");
    if (!manifestFile) return fail(400, `There is no addon.json in ${reader.label}.`);
    raw = JSON.parse((await readRepoFile(reader, manifestFile, 256 * 1024)).toString("utf8"));
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : String(error));
  }
  const read = readManifest(raw);
  if (!("manifest" in read)) return read;
  const plan = preflight(read.manifest, source, expected, from);
  if (!("target" in plan)) return plan;
  return stageAndSwap(read.manifest, plan, source, from, async (staging) => {
    const fetched = await fetchAddonFolder(reader, staging, { files });
    if (!fetched.ok) return { ok: false, status: 502, error: fetched.error };
    if (expected && fetched.contentSha256 !== expected.contentSha256) {
      return { ok: false, status: 409, error: "The files do not match the ones that were audited for the list, so nothing was installed." };
    }
    return { ok: true, contentSha256: fetched.contentSha256 };
  });
}

// A .zip of an addon's folder the admin picked (for trying an addon, or
// running their own). `expected` holds it to an entry on the list.
export async function installAddonArchive(
  bytes: Buffer,
  source: InstallSource,
  expected?: Expected,
  from: From & { subdir?: string } = {},
): Promise<InstallOutcome> {
  const subdir = from.subdir ?? "";
  const content = await archiveContentHash(bytes, subdir);
  if (!content.ok) return fail(400, content.error);
  if (expected && content.sha256 !== expected.contentSha256) {
    return fail(409, "The files do not match the ones that were audited for the list, so nothing was installed.");
  }
  const archived = await readArchiveManifest(bytes, subdir);
  if (!archived.ok) return fail(400, archived.error);
  const read = readManifest(archived.raw);
  if (!("manifest" in read)) return read;
  const plan = preflight(read.manifest, source, expected, from);
  if (!("target" in plan)) return plan;
  return stageAndSwap(read.manifest, plan, source, from, async (staging) => {
    const unpacked = await unpackArchive(bytes, staging, subdir);
    return unpacked.ok ? { ok: true, contentSha256: content.sha256 } : { ok: false, status: 400, error: unpacked.error };
  });
}

function githubReaderFor(repo: string, commit: string, folder: string): RepoReader {
  return githubReader({ repo, commit, folder, apiBase: serverEnv("ADDON_GITHUB_API_BASE"), rawBase: serverEnv("ADDON_GITHUB_RAW_BASE") });
}

// An addon on the list: its author's repository at the audited commit,
// checked against the entry's content hash before it is swapped in.
export async function installFromRegistry(entry: RegistryAddon, options: { replace?: boolean; parts?: string[] } = {}): Promise<InstallOutcome> {
  return installFromRepo(githubReaderFor(entry.source.repo, entry.source.commit, entry.source.path), "registry", entry, {
    replace: options.replace,
    parts: options.parts,
    fetchedFrom: { repo: entry.source.repo, commit: entry.source.commit },
  });
}

async function installFromLink(link: GitHubLink, options: { id?: string; replace?: boolean } = {}): Promise<InstallOutcome & { label?: string }> {
  const resolved = await resolveGitHubLink(link);
  if ("error" in resolved) return fail(502, resolved.error);
  const outcome = await installFromRepo(githubReaderFor(resolved.origin.repo, resolved.origin.commit, link.path), "github", undefined, {
    github: resolved.origin,
    fetchedFrom: { repo: resolved.origin.repo, commit: resolved.origin.commit },
    id: options.id,
    replace: options.replace,
  });
  return outcome.ok ? { ...outcome, label: resolved.label } : outcome;
}

// An addon from a GitHub link the admin pasted (see src/lib/addons/github.ts
// for the forms it reads).
export async function installFromGitHub(input: string, options: { replace?: boolean } = {}): Promise<InstallOutcome & { label?: string }> {
  const link = parseGitHubLink(input);
  if (!link) {
    return fail(400, "That is not a GitHub repository link. Paste owner/repo, the repository's page, a release page, or a folder's page.");
  }
  return installFromLink(link, { replace: options.replace });
}

// A GitHub-installed addon brought up to its newest release, or the newest
// commit on its branch.
export async function updateFromGitHub(id: string): Promise<InstallOutcome & { label?: string }> {
  const state = addonState(id);
  const link = state?.source === "github" && state.github ? linkFor(state.github) : null;
  if (!link) return fail(400, "That addon was not installed from GitHub.");
  return installFromLink(link, { id });
}

export async function removeAddon(id: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const state = addonState(id);
  const target = packageDir(id);
  const dataDir = addonDataDir(id);
  if (!state || !target || !dataDir) return { ok: false, status: 404, error: "That addon is not installed." };
  if (state.source === "dev") {
    return { ok: false, status: 400, error: "A development folder is not installed; take it out of ODM_ADDON_DEV_DIRS instead." };
  }
  cancelSetup(id);
  await stopAddon(id);
  forgetAddonState(id);
  await rm(target, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  return { ok: true };
}
