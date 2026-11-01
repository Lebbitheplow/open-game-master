// A player's line is never left waiting on a GM that is not coming (issue
// 636). At a table that waits for everyone (gameSettings.waitForTable, on by
// default) a post made while the GM is busy is held for the narration under
// way, which settles the table as it lands (src/lib/dm/table-wait.ts). Work
// that is not a turn never did: a line said while a chapter closed, while the
// lead closed one, or while the GM answered a question out of character got
// no turn at all, though nothing was running after. Now the queue running dry
// reads the table again (src/lib/dm/loop.ts onDmQueueDrained), the floor's
// release answers what a hold kept back, handing the seat to the AI looks
// past the table notes below a waiting line, and a rewind answers a move
// whose answer it took away.
//
// Every turn here runs the real loop against a scripted fake model; a held
// reply keeps the GM busy while the test posts what the player sent.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, held, reply, settleQueue } from "./lib/enforce-narrator.mjs";

// A chapter closes once it holds six lines (chapter-close.ts reads this as
// it loads, after this line): four set down beforehand, a move and its
// narration.
process.env.DM_CHAPTER_MAX = "6";

const { test, finish } = suite("test-waiting-lines");

const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { setDmMode, getFloor } = await import("../src/lib/db/campaigns.ts");
const { getDmStatus } = await import("../src/lib/dm/status.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { lineAwaitsGm } = await import("../src/lib/dm/ooc-question.ts");
const { performRollback } = await import("../src/lib/dm/rollback.ts");

async function until(what, check, ms = 30_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function call(world, user, name, method, body = {}) {
  const route = await world.route(name);
  world.signIn(user);
  const response = await route[method](
    new Request("http://test/", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

// One line through the actions route, as the composer sends it.
const act = (world, user, content, kind = "do") => call(world, user, "campaigns/[campaignId]/actions", "POST", { content, kind });

const lines = (world) => listRecentMessages(world.campaignId, 60);
const lineOf = (world, text) => lines(world).find((message) => message.content.includes(text));
// The GM's narration after a line, or undefined when nothing answered it.
const answerAfter = (world, text) => {
  const line = lineOf(world, text);
  return lines(world).find((message) => message.authorType === "dm" && message.seq > line.seq);
};

const SUMMARY = reply({ text: JSON.stringify({ title: "The Abbey Road", summary: "Kara walked to the abbey.", highlights: ["The gate stood open."], facts: [] }) });
const NO_PLAN = reply({ text: "{}" });
const ANSWER = "Brother Lucan sets the scroll down and meets your eyes.";

// An AI-run table one move short of closing its chapter.
async function table({ second = false, gameSettings = {} } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false, ...gameSettings } });
  const kara = world.addHero({ name: "Kara" });
  const bram = second ? world.addHero({ name: "Bram" }) : null;
  const model = await fakeModel();
  model.pointAt(world);
  world.say("dm", "The road bends toward the abbey.");
  world.say("player", "I walk on.", kara);
  world.say("dm", "Bells ring somewhere ahead.");
  world.say("player", "I listen.", kara);
  return { world, kara, bram, karaUser: world.owner, bramUser: bram ? { id: bram.userId } : null, model };
}

// The move that closes the chapter, with the close's summary held: returns
// once the GM is writing the chapter, and the release that lets it finish.
async function closingChapter({ world, model, karaUser, bramUser }, after = [reply({ text: ANSWER })]) {
  const summary = held(SUMMARY);
  model.script([reply({ text: "The abbey gate stands open. What do you do?" }), summary.entry, NO_PLAN, ...after]);
  assert.equal((await act(world, karaUser, "I step through the gate.")).status, 202);
  if (bramUser) {
    assert.equal((await act(world, bramUser, "I follow Kara in.")).status, 202);
  }
  await until("the chapter to start closing", () => model.requests.length === 2 && getDmStatus(world.campaignId) === "writing_chapter");
  return summary.release;
}

const LINE = "Brother Lucan, tell me what you found.";

await test("A line said while the chapter closes is answered once it has closed, below the chapter's close (issue 636).", async () => {
  const setup = await table();
  const { world, model, karaUser } = setup;
  const release = await closingChapter(setup);
  assert.equal((await act(world, karaUser, LINE, "say")).status, 202);
  release();
  await settleQueue(world.campaignId);
  const answer = answerAfter(world, LINE);
  assert.ok(answer, "the line got no GM turn after the chapter closed");
  assert.equal(answer.content, ANSWER);
  const divider = lines(world).find((message) => message.authorType === "system" && /comes to a close/.test(message.content));
  assert.ok(lineOf(world, LINE).seq < divider.seq && divider.seq < answer.seq, "the close lands between the line and its answer");
  assert.match(JSON.stringify(model.requests.at(-1).messages), /tell me what you found/, "the turn read the line");
  model.close();
});

await test("The lead's own chapter close holds a line said meanwhile only until it is done.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kara = world.addHero({ name: "Kara" });
  const model = await fakeModel();
  model.pointAt(world);
  for (const [author, text] of [["dm", "The road bends."], ["player", "I walk on."], ["dm", "Bells ring."], ["player", "I listen."], ["dm", "The abbey gate stands open."]]) {
    world.say(author, text, author === "player" ? kara : undefined);
  }
  const summary = held(SUMMARY);
  model.script([summary.entry, NO_PLAN, reply({ text: ANSWER })]);
  assert.equal((await call(world, world.owner, "campaigns/[campaignId]/chapters", "POST")).status, 202);
  await until("the lead's close to start", () => model.requests.length === 1 && getDmStatus(world.campaignId) === "writing_chapter");
  assert.equal((await act(world, world.owner, LINE, "say")).status, 202);
  summary.release();
  await settleQueue(world.campaignId);
  assert.equal(answerAfter(world, LINE)?.content, ANSWER, "the line said during the lead's close was never answered");
  model.close();
});

await test("A move made while the GM answers a question out of character is answered after it.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero({ name: "Kara" });
  const model = await fakeModel();
  model.pointAt(world);
  world.say("dm", "A gap yawns between the rooftops.");
  const aside = held(reply({ text: "Yes: it is a long jump, so expect an Athletics check." }));
  model.script([aside.entry, reply({ text: "You land hard on the far roof, tiles skittering." })]);
  assert.equal((await act(world, world.owner, "@GM can I jump that gap?", "ooc")).status, 202);
  await until("the out-of-character answer to start", () => model.requests.length === 1);
  assert.equal((await act(world, world.owner, "I take a run at the gap and jump.")).status, 202);
  aside.release();
  await settleQueue(world.campaignId);
  assert.equal(answerAfter(world, "I take a run at the gap")?.content, "You land hard on the far roof, tiles skittering.");
  model.close();
});

await test("At a table of two, a line said while the chapter closes starts the wait for the other player.", async () => {
  const setup = await table({ second: true });
  const { world, model, karaUser, bramUser } = setup;
  const leave = [subscribe(world.campaignId, () => {}, karaUser.id), subscribe(world.campaignId, () => {}, bramUser.id)];
  const release = await closingChapter(setup);
  assert.equal((await act(world, karaUser, LINE, "say")).status, 202);
  // Nobody is being answered while the chapter closes, so a pass is refused
  // for that reason, not for a narration under way.
  const pass = await call(world, bramUser, "campaigns/[campaignId]/pass", "POST");
  assert.equal(pass.status, 409);
  assert.match(pass.json.error, /closing the chapter/);
  release();
  await settleQueue(world.campaignId);
  assert.equal(model.served(), 3, "one answer of two woke the GM");
  const wait = globalThis.__odmTableWait.get(world.campaignId);
  assert.ok(wait.timer, "no clock was armed for the line, so nothing would ever answer it if Bram said nothing");
  assert.deepEqual(JSON.parse(wait.published).waitingOn.map((seat) => seat.name), ["Bram"], "every seat is told who the GM waits on");
  assert.equal((await act(world, bramUser, "I keep an eye on the door.")).status, 202);
  await settleQueue(world.campaignId);
  assert.equal(answerAfter(world, LINE)?.content, ANSWER);
  assert.match(JSON.stringify(model.requests.at(-1).messages), /tell me what you found[^]*keep an eye on the door/);
  leave.forEach((off) => off());
  model.close();
});

await test("A wait whose time ran out while the chapter closed is answered as the close ends.", async () => {
  const setup = await table({ second: true });
  const { world, model, karaUser, bramUser } = setup;
  const leave = [subscribe(world.campaignId, () => {}, karaUser.id), subscribe(world.campaignId, () => {}, bramUser.id)];
  const release = await closingChapter(setup);
  assert.equal((await act(world, karaUser, LINE, "say")).status, 202);
  // The close ran long: the narration and the line are older than the wait
  // (and the heroes older still, so the line is Kara's to count).
  const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  getDatabase().prepare(`UPDATE character_sheets SET created_at = ? WHERE campaign_id = ?`).run(ago(30), world.campaignId);
  getDatabase().prepare(`UPDATE campaign_messages SET created_at = ? WHERE campaign_id = ?`).run(ago(20), world.campaignId);
  release();
  await settleQueue(world.campaignId);
  assert.equal(answerAfter(world, LINE)?.content, ANSWER, "Bram never answered, and the time ran out during the close");
  leave.forEach((off) => off());
  model.close();
});

await test("A move posted while the narration was written, at a table that holds after each narration, is answered when the lead releases the hold.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false, holdSubmissions: true } });
  world.addHero({ name: "Kara" });
  const model = await fakeModel();
  model.pointAt(world);
  world.say("dm", "The ferryman holds out his hand.");
  const narration = held(reply({ text: "He weighs the coin and nods you aboard." }));
  model.script([narration.entry, reply({ text: "The ferryman shrugs. \"The far bank, as paid.\"" })]);
  assert.equal((await act(world, world.owner, "I pay the ferryman.")).status, 202);
  await until("the turn to reach the model", () => model.requests.length === 1);
  assert.equal((await act(world, world.owner, "I ask where he is taking us.")).status, 202);
  narration.release();
  await settleQueue(world.campaignId);
  assert.equal(getFloor(world.campaignId).mode, "hold", "the narration holds the table");
  assert.equal(model.served(), 1, "the hold keeps the move back until the lead releases it");
  assert.equal((await call(world, world.owner, "campaigns/[campaignId]/floor", "POST")).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(answerAfter(world, "I ask where he is taking us")?.content, "The ferryman shrugs. \"The far bank, as paid.\"");
  model.close();
});

await test("Table talk said while the chapter closes wakes no one.", async () => {
  const setup = await table();
  const { world, model, karaUser } = setup;
  const release = await closingChapter(setup);
  assert.equal((await act(world, karaUser, "brb, getting tea", "ooc")).status, 202);
  release();
  await settleQueue(world.campaignId);
  assert.equal(model.served(), 3, "table talk woke a turn");
  assert.equal(answerAfter(world, "brb, getting tea"), undefined);
  model.close();
});

await test("A break taken while the chapter closes holds the line until Resume, which answers it.", async () => {
  const setup = await table();
  const { world, model, karaUser } = setup;
  const release = await closingChapter(setup);
  assert.equal((await act(world, karaUser, LINE, "say")).status, 202);
  assert.equal((await call(world, karaUser, "campaigns/[campaignId]/table-break", "POST")).status, 200);
  release();
  await settleQueue(world.campaignId);
  assert.equal(model.served(), 3, "the line was answered during the break");
  assert.equal((await call(world, karaUser, "campaigns/[campaignId]/table-break", "DELETE")).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(answerAfter(world, LINE)?.content, ANSWER);
  model.close();
});

await test("At a table a person runs, a line said while the chapter closes stays theirs: no AI turn wakes.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero({ name: "Garrick" });
  const mira = world.addHero({ name: "Mira" });
  setDmMode(world.campaignId, "human", world.owner.id);
  const model = await fakeModel();
  model.pointAt(world);
  for (const [author, text] of [["dm", "The road bends."], ["player", "I walk on."], ["dm", "Bells ring."], ["player", "I listen."], ["dm", "The abbey gate stands open."]]) {
    world.say(author, text, author === "player" ? mira : undefined);
  }
  const summary = held(SUMMARY);
  model.script([summary.entry]);
  assert.equal((await call(world, world.owner, "campaigns/[campaignId]/chapters", "POST")).status, 202);
  await until("the close to start", () => model.requests.length === 1);
  assert.equal((await act(world, { id: mira.userId }, LINE, "say")).status, 202);
  summary.release();
  await settleQueue(world.campaignId);
  assert.equal(model.served(), 1, "an AI turn woke at a table a person runs");
  assert.equal(answerAfter(world, LINE), undefined);
  model.close();
});

await test("Handing the seat to the AI answers a line a chapter's close landed below.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero({ name: "Garrick" });
  const mira = world.addHero({ name: "Mira" });
  setDmMode(world.campaignId, "human", world.owner.id);
  const model = await fakeModel();
  model.pointAt(world);
  world.say("dm", "The abbey gate stands open.");
  world.say("player", LINE, mira);
  world.say("system", "Chapter 1, \"The Abbey Road\", comes to a close.");
  model.script([reply({ text: ANSWER })]);
  assert.equal((await call(world, world.owner, "campaigns/[campaignId]/settings", "PATCH", { dmMode: "ai" })).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(answerAfter(world, LINE)?.content, ANSWER, "the AI took the seat and left the line waiting");
  model.close();
});

for (const waitForTable of [true, false]) {
  await test(`A move answered only in the chapter a rewind took away is answered again (wait for the table ${waitForTable ? "on" : "off"}).`, async () => {
    const { world, model, karaUser } = await table({ gameSettings: { waitForTable } });
    // The move lands while the narration that closes chapter 1 is written,
    // so it is chapter 1's; its answer comes in chapter 2.
    const narration = held(reply({ text: "The abbey gate stands open. What do you do?" }));
    model.script([narration.entry, SUMMARY, NO_PLAN, reply({ text: ANSWER }), reply({ text: "Lucan rolls the scroll shut. \"Again, then.\"" })]);
    assert.equal((await act(world, karaUser, "I step through the gate.")).status, 202);
    await until("the closing turn to reach the model", () => model.requests.length === 1);
    assert.equal((await act(world, karaUser, LINE, "say")).status, 202);
    narration.release();
    await settleQueue(world.campaignId);
    assert.equal(answerAfter(world, LINE)?.content, ANSWER);
    const chapter1 = getDatabase().prepare(`SELECT seq_end AS seqEnd FROM chapters WHERE campaign_id = ? AND chapter_index = 1`).get(world.campaignId);
    assert.ok(lineOf(world, LINE).seq <= chapter1.seqEnd, "the move is part of chapter 1");
    const rewound = await performRollback(world.campaignId, 2);
    assert.equal(rewound.ok, true);
    assert.equal(answerAfter(world, LINE)?.content, undefined, "the rewind took the answer away");
    await settleQueue(world.campaignId);
    assert.equal(answerAfter(world, LINE)?.content, "Lucan rolls the scroll shut. \"Again, then.\"", "the move was left waiting after the rewind");
    model.close();
  });
}

await test("What waits on the GM: a move or a question to the GM, with table notes below it passed over.", () => {
  const dm = { authorType: "dm", content: "The gate opens." };
  const move = { authorType: "player", content: "I step in." };
  const note = { authorType: "system", content: "Chapter 1 comes to a close." };
  assert.equal(lineAwaitsGm([dm, move]), true);
  assert.equal(lineAwaitsGm([dm, move, note, note]), true, "a close below the move answers nothing");
  assert.equal(lineAwaitsGm([move, dm, note]), false, "the GM answered it");
  assert.equal(lineAwaitsGm([dm, { authorType: "player", content: "(ooc) brb" }]), false, "table talk waits on nobody");
  assert.equal(lineAwaitsGm([dm, { authorType: "player", content: "(ooc) @GM can I jump it?" }, note]), true);
  assert.equal(lineAwaitsGm([note]), false);
});

finish();
