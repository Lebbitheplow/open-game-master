import { sourceFacts, type RegistryAddon } from "@/lib/addons/registry-index";
import { compareNames } from "@/lib/language/text-logic";

// Who made an addon and where their work lives, so every place an addon
// shows up names its creator and links their GitHub repository: the
// downloader, an installed addon's card, the pickers that offer what it
// adds (an importer, a map generator, a board view), the licenses page,
// and the creators table in the README (written from addons/catalog.json).
//
// Pure, so the server, the panel and the catalog tool share it.

export type AddonCredit = {
  author: string;
  // owner/name of its GitHub repository, or "" when it came from elsewhere.
  repo: string;
  // The repository's page, else the addon's homepage, else "".
  url: string;
  // The creator's GitHub profile, or "".
  profile: string;
  // Other repositories its parts come from, as owner/name.
  also: string[];
};

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/;

// owner/name from a github.com link, or "".
export function githubRepoOf(url: string | undefined): string {
  const match = GITHUB_REPO.exec(url ?? "");
  return match ? `${match[1]}/${match[2]}` : "";
}

export function creditFor(input: { author: string; homepage?: string; repo?: string | null; also?: string[] }): AddonCredit {
  const repo = input.repo || githubRepoOf(input.homepage);
  const owner = repo ? repo.split("/")[0] : "";
  return {
    author: input.author,
    repo,
    url: repo ? `https://github.com/${repo}` : input.homepage && /^https:\/\//.test(input.homepage) ? input.homepage : "",
    profile: owner ? `https://github.com/${owner}` : "",
    also: (input.also ?? []).filter((other) => other.toLowerCase() !== repo.toLowerCase()),
  };
}

export function catalogCredit(entry: RegistryAddon): AddonCredit {
  return creditFor({
    author: entry.author,
    homepage: entry.homepage,
    repo: sourceFacts(entry.source)?.repo ?? "",
    also: [...new Set((entry.parts ?? []).flatMap((part) => part.repos ?? []))],
  });
}

export const CREDITS_START = "<!-- addon-creators:start -->";
export const CREDITS_END = "<!-- addon-creators:end -->";

const KINDS: Array<[keyof RegistryAddon["contributes"], string]> = [
  ["boardViews", "Board view"],
  ["mapGenerators", "Map generator"],
  ["workshopImporters", "Workshop importer"],
];

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

// The README's table of addon creators, from the list. scripts/addon-
// catalog.mjs writes it between the two markers whenever an entry is added,
// and its check fails while the README holds anything else there.
export function creditsMarkdown(entries: RegistryAddon[]): string {
  if (!entries.length) return "No addons are on the list yet. Yours could be the first: see [the catalog guidelines](docs/addons/guidelines.md).";
  const rows = [...entries]
    .sort((a, b) => compareNames(a.name, b.name))
    .map((entry) => {
      const credit = catalogCredit(entry);
      const owner = credit.repo.split("/")[0];
      const creator = owner ? `${cell(credit.author || owner)} ([@${owner}](${credit.profile}))` : cell(credit.author);
      const repos = [credit.repo, ...credit.also].filter(Boolean).map((repo) => `[${repo}](https://github.com/${repo})`).join(", ");
      const adds = KINDS.filter(([kind]) => entry.contributes[kind].length)
        .map(([kind, label]) => `${label}: ${entry.contributes[kind].map(cell).join(", ")}`)
        .concat(entry.parts?.length ? [`Parts: ${entry.parts.map((part) => cell(part.title)).join(", ")}`] : [])
        .join("; ");
      return `| ${cell(entry.name)} | ${creator} | ${repos || "-"} | ${adds || "-"} |`;
    });
  return ["| Addon | Creator | Repository | What it adds |", "|---|---|---|---|", ...rows].join("\n");
}

// The README with its creators table replaced by this one, or null when it
// has no markers to write between.
export function withCredits(readme: string, entries: RegistryAddon[]): string | null {
  const start = readme.indexOf(CREDITS_START);
  const end = readme.indexOf(CREDITS_END);
  if (start < 0 || end < start) return null;
  return `${readme.slice(0, start + CREDITS_START.length)}\n${creditsMarkdown(entries)}\n${readme.slice(end)}`;
}
