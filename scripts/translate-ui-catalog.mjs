#!/usr/bin/env node
// Drafts the Italian for the interface texts the catalog lacks
// (docs/specs/ogm-italian-ui.md), in batches through the Codex CLI on the
// plan already in use, with the official Italian SRD names as glossary.
// Existing entries are never rewritten: a reviewed or shared entry (an
// Italian table's catalog, upstream issue #919) wins over a draft.
//
//   node scripts/translate-ui-catalog.mjs [--patterns] [--batch 250] [--jobs 4] [--limit N]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { extract } from "./extract-ui-strings.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { italianGlossary } = await import("../src/lib/language/srd-names-it.ts");

const ROOT = path.join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const PATTERNS = args.includes("--patterns");
const FILE = path.join(ROOT, PATTERNS ? "src/lib/language/ui-it.patterns.json" : "src/lib/language/ui-it.json");
const BATCH = option("--batch", 250);
const JOBS = option("--jobs", 4);
const LIMIT = option("--limit", Infinity);

const catalog = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
const { texts, patterns } = extract();
const todo = (PATTERNS ? patterns : texts).filter((text) => !Object.hasOwn(catalog, text)).slice(0, LIMIT);
console.log(`${todo.length} to translate in batches of ${BATCH}, ${JOBS} at a time`);

const RULES = `You translate the user interface of Open Game Master, a web app where friends play Dungeons & Dragons 5e with an AI Game Master, from English into Italian.

Rules:
- Natural, concise Italian as in a well-localized app. Buttons and labels stay short; keep the same register; address the player with "tu".
- Keep exactly: every {placeholder} in braces, numbers, punctuation at the start and end, leading symbols, emoji, markdown, keyboard keys, product and brand names (Open Game Master, Discord, Codex, Claude, Ollama, Kokoro, Pi), file formats, code, units such as "ft".
- A text that is only a code, a name or the same in Italian is returned unchanged.
- D&D terms use the official Italian SRD 5.1 names given below when they appear; otherwise the usual Italian D&D 5e terms (tiro salvezza, punti ferita, classe armatura, prova, vantaggio, svantaggio, iniziativa, slot incantesimo, competenza, Master).
- {placeholder} words stand for text filled in at run time (often a name or a number); place them where Italian grammar needs them.

Return JSON only: {"items":[{"en": <the English exactly as given>, "it": <Italian>}]} with one item for every input, in the same order.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["en", "it"], properties: { en: { type: "string" }, it: { type: "string" } } },
    },
  },
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), "odm-ui-it-"));
fs.writeFileSync(path.join(work, "schema.json"), JSON.stringify(SCHEMA));

function runCodex(prompt, out) {
  return new Promise((resolve) => {
    const child = spawn(
      "codex",
      ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", work, "-c", "model_reasoning_effort=low", "--output-schema", path.join(work, "schema.json"), "-o", out, "-"],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(prompt);
  });
}

function save() {
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(FILE, `${JSON.stringify(sorted, null, 2)}\n`);
}

const slots = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(" ");

const batches = [];
for (let index = 0; index < todo.length; index += BATCH) {
  batches.push(todo.slice(index, index + BATCH));
}
let done = 0;
let rejected = 0;
async function translateBatch(batch, number) {
  const glossary = italianGlossary(batch.join("\n"));
  const prompt = `${RULES}\n\n${glossary ? `${glossary}\n\n` : ""}Input:\n${JSON.stringify(batch)}`;
  const out = path.join(work, `batch-${number}.json`);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { code, stderr } = await runCodex(prompt, out);
    try {
      const { items } = JSON.parse(fs.readFileSync(out, "utf8"));
      const wanted = new Set(batch);
      for (const { en, it } of items) {
        const italian = it.trim();
        // A draft that loses or invents a slot would show the wrong text.
        if (!wanted.has(en) || !italian || slots(en) !== slots(italian)) {
          rejected += 1;
          continue;
        }
        catalog[en] = italian;
        done += 1;
      }
      save();
      console.log(`batch ${number + 1}/${batches.length}: ${done} translated, ${rejected} rejected`);
      return;
    } catch (error) {
      console.error(`batch ${number + 1} attempt ${attempt} failed (exit ${code}): ${String(error).slice(0, 200)} ${stderr.slice(-300)}`);
    }
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: Math.min(JOBS, batches.length) }, async () => {
    while (next < batches.length) {
      const number = next;
      next += 1;
      await translateBatch(batches[number], number);
    }
  }),
);
console.log(`done: ${done} translated, ${rejected} rejected; catalog ${Object.keys(catalog).length} entries`);
