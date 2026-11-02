// Issue 685: the Hand had no creature picker for a summoning spell with
// several forms. A Conjure Animals card carried no creature, so the engine
// could not cast it (direct-card-logic.ts summonCall): at a table a person
// runs it waited in the GM's "Waiting on you" list with no "Resolve as
// played", and an AI GM picked the beasts itself.
//
// The card now asks which creature from the server's own catalogue (the
// stat blocks summonPlan spawns: src/lib/srd/summon-spells.ts
// summonCatalogue, GET /api/campaigns/[id]/summons) and how many where the
// spell lets its caster choose (src/lib/battlemap/hand-summon.ts), and sends
// them as cast_buff's variant and count: the engine casts it whole at an AI
// table (the model is told what was picked), the GM's own card resolves at
// once, a player's waits with "Resolve as played", and a creature or a
// number the slot cannot bring is refused before the card is posted.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-summon-picker");

const { SUMMON_SPELLS, summonCatalogue, summonCounts, summonPlan, summonSpellFor } = await import("../src/lib/srd/summon-spells.ts");
const { summonPick, summonCount } = await import("../src/lib/battlemap/hand-summon.ts");
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { composeSentence, handReady, intentBody, previewRows } = await import("../src/lib/battlemap/hand-play.ts");
const { describeIntent, directCardCall, parseMessageIntent } = await import("../src/lib/dm/intent-logic.ts");
const { setDmMode, setFloor } = await import("../src/lib/db/campaigns.ts");
const { initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");
const { summonsOf } = await import("../src/lib/dm/summon-store.ts");

const conjure = summonSpellFor("Conjure Animals");
const insects = summonSpellFor("Giant Insect");
const objects = summonSpellFor("Animate Objects");
const form = (name) => summonCatalogue(summonSpellFor("Conjure Animals")).forms.find((entry) => entry.name === name);

// ---- the catalogue and the engine agree ----

await test("The numbers a creature may come in are the options the spell prints, and the most is what the engine brings", () => {
  const wolf = { name: "Wolf", type: "beast", cr: 0.25 };
  assert.deepEqual(summonCounts(conjure, 3, wolf), [1, 2, 4, 8], "one of CR 2, two of CR 1, four of CR 1/2, eight of CR 1/4");
  assert.deepEqual(summonCounts(conjure, 3, { name: "Brown Bear", type: "beast", cr: 1 }), [1, 2]);
  assert.deepEqual(summonCounts(conjure, 3, { name: "Giant Elk", type: "beast", cr: 2 }), [1]);
  assert.deepEqual(summonCounts(conjure, 5, wolf), [2, 4, 8, 16], "twice as many from a 5th level slot");
  assert.deepEqual(summonCounts(conjure, 3, { name: "Dryad", type: "fey", cr: 1 }), [], "a fey is no beast");
  assert.deepEqual(summonCounts(insects, 4, { name: "Giant Spider", type: "beast", cr: 1 }), [1, 2, 3], "up to three spiders");
  assert.deepEqual(summonCounts(objects, 6, { name: "Animated Object (Large)", type: "construct", cr: 2 }), [1, 2, 3], "twelve objects' worth, a Large counting four");
  assert.deepEqual(summonCounts(summonSpellFor("Create Undead"), 6, { name: "Ghast", type: "undead", cr: 2 }), [], "no ghasts below 8th level");
  assert.deepEqual(summonCounts(summonSpellFor("Create Undead"), 8, { name: "Ghast", type: "undead", cr: 2 }), [1, 2]);
  assert.deepEqual(summonCounts(summonSpellFor("Conjure Elemental"), 5, { name: "Fire Elemental", type: "elemental", cr: 5 }), [1]);
});

await test("A number the spell does not offer is refused with the ones it does, never brought as asked nor cut to the most", () => {
  const three = summonPlan(conjure, 3, "Wolf", 3);
  assert.equal(three.retry, true, JSON.stringify(three));
  assert.match(three.error ?? "", /Conjure Animals from a level 3 slot brings 1, 2, 4 or 8 of that creature \(Wolf\), not 3\. .*Nothing was spent/);
  assert.match(summonPlan(conjure, 5, "Wolf", 7).error ?? "", /brings 2, 4, 8 or 16 of that creature \(Wolf\), not 7/);
  assert.match(summonPlan(conjure, 3, "Brown Bear", 8).error ?? "", /brings 1 or 2 of that creature \(Brown Bear\), not 8/);
  assert.match(summonPlan(insects, 4, "Giant Centipede", 12).error ?? "", /brings 1 to 10 of that creature \(Giant Centipede\), not 12/);
  assert.equal(summonPlan(conjure, 3, "Wolf", 4).count, 4, "an option the spell prints");
  assert.equal(summonPlan(insects, 4, "Giant Centipede", 7).count, 7, "up to ten");
});

await test("Every creature the catalogue offers, at every slot it offers it, is one summonPlan casts, and as many as the catalogue's most", () => {
  for (const spell of SUMMON_SPELLS) {
    const catalogue = summonCatalogue(spell);
    assert.ok(catalogue.forms.length > 0, `${spell.name} offers creatures`);
    for (const entry of catalogue.forms) {
      for (const [slot, counts] of Object.entries(entry.counts)) {
        const plan = summonPlan(spell, Number(slot), entry.name);
        assert.ok(!("error" in plan), `${spell.name} at ${slot}: ${entry.name}: ${plan.error}`);
        assert.equal(plan.count, counts.at(-1), `${spell.name} at ${slot}: ${entry.name}`);
        assert.equal(summonPlan(spell, Number(slot), entry.name, counts[0]).count, counts[0]);
      }
    }
  }
  const beasts = summonCatalogue(conjure);
  assert.equal(beasts.calls, "rating");
  assert.ok(beasts.forms.every((entry) => entry.type === "beast" && entry.cr <= 2));
  assert.ok(beasts.forms.some((entry) => entry.name === "Wolf"));
  assert.deepEqual([...beasts.forms.map((entry) => entry.cr)], [...beasts.forms.map((entry) => entry.cr)].sort((a, b) => b - a), "strongest first");
  assert.deepEqual(summonCatalogue(insects).forms.map((entry) => entry.name), insects.forms, "named forms keep the spell's order");
});

// ---- the card ----

const world = await openWorld({ gameSettings: { ttsEnabled: false, multiCharacter: "all_active" } });
const kit = await combatKit(world);
const SLOTS = () => ({ 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 1, used: 0 } });
const DRUID = (name, user) => ({
  ...(user ? { user } : {}),
  name,
  class: "druid",
  level: 7,
  maxHp: 40,
  abilities: { wis: 16 },
  spellcasting: { ability: "wis", slots: SLOTS(), known: [], prepared: ["Conjure Animals", "Giant Insect"], cantrips: [] },
});
// The GM's own druid and a player's.
const mine = world.addHero(DRUID("Oak", world.owner));
const theirs = world.addHero(DRUID("Ash"));
const player = { id: theirs.userId };

async function call(method, name, { body, query = "" } = {}, user = world.owner) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const url = `http://odm.test/${name}${query ? `?${query}` : ""}`;
  const request = method === "GET" ? new Request(url) : new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const response = await handler[method](request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, body: await response.json() };
}
const act = (body, user = world.owner) => call("POST", "actions", { body: { kind: "do", ...body } }, user);
const waiting = () => queuedIntents(listRecentMessages(world.campaignId, 40), []).map((row) => row.messageId);
const brought = (sheet, spell = "Conjure Animals") => summonsOf(world.campaignId, sheet.id, spell);

await kit.fight(1);
const [goblin] = world.enemies();
kit.setEnemy(goblin.id, { maxHp: 200, currentHp: 200 });
function turnOf(sheet) {
  kit.giveTurn(sheet.id);
  kit.freshTurn();
  setFloor(world.campaignId, initiativeFloorFor(world.campaignId));
  world.patch(sheet.id, { concentratingOn: null });
}


await test("A Conjure Animals card asks for its creature from the catalogue, listed by challenge rating, and nothing is picked for the player", () => {
  const catalogue = summonCatalogue(conjure);
  const [card] = deriveHand(world.sheet(theirs.id), undefined, { summons: { "conjure animals": catalogue } }).filter((entry) => entry.name === "Conjure Animals");
  assert.ok(card, "the card is dealt");
  assert.equal(card.choice?.arg, "variant");
  assert.equal(card.choice.label, "Creature");
  assert.equal(card.choice.fallback, "");
  assert.ok(card.choice.options.some((option) => option.value === "Wolf" && /CR 1\/4 beast, AC \d+, \d+ hit points/.test(option.note)), JSON.stringify(card.choice.options.slice(0, 3)));
  assert.deepEqual(card.summon.forms.Wolf, { counts: [1, 2, 4, 8], group: "CR 1/4" });
  assert.equal(handReady(card, null, {}), false, "the card waits for a creature");
  assert.equal(handReady(card, null, { choice: "Wolf" }), true);
  // Without the catalogue (an older host) the card asks nothing, as before.
  const [plain] = deriveHand(world.sheet(theirs.id)).filter((entry) => entry.name === "Conjure Animals");
  assert.equal(plain.summon, undefined);
  assert.equal(plain.choice, undefined);
});

await test("The picked creature and number ride the card as cast_buff's variant and count, and its sentence and preview say them", () => {
  const [card] = deriveHand(world.sheet(theirs.id), undefined, { summons: { "conjure animals": summonCatalogue(conjure) } }).filter((entry) => entry.name === "Conjure Animals");
  const most = intentBody(card, null, [], { choice: "Wolf" });
  assert.equal(most.variant, "Wolf");
  assert.equal(most.count, 8, "the most when no number is picked");
  assert.equal(intentBody(card, null, [], { choice: "Wolf", count: 2 }).count, 2);
  assert.equal(intentBody(card, null, [], { choice: "Wolf", count: 3 }).count, 8, "a number the spell does not print is not sent");
  assert.equal(intentBody(card, null, [], { choice: "Brown Bear", count: 8 }).count, 2, "a creature changed keeps a number it may come in");
  assert.equal(intentBody(card, null, [], {}).variant, undefined, "no creature picked: none sent");
  assert.equal(composeSentence(card, null, [], { choice: "Wolf", count: 4 }), "I cast Conjure Animals (Wolf, 4 of them) using a level 3 slot.");
  assert.equal(composeSentence(card, null, [], { choice: "Giant Elk" }), "I cast Conjure Animals (Giant Elk) using a level 3 slot.");
  assert.ok(previewRows(card, null, [], { choice: "Wolf", count: 4 }).some((row) => row.key === "Brings" && row.value === "Wolf, 4 of them"));
  assert.ok(parseMessageIntent(most), "the intent passes the message schema");
});

await test("Only a spell with more than one creature at the card's slot asks: Unseen Servant does not, Create Undead's ghouls alone do not", () => {
  assert.equal(summonPick(summonCatalogue(summonSpellFor("Unseen Servant")), 1), null);
  assert.equal(summonPick(summonCatalogue(summonSpellFor("Create Undead")), 6), null, "ghouls only from a 6th level slot");
  assert.ok(summonPick(summonCatalogue(summonSpellFor("Create Undead")), 8), "ghasts and wights join from 8th");
  const giant = summonPick(summonCatalogue(insects), 4);
  assert.deepEqual(giant.choice.options.map((option) => option.value), insects.forms);
  assert.equal(giant.summon.forms["Giant Spider"].group, undefined, "named forms are not listed by rating");
  assert.equal(summonCount({ summon: giant.summon }, "Giant Centipede"), 10);
});

// ---- the engine ----

await test("The engine's direct call carries the count, and the line the AI reads names the creature and the number", () => {
  const intent = { card: "spell", spell: "Conjure Animals", slotLevel: 3, variant: "Wolf", count: 4 };
  assert.deepEqual(directCardCall(intent, theirs.id, { inFight: true, resolution: null, summon: "choose" }), {
    name: "cast_buff",
    args: { characterId: theirs.id, spell: "Conjure Animals", level: 3, variant: "Wolf", count: 4 },
  });
  assert.match(describeIntent(intent, theirs.id), /variant=Wolf, count=4/);
});

await test("The catalogue route answers a member with the spells that summon, by the name asked, and leaves the rest out", async () => {
  const out = await call("GET", "summons", { query: "spell=Conjure%20Animals&spell=Shield&spell=Giant%20Insect" }, player);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(Object.keys(out.body.summons).sort(), ["Conjure Animals", "Giant Insect"]);
  assert.deepEqual(out.body.summons["Conjure Animals"].forms.find((entry) => entry.name === "Wolf").counts["3"], form("Wolf").counts["3"]);
  const stranger = world.addUser("stranger");
  assert.notEqual((await call("GET", "summons", { query: "spell=Conjure%20Animals" }, stranger)).status, 200, "a stranger is not answered");
  assert.equal((await call("GET", "summons", {}, player)).status, 400, "a spell must be named");
});

await test("At an AI-run table the engine casts the card whole: four wolves come in before the model narrates, which reads that it was resolved", async () => {
  const model = await fakeModel();
  model.pointAt(world);
  turnOf(theirs);
  model.script([reply({ text: "Four grey wolves pad out of the trees." })]);
  await model.turn(world, "I cast Conjure Animals (Wolf, 4 of them) using a level 3 slot.", theirs.id, theirs.userId, {
    intent: { card: "spell", spell: "Conjure Animals", slotLevel: 3, variant: "Wolf", count: 4 },
  });
  assert.equal(brought(theirs).length, 4, "four wolves, the number picked");
  assert.ok(brought(theirs).every((sheet) => /wolf/i.test(sheet.name)), brought(theirs).map((sheet) => sheet.name).join(", "));
  const transcript = model.requests[0].messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  assert.match(transcript, /Conjure Animals[^\n]*variant=Wolf, count=4/);
  assert.match(transcript, /The engine has resolved it/);
  model.close();
});

setDmMode(world.campaignId, "human", world.owner.id);

await test("At a table a person runs, the GM's own summon card with its creature resolves at once", async () => {
  turnOf(mine);
  const cast = await act({ content: "I cast Giant Insect (Giant Spider, 2 of them) using a level 4 slot.", characterId: mine.id, intent: { card: "spell", spell: "Giant Insect", slotLevel: 4, variant: "Giant Spider", count: 2 } });
  assert.equal(cast.status, 200, JSON.stringify(cast.body));
  assert.equal(cast.body.resolved, true);
  assert.equal(brought(mine, "Giant Insect").length, 2);
});

await test("A player's summon card with its creature waits with Resolve as played, which brings the number picked", async () => {
  turnOf(theirs);
  const before = brought(theirs).length;
  const out = await act({ content: "I cast Conjure Animals (Brown Bear, 1 of them) using a level 3 slot.", characterId: theirs.id, intent: { card: "spell", spell: "Conjure Animals", slotLevel: 3, variant: "Brown Bear", count: 1 } }, player);
  assert.equal(out.status, 202, `posted for the GM: ${JSON.stringify(out.body)}`);
  const id = waiting().at(-1);
  assert.ok(id, "the card waits for the GM");
  const offered = await call("GET", "dm/resolve-card", { query: `id=${id}` });
  assert.deepEqual(offered.body.resolvable, [id], "the console offers Resolve as played on it");
  const resolved = await call("POST", "dm/resolve-card", { body: { messageId: id } });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  // The first casting's wolves went with its concentration.
  const bears = brought(theirs).filter((sheet) => /bear/i.test(sheet.name));
  assert.equal(bears.length, 1, `one bear, not the two the slot allows: ${brought(theirs).map((sheet) => sheet.name).join(", ")} (before: ${before})`);
});

await test("A creature the spell cannot call, or a number of it the spell does not offer, is refused before the card is posted", async () => {
  turnOf(theirs);
  const before = waiting().length;
  const fey = await act({ content: "I cast Conjure Animals (Dryad).", characterId: theirs.id, intent: { card: "spell", spell: "Conjure Animals", slotLevel: 3, variant: "Dryad" } }, player);
  assert.equal(fey.status, 409);
  assert.match(fey.body.error, /calls a beast; a Dryad is a fey/);
  const wolves = await act({ content: "I cast Conjure Animals (Wolf, 3 of them).", characterId: theirs.id, intent: { card: "spell", spell: "Conjure Animals", slotLevel: 3, variant: "Wolf", count: 3 } }, player);
  assert.equal(wolves.status, 409, `three wolves are none of the spell's options: ${JSON.stringify(wolves.body)}`);
  assert.match(wolves.body.error, /brings 1, 2, 4 or 8 of that creature \(Wolf\), not 3/);
  const bears = await act({ content: "I cast Conjure Animals (Brown Bear, 8 of them).", characterId: theirs.id, intent: { card: "spell", spell: "Conjure Animals", slotLevel: 3, variant: "Brown Bear", count: 8 } }, player);
  assert.equal(bears.status, 409);
  assert.match(bears.body.error, /brings 1 or 2 of that creature \(Brown Bear\), not 8/);
  assert.equal(waiting().length, before, "nothing was posted");
});

await test("The console's cast_buff asks again for three wolves from a 3rd level slot, with the numbers the spell offers, and spends nothing", async () => {
  turnOf(mine);
  const used = world.sheet(mine.id).spellcasting.slots[3].used;
  const before = brought(mine).length;
  const out = await world.invoke("cast_buff", { characterId: mine.id, spell: "Conjure Animals", level: 3, variant: "Wolf", count: 3 });
  assert.equal(brought(mine).length, before, "no wolves came");
  assert.equal(out.retry, true, JSON.stringify(out));
  assert.match(out.error ?? "", /brings 1, 2, 4 or 8 of that creature \(Wolf\), not 3/);
  assert.equal(world.sheet(mine.id).spellcasting.slots[3].used, used, "no slot spent");
});

world.close();
finish();
