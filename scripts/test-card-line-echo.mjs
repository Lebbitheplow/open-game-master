// A card from the Hand reaches the model as a line under the player's words
// ("[Card played for characterId=...: an attack with Scimitar at ...
// (enemyId=...). Resolve it with pc_attack.]", src/lib/dm/intent-logic.ts
// describeIntent). A local model sometimes writes that line back as its
// reply. Issue 900: Qwen3.6-35B answered an off-hand attack with the card
// line of the attack before it, the turn's tidy took the sentence naming the
// tool, and the table read the first half as the GM's narration.
//
// The line is never the story (src/lib/dm/tool-text.ts withoutCardLines): it
// is cut wherever leaked tool text is, and a reply of nothing else is asked
// again like any other empty reply. So is every other line of the server's a
// model reads and can copy (withoutServerLines), with the ids they carry
// (withoutIdArguments); none reaches the draft while the reply streams
// (story-prompt.ts createStreamingArtifactFilter), and a passage stored before
// the fix shows none in the chronicle scroll or the title screen's glance, nor
// is read back to the model as its own words.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-card-line-echo");
const { describeIntent, TYPED_REACTION } = await import("../src/lib/dm/intent-logic.ts");
const { stripToolText, withoutCardLines } = await import("../src/lib/dm/tool-text.ts");
const { salvageTextualToolCalls } = await import("../src/lib/dm/rolls.ts");
const { tableNarrationParts } = await import("../src/lib/dm/narration-tidy-logic.ts");

const HERO = "2efaf723-6f2c-48a1-95b8-413e71d42ef4";
const FOE = "2105fe46-6123-4244-8f11-f29f843fb4bf";
const swing = { card: "attack", weapon: "Scimitar", targetKind: "enemy", targetId: FOE, targetName: "The Butcher" };
const STORY = "The scimitar rings off the Butcher's cleaver and skids wide.";

// ---- the pure helper ---------------------------------------------------------

await test("A card line is cut whole, whichever way it ends, and the story beside it stays.", () => {
  const asked = describeIntent(swing, HERO);
  const resolved = describeIntent(swing, HERO, { resolved: true });
  assert.match(asked, /^\[Card played for characterId=.*Resolve it with pc_attack\.\]$/);
  assert.match(resolved, /The engine has resolved it/);
  for (const line of [asked, resolved, describeIntent(swing, null), describeIntent(TYPED_REACTION, HERO)]) {
    assert.equal(withoutCardLines(line), "", line);
    assert.equal(withoutCardLines(`${line}\n\n${STORY}`).trim(), STORY, line);
    assert.equal(withoutCardLines(`${STORY}\n\n${line}`).trim(), STORY, line);
    assert.equal(withoutCardLines(`${line} ${STORY}`), STORY, line);
    assert.equal(stripToolText(`${STORY}\n${line}`).trim(), STORY, line);
    assert.equal(salvageTextualToolCalls(`${line}\n${STORY}`).text, STORY, line);
    assert.deepEqual(salvageTextualToolCalls(line), { text: "", calls: [] }, line);
  }
});

await test("The half the table read in issue 900 goes: a line that never closes its bracket is cut to the end of its line.", () => {
  // What the turn's tidy left of the whole line: the sentence naming the
  // tool was dropped as tool talk, and the bracket with it.
  const asked = describeIntent(swing, HERO);
  const [half] = tableNarrationParts([asked], ["The Butcher"], "english");
  assert.equal(half, `[Card played for characterId=${HERO}: an attack with Scimitar at The Butcher (enemyId=${FOE}).`);
  assert.equal(withoutCardLines(half), "");
  assert.equal(withoutCardLines(`${half}\n\n${STORY}`).trim(), STORY);
  // A message stored before the fix is shown through stripToolText.
  assert.equal(stripToolText(half), "");
});

await test("Brackets of the story's own stay.", () => {
  for (const text of [
    "The ledger's last entry reads [paid in full].",
    "[A reaction, at last.] The crowd exhales.",
    "She lays the card down. [Card played face up, the Tower.]",
    "A note in the margin: [sic].",
  ]) {
    assert.equal(withoutCardLines(text), text);
    assert.equal(stripToolText(text), text);
  }
});

// ---- the draft, the chronicle, the other lines of the server's ----------------

const { createStreamingArtifactFilter } = await import("../src/lib/story-prompt.ts");
const { recapParagraphs, clipRecap } = await import("../src/lib/recap.ts");
const { intentCorrection } = await import("../src/lib/dm/intent-logic.ts");
const { unpaidCastPrompt } = await import("../src/lib/dm/slotless-cast-logic.ts");
const { REPEATED_NARRATION_PROMPT, closingVarietyNote } = await import("../src/lib/dm/narration-tidy-logic.ts");
const { RENARRATE_DIRECTIVE } = await import("../src/lib/dm/renarrate-logic.ts");
const { buildPinnedMemoriesBlock } = await import("../src/lib/dm/pin-logic.ts");

// The draft as the table holds it: every piece the filter lets through, as
// the reply arrives `size` characters at a time.
function streamed(text, size) {
  const filter = createStreamingArtifactFilter();
  let out = "";
  for (let at = 0; at < text.length; at += size) {
    out += filter.push(text.slice(at, at + size));
  }
  return out + filter.flush();
}

await test("A card line never reaches the draft as the reply streams, however its pieces arrive, and the story beside it does.", () => {
  const asked = describeIntent(swing, HERO);
  const [half] = tableNarrationParts([asked], ["The Butcher"], "english");
  for (const text of [`${asked}\n\n${STORY}`, `${STORY}\n${asked}`, `${half}\n\n${STORY}`, `${asked} ${STORY}`, describeIntent(TYPED_REACTION, HERO)]) {
    for (const size of [1, 3, 7, 40, text.length]) {
      const draft = streamed(text, size);
      assert.doesNotMatch(draft, /Card played|A reaction for|characterId=|enemyId=/, `${size}: ${draft}`);
      if (text.includes(STORY)) {
        assert.match(draft, /Butcher's cleaver and skids wide\./, `${size}: ${draft}`);
      }
    }
  }
  // A story bracket still streams, in any pieces.
  for (const size of [1, 5]) {
    assert.equal(streamed("The ledger reads [paid in full]. [A reaction, at last.]", size), "The ledger reads [paid in full]. [A reaction, at last.]");
  }
});

await test("The chronicle scroll and the title screen's glance never show a card line a message stored before the fix still carries.", () => {
  const [half] = tableNarrationParts([describeIntent(swing, HERO)], ["The Butcher"], "english");
  assert.deepEqual(recapParagraphs(`${half}\n\n${STORY}`), [STORY]);
  assert.deepEqual(recapParagraphs(half), []);
  assert.equal(clipRecap(`${half}\n\n${STORY}`), STORY);
});

// The other lines the server writes into the model's conversation, as it
// writes them, each a line a model can copy back as its reply.
const SERVER_LINES = [
  "[Table note] The party is assembled and the adventure begins. Introduce the opening scene, set the premise, and give the party their first decision.",
  "[Kara | attempt] I swing at the goblin.",
  "[Authoritative direction from the party lead; weave it into the story now] A storm rolls in.",
  "[An offer was settled by the player's own answer; authoritative, and never to be offered or asked again] Kara took the ring.",
  "[GAME STATE UPDATE] Combatants may have moved while you waited on rolls.",
  REPEATED_NARRATION_PROMPT,
  RENARRATE_DIRECTIVE,
  closingVarietyNote("What do you do?"),
  buildPinnedMemoriesBlock([{ text: "The ferryman owes Kara a favour." }]).split("\n")[0],
  "[System] Tools are closed for this turn: nothing you call now will run. Narrate the moment to the table in prose, from what has already resolved, and do not describe the outcome of anything that did not.",
  intentCorrection(swing, HERO, "Kara"),
  unpaidCastPrompt({ caster: "Kara", casterId: HERO, spell: "Fire Bolt", quote: "flame leaps" }, "cast_at_enemy"),
  "[engine] pc_attack answered: the blow lands for 7.",
];

await test("Every other line of the server's a model copies back is cut as the card line is, with the ids it holds.", () => {
  for (const line of SERVER_LINES) {
    for (const text of [line, `${line}\n\n${STORY}`, `${STORY}\n${line}`]) {
      const shown = stripToolText(text).trim();
      assert.equal(shown, text === line ? "" : STORY, `stripToolText: ${text}`);
      assert.equal(salvageTextualToolCalls(text).text.trim(), text === line ? "" : STORY, `salvage: ${text}`);
      const draft = streamed(text, 4);
      assert.doesNotMatch(draft, /characterId=|enemyId=|\[System\]|\[Table note\]|\| attempt\]/, `draft: ${draft}`);
    }
  }
});

await test("A card line copied in other words keeps no id: the ids go wherever they sit.", () => {
  const ids = `characterId=${HERO}`;
  for (const text of [
    `[Carta giocata per ${ids}: un attacco con la Scimitarra contro il Macellaio (enemyId=${FOE}).]`,
    `Card played for ${ids}: an attack with Scimitar at The Butcher (enemyId=${FOE}).`,
    `Kara strikes at the Butcher (enemyId=${FOE}, 2) and misses.`,
  ]) {
    assert.doesNotMatch(stripToolText(text), /characterId=|enemyId=|2105fe46|2efaf723/, text);
    assert.doesNotMatch(salvageTextualToolCalls(text).text, /characterId=|enemyId=|2105fe46|2efaf723/, text);
    assert.doesNotMatch(streamed(text, 3), /characterId=|enemyId=|2105fe46|2efaf723/, text);
  }
  // An agent program's label above its narration goes, and the narration stays.
  assert.equal(stripToolText(`[Game Master] ${STORY}`), STORY);
  assert.equal(salvageTextualToolCalls(`[Game Master] ${STORY}`).text, STORY);
  assert.equal(streamed(`[Game Master] ${STORY}`, 3), STORY);
  // A call written as a bracket still runs with its ids: they are cut only after it is read.
  const salvaged = salvageTextualToolCalls(`[request_roll characterId=${HERO} kind=skill_check skill=athletics dc=12]`);
  assert.equal(JSON.parse(salvaged.calls[0]?.rawArguments ?? "{}").characterId, HERO);
});

await test("The story's own brackets and tags stay, at every table.", () => {
  for (const text of [
    "[System] You have gained a level. The tower's voice fades.",
    "[Softly] \"Come closer,\" the witch says.",
    "La cronaca recita [pagato per intero]. Il corvo gracchia.",
    "Der Händler zuckt mit den Schultern [wie immer] und lacht.",
    "(The innkeeper, Bram, eyes the coin) \"Two silver.\"",
  ]) {
    assert.equal(stripToolText(text), text);
    assert.equal(salvageTextualToolCalls(text).text, text);
    assert.equal(streamed(text, 2), text);
  }
});

// ---- the turn ----------------------------------------------------------------

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });

async function stage() {
  await kit.endFight();
  await kit.fight(1);
  world.patch(kara.id, { currentHp: kara.maxHp, conditions: [], conditionMeta: {} });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(kara.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(kara.id);
  return enemy;
}

const attackCard = (enemy) => ({ card: "attack", targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName });
const KARA_STORY = "Kara's longsword bites into the goblin's shield arm.";

await test("A reply that is only the card line, copied back, is asked again, and the table reads the narration that follows.", async () => {
  const enemy = await stage();
  const intent = attackCard(enemy);
  model.script([reply({ text: describeIntent(intent, kara.id, { resolved: true }) }), reply({ text: KARA_STORY })]);
  const dm = await model.turn(world, "Kara attacks the goblin with her longsword.", kara.id, kara.userId, { intent });
  assert.equal(model.requests.length, 2, "the copied line was asked again");
  assert.ok(dm, "the narration followed");
  assert.equal(dm.content.includes("Card played"), false, dm.content);
  assert.equal(dm.content.includes("characterId="), false, dm.content);
  assert.match(dm.content, /shield arm/);
});

await test("A card line copied above the narration is cut, and the narration stands.", async () => {
  const enemy = await stage();
  const intent = attackCard(enemy);
  model.script([reply({ text: `${describeIntent(intent, kara.id, { resolved: true })}\n\n${KARA_STORY}` })]);
  const dm = await model.turn(world, "Kara attacks the goblin with her longsword.", kara.id, kara.userId, { intent });
  assert.equal(model.requests.length, 1, "one model call: the narration");
  assert.ok(dm, "the narration followed");
  assert.equal(dm.content.includes("Card played"), false, dm.content);
  assert.match(dm.content, /shield arm/);
});

await test("A model that copies the line every time never puts it in front of the table.", async () => {
  const enemy = await stage();
  const intent = attackCard(enemy);
  const line = describeIntent(intent, kara.id, { resolved: true });
  model.script([reply({ text: line }), reply({ text: line }), reply({ text: line }), reply({ text: line })]);
  const dm = await model.turn(world, "Kara attacks the goblin with her longsword.", kara.id, kara.userId, { intent });
  assert.equal(dm?.content.includes("Card played") ?? false, false, dm?.content);
  assert.equal(dm?.content.includes("characterId=") ?? false, false, dm?.content);
});

const { subscribe } = await import("../src/lib/events.ts");
const campaignsDb = await import("../src/lib/db/campaigns.ts");
const messagesDb = await import("../src/lib/db/messages.ts");

await test("A card line the reply streams never reaches the table's draft, and the passage it keeps is the story.", async () => {
  const enemy = await stage();
  const intent = attackCard(enemy);
  const sent = [];
  const stop = subscribe(world.campaignId, (chunk) => {
    if (/^event: dm_delta$/m.test(chunk)) {
      sent.push(JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}").text);
    }
  });
  model.script([reply({ text: `${describeIntent(intent, kara.id, { resolved: true })}\n\n${KARA_STORY}` })]);
  let dm;
  try {
    dm = await model.turn(world, "Kara attacks the goblin with her longsword.", kara.id, kara.userId, { intent });
  } finally {
    stop();
  }
  const draft = sent.join("");
  assert.doesNotMatch(draft, /Card played|characterId=|enemyId=/, draft);
  assert.match(draft, /shield arm/);
  assert.match(dm?.content ?? "", /shield arm/);
});

await test("A card line an older reply kept is not read back to the model as its own words.", async () => {
  const enemy = await stage();
  const [half] = tableNarrationParts([describeIntent(attackCard(enemy), kara.id)], [enemy.displayName], "english");
  messagesDb.insertCampaignMessage({ campaignId: world.campaignId, seq: campaignsDb.allocateSeq(world.campaignId), authorType: "dm", content: `${half}\n\n${KARA_STORY}` });
  model.script([reply({ text: KARA_STORY })]);
  await model.turn(world, "Kara looks the goblin over.", kara.id, kara.userId);
  const said = model.requests[0].messages.filter((message) => message.role === "assistant").map((message) => String(message.content ?? "")).join("\n");
  assert.match(said, /shield arm/);
  assert.doesNotMatch(said, /Card played|characterId=|enemyId=/, said);
});

model.close();
await finish();
