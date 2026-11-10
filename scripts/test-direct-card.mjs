// A complete card from the Hand is resolved by the engine before the
// narrator is asked (src/lib/dm/turn.ts directCards, intent-logic.ts
// directCardCall): the turn's first step runs the cards' own tool calls, and
// the model's first (and usually only) call narrates from the results. A
// card the model still has to judge (no fixed target, an area laid on the
// board, a rider, an attack out of a fight) goes to the model first, as
// before. Issue 570 widened the direct path from weapon attacks and Dodge,
// Dash and Disengage to spells at one target, features, the other basic
// actions, reactions and gear, to every card since the DM last spoke, and to
// cards played between fights.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-direct-card");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Potion of Healing", qty: 1 }] });
const iris = world.addHero({
  name: "Iris",
  class: "wizard",
  level: 3,
  maxHp: 20,
  abilities: { int: 16 },
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Magic Missile", "Shield", "Mage Armor"], cantrips: ["Fire Bolt"], spellbook: ["Magic Missile", "Shield", "Mage Armor"] },
});
const sefa = world.addHero({
  name: "Sefa",
  class: "cleric",
  level: 3,
  maxHp: 24,
  abilities: { wis: 16 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Cure Wounds", "Bless"], cantrips: ["Sacred Flame"] },
});

// A fifth-level evoker for the blasts (issue 570: the engine catches who
// stands in an area laid on the board).
const vex = world.addHero({
  name: "Vex",
  class: "wizard",
  level: 5,
  maxHp: 30,
  abilities: { int: 17, dex: 14 },
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    known: [],
    prepared: ["Fireball", "Burning Hands", "Thunderwave", "Lightning Bolt", "Scorching Ray", "Magic Missile", "Grease"],
    cantrips: ["Fire Bolt"],
    spellbook: ["Fireball", "Burning Hands", "Thunderwave", "Lightning Bolt", "Scorching Ray", "Magic Missile", "Grease"],
  },
});

async function stage(whose = kara) {
  await kit.endFight();
  await kit.fight(1);
  for (const hero of [kara, iris, sefa]) {
    world.patch(hero.id, { currentHp: hero.maxHp, conditions: [], conditionMeta: {} });
  }
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(kara.id, 5, 5);
  kit.place(iris.id, 4, 5);
  kit.place(sefa.id, 4, 6);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(whose.id);
  return enemy;
}

const toolCalls = (request) =>
  request.messages.flatMap((message) => (message.role === "assistant" && Array.isArray(message.tool_calls) ? message.tool_calls : []));
const results = (request) => request.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
const firstCall = (request, index = 0) => {
  const calls = toolCalls(request);
  return calls[index] ? { name: calls[index].function.name, args: JSON.parse(calls[index].function.arguments), id: calls[index].id } : null;
};

await test("An attack card at a named enemy is rolled by the engine before the model is asked; the one model call narrates from the result.", async () => {
  const enemy = await stage();
  model.script([reply({ text: "Kara's blade finds the dummy's shoulder." })]);
  const dm = await model.turn(world, "Kara attacks the dummy with her longsword.", kara.id, kara.userId, {
    intent: { card: "attack", targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  assert.equal(model.requests.length, 1, "one model call: the narration");
  const [request] = model.requests;
  const calls = toolCalls(request);
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.equal(calls[0].function.name, "pc_attack");
  assert.match(calls[0].id, /^card_/);
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.characterId, kara.id);
  assert.equal(args.targetEnemyId, enemy.id);
  const [result] = results(request);
  assert.ok(result && !result.error, `the attack resolved: ${JSON.stringify(result)}`);
  assert.ok(kit.lastRolls().some((roll) => /attack|damage/.test(roll.kind) && /goblin/i.test(roll.detail ?? "")), `the attack was rolled: ${JSON.stringify(kit.lastRolls()).slice(0, 300)}`);
  assert.ok(dm, "the narration followed");
  assert.match(dm.content, /shoulder/);
});

await test("A Dodge card is taken by the engine first, and the model narrates it.", async () => {
  await stage();
  model.script([reply({ text: "Kara raises her shield and watches the dummy." })]);
  await model.turn(world, "Kara dodges.", kara.id, kara.userId, { intent: { card: "basic", action: "dodge" } });
  assert.equal(model.requests.length, 1);
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "take_action");
  assert.equal(first.args.action, "dodge");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

await test("An attack card with no fixed target goes to the model first, as before.", async () => {
  await stage();
  model.script([reply({ text: "Kara looks for an opening." })]);
  await model.turn(world, "Kara attacks.", kara.id, kara.userId, { intent: { card: "attack" } });
  assert.ok(model.requests.length >= 1);
  assert.equal(toolCalls(model.requests[0]).length, 0, "the first call carries no tool call of the engine's making");
  const transcript = model.requests[0].messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  assert.match(transcript, /Resolve it with pc_attack/, "a card the engine leaves asks the model for the call");
});

// ---- issue 570: the direct path widened ----

await test("A spell card at one enemy is cast by the engine with the spell's tool: an attack-roll spell through pc_attack, before any model call.", async () => {
  const enemy = await stage(iris);
  model.script([reply({ text: "A bolt of flame streaks across the gap." })]);
  await model.turn(world, "I cast Fire Bolt at Goblin 1.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  assert.equal(model.requests.length, 1, "one model call: the narration");
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "pc_attack", JSON.stringify(first));
  assert.equal(first.args.spell, "Fire Bolt");
  assert.equal(first.args.characterId, iris.id);
  assert.equal(first.args.targetEnemyId, enemy.id);
  assert.match(first.id, /^card_/);
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, `the bolt resolved: ${JSON.stringify(result)}`);
  // The card's line in the transcript says the engine took it, so the model
  // does not cast it again (a scripted model that did cast twice).
  const transcript = model.requests[0].messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  assert.match(transcript, /The engine has resolved it/);
  assert.doesNotMatch(transcript, /Fire Bolt[^\n]*Resolve it with/);
});

await test("A healing spell on an ally is rolled by the engine through heal, with the caster as casterId and the ally healed.", async () => {
  await stage(sefa);
  world.patch(kara.id, { currentHp: 10 });
  model.script([reply({ text: "Warmth closes the cut." })]);
  await model.turn(world, "I cast Cure Wounds on Kara.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Cure Wounds", slotLevel: 1, targetKind: "ally", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "heal", JSON.stringify(first));
  assert.equal(first.args.characterId, kara.id);
  assert.equal(first.args.casterId, sefa.id);
  assert.equal(first.args.level, 1);
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
  assert.ok(world.sheet(kara.id).currentHp > 10, "Kara was healed");
  assert.equal(world.sheet(sefa.id).spellcasting.slots[1].used, 1, "the slot was spent");
});

await test("A buff on an ally goes through cast_buff with the ally as its target.", async () => {
  await stage(sefa);
  model.script([reply({ text: "A blessing settles on Kara." })]);
  await model.turn(world, "I cast Bless on Kara.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Bless", slotLevel: 1, targetKind: "ally", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "cast_buff", JSON.stringify(first));
  assert.deepEqual(first.args.targetCharacterIds, [kara.id]);
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

await test("A reaction card to a hit is resolved by the engine through use_reaction, off the caster's turn.", async () => {
  const enemy = await stage(kara);
  await world.hitBy(iris.id, { enemyId: enemy.id, name: enemy.displayName, total: 19, vsAc: 12, raw: 5, attack: "Scimitar" });
  model.script([reply({ text: "A shimmering barrier flares." })]);
  await model.turn(world, "I cast Shield as a reaction.", iris.id, iris.userId, {
    intent: { card: "reaction", feature: "Shield", spell: "Shield", slotLevel: 1 },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "use_reaction", JSON.stringify(first));
  assert.equal(first.args.feature, "Shield");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

await test("A gear card is handled by the engine: a potion drunk through use_item.", async () => {
  await stage(kara);
  world.patch(kara.id, { currentHp: 12 });
  model.script([reply({ text: "Kara drains the vial." })]);
  await model.turn(world, "I drink my Potion of Healing.", kara.id, kara.userId, {
    intent: { card: "gear", action: "use", item: "Potion of Healing", targetKind: "self", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "use_item", JSON.stringify(first));
  assert.equal(first.args.item, "Potion of Healing");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
  assert.ok(world.sheet(kara.id).currentHp > 12, "the potion healed");
});

await test("A Help card for an ally goes through take_action with the ally named.", async () => {
  await stage(kara);
  model.script([reply({ text: "Kara feints to draw the goblin's eye." })]);
  await model.turn(world, "I take the Help action for Iris.", kara.id, kara.userId, {
    intent: { card: "basic", action: "help", targetKind: "ally", targetId: iris.id, targetName: "Iris" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first.name, "take_action", JSON.stringify(first));
  assert.equal(first.args.action, "help");
  assert.equal(first.args.targetCharacterId, iris.id);
});

await test("Every card since the DM last spoke is resolved, in the order played: a cast posted before a typed line still goes to the engine.", async () => {
  const enemy = await stage(iris);
  // The player's card, then a typed afterthought with no card.
  const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
  const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
  insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType: "player",
    userId: iris.userId,
    characterId: iris.id,
    content: "I cast Fire Bolt at Goblin 1.",
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  model.script([reply({ text: "The bolt flies as she shouts." })]);
  await model.turn(world, "And I shout a warning to Kara!", iris.id, iris.userId);
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "pc_attack", JSON.stringify(toolCalls(model.requests[0])));
  assert.equal(first.args.spell, "Fire Bolt");
});

await test("An area spell is left to the model, aimed at one enemy or laid off the board, and so is a spell the content has no resolution for.", async () => {
  const enemy = await stage(iris);
  assert.equal(
    directCardCall({ card: "spell", spell: "Web", slotLevel: 2, targetKind: "enemy", targetId: enemy.id, atX: 5, atY: 6 }, iris.id, { inFight: true, resolution: "save", area: true, lasting: { pick: "off" } }),
    null,
    "with no board, who a web holds is the GM's word",
  );
  // A Fireball aimed at one goblin: cast_at_enemy would roll that goblin
  // alone, so the burst is the model's to lay over everyone in it.
  assert.equal(directCardCall({ card: "spell", spell: "Fireball", slotLevel: 3, targetKind: "enemy", targetId: enemy.id }, iris.id, { inFight: true, resolution: "save", area: true }), null);
  assert.equal(directCardCall({ card: "spell", spell: "Chill Touch", slotLevel: null, targetKind: "enemy", targetId: enemy.id }, iris.id, { inFight: true, resolution: null }), null);
  assert.equal(directCardCall({ card: "spell", spell: "Find Familiar", slotLevel: 1 }, iris.id, { inFight: false, resolution: "summon" }), null);
  assert.equal(directCardCall({ card: "rider", rider: "Sneak Attack" }, kara.id, { inFight: true }), null);
});

await test("Between fights a healing spell on an ally is cast by the engine, while a card aimed at an enemy waits for the model to start the fight.", async () => {
  await kit.endFight();
  world.patch(kara.id, { currentHp: 10 });
  model.script([reply({ text: "Sefa kneels and the wound knits." })]);
  await model.turn(world, "I cast Cure Wounds on Kara.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Cure Wounds", slotLevel: 1, targetKind: "ally", targetId: kara.id, targetName: "Kara" },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "heal", JSON.stringify(toolCalls(model.requests[0])));
  assert.ok(world.sheet(kara.id).currentHp > 10, "Kara was healed between fights");
  assert.equal(directCardCall({ card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: "nobody" }, iris.id, { inFight: false, resolution: "attack" }), null);
});

// Issue 570: matching the tool's name was enough, so a use_spell_slot passed
// for an attack-roll spell the engine never rolled. The correction now runs
// for a card the engine could not resolve itself (no fixed target).
const corrected = () => model.requests.some((request) => request.messages.some((message) => message.role === "user" && /nothing resolved it/.test(String(message.content))));

await test("A spell card with no fixed target answered only by spending a slot is sent back to the spell's tool once.", async () => {
  await stage(iris);
  model.script([
    reply({ calls: [call("use_spell_slot", { characterId: iris.id, spell: "Fire Bolt" })] }),
    reply({ text: "Iris mutters a word." }),
    reply({ text: "The bolt goes wide." }),
  ]);
  await model.turn(world, "I cast Fire Bolt at the nearest goblin.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null },
  });
  assert.ok(corrected(), "the corrective call was made");
  const correction = model.requests.flatMap((request) => request.messages).find((message) => /nothing resolved it/.test(String(message.content)));
  assert.match(String(correction.content), /use_spell_slot does not cast it/);
});

await test("A spell card the spell's own tool answered, for the card's caster, is not sent back.", async () => {
  const enemy = await stage(iris);
  model.script([
    reply({ calls: [call("pc_attack", { characterId: iris.id, targetEnemyId: enemy.id, spell: "Fire Bolt" })] }),
    reply({ text: "Iris mutters a word." }),
  ]);
  await model.turn(world, "I cast Fire Bolt at the nearest goblin.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null },
  });
  assert.equal(corrected(), false);
});

await test("Out of a fight an attack card is not resolved ahead of the model.", async () => {
  await kit.endFight();
  model.script([reply({ text: "Kara's hand goes to her hilt." })]);
  await model.turn(world, "Kara attacks the merchant.", kara.id, kara.userId, {
    intent: { card: "attack", targetKind: "enemy", targetId: "nobody", targetName: "the merchant" },
  });
  assert.equal(toolCalls(model.requests[0]).length, 0);
});

// ---- issue 570: the engine works out who stands in a blast ----

// Three goblins and the party on an open field: two goblins and Kara where a
// Fireball centred on (10,5) reaches, one goblin far off.
async function stageBlast() {
  await kit.endFight();
  await kit.fight(3);
  for (const hero of [kara, iris, sefa, vex]) {
    world.patch(hero.id, { currentHp: hero.maxHp, conditions: [], conditionMeta: {} });
  }
  world.patch(vex.id, { spellcasting: { ...world.sheet(vex.id).spellcasting, slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } } } });
  const [near, close, far] = world.enemies();
  for (const enemy of [near, close, far]) kit.setEnemy(enemy.id, { maxHp: 200, currentHp: 200 });
  kit.place(vex.id, 2, 5);
  kit.place(near.id, 10, 5);
  kit.place(close.id, 12, 7);
  kit.place(far.id, 22, 5);
  kit.place(kara.id, 9, 4);
  kit.place(iris.id, 2, 9);
  kit.place(sefa.id, 3, 9);
  kit.giveTurn(vex.id);
  return { near, close, far };
}

await test("A Fireball laid on a square is cast by the engine, which catches every creature standing in the burst, a friend included, and nobody outside it.", async () => {
  const { near, close, far } = await stageBlast();
  model.script([reply({ text: "Fire blooms across the clearing." })]);
  await model.turn(world, "I cast Fireball centred on (10,5) using a level 3 slot.", vex.id, vex.userId, {
    intent: { card: "spell", spell: "Fireball", slotLevel: 3, atX: 10, atY: 5 },
  });
  assert.equal(model.requests.length, 1, "one model call: the narration");
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "aoe_damage", JSON.stringify(toolCalls(model.requests[0])));
  assert.equal(first.args.casterCharacterId, vex.id);
  assert.equal(first.args.atX, 10);
  assert.equal(first.args.enemyIds, undefined, "the card names nobody: the engine reads the board");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
  const told = JSON.stringify(result);
  assert.ok(told.includes(near.displayName) && told.includes(close.displayName), `both goblins in the burst: ${told.slice(0, 400)}`);
  assert.ok(told.includes("Kara"), "Kara stands in it too, and burns");
  assert.ok(!told.includes(far.displayName), "the goblin across the field is untouched");
  assert.equal(world.enemies().find((enemy) => enemy.id === far.id).currentHp, 200);
  assert.equal(world.sheet(vex.id).spellcasting.slots[3].used, 1, "one slot for the whole burst");
});

await test("Burning Hands aimed toward a square fans out from beside its caster and catches the goblin in front of them.", async () => {
  const { near, far } = await stageBlast();
  kit.place(near.id, 3, 5);
  model.script([reply({ text: "Flame sheets from Vex's fingers." })]);
  await model.turn(world, "I cast Burning Hands toward (6,5) using a level 1 slot.", vex.id, vex.userId, {
    intent: { card: "spell", spell: "Burning Hands", slotLevel: 1, towardX: 6, towardY: 5 },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "aoe_damage", JSON.stringify(toolCalls(model.requests[0])));
  const [result] = results(model.requests[0]);
  const told = JSON.stringify(result);
  assert.ok(!result.error && told.includes(near.displayName), told.slice(0, 300));
  assert.deepEqual((result.results ?? []).map((entry) => entry.target), [near.displayName], "nobody behind the cone, and never its caster");
  assert.equal(world.enemies().find((enemy) => enemy.id === far.id).currentHp, 200);
});

await test("A blast laid where nobody stands is sent back to be aimed again, and no slot is spent.", async () => {
  await stageBlast();
  model.script([reply({ text: "Vex hesitates." }), reply({ text: "Vex hesitates." })]);
  await model.turn(world, "I cast Fireball centred on (16,0) using a level 3 slot.", vex.id, vex.userId, {
    intent: { card: "spell", spell: "Fireball", slotLevel: 3, atX: 16, atY: 0 },
  });
  const [result] = results(model.requests[0]);
  assert.match(result.error ?? "", /catches nobody/);
  assert.equal(result.retry, true);
  assert.equal(world.sheet(vex.id).spellcasting.slots[3].used, 0, "nothing was spent");
});

await test("The model may lay a blast itself and name nobody: aoe_damage catches everyone inside the placement.", async () => {
  const { near, close, far } = await stageBlast();
  model.script([
    reply({ calls: [call("aoe_damage", { casterCharacterId: vex.id, spell: "Fireball", level: 3, atX: 11, atY: 6 })] }),
    reply({ text: "The burst rolls over the goblins." }),
  ]);
  await model.turn(world, "I throw a fireball at the goblins!", vex.id, vex.userId);
  const done = model.requests.at(-1);
  const result = results(done).find((entry) => entry && (entry.error || /Fireball/.test(JSON.stringify(entry))));
  const told = JSON.stringify(result);
  assert.ok(result && !result.error, told);
  assert.ok(told.includes(near.displayName) && told.includes(close.displayName) && !told.includes(far.displayName), told.slice(0, 400));
});

// SRD 5.1, Grease: "When the grease appears, each creature standing in its
// area must succeed on a Dexterity saving throw or fall prone." The card went
// to the GM to name them, since a lasting area laid with nobody named caught
// nobody; on the board the engine reads who stands on its squares.
await test("A Grease card laid on a square is cast by the engine, which catches every creature standing on its squares, a friend included, and nobody outside them.", async () => {
  const { near, close, far } = await stageBlast();
  model.script([reply({ text: "The ground slicks over." })]);
  await model.turn(world, "I cast Grease on (10,5) using a level 1 slot.", vex.id, vex.userId, {
    intent: { card: "spell", spell: "Grease", slotLevel: 1, atX: 10, atY: 5 },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "aoe_damage", JSON.stringify(toolCalls(model.requests[0])));
  assert.equal(first.args.enemyIds, undefined, "the card names nobody: the engine reads the board");
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
  // Its 10-foot square from (10,5) covers (9,4) to (10,5).
  assert.deepEqual((result.results ?? []).map((entry) => entry.target).sort(), [near.displayName, "Kara"].sort(), JSON.stringify(result).slice(0, 400));
  assert.ok(![close.displayName, far.displayName].some((name) => JSON.stringify(result.results).includes(name)));
  assert.equal(world.sheet(vex.id).spellcasting.slots[1].used, 1, "one slot");
});

await test("Off the battle map, or aimed at one creature with no square, a blast stays with the model; a lasting area laid on a square does too.", () => {
  const card = { card: "spell", spell: "Fireball", slotLevel: 3, targetKind: "enemy", targetId: "goblin-1" };
  assert.equal(directCardCall({ ...card, atX: 4, atY: 4 }, vex.id, { inFight: true, resolution: "save", area: true }), null, "no board: the DM's word places it");
  assert.equal(directCardCall(card, vex.id, { inFight: true, resolution: "save", area: true, blast: "point" }), null, "no square picked");
  assert.deepEqual(
    directCardCall({ ...card, atX: 4, atY: 4 }, vex.id, { inFight: true, resolution: "save", area: true, blast: "point" }),
    { name: "aoe_damage", args: { casterCharacterId: vex.id, spell: "Fireball", level: 3, atX: 4, atY: 4 } },
  );
  assert.equal(directCardCall({ card: "spell", spell: "Burning Hands", slotLevel: 1, atX: 4, atY: 4 }, vex.id, { inFight: true, resolution: "save", area: true, blast: "direction" }), null, "a cone needs its direction");
});

// ---- issue 685: the rest of the cards the engine takes whole ----

await test("A lasting area laid on a square is aoe_damage's with its squares and nobody named; one that catches whoever stands in it as it appears stays with the GM.", () => {
  const web = { card: "spell", spell: "Web", slotLevel: 2, targetKind: "enemy", targetId: "goblin-1", atX: 5, atY: 6 };
  assert.deepEqual(
    directCardCall(web, iris.id, { inFight: true, resolution: "save", area: true, lasting: { pick: "point" } }),
    { name: "aoe_damage", args: { casterCharacterId: iris.id, spell: "Web", level: 2, atX: 5, atY: 6 } },
  );
  assert.equal(directCardCall({ ...web, atX: undefined, atY: undefined }, iris.id, { inFight: true, resolution: "save", area: true, lasting: { pick: "point" } }), null, "no square picked");
  assert.equal(directCardCall({ card: "spell", spell: "Entangle", slotLevel: 1, atX: 5, atY: 6 }, iris.id, { inFight: true, resolution: "save", area: true, lasting: { pick: "point", catches: true } }), null, "its first saves need the creatures in it named");
  assert.deepEqual(
    directCardCall({ card: "spell", spell: "Fog Cloud", slotLevel: 1, atX: 8, atY: 2 }, iris.id, { inFight: true, resolution: null, lasting: { pick: "point" } }),
    { name: "use_spell_slot", args: { characterId: iris.id, spell: "Fog Cloud", level: 1, atX: 8, atY: 2 } },
    "an area with nothing to roll is laid by the slot",
  );
  assert.deepEqual(
    directCardCall({ card: "spell", spell: "Fog Cloud", slotLevel: 1 }, iris.id, { inFight: false, resolution: null, lasting: { pick: "off" } }),
    { name: "use_spell_slot", args: { characterId: iris.id, spell: "Fog Cloud", level: 1 } },
    "off the board the slot alone is spent",
  );
  assert.deepEqual(
    directCardCall({ card: "spell", spell: "Spirit Guardians", slotLevel: 3, targetKind: "self", targetId: sefa.id }, sefa.id, { inFight: true, resolution: "buff", lasting: { pick: "none" }, selfOnly: true }),
    { name: "cast_buff", args: { characterId: sefa.id, spell: "Spirit Guardians", targetCharacterIds: [sefa.id], level: 3 } },
    "a buff that lays an area is cast_buff's",
  );
});

await test("A summon is cast_buff's when its creature is named or the only one; a utility spell spends its slot; a Self buff with nobody named lands on its caster.", () => {
  assert.deepEqual(directCardCall({ card: "spell", spell: "Unseen Servant", slotLevel: 1 }, iris.id, { inFight: true, resolution: null, summon: "one" }), {
    name: "cast_buff",
    args: { characterId: iris.id, spell: "Unseen Servant", level: 1 },
  });
  assert.equal(directCardCall({ card: "spell", spell: "Conjure Animals", slotLevel: 3 }, iris.id, { inFight: true, resolution: null, summon: "choose" }), null, "the GM picks the beasts");
  assert.deepEqual(directCardCall({ card: "spell", spell: "Animate Dead", slotLevel: 3, variant: "Skeleton" }, iris.id, { inFight: true, resolution: null, summon: "choose" }), {
    name: "cast_buff",
    args: { characterId: iris.id, spell: "Animate Dead", level: 3, variant: "Skeleton" },
  });
  assert.equal(directCardCall({ card: "spell", spell: "Arcane Hand", slotLevel: 5, targetKind: "enemy", targetId: "goblin-1" }, iris.id, { inFight: true, resolution: "attack", summon: "one" }).name, "cast_buff", "the casting brings the hand, whatever its row says");
  assert.deepEqual(directCardCall({ card: "spell", spell: "Detect Thoughts", slotLevel: 2 }, iris.id, { inFight: false, resolution: "utility" }), {
    name: "use_spell_slot",
    args: { characterId: iris.id, spell: "Detect Thoughts", level: 2 },
  });
  assert.equal(directCardCall({ card: "spell", spell: "Dispel Magic", slotLevel: 3 }, iris.id, { inFight: true, resolution: "utility", dispel: true }), null, "Dispel Magic needs its target");
  assert.deepEqual(directCardCall({ card: "spell", spell: "Blur", slotLevel: 2 }, iris.id, { inFight: true, resolution: "buff", selfOnly: true }), {
    name: "cast_buff",
    args: { characterId: iris.id, spell: "Blur", targetCharacterIds: [iris.id], level: 2 },
  });
  assert.equal(directCardCall({ card: "spell", spell: "Bless", slotLevel: 1 }, iris.id, { inFight: true, resolution: "buff" }), null, "a buff on someone not named is the GM's");
});

await test("An attack's riders ride pc_attack under its own names: Divine Smite's slot and one maneuver; a smite with no slot, an unnamed maneuver or two are left.", () => {
  const swing = { card: "attack", weapon: "Longsword", targetKind: "enemy", targetId: "goblin-1" };
  assert.deepEqual(directCardCall({ ...swing, riders: ["Divine Smite"], attack: { smite: 2 } }, kara.id), {
    name: "pc_attack",
    args: { characterId: kara.id, targetEnemyId: "goblin-1", weapon: "Longsword", smite: 2 },
  });
  assert.equal(directCardCall({ ...swing, riders: ["Divine Smite"] }, kara.id), null, "a card from an older screen names no slot");
  assert.deepEqual(directCardCall({ ...swing, riders: ["Trip Attack"] }, kara.id).args.maneuver, "Trip Attack");
  assert.equal(directCardCall({ ...swing, riders: ["Trip Attack", "Menacing Attack"] }, kara.id), null, "one Superiority Die a swing");
  assert.equal(directCardCall({ ...swing, riders: ["Maneuver"] }, kara.id), null, "a maneuver not named");
  assert.equal(directCardCall({ card: "rider", rider: "Divine Smite", slotLevel: 1 }, kara.id), null, "a rider alone waits for the swing");
});

await test("At an AI table a Web laid on a square is the engine's before the model is asked: the web is on the board.", async () => {
  await stageBlast();
  const casting = world.sheet(vex.id).spellcasting;
  world.patch(vex.id, { spellcasting: { ...casting, prepared: [...casting.prepared, "Web"], spellbook: [...casting.spellbook, "Web"] }, concentratingOn: null });
  model.script([reply({ text: "Sticky strands fill the clearing." })]);
  await model.turn(world, "I cast Web on (11,6) using a level 2 slot.", vex.id, vex.userId, {
    intent: { card: "spell", spell: "Web", slotLevel: 2, atX: 11, atY: 6 },
  });
  assert.equal(model.requests.length, 1, "one model call: the narration");
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "aoe_damage", JSON.stringify(toolCalls(model.requests[0])));
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
  assert.ok(kit.map().spellZones.some((zone) => zone.spell === "Web"), "the web is laid");
  assert.equal(world.sheet(vex.id).spellcasting.slots[2].used, 1);
});

// A card the GM resolved as played from the console (src/lib/dm/resolve-card.ts)
// is answered: an AI turn that covers for them does not cast it again.
await test("A card already resolved as played is not resolved again by an AI turn, and its line says the engine took it.", async () => {
  const enemy = await stage(iris);
  const { insertCampaignMessage, claimCardResolution } = await import("../src/lib/db/messages.ts");
  const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
  const played = insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType: "player",
    userId: iris.userId,
    characterId: iris.id,
    content: "I cast Fire Bolt at Goblin 1.",
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  assert.ok(claimCardResolution(played.id));
  model.script([reply({ text: "The bolt has already flown." })]);
  await model.turn(world, "And I step back.", iris.id, iris.userId);
  assert.equal(toolCalls(model.requests[0]).length, 0, "nothing cast it again");
  const transcript = model.requests[0].messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  assert.match(transcript, /Fire Bolt[^\n]*The engine has resolved it/);
  assert.ok(!corrected(), "no correction chased it");
});

// ---- issue 570: a casting shared out in the Hand ----

await test("Magic Missile's darts shared between two goblins are one cast_at_enemy with both, the darts each takes, and one slot.", async () => {
  const { near, close } = await stageBlast();
  model.script([reply({ text: "Three darts streak out." })]);
  await model.turn(world, "I cast Magic Missile at Goblin 1 (2 darts) and Goblin 2 (1 dart) using a level 1 slot.", vex.id, vex.userId, {
    intent: {
      card: "spell", spell: "Magic Missile", slotLevel: 1, targetKind: "enemy", targetId: near.id, targetName: near.displayName,
      shares: [{ id: near.id, name: near.displayName, count: 2 }, { id: close.id, name: close.displayName, count: 1 }],
    },
  });
  const calls = toolCalls(model.requests[0]).map((entry) => ({ name: entry.function.name, args: JSON.parse(entry.function.arguments), id: entry.id }));
  assert.deepEqual(calls.map((entry) => [entry.name, entry.args.targets]), [["cast_at_enemy", [{ targetEnemyId: near.id, darts: 2 }, { targetEnemyId: close.id, darts: 1 }]]]);
  const [answer] = results(model.requests[0]);
  assert.ok(answer && !answer.error && answer.targets.every((result) => !result.error), JSON.stringify(answer));
  const hp = (id) => world.enemies().find((enemy) => enemy.id === id).currentHp;
  assert.ok(hp(near.id) < 200 && hp(close.id) < 200, "both goblins were struck");
  assert.equal(world.sheet(vex.id).spellcasting.slots[1].used, 1, "one slot for the whole casting");
});

await test("Scorching Ray's three rays at one goblin are three attack rolls, not one.", async () => {
  const { near } = await stageBlast();
  model.script([reply({ text: "Three rays of fire." })]);
  await model.turn(world, "I cast Scorching Ray at Goblin 1 (3 rays) using a level 2 slot.", vex.id, vex.userId, {
    intent: { card: "spell", spell: "Scorching Ray", slotLevel: 2, targetKind: "enemy", targetId: near.id, targetName: near.displayName, shares: [{ id: near.id, count: 3 }] },
  });
  const calls = toolCalls(model.requests[0]);
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.equal(calls[0].function.name, "pc_attack");
  assert.equal(JSON.parse(calls[0].function.arguments).attacks.length, 3);
  const [answer] = results(model.requests[0]);
  assert.ok(answer && answer.attacks.length === 3 && answer.attacks.every((result) => !result.error), JSON.stringify(answer));
  assert.equal(world.sheet(vex.id).spellcasting.slots[2].used, 1, "the rays share one slot");
});

await test("A Bless shared with two allies is one cast_buff on both.", async () => {
  await stage(sefa);
  model.script([reply({ text: "A blessing settles on Kara and Iris." })]);
  await model.turn(world, "I cast Bless on Kara and Iris using a level 1 slot.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Bless", slotLevel: 1, targetKind: "ally", targetId: kara.id, targetName: "Kara", shares: [{ id: kara.id, count: 1 }, { id: iris.id, count: 1 }] },
  });
  const first = firstCall(model.requests[0]);
  assert.equal(first?.name, "cast_buff", JSON.stringify(toolCalls(model.requests[0])));
  assert.deepEqual(first.args.targetCharacterIds, [kara.id, iris.id]);
  const [result] = results(model.requests[0]);
  assert.ok(result && !result.error, JSON.stringify(result));
});

// ---- issue 570: a card that still did not happen goes back to its player ----

const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const lastPlayerLine = () => listRecentMessages(world.campaignId, 20).filter((message) => message.authorType === "player").at(-1);
const askedLines = () => model.requests.flatMap((request) => request.messages).filter((message) => message.role === "user").map((message) => String(message.content));

await test("A spell card nothing carried out, the correction included, goes back to its player: its line says so, and the story is asked not to tell it.", async () => {
  await stage(iris);
  model.script([
    reply({ text: "Fire leaps from Iris's hand and scorches the goblin." }),
    reply({ text: "Iris lets the fire fly." }),
    reply({ text: "Iris draws breath, but the moment passes." }),
  ]);
  await model.turn(world, "I cast Fire Bolt at the nearest goblin.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null },
  });
  assert.ok(corrected(), "the one correction ran first");
  const line = lastPlayerLine();
  assert.match(line.cardReturned ?? "", /carried it out/, JSON.stringify(line));
  assert.ok(askedLines().some((text) => /did not happen/.test(text) && /back to Iris's hand/.test(text)), "the guard told the story it did not happen");
});

await test("A blast laid where it caught nobody goes back with the engine's reason, and a card the engine carried out does not.", async () => {
  await stageBlast();
  model.script([reply({ text: "Vex hesitates." }), reply({ text: "Vex hesitates." }), reply({ text: "Vex hesitates." })]);
  await model.turn(world, "I cast Fireball centred on (16,0) using a level 3 slot.", vex.id, vex.userId, {
    intent: { card: "spell", spell: "Fireball", slotLevel: 3, atX: 16, atY: 0 },
  });
  assert.match(lastPlayerLine().cardReturned ?? "", /catches nobody/);
  const enemy = await stage(iris);
  model.script([reply({ text: "A bolt of flame streaks across the gap." })]);
  await model.turn(world, "I cast Fire Bolt at Goblin 1.", iris.id, iris.userId, {
    intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  assert.equal(lastPlayerLine().cardReturned, undefined, "the bolt was rolled: nothing comes back");
});

await test("A card the engine refused is answered by the refusal, not given back.", async () => {
  await stage(iris);
  world.patch(iris.id, { spellcasting: { ...world.sheet(iris.id).spellcasting, slots: { 1: { max: 4, used: 4 }, 2: { max: 2, used: 2 } } } });
  model.script([
    reply({ calls: [call("cast_at_enemy", { characterId: iris.id, spell: "Magic Missile", targetEnemyId: world.enemies()[0].id })] }),
    reply({ text: "Iris reaches for the magic, but none is left." }),
  ]);
  await model.turn(world, "I cast Magic Missile at the goblin.", iris.id, iris.userId, { intent: { card: "spell", spell: "Magic Missile", slotLevel: 1 } });
  world.patch(iris.id, { spellcasting: { ...world.sheet(iris.id).spellcasting, slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } } } });
  const refusal = results(model.requests.at(-1)).find((result) => result?.error);
  assert.equal(refusal?.refused, "rules", JSON.stringify(refusal));
  assert.equal(lastPlayerLine().cardReturned, undefined);
});

// The play-test of 0.31.3: Spiritual Weapon from the Hand spent the slot and
// the bonus action and made no strike. The square the player taps for the
// weapon reaches cast_buff, and the strike card that follows strikes from
// there, riding the casting's bonus action (SRD 5.1: "When you cast the
// spell, you can make a melee spell attack against a creature within 5 feet
// of the weapon").
await test("A Spiritual Weapon card laid on a square is cast there, and its strike card strikes from it with no second bonus action.", async () => {
  const enemy = await stage(sefa);
  const casting = world.sheet(sefa.id).spellcasting;
  world.patch(sefa.id, { spellcasting: { ...casting, prepared: [...casting.prepared, "Spiritual Weapon"] } });
  kit.place(enemy.id, 9, 6);
  model.script([reply({ text: "A spectral mace shimmers into being beside the goblin." })]);
  await model.turn(world, "I cast Spiritual Weapon on myself as a bonus action using a level 2 slot.", sefa.id, sefa.userId, {
    intent: { card: "spell", spell: "Spiritual Weapon", slotLevel: 2, targetKind: "self", targetId: sefa.id, targetName: "Sefa", atX: 8, atY: 6 },
  });
  const cast = firstCall(model.requests[0]);
  assert.equal(cast?.name, "cast_buff", JSON.stringify(toolCalls(model.requests[0])));
  assert.equal(cast.args.atX, 8);
  assert.equal(cast.args.atY, 6);
  const [laid] = results(model.requests[0]);
  assert.ok(laid && !laid.error, JSON.stringify(laid));
  assert.equal(world.sheet(sefa.id).spellcasting.slots[2].used, 1);

  model.script([reply({ text: "The mace cracks down on the goblin." })]);
  await model.turn(world, "I attack Goblin 1 with Spiritual Weapon.", sefa.id, sefa.userId, {
    intent: { card: "attack", weapon: "Spiritual Weapon", targetKind: "enemy", targetId: enemy.id, targetName: enemy.displayName },
  });
  const strike = firstCall(model.requests[0]);
  assert.equal(strike?.name, "pc_attack", JSON.stringify(toolCalls(model.requests[0])));
  assert.equal(strike.args.weapon, "Spiritual Weapon");
  const [struck] = results(model.requests[0]);
  assert.ok(struck && !struck.error, `the casting's strike resolved: ${JSON.stringify(struck)}`);
  assert.match(JSON.stringify(struck), /no second bonus action/);
  assert.match(JSON.stringify(struck), /strikes from \(8,6\)/);
});

model.close();
await finish();
