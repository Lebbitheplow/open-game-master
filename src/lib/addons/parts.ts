import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { InstalledAddon } from "@/lib/addons/installed";
import type { AddonManifest, SetupDownload } from "@/lib/addons/manifest";
import type { GitHubFolder } from "@/lib/addons/manifest-parts";
import { resolveInside } from "@/lib/addons/paths";
import { folderFingerprint, fetchRepoFolder, githubReader, type RepoFile } from "@/lib/addons/repo-fetch";
import { chosenParts, partFitsHere } from "@/lib/addons/settings";
import { serverEnv } from "@/lib/server-env";

// An addon's parts on this server (the manifest's `parts`,
// src/lib/addons/manifest-parts.ts): which can be fetched here, which the
// admin chose, and where a part kept in a GitHub repository comes from.
//
// A part's https downloads can be fetched wherever the addon runs. A folder
// of a separate repository names its own commit. A folder of the addon's
// own repository is fetched at the commit the addon was installed from, so
// it needs an addon that came from the list or a GitHub link; one installed
// from a .zip has no repository to fetch it from, and a development folder
// reads it from the working copy around it.

type Addon = Pick<InstalledAddon, "id" | "dir" | "source" | "state"> & { manifest: AddonManifest };

export type PartSource = { repo: string; commit: string; path: string } | { local: string } | { error: string };

// Where a repository folder comes from for this copy of the addon.
export function folderSource(addon: Addon, folder: GitHubFolder): PartSource {
  if (folder.repo && folder.commit) return { repo: folder.repo, commit: folder.commit, path: folder.path };
  const fetched = addon.state.fetchedFrom ?? (addon.state.github?.commit ? { repo: addon.state.github.repo, commit: addon.state.github.commit } : null);
  if (fetched && addon.source !== "file" && addon.source !== "dev") return { repo: fetched.repo, commit: fetched.commit, path: folder.path };
  if (addon.source === "dev") {
    const root = gitRoot(addon.dir);
    const local = root ? resolveInside(root, folder.path || ".") : null;
    return local ? { local } : { error: "It is a development folder outside a git working copy, so its repository's folders cannot be found." };
  }
  if (addon.source === "registry") return { error: "Install it again from the list to fetch this part." };
  return { error: "It was installed from a file, which holds no repository to fetch this part from. Install it from the list or GitHub." };
}

// The working copy a development folder sits in, a few levels up at most.
function gitRoot(dir: string): string | null {
  let current = dir;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export type PartView = { id: string; title: string; description: string; bytes: number; chosen: boolean; available: boolean; reason: string };

// Each part as the admin sees it: its size on this computer, whether it is
// chosen, and why it cannot be fetched here when it cannot.
export function partViews(addon: Addon, platformKey: string): PartView[] {
  const chosen = chosenParts(addon.manifest, addon.state.parts);
  const bytesFor = (id: string) => partDownloads(addon.manifest, id, platformKey).reduce((sum, download) => sum + download.bytes, 0);
  return addon.manifest.parts.map((part) => {
    const reason = partProblem(addon, part.id, platformKey);
    return {
      id: part.id,
      title: part.title,
      description: part.description,
      bytes: bytesFor(part.id),
      chosen: chosen.includes(part.id),
      available: !reason,
      reason,
    };
  });
}

function partDownloads(manifest: AddonManifest, partId: string, platformKey: string): SetupDownload[] {
  return (manifest.setup?.downloads ?? []).filter((download) => download.part === partId && (!download.platforms || download.platforms.includes(platformKey)));
}

// Why a part cannot be fetched on this computer for this copy, or "".
export function partProblem(addon: Addon, partId: string, platformKey: string): string {
  if (!partFitsHere(addon.manifest, partId, platformKey)) return "Not made for this computer.";
  for (const download of partDownloads(addon.manifest, partId, platformKey)) {
    if (!download.github) continue;
    const source = folderSource(addon, download.github);
    if ("error" in source) return source.error;
  }
  return "";
}

// The chosen parts that can be fetched here: what setup fetches, what the
// program is told it has (ODM_ADDON_PARTS), what a board view is handed.
export function installableParts(addon: Addon, platformKey: string): string[] {
  return chosenParts(addon.manifest, addon.state.parts).filter((id) => !partProblem(addon, id, platformKey));
}

// A repository folder into `target` for setup. `marker` is what the copy
// already there was fetched from, so a folder whose files did not change
// (an update that left the part alone) is not fetched again; the new
// marker comes back, or null when nothing was fetched.
export async function fetchFolderDownload(
  addon: Addon,
  download: SetupDownload & { github: GitHubFolder },
  target: string,
  staging: string,
  marker: string,
  options: { signal: AbortSignal; onProgress: (done: number, total: number) => void },
): Promise<string | null> {
  const source = folderSource(addon, download.github);
  if ("error" in source) throw new Error(`${download.id}: ${source.error}`);
  await rm(staging, { recursive: true, force: true });
  if ("local" in source) {
    // An author's own working copy: copied as it stands, every time.
    const bytes = await folderBytes(source.local);
    if (bytes !== download.bytes) throw new Error(`${download.id}: ${source.local} holds ${bytes} bytes, not the ${download.bytes} its manifest says.`);
    await mkdir(path.dirname(staging), { recursive: true });
    await cp(source.local, staging, { recursive: true, dereference: false, verbatimSymlinks: true, filter: (from) => !path.basename(from).startsWith(".") });
    return "local";
  }
  const reader = githubReader({
    repo: source.repo,
    commit: source.commit,
    folder: source.path,
    apiBase: serverEnv("ADDON_GITHUB_API_BASE"),
    rawBase: serverEnv("ADDON_GITHUB_RAW_BASE"),
  });
  let files: RepoFile[];
  try {
    files = await reader.list();
  } catch (error) {
    throw new Error(`${download.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (bytes !== download.bytes) throw new Error(`${download.id}: ${reader.label} holds ${bytes} bytes, not the ${download.bytes} its manifest says.`);
  const fingerprint = `git:${folderFingerprint(files)}`;
  if (marker === fingerprint && existsSync(target)) return null;
  const fetched = await fetchRepoFolder(reader, staging, { files, signal: options.signal, onProgress: options.onProgress });
  if (!fetched.ok) throw new Error(`${download.id}: ${fetched.error}`);
  return fingerprint;
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderBytes(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}
