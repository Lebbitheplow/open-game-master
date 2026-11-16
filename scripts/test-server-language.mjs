// The server's language picks the GM's memory model (issue #919): English keeps
// MiniLM, any other language takes the multilingual model, and an
// EMBEDDING_MODEL the operator set always wins. Plus the setup wizard's first
// guess from a browser language, and the live switch in src/lib/embeddings.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ENGLISH_EMBEDDING_MODEL,
  LANGUAGE_FLAGS,
  MULTILINGUAL_EMBEDDING_MODEL,
  embeddingModelFor,
  languageFromLocale,
} from "../src/lib/language/server-language.ts";
import { TABLE_LANGUAGES } from "../src/lib/schemas/game-settings-options.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const unpinned = { model: "", dtype: "" };

test("English keeps the English model, every other language the multilingual one", () => {
  assert.deepEqual(embeddingModelFor("english", unpinned), { ...ENGLISH_EMBEDDING_MODEL, source: "language" });
  for (const language of TABLE_LANGUAGES.filter((id) => id !== "english")) {
    assert.deepEqual(embeddingModelFor(language, unpinned), { ...MULTILINGUAL_EMBEDDING_MODEL, source: "language" }, language);
  }
});

test("an EMBEDDING_MODEL in .env.server wins over the language", () => {
  assert.deepEqual(embeddingModelFor("french", { model: "Xenova/all-MiniLM-L6-v2", dtype: "" }), {
    id: "Xenova/all-MiniLM-L6-v2",
    dtype: "fp32",
    source: "env",
  });
  assert.deepEqual(embeddingModelFor("english", { model: " Some/model ", dtype: "q8" }), { id: "Some/model", dtype: "q8", source: "env" });
});

test("an EMBEDDING_DTYPE set alone applies to the model the language picks", () => {
  assert.deepEqual(embeddingModelFor("english", { model: "", dtype: "q8" }), { id: ENGLISH_EMBEDDING_MODEL.id, dtype: "q8", source: "language" });
});

test("every table language has a flag", () => {
  for (const language of TABLE_LANGUAGES) assert.match(LANGUAGE_FLAGS[language], /^[a-z]{2}$/, language);
});

test("a browser language becomes the wizard's first guess, or nothing", () => {
  assert.equal(languageFromLocale("fr-FR"), "french");
  assert.equal(languageFromLocale("nb"), "norwegian");
  assert.equal(languageFromLocale("pt_BR"), "portuguese");
  assert.equal(languageFromLocale("en-US"), "english");
  assert.equal(languageFromLocale("ja-JP"), null);
  assert.equal(languageFromLocale("constructor"), null);
  assert.equal(languageFromLocale(""), null);
  assert.equal(languageFromLocale(undefined), null);
});

test("the live switch changes the key and says so only when the model changes", () => {
  // A child with no EMBEDDING_* in its environment and no .env.server in its
  // working directory: a default install.
  const env = { ...process.env };
  delete env.EMBEDDING_MODEL;
  delete env.EMBEDDING_DTYPE;
  const url = new URL("../src/lib/embeddings.ts", import.meta.url).href;
  const script = `
    const m = await import(${JSON.stringify(url)});
    const out = [m.embeddingKey()];
    out.push(String(m.setEmbeddingLanguage("english")), m.embeddingKey());
    out.push(String(m.setEmbeddingLanguage("french")), m.embeddingKey());
    out.push(String(m.setEmbeddingLanguage("italian")), m.embeddingKey());
    out.push(String(m.setEmbeddingLanguage("english")), m.embeddingKey());
    console.log(out.join("|"));`;
  const dir = mkdtempSync(path.join(tmpdir(), "odm-server-language-"));
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, env, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(child.status, 0, child.stderr);
  const english = "Xenova/all-MiniLM-L6-v2@fp32";
  const multilingual = "Xenova/multilingual-e5-small@q8";
  assert.equal(
    child.stdout.trim().split("\n").at(-1),
    [english, "false", english, "true", multilingual, "false", multilingual, "true", english].join("|"),
  );
});

console.log(`server language checks passed (${passed})`);
