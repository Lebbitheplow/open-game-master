// A question sways no one, so it is never rolled to (src/lib/dm/player-word.ts
// swayUnasked). The 0.34.1 report: a player asked a companion something and
// the AI rolled Persuasion against a DC for an attempt they never made, with
// the dice already thrown before they could say what they meant. SRD 5.1,
// Ability Checks: the GM calls for a check when a character tries something
// whose outcome is in doubt. For the AI DM, a roll to sway someone
// (social_check, or request_roll for Persuasion, Deception or Intimidation)
// is refused while every line the character's player wrote since the DM last
// spoke only asks, and the refusal rolls and spends nothing. What stays as it
// was: once the player presses the roll resolves, a player who said nothing
// is not this (the scene may force a check), another player's question is
// not this character's, a check that reads the question (Insight) still
// rolls, the person at the console keeps a free hand, and a companion the AI
// plays is the AI's to roll for.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { aiEngine } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-question-no-roll");
const world = await openWorld({ campaign: { maxPlayers: 20 }, gameSettings: { ttsEnabled: false } });
const ai = await aiEngine(world);
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");

const kara = world.addHero({ name: "Kara", abilities: { cha: 16, wis: 14 } });
const brom = world.addHero({ name: "Brom", abilities: { cha: 12 } });
const added = await world.invoke("add_companion", { name: "Corin", class: "fighter", gender: "Male", personality: "Quiet, watchful.", kind: "party" });
assert.equal(added.ok, true, added.error);
const corin = world.sheets().find((sheet) => sheet.name === "Corin");
await world.invoke("set_npc", { name: "Tamsin", gender: "Female" });

const REFUSAL = (name) =>
  `${name}'s player only asked a question, and a question sways no one, so nothing was rolled. Answer it in character, as the one asked feels about the party, and do not narrate a check. If the player then presses, argues or bargains, that attempt is the roll.`;

const rolls = () => listRecentRolls(world.campaignId, 500).length;
// The engine's answer: a refusal's words, or the result it resolved to.
const refusal = (out) => (out.ok === false ? out.error : `resolved: ${JSON.stringify(out.result).slice(0, 200)}`);
const resolved = (out) => {
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result?.error, undefined, out.result?.error);
  return out.result;
};

// The DM has just spoken; then `lines` from `who`, in order.
function scene(lines = [], who = kara) {
  world.say("dm", "The road forks at a split oak. Corin waits beside you.");
  for (const line of lines) {
    world.say("player", line, who);
  }
  ai.fresh();
}

const persuade = (npc = "Corin", sheet = kara) => ai.invoke("social_check", { characterId: sheet.id, npc, approach: "persuade" });
const skill = (name, sheet = kara) => ai.invoke("request_roll", { characterId: sheet.id, kind: "skill_check", skill: name, difficulty: "moderate" });

// ---- the report ----

for (const line of [
  "Corin, do you know this road?",
  '"Do you know this road?" I ask Corin.',
  'I ask Corin, "Have you been this way before?"',
  "I ask Corin what he thinks of the left fork.",
]) {
  await test(`social_check and a Persuasion, Deception or Intimidation request_roll are refused after only a question, rolling nothing: ${line}`, async () => {
    scene([line]);
    const before = rolls();
    assert.equal(refusal(await persuade()), REFUSAL("Kara"));
    for (const name of ["persuasion", "Deception", "intimidation"]) {
      assert.equal(refusal(await skill(name)), REFUSAL("Kara"), name);
    }
    assert.equal(rolls(), before, "a refusal rolled dice");
  });
}

await test("Every line since the DM spoke must only ask: two questions are still refused, a question then a push resolves.", async () => {
  scene(["Do you know this road?", "Is it safe at night?"]);
  assert.equal(refusal(await persuade()), REFUSAL("Kara"));
  scene(["Do you know this road, Tamsin?", "Come on, you owe me one. Lead the way."]);
  world.dice(14);
  const out = await persuade("Tamsin");
  world.clearDice();
  resolved(out);
});

await test("Once the DM has answered, the player's push is the attempt, and it rolls.", async () => {
  scene(["Corin, do you know this road?"]);
  assert.equal(refusal(await persuade()), REFUSAL("Kara"));
  scene(["I tell Tamsin we need her help, and that the village will remember it."]);
  world.dice(14);
  const out = await persuade("Tamsin");
  world.clearDice();
  resolved(out);
  world.dice(14);
  const rolled = await skill("persuasion");
  world.clearDice();
  assert.equal(typeof resolved(rolled).total, "number");
});

await test("A question in another language is a question too.", async () => {
  scene(["¿Conoces este camino, Corin?"]);
  assert.equal(refusal(await persuade()), REFUSAL("Kara"));
});

// ---- what stays as it was ----

await test("A player who said nothing is not this: the scene may force a check.", async () => {
  scene([]);
  world.dice(12);
  const out = await persuade("Tamsin");
  world.clearDice();
  resolved(out);
});

await test("Another player's question is not this character's: Brom asked, Kara's Persuasion rolls.", async () => {
  scene(["Corin, do you know this road?"], brom);
  assert.equal(refusal(await persuade("Corin", brom)), REFUSAL("Brom"));
  world.dice(12);
  const out = await persuade("Tamsin", kara);
  world.clearDice();
  resolved(out);
});

await test("A check that reads the question still rolls: Insight after only a question.", async () => {
  scene(["Is Tamsin lying to us?"]);
  world.dice(12);
  const out = await skill("insight");
  world.clearDice();
  assert.equal(typeof resolved(out).total, "number");
});

await test("The person at the console keeps a free hand.", async () => {
  scene(["Corin, do you know this road?"]);
  world.dice(12);
  const out = await world.invoke("social_check", { characterId: kara.id, npc: "Tamsin", approach: "persuade" });
  world.clearDice();
  resolved(out);
});

await test("A companion the AI plays is the AI's to roll for.", async () => {
  scene(["Corin, do you know this road?"], corin);
  world.dice(12);
  const out = await skill("persuasion", corin);
  world.clearDice();
  assert.equal(typeof resolved(out).total, "number");
});

finish();
