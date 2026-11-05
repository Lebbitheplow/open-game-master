// Issue 685, gap 4: at a table a person runs, a spell card was posted as a
// sentence and waited in the GM's "Waiting on you" list, where nobody
// resolved it unless the GM entered it again by hand.
//
// - The GM's own card now reaches the engine for every kind a tool takes
//   whole (src/lib/dm/direct-card-logic.ts): a summon, a utility spell, a
//   lasting area laid on the board, a Self buff with nobody named, and an
//   attack with Divine Smite riding it. A card that still needs the GM's
//   word (a Fireball aimed at one goblin with no square) is queued as before.
// - A player's card waiting in the list is resolved as played from the
//   console (src/lib/dm/resolve-card.ts, the dm/resolve-card route): once,
//   by a GM seat only, with the engine's refusal shown when it refuses.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-resolve-as-played");

const { setDmMode, setFloor } = await import("../src/lib/db/campaigns.ts");
const { initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { getCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");
const { summonsOf } = await import("../src/lib/dm/summon-store.ts");

const world = await openWorld({ gameSettings: { multiCharacter: "all_active", ttsEnabled: false } });
const kit = await combatKit(world);

const SLOTS = () => ({ 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } });
const WIZARD_SPELLS = ["Web", "Unseen Servant", "Fog Cloud", "Detect Thoughts", "Blur", "Fireball"];

// The GM plays two heroes of their own: Vex, a wizard, and Dain, a paladin.
const vex = world.addHero({
  name: "Vex",
  class: "wizard",
  level: 5,
  maxHp: 30,
  abilities: { int: 17, dex: 14 },
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "int", slots: SLOTS(), known: [], prepared: WIZARD_SPELLS, cantrips: ["Fire Bolt"], spellbook: WIZARD_SPELLS },
});
const dain = world.addHero({
  user: world.owner,
  name: "Dain",
  class: "paladin",
  level: 5,
  maxHp: 44,
  abilities: { str: 16, cha: 14 },
  proficiencies: TRAINED,
  features: [{ name: "Divine Smite", source: "class" }],
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Bless"], cantrips: [] },
});
// A player at the table: Iris, a wizard of their own.
const iris = world.addHero({
  name: "Iris",
  class: "wizard",
  level: 5,
  maxHp: 27,
  abilities: { int: 16 },
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "int", slots: SLOTS(), known: [], prepared: ["Web"], cantrips: [], spellbook: ["Web"] },
});
const player = { id: iris.userId };
setDmMode(world.campaignId, "human", world.owner.id);

async function call(method, name, { body, query = "" } = {}, user = world.owner) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const url = `http://odm.test/${name}${query ? `?${query}` : ""}`;
  const request = method === "GET" ? new Request(url) : new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const response = await handler[method](request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, body: await response.json() };
}
const act = (body, user = world.owner) => call("POST", "actions", { body: { kind: "do", ...body } }, user);
const resolvable = (ids, user = world.owner) => call("GET", "dm/resolve-card", { query: ids.map((id) => `id=${id}`).join("&") }, user);
const resolve = (messageId, user = world.owner) => call("POST", "dm/resolve-card", { body: { messageId } }, user);

const used = (id, level) => world.sheet(id).spellcasting.slots[level].used;
const zones = () => kit.map().spellZones.map((zone) => zone.spell);
const waiting = () => queuedIntents(listRecentMessages(world.campaignId, 40), []).map((row) => row.messageId);

await kit.fight(2);
const [goblin] = world.enemies();
kit.setEnemy(goblin.id, { maxHp: 200, currentHp: 200 });

// Each card on a fresh turn of its caster's, holding nothing else; the
// floor follows the pointer, so the caster's player may act.
function turnOf(sheet) {
  kit.giveTurn(sheet.id);
  kit.freshTurn();
  setFloor(world.campaignId, initiativeFloorFor(world.campaignId));
  world.patch(sheet.id, { concentratingOn: null });
}

// ---- the GM's own card, resolved at once ----

await test("The GM's own summon card resolves at once: the Unseen Servant comes in and the slot is spent", async () => {
  turnOf(vex);
  const out = await act({ content: "I cast Unseen Servant using a level 1 slot.", characterId: vex.id, intent: { card: "spell", spell: "Unseen Servant", slotLevel: 1 } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.resolved, true);
  assert.equal(summonsOf(world.campaignId, vex.id, "Unseen Servant").length, 1, "the servant is at the table");
  assert.equal(used(vex.id, 1), 1, "the slot was spent");
});

await test("The GM's own utility spell card resolves at once: the slot is spent and its concentration begins", async () => {
  turnOf(vex);
  const out = await act({ content: "I cast Detect Thoughts using a level 2 slot.", characterId: vex.id, intent: { card: "spell", spell: "Detect Thoughts", slotLevel: 2 } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.resolved, true);
  assert.equal(used(vex.id, 2), 1);
  assert.equal(world.sheet(vex.id).concentratingOn, "Detect Thoughts");
});

await test("The GM's own Web laid on a square resolves at once: the web is on the board and the slot is spent", async () => {
  turnOf(vex);
  kit.place(vex.id, 2, 5);
  const before = used(vex.id, 2);
  const out = await act({ content: "I cast Web on (9,5) using a level 2 slot.", characterId: vex.id, intent: { card: "spell", spell: "Web", slotLevel: 2, atX: 9, atY: 5 } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.resolved, true);
  assert.ok(zones().includes("Web"), `the web is laid: ${JSON.stringify(zones())}`);
  assert.equal(used(vex.id, 2), before + 1);
});

await test("The GM's own Fog Cloud laid on a square resolves at once through the slot, which lays the cloud", async () => {
  turnOf(vex);
  const before = used(vex.id, 1);
  const out = await act({ content: "I cast Fog Cloud on (12,8) using a level 1 slot.", characterId: vex.id, intent: { card: "spell", spell: "Fog Cloud", slotLevel: 1, atX: 12, atY: 8 } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.resolved, true);
  assert.ok(zones().includes("Fog Cloud"), JSON.stringify(zones()));
  assert.equal(used(vex.id, 1), before + 1);
});

await test("The GM's own Self buff card with nobody named lands on its caster", async () => {
  turnOf(vex);
  const out = await act({ content: "I cast Blur using a level 2 slot.", characterId: vex.id, intent: { card: "spell", spell: "Blur", slotLevel: 2 } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.resolved, true);
  assert.ok(world.sheet(vex.id).conditions.some((condition) => /blur/i.test(condition)), JSON.stringify(world.sheet(vex.id).conditions));
});

await test("The GM's own attack with Divine Smite riding it resolves at once: on a hit the slot is spent", async () => {
  turnOf(dain);
  kit.place(dain.id, 5, 5);
  kit.place(goblin.id, 6, 5);
  const hp = kit.enemy(goblin.id).currentHp;
  kit.dice(18);
  const out = await act({
    content: "I attack Goblin 1 with my Longsword. If it hits, I use Divine Smite with a level 1 slot.",
    characterId: dain.id,
    intent: { card: "attack", weapon: "Longsword", targetKind: "enemy", targetId: goblin.id, targetName: goblin.displayName, riders: ["Divine Smite"], attack: { smite: 1 } },
  });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.resolved, true);
  assert.equal(used(dain.id, 1), 1, "the smite spent its slot");
  assert.ok(kit.enemy(goblin.id).currentHp < hp, "the blow landed");
});

await test("A card that still needs the GM's word is queued as before, and offers no Resolve as played", async () => {
  turnOf(vex);
  const out = await act({ content: "I cast Fireball at Goblin 1 using a level 3 slot.", characterId: vex.id, intent: { card: "spell", spell: "Fireball", slotLevel: 3, targetKind: "enemy", targetId: goblin.id, targetName: goblin.displayName } });
  assert.equal(out.status, 202, JSON.stringify(out.body));
  assert.ok(waiting().includes(out.body.messageId), "it waits for the GM");
  assert.equal(used(vex.id, 3), 0, "nothing was cast");
  const asked = await resolvable([out.body.messageId]);
  assert.deepEqual(asked.body.resolvable, [], "the engine cannot take it whole");
  const pressed = await resolve(out.body.messageId);
  assert.equal(pressed.status, 409);
  assert.match(pressed.body.error, /needs your ruling/);
});

// ---- a player's card, resolved as played from the waiting list ----

let webCard = "";

await test("A player's Web card waits in the list, and the list offers Resolve as played on it to the GM alone", async () => {
  turnOf(iris);
  kit.place(iris.id, 3, 9);
  const out = await act({ content: "I cast Web on (14,4) using a level 2 slot.", characterId: iris.id, intent: { card: "spell", spell: "Web", slotLevel: 2, atX: 14, atY: 4 } }, player);
  assert.equal(out.status, 202, JSON.stringify(out.body));
  webCard = out.body.messageId;
  assert.ok(waiting().includes(webCard));
  assert.equal(used(iris.id, 2), 0, "a player's card waits for the GM");
  const typed = await act({ content: "I mutter under my breath." }, player);
  assert.equal(typed.status, 202);
  const asked = await resolvable([webCard, typed.body.messageId]);
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.deepEqual(asked.body.resolvable, [webCard], "the typed line has no card to resolve");
  assert.equal((await resolvable([webCard], player)).status, 403, "a player is not asked");
});

await test("A player cannot resolve a card from the waiting list", async () => {
  const pressed = await resolve(webCard, player);
  assert.equal(pressed.status, 403);
  assert.equal(getCampaignMessage(webCard).cardResolvedAt, undefined);
});

await test("Resolve as played casts the card as the player played it, once: the web is laid, the slot spent, and the row is answered", async () => {
  const webs = zones().filter((spell) => spell === "Web").length;
  const pressed = await resolve(webCard);
  assert.equal(pressed.status, 200, JSON.stringify(pressed.body));
  assert.equal(pressed.body.resolved, true);
  assert.equal(used(iris.id, 2), 1, "Iris's slot, not the GM's hero's");
  assert.equal(zones().filter((spell) => spell === "Web").length, webs + 1, "Iris's web is on the board");
  assert.ok(getCampaignMessage(webCard).cardResolvedAt, "the card is answered");
  assert.ok(!waiting().includes(webCard), "it leaves the waiting list");
  const again = await resolve(webCard);
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already been resolved/);
  assert.equal(used(iris.id, 2), 1, "the second press cast nothing");
});

await test("A card the engine refuses when resolved shows the engine's refusal and keeps waiting", async () => {
  turnOf(iris);
  const out = await act({ content: "I cast Web on (14,9) using a level 2 slot.", characterId: iris.id, intent: { card: "spell", spell: "Web", slotLevel: 2, atX: 14, atY: 9 } }, player);
  assert.equal(out.status, 202, JSON.stringify(out.body));
  const spent = world.sheet(iris.id).spellcasting;
  world.patch(iris.id, { spellcasting: { ...spent, slots: { ...spent.slots, 2: { max: 3, used: 3 }, 3: { max: 2, used: 2 } } } });
  const refused = await resolve(out.body.messageId);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.error, /slot/i);
  assert.equal(getCampaignMessage(out.body.messageId).cardResolvedAt, undefined, "nothing happened, so it is not answered");
  assert.ok(waiting().includes(out.body.messageId));
  world.patch(iris.id, { spellcasting: { ...spent, slots: { ...spent.slots, 2: { max: 3, used: 1 } } } });
  const pressed = await resolve(out.body.messageId);
  assert.equal(pressed.status, 200, JSON.stringify(pressed.body));
});

await kit.endFight();
world.close();
await finish();
