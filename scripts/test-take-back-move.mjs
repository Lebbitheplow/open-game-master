// Take back and rewrite (src/lib/dm/take-back.ts): the newest player move, a
// typo the GM already answered, leaves the transcript with the answer, the
// answer's turn is reverted (here: the hour it spent), the facts drawn from
// the erased lines go, and the words come back to be corrected. Older moves,
// the GM's own lines and an answer that closed a chapter are refused, and a
// refusal changes nothing. Ported from carlitose's fork (PR #1000).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply, call } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-take-back-move");
const { getClock } = await import("../src/lib/db/clock.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertFact } = await import("../src/lib/db/facts.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
const { hostOffers } = await import("../src/lib/use-capabilities.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const hero = world.addHero({ class: "fighter", level: 3, maxHp: 30 });

async function takeBack(messageId, body = {}) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/messages/[messageId]/take-back");
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId, messageId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const transcript = () => listRecentMessages(world.campaignId, 100);
const clock = () => JSON.stringify(getClock(world.campaignId));
const facts = () =>
  getDatabase().prepare(`SELECT fact FROM world_facts WHERE campaign_id = ?`).all(world.campaignId).map((row) => row.fact);

try {
  await test("the newest move goes with the GM's answer, the turn is reverted and the words come back", async () => {
    model.script([reply({ text: "The road is quiet under a grey sky." })]);
    await model.turn(world, "I look down the road.", hero.id);
    const kept = transcript();
    const before = clock();
    const earlier = kept[kept.length - 1];
    insertFact({ campaignId: world.campaignId, category: "lore", subject: "", fact: "The road runs north.", source: "manual", sourceSeq: earlier.seq });

    model.script([
      reply({ calls: [call("pass_time", { amount: 1, unit: "hours" })] }),
      reply({ text: "An hour goes by while you wait at the door." }),
    ]);
    const answer = await model.turn(world, "I attak the door.", hero.id);
    assert.ok(answer, "the GM answered the typo");
    assert.notEqual(clock(), before, "the answer spent an hour");
    insertFact({ campaignId: world.campaignId, category: "lore", subject: "", fact: "The door held for an hour.", source: "manual", sourceSeq: answer.seq });
    const move = transcript().find((message) => message.content === "I attak the door.");

    const result = await takeBack(move.id);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.text, "I attak the door.", "the words come back to correct");
    assert.deepEqual(
      transcript().map((message) => message.id),
      kept.map((message) => message.id),
      "the move and everything after it left the transcript; what came before stayed",
    );
    assert.equal(clock(), before, "the hour the answer spent is back");
    const open = getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM dm_turns WHERE campaign_id = ? AND created_at >= ? AND reverted_at IS NULL`)
      .get(world.campaignId, move.createdAt);
    assert.equal(open.n, 0, "every turn that answered the move reads as reverted");
    assert.deepEqual(facts(), ["The road runs north."], "a fact from the erased answer goes; an older one stays");
  });

  await test("a move the GM has not answered yet is taken back alone", async () => {
    const before = transcript().map((message) => message.id);
    world.signIn(world.owner);
    const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
    const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
    const line = insertCampaignMessage({
      campaignId: world.campaignId,
      seq: allocateSeq(world.campaignId),
      authorType: "player",
      userId: world.owner.id,
      characterId: hero.id,
      content: "I wiat.",
    });
    const result = await takeBack(line.id);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.reverted, 0);
    assert.deepEqual(transcript().map((message) => message.id), before);
  });

  await test("only the newest player move, never the GM's line, and a refusal changes nothing", async () => {
    model.script([reply({ text: "The wind picks up." })]);
    const answer = await model.turn(world, "I wait.", hero.id);
    model.script([reply({ text: "Nothing moves." })]);
    await model.turn(world, "I keep waiting.", hero.id);
    const before = transcript().map((message) => message.id);
    const older = transcript().find((message) => message.content === "I wait.");
    assert.equal((await takeBack(older.id)).status, 400, "an older move stays");
    assert.equal((await takeBack(answer.id)).status, 400, "a GM line is not a move");
    assert.equal((await takeBack("nope")).status, 404);
    assert.equal((await takeBack(older.id, { confirm: "yes" })).status, 400, "a body the route does not know is refused");
    assert.deepEqual(transcript().map((message) => message.id), before, "nothing left the transcript");
  });

  await test("an answer that closed a chapter is refused: rewinding the chapter takes it back", async () => {
    model.script([reply({ text: "Dawn breaks over the hills." })]);
    await model.turn(world, "We make camp.", hero.id);
    const move = transcript().find((message) => message.content === "We make camp.");
    const db = getDatabase();
    db.prepare(`UPDATE chapters SET seq_end = ? WHERE campaign_id = ? AND seq_end IS NULL`).run(move.seq + 1, world.campaignId);
    const closed = db.prepare(`SELECT COUNT(*) AS n FROM chapters WHERE campaign_id = ? AND seq_end >= ?`).get(world.campaignId, move.seq);
    if (closed.n === 0) {
      db.prepare(
        `INSERT INTO chapters (id, campaign_id, chapter_index, title, summary, highlights_json, seq_start, seq_end, status, created_at, updated_at)
         VALUES (?, ?, 99, '', '', '[]', 0, ?, 'closed', datetime('now'), datetime('now'))`,
      ).run(`chapter-${move.id}`, world.campaignId, move.seq + 1);
    }
    const before = transcript().map((message) => message.id);
    const result = await takeBack(move.id);
    assert.equal(result.status, 400, JSON.stringify(result.json));
    assert.match(result.json.error, /Rewind the chapter/);
    assert.deepEqual(transcript().map((message) => message.id), before);
  });

  await test("an older host offers no take-back: the screens read the feature flag", () => {
    assert.equal(SERVER_FEATURES.takeBackMove, true);
    assert.equal(hostOffers({ story: {}, images: {}, features: { ...SERVER_FEATURES } }, "takeBackMove"), true);
    assert.equal(hostOffers({ story: {}, images: {}, features: {} }, "takeBackMove"), false, "a host that sends no flag hides it");
  });
} finally {
  model.close();
}
finish();
