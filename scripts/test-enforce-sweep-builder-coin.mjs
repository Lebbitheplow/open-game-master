// Builder sweep, part 6: coin is written in every unit wherever a purse is
// written.
//
// src/lib/srd/currency.ts writes a sum of copper as gold, silver and copper
// (formatPrice, formatPurse). PR #784 found the character sheet PDF and the
// builder writing a purse their own way, and each fix was to one writer. This
// walks the source instead: every function outside currency.ts that builds
// coin words from a number in more than one unit is a row. A second writer
// that an importer can call with a sum of copper must say what formatPrice
// says for a spread of sums; one that cannot be called must at least name
// all three units, so silver is never written as tens of copper.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import * as known from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-coin", { KNOWN: expand(known.KNOWN_COIN ?? []), SKIP: {} });
const root = path.resolve(import.meta.dirname, "../src");
const { formatPrice } = await import("../src/lib/srd/currency.ts");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

// A function's text, from its header to the closing brace at its indent.
function functionsOf(source) {
  const out = [];
  const header = /^(export )?(?:async )?function (\w+)\(([^)]*)\)[^{]*\{$/gm;
  for (let match = header.exec(source); match; match = header.exec(source)) {
    const end = source.indexOf("\n}\n", match.index);
    out.push({ exported: Boolean(match[1]), name: match[2], params: match[3], body: source.slice(match.index, end < 0 ? undefined : end) });
  }
  return out;
}

// Coin words built from a value: `${n} gp`, never a sentence that only
// mentions a price in gold.
const unit = (word) => new RegExp("\\$\\{[^}]+\\} ?" + word + "\\b");
const SUMS = [0, 5, 10, 90, 100, 390, 1234, 10000];

let writers = 0;
for (const file of files(root).sort()) {
  if (file.endsWith(path.join("srd", "currency.ts"))) continue;
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!unit("gp").test(source) || !(unit("cp").test(source) || unit("sp").test(source))) continue;
  for (const fn of functionsOf(source)) {
    const units = ["gp", "sp", "cp"].filter((word) => unit(word).test(fn.body));
    if (!units.includes("gp") || units.length < 2) continue;
    writers += 1;
    const relative = path.relative(path.resolve(root, ".."), file);
    await rows.row(`coin:${relative}#${fn.name}`, async () => {
      assert.deepEqual(units, ["gp", "sp", "cp"], `${fn.name} writes coin in ${units.join(" and ")} only`);
      // One number in, words out: it can be held to the shared writer.
      if (fn.exported && /^\w+: number$/.test(fn.params.trim())) {
        const mod = await import(new URL(`../${relative}`, import.meta.url).href);
        for (const sum of SUMS) {
          assert.equal(mod[fn.name](sum), formatPrice(sum), `${fn.name}(${sum})`);
        }
      }
    });
  }
}
console.log(`${writers} functions outside currency.ts write coin in more than one unit`);
assert.ok(writers > 0, "the scan found no second writer at all: its patterns no longer match the source");

rows.finish();
