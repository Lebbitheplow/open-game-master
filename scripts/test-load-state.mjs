// A list request read to its end (issue 140): the payload when the server
// said yes, otherwise one sentence that names what did not load and why, in
// the server's words where it gave any. The panels draw their "nothing here
// yet" plate only after a yes with nothing in it, which is what keeps three
// prepared maps behind a 403 from looking lost.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { findLostCreate, readLoad, readWrite } = await import("../src/lib/load-state.ts");
const { translate } = await import("../src/lib/messages-logic.ts");

// English-bound: the composed sentences are asserted in the source words.
const t = (key, vars) => translate("en", key, vars);
const UNREACHABLE = t("The server could not be reached.");
const UNREADABLE = t("The server's answer could not be read.");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const reply = (body, status = 200) =>
  Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

await test("a yes is the payload, with no sentence", async () => {
  const outcome = await readLoad(t, reply({ maps: [{ id: "m1" }], board: null }), t("The maps"));
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.payload, { maps: [{ id: "m1" }], board: null });
});

await test("a yes with nothing in it is still a yes: the empty plate is the panel's call", async () => {
  const outcome = await readLoad(t, reply({ maps: [] }), t("The maps"));
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.payload.maps, []);
});

await test("a refusal keeps the server's sentence after what did not load", async () => {
  const outcome = await readLoad(t, reply({ error: "Only the Dungeon Master can do that." }, 403), t("The maps"));
  assert.equal(outcome.payload, null);
  assert.equal(outcome.error, "The maps did not load. Only the Dungeon Master can do that.");
});

await test("a refusal without a sentence names the status", async () => {
  assert.equal((await readLoad(t, reply("", 500), t("The cast"))).error, `The cast did not load. ${t("The server answered {code}.", { code: 500 })}`);
  assert.equal((await readLoad(t, reply({ error: "   " }, 404), t("The cast"))).error, `The cast did not load. ${t("The server answered {code}.", { code: 404 })}`);
  assert.equal((await readLoad(t, reply({ error: 12 }, 401), t("The cast"))).error, `The cast did not load. ${t("The server answered {code}.", { code: 401 })}`);
});

await test("a request that never reached the server says so, and never throws", async () => {
  const outcome = await readLoad(t, Promise.reject(new TypeError("fetch failed")), t("The tables"));
  assert.equal(outcome.payload, null);
  assert.equal(outcome.error, `The tables did not load. ${UNREACHABLE}`);
});

await test("a 200 that is not JSON is not an empty list either", async () => {
  const outcome = await readLoad(t, reply("<html>sign in</html>"), t("The bestiary"));
  assert.equal(outcome.payload, null);
  assert.equal(outcome.error, `The bestiary did not load. ${UNREADABLE}`);
});

// A change sent to the server (WA-05): read to its end and never thrown, so
// a write that dies on the connection is said in the panel rather than
// left as an unhandled rejection with a draft that looks saved.
await test("a write the server took is its payload, with no sentence and an answer", async () => {
  const outcome = await readWrite(t, reply({ template: { id: "t1" } }, 201), t("The save did not go through."));
  assert.deepEqual(outcome, { payload: { template: { id: "t1" } }, error: null, unanswered: false });
});

await test("a refused write keeps the server's own sentence, and the server did answer", async () => {
  const outcome = await readWrite(t, reply({ error: "A prepared encounter needs a name and a roster." }, 400), t("The save did not go through."));
  assert.deepEqual(outcome, { payload: null, error: "A prepared encounter needs a name and a roster.", unanswered: false });
});

await test("a refused write without a sentence says what failed and the status", async () => {
  assert.equal((await readWrite(t, reply("", 500), t("The save did not go through."))).error, `${t("The save did not go through.")} ${t("The server answered {code}.", { code: 500 })}`);
  assert.equal((await readWrite(t, reply({ error: "  " }, 409), t("That did not go through."))).error, `${t("That did not go through.")} ${t("The server answered {code}.", { code: 409 })}`);
});

await test("a write that never reached the server is unanswered: it may have landed, and nothing throws", async () => {
  const outcome = await readWrite(t, Promise.reject(new TypeError("Failed to fetch")), t("The card was not added."));
  assert.deepEqual(outcome, { payload: null, error: `${t("The card was not added.")} ${UNREACHABLE}`, unanswered: true });
});

await test("a yes whose body is not JSON is still a yes", async () => {
  const outcome = await readWrite(t, Promise.resolve(new Response(null, { status: 204 })), t("It was not deleted."));
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.payload, {});
  assert.equal((await readWrite(t, reply("<html>ok</html>"), t("It was not deleted."))).error, null);
});

// A create whose answer was lost: the list is read again, and only a row
// that was not there before and matches what was sent counts as made.
await test("a lost create found as a new row in the list read again was made", async () => {
  const before = [{ id: "a", name: "Ambush" }];
  const found = await findLostCreate(before, async () => [...before, { id: "b", name: "Bandits at the ford" }], (row) => row.name === "Bandits at the ford");
  assert.equal(found, "made");
});

await test("an old row of the same name does not count, and a list without the row says it was not made", async () => {
  const before = [{ id: "a", name: "Bandits at the ford" }];
  assert.equal(await findLostCreate(before, async () => before, (row) => row.name === "Bandits at the ford"), "missing");
});

await test("a list that cannot be read either leaves it unknown", async () => {
  assert.equal(await findLostCreate([], async () => null, () => true), "unknown");
  assert.equal(await findLostCreate([], () => Promise.reject(new Error("offline")), () => true), "unknown");
  // A list never read cannot tell a row there all along from the new one: a
  // panel whose first read failed does not call an old row "made" and close
  // the editor on a draft that was not sent.
  assert.equal(await findLostCreate(null, async () => [{ id: "a", name: "Bandits at the ford" }], () => true), "unknown");
});

console.log(`test-load-state: ${passed} passed`);
