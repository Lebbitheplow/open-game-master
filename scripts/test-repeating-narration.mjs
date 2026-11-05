// A model that loops in a narration call made without a stream: a continue,
// a reroll and the resume recap ask for the whole reply at once, so nothing
// stops it early, but what they keep is the loop's first copy, never the
// loop. The guard itself and the streamed calls are covered in
// test-stream-repetition.mjs; here the real routes run against the scripted
// fake model (scripts/lib/enforce-narrator.mjs), whose non-streamed answer is
// one JSON completion.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-repeating-narration");

const { getCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { runResumeRecap } = await import("../src/lib/dm/recap.ts");

const PASSAGE =
  "The rain thins to a mist over the ford, and somewhere upstream a heron lifts from the reeds with a cry that carries across the water to the caravan waiting on the far bank.";
const LOOP = (PASSAGE + "\n\n").repeat(6);
const count = (text, part) => text.split(part).length - 1;
assert.ok(PASSAGE.length >= 160, "the passage is long enough to count as a loop");

async function table() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1 });
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: "The caravan halts at the ford while the drovers argue over the crossing." })]);
  const narration = await model.turn(world, "I walk down to the water.", kara.id);
  assert.ok(narration, "the opening turn narrated");
  return { world, model, narration };
}

async function post(world, route, narration, body) {
  const handler = await world.route(route);
  world.signIn(world.owner);
  const response = await handler.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId, messageId: narration.id }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

await test("A continue whose reply loops extends the narration by the first copy alone.", async () => {
  const { world, model, narration } = await table();
  model.script([reply({ text: LOOP })]);
  const continued = await post(world, "campaigns/[campaignId]/messages/[messageId]/continue", narration);
  assert.equal(continued.status, 200, JSON.stringify(continued.json));
  assert.equal(model.requests.at(-1).stream, undefined, "the continue was not a whole reply");
  const content = getCampaignMessage(narration.id).content;
  assert.match(content, /drovers argue/);
  assert.equal(count(content, PASSAGE), 1, `the loop was kept: ${content}`);
  model.close();
  world.close();
});

await test("A reroll whose reply loops stores the first copy as the new take.", async () => {
  const { world, model, narration } = await table();
  model.script([reply({ text: LOOP })]);
  const rerolled = await post(world, "campaigns/[campaignId]/messages/[messageId]/renarrate", narration, { action: "reroll" });
  assert.equal(rerolled.status, 200, JSON.stringify(rerolled.json));
  const stored = getCampaignMessage(narration.id);
  assert.equal(count(stored.content, PASSAGE), 1, `the loop was kept: ${stored.content}`);
  assert.ok(stored.variants.some((variant) => /drovers argue/.test(variant)), "the first take is still a variant");
  model.close();
  world.close();
});

await test("A resume recap whose reply loops is posted once.", async () => {
  const { world, model } = await table();
  model.script([reply({ text: LOOP })]);
  await runResumeRecap(world.campaignId);
  const recap = listRecentMessages(world.campaignId, 20).find((message) => message.content.startsWith("Previously: "));
  assert.ok(recap, "no recap was posted");
  assert.equal(recap.content, `Previously: ${PASSAGE}`);
  model.close();
  world.close();
});

// The recap is drawn from the story model, which on the harness provider is
// an agent program that sometimes writes a call into its reply as text
// (issue 794). The session banner shows the recap as it is stored, so the
// block is cut before it is posted.
await test("A resume recap with a call written as text is posted without it.", async () => {
  const { world, model } = await table();
  model.script([reply({ text: `${PASSAGE}\n\n<invoke name="mcp__odm__request_player_input">\n<parameter name="prompt">Where to?</parameter>\n</invoke>` })]);
  await runResumeRecap(world.campaignId);
  const recap = listRecentMessages(world.campaignId, 20).find((message) => message.content.startsWith("Previously: "));
  assert.ok(recap, "no recap was posted");
  assert.equal(recap.content, `Previously: ${PASSAGE}`);
  model.close();
  world.close();
});

finish();
