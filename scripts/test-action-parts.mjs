// A player's whole declaration resolves within the DM turn that took it.
// An agent program in the DM seat (Codex) sends one tool call per reply, and
// a turn has three tool-bearing model calls: a monk's Attack and Flurry of
// Blows, a fighter's Attack and Action Surge or a Whirlwind Attack, one call
// per part, never fit, and the table had to say "keep going" until they did.
// Each tool now takes the declaration's parts as a list (pc_attack's attacks,
// cast_at_enemy's targets, grant_item's and purchase's items, damage_object's
// blows, travel's days), resolved in order inside the one call
// (src/lib/dm/action-parts-logic.ts). Here a scripted model in that shape
// drives whole turns, and the choices a player makes between parts, the
// refusals, the physical dice and the state a turn saved before all hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearDice, dice, openWorld, seedDice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-action-parts");
const world = await openWorld({
  campaign: { maxPlayers: 7 },
  // No story summary: it asks the model in the background, and a long suite's
  // summary took a later turn's scripted reply.
  gameSettings: { ttsEnabled: false, dicePolicy: "real_allowed", stages: { compaction: false } },
});
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getDmTurn, getLatestDmTurnId, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { listShops, updateShop } = await import("../src/lib/db/shops.ts");
const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { DM_SYSTEM, ENCOUNTER_RULES, groupGuidance } = await import("../src/lib/dm/prompt-rules.ts");
const { TOOL_GROUPS } = await import("../src/lib/dm/tool-profiles.ts");
const { openCastOf } = await import("../src/lib/dm/cast-rules.ts");

// Fixed dice: every roll the script does not force comes from this seed.
seedDice(47);

const fighter = world.addHero({
  name: "Brann", class: "fighter", level: 20, maxHp: 180, abilities: { str: 20 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const monk = world.addHero({
  name: "Kara", class: "monk", subclass: "Way of the Open Hand", level: 5, maxHp: 40, abilities: { dex: 16, wis: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
});
const warlock = world.addHero({
  name: "Vesh", class: "warlock", level: 17, maxHp: 100, abilities: { cha: 18 }, proficiencies: TRAINED,
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "cha", slots: { 5: { max: 4, used: 0 } }, known: ["Hex"], prepared: [], cantrips: ["Eldritch Blast"] },
});
const wizard = world.addHero({
  name: "Iris", class: "wizard", level: 17, maxHp: 90, abilities: { int: 18 }, proficiencies: TRAINED,
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, known: [], prepared: ["Scorching Ray", "Magic Missile"], cantrips: ["Fire Bolt"], spellbook: ["Scorching Ray", "Magic Missile"] },
});
const ranger = world.addHero({
  name: "Tam", class: "ranger", subclass: "Hunter", level: 11, maxHp: 90, abilities: { dex: 18, str: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Shortsword", qty: 1, equipped: true }, { name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 40 }],
});
const archer = world.addHero({
  name: "Lio", class: "ranger", level: 11, maxHp: 90, abilities: { dex: 18 }, proficiencies: TRAINED,
  equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 40 }],
});
const cleric = world.addHero({
  name: "Odo", class: "cleric", level: 9, maxHp: 60, abilities: { wis: 18 }, proficiencies: TRAINED,
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
  spellcasting: { ability: "wis", slots: { 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } }, known: [], prepared: ["Mass Healing Word", "Hold Person"], cantrips: [] },
});
const heroes = [fighter, monk, warlock, wizard, ranger, archer, cleric];
const withFeature = (hero, name) =>
  world.patch(hero.id, { features: [...world.sheet(hero.id).features.filter((feature) => feature.name !== name), { name, description: "" }] });
const fullSlots = () =>
  world.patch(wizard.id, { spellcasting: { ...world.sheet(wizard.id).spellcasting, slots: Object.fromEntries([4, 3, 3, 3, 2, 1, 1, 1, 1].map((max, index) => [index + 1, { max, used: 0 }])) } });

// A fight of `count` creatures around (5, 5), whose turn it is, standing at
// (5, 5); everyone else far off. Creatures that take every blow by default.
async function stage(whose, count, enemy = {}) {
  await kit.endFight();
  await kit.fight(count);
  fullSlots();
  // Rested: every counter full, as the inventory's fullest declarations are.
  for (const hero of heroes) {
    const resources = world.sheet(hero.id).resources ?? {};
    world.patch(hero.id, { resources: Object.fromEntries(Object.entries(resources).map(([id, counter]) => [id, { ...counter, used: 0 }])) });
  }
  const ring = [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]];
  const enemies = world.enemies();
  enemies.forEach((foe, index) => {
    kit.setEnemy(foe.id, { maxHp: 999, currentHp: 999, ...enemy });
    kit.place(foe.id, ...ring[index % ring.length]);
  });
  heroes.forEach((hero, index) => kit.place(hero.id, hero === whose ? 5 : 14 + index, hero === whose ? 5 : 14));
  kit.giveTurn(whose.id);
  return world.enemies();
}

// One DM turn of the agent shape: each call its own reply, then the prose.
// Returns every call the turn ran with its answer, in order.
async function agentTurn(whose, line, calls) {
  const sent = calls.map(([name, args]) => call(name, args));
  model.script([...sent.map((entry) => reply({ calls: [entry] })), reply({ text: "The moment turns." })]);
  await model.turn(world, line, whose.id, whose.userId);
  // The turn's own last request: a story arc's checks may ask the model
  // after it, with none of the turn's calls in theirs.
  const last = model.requests.findLast((request) => request.messages.some((message) => message.role === "tool" && sent.some((entry) => entry.id === message.tool_call_id))) ?? model.requests.at(-1);
  const answers = new Map(last.messages.filter((message) => message.role === "tool").map((message) => [message.tool_call_id, JSON.parse(message.content)]));
  return sent.map((entry) => ({ name: entry.name, result: answers.get(entry.id) }));
}
const toolBearing = () => model.requests.filter((request) => Array.isArray(request.tools) && request.tools.length).length;
const errorsOf = (list = []) => list.filter((part) => typeof part.error === "string").map((part) => part.error);
const part = (foe, extra = {}) => ({ targetEnemyId: foe.id, ...extra });

// ---- Fits the turn: every inventoried action at its fullest declaration ----

const FULLEST = [
  {
    label: "a fighter 20's Attack action and Action Surge: eight swings",
    whose: fighter, count: 2, line: "Brann attacks four times, surges, and attacks four more times.",
    declare: (e) => ["pc_attack", { characterId: fighter.id, attacks: [...[0, 1, 0, 1].map((i) => part(e[i])), ...[0, 1, 0, 1].map((i) => part(e[i], { feature: "Action Surge" }))] }],
    parts: 8,
  },
  {
    label: "a monk 5's Attack action and Flurry of Blows: four strikes",
    whose: monk, count: 1, line: "Kara strikes twice with her staff, then a Flurry of Blows.",
    declare: (e) => ["pc_attack", { characterId: monk.id, attacks: [part(e[0]), part(e[0]), part(e[0], { feature: "Flurry of Blows" }), part(e[0], { feature: "Flurry of Blows" })] }],
    parts: 4,
  },
  {
    label: "Eldritch Blast at 17th level: four beams over two creatures",
    whose: warlock, count: 2, line: "Vesh fires all four beams of Eldritch Blast.",
    declare: (e) => ["pc_attack", { characterId: warlock.id, attacks: [0, 1, 0, 1].map((i) => part(e[i], { spell: "Eldritch Blast" })) }],
    parts: 4,
  },
  {
    label: "Scorching Ray from a 9th-level slot: ten rays over three creatures",
    whose: wizard, count: 3, line: "Iris casts Scorching Ray from her 9th-level slot.",
    declare: (e) => ["pc_attack", { characterId: wizard.id, attacks: Array.from({ length: 10 }, (_, i) => part(e[i % 3], { spell: "Scorching Ray", level: 9 })) }],
    parts: 10,
  },
  {
    label: "Whirlwind Attack against eight creatures",
    whose: ranger, count: 8, line: "Tam spins in a Whirlwind Attack against all eight.",
    setup: () => withFeature(ranger, "Multiattack: Whirlwind Attack"),
    declare: (e) => ["pc_attack", { characterId: ranger.id, attacks: e.map((foe) => part(foe, { weapon: "Shortsword", feature: "Whirlwind Attack" })) }],
    parts: 8,
  },
];

for (const scenario of FULLEST) {
  await test(`Fits the turn: ${scenario.label}, one call per reply, every part resolved and the turn ended`, async () => {
    scenario.setup?.();
    const enemies = await stage(scenario.whose, scenario.count);
    const ran = await agentTurn(scenario.whose, scenario.line, [scenario.declare(enemies), ["end_turn", { characterId: scenario.whose.id }]]);
    const [attack, ended] = ran;
    assert.ok(Array.isArray(attack.result.attacks), `the call answered ${JSON.stringify(attack.result).slice(0, 300)}`);
    assert.equal(attack.result.attacks.length, scenario.parts);
    assert.deepEqual(errorsOf(attack.result.attacks), [], "a part was refused");
    // An answer never sends the parts it holds to calls of their own.
    assert.doesNotMatch(JSON.stringify(attack.result), /more calls|call pc_attack again/i);
    assert.equal(typeof ended.result.error, "undefined", `end_turn answered ${JSON.stringify(ended.result).slice(0, 200)}`);
    assert.ok(toolBearing() <= 3, `${toolBearing()} tool-bearing calls`);
  });
}

await test("Fits the turn: Volley against every creature within 10 feet of a point, one call", async () => {
  withFeature(archer, "Multiattack: Volley");
  const enemies = await stage(archer, 3);
  kit.place(archer.id, 5, 14);
  const ran = await agentTurn(archer, "Lio looses a Volley into the pack.", [
    ["pc_attack", { characterId: archer.id, attacks: enemies.map((foe) => part(foe, { weapon: "Longbow", feature: "Volley" })) }],
    ["end_turn", { characterId: archer.id }],
  ]);
  assert.equal(ran[0].result.attacks?.length, 3, JSON.stringify(ran[0].result).slice(0, 300));
  assert.deepEqual(errorsOf(ran[0].result.attacks), []);
  assert.equal(typeof ran[1].result.error, "undefined", JSON.stringify(ran[1].result).slice(0, 200));
});

await test("Fits the turn: Magic Missile from a 9th-level slot, eleven darts over three creatures, one call and one slot", async () => {
  const enemies = await stage(wizard, 3);
  const ran = await agentTurn(wizard, "Iris splits eleven darts across the three.", [
    ["cast_at_enemy", { characterId: wizard.id, spell: "Magic Missile", level: 9, targets: [{ targetEnemyId: enemies[0].id, darts: 4 }, { targetEnemyId: enemies[1].id, darts: 4 }, { targetEnemyId: enemies[2].id, darts: 3 }] }],
    ["end_turn", { characterId: wizard.id }],
  ]);
  const cast = ran[0].result;
  assert.equal(cast.targets?.length, 3, JSON.stringify(cast).slice(0, 300));
  assert.deepEqual(errorsOf(cast.targets), []);
  assert.equal(world.sheet(wizard.id).spellcasting.slots[9].used, 1, "the casting spent one 9th-level slot");
  assert.ok(world.enemies().every((foe) => foe.currentHp < 999), "every creature took its darts");
  assert.equal(typeof ran[1].result.error, "undefined");
});

// ---- One mechanism: no per-feature field in any tool schema ----

await test("One mechanism: no tool schema holds whirlwind, volley or another per-feature field; a part names its feature by name", () => {
  const campaign = world.campaign();
  const RETIRED = ["whirlwind", "volley", "offHand", "hordeBreaker", "bonusAttack", "secondTargetEnemyId", "flurry", "actionSurge"];
  const found = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties") {
        for (const name of Object.keys(value)) if (RETIRED.includes(name)) found.push(`${path}.${name}`);
      }
      walk(value, key === "properties" || key === "items" ? path : `${path}.${key}`);
    }
  };
  for (const fight of [false, true]) {
    for (const tool of dmTurnTools(campaign, fight, true, false)) walk(tool.function.parameters, tool.function.name);
  }
  assert.deepEqual(found, []);
  const pcAttack = dmTurnTools(campaign, true, true, false).find((tool) => tool.function.name === "pc_attack").function.parameters;
  const feature = pcAttack.properties.attacks.items.properties.feature;
  assert.equal(feature.type, "string");
  assert.equal(feature.enum, undefined, "a feature is a name, not a list of values");
  assert.match(feature.description, /'Flurry of Blows': its two unarmed strikes, one entry each/);
});

// ---- Texts: nothing asks for a call per part ----

await test("Texts match: no tool description or prompt rule asks for a call per part", () => {
  const campaign = world.campaign();
  const texts = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "description" && typeof value === "string") texts.push([path, value]);
      else walk(value, `${path}.${key}`);
    }
  };
  for (const fight of [false, true]) {
    for (const tool of dmTurnTools(campaign, fight, true, false)) walk(tool.function, tool.function.name);
  }
  texts.push(["DM_SYSTEM", DM_SYSTEM], ["ENCOUNTER_RULES", ENCOUNTER_RULES]);
  for (const group of Object.keys(TOOL_GROUPS)) texts.push([`group ${group}`, groupGuidance(group, true)]);
  const PER_PART = [
    /once per (?:creature|target|attack|beam|ray|strike)/i,
    /whirlwind true/i,
    /\bvolley true\b/i,
    /call pc_attack again/i,
    /resolve each with pc_attack/i,
    /one enemy per call/i,
    /each call is one blow/i,
    /secondTargetEnemyId/,
    /\bbonusAttack\b/,
    /\boffHand\b/,
  ];
  const asked = texts.flatMap(([path, text]) => PER_PART.filter((pattern) => pattern.test(text)).map((pattern) => `${path}: ${pattern}`));
  assert.deepEqual(asked, []);
});

// ---- Choices kept, and a refused part costs no part ----

await test("A refused part costs no part: a creature that dropped is refused with the valid targets by name and id, the other parts resolve, and the attack stays owed for another target", async () => {
  const enemies = await stage(fighter, 2);
  kit.setEnemy(enemies[0].id, { ac: 1, maxHp: 1, currentHp: 1 });
  kit.setEnemy(enemies[1].id, { ac: 1 });
  // The first swing hits (a d20 of 15) and drops it.
  dice(15, 6);
  const ran = await agentTurn(fighter, "Brann cuts the first down, then keeps swinging.", [
    ["pc_attack", { characterId: fighter.id, attacks: [part(enemies[0]), part(enemies[0]), part(enemies[1])] }],
  ]);
  clearDice();
  const [first, second, third] = ran[0].result.attacks;
  assert.equal(first.dead, true, JSON.stringify(first));
  assert.equal(typeof second.error, "string", "a swing at a creature already down is refused");
  assert.match(second.error, new RegExp(enemies[1].id), `the refusal names a valid target by id: ${JSON.stringify(second)}`);
  assert.match(second.error, new RegExp(kit.enemy(enemies[1].id).displayName), "the refusal names a valid target by name");
  assert.equal(third.error, undefined, "the part after the refused one still resolved");
  // Two of four swings made: the refused one is still the fighter's.
  const again = await agentTurn(fighter, "Brann turns on the other.", [["pc_attack", { characterId: fighter.id, attacks: [part(enemies[1]), part(enemies[1])] }]]);
  assert.deepEqual(errorsOf(again[0].result.attacks), [], "the owed swings resolve against another target");
});

await test("A refused part costs no part: a creature out of reach is refused and the rest of the action resolves", async () => {
  const enemies = await stage(fighter, 2);
  kit.place(enemies[1].id, 15, 5);
  const ran = await agentTurn(fighter, "Brann swings at both.", [["pc_attack", { characterId: fighter.id, attacks: [part(enemies[1]), part(enemies[0]), part(enemies[0])] }]]);
  const [far, ...near] = ran[0].result.attacks;
  assert.equal(typeof far.error, "string", "the far creature is out of reach");
  assert.match(far.error, new RegExp(`Within reach: ${kit.enemy(enemies[0].id).displayName} \\(${enemies[0].id}\\)`), far.error);
  assert.deepEqual(errorsOf(near), [], "the reachable swings resolved");
});

await test("The call says once what the turn still holds, even when its last part was refused; a walk in that falls short still ends a declared turn", async () => {
  const enemies = await stage(fighter, 2);
  kit.setEnemy(enemies[0].id, { ac: 1, maxHp: 1, currentHp: 1 });
  // The first swing hits (a d20 of 15) and drops it; the last part aims at it again.
  dice(15, 6);
  const ran = await agentTurn(fighter, "Brann cuts the first down, swings at the second, then at the first again.", [
    ["pc_attack", { characterId: fighter.id, attacks: [part(enemies[0]), part(enemies[1]), part(enemies[0])] }],
  ]);
  const answer = ran[0].result;
  assert.equal(typeof answer.attacks[2].error, "string", "the last part was refused");
  assert.equal(answer.attacksRemaining, 2, JSON.stringify(answer).slice(0, 400));
  assert.ok(answer.attacks.every((entry) => entry.attacksRemaining === undefined), "a part's own count is gone");

  const far = await stage(fighter, 1);
  kit.place(far[0].id, 15, 5);
  const unreached = await agentTurn(fighter, "Brann charges the goblin and swings twice, then ends his turn.", [
    ["pc_attack", { characterId: fighter.id, endTurn: true, attacks: [part(far[0], { approach: true }), part(far[0], { approach: true })] }],
  ]);
  assert.equal(typeof unreached[0].result.error, "string");
  assert.equal(unreached[0].result.outOfReach, true, JSON.stringify(unreached[0].result).slice(0, 300));
  assert.ok(unreached[0].result.turnEnded, `the declared end of turn: ${JSON.stringify(unreached[0].result).slice(0, 300)}`);
});

await test("A part's feature: Extra Attack is a swing of the Attack action; a held feature that makes no attack is sent back with the names a part takes", async () => {
  const enemies = await stage(fighter, 1);
  withFeature(fighter, "Sneak Attack");
  const ran = await agentTurn(fighter, "Brann swings twice.", [["pc_attack", { characterId: fighter.id, attacks: [part(enemies[0], { feature: "Extra Attack" }), part(enemies[0], { feature: "Sneak Attack" })] }]]);
  const [swing, sneak] = ran[0].result.attacks;
  assert.equal(swing.error, undefined, JSON.stringify(swing).slice(0, 300));
  assert.equal(sneak.retry, true, JSON.stringify(sneak).slice(0, 300));
  assert.match(sneak.error, /Sneak Attack makes no attack of its own.*Action Surge/);
  world.patch(fighter.id, { features: world.sheet(fighter.id).features.filter((feature) => feature.name !== "Sneak Attack") });
});

await test("An advantage a part claims for a reason with no source is asked about, as a lone attack's is", async () => {
  const enemies = await stage(fighter, 1);
  const ran = await agentTurn(fighter, "Brann swings from the ledge.", [
    ["pc_attack", { characterId: fighter.id, attacks: [part(enemies[0]), part(enemies[0], { advantage: "advantage", advantageReason: "striking from the ledge" })] }],
  ]);
  assert.equal(ran[0].result.retry, true, JSON.stringify(ran[0].result).slice(0, 300));
  assert.match(ran[0].result.error, /names no advantageSource/);
});

await test("Lists do not nest: an entry's own list is no part of it", async () => {
  const { listedCalls } = await import("../src/lib/dm/action-parts-logic.ts");
  const calls = listedCalls("grant_item", JSON.stringify({ characterId: "c1", items: [{ item: "Rope", items: [{ item: "Torch" }, { item: "Torch" }] }, "Chalk"] }));
  assert.deepEqual(calls, [{ characterId: "c1", item: "Rope" }, { characterId: "c1", item: "Chalk" }]);
  assert.deepEqual(listedCalls("heal", JSON.stringify({ casterId: "c2", spell: "Mass Healing Word", targets: [{ characterId: "c1" }, "c3"] })), [
    { casterId: "c2", spell: "Mass Healing Word", characterId: "c1" },
    { casterId: "c2", spell: "Mass Healing Word", characterId: "c3" },
  ]);
  assert.equal(listedCalls("pc_attack", JSON.stringify({ attacks: [] })), null, "pc_attack resolves its own parts");
});

await test("Choices kept: Action Surge taken after the first action's results, in a second call; the refusal past the action's attacks names the unused surge", async () => {
  const enemies = await stage(fighter, 1);
  const first = await agentTurn(fighter, "Brann attacks.", [["pc_attack", { characterId: fighter.id, attacks: [0, 1, 2, 3].map(() => part(enemies[0])) }]]);
  assert.deepEqual(errorsOf(first[0].result.attacks), []);
  const past = await agentTurn(fighter, "And again.", [["pc_attack", { characterId: fighter.id, targetEnemyId: enemies[0].id }]]);
  assert.match(String(past[0].result.error), /Action Surge unused/, JSON.stringify(past[0].result).slice(0, 300));
  assert.match(String(past[0].result.error), /feature "Action Surge"/);
  const surged = await agentTurn(fighter, "Brann surges.", [["pc_attack", { characterId: fighter.id, attacks: [0, 1, 2, 3].map(() => part(enemies[0], { feature: "Action Surge" })) }]]);
  assert.deepEqual(errorsOf(surged[0].result.attacks), []);
  assert.equal(world.sheet(fighter.id).resources.action_surge.used, 1);
});

await test("Choices kept: Stunning Strike decided per part; a second stun on a creature already stunned through the monk's next turn is not spent", async () => {
  const enemies = await stage(monk, 1, { ac: 1, stats: { saveMods: { str: -20, dex: -20, con: -20, int: -20, wis: -20, cha: -20 } } });
  const ki = () => world.sheet(monk.id).resources.ki.used;
  const before = ki();
  const ran = await agentTurn(monk, "Kara strikes twice, stunning with each.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(enemies[0], { weapon: "unarmed strike", stunningStrike: true }), part(enemies[0], { weapon: "unarmed strike", stunningStrike: true })] }],
  ]);
  const [stun, skip] = ran[0].result.attacks;
  assert.equal(stun.error, undefined, JSON.stringify(stun).slice(0, 300));
  assert.ok(kit.enemy(enemies[0].id).conditions.some((entry) => /stunned/i.test(entry)), "the first hit stunned");
  assert.ok((skip.spent ?? []).some((note) => /Stunning Strike not used/.test(note)), JSON.stringify(skip).slice(0, 300));
  assert.equal(ki() - before, 1, "one ki for one stun");
});

await test("Choices kept: Open Hand Technique chosen per Flurry of Blows strike", async () => {
  const enemies = await stage(monk, 1, { ac: 1, stats: { saveMods: { str: -20, dex: -20, con: -20, int: -20, wis: -20, cha: -20 } } });
  const ran = await agentTurn(monk, "Kara strikes, then flurries: the first knocks prone, the second pushes.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(enemies[0]), part(enemies[0]), part(enemies[0], { feature: "Flurry of Blows", openHand: "prone" }), part(enemies[0], { feature: "Flurry of Blows", openHand: "push" })] }],
  ]);
  assert.deepEqual(errorsOf(ran[0].result.attacks), [], JSON.stringify(ran[0].result).slice(0, 400));
  assert.ok(kit.enemy(enemies[0].id).conditions.some((entry) => /prone/i.test(entry)), "the first flurry strike knocked it prone");
  assert.equal(world.sheet(monk.id).resources.ki.used, 1, "one ki for the flurry");
});

// SRD 5.1, Monk: Flurry of Blows is "two unarmed strikes as a bonus action",
// and an unarmed strike is made "instead of using a weapon". A model that
// named the monk's staff on the strikes had them refused as staff swings
// past the Attack action, the flurry already bought (live).
await test("Flurry of Blows strikes are unarmed strikes even when a part names the monk's weapon; a weapon swing past the action names the strikes still owed", async () => {
  const enemies = await stage(monk, 1);
  const ran = await agentTurn(monk, "Kara strikes twice, then a Flurry of Blows.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(enemies[0], { weapon: "Quarterstaff" }), part(enemies[0], { weapon: "Quarterstaff" }), part(enemies[0], { weapon: "Quarterstaff", feature: "Flurry of Blows" }), part(enemies[0], { weapon: "Quarterstaff", feature: "Flurry of Blows" })] }],
  ]);
  const strikes = ran[0].result.attacks;
  assert.deepEqual(errorsOf(strikes), [], JSON.stringify(ran[0].result).slice(0, 600));
  assert.deepEqual(strikes.slice(2).map((strike) => strike.weapon), ["Unarmed strike", "Unarmed strike"]);
  assert.ok((strikes[2].spent ?? []).some((note) => /strikes are unarmed/.test(note)), JSON.stringify(strikes[2]).slice(0, 300));
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);

  // A list that leaves a paid Flurry strike unmade says so at the top (live:
  // the turn ended on it); the strike that settles it clears the line.
  const lone = await stage(monk, 1);
  const half = await agentTurn(monk, "Kara strikes twice, then a Flurry of Blows.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(lone[0]), part(lone[0]), part(lone[0], { feature: "Flurry of Blows" })] }],
    ["pc_attack", { characterId: monk.id, attacks: [part(lone[0], { feature: "Flurry of Blows" })] }],
  ]);
  assert.match(String(half[0].result.owed), /^1 Flurry of Blows strike paid for and not yet made/, JSON.stringify(half[0].result).slice(-300));
  assert.equal(half[1].result.owed, undefined, JSON.stringify(half[1].result).slice(-300));

  // Two features that each take the bonus action, in one call: refused
  // whole, nothing spent, and the Flurry declared still to be had (live).
  const both = await stage(monk, 1);
  const kiBefore = world.sheet(monk.id).resources.ki.used;
  const clashed = await agentTurn(monk, "Kara strikes twice, then a Flurry of Blows.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(both[0]), part(both[0]), part(both[0], { feature: "Martial Arts" }), part(both[0], { feature: "Flurry of Blows" })] }],
    ["pc_attack", { characterId: monk.id, attacks: [part(both[0]), part(both[0]), part(both[0], { feature: "Flurry of Blows" }), part(both[0], { feature: "Flurry of Blows" })] }],
  ]);
  assert.match(String(clashed[0].result.error), /Martial Arts and Flurry of Blows each take the bonus action/, JSON.stringify(clashed[0].result).slice(0, 300));
  assert.equal(clashed[0].result.attacks, undefined, "nothing of the call was rolled");
  assert.deepEqual(errorsOf(clashed[1].result.attacks), [], JSON.stringify(clashed[1].result).slice(0, 400));
  assert.equal(world.sheet(monk.id).resources.ki.used, kiBefore + 1);

  // A strike named by the feature itself ("Martial Arts") is unarmed too (live).
  const named = await stage(monk, 1);
  const byFeature = await agentTurn(monk, "Kara strikes twice, then a Flurry of Blows.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(named[0]), part(named[0]), part(named[0], { weapon: "Martial Arts", feature: "Flurry of Blows" }), part(named[0], { weapon: "Flurry of Blows", feature: "Flurry of Blows" })] }],
  ]);
  assert.deepEqual(errorsOf(byFeature[0].result.attacks), [], JSON.stringify(byFeature[0].result).slice(0, 600));
  assert.deepEqual(byFeature[0].result.attacks.slice(2).map((strike) => strike.weapon), ["Unarmed strike", "Unarmed strike"]);

  await stage(monk, 1);
  const [foe] = world.enemies();
  const owed = await agentTurn(monk, "Kara strikes twice and flurries, then swings the staff.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(foe), part(foe), part(foe, { feature: "Flurry of Blows" }), part(foe, { weapon: "Quarterstaff" })] }],
  ]);
  const last = owed[0].result.attacks.at(-1);
  assert.match(String(last.error), /still has 1 Flurry of Blows strike paid for/, JSON.stringify(last).slice(0, 300));
});

await test("Swift Quiver: one bonus action buys two attacks, and no third", async () => {
  const enemies = await stage(archer, 1);
  kit.place(archer.id, 5, 14);
  world.patch(archer.id, { conditions: ["swift quiver"] });
  const ran = await agentTurn(archer, "Lio draws twice from the quiver.", [
    ["pc_attack", { characterId: archer.id, attacks: [0, 1, 2].map(() => part(enemies[0], { weapon: "Longbow", feature: "Swift Quiver" })) }],
  ]);
  const [one, two, three] = ran[0].result.attacks;
  assert.equal(one.error, undefined, JSON.stringify(one).slice(0, 300));
  assert.equal(two.error, undefined, JSON.stringify(two).slice(0, 300));
  assert.equal(typeof three.error, "string", "a third attack has no bonus action to ride");
});

// A part refused for what owes nothing to its feature never buys the
// feature: bought first, the Action Surge after the swing that dropped the
// last foe spent a use on a fight already over, and a flurry aimed at a
// creature the action's swings had killed spent the ki (PR 749 review).
await test("A feature is bought only for a strike that can be made: the swing that ends the fight leaves Action Surge unspent, a flurry at a fallen creature leaves the ki", async () => {
  const lone = await stage(fighter, 1);
  kit.setEnemy(lone[0].id, { ac: 1, maxHp: 1, currentHp: 1 });
  dice(15, 6);
  const surged = await agentTurn(fighter, "Brann swings, then surges.", [["pc_attack", { characterId: fighter.id, attacks: [part(lone[0]), part(lone[0], { feature: "Action Surge" })] }]]);
  clearDice();
  const [kill, surge] = surged[0].result.attacks;
  assert.equal(kill.dead, true, JSON.stringify(kill).slice(0, 300));
  assert.equal(typeof surge.error, "string", "no fight is left to surge in");
  assert.equal(surge.spent, undefined, JSON.stringify(surge));
  assert.equal(world.sheet(fighter.id).resources.action_surge.used, 0, "the use is still there");

  const pair = await stage(monk, 2);
  kit.setEnemy(pair[0].id, { ac: 1, maxHp: 1, currentHp: 1 });
  dice(15, 6);
  const flurried = await agentTurn(monk, "Kara strikes the first, then the second, then flurries at the first.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(pair[0]), part(pair[1]), part(pair[0], { feature: "Flurry of Blows" }), part(pair[0], { feature: "Flurry of Blows" })] }],
  ]);
  clearDice();
  const strikes = flurried[0].result.attacks;
  assert.equal(strikes[0].dead, true, JSON.stringify(strikes[0]).slice(0, 300));
  assert.match(String(strikes[2].error), /already dead/, JSON.stringify(strikes[2]).slice(0, 300));
  assert.equal(world.sheet(monk.id).resources.ki.used, 0, "no ki for strikes aimed at a fallen creature");
  assert.equal(flurried[0].result.owed, undefined, "no strike was paid for");
});

// "Two swings at the goblin, then I end my turn": the first killed it, and
// the turn ended on the second's refusal, which the next call could have
// aimed at the other goblin (PR 749 review).
await test("endTurn keeps the turn open while a part can be sent again; a part that names endTurn still ends it", async () => {
  const enemies = await stage(fighter, 2);
  kit.setEnemy(enemies[0].id, { ac: 1, maxHp: 1, currentHp: 1 });
  dice(15, 6);
  // The second swing, aimed again in the same GM turn, ends the turn with
  // endTurn on its entry, where the one-attack call carried it.
  const ran = await agentTurn(fighter, "Brann swings twice at the first goblin, then ends his turn.", [
    ["pc_attack", { characterId: fighter.id, endTurn: true, attacks: [part(enemies[0]), part(enemies[0])] }],
    ["pc_attack", { characterId: fighter.id, attacks: [part(enemies[1], { endTurn: true })] }],
  ]);
  clearDice();
  const [first, second] = ran.map((entry) => entry.result);
  assert.equal(first.turnEnded, undefined, JSON.stringify(first).slice(-400));
  assert.match(String(first.turnNotEnded), /Entry 2 can be sent again/, JSON.stringify(first).slice(-400));
  assert.equal(second.error, undefined, `the swing aimed again is still Brann's: ${JSON.stringify(second).slice(0, 300)}`);
  assert.ok(second.turnEnded, `endTurn on the entry ends the turn: ${JSON.stringify(second).slice(-300)}`);
});

// SRD 5.1, Way of the Open Hand: the technique rides "each of the attacks"
// of Flurry of Blows. A strike declared as the flurry's after one swing was
// counted as the Attack action's second swing: the ki was spent and both
// riders refused (PR 749 review).
await test("A strike declared as Flurry of Blows is one of its strikes, with the Attack action's other swing still owed", async () => {
  const enemies = await stage(monk, 1, { ac: 1, stats: { saveMods: { str: -20, dex: -20, con: -20, int: -20, wis: -20, cha: -20 } } });
  const ran = await agentTurn(monk, "Kara strikes once, then a Flurry: prone, then push.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(enemies[0]), part(enemies[0], { feature: "Flurry of Blows", openHand: "prone" }), part(enemies[0], { feature: "Flurry of Blows", openHand: "push" })] }],
  ]);
  assert.deepEqual(errorsOf(ran[0].result.attacks), [], JSON.stringify(ran[0].result).slice(0, 600));
  assert.ok(kit.enemy(enemies[0].id).conditions.some((entry) => /prone/i.test(entry)), "the first flurry strike knocked it prone");
  assert.equal(world.sheet(monk.id).resources.ki.used, 1);
  assert.equal(ran[0].result.attacksRemaining, 1, JSON.stringify(ran[0].result).slice(-300));
});

await test("Haste named as a part's feature is the hasted action's one weapon attack", async () => {
  const enemies = await stage(fighter, 1);
  world.patch(fighter.id, { conditions: ["hasted"] });
  const ran = await agentTurn(fighter, "Brann attacks four times, then once more with Haste.", [
    ["pc_attack", { characterId: fighter.id, attacks: [...[0, 1, 2, 3].map(() => part(enemies[0])), part(enemies[0], { feature: "Haste" })] }],
  ]);
  world.patch(fighter.id, { conditions: [] });
  assert.deepEqual(errorsOf(ran[0].result.attacks), [], JSON.stringify(ran[0].result).slice(-400));
});

await test("An older flat pc_attack call, one attack with its target, still resolves", async () => {
  const enemies = await stage(fighter, 1);
  const ran = await agentTurn(fighter, "Brann swings.", [["pc_attack", { characterId: fighter.id, targetEnemyId: enemies[0].id }]]);
  assert.equal(ran[0].result.error, undefined, JSON.stringify(ran[0].result).slice(0, 300));
});

await test("Saved state parses: a turn saved mid-flurry (one strike paid and owed) plays its strike without a second ki", async () => {
  const enemies = await stage(monk, 1);
  const first = await agentTurn(monk, "Kara strikes twice and flurries once.", [
    ["pc_attack", { characterId: monk.id, attacks: [part(enemies[0]), part(enemies[0]), part(enemies[0], { feature: "Flurry of Blows" })] }],
  ]);
  assert.deepEqual(errorsOf(first[0].result.attacks), []);
  const budget = world.encounter().turnBudget;
  assert.equal(budget.flurryStrikes, 1, `the stored budget owes one strike: ${JSON.stringify(budget)}`);
  // The budget as stored, round-tripped through JSON like a saved row.
  kit.saveEncounter({ ...world.encounter(), turnBudget: JSON.parse(JSON.stringify(budget)) });
  const second = await agentTurn(monk, "And the last strike.", [["pc_attack", { characterId: monk.id, attacks: [part(enemies[0], { feature: "Flurry of Blows" })] }]]);
  assert.equal(second[0].result.error, undefined, JSON.stringify(second[0].result).slice(0, 300));
  assert.equal(world.sheet(monk.id).resources.ki.used, 1, "the flurry was paid once");
});

await test("Saved state parses: an open casting and a granted action saved mid-turn play on without a second slot or use", async () => {
  const roundTrip = () => kit.saveEncounter({ ...world.encounter(), turnBudget: JSON.parse(JSON.stringify(world.encounter().turnBudget)) });
  let enemies = await stage(wizard, 1);
  const slot = () => world.sheet(wizard.id).spellcasting.slots[2].used;
  const ray = (extra = {}) => part(enemies[0], { spell: "Scorching Ray", level: 2, ...extra });
  const opened = await agentTurn(wizard, "Iris looses the first ray.", [["pc_attack", { characterId: wizard.id, attacks: [ray()] }]]);
  assert.equal(opened[0].result.error, undefined, JSON.stringify(opened[0].result).slice(0, 300));
  assert.ok(openCastOf(world.encounter().turnBudget, "Scorching Ray")?.left === 2, `the stored budget holds the casting: ${JSON.stringify(world.encounter().turnBudget)}`);
  roundTrip();
  const rays = await agentTurn(wizard, "And the other two.", [["pc_attack", { characterId: wizard.id, attacks: [ray(), ray()] }]]);
  assert.deepEqual(errorsOf(rays[0].result.attacks), []);
  assert.equal(slot(), 1, "the three rays spent one 2nd-level slot");

  enemies = await stage(fighter, 1);
  const first = await agentTurn(fighter, "Brann attacks four times and surges once.", [
    ["pc_attack", { characterId: fighter.id, attacks: [...[0, 1, 2, 3].map(() => part(enemies[0])), part(enemies[0], { feature: "Action Surge" })] }],
  ]);
  assert.deepEqual(errorsOf(first[0].result.attacks), []);
  roundTrip();
  const rest = await agentTurn(fighter, "And the surge's other three.", [["pc_attack", { characterId: fighter.id, attacks: [0, 1, 2].map(() => part(enemies[0], { feature: "Action Surge" })) }]]);
  assert.deepEqual(errorsOf(rest[0].result.attacks), []);
  assert.equal(world.sheet(fighter.id).resources.action_surge.used, 1, "Action Surge was spent once");
});

// ---- Physical dice ----

await test("Physical dice: the parts park one at a time, in order, and the resumed turn answers the one call with every part", async () => {
  const enemies = await stage(monk, 1);
  setMemberRealDice(world.campaignId, monk.userId, true);
  const parts = [part(enemies[0]), part(enemies[0]), part(enemies[0], { feature: "Flurry of Blows" }), part(enemies[0], { feature: "Flurry of Blows" })];
  const attack = call("pc_attack", { characterId: monk.id, attacks: parts });
  model.script([reply({ calls: [attack] }), reply({ calls: [call("end_turn", { characterId: monk.id })] }), reply({ text: "Fists and staff." })]);
  await model.turn(world, "Kara strikes twice, then Flurry.", monk.id, monk.userId);
  const turnId = getLatestDmTurnId(world.campaignId);
  const submit = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  world.signIn({ id: monk.userId });
  for (let guard = 0; guard < 16; guard += 1) {
    const [open, ...more] = listOpenPendingRolls(world.campaignId);
    if (!open) break;
    // One roll open at a time: each part is made once the one before it has
    // landed, its damage too (pc-attack-parts.ts afterToHitLanded), as the
    // server's dice make them, so a part reads the fight the last one left.
    assert.equal(more.length, 0, `parked together: ${[open, ...more].map((entry) => entry.kind).join(", ")}`);
    const answered = await callRoute(submit, "POST", { dice: open.kind === "attack" ? [18] : [3] }, { campaignId: world.campaignId, pendingRollId: open.id });
    assert.equal(answered.status, 200);
  }
  await settleQueue(world.campaignId);
  setMemberRealDice(world.campaignId, monk.userId, false);
  assert.notEqual(getDmTurn(turnId).status, "awaiting_rolls");
  const resumed = model.requests[1];
  const answer = resumed.messages.find((message) => message.role === "tool" && message.tool_call_id === attack.id);
  const result = JSON.parse(answer.content);
  assert.equal(result.attacks?.length, 4, answer.content.slice(0, 400));
  assert.ok(result.attacks.every((entry) => !entry.awaitingRoll), "every part holds its roll's answer");
  assert.ok(result.attacks.every((entry) => typeof entry.total === "number" && entry.made !== false), `every part was made and rolled: ${answer.content.slice(0, 400)}`);
});

// At a table a person runs, the Hand's share of a casting reaches the engine
// through the console's door (actions/route.ts: directCardCalls, then
// invokeEngine as a person), whose form still requires the one creature a
// call named before the share became a list: refused there, "Heal needs
// character." and "Player attacks needs target." (PR 749 review).
await test("The console takes the Hand's share of a casting as one call: Scorching Ray's rays, Magic Missile's darts, Mass Healing Word's creatures", async () => {
  const { directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
  const share = (intent, context) => directCardCalls(intent, intent.caster, context)[0];
  let enemies = await stage(wizard, 2);
  const aim = { card: "spell", targetKind: "enemy", targetId: enemies[0].id, caster: wizard.id };
  const rays = share({ ...aim, spell: "Scorching Ray", slotLevel: 2, shares: [{ id: enemies[0].id, count: 2 }, { id: enemies[1].id, count: 1 }] }, { inFight: true, resolution: "attack", shareKind: "attacks" });
  const shot = await world.invoke(rays.name, rays.args);
  assert.equal(shot.ok, true, shot.error);
  assert.deepEqual(errorsOf(shot.result.attacks), [], JSON.stringify(shot.result).slice(0, 300));
  assert.equal(shot.result.attacks.length, 3);

  enemies = await stage(wizard, 2);
  const darts = share({ ...aim, targetId: enemies[0].id, spell: "Magic Missile", slotLevel: 1, shares: [{ id: enemies[0].id, count: 2 }, { id: enemies[1].id, count: 1 }] }, { inFight: true, resolution: "auto", shareKind: "darts" });
  const struck = await world.invoke(darts.name, darts.args);
  assert.equal(struck.ok, true, struck.error);
  assert.deepEqual(errorsOf(struck.result.targets), [], JSON.stringify(struck.result).slice(0, 300));

  await kit.endFight();
  for (const hero of [fighter, monk, cleric]) world.patch(hero.id, { currentHp: 1 });
  const before = world.sheet(cleric.id).spellcasting.slots[3].used;
  const word = share(
    { card: "spell", spell: "Mass Healing Word", slotLevel: 3, targetKind: "ally", targetId: fighter.id, caster: cleric.id, shares: [fighter, monk, cleric].map((hero) => ({ id: hero.id, count: 1 })) },
    { inFight: false, resolution: "heal", shareKind: "targets" },
  );
  const healed = await world.invoke(word.name, word.args);
  assert.equal(healed.ok, true, healed.error);
  assert.ok([fighter, monk, cleric].every((hero) => world.sheet(hero.id).currentHp > 1), "every creature of the share was healed");
  assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used - before, 1, "one casting, one slot");
});

await test("A share partly refused at the console tells the person why, and says the rest landed", async () => {
  const { refusedPartsLine } = await import("../src/lib/dm/action-parts-logic.ts");
  const line = refusedPartsLine({ targets: [{ ok: true }, { error: "Goblin 2 is already dead.", retry: true }], partial: "Entry 2 of 2 refused; the others are done." });
  assert.match(String(line), /Goblin 2 is already dead\..*The rest is done\./);
  assert.equal(refusedPartsLine({ attacks: [{ hit: true }, { hit: false }] }), null);
  const route = readFileSync(new URL("../src/app/api/campaigns/[campaignId]/actions/route.ts", import.meta.url), "utf8");
  assert.match(route, /refusedPartsLine\(resolved\.result\)/, "the actions route says a share's refused creatures");
});

// ---- Outside a fight ----

await kit.endFight();

await test("damage_object blows: a named barricade is struck until it breaks, in one call", async () => {
  const ran = await agentTurn(fighter, "Brann hacks at the barricade until it splinters.", [
    ["damage_object", { characterId: fighter.id, weapon: "Longsword", name: "the barricade", material: "wood", blows: 20, reason: "until it breaks" }],
  ]);
  const { result } = ran[0];
  assert.equal(result.broken, true, JSON.stringify(result).slice(0, 300));
  assert.ok(result.blows.length >= 1 && result.blows.length <= 20, `${result.blows.length} blows`);
  const unnamed = await world.invoke("damage_object", { characterId: fighter.id, weapon: "Longsword", material: "wood", blows: 3, reason: "x" });
  assert.equal(typeof unnamed.error, "string", "several blows need a named object that keeps its damage");
});

await test("Travel: back-to-back legs are one day's march and reach the forced-march save, counted per traveller and closed by a long rest; days of road with their nights never do; hours 24 is a forced march", async () => {
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
    const first = await world.invoke("travel", { hours: 8, pace: "normal", characterIds: [fighter.id] });
    assert.equal(first.result.forcedMarch, false, JSON.stringify(first.result).slice(0, 200));
    const second = await world.invoke("travel", { hours: 4, pace: "normal", characterIds: [fighter.id] });
    assert.notEqual(second.result.forcedMarch, false, `the 12th hour of the day's march: ${JSON.stringify(second.result).slice(0, 300)}`);
    // A traveller's day is their own: who did not march the morning walks
    // their first hour, beside one on their thirteenth.
    const both = await world.invoke("travel", { hours: 1, pace: "normal", characterIds: [fighter.id, monk.id] });
    assert.deepEqual(both.result.results?.map((entry) => entry.name), [world.sheet(fighter.id).name], JSON.stringify(both.result).slice(0, 300));
    // A night's long rest closes the day: the next morning's march is its own.
    world.patch(fighter.id, { exhaustion: 0, currentHp: world.sheet(fighter.id).maxHp });
    await world.invoke("pass_time", { amount: 2, unit: "hours" });
    const rest = await world.invoke("take_rest", { kind: "long" });
    assert.equal(rest.ok, true, rest.error);
    const morning = await world.invoke("travel", { hours: 2, pace: "normal", characterIds: [fighter.id] });
    assert.equal(morning.result.forcedMarch, false, `the morning after a long rest: ${JSON.stringify(morning.result).slice(0, 300)}`);
    await world.invoke("pass_time", { amount: 24, unit: "hours" });
    world.patch(fighter.id, { exhaustion: 0 });
    // The monk stays behind: the camp's nights are the travellers' only.
    const stayed = () => getClock(world.campaignId).longRests?.[monk.id];
    const monkRested = stayed();
    const journey = await world.invoke("travel", { days: 4, pace: "normal", characterIds: [fighter.id] });
    assert.equal(stayed(), monkRested, "the monk who stayed behind took the travellers' long rests");
    assert.notEqual(getClock(world.campaignId).longRests?.[fighter.id], undefined);
    assert.equal(journey.result.days, 4, JSON.stringify(journey.result).slice(0, 400));
    assert.equal(journey.result.nights.length, 3);
    assert.ok(journey.result.nights.every((night) => night.error === undefined), JSON.stringify(journey.result.nights).slice(0, 300));
    assert.ok(journey.result.legs.every((leg) => leg.forcedMarch === false), "no day of the journey is a forced march");
    await world.invoke("pass_time", { amount: 24, unit: "hours" });
    const long = await world.invoke("travel", { hours: 24, pace: "normal", characterIds: [fighter.id] });
    assert.notEqual(long.result.forcedMarch, false, "24 hours of marching is a forced march");
    const mixed = await world.invoke("travel", { days: 2, hours: 8, pace: "normal" });
    assert.equal(typeof mixed.error, "string", "days and hours together are refused");
  } finally {
    Math.random = random;
    world.patch(fighter.id, { exhaustion: 0, currentHp: world.sheet(fighter.id).maxHp });
  }
  assert.ok(Array.isArray(getClock(world.campaignId).marched), "the clock keeps the day's legs");
});

// Damage an object is immune to never adds up: twenty blows of poison drew
// twenty roll cards of nothing and "20 blows and it still stands" (PR 749 review).
await test("damage_object blows of a damage the object is immune to stop at the first, which says so", async () => {
  await kit.endFight();
  const out = await world.invoke("damage_object", { name: "the poisoned chest", material: "wood", size: "small", damage: "2d6", damageType: "poison", blows: 20 });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.blows?.length, 1, JSON.stringify(out.result).slice(0, 400));
  assert.match(String(out.result.note), /immune/);
});

// A night camped with pass_time, or a long rest the one-in-24-hours rule
// refused, closed no day: the next morning's 8 hours rolled four
// forced-march saves (PR 749 review). A stop of a night's length ends the day.
await test("Forced march: a night's stop between two legs ends the day, rested or not; back-to-back legs still share theirs", async () => {
  const { forcedMarchSpan } = await import("../src/lib/srd/travel.ts");
  assert.deepEqual(forcedMarchSpan([{ end: 480, minutes: 480, ids: ["a"] }], 480 + 12 * 60 + 480, 8), { from: 1, to: 0 }, "an 8-hour leg after a 12-hour stop");
  assert.deepEqual(forcedMarchSpan([{ end: 480, minutes: 480, ids: ["a"] }], 720, 4), { from: 1, to: 4 }, "four more hours straight after eight");
  assert.deepEqual(forcedMarchSpan([{ end: 480, minutes: 480, ids: ["a"] }], 480 + 2 * 60 + 480, 8).to, 8, "a two-hour halt is no night");
  await kit.endFight();
  await world.invoke("pass_time", { amount: 24, unit: "hours" });
  world.patch(fighter.id, { exhaustion: 0 });
  await world.invoke("travel", { hours: 8, pace: "normal", characterIds: [fighter.id] });
  await world.invoke("pass_time", { amount: 12, unit: "hours" });
  const morning = await world.invoke("travel", { hours: 8, pace: "normal", characterIds: [fighter.id] });
  world.patch(fighter.id, { exhaustion: 0 });
  assert.equal(morning.ok, true, morning.error);
  assert.equal(morning.result.forcedMarch, false, JSON.stringify(morning.result).slice(0, 400));
});

await test("Items: a chest of five and a shopping list of four, each one call, every item resolved; a name in other words resolves with srdName on the first call, English or Italian", async () => {
  world.patch(fighter.id, { gold: 200 });
  const ran = await agentTurn(fighter, "Brann empties the chest, then buys supplies.", [
    ["grant_item", { characterId: fighter.id, reason: "the chest", items: [{ item: "Torch", qty: 3 }, { item: "Backpack" }, { item: "Bedroll" }, { item: "silver dagger", srdName: "Dagger" }, { item: "Corda di canapa", srdName: "Rope, hempen (50 feet)" }] }],
    ["purchase", { characterId: fighter.id, action: "buy", reason: "supplies", items: [{ item: "Torch", qty: 2 }, { item: "Tinderbox" }, { item: "Waterskin" }, { item: "Razioni", srdName: "Rations (1 day)", qty: 3 }] }],
  ]);
  const [chest, shop] = ran;
  assert.equal(chest.result.items?.length, 5, JSON.stringify(chest.result).slice(0, 400));
  assert.deepEqual(errorsOf(chest.result.items), []);
  assert.equal(shop.result.items?.length, 4, JSON.stringify(shop.result).slice(0, 400));
  assert.deepEqual(errorsOf(shop.result.items), []);
  const carried = world.sheet(fighter.id).equipment.map((item) => item.name.toLowerCase());
  for (const name of ["backpack", "bedroll", "tinderbox", "waterskin"]) {
    assert.ok(carried.some((held) => held.includes(name)), `${name} was not added: ${carried.join(", ")}`);
  }
});

await test("Items: at a shop the call names, an item in other words is found on the shelf by srdName, its size left off when one row is so written; a list partly refused says which entries to send again", async () => {
  world.patch(fighter.id, { gold: 200 });
  const opened = await world.invoke("open_shop", { name: "Emporio", kind: "general", size: "town" });
  assert.equal(opened.ok, true, opened.error);
  // The shelf a random restock may leave the rope off (no pack, CI).
  const emporio = listShops(world.campaignId).find((shop) => shop.name === "Emporio");
  updateShop(emporio.id, { stock: [{ itemName: "Rope, hempen (50 feet)", qty: 2, priceCp: 110, note: "" }] });
  const ran = await agentTurn(fighter, "Brann buys rope at the Emporio.", [
    ["purchase", { characterId: fighter.id, action: "buy", shop: "Emporio", reason: "supplies", items: [{ item: "Corda di canapa", srdName: "Rope, hempen" }, { item: "Corno di unicorno", srdName: "Unicorn horn" }] }],
  ]);
  const [rope, horn] = ran[0].result.items ?? [];
  assert.equal(rope?.ok, true, JSON.stringify(ran[0].result).slice(0, 400));
  assert.match(String(horn?.error), /does not stock/);
  assert.match(String(ran[0].result.partial), /^Entry 2 of 2 refused; the others are done/);
});

await test("Fits the turn: Mass Healing Word over six allies, one heal call and one slot", async () => {
  await stage(cleric, 1);
  const allies = heroes.filter((hero) => hero !== cleric);
  allies.forEach((hero, index) => {
    kit.place(hero.id, 3 + index, 7);
    world.patch(hero.id, { currentHp: 1 });
  });
  const slot = () => world.sheet(cleric.id).spellcasting.slots[3].used;
  const before = slot();
  const ran = await agentTurn(cleric, "Odo calls out a Mass Healing Word over the whole party.", [
    ["heal", { casterId: cleric.id, spell: "Mass Healing Word", targets: allies.map((hero) => ({ characterId: hero.id })) }],
    ["end_turn", { characterId: cleric.id }],
  ]);
  const healed = ran[0].result;
  assert.equal(healed.targets?.length, 6, JSON.stringify(healed).slice(0, 400));
  assert.deepEqual(errorsOf(healed.targets), []);
  assert.equal(slot() - before, 1, "one 3rd-level slot for the six");
  assert.ok(allies.every((hero) => world.sheet(hero.id).currentHp > 1), "every ally was healed");
  assert.equal(typeof ran[1].result.error, "undefined");
  assert.ok(toolBearing() <= 3, `${toolBearing()} tool-bearing calls`);
});

await test("Mass Healing Word over six allies out of a fight is one casting too: one slot, and a seventh creature is refused before anything is spent", async () => {
  await kit.endFight();
  const allies = heroes.filter((hero) => hero !== cleric);
  for (const hero of heroes) world.patch(hero.id, { currentHp: 1 });
  world.patch(cleric.id, { spellcasting: { ...world.sheet(cleric.id).spellcasting, slots: { 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } } } });
  const slot = () => world.sheet(cleric.id).spellcasting.slots[3].used;
  const tooMany = await agentTurn(cleric, "Odo heals all seven of us.", [
    ["heal", { casterId: cleric.id, spell: "Mass Healing Word", targets: heroes.map((hero) => hero.id) }],
  ]);
  assert.match(String(tooMany[0].result.targets?.[0]?.error ?? tooMany[0].result.error), /reaches 6 creatures/, JSON.stringify(tooMany[0].result).slice(0, 300));
  assert.equal(slot(), 0, "nothing spent on a list one casting cannot reach");
  const ran = await agentTurn(cleric, "Odo calls out a Mass Healing Word over the party.", [
    ["heal", { casterId: cleric.id, spell: "Mass Healing Word", targets: allies.map((hero) => ({ characterId: hero.id })) }],
  ]);
  assert.deepEqual(errorsOf(ran[0].result.targets), [], JSON.stringify(ran[0].result).slice(0, 400));
  assert.equal(slot(), 1, "one 3rd-level slot for the six");
  assert.ok(allies.every((hero) => world.sheet(hero.id).currentHp > 1), "every ally was healed");
  const again = await agentTurn(cleric, "Odo heals himself too.", [["heal", { characterId: cleric.id, casterId: cleric.id, spell: "Mass Healing Word" }]]);
  assert.equal(typeof again[0].result.error, "undefined", JSON.stringify(again[0].result).slice(0, 300));
  assert.equal(slot(), 2, "a separate call is a casting of its own");
});

// With no casterId each entry's creature was its own caster: the cleric
// paid, and Brann, who casts nothing, rode the slot with a healing of 1d4
// and no modifier, where his own call was refused (PR 749 review).
await test("A heal list under a spell with no casterId is sent back before anything is spent", async () => {
  await kit.endFight();
  for (const hero of heroes) world.patch(hero.id, { currentHp: 1 });
  world.patch(cleric.id, { spellcasting: { ...world.sheet(cleric.id).spellcasting, slots: { 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } } } });
  const ran = await agentTurn(cleric, "Odo speaks a Mass Healing Word over himself and Brann.", [
    ["heal", { spell: "Mass Healing Word", targets: [{ characterId: cleric.id }, { characterId: fighter.id }] }],
  ]);
  assert.equal(ran[0].result.retry, true, JSON.stringify(ran[0].result).slice(0, 300));
  assert.match(String(ran[0].result.error), /casterId/);
  assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 0, "no slot spent");
  assert.equal(world.sheet(fighter.id).currentHp, 1, "nobody healed");
});

// heal's schema reads "30" as 30; the casting's pool counted it as none, and
// Mass Heal's second creature found nothing left of the 700 after the 9th
// level slot was spent (PR 749 review).
await test("Mass Heal's amounts sent as words share the 700 hit points of one casting", async () => {
  await kit.endFight();
  for (const hero of heroes) world.patch(hero.id, { currentHp: 1 });
  const casting = world.sheet(cleric.id).spellcasting;
  world.patch(cleric.id, { level: 17, spellcasting: { ...casting, prepared: [...new Set([...casting.prepared, "Mass Heal"])], slots: { ...casting.slots, 9: { max: 1, used: 0 } } } });
  const ran = await agentTurn(cleric, "Odo casts Mass Heal on Brann and Kara.", [
    ["heal", { casterId: cleric.id, spell: "Mass Heal", targets: [{ characterId: fighter.id, amount: "30" }, { characterId: monk.id, amount: "30" }] }],
  ]);
  world.patch(cleric.id, { level: 9, spellcasting: casting });
  assert.deepEqual(errorsOf(ran[0].result.targets), [], JSON.stringify(ran[0].result).slice(0, 400));
  assert.equal(world.sheet(fighter.id).currentHp, 31);
  assert.equal(world.sheet(monk.id).currentHp, 31);
});

await test("Hold Person from a 3rd-level slot on two creatures is one casting of its own, not a twin feature's", async () => {
  const enemies = await stage(cleric, 2);
  const slot = () => world.sheet(cleric.id).spellcasting.slots[3].used;
  const before = slot();
  const ran = await agentTurn(cleric, "Odo holds both goblins.", [
    ["cast_at_enemy", { characterId: cleric.id, spell: "Hold Person", level: 3, targets: enemies.map((foe) => ({ targetEnemyId: foe.id })) }],
  ]);
  const cast = ran[0].result;
  assert.equal(cast.targets?.length, 2, JSON.stringify(cast).slice(0, 400));
  assert.deepEqual(errorsOf(cast.targets), []);
  assert.equal(slot() - before, 1, "one 3rd-level slot for both");
});

// An entry naming no darts took "every dart left": the first of the
// creatures listed took all three, and the rest were refused (PR 749 review).
await test("Magic Missile listed over creatures with no darts named shares the casting's darts among them", async () => {
  const enemies = await stage(wizard, 2);
  const ran = await agentTurn(wizard, "Iris splits her darts between the two.", [
    ["cast_at_enemy", { characterId: wizard.id, spell: "Magic Missile", level: 1, targets: enemies.map((foe) => ({ targetEnemyId: foe.id })) }],
  ]);
  const cast = ran[0].result;
  assert.deepEqual(errorsOf(cast.targets), [], JSON.stringify(cast).slice(0, 400));
  assert.ok(world.enemies().every((foe) => foe.currentHp < 999), "both creatures took darts");
  const { spreadDarts } = await import("../src/lib/dm/action-parts-logic.ts");
  assert.deepEqual(spreadDarts([{ targetEnemyId: "a" }, { targetEnemyId: "b", darts: 1 }, { targetEnemyId: "c" }], 5).map((entry) => entry.darts), [2, 1, 2]);
  assert.deepEqual(spreadDarts([{ targetEnemyId: "a" }], 3), [{ targetEnemyId: "a" }], "a lone creature takes every dart, as before");
});

await test("A rider sent as the word false inside a part is false: no ki spent", async () => {
  const enemies = await stage(monk, 1, { ac: 1 });
  const ki = () => world.sheet(monk.id).resources.ki.used;
  const before = ki();
  const ran = await agentTurn(monk, "Kara strikes.", [["pc_attack", { characterId: monk.id, attacks: [part(enemies[0], { weapon: "unarmed strike", stunningStrike: "false" })] }]]);
  assert.equal(ran[0].result.error, undefined, JSON.stringify(ran[0].result).slice(0, 300));
  assert.equal(ki(), before, "Stunning Strike was spent");
  assert.ok(!kit.enemy(enemies[0].id).conditions.some((entry) => /stunned/i.test(entry)));
});

// The beat's steps ticked before the reply's calls ran (issue #31) stayed
// ticked when the call naming them was refused: a list whose Sun Blade was
// refused ticked "Recover the Sun Blade" with the blade nowhere on the sheet,
// and so did a lone grant_item refused (PR 749 review).
await test("Waypoints: a step named only by a refused item opens again; one the same reply's beat landed on stays", async () => {
  const { setStoryArc, getCampaignById } = await import("../src/lib/db/campaigns.ts");
  const { normalizeStoryArc } = await import("../src/lib/dm/arc-logic.ts");
  const { activeBeat } = await import("../src/lib/dm/waypoint-logic.ts");
  const arcWith = () =>
    setStoryArc(world.campaignId, normalizeStoryArc({ premise: "The sun returns.", beats: [
      { text: "Find what the tomb hides.", status: "active", act: 1, waypoints: [{ kind: "item", text: "Recover the Sun Blade" }, { kind: "item", text: "Take the iron key" }] },
      { text: "Go home.", status: "pending", act: 1 },
    ] }));
  const steps = () => activeBeat(getCampaignById(world.campaignId).storyArc)?.beat.waypoints.map((waypoint) => Boolean(waypoint.done));
  try {
    await kit.endFight();
    arcWith();
    const listed = await agentTurn(fighter, "Brann takes the torch and the blade.", [
      ["grant_item", { characterId: fighter.id, reason: "the tomb", items: [{ item: "Torch" }, { item: "Sun Blade", qty: 500 }] }],
    ]);
    assert.match(String(listed[0].result.partial), /^Entry 2 of 2 refused/);
    assert.deepEqual(steps(), [false, false], "the refused blade ticks nothing");
    const lone = await agentTurn(fighter, "Brann takes the blade.", [["grant_item", { characterId: fighter.id, reason: "the tomb", item: "Sun Blade", qty: 500 }]]);
    assert.equal(typeof lone[0].result.error, "string");
    assert.deepEqual(steps(), [false, false], "a lone refused grant ticks nothing either");
    const keyed = await agentTurn(fighter, "Brann takes the iron key.", [["grant_item", { characterId: fighter.id, reason: "the tomb", items: [{ item: "Iron key", tags: [] }] }]]);
    assert.deepEqual(errorsOf([keyed[0].result]), [], JSON.stringify(keyed[0].result).slice(0, 300));
    assert.deepEqual(steps(), [false, true], "a granted item still ticks its step");
  } finally {
    // No active beat for the tests after this one.
    setStoryArc(world.campaignId, normalizeStoryArc({ premise: "The sun returns.", beats: [{ text: "Find what the tomb hides.", status: "done", act: 1 }, { text: "Go home.", status: "done", act: 1 }] }));
  }
});

await test("Items: a chest of twelve is one change against the turn's cap, and the changes after it still run", async () => {
  const items = ["Torch", "Backpack", "Bedroll", "Tinderbox", "Waterskin", "Chalk", "Candle", "Blanket", "Lamp", "Mirror, steel", "Sack", "Crowbar"].map((item) => ({ item }));
  const ran = await agentTurn(fighter, "Brann empties the great chest.", [
    ["grant_item", { characterId: fighter.id, reason: "the great chest", items }],
    ["modify_gold", { characterId: fighter.id, delta: 5, reason: "the chest's purse" }],
  ]);
  assert.equal(ran[0].result.items?.length, 12, JSON.stringify(ran[0].result).slice(0, 400));
  assert.deepEqual(errorsOf(ran[0].result.items), []);
  assert.equal(ran[1].result.error, undefined, JSON.stringify(ran[1].result).slice(0, 300));
  assert.equal(getDmTurn(getLatestDmTurnId(world.campaignId)).mutationCount, 2);
});

model.close();
world.close();
finish();
