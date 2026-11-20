// The storyteller's window minimums (src/lib/story-window.ts): what each size
// is told, and every place that quotes them (the README, the install and
// text-backend guides, npm run setup) saying the same numbers. That the
// minimums hold for a real turn is scripts/test-tool-profiles.mjs's to show.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const windows = await import("../src/lib/story-window.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

await test("each window is told whether it plays the full rules", () => {
  const level = (tokens) => windows.storyWindowVerdict(tokens).level;
  assert.equal(level(8_192), "short");
  assert.equal(level(windows.MIN_NARRATION_WINDOW - 1), "short");
  // Below FULL_RULES_WINDOW a turn plays only on a cut tool set and rules,
  // which Open Game Master does not support or test.
  assert.equal(level(windows.MIN_NARRATION_WINDOW), "reduced");
  assert.equal(level(32_768), "reduced");
  assert.equal(level(49_152), "reduced");
  assert.equal(level(windows.FULL_RULES_WINDOW - 1), "reduced");
  assert.equal(level(windows.FULL_RULES_WINDOW), "ok", "a model sold as 64K plays the full rules");
  assert.equal(level(65_536), "ok");
  assert.equal(windows.storyWindowVerdict(65_536).text, "", "enough says nothing");
  assert.match(windows.storyWindowVerdict(8_192).text, /^An 8K window is too small to narrate/);
  assert.match(windows.storyWindowVerdict(32_768).text, /^A 32K window is too small for the full rules/);
});

await test("a size is named the way it was set", () => {
  assert.equal(windows.windowLabel(65_536), "64K", "llama-server -c 65536");
  assert.equal(windows.windowLabel(131_072), "128K");
  assert.equal(windows.windowLabel(128_000), "128K", "the catalog's thousands");
  assert.equal(windows.windowLabel(16_000), "16K");
  assert.equal(windows.windowLabel(1_050_000), "1.1M");
  assert.equal(windows.aWindow(8_192), "An 8K");
  assert.equal(windows.aWindow(65_536), "A 64K");
});

await test("llama-server's -c clears the minimum", () => {
  assert.equal(windows.windowFlag(windows.FULL_RULES_WINDOW), 65_536);
  // The full set is chosen when it leaves MIN_STORY_ROOM_TOKENS of the
  // window (src/lib/dm/model-tuning-logic.ts): 64K must leave that beside a
  // four-hero campaign's ~28K of tools.
  assert.ok(windows.FULL_RULES_WINDOW - 28_000 >= 32_000);
});

await test("the README, the guides and npm run setup quote the same minimum", () => {
  const needs = `The storyteller needs a context window of at least ${windows.windowLabel(windows.FULL_RULES_WINDOW)} tokens to play the full rules; smaller windows are not supported`;
  assert.ok(windows.STORY_WINDOW_NEEDS.includes(needs), "the app's own sentence");
  for (const file of ["README.md", "docs/install.md", "docs/text-backends.md", "scripts/setup.mjs"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8").replace(/\*\*/g, "").replace(/\$\{dim\("[^"]*"\)\}/g, "").replace(/\s+/g, " ");
    assert.ok(text.includes(needs), `${file} says "${needs}"`);
  }
  const table = fs.readFileSync(path.join(root, "docs/text-backends.md"), "utf8");
  assert.ok(table.includes(`| ${windows.windowLabel(windows.FULL_RULES_WINDOW)} (\`-c ${windows.windowFlag(windows.FULL_RULES_WINDOW)}\`) |`), "the table has the 64K row");
});

console.log(`story-window: ${passed} tests passed`);
