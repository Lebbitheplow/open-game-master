// The large-world budgets (audit WF-24, plan M6), on a 1,000-entry world
// built by scripts/lib/large-world.mjs. The numbers behind each budget, and
// how to measure again, are in docs/worldforge-large-worlds.md. Sizes are
// exact, so their budgets are close; times have wide margins, because CI's
// runners are slower than the machine they were measured on.
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { largeWorld } from "./lib/large-world.mjs";

const { test, finish } = suite("test-world-large-budgets");
const { importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldAnswer, worldAnswerFor, worldView } = await import("../src/lib/db/world-forge.ts");
const { searchIndex, searchEntries } = await import("../src/lib/worldforge/search.ts");
const { compressedJson } = await import("../src/lib/compressed-json.ts");
const { PACKED_JSON_HEADER, unpackJson } = await import("../src/lib/packed-json.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createUser } = await import("../src/lib/db/users.ts");

// Measured on the reference machine (docs/worldforge-large-worlds.md): the
// answer is 3,197 KB, 513 KB gzipped at the usual level, built in 37 ms; the search's keys in
// 21 ms and each search in 2 ms or less.
const BUDGET = {
  answerKb: 3_500,
  answerGzipKb: 600,
  answerMs: 600,
  // On the wire, packed as the server packs it (brotli or gzip at their
  // fastest: 579 and 667 KB), and the time packing takes (16 and 23 ms).
  wireKb: 900,
  packMs: 300,
  indexMs: 500,
  searchMs: 100,
};

await openWorld();
const admin = createUser(`budget${Date.now().toString(36)}`, "x", { isAdmin: true });
const workshop = createWorkshop(admin.id, { title: "A world of 1000" });
const { file, needles } = largeWorld(1_000);
importWorldForge(workshop.id, { id: admin.id, isAdmin: true }, file);
const kb = (bytes) => Math.round(bytes / 1024);
// The best of three, so one pause of the runner is not a failure.
const best = (fn) => {
  let fastest = Infinity;
  let result;
  for (let round = 0; round < 3; round += 1) {
    const started = performance.now();
    result = fn();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return { ms: Math.round(fastest), result };
};

await test("The world came in whole: 1,000 entries, 2,000 links, 500 events.", () => {
  const { doc, entities } = worldView(workshop.id);
  assert.equal(entities.length, 1_000);
  assert.equal(doc.links.length, 2_000);
  assert.equal(doc.events.length, 500);
  assert.ok(doc.pins.length > 0, "no Atlas pins");
});

await test("The World tab's answer keeps to its size, each entry's WorldForge data sent once.", () => {
  const { ms, result } = best(() => JSON.stringify(worldAnswer(workshop.id)));
  const answer = JSON.parse(result);
  assert.equal(answer.doc.entries, undefined, "the document's entries were sent beside the entities that carry them");
  assert.ok(answer.entities.every((entity) => entity.entry && typeof entity.entry.article === "string"));
  const size = kb(Buffer.byteLength(result));
  const gzipped = kb(zlib.gzipSync(result).length);
  assert.ok(size <= BUDGET.answerKb, `the answer is ${size} KB, over its ${BUDGET.answerKb} KB budget`);
  assert.ok(gzipped <= BUDGET.answerGzipKb, `the answer is ${gzipped} KB gzipped, over its ${BUDGET.answerGzipKb} KB budget`);
  assert.ok(ms <= BUDGET.answerMs, `the answer took ${ms} ms, over its ${BUDGET.answerMs} ms budget`);
});

await test("The lean answer goes only to a caller that asks for it: an older app's screens read the document's entries.", () => {
  const route = `http://localhost/api/campaigns/${workshop.id}/world`;
  assert.equal(worldAnswerFor(new Request(`${route}?lean=1`), workshop.id).doc.entries, undefined);
  const whole = worldAnswerFor(new Request(route), workshop.id);
  assert.equal(Object.keys(whole.doc.entries ?? {}).length, whole.entities.length);
});

await test("The answer goes over the wire packed to a caller that unpacks it, plain to any other, and never under a Content-Encoding Next would drop.", async () => {
  const body = worldAnswer(workshop.id);
  const asks = { headers: { [PACKED_JSON_HEADER]: "gzip", "accept-encoding": "gzip, deflate, br" } };
  const packed = compressedJson(new Request("http://x/", asks), body);
  // Next 16.4.6 strips a handler's Content-Encoding and gzips the body again:
  // a packed answer must not lean on it, and must not look compressible.
  assert.equal(packed.headers.get("content-encoding"), null);
  assert.equal(packed.headers.get("content-type"), "application/octet-stream");
  assert.match(packed.headers.get("cache-control") ?? "", /no-transform/);
  assert.equal(packed.headers.get(PACKED_JSON_HEADER), "gzip");
  const bytes = Buffer.from(await packed.clone().arrayBuffer());
  assert.ok(kb(bytes.length) <= BUDGET.wireKb, `${kb(bytes.length)} KB on the wire packed, over ${BUDGET.wireKb} KB`);
  assert.equal(JSON.parse(zlib.gunzipSync(bytes).toString("utf8")).entities.length, 1_000);
  // The browser's half reads it, and reads a plain answer the same way.
  assert.equal((await (await unpackJson(packed)).json()).entities.length, 1_000);
  const browserOnly = compressedJson(new Request("http://x/", { headers: { "accept-encoding": "gzip, br" } }), body);
  assert.equal(browserOnly.headers.get("content-encoding"), null);
  assert.equal(browserOnly.headers.get("content-type"), "application/json");
  assert.equal((await (await unpackJson(browserOnly)).json()).entities.length, 1_000);
  const small = compressedJson(new Request("http://x/", asks), { counts: 1 });
  assert.equal(small.headers.get(PACKED_JSON_HEADER), null, "a small answer was packed");
  assert.deepEqual(await (await unpackJson(small)).json(), { counts: 1 });
  // Packing runs on the request's own time: it must stay a small part of it.
  const { ms } = best(() => compressedJson(new Request("http://x/", asks), body));
  assert.ok(ms <= BUDGET.packMs, `packing took ${ms} ms, over ${BUDGET.packMs} ms`);
});

await test("Search finds an entry by its name, a word deep in a long body and a custom field's value, within budget.", () => {
  const { doc, entities } = worldView(workshop.id);
  const index = best(() => searchIndex(doc, entities));
  assert.ok(index.ms <= BUDGET.indexMs, `the search's keys took ${index.ms} ms, over ${BUDGET.indexMs} ms`);
  const nameOf = new Map(entities.map((entity) => [entity.ref, entity.name]));
  const where = { name: "name", body: "text", field: "field" };
  for (const [kind, needle] of Object.entries(needles)) {
    const search = best(() => searchEntries(index.result, needle.query));
    assert.ok(search.ms <= BUDGET.searchMs, `${kind} search took ${search.ms} ms, over ${BUDGET.searchMs} ms`);
    const hit = search.result.find((entry) => nameOf.get(entry.ref) === needle.holder);
    assert.ok(hit, `${kind} search did not find ${needle.holder}`);
    assert.equal(hit.where, where[kind]);
  }
  const body = searchEntries(index.result, needles.body.query).find((entry) => nameOf.get(entry.ref) === needles.body.holder);
  assert.match(body.excerpt, /obsidianwright guild kept the oldest key/);
  const field = searchEntries(index.result, needles.field.query)[0];
  assert.equal(field.excerpt, "Rank: Quartermaster-Vexil");
});

await test("A name match comes before a field match, and a field match before a text match.", () => {
  const { doc, entities } = worldView(workshop.id);
  const index = searchIndex(doc, entities);
  const order = { name: 0, alias: 0, tag: 0, field: 1, text: 2 };
  const hits = searchEntries(index, "salt");
  assert.ok(hits.length > 3);
  for (let at = 1; at < hits.length; at += 1) assert.ok(order[hits[at - 1].where] <= order[hits[at].where], `${hits[at - 1].where} after ${hits[at].where}`);
  assert.equal(searchEntries(index, "").length, entities.length, "an empty search hid entries");
  assert.equal(searchEntries(index, "zzqx no such words").length, 0);
});

finish();
