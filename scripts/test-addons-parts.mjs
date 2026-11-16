// Addon parts, what addons modify, and their creators' credit: the
// manifest rules for parts and repository-folder downloads, which parts are
// chosen and what they weigh, conflicts by what two addons replace, the
// catalog entry and the README's creators table, and end to end in a
// scratch world: a split addon installed from GitHub fetching only the
// parts chosen (an https download, a folder of its own repository and a
// folder of a separate one), a changed choice fetching what was added and
// removing what was left out, an update that left a part alone not
// fetching it again, a part a newer version dropped or moved taken away,
// a part an install from a file cannot reach, and two
// addons that replace the same thing refused together.
//
// Points SQLITE_DB_PATH, ADDONS_DIR and the working directory at a scratch
// folder; GitHub and the download host are answered here.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = path.join(repoRoot, "examples", "addons", "hello-dungeon");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-addon-parts-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ADDONS_DIR = path.join(dir, "addons");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { addonManifestSchema } = await import("../src/lib/addons/manifest.ts");
const { modifiesClash, modifiesLabel, downloadRepo } = await import("../src/lib/addons/manifest-parts.ts");
const { chosenParts, downloadApplies, partBytes } = await import("../src/lib/addons/settings.ts");
const { catalogEntry, entryDifferences } = await import("../src/lib/addons/catalog-entry.ts");
const { creditFor, creditsMarkdown, withCredits, githubRepoOf } = await import("../src/lib/addons/credits.ts");
const { registryAddonSchema } = await import("../src/lib/addons/registry-index.ts");
const { boardSnapshot } = await import("../src/lib/addons/board-bridge.ts");
const { installAddonArchive, installFromGitHub, updateFromGitHub, removeAddon } = await import("../src/lib/addons/install.ts");
const { conflictsWith, findInstalledAddon, listInstalledAddons } = await import("../src/lib/addons/installed.ts");
const { setAddonState, addonState } = await import("../src/lib/addons/store.ts");
const { startSetup, partsEdit } = await import("../src/lib/addons/setup.ts");
const { partProblem, partViews, installableParts } = await import("../src/lib/addons/parts.ts");
const { offeredContributions, addonCredits } = await import("../src/lib/addons/offered.ts");
const { getTask } = await import("../src/lib/addons/tasks.ts");
const { createUser } = await import("../src/lib/db/users.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const COMMIT_A = "a1".repeat(20);
const COMMIT_B = "b2".repeat(20);
const PACK_COMMIT = "c3".repeat(20);
const host = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;

function manifestWith(extra) {
  return {
    id: "split-pack",
    name: "Split pack",
    version: "1.0.0",
    apiVersion: 1,
    description: "Models and sounds per campaign setting.",
    author: "A Creator",
    license: "MIT",
    runtime: { kind: "node", entry: "server/main.mjs" },
    contributes: { boardViews: [{ id: "three", title: "3D table", entry: "ui/board.html" }] },
    ...extra,
  };
}

function problemsOf(raw) {
  const parsed = addonManifestSchema.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

// ---- the manifest ----

await test("parts, repository folders and modifies read, and their mistakes are named", () => {
  const good = manifestWith({
    modifies: [{ what: "creature-models", how: "replace" }, { what: "sounds", how: "add" }],
    parts: [
      { id: "high", title: "High fantasy", default: true },
      { id: "dark", title: "Dark fantasy" },
    ],
    setup: {
      downloads: [
        { id: "highModels", part: "high", url: "https://github.com/creator/pack/releases/download/v1/high.zip", sha256: "a".repeat(64), bytes: 10, unpack: "zip", to: "public/high" },
        { id: "darkModels", part: "dark", github: { path: "packs/dark" }, bytes: 20, to: "public/dark" },
        { id: "darkSounds", part: "dark", github: { repo: "creator/dark-sounds", commit: PACK_COMMIT }, bytes: 5, to: "public/dark-sounds" },
      ],
    },
  });
  assert.deepEqual(problemsOf(good), []);
  const parsed = addonManifestSchema.parse(good);
  assert.equal(parsed.parts[1].default, false);
  assert.equal(parsed.setup.downloads[1].unpack, "none");

  const downloads = (list) => manifestWith({ parts: [{ id: "high", title: "High" }], setup: { downloads: list } });
  const one = { id: "x", part: "high", bytes: 1, to: "public/high" };
  assert.match(problemsOf(downloads([{ ...one }])).join(" "), /a url or a github folder/);
  assert.match(problemsOf(downloads([{ ...one, url: "https://h.test/x", github: { path: "a" } }])).join(" "), /a url or a github folder/);
  assert.match(problemsOf(downloads([{ ...one, url: "https://h.test/x" }])).join(" "), /needs the file's sha256/);
  assert.match(problemsOf(downloads([{ ...one, github: { path: "a" }, sha256: "a".repeat(64) }])).join(" "), /leave out sha256 and unpack/);
  assert.match(problemsOf(downloads([{ ...one, github: { path: "a" }, unpack: "zip" }])).join(" "), /leave out sha256 and unpack/);
  assert.match(problemsOf(downloads([{ ...one, github: { repo: "creator/other", path: "a" } }])).join(" "), /both repo and commit/);
  assert.match(problemsOf(downloads([{ ...one, github: { path: "../up" } }])).join(" "), /folder inside the repository/);
  assert.match(problemsOf(downloads([{ ...one, part: "low", github: { path: "a" } }])).join(" "), /names the part "low"/);
  assert.match(problemsOf(downloads([{ ...one, to: "public", github: { path: "a" } }])).join(" "), /folder of its own, not public/);
  assert.match(
    problemsOf(downloads([{ ...one, github: { path: "a" } }, { id: "y", url: "https://h.test/y", sha256: "a".repeat(64), bytes: 1, to: "public/high/inner" }])).join(" "),
    /shares public\/high with "y"/,
  );
  assert.match(problemsOf(manifestWith({ parts: [{ id: "high", title: "High" }] })).join(" "), /Part "high" has no setup download/);
  assert.match(problemsOf(manifestWith({ modifies: [{ what: "sounds", how: "add" }, { what: "sounds", how: "replace" }] })).join(" "), /named twice/);
  assert.match(problemsOf(manifestWith({ modifies: [{ what: "Sounds!", how: "add" }] })).join(" "), /Lowercase words/);
  assert.match(problemsOf(manifestWith({ modifies: [{ what: "sounds" }] })).join(" "), /expected one of|Invalid/i);
  // A download outside any part still reads as it always did.
  assert.deepEqual(problemsOf(manifestWith({ setup: { downloads: [{ id: "base", url: "https://h.test/b", sha256: "a".repeat(64), bytes: 3, to: "public" }] } })), []);
});

await test("the chosen parts are the author's defaults until the admin picks, held to the parts declared", () => {
  const manifest = { parts: [{ id: "high", default: true }, { id: "dark", default: false }, { id: "space", default: true }] };
  assert.deepEqual(chosenParts(manifest, null), ["high", "space"]);
  assert.deepEqual(chosenParts(manifest, []), []);
  assert.deepEqual(chosenParts(manifest, ["dark", "gone"]), ["dark"], "a part a newer version dropped is gone");
  const download = { id: "d", part: "dark", bytes: 1, to: "public/dark" };
  assert.equal(downloadApplies(download, "linux-x64", {}, ["dark"]), true);
  assert.equal(downloadApplies(download, "linux-x64", {}, ["high"]), false);
  assert.equal(downloadApplies(download, "linux-x64", {}), false, "a part download needs its part chosen");
  assert.equal(downloadApplies({ id: "base", bytes: 1, to: "x" }, "linux-x64", {}), true);
  const sized = {
    setup: {
      downloads: [
        { id: "a", part: "high", bytes: 100, to: "a" },
        { id: "w", part: "high", bytes: 50, platforms: ["win32-x64"], to: "w" },
        { id: "m", part: "high", bytes: 70, platforms: ["darwin-arm64"], to: "m" },
        { id: "o", part: "dark", bytes: 9, to: "o" },
      ],
    },
  };
  assert.equal(partBytes(sized, "high", "linux-x64"), 100);
  assert.equal(partBytes(sized, "high", "darwin-arm64"), 170);
  assert.equal(partBytes(sized, "high"), 170, "with no platform, the most it downloads anywhere");
});

await test("two addons that both replace the same thing clash; adding beside them does not", () => {
  assert.equal(modifiesClash([{ what: "creature-models", how: "replace" }], [{ what: "creature-models", how: "replace" }]), "Both replace creature and character models.");
  assert.equal(modifiesClash([{ what: "sounds", how: "replace" }], [{ what: "sounds", how: "add" }]), "");
  assert.equal(modifiesClash([{ what: "sounds", how: "add" }], [{ what: "sounds", how: "add" }]), "");
  assert.equal(modifiesClash([{ what: "music", how: "replace" }], [{ what: "dice", how: "replace" }]), "");
  assert.equal(modifiesLabel("isometric-tabletop/tile-set"), "isometric-tabletop's tile set");
  assert.equal(modifiesLabel("weather-effects"), "weather effects");
  assert.equal(downloadRepo({ url: "https://github.com/creator/pack/releases/download/v1/x.zip" }), "creator/pack");
  assert.equal(downloadRepo({ url: "https://cdn.example.test/x.zip" }), "");
});

// ---- the list and the credit ----

await test("a catalog entry carries its parts, their sizes and the repositories they come from", () => {
  const manifest = addonManifestSchema.parse(
    manifestWith({
      modifies: [{ what: "creature-models", how: "replace" }],
      parts: [
        { id: "high", title: "High fantasy", default: true },
        { id: "dark", title: "Dark fantasy" },
      ],
      setup: {
        downloads: [
          { id: "highModels", part: "high", url: "https://github.com/creator/pack/releases/download/v1/high.zip", sha256: "a".repeat(64), bytes: 1_000, unpack: "zip", to: "public/high" },
          { id: "darkModels", part: "dark", github: { repo: "creator/dark-pack", commit: PACK_COMMIT }, bytes: 2_000, to: "public/dark" },
        ],
      },
    }),
  );
  const entry = catalogEntry(manifest, { repo: "creator/pack", path: "addon", commit: COMMIT_A, tag: "" }, { contentSha256: "f".repeat(64), bytes: 10 }, "maps");
  assert.deepEqual(entry.modifies, [{ what: "creature-models", how: "replace" }]);
  assert.deepEqual(entry.parts, [
    { id: "high", title: "High fantasy", description: "", default: true, bytes: 1_000, repos: [] },
    { id: "dark", title: "Dark fantasy", description: "", default: false, bytes: 2_000, repos: ["creator/dark-pack"] },
  ]);
  // An entry the list holds from before these fields existed is no different.
  const older = { ...entry };
  delete older.parts;
  delete older.modifies;
  const plain = catalogEntry(addonManifestSchema.parse(manifestWith({})), entry.source, { contentSha256: "f".repeat(64), bytes: 10 }, "maps");
  const plainOlder = { ...plain };
  delete plainOlder.parts;
  delete plainOlder.modifies;
  assert.deepEqual(entryDifferences(plain, plainOlder), []);
  assert.deepEqual(entryDifferences(entry, older).sort(), ["modifies", "parts"]);
  assert.equal(registryAddonSchema.parse(older).parts.length, 0);
});

await test("an addon's credit names its creator and links their repository and profile", () => {
  assert.equal(githubRepoOf("https://github.com/someone/odm-iso/tree/main/addon"), "someone/odm-iso");
  assert.equal(githubRepoOf("https://example.test/someone"), "");
  assert.deepEqual(creditFor({ author: "Someone", homepage: "https://github.com/someone/odm-iso", also: ["someone/odm-iso", "other/sounds"] }), {
    author: "Someone",
    repo: "someone/odm-iso",
    url: "https://github.com/someone/odm-iso",
    profile: "https://github.com/someone",
    also: ["other/sounds"],
  });
  assert.deepEqual(creditFor({ author: "Someone", homepage: "https://example.test/addon" }), {
    author: "Someone",
    repo: "",
    url: "https://example.test/addon",
    profile: "",
    also: [],
  });
  const entry = registryAddonSchema.parse({
    id: "split-pack",
    name: "Split | pack",
    version: "1.0.0",
    apiVersion: 1,
    author: "A Creator",
    contributes: { boardViews: ["3D table"] },
    source: { repo: "creator/pack", path: "addon", commit: COMMIT_A },
    contentSha256: "f".repeat(64),
    bytes: 10,
    parts: [{ id: "dark", title: "Dark fantasy", bytes: 5, repos: ["creator/dark-pack"] }],
  });
  const table = creditsMarkdown([entry]);
  assert.match(table, /\| Split \\\| pack \| A Creator \(\[@creator\]\(https:\/\/github\.com\/creator\)\) \| \[creator\/pack\]\(https:\/\/github\.com\/creator\/pack\), \[creator\/dark-pack\]\(https:\/\/github\.com\/creator\/dark-pack\) \| Board view: 3D table; Parts: Dark fantasy \|/);
  assert.match(creditsMarkdown([]), /No addons are on the list yet/);
  const readme = "intro\n<!-- addon-creators:start -->\nold\n<!-- addon-creators:end -->\nrest\n";
  assert.equal(withCredits(readme, [entry]), `intro\n<!-- addon-creators:start -->\n${table}\n<!-- addon-creators:end -->\nrest\n`);
  assert.equal(withCredits("no markers", [entry]), null);
});

await test("the README's creators table says what addons/catalog.json says", () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(repoRoot, "addons", "catalog.json"), "utf8"));
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const entries = shipped.addons.map((entry) => registryAddonSchema.parse(entry));
  assert.equal(withCredits(readme, entries), readme, "run node scripts/addon-catalog.mjs credits");
  for (const entry of entries) assert.ok(readme.includes(`https://github.com/${entry.source.repo}`), `${entry.id} is credited`);
});

await test("a board view's snapshot names the addon's parts set up here", () => {
  const view = {
    mapId: "m", width: 1, height: 1, terrain: ".", theme: "stone", ambient: "", outdoors: false, visible: [0], explored: [0],
    fullVision: true, tokens: [], tokenFootprint: {}, tokenElevation: {}, tokenHealth: {}, tokenConditions: {}, tokenAuras: {},
    lights: [], turn: null, board: "scene", myTokenId: null, reachable: [], round: 0, currentTurnName: "", addonView: null,
    labels: [], drawings: [], intents: [], targets: {}, spellZones: [], doors: null,
  };
  const appearance = { theme: "night", reducedMotion: false };
  assert.deepEqual(boardSnapshot(view, "split-pack", { canDirect: false, appearance, parts: ["dark"] }).parts, ["dark"]);
  assert.deepEqual(boardSnapshot(view, "split-pack", { canDirect: false, appearance }).parts, []);
});

// ---- end to end ----

function stubFetch(routes) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const answer = routes(url);
    if (answer) return answer;
    if (url.startsWith("https://")) return new Response("not stubbed", { status: 404 });
    return real(input, init);
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

// GitHub as the server reads it: commits, recursive trees, raw files.
// `repos` maps owner/name to { head, files: () => { path: Buffer } }.
function githubAnswers(repos, extra = () => null) {
  const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  return (url) => {
    let match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/commits\/([^/?]+)$/.exec(url);
    if (match && repos[match[1]]) return json({ sha: repos[match[1]].head() });
    match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\/([0-9a-f]{40})\?recursive=1$/.exec(url);
    if (match && repos[match[1]]) {
      const files = repos[match[1]].files();
      return json({ truncated: false, tree: Object.entries(files).map(([file, bytes]) => ({ path: file, mode: "100644", type: "blob", sha: gitBlobSha(bytes), size: bytes.length })) });
    }
    match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url);
    if (match && repos[match[1]]) {
      const bytes = repos[match[1]].files()[match[3].split("/").map(decodeURIComponent).join("/")];
      return bytes ? new Response(bytes) : null;
    }
    return extra(url);
  };
}

function addonFiles(manifest, prefix) {
  const mcp = fs.readFileSync(path.join(example, "server", "mcp.mjs"));
  const main = Buffer.from(`import { createServer } from "./mcp.mjs";
const server = createServer({ name: "${manifest.id}", version: "1.0.0" });
server.tool("generate", "unused", { type: "object" }, () => ({}));
server.listen();
`);
  return {
    [`${prefix}addon.json`]: Buffer.from(JSON.stringify(manifest)),
    [`${prefix}server/mcp.mjs`]: mcp,
    [`${prefix}server/main.mjs`]: main,
    [`${prefix}ui/board.html`]: Buffer.from("<!doctype html><title>3D</title>"),
  };
}

async function settle(task, limitMs = 30_000) {
  const started = Date.now();
  while (getTask(task.id)?.status === "running") {
    if (Date.now() - started > limitMs) throw new Error(`task ${task.id} did not finish: ${JSON.stringify(getTask(task.id)?.progress)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return getTask(task.id);
}

const sizeOf = (files) => Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0);

try {
  const owner = createUser("parts-admin", "hash");
  const data = path.join(process.env.ADDONS_DIR, "data", "split-pack");

  const highZip = await (() => {
    const zip = new JSZip();
    zip.file("goblin.glb", "high fantasy goblin");
    return zip.generateAsync({ type: "nodebuffer" });
  })();
  const darkFolder = { "packs/dark/ghoul.glb": Buffer.from("dark fantasy ghoul"), "packs/dark/sounds/wail.ogg": Buffer.from("wail") };
  const darkBytes = sizeOf(darkFolder);
  const spaceFolder = { "space/android.glb": Buffer.from("an android"), "space/hum.ogg": Buffer.from("hum") };
  const spaceBytes = sizeOf(spaceFolder);
  const manifest = manifestWith({
    homepage: "https://github.com/creator/pack",
    modifies: [{ what: "creature-models", how: "replace" }, { what: "sounds", how: "add" }],
    parts: [
      { id: "high", title: "High fantasy", default: true },
      { id: "dark", title: "Dark fantasy" },
      { id: "space", title: "Space" },
    ],
    setup: {
      downloads: [
        { id: "highModels", part: "high", url: "https://github.com/creator/pack/releases/download/v1/high.zip", sha256: sha256(highZip), bytes: highZip.length, unpack: "zip", to: "public/high" },
        { id: "darkModels", part: "dark", github: { path: "packs/dark" }, bytes: darkBytes, to: "public/dark" },
        { id: "spaceModels", part: "space", github: { repo: "creator/space-pack", commit: PACK_COMMIT, path: "space" }, bytes: spaceBytes, to: "public/space" },
      ],
    },
  });
  let head = COMMIT_A;
  let packFiles = { ...addonFiles(manifest, "addon/"), ...darkFolder, "README.md": Buffer.from("the pack") };
  const repos = {
    "creator/pack": { head: () => head, files: () => packFiles },
    "creator/space-pack": { head: () => PACK_COMMIT, files: () => spaceFolder },
  };
  const stub = stubFetch(githubAnswers(repos, (url) => (url === "https://github.com/creator/pack/releases/download/v1/high.zip" ? new Response(highZip) : null)));

  try {
    await test("a split addon from GitHub fetches the parts chosen by default, and only those", async () => {
      const installed = await installFromGitHub("https://github.com/creator/pack/tree/main/addon");
      assert.equal(installed.ok, true, installed.error);
      assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "packages", "split-pack", "ghoul.glb")), false, "a part's folder is not part of the install");
      assert.deepEqual(addonState("split-pack").fetchedFrom, { repo: "creator/pack", commit: COMMIT_A });
      assert.equal(addonState("split-pack").parts, null, "the author's defaults until the admin picks");
      setAddonState("split-pack", { enabled: true, granted: [] });
      const addon = findInstalledAddon("split-pack");
      assert.equal(addon.status, "needs-setup");
      assert.deepEqual(installableParts(addon, host), ["high"]);
      assert.deepEqual(
        partViews(addon, host).map((part) => [part.id, part.chosen, part.available, part.bytes]),
        [["high", true, true, highZip.length], ["dark", false, true, darkBytes], ["space", false, true, spaceBytes]],
      );
      const done = await settle((await startSetup("split-pack", owner)).task);
      assert.equal(done.status, "done", done.error);
      assert.equal(fs.readFileSync(path.join(data, "public", "high", "goblin.glb"), "utf8"), "high fantasy goblin");
      assert.equal(fs.existsSync(path.join(data, "public", "dark")), false);
      assert.equal(stub.calls.some((url) => url.includes("space-pack")), false, "a part left out is never fetched");
      const view = offeredContributions().boardViews.find((entry) => entry.addonId === "split-pack");
      assert.deepEqual(view.parts, ["high"]);
      assert.equal(view.addonAuthor, "A Creator");
      assert.equal(view.addonUrl, "https://github.com/creator/pack");
      const credit = addonCredits().find((entry) => entry.id === "split-pack");
      assert.deepEqual(credit.also, ["creator/space-pack"]);
      assert.equal(credit.profile, "https://github.com/creator");
    });

    await test("choosing parts fetches the folders added, from this repository and a separate one, and removes what was left out", async () => {
      const addon = findInstalledAddon("split-pack");
      const problemOf = (id) => partProblem(addon, id, host);
      assert.match(partsEdit(addon, ["nope"], problemOf).error, /no part "nope"/);
      const edit = partsEdit(addon, ["dark", "space"], problemOf);
      assert.equal(edit.ok, true, edit.error);
      assert.deepEqual(edit.patch.parts, ["dark", "space"]);
      assert.equal(edit.patch.setupVersion, "", "a new choice makes setup due");
      setAddonState("split-pack", edit.patch);
      const done = await settle((await startSetup("split-pack", owner)).task);
      assert.equal(done.status, "done", done.error);
      assert.equal(fs.readFileSync(path.join(data, "public", "dark", "ghoul.glb"), "utf8"), "dark fantasy ghoul");
      assert.equal(fs.readFileSync(path.join(data, "public", "dark", "sounds", "wail.ogg"), "utf8"), "wail");
      assert.equal(fs.readFileSync(path.join(data, "public", "space", "android.glb"), "utf8"), "an android");
      assert.ok(stub.calls.some((url) => url.includes(`/creator/pack/${COMMIT_A}/packs/dark/ghoul.glb`)), "its own repository at the installed commit");
      assert.ok(stub.calls.some((url) => url.includes(`/creator/space-pack/${PACK_COMMIT}/space/android.glb`)), "a separate repository at the commit its manifest pins");
      assert.equal(fs.existsSync(path.join(data, "public", "high")), false, "the part left out gave its disk back");
      const same = partsEdit(findInstalledAddon("split-pack"), ["space", "dark"], problemOf);
      assert.equal(same.patch.setupVersion, undefined, "the same choice in another order leaves setup done");
    });

    await test("an update that left a part's folder alone does not fetch it again", async () => {
      head = COMMIT_B;
      packFiles = { ...packFiles, "README.md": Buffer.from("the pack, now with notes") };
      const before = stub.calls.length;
      const updated = await updateFromGitHub("split-pack");
      assert.equal(updated.ok, true, updated.error);
      assert.deepEqual(addonState("split-pack").fetchedFrom, { repo: "creator/pack", commit: COMMIT_B });
      assert.deepEqual(addonState("split-pack").parts, ["dark", "space"], "an update keeps the parts chosen");
      const done = await settle((await startSetup("split-pack", owner)).task);
      assert.equal(done.status, "done", done.error);
      const fetched = stub.calls.slice(before).filter((url) => url.includes("raw.githubusercontent.com") && /\.(glb|ogg)$/.test(url));
      assert.deepEqual(fetched, [], "the same files, by git's hashes, stay where they are");
    });

    await test("a repository folder that does not hold the bytes its manifest says is refused", async () => {
      packFiles = { ...packFiles, "packs/dark/extra.glb": Buffer.from("smuggled") };
      fs.rmSync(path.join(data, ".setup", "darkModels.sha256"));
      const done = await settle((await startSetup("split-pack", owner)).task);
      assert.equal(done.status, "failed");
      assert.match(done.error, /holds \d+ bytes, not the \d+ its manifest says/);
      assert.equal(fs.readFileSync(path.join(data, "public", "dark", "ghoul.glb"), "utf8"), "dark fantasy ghoul", "the copy already here is kept");
    });
    await test("an update that drops a part, or moves its folder, takes the old files away", async () => {
      // The next version has no Space part, and keeps Dark fantasy elsewhere.
      const next = JSON.parse(JSON.stringify(manifest));
      next.version = "1.1.0";
      next.parts = next.parts.filter((part) => part.id !== "space");
      next.setup.downloads = next.setup.downloads.filter((download) => download.part !== "space");
      next.setup.downloads.find((download) => download.id === "darkModels").to = "public/gothic";
      head = "d4".repeat(20);
      packFiles = { ...addonFiles(next, "addon/"), ...darkFolder, "README.md": Buffer.from("the pack") };
      const updated = await updateFromGitHub("split-pack");
      assert.equal(updated.ok, true, updated.error);
      assert.deepEqual(addonState("split-pack").parts, ["dark", "space"], "the choice is kept as it was made");
      assert.deepEqual(installableParts(findInstalledAddon("split-pack"), host), ["dark"]);
      const done = await settle((await startSetup("split-pack", owner)).task);
      assert.equal(done.status, "done", done.error);
      assert.equal(fs.existsSync(path.join(data, "public", "space")), false, "a part this version dropped gives its disk back");
      assert.equal(fs.existsSync(path.join(data, "public", "dark")), false, "and a part's old folder goes when it moves");
      assert.equal(fs.readFileSync(path.join(data, "public", "gothic", "ghoul.glb"), "utf8"), "dark fantasy ghoul");
      assert.equal(fs.existsSync(path.join(data, ".setup", "spaceModels.sha256")), false);
      const ledger = JSON.parse(fs.readFileSync(path.join(data, ".setup", "parts.json"), "utf8"));
      assert.deepEqual(ledger, { darkModels: { part: "dark", to: "public/gothic" } });
      // The record lives where the addon can write: it is held to the data
      // folder and never takes the asset library's root.
      fs.writeFileSync(path.join(data, ".setup", "parts.json"), JSON.stringify({ ...ledger, evil: { part: "x", to: "../../packages" }, root: { part: "x", to: "public" } }));
      setAddonState("split-pack", { setupVersion: "" });
      const again = await settle((await startSetup("split-pack", owner)).task);
      assert.equal(again.status, "done", again.error);
      assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "packages", "split-pack", "addon.json")), true);
      assert.equal(fs.existsSync(path.join(data, "public", "gothic", "ghoul.glb")), true);
    });
  } finally {
    stub.restore();
  }

  await test("an addon installed from a file cannot reach a part kept in its repository, and says why", async () => {
    const zip = new JSZip();
    for (const [file, bytes] of Object.entries(addonFiles({ ...manifest, id: "split-zip" }, "split-zip/"))) zip.file(file, bytes);
    const installed = await installAddonArchive(await zip.generateAsync({ type: "nodebuffer" }), "file");
    assert.equal(installed.ok, true, installed.error);
    const addon = findInstalledAddon("split-zip");
    const views = Object.fromEntries(partViews(addon, host).map((part) => [part.id, part]));
    assert.equal(views.high.available, true, "an https download reaches it anywhere");
    assert.equal(views.space.available, true, "so does a separate repository at its own commit");
    assert.equal(views.dark.available, false);
    assert.match(views.dark.reason, /installed from a file/);
    const refused = partsEdit(addon, ["dark"], (id) => partProblem(addon, id, host));
    assert.equal(refused.ok, false);
    assert.match(refused.error, /Dark fantasy cannot be fetched here/);
    assert.equal((await removeAddon("split-zip")).ok, true);
  });

  await test("two addons that replace the same thing never run together, though neither names the other", async () => {
    const install = async (id, modifies) => {
      const zip = new JSZip();
      const plain = { ...manifestWith({ modifies }), id, name: id };
      for (const [file, bytes] of Object.entries(addonFiles(plain, `${id}/`))) zip.file(file, bytes);
      const installed = await installAddonArchive(await zip.generateAsync({ type: "nodebuffer" }), "file");
      assert.equal(installed.ok, true, installed.error);
    };
    await install("models-one", [{ what: "creature-models", how: "replace" }]);
    await install("models-two", [{ what: "creature-models", how: "replace" }]);
    await install("sounds-extra", [{ what: "sounds", how: "add" }, { what: "creature-models", how: "add" }]);
    setAddonState("models-one", { enabled: true, granted: [] });
    // What the admin route refuses switching models-two on with.
    assert.deepEqual(
      conflictsWith(findInstalledAddon("models-two"), listInstalledAddons()).map((clash) => [clash.id, clash.reason]),
      [["models-one", "Both replace creature and character models."], ["split-pack", "Both replace creature and character models."]],
    );
    assert.deepEqual(conflictsWith(findInstalledAddon("sounds-extra"), listInstalledAddons()), [], "adding beside a replacement is fine");
    // Both on anyway (a restored backup): neither runs.
    setAddonState("split-pack", { enabled: false });
    setAddonState("models-two", { enabled: true, granted: [] });
    assert.equal(findInstalledAddon("models-one").status, "conflict");
    assert.equal(findInstalledAddon("models-two").status, "conflict");
    assert.match(findInstalledAddon("models-two").problem, /Both replace creature and character models/);
    setAddonState("models-one", { enabled: false });
    assert.equal(findInstalledAddon("models-two").status, "ready");
    for (const id of ["models-one", "models-two", "sounds-extra", "split-pack"]) assert.equal((await removeAddon(id)).ok, true);
  });
} finally {
  const { closeDatabaseForRestore } = await import("../src/lib/db/core.ts");
  closeDatabaseForRestore();
  process.chdir(repoRoot);
  await removeTempDir(dir);
}

console.log(`${passed} addon parts checks passed`);
