// The shared doors the wave-2 plumbing package put in, each held at the
// one place every writer goes through:
//   - an item whose charges are dice has them rolled as the row is granted
//     (src/lib/srd/item-charge-rules.ts withStartingCharges, called from the
//     sheet store's pack settle in src/lib/db/sheets.ts);
//   - a creature the GM keeps off the board provokes no opportunity attack
//     (SRD 5.1: "a hostile creature that you can see") and a line about one
//     names it "Someone unseen" (src/lib/dm/board-hidden.ts);
//   - a model call the server answered without its tools is kept for the
//     admin panel (src/lib/tool-call-health.ts);
//   - the GM's Deploy dialog asks Start a fight's own opening fields
//     (src/lib/dm/deploy-opening-logic.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-plumbing-doors");
const { withStartingCharges, chargeRuleOf } = await import("../src/lib/srd/item-charge-rules.ts");
const { noteToolCallHealth, toolCallHealth } = await import("../src/lib/tool-call-health.ts");

test("a row whose charges are dice is given a count; a fixed most and a counted row stay as they were", () => {
  const blade = { name: "Luck Blade", qty: 1 };
  assert.equal(typeof chargeRuleOf(blade)?.max, "string", "the Luck Blade's charges are dice (1d4 - 1)");
  assert.equal(withStartingCharges(blade, () => 2).charges, 2);
  assert.equal(withStartingCharges(blade, () => 9).charges, 3, "held to the most the dice can roll");
  assert.equal(withStartingCharges(blade, () => -1).charges, 0);
  assert.equal(withStartingCharges({ ...blade, charges: 1 }, () => 3).charges, 1, "a counted row keeps its count");
  const wand = { name: "Wand of Magic Missiles", qty: 1 };
  assert.equal(withStartingCharges(wand, () => 3).charges, undefined, "a fixed most is read as full");
});

test("the admin panel's tool health keeps the last call's word", () => {
  noteToolCallHealth(true);
  assert.equal(toolCallHealth()?.dropped, true);
  noteToolCallHealth(false);
  assert.equal(toolCallHealth()?.dropped, false);
});

test("the Deploy dialog asks Start a fight's own opening fields, and its body is what the deploy route reads", async () => {
  const { OPENING_FIELDS, openingBody } = await import("../src/lib/dm/deploy-opening-logic.ts");
  const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");
  const { openingOptionsSchema } = await import("../src/lib/dm/fight-opening.ts");
  const start = ADJUDICATIONS.find((entry) => entry.name === "start_encounter");
  const names = start.fields.map((field) => field.name);
  assert.deepEqual(OPENING_FIELDS.filter((name) => !names.includes(name)), [], "every question is a Start a fight field");
  const body = openingBody({ absent: ["c1"], ambush: "enemies", buildingEnemySide: "north", buildingOpenings: "2", lair: true, from: "behind" });
  assert.deepEqual(body, { absent: ["c1"], ambush: "enemies", building: { enemySide: "north", openings: 2 }, lair: true, from: "behind" });
  assert.equal(openingOptionsSchema.safeParse(body).success, true, "the deploy route takes the body");
  assert.deepEqual(openingBody({}), {}, "an empty form deploys the fight as prepared");
  // The form as it opens (DmActionFields.tsx initialValue): a blank select or
  // number is "", nobody away is [], an unticked box is false. Sent as they
  // were, the route refused the first Deploy for "ambush" in the browser.
  const untouched = { absent: [], ambush: "", surprised: "", scene: "", distanceFeet: "", buildingEnemySide: "", buildingOpenings: "", lair: false, from: "" };
  assert.deepEqual(openingBody(untouched), {}, "an untouched form deploys the fight as prepared");
  assert.equal(openingOptionsSchema.safeParse(openingBody(untouched)).success, true);
  const some = openingBody({ ...untouched, absent: ["c1"], distanceFeet: "60" });
  assert.deepEqual(some, { absent: ["c1"], distanceFeet: 60 }, "the distance typed is a number");
  assert.equal(openingOptionsSchema.safeParse(some).success, true, "the deploy route takes it");
});

const world = await openWorld({ campaign: { maxPlayers: 6 } });
const kit = await combatKit(world);
const maps = await import("../src/lib/db/battle-maps.ts");
const { listAllMessages } = await import("../src/lib/db/messages.ts");

await test("a Luck Blade granted to a character through grant_item carries its rolled charges", async () => {
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 44, proficiencies: TRAINED });
  world.dice(3);
  const given = await world.invoke("grant_item", { characterId: hero.id, item: "Luck Blade", reason: "the hoard" });
  world.clearDice();
  assert.equal(given.ok, true, given.error);
  const row = world.sheet(hero.id).equipment.find((item) => /luck blade/i.test(item.name));
  assert.ok(row, "the blade is in the pack");
  assert.equal(typeof row.charges, "number", "its charges were rolled as it was granted");
  assert.ok(row.charges >= 0 && row.charges <= 3);
});

await test("a creature kept off the board draws no opportunity attack as it walks off, and a line never names it", async () => {
  const fighter = world.addHero({ class: "fighter", level: 5, maxHp: 44, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  await kit.fight(1, { heroFaces: { [fighter.id]: 19 } });
  const [enemy] = world.enemies();
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  maps.setTokenHidden(kit.token(enemy.id).id, true);
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === enemy.id), turnBudget: null, reactionsUsed: [] });
  const before = listAllMessages(world.campaignId).length;
  world.dice(19, 6);
  const moved = await world.invoke("move_token", { token: enemy.id, x: 5, y: 10 });
  world.clearDice();
  assert.equal(moved.ok, true, moved.error);
  assert.ok(!moved.result?.opportunityAttacks?.length, `no opportunity attack on an unseen walker: ${JSON.stringify(moved.result?.opportunityAttacks)}`);
  assert.ok(!world.encounter().reactionsUsed.includes(fighter.id), "the fighter's reaction is kept");
  const lines = listAllMessages(world.campaignId).slice(before).map((message) => message.content).join("\n");
  assert.ok(!lines.includes(enemy.displayName), `no line names the hidden creature: ${lines}`);
});

world.close();
finish();
