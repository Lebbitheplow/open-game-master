// The lead's Context panel shows what the storyteller was last sent
// (context-trace route). A newer turn that stopped before a prompt was
// assembled (the narrator down after an update, issue 925's halted turn)
// keeps no trace; the route answered with it, so the panel went empty and
// the prompt actually sent last was lost from view.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-context-trace-latest");
const { createDmTurn, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");

const world = await openWorld();

async function trace() {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/context-trace");
  const response = await handler.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, body: await response.json() };
}

const sent = {
  limitTokens: 40_000,
  promptTokens: 9_000,
  blocks: [{ id: "game-state", kind: "state", tokens: 3_000, included: true, reason: "always included", position: 1 }],
};

await test("a campaign with no turn answers an empty trace, not an error", async () => {
  const answer = await trace();
  assert.equal(answer.status, 200);
  assert.equal(answer.body.trace, null);
});

await test("a newer turn that sent nothing leaves the last prompt sent on the panel", async () => {
  const traced = createDmTurn(world.campaignId, []);
  saveDmTurn({ ...traced, status: "done", contextTrace: sent });
  const halted = createDmTurn(world.campaignId, []);
  saveDmTurn({ ...halted, status: "failed", contextTrace: null });
  const answer = await trace();
  assert.equal(answer.status, 200);
  assert.equal(answer.body.turnId, traced.id, "the panel answered with the halted turn");
  assert.equal(answer.body.trace?.promptTokens, 9_000);
});

await test("a newer turn with its own trace is the one shown", async () => {
  const next = createDmTurn(world.campaignId, []);
  saveDmTurn({ ...next, status: "done", contextTrace: { ...sent, promptTokens: 12_000 } });
  const answer = await trace();
  assert.equal(answer.body.turnId, next.id);
  assert.equal(answer.body.trace?.promptTokens, 12_000);
});

finish();
