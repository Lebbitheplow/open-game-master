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
// again like any other empty reply.
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

model.close();
await finish();
