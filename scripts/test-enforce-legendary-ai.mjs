// A legendary option the AI plays (issue 685 audit, 4.G): its
// legendary_action takes `use` and the one creature the option acts on, and
// with that creature named the option is played whole on the AI's own turn
// (src/lib/dm/turn.ts, src/lib/dm/legendary-play.ts), as the GM's card plays
// it. Without them an AI-run kraken only ever took its first way to play, a
// tentacle swing, and could never Fling, which no other call makes.
//
// The creatures are the rulebook's own pages read as the engine reads a pack
// row (statblock.ts parseMonster), so the suite needs no content pack.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { readPage, rowOfBlock } from "./lib/srd-bestiary.mjs";

const { test, finish } = suite("test-enforce-legendary-ai");

const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
function srd(title) {
  const page = book.pages.find((entry) => entry.title === title && entry.kind === "monster");
  const parsed = parseMonster(rowOfBlock(title, readPage(page.md)));
  return parsed.stats ?? parsed;
}

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const model = await fakeModel();
model.pointAt(world);
const kara = world.addHero({ name: "Kara", maxHp: 150 });

// Kara on her turn, held by a kraken beside her.
async function krakenHolding() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19 }, enemyFace: 1 });
  const [foe] = world.enemies();
  const stats = srd("Kraken");
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(foe.id, 6, 5);
  kit.giveTurn(kara.id);
  world.patch(kara.id, { currentHp: 150, conditions: ["grappled"], conditionMeta: { grappled: { source: foe.id } } });
  return world.enemies()[0];
}

const offered = (request, name) => request.tools?.find((tool) => tool.function?.name === name)?.function;

await test("The AI's kraken Flings the creature it holds: use and the creature named, played whole on the AI's turn", async () => {
  const foe = await krakenHolding();
  model.script([
    reply({ calls: [call("legendary_action", { enemyId: foe.id, action: "Tentacle Attack or Fling", use: "Fling", targetCharacterId: kara.id })] }),
    reply({ text: "The kraken hurls Kara across the deck." }),
  ]);
  // A 7 on the d8 throws her west, into the board's edge 25 feet off: 2d6.
  world.dice(7, 6, 6);
  await model.turn(world, "I hack at the tentacle that holds me.", kara.id);
  world.clearDice();
  const legendary = offered(model.requests[0], "legendary_action");
  assert.ok(legendary, "legendary_action is offered while a legendary creature fights");
  assert.ok(legendary.parameters.properties.use, "the model may name which way to play it");
  assert.ok(legendary.parameters.properties.targetCharacterId, "and the one creature it acts on");
  const [result] = model.results(model.requests[1]);
  assert.ok(result, "the call was answered");
  assert.equal(result.result.error, undefined, JSON.stringify(result.result));
  assert.match(result.result.flung, /thrown 25 feet to \(0,5\)/);
  const sheet = world.sheet(kara.id);
  assert.ok(sheet.conditions.includes("prone"), "she lands prone");
  assert.ok(!sheet.conditions.includes("grappled"), "and is no longer held");
  assert.equal(sheet.currentHp, 150 - 12, "12 bludgeoning for the 20 feet she flew whole");
  assert.deepEqual([kit.token(kara.id).x, kit.token(kara.id).y], [0, 5]);
  assert.equal(world.encounter().legendary.pools[foe.id].actions, 2);
});

await test("A Fling at a creature it does not hold is refused before anything is spent", async () => {
  const foe = await krakenHolding();
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  model.script([
    reply({ calls: [call("legendary_action", { enemyId: foe.id, action: "Tentacle Attack or Fling", use: "Fling", targetCharacterId: kara.id })] }),
    reply({ text: "The kraken gropes for her and finds nothing." }),
  ]);
  await model.turn(world, "I stay clear of the tentacles.", kara.id);
  const [refused] = model.results(model.requests[1]);
  assert.match(refused.result.error, /not grappled by .*Nothing was spent/);
  assert.equal(world.encounter().legendary.pools[foe.id]?.actions ?? 3, 3);
});

await test("A vampire's Move named with a target only is spent on the AI's turn, and its next names move_token", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19 }, enemyFace: 1 });
  const [foe] = world.enemies();
  const stats = srd("Vampire");
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(foe.id, 6, 5);
  kit.giveTurn(kara.id);
  model.script([
    reply({ calls: [call("legendary_action", { enemyId: foe.id, action: "Move", targetCharacterId: kara.id })] }),
    reply({ text: "The vampire glides away." }),
  ]);
  await model.turn(world, "I raise my holy symbol.", kara.id);
  const [spent] = model.results(model.requests[1]);
  assert.equal(spent.result.error, undefined, JSON.stringify(spent.result));
  assert.match(spent.result.next, /move_token/);
});

model.close();
finish();
