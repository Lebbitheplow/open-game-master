// --out belongs to the caller, even though the seed starts in the checkout
// and enforce-world changes its working directory before writing the files.
// Exercise the real runner with a tiny seed and browser stand-ins: no build,
// content pack or Chromium is needed to catch a path lost between processes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-browser-output-"));
const tree = path.join(dir, "tree");
const caller = path.join(dir, "caller");
const temp = path.join(dir, "temp");
const browserDir = path.join(tree, "scripts", "browser");
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

try {
  for (const folder of [caller, temp, browserDir, path.join(tree, "scripts", "lib")]) fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(new URL("./browser/run.mjs", import.meta.url), path.join(browserDir, "run.mjs"));
  fs.copyFileSync(new URL("./lib/remove-temp-dir.mjs", import.meta.url), path.join(tree, "scripts", "lib", "remove-temp-dir.mjs"));
  write(path.join(tree, ".next", "BUILD_ID"), "fixture");
  write(path.join(browserDir, "seed.mjs"), `
    import fs from "node:fs";
    import path from "node:path";
    // enforce-world changes cwd while seed.mjs is loading its imports.
    const scratch = fs.mkdtempSync(path.join(process.cwd(), "seed-"));
    process.chdir(scratch);
    const out = process.argv[2];
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "world.sqlite"), "seeded");
    fs.writeFileSync(path.join(out, "key"), "fixture");
    fs.writeFileSync(path.join(out, "ids.json"), JSON.stringify({ lead: "fixture", password: "fixture" }));
  `);
  write(path.join(browserDir, "lib.mjs"), `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import path from "node:path";
    export const noEnvFile = (db) => path.join(path.dirname(db), "no-env-server");
    export const freePort = async () => 0;
    export async function startServer({ dbPath, log }) {
      assert.ok(path.isAbsolute(dbPath));
      assert.equal(fs.readFileSync(dbPath, "utf8"), "seeded");
      assert.equal(path.dirname(dbPath), path.dirname(log));
      fs.writeFileSync(log, "fixture");
      return { base: "fixture", stop: async () => {} };
    }
    export const signIn = async () => {};
    export const seeAllTours = async () => {};
    export const enterApp = async () => {};
    export const serveFolder = async () => {};
    export const newContext = async () => ({
      newPage: async () => ({ unrouteAll: async () => {} }),
      unrouteAll: async () => {}, close: async () => {},
    });
    export const launchBrowser = async () => ({ newContext, close: async () => {} });
    export function pageHarness({ outDir, tag }) {
      return { fails: [], shot: async (name) => fs.writeFileSync(path.join(outDir, tag + "-" + name + ".png"), "fixture") };
    }
  `);
  write(path.join(browserDir, "scenarios", "output.mjs"), `
    export default { name: "output", async run(harness) {
      await harness.shot("passed");
    } };
  `);

  function run(cwd, args) {
    const result = spawnSync(process.execPath, [path.join(browserDir, "run.mjs"), ...args], {
      cwd,
      env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /1 of 1 passed/);
  }
  function artifacts(out) {
    for (const file of ["world.sqlite", "key", "ids.json", "server.log", "output-desktop-passed.png", "report.json"]) {
      assert.ok(fs.existsSync(path.join(out, file)), `missing ${file} from ${out}`);
    }
    const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0].ok, true);
  }

  // A path from the checkout, one from elsewhere (with spaces and ..), and
  // an absolute path all keep the seed, server, screenshots and report together.
  for (const [cwd, out] of [
    [tree, "relative-output"],
    [caller, path.join("..", "nested output", "run")],
    [caller, path.join(dir, "absolute-output")],
  ]) {
    run(cwd, ["--out", out]);
    artifacts(path.resolve(cwd, out));
  }

  // Without --out the normal temporary folder is still kept only on request.
  run(caller, ["--keep"]);
  const [kept] = fs.readdirSync(temp);
  assert.ok(kept?.startsWith("odm-browser-"));
  artifacts(path.join(temp, kept));
  removeTempDir(path.join(temp, kept));
  run(caller, []);
  assert.deepEqual(fs.readdirSync(temp), []);
} finally {
  removeTempDir(dir);
}

console.log("ok: browser output paths survive the seed's working directory change");
