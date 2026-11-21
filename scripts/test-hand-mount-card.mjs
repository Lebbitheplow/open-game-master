// The Hand's Mount card.
//
// "Once during your move, you can mount a creature that is within 5 feet of
// you or dismount" (SRD 5.1, Mounting and Dismounting). Dismount had a card
// and mounting had none: a rider thrown from the saddle typed their way back
// on and waited for the GM's model to call mount_up. The card is dealt only
// where it can be played (src/lib/battlemap/hand-mount-logic.ts): beside a
// creature this character called up that can carry them, or with a drake
// Bond of Fang and Scale lets them ride. Its play is mount_up's own call,
// made by the engine with no model in between.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { OPEN, place, tokenOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-hand-mount-card");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { getMounts } = await import("../src/lib/db/mounts.ts");
const { mountableSteeds } = await import("../src/lib/battlemap/hand-mount-logic.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { composeSentence, intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const { directCardCall, intentTools, messageIntentSchema } = await import("../src/lib/dm/intent-logic.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");

const byId = (cards, id) => cards.find((card) => card.id === id);

// The least of a sheet the rule reads.
const rider = (over = {}) => ({ id: "r1", race: "Human", pets: [], features: [], feats: [], ...over });
const called = (over = {}, summon = {}) => ({
  id: "c1",
  name: "Warhorse",
  currentHp: 19,
  deathSaves: undefined,
  summon: { casterId: "r1", form: "Warhorse", size: "Large", ...summon },
  ...over,
});
const names = (steeds) => steeds.map((steed) => steed.name);

await test("the card offers a creature the rider called up that stands within 5 feet and can carry them", () => {
  assert.deepEqual(names(mountableSteeds(rider(), [called()], { c1: 5 })), ["Warhorse"]);
  assert.deepEqual(names(mountableSteeds(rider(), [called()], { c1: 10 })), [], "10 feet off is out of reach");
  assert.deepEqual(names(mountableSteeds(rider(), [called()])), ["Warhorse"], "off the board nothing is measured, as mount_up measures nothing");
});

await test("it offers nobody else's creature, none that is down, and none its maker lost", () => {
  assert.deepEqual(mountableSteeds(rider(), [called({}, { casterId: "someone-else" })], { c1: 5 }), []);
  assert.deepEqual(mountableSteeds(rider(), [called({ currentHp: 0 })], { c1: 5 }), []);
  assert.deepEqual(mountableSteeds(rider(), [called({ deathSaves: { dead: true } })], { c1: 5 }), []);
  assert.deepEqual(mountableSteeds(rider(), [called({}, { unbound: true })], { c1: 5 }), []);
  assert.deepEqual(mountableSteeds(rider(), [{ id: "p2", name: "Mira", currentHp: 20 }], { p2: 5 }), [], "an ally is not a mount");
});

await test("a mount is one size larger than its rider: a wolf carries a halfling and not a human", () => {
  const wolf = called({ name: "Wolf" }, { form: "Wolf", size: "Medium" });
  assert.deepEqual(mountableSteeds(rider(), [wolf], { c1: 5 }), []);
  assert.deepEqual(names(mountableSteeds(rider({ race: "Lightfoot Halfling" }), [wolf], { c1: 5 })), ["Wolf"]);
});

await test("two creatures of one name are offered by neither, since mount_up finds neither by it", () => {
  const pair = [called({ id: "c1", name: "Elk" }), called({ id: "c2", name: "Elk" }), called({ id: "c3", name: "Elk 2" })];
  assert.deepEqual(names(mountableSteeds(rider(), pair, { c1: 5, c2: 5, c3: 5 })), ["Elk 2"]);
});

await test("a drake is offered to the ranger Bond of Fang and Scale lets ride it, while it stands", () => {
  const drake = { name: "Ember", kind: "drake", hp: 20 };
  const bonded = rider({ pets: [drake], features: [{ name: "Bond of Fang and Scale" }] });
  assert.deepEqual(names(mountableSteeds(bonded, [])), ["Ember"]);
  assert.deepEqual(mountableSteeds(rider({ pets: [drake] }), []), [], "before 7th level it carries no one");
  assert.deepEqual(mountableSteeds({ ...bonded, pets: [{ ...drake, hp: 0 }] }, []), []);
  assert.deepEqual(mountableSteeds({ ...bonded, pets: [{ name: "Owl", kind: "familiar", hp: 1 }] }, []), []);
});

// A paladin and the warhorse Find Steed made, side by side in a fight on an
// open board, the paladin's turn.
async function table() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const paladin = world.addHero(caster("paladin", "cha", ["Find Steed"], [], 5, { speed: 30 }));
  const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(cast.ok, true, cast.error);
  const steed = world.sheets().find((sheet) => sheet.summon?.spell === "Find Steed");
  const [enemy] = await fightDummies(world, 1, { heroFaces: { [paladin.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [paladin.id]: { x: 3, y: 3 }, [steed.id]: { x: 4, y: 3 }, [enemy.id]: { x: 20, y: 8 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(paladin.id), entry(steed.id), entry(enemy.id)], turnIndex: 0, turnBudget: null });
  return { world, paladin, steed };
}

const handOf = (world, id, gear) => deriveHand(world.sheet(id), FRESH_TURN, { gear });

await test("the Hand deals Mount beside the steed, names it on the card, and says the move in a plain sentence", async () => {
  const { world, paladin, steed } = await table();
  const steeds = mountableSteeds(world.sheet(paladin.id), world.sheets(), { [steed.id]: 5 });
  assert.deepEqual(names(steeds), [steed.name]);
  const card = byId(handOf(world, paladin.id, { steeds }), "basic:mount");
  assert.ok(card, "the card is dealt");
  assert.equal(card.cost, "free");
  assert.equal(card.disabled, null);
  assert.match(card.rules, new RegExp(`Onto ${steed.name}`));
  assert.equal(card.choice, undefined, "one creature asks nothing");
  assert.equal(composeSentence(card, null), `I mount ${steed.name}.`);
  assert.equal(intentBody(card, null).mount, steed.name);
});

await test("no Mount card with nothing to mount, and none for a rider already up, who is dealt Dismount", async () => {
  const { world, paladin, steed } = await table();
  assert.equal(byId(handOf(world, paladin.id, { steeds: [] }), "basic:mount"), undefined);
  assert.equal(byId(handOf(world, paladin.id, {}), "basic:mount"), undefined, "a host that sends no steeds");
  const up = handOf(world, paladin.id, { steeds: [{ name: steed.name }], mount: steed.name });
  assert.equal(byId(up, "basic:mount"), undefined);
  assert.ok(byId(up, "basic:dismount"));
});

await test("with two creatures beside them the card asks which, and sends the one picked", async () => {
  const { world, paladin } = await table();
  const card = byId(handOf(world, paladin.id, { steeds: [{ name: "Warhorse" }, { name: "Elk" }] }), "basic:mount");
  assert.deepEqual(card.choice.options.map((option) => option.value), ["Warhorse", "Elk"]);
  assert.equal(card.choice.arg, "mount");
  assert.equal(composeSentence(card, null, [], { choice: "Elk" }), "I mount Elk.");
  assert.equal(intentBody(card, null, [], { choice: "Elk" }).mount, "Elk");
});

await test("the server reads the card: it parses, names mount_up, and the engine makes that call itself", () => {
  const parsed = messageIntentSchema.parse({ card: "basic", action: "mount", mount: "Warhorse" });
  assert.deepEqual(intentTools(parsed), ["mount_up"]);
  assert.deepEqual(directCardCall(parsed, "r1", { inFight: true }), { name: "mount_up", args: { characterId: "r1", mount: "Warhorse" } });
  assert.equal(directCardCall(messageIntentSchema.parse({ card: "basic", action: "mount" }), "r1", { inFight: true }), null, "with no creature named the GM hears the sentence");
  assert.equal(SERVER_FEATURES.mountCard, true, "the Hand deals the card only on a host that says it reads it");
});

await test("playing the card puts the rider on the steed for half their speed, once a move", async () => {
  const { world, paladin, steed } = await table();
  const card = byId(handOf(world, paladin.id, { steeds: mountableSteeds(world.sheet(paladin.id), world.sheets(), { [steed.id]: 5 }) }), "basic:mount");
  const call = directCardCall(messageIntentSchema.parse(intentBody(card, null)), paladin.id, { inFight: true });
  const out = await world.invoke(call.name, call.args);
  assert.equal(out.ok, true, out.error);
  assert.equal(getMounts(world.campaignId)[paladin.id]?.sheetId, steed.id, "the steed itself, not a second horse of its name");
  assert.equal(tokenOf(world, paladin.id).movedThisRound, 3, "half of a 30-foot speed, off this turn's movement");
  const again = await world.invoke("dismount", { characterId: paladin.id });
  assert.equal(again.refused, "rules", again.error ?? "a second mounting or dismounting in one move went through");
});

await test("the card and the engine agree on reach: a steed 30 feet off is not offered, and mount_up refuses it", async () => {
  const { world, paladin, steed } = await table();
  place(world, steed.id, 9, 3);
  assert.deepEqual(mountableSteeds(world.sheet(paladin.id), world.sheets(), { [steed.id]: 30 }), []);
  const out = await world.invoke("mount_up", { characterId: paladin.id, mount: steed.name });
  assert.equal(out.refused, "rules", out.error ?? "it mounted");
});

finish();
