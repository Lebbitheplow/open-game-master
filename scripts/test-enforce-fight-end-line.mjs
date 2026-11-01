// Ending a fight posts one chronicle line, and names a hero still dying
// (issue 713). Battle panel > End encounter > End it showed the After the
// fight card and posted nothing: the chronicle never said the fight was
// over, and a dying hero's saves, which go on with game time once the
// order is gone, went on with nobody told.
//
// Every end is walked: the Battle panel's End it (the console's
// end_encounter, as the panel sends it), the AI's end_encounter, the last
// foe falling, its Force-end fallback, and a lost fight, which says so in
// its own words. Every die that matters is forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { setDmMode } = await import("../src/lib/db/campaigns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");

const { test, finish } = suite("test-enforce-fight-end-line");

const ALIVE = { successes: 0, failures: 0, stable: false, dead: false };
const OVER = /^The fight is over\./;

// Vesper and Tamsin against one dummy, the dummy's numbers its own.
// `dying` start at 0 hit points, neither stable nor dead. `human`: a person
// runs the story.
async function stage({ dying = ["Vesper"], human = true } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const heroes = new Map(["Vesper", "Tamsin"].map((name) => [name, world.addHero({ name, abilities: { dex: 10, con: 10, wis: 10 } })]));
  await kit.fight(1);
  if (human) {
    assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the GM's seat");
  }
  for (const name of dying) {
    world.patch(heroes.get(name).id, { currentHp: 0, deathSaves: { ...ALIVE } });
  }
  return { world, kit, hero: (name) => heroes.get(name), enemy: world.enemies()[0] };
}

// The lines posted since `from` messages ago.
const since = (world, from) => listRecentMessages(world.campaignId, 400).slice(from);
const count = (world) => listRecentMessages(world.campaignId, 400).length;
const overLines = (lines) => lines.filter((message) => OVER.test(message.content));

async function routeDelete(world, route) {
  world.signIn(world.owner);
  const handler = await world.route(route);
  const response = await handler.DELETE(new Request("http://test/", { method: "DELETE" }), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  return { status: response.status, body: await response.json() };
}

await test("The Battle panel's End it posts one line that the fight is over and that Vesper is still dying", async () => {
  const { world } = await stage();
  const before = count(world);
  // What the panel sends (EncounterPanel.tsx endFight), at the console.
  const ended = await world.invoke("end_encounter", {});
  assert.equal(ended.ok, true, ended.error);
  assert.equal(world.encounter(), null);
  const lines = overLines(since(world, before));
  assert.equal(lines.length, 1, "one line");
  assert.equal(lines[0].content, "The fight is over. Vesper is still dying: their death saves roll as time passes until they are stabilized.");
  assert.equal(lines[0].authorType, "system");
  assert.equal(lines[0].glyph, "cue-battle");
  // A second End it finds the fight already over and answers with how it
  // ended (handleEndEncounter), saying nothing more.
  const again = await world.invoke("end_encounter", {});
  assert.ok(!again.ok || again.result?.alreadyEnded, "no fight is left to end");
  assert.equal(overLines(since(world, before)).length, 1, "never twice for the same end");
});

await test("With nobody dying the line says only that the fight is over; two dying are named together", async () => {
  {
    const { world } = await stage({ dying: [] });
    const before = count(world);
    assert.equal((await world.invoke("end_encounter", {})).ok, true);
    assert.deepEqual(overLines(since(world, before)).map((line) => line.content), ["The fight is over."]);
  }
  {
    const { world, hero } = await stage({ dying: ["Vesper"] });
    // A third hero, dying too, beside a standing Tamsin.
    const cade = world.addHero({ name: "Cade" });
    world.patch(cade.id, { currentHp: 0, deathSaves: { ...ALIVE } });
    assert.ok(hero("Tamsin"));
    const before = count(world);
    assert.equal((await world.invoke("end_encounter", {})).ok, true);
    const [line] = overLines(since(world, before));
    assert.match(line?.content ?? "", /^The fight is over\. (Vesper and Cade|Cade and Vesper) are still dying: their death saves roll as time passes until they are stabilized\.$/);
  }
});

await test("The AI's end_encounter posts the same one line", async () => {
  const { world } = await stage({ human: false });
  const before = count(world);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_encounter", args: { outcome: "truce" } });
  assert.equal(ended.ok, true, ended.error);
  const lines = overLines(since(world, before));
  assert.equal(lines.length, 1);
  assert.match(lines[0].content, /Vesper is still dying/);
});

await test("The last foe falling ends the fight with the same one line", async () => {
  const { world, enemy } = await stage({ dying: [] });
  const before = count(world);
  const hit = await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 200, type: "slashing" });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(world.encounter(), null, "victory");
  assert.deepEqual(overLines(since(world, before)).map((line) => line.content), ["The fight is over."]);
});

await test("Force-end, the panel's way past an engine that will not end the fight, posts the line too", async () => {
  const { world } = await stage();
  const before = count(world);
  const out = await routeDelete(world, "campaigns/[campaignId]/encounter");
  assert.equal(out.status, 200, out.body.error);
  assert.equal(world.encounter(), null);
  const lines = overLines(since(world, before));
  assert.equal(lines.length, 1);
  assert.match(lines[0].content, /Vesper is still dying/);
});

await test("With nobody standing the saves are rolled out at once: the line comes first and promises no saves to come", async () => {
  const { world, hero } = await stage({ dying: ["Vesper", "Tamsin"] });
  const before = count(world);
  world.dice(...new Array(12).fill(15));
  assert.equal((await world.invoke("end_encounter", { outcome: "truce" })).ok, true);
  world.clearDice();
  const lines = since(world, before).map((message) => message.content);
  const over = lines.findIndex((line) => OVER.test(line));
  const save = lines.findIndex((line) => /death save/.test(line));
  assert.equal(lines[over], "The fight is over.", "both were rolled out, so neither is still dying");
  assert.ok(save > over, "the line, then the saves");
  assert.equal(world.sheet(hero("Vesper").id).deathSaves.stable, true);
});

await test("A lost fight says so in its own words, not also that it is over", async () => {
  const { world, hero, kit } = await stage({ dying: [] });
  world.patch(hero("Vesper").id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const before = count(world);
  const hit = await world.invoke("apply_damage", { characterId: hero("Tamsin").id, amount: 200 });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(world.encounter(), null, "the party fell");
  const lines = since(world, before).map((message) => message.content);
  assert.ok(lines.some((line) => /the fight is lost/.test(line)));
  assert.equal(lines.filter((line) => OVER.test(line)).length, 0);
  assert.ok(kit);
});

finish();
