// Every API route that reads a request body checks it with a zod schema
// before it uses it (issue #570, .github/CONTRIBUTING.md "Validate at the
// boundary"). Thirty-four routes once cast their body and read fields by
// hand, each with its own idea of what a wrong type meant; this keeps a new
// one from joining them.
//
// The check is by source: a handler that calls request.json() or
// request.formData() must call safeParse in the same handler. A route that
// hands its whole body to a module that parses it with zod one call deeper
// is listed below with that module, and the list fails when an entry stops
// reading a body or starts parsing it itself, so it never goes stale.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "src", "app", "api");

const ALREADY_PARSED = new Map([
  [
    "campaigns/[campaignId]/dm/bundle/route.ts",
    "the manifest is the whole body, and exportWorkshopBundle parses it with bundleManifestSchema (src/lib/db/workshop-bundle-export.ts) after it has refused a campaign",
  ],
  [
    "campaigns/[campaignId]/dm/bundle/pack/route.ts",
    "the same manifest through the same exportWorkshopBundle and bundleManifestSchema as dm/bundle",
  ],
  [
    "profile/campaign-defaults/route.ts",
    "validateDefaultsWrite (src/lib/campaign-defaults.ts) refuses any key but version and settings, and parses each setting with the campaign creator's own zod schema for it",
  ],
]);

// Handlers the first pass of issue #570 did not reach: each file's other
// handler parses its body, so a file-level grep missed them. Parse the body
// and take the entry off; the check fails until you do, once it is parsed.
const NOT_YET = new Set([]);

function routeFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const READS_BODY = /\b(?:request|req)\.(?:json|formData)\(\)/;
// safeParse, or a schema's parse inside a try (admin/restore). JSON.parse
// and Date.parse are not a schema.
const PARSES = /\.safeParse\(|\b\w*[Ss]chema\.parse\(/;
const HANDLER = /^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/gm;

// Each exported handler's source, up to the next export at the top level.
function handlers(source) {
  const starts = [...source.matchAll(HANDLER)];
  return starts.map((match, index) => ({
    method: match[1],
    body: source.slice(match.index, index + 1 < starts.length ? starts[index + 1].index : source.length),
  }));
}

const files = routeFiles(apiDir);
assert.ok(files.length > 100, `expected the API routes under ${apiDir}, found ${files.length}`);

const unchecked = [];
for (const file of files) {
  const relative = path.relative(apiDir, file).split(path.sep).join("/");
  const source = readFileSync(file, "utf8");
  const readers = handlers(source).filter((handler) => READS_BODY.test(handler.body));
  const missing = readers.filter((handler) => !PARSES.test(handler.body));
  if (ALREADY_PARSED.has(relative)) {
    assert.ok(readers.length > 0, `${relative} no longer reads a body; take it off ALREADY_PARSED`);
    assert.ok(missing.length > 0, `${relative} parses its body itself now; take it off ALREADY_PARSED`);
    continue;
  }
  for (const handler of missing) {
    unchecked.push(`${relative} ${handler.method}`);
  }
}

for (const entry of NOT_YET) {
  assert.ok(unchecked.includes(entry), `${entry} parses its body now (or is gone); take it off NOT_YET`);
}
const remaining = unchecked.filter((entry) => !NOT_YET.has(entry));

assert.deepEqual(
  remaining,
  [],
  `These handlers read a request body without a zod schema (safeParse). Parse the body at the boundary, as .github/CONTRIBUTING.md says:\n  ${remaining.join("\n  ")}`,
);

console.log(`routes-validate-body: ${files.length} routes, every body read is parsed with zod`);
