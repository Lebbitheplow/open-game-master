// War God's Blessing is a Channel Divinity option taken as a reaction. use_reaction
// spent the reaction and left the use alone, so a War cleric could bless every
// round with no Channel Divinity left.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-war-gods-blessing");
const world = await openWorld({ campaign: { maxPlayers: 6 } });
const kit = await combatKit(world);
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const revertRoute = await world.route("campaigns/[campaignId]/audit/revert-turn");

const hero = (classId, subclass, level) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const cleric = hero("cleric", "War Domain", 6);
const ally = hero("fighter", "Champion", 5);

async function stage(used = 0) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [ally.id]: 19, [cleric.id]: 2 } });
  const [enemy] = world.enemies();
  kit.place(cleric.id, 5, 5);
  kit.place(ally.id, 4, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  const { resources } = world.sheet(cleric.id);
  world.patch(cleric.id, { resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used } } });
}
const used = () => world.sheet(cleric.id).resources.channel_divinity.used;
const reacted = () => world.encounter().reactionsUsed.includes(cleric.id);
const bless = () => world.invoke("use_reaction", { characterId: cleric.id, feature: "War God's Blessing", targetCharacterId: ally.id });

await test("It spends a Channel Divinity use and the reaction.", async () => {
  await stage();
  const out = await bless();
  assert.equal(out.ok, true, out.error);
  assert.equal(used(), 1);
  assert.equal(reacted(), true);
  const { max } = world.sheet(cleric.id).resources.channel_divinity;
  assert.equal(out.result.left, `${max - 1}/${max}`);
});

await test("With no use left it is refused, and the reaction stays.", async () => {
  const { max } = world.sheet(cleric.id).resources.channel_divinity;
  await stage(max);
  const out = await bless();
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules");
  assert.match(out.error, /no Channel Divinity left/);
  assert.equal(used(), max);
  assert.equal(reacted(), false);
});

await test("Reverting the turn gives back the use and the reaction.", async () => {
  await stage();
  const turnId = createDmTurn(world.campaignId, [], "ai").id;
  const out = await invokeEngine(world.campaign(), { kind: "ai", turnId }, { name: "use_reaction", args: { characterId: cleric.id, feature: "War God's Blessing", targetCharacterId: ally.id } });
  assert.equal(out.ok, true, out.error);
  assert.equal(used(), 1);
  world.signIn(world.owner);
  const response = await revertRoute.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 200);
  assert.equal(used(), 0);
  assert.equal(reacted(), false);
});

await test("An option that is no reaction is sent back to use_resource, and spends neither the use nor the reaction.", async () => {
  await stage();
  const out = await world.invoke("use_reaction", { characterId: cleric.id, feature: "Guided Strike" });
  assert.equal(out.ok, false);
  assert.equal(out.retry, true);
  assert.match(out.error, /Guided Strike is not a reaction: use_resource/);
  assert.equal(used(), 0);
  assert.equal(reacted(), false);
});

await test("A plain reaction on a sheet that holds Channel Divinity spends only the reaction.", async () => {
  await stage();
  world.patch(cleric.id, { features: [...world.sheet(cleric.id).features, { name: "Quick Parley", source: "class" }] });
  const out = await world.invoke("use_reaction", { characterId: cleric.id, feature: "Quick Parley" });
  assert.equal(out.ok, true, out.error);
  assert.equal(used(), 0);
  assert.equal(reacted(), true);
  assert.equal(out.result.left, undefined);
});

world.close();
finish();
