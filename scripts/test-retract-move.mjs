// Take back and rewrite (src/lib/dm/retract.ts): the newest player move, a
// typo the GM already answered, leaves the transcript with the answer, the
// answer's turn is reverted (here: the hour it spent), and the words come
// back to be corrected. Older moves and the GM's own lines are refused.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply, call } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-retract-move");
const { getClock } = await import("../src/lib/db/clock.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const hero = world.addHero({ class: "fighter", level: 3, maxHp: 30 });

async function retract(messageId) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/messages/[messageId]/retract");
  const response = await handler.POST(new Request("http://test/", { method: "POST" }), {
    params: Promise.resolve({ campaignId: world.campaignId, messageId }),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const transcript = () => listRecentMessages(world.campaignId, 100);
const minutes = () => {
  const clock = getClock(world.campaignId);
  return JSON.stringify(clock);
};

try {
  await test("the newest move goes with the GM's answer, the turn is reverted and the words come back", async () => {
    model.script([reply({ text: "The road is quiet under a grey sky." })]);
    await model.turn(world, "I look down the road.", hero.id);
    const kept = transcript();
    const before = minutes();

    model.script([
      reply({ calls: [call("pass_time", { amount: 1, unit: "hours" })] }),
      reply({ text: "An hour goes by while you wait at the door." }),
    ]);
    const answer = await model.turn(world, "I attak the door.", hero.id);
    assert.ok(answer, "the GM answered the typo");
    assert.notEqual(minutes(), before, "the answer spent an hour");
    const move = transcript().find((message) => message.content === "I attak the door.");

    const result = await retract(move.id);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.text, "I attak the door.", "the words come back to correct");
    assert.deepEqual(
      transcript().map((message) => message.id),
      kept.map((message) => message.id),
      "the move and everything after it left the transcript; what came before stayed",
    );
    assert.equal(minutes(), before, "the hour the answer spent is back");
    const open = getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM dm_turns WHERE campaign_id = ? AND created_at >= ? AND reverted_at IS NULL`)
      .get(world.campaignId, move.createdAt);
    assert.equal(open.n, 0, "every turn that answered the move reads as reverted");
  });

  await test("only the newest player move, never the GM's line", async () => {
    model.script([reply({ text: "The wind picks up." })]);
    const answer = await model.turn(world, "I wait.", hero.id);
    model.script([reply({ text: "Nothing moves." })]);
    await model.turn(world, "I keep waiting.", hero.id);
    const older = transcript().find((message) => message.content === "I wait.");
    assert.equal((await retract(older.id)).status, 400, "an older move stays");
    assert.equal((await retract(answer.id)).status, 400, "a GM line is not a move");
    assert.equal((await retract("nope")).status, 404);
  });
} finally {
  model.close();
}
finish();
