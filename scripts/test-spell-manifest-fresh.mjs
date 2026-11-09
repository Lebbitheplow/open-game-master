// The spell checklist and the answers baked from the SRD rows
// (src/lib/srd/manifest/spells.json, spell-mech.json) are what a server with
// no content pack plays. scripts/annotate-spell-manifest.mjs writes them from
// the pack, and nothing held them to it: by 0.34.0 they had fallen behind the
// readers (Fear without its frightened condition, Flame Strike, Ice Storm and
// Meteor Swarm without their second damage type), so a server with no pack
// read those spells differently from one with it. This runs the script's own
// --check against the installed pack. With no pack there is nothing to read
// them from, and the check says so and passes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const pack = process.env.CONTENT_DB_PATH || path.join(root, "data", "content", "open5e.sqlite");

if (!existsSync(pack)) {
  console.log(`test-spell-manifest-fresh: no content pack at ${pack}; the baked manifest is not compared.`);
} else {
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "annotate-spell-manifest.mjs"), "--check"], {
    cwd: root,
    env: { ...process.env, CONTENT_DB_PATH: pack },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`.trim().split("\n").filter((line) => !/Warning|trace-warnings|Reparsing|type": "module/.test(line)).join("\n"));
  console.log("test-spell-manifest-fresh: the baked spell manifest matches the pack's readers.");
}
