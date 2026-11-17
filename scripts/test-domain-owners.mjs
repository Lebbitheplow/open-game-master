// One owner for every thing in the game (docs/specs/ogm-domain-owners.md).
//
// A domain's raw setter may be imported only by its owner (src/lib/owners/)
// and by src/lib/db/. Files that still import one while the migration runs are
// listed in scripts/domain-owners-baseline.json; that list can only shrink:
// - a file importing a setter and not listed fails, naming the file;
// - a listed file that no longer imports it fails too, asking to drop it from
//   the list, so the count written down is always the true one.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-domain-owners");
const root = new URL("..", import.meta.url).pathname;
const baselinePath = join(root, "scripts/domain-owners-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

// setter -> { module it lives in, the only places allowed to import it }
const SETTERS = {
  patchSheet: { from: "@/lib/db/sheets", owners: ["src/lib/db/", "src/lib/owners/"] },
  // Half a writer: the things go through the owner, the rest is still written directly.
  patchWithItems: { from: "@/lib/dm/sheet-patch", owners: ["src/lib/db/", "src/lib/owners/"] },
  ownerWrite: { from: "@/lib/db/owner-gate", owners: ["src/lib/db/", "src/lib/owners/"] },
};

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(relative(root, path));
    }
  }
  return out;
}

const files = sources(join(root, "src"));
const text = new Map(files.map((file) => [file, readFileSync(join(root, file), "utf8")]));

// Files importing `name` from its module (named import, any alias).
function importers(name, from) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const pattern = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${escaped}["']`);
  return files.filter((file) => pattern.test(text.get(file)));
}

for (const [name, { from, owners }] of Object.entries(SETTERS)) {
  const outside = importers(name, from).filter((file) => !owners.some((prefix) => file.startsWith(prefix))).sort();
  const allowed = new Set(baseline[name] ?? []);

  await test(`${name}: no new writer outside its owner`, () => {
    const fresh = outside.filter((file) => !allowed.has(file));
    assert.deepEqual(fresh, [], `${name} is written only by its owner; call the owner instead from: ${fresh.join(", ")}`);
  });

  await test(`${name}: the list of remaining writers is the true one`, () => {
    const gone = [...allowed].filter((file) => !outside.includes(file));
    assert.deepEqual(gone, [], `drop from scripts/domain-owners-baseline.json (${name}): ${gone.join(", ")}`);
  });

  console.log(`  ${name}: ${outside.length} file(s) still outside the owner`);
}

finish();
