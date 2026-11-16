import type { AddonManifest } from "@/lib/addons/manifest";
import { downloadRepo } from "@/lib/addons/manifest-parts";
import { partBytes } from "@/lib/addons/settings";
import {
  ADDON_REGISTRY_KIND,
  ADDON_REGISTRY_VERSION,
  registryAddonSchema,
  type AddonRegistry,
  type RegistryAddon,
} from "@/lib/addons/registry-index";

// Building and checking addons/catalog.json, the downloader list. An entry is
// written by scripts/addon-catalog.mjs from the addon's own manifest at the
// audited commit, never by hand, and the pull request check derives it again
// from GitHub and fails on any difference, so what the panel shows is what
// the commit holds. Pure, so the tool, the tests and the server share it.

export const CATALOG_CATEGORIES = ["maps", "content", "table", "tools"] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export type CatalogSource = { repo: string; path: string; commit: string; tag: string };

// The programs an addon needs installed, by name, for the panel to say
// before download.
function needs(manifest: AddonManifest): string[] {
  const programs = manifest.requires.map((entry) => entry.program);
  if (manifest.runtime.kind === "python") programs.unshift("python3");
  return programs;
}

// The catalog's entry for an addon, from its manifest at the audited commit.
export function catalogEntry(
  manifest: AddonManifest,
  source: CatalogSource,
  files: { contentSha256: string; bytes: number },
  category: CatalogCategory,
): RegistryAddon {
  const titles = (list: Array<{ title: string }>) => list.map((entry) => entry.title);
  return registryAddonSchema.parse({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    author: manifest.author,
    homepage: manifest.homepage ?? `https://github.com/${source.repo}`,
    license: manifest.license,
    category,
    ...(manifest.platforms ? { platforms: manifest.platforms } : {}),
    runtime: manifest.runtime.kind,
    needs: needs(manifest),
    permissions: manifest.permissions,
    contributes: {
      workshopImporters: titles(manifest.contributes.workshopImporters),
      mapGenerators: titles(manifest.contributes.mapGenerators),
      boardViews: titles(manifest.contributes.boardViews),
    },
    ...(manifest.minServerVersion ? { minServerVersion: manifest.minServerVersion } : {}),
    source,
    contentSha256: files.contentSha256,
    bytes: files.bytes,
    setupMB: manifest.setup?.diskMB ?? 0,
    conflicts: manifest.conflicts.map((entry) => ({ id: entry.id, reason: entry.reason })),
    exclusive: manifest.exclusive,
    modifies: manifest.modifies.map((entry) => ({ what: entry.what, how: entry.how })),
    parts: manifest.parts.map((part) => ({
      id: part.id,
      title: part.title,
      description: part.description,
      default: part.default,
      bytes: partBytes(manifest, part.id),
      repos: [
        ...new Set(
          (manifest.setup?.downloads ?? [])
            .filter((download) => download.part === part.id)
            .map(downloadRepo)
            .filter((repo) => repo && repo.toLowerCase() !== source.repo.toLowerCase()),
        ),
      ],
    })),
  });
}

// The catalog with this entry added or replaced, sorted by id so a pull
// request's diff shows one block.
export function withEntry(catalog: AddonRegistry, entry: RegistryAddon): AddonRegistry {
  const addons = [...catalog.addons.filter((existing) => existing.id !== entry.id), entry];
  return { ...catalog, addons: addons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}

export function emptyCatalog(): AddonRegistry {
  return { kind: ADDON_REGISTRY_KIND, version: ADDON_REGISTRY_VERSION, generated: "", addons: [] };
}

// What is wrong with a catalog file, offline: its shape, every entry, ids
// unique and sorted. [] when it reads.
export function catalogProblems(raw: unknown): string[] {
  const problems: string[] = [];
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!record || record.kind !== ADDON_REGISTRY_KIND || record.version !== ADDON_REGISTRY_VERSION || !Array.isArray(record.addons)) {
    return [`The catalog must be { "kind": "${ADDON_REGISTRY_KIND}", "version": ${ADDON_REGISTRY_VERSION}, "addons": [...] }.`];
  }
  const ids: string[] = [];
  record.addons.forEach((entry, index) => {
    const parsed = registryAddonSchema.safeParse(entry);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push(`Entry ${index + 1}: ${issue ? `${issue.path.join(".")} ${issue.message}` : "does not read"}.`);
      return;
    }
    if (ids.includes(parsed.data.id)) problems.push(`${parsed.data.id} is listed twice.`);
    ids.push(parsed.data.id);
  });
  const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (ids.join("|") !== sorted.join("|")) problems.push("Entries are not sorted by id; run scripts/addon-catalog.mjs to write the file.");
  return problems;
}

// The fields of an entry that differ between two versions of it, for the
// pull request check to name.
// An entry written before a field existed reads with that field's default,
// so a field added to the format is not a difference.
export function entryDifferences(expected: RegistryAddon, raw: RegistryAddon): string[] {
  const read = registryAddonSchema.safeParse(raw);
  const found = read.success ? read.data : raw;
  const keys = new Set([...Object.keys(expected), ...Object.keys(found)]) as Set<keyof RegistryAddon>;
  return [...keys].filter((key) => JSON.stringify(expected[key]) !== JSON.stringify(found[key]));
}
