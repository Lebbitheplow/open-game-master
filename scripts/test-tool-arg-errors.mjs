// A tool call whose arguments are refused says which field and why
// (src/lib/dm/tool-errors.ts badArguments, invalidArguments), and a
// descriptive line past its length is fitted at a word instead of refusing
// the call (src/lib/dm/fitted-text.ts). The 0.34.0 report: send_whisper
// refused notes of 1,029, 1,214 and 1,251 characters with "send_whisper
// needs characterIds (from GAME STATE) and a message", which every one of
// them had; the cap was 1,000 and nothing said so. 58 handlers parsed the
// same way, each with a fixed line that dropped zod's reason.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-tool-arg-errors");
const world = await openWorld({ campaign: { maxPlayers: 4 }, gameSettings: { ttsEnabled: false } });
const { z } = await import("zod");
const { badArguments, invalidArguments, argumentsRefusal } = await import("../src/lib/dm/tool-errors.ts");
const { fittedText, fittedLine } = await import("../src/lib/dm/fitted-text.ts");
const { WHISPER_MAX_CHARS } = await import("../src/lib/dm/whispers.ts");
const { sendWhisperTool } = await import("../src/lib/dm/prompt.ts");

const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
const words = (count) => Array.from({ length: count }, (_, at) => `word${at}`).join(" ");
const text = (length) => "a".repeat(length);

// ---- the reason reaches the model ----

await test("A text over its limit says how long it was and the limit; a list says its count; a missing field says missing; bad JSON says so.", () => {
  const schema = z.object({ message: z.string().trim().min(1).max(10), ids: z.array(z.string()).max(2), kind: z.enum(["a", "b"]), need: z.string() });
  const input = { message: text(25), ids: ["x", "y", "z"], kind: "c" };
  const parsed = schema.safeParse(input);
  const refused = invalidArguments("t needs need.", parsed.error, input);
  assert.equal(refused.retry, true);
  assert.match(refused.error, /^t needs need\. \(/);
  assert.match(refused.error, /message: 25 characters, over the limit of 10; shorten it and send it again/);
  assert.match(refused.error, /ids: 3 entries, over the limit of 2; send at most 2/);
  assert.match(refused.error, /kind: Invalid option: expected one of "a"\|"b"/);
  assert.match(refused.error, /need: missing/);
  const json = badArguments("t needs need.", (() => { try { JSON.parse("{bad"); } catch (error) { return error; } })(), "{bad");
  assert.equal(json.error, "t needs need. (the arguments are not valid JSON: send one JSON object)");
  const thrown = (() => { try { schema.parse(input); } catch (error) { return error; } })();
  assert.match(badArguments("t needs need.", thrown, JSON.stringify(input)).error, /message: 25 characters/);
  assert.match(argumentsRefusal("t needs need.", schema, JSON.stringify(input)).error, /ids: 3 entries/);
});

await test("send_whisper takes a 1,251-character note, and refuses one past 2,000 with its length and the limit.", async () => {
  assert.equal(WHISPER_MAX_CHARS, 2000);
  const long = await world.invoke("send_whisper", { characterIds: [kara.id], message: text(1251) });
  assert.equal(long.error, undefined, long.error);
  const over = await world.invoke("send_whisper", { characterIds: [kara.id], message: text(2100) });
  assert.equal(over.ok, false);
  assert.match(over.error, /message: 2100 characters, over the limit of 2000; shorten it and send it again/);
  // The tool's description says the limit the model is held to.
  assert.match(sendWhisperTool.function.parameters.properties.message.description, /Up to 2,000 characters/);
});

await test("A descriptive line past its length is fitted at a word, and the call runs.", async () => {
  const fitted = fittedText(200).parse(`${words(60)}`);
  assert.ok(fitted.length <= 200 && fitted.endsWith("…"), fitted);
  assert.equal(fittedText(200).parse("  short reason  "), "short reason");
  assert.throws(() => fittedLine(200).parse("   "));
  assert.throws(() => fittedText(200).parse(text(4001)));
  const npc = await world.invoke("set_npc", { name: "Orla", gender: "Female", trait: words(80), goal: words(80), ambition: words(80) });
  assert.equal(npc.error, undefined, npc.error);
});

// ---- no handler drops the reason again ----

await test("No tool handler answers a refused parse with a fixed line: each one hands zod's reason on.", () => {
  // The DM tools' own folder; a stored trade offer (trade.ts) is read by the
  // server, not sent by a model, and says only that it could not be read.
  // fileURLToPath, not .pathname: on Windows the pathname reads "/D:/..." and
  // readdirSync took it as "C:\\D:\\..."
  const root = fileURLToPath(new URL("../src/lib/dm/", import.meta.url));
  const ALLOWED = new Set(["trade.ts"]);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) files.push(path);
    }
  };
  walk(root);
  const swallowed = /\.parse\([^\n]*\n(?:[^\n]*\n){0,2}?\s*\} catch \{\n\s*return (?:\{ result: )?\{\s*\n?\s*error:/;
  const offenders = files
    .filter((path) => swallowed.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(root.length))
    .filter((path) => !ALLOWED.has(path));
  assert.deepEqual(offenders, [], `parse failures answered without their reason: ${offenders.join(", ")}`);
});

await finish();
world.close?.();
