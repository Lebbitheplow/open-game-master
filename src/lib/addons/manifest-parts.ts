import { z } from "zod";

// Two things an addon declares beside what it contributes
// (docs/addons/authoring.md, "Parts" and "What it modifies"):
//
//   parts     optional pieces an admin installs or leaves out, each its own
//             set of setup downloads: a 3D model and sound library split per
//             campaign setting, so a high fantasy table never fetches the
//             dark fantasy models. A part's files come from https downloads
//             (a release asset of this repository or another) or from a
//             folder of a GitHub repository at a commit (this one, or a
//             separate repository per setting).
//   modifies  what the addon changes in the app, and whether it replaces it
//             or adds to it. Two addons that both replace the same thing
//             conflict on their own, without either having to know the
//             other's id the way `conflicts` does.
//
// Client-safe: zod and nothing else, so the panel, the catalog tool and the
// checker read the same rules.

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REPO_FOLDER = /^(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/;

export const partSchema = z.object({
  id: z.string().regex(KEY),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(""),
  // Chosen when the addon is installed, until the admin picks otherwise.
  default: z.boolean().default(false),
});

// A folder of a GitHub repository at one commit, fetched file by file and
// each file checked against git's hash, as the addon's own folder is
// (src/lib/addons/repo-fetch.ts). With no repo and no commit it is a folder
// of the addon's own repository at the commit the addon was installed from,
// which an addon's manifest cannot name for itself.
export const githubFolderSchema = z
  .object({
    repo: z.string().regex(REPO, "A repository as owner/name.").optional(),
    path: z
      .string()
      .max(200)
      .regex(REPO_FOLDER, "A folder inside the repository, with forward slashes.")
      .refine((value) => !value.split("/").some((part) => part === "." || part === ".."), "A folder inside the repository.")
      .default(""),
    commit: z.string().regex(/^[a-f0-9]{40}$/, "A full commit hash.").optional(),
  })
  .strict()
  .refine((value) => Boolean(value.repo) === Boolean(value.commit), {
    message: "Name both repo and commit for another repository, or neither for a folder of this one.",
  });

export type GitHubFolder = z.infer<typeof githubFolderSchema>;

// The things addons are known to change, by the name a manifest uses, in
// words for the panel. Other names are allowed (a new kind of thing, or
// "<addon-id>/<thing>" for something another addon reads, such as a board
// view's tile set) and shown as written; two addons conflict by name either
// way. A new common name is added here with a framework pull request.
export const ADDON_MODIFIES: Record<string, string> = {
  "creature-models": "creature and character models",
  "map-models": "map and prop models",
  "token-art": "token pictures",
  "map-art": "map pictures",
  sounds: "sound effects",
  music: "music and ambience",
  dice: "the dice",
};

const MODIFIES_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)?$/;

export const modifiesSchema = z.object({
  what: z.string().max(80).regex(MODIFIES_KEY, "Lowercase words joined by hyphens, like creature-models."),
  // replace: while it is on, it takes this over, so a second addon that
  // also replaces it would fight it. add: it adds to what is there, beside
  // any number of others.
  how: z.enum(["replace", "add"]),
});

export type AddonModifies = z.infer<typeof modifiesSchema>;

export function modifiesLabel(what: string): string {
  const known = ADDON_MODIFIES[what];
  if (known) return known;
  const [owner, thing] = what.split("/");
  return thing ? `${owner}'s ${thing.replace(/-/g, " ")}` : what.replace(/-/g, " ");
}

// Why two addons cannot run together by what they modify, or "": both
// replace the same thing. Adding beside a replacement is not a fight.
export function modifiesClash(a: readonly AddonModifies[], b: readonly AddonModifies[]): string {
  const replaced = new Set(b.filter((entry) => entry.how === "replace").map((entry) => entry.what));
  const shared = a.filter((entry) => entry.how === "replace" && replaced.has(entry.what)).map((entry) => modifiesLabel(entry.what));
  return shared.length ? `Both replace ${shared.join(" and ")}.` : "";
}

// The GitHub repository a download comes from, as owner/name, when it is a
// repository folder or a release asset: what the panel credits beside the
// addon's own repository.
export function downloadRepo(download: { url?: string; github?: { repo?: string } }): string {
  if (download.github?.repo) return download.github.repo;
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/releases\/download\//.exec(download.url ?? "");
  return match ? match[1] : "";
}

// Folders a part's download may not land on: setup's own bookkeeping, the
// Python environment and the asset library's root, which removing a part
// that was left out would take with it.
const RESERVED_TARGETS = [".setup", ".venv", "public"];

export function partProblems(parts: Array<{ id: string }>, downloads: Array<{ id: string; to: string; part?: string }>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const part of parts) {
    if (ids.has(part.id)) problems.push(`Two parts share the id "${part.id}".`);
    ids.add(part.id);
    if (!downloads.some((download) => download.part === part.id)) problems.push(`Part "${part.id}" has no setup download that names it.`);
  }
  const inside = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  for (const download of downloads) {
    if (!download.part) continue;
    if (!ids.has(download.part)) {
      problems.push(`Setup download "${download.id}" names the part "${download.part}", which is not one of its parts.`);
      continue;
    }
    const to = download.to.replace(/\/+$/, "");
    if (RESERVED_TARGETS.includes(to)) problems.push(`Setup download "${download.id}" belongs to a part, so it lands in a folder of its own, not ${to}.`);
    const overlap = downloads.find((other) => other !== download && inside(to, other.to.replace(/\/+$/, "")));
    if (overlap) problems.push(`Setup download "${download.id}" belongs to a part and shares ${to} with "${overlap.id}"; give it a folder of its own.`);
  }
  return problems;
}
