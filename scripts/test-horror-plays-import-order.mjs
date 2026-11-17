// The horror-play tables sit on an import loop: genre-gh-wards.ts reaches
// back into genre-gh-horror-plays.ts, which spread the wards' table while it
// was itself still loading. Whichever file a process happened to load first
// decided whether the server threw "Cannot access 'GH_WARD_PLAYS' before
// initialization": encounter-tools.ts, which the End turn, floor and
// initiative routes load, was one that threw. Each entry point loads in a
// fresh process, since a module loads only once per process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const alias = pathToFileURL(path.join(here, "lib/register-alias.mjs")).href;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-horror-order-"));

const ENTRIES = ["genre-gh-wards", "genre-gh-horror-plays", "encounter-tools", "genre-a-horror-spends"];

for (const entry of ENTRIES) {
  const first = pathToFileURL(path.join(here, `../src/lib/dm/${entry}.ts`)).href;
  const spends = pathToFileURL(path.join(here, "../src/lib/dm/genre-a-horror-spends.ts")).href;
  const program = `
    import { register } from "node:module";
    register(${JSON.stringify(alias)});
    await import(${JSON.stringify(first)});
    const { horrorSpend } = await import(${JSON.stringify(spends)});
    const missing = horrorSpend({}, "no_such_play");
    if (!String(missing.error).includes("No horror play")) throw new Error("unexpected: " + JSON.stringify(missing));
    console.log("loaded");
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    encoding: "utf8",
    env: {
      ...process.env,
      SQLITE_DB_PATH: path.join(dir, `${entry}.sqlite`),
      DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    },
    timeout: 120_000,
  });
  assert.equal(run.status, 0, `loading ${entry} first failed:\n${run.stderr}`);
  assert.match(run.stdout, /loaded/, `loading ${entry} first did not finish:\n${run.stdout}\n${run.stderr}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log("horror plays load in any order: ok");
