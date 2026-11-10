// Issue 685: summoning spells cast outside the Hand. Find Familiar, Find
// Steed, Animate Dead, Create Undead, Phantom Steed and the Conjure spells
// of a minute were never Hand cards (their casting time is longer than an
// action), and no summoning had a card out of a fight: the player typed it,
// and an AI GM picked the creature, its kind and its number (or asked
// again), or the GM entered them on the console. Find Steed's kind fell to
// celestial unless typed, a familiar's to nothing, Animate Dead could not
// raise a skeleton and a zombie together, and a ritual Find Familiar spent a
// slot whatever the caster said.
//
// The sheet's summoning door (src/app/campaigns/[campaignId]/SummonDoor.tsx,
// src/lib/battlemap/hand-summon.ts summonDoorRows) now casts them from the
// same catalogue the Hand's card reads, out of a fight whole (as a ritual
// too), in a fight begun and then finished with the creature picked; the
// Hand's Animate Objects card takes each object's size; and the engine takes
// the kind, the per-target mix and the ritual (cast_buff `mix`, `ritual`).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { nextTurn } from "./lib/enforce-spell-tail.mjs";
import { handOnDue } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-summon-door");

const { summonCatalogue, summonMixPlan, summonSpellFor } = await import("../src/lib/srd/summon-spells.ts");
const { familiarCatalogue } = await import("../src/lib/srd/familiar-forms.ts");
const { summonDoorRows, summonDoorPost, summonPick } = await import("../src/lib/battlemap/hand-summon.ts");
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { composeSentence, handReady, intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const { directCardCall, parseMessageIntent } = await import("../src/lib/dm/intent-logic.ts");
const { setDmMode, setFloor } = await import("../src/lib/db/campaigns.ts");
const { initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");
const { summonsOf } = await import("../src/lib/dm/summon-store.ts");
const { sheetCreatureType } = await import("../src/lib/dm/summon-rules.ts");
const { speciesAndClassWords } = await import("../src/lib/characters/class-words.ts");

const dead = summonSpellFor("Animate Dead");
const objects = summonSpellFor("Animate Objects");

// ---- the engine's rules for each target's form ----

await test("Animate Dead and Animate Objects take each target's form, held to the slot's one budget; a spell of one kind refuses a mix", () => {
  const raised = summonMixPlan(dead, 5, [{ variant: "Skeleton", count: 3 }, { variant: "Zombie", count: 2 }]);
  assert.deepEqual(raised.map((plan) => [plan.form.name, plan.count]), [["Skeleton", 3], ["Zombie", 2]], "five from a 5th level slot");
  assert.match(summonMixPlan(dead, 5, [{ variant: "Skeleton", count: 4 }, { variant: "Zombie", count: 2 }]).error, /brings 5 at most; these come to 6/);
  assert.ok(Array.isArray(summonMixPlan(objects, 5, [{ variant: "Animated Object (Large)", count: 2 }, { variant: "Animated Object (Tiny)", count: 2 }])), "two Large (eight) and two Tiny (two) make ten");
  assert.match(summonMixPlan(objects, 5, [{ variant: "Animated Object (Large)", count: 2 }, { variant: "Animated Object (Medium)", count: 2 }]).error, /brings 10 at most \(a Medium object counts as two/);
  assert.match(summonMixPlan(summonSpellFor("Conjure Animals"), 3, [{ variant: "Wolf", count: 2 }]).error, /one kind of creature per casting/);
  assert.match(summonMixPlan(dead, 3, [{ variant: "Ghoul", count: 1 }]).error, /makes Skeleton, Zombie, not a Ghoul/);
});

await test("The catalogue gives the kinds a creature may be, each target's budget, and Pact of the Chain's familiar forms marked", () => {
  assert.deepEqual(summonCatalogue(summonSpellFor("Find Steed")).kinds, ["celestial", "fey", "fiend"]);
  assert.deepEqual(summonCatalogue(dead).perTarget.budgets, { 3: 1, 4: 3, 5: 5, 6: 7, 7: 9, 8: 11, 9: 13 });
  assert.equal(summonCatalogue(objects).perTarget.cost["Animated Object (Huge)"], 8);
  const familiar = familiarCatalogue();
  assert.deepEqual(familiar.kinds, ["celestial", "fey", "fiend"]);
  assert.ok(familiar.forms.some((form) => form.name === "Owl" && !form.chainOnly));
  assert.ok(familiar.forms.some((form) => form.name === "Imp" && form.chainOnly));
  // A kind with one form still asks: Find Steed's warhorse may be fey.
  const steed = summonPick(summonCatalogue(summonSpellFor("Find Steed")), 2);
  assert.deepEqual(steed.summon.kinds.map((kind) => kind.value), ["celestial", "fey", "fiend"]);
});

// ---- the world ----

const world = await openWorld({ gameSettings: { ttsEnabled: false, multiCharacter: "all_active" } });
const kit = await combatKit(world);
const SLOTS = () => ({ 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 4, used: 0 }, 5: { max: 2, used: 0 } });
const WIZARD = ["Find Familiar", "Animate Dead", "Conjure Minor Elementals", "Animate Objects", "Unseen Servant"];
const dain = world.addHero({
  name: "Dain",
  class: "paladin",
  level: 5,
  maxHp: 44,
  abilities: { str: 16, cha: 14 },
  spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Find Steed"], cantrips: [] },
});
const ivo = world.addHero({
  name: "Ivo",
  class: "wizard",
  level: 9,
  maxHp: 40,
  abilities: { int: 18 },
  // Gold for Find Familiar's 10 gp of charcoal, incense and herbs.
  gold: 50,
  spellcasting: { ability: "int", slots: SLOTS(), known: [], prepared: WIZARD, cantrips: [], spellbook: WIZARD },
});
const lark = world.addHero({
  name: "Lark",
  class: "warlock",
  level: 5,
  maxHp: 33,
  abilities: { cha: 16 },
  spellcasting: { ability: "cha", slots: { 3: { max: 2, used: 0 } }, known: ["Unseen Servant"], prepared: [], cantrips: [] },
});
// A Pact of the Chain warlock, whose familiar fights.
const wren = world.addHero({
  name: "Wren",
  class: "warlock",
  level: 5,
  maxHp: 33,
  abilities: { cha: 16 },
  spellcasting: { ability: "cha", slots: { 3: { max: 2, used: 0 } }, known: ["Find Familiar"], prepared: [], cantrips: [] },
});
world.patch(wren.id, { features: [...world.sheet(wren.id).features, { name: "Pact of the Chain", source: "class" }] });
const used = (sheet, level) => world.sheet(sheet.id).spellcasting.slots[level].used;
const catalogues = async (sheet) => {
  const handler = await world.route("campaigns/[campaignId]/summons");
  world.signIn({ id: sheet.userId });
  const names = [...(sheet.spellcasting.prepared ?? []), ...(sheet.spellcasting.known ?? [])];
  const url = `http://odm.test/summons?${names.map((name) => `spell=${encodeURIComponent(name)}`).join("&")}&characterId=${sheet.id}`;
  const response = await handler.GET(new Request(url), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const body = await response.json();
  return Object.fromEntries(Object.entries(body.summons).map(([name, catalogue]) => [name.toLowerCase(), catalogue]));
};
async function act(sheet, post, user = { id: sheet.userId }) {
  const handler = await world.route("campaigns/[campaignId]/actions");
  world.signIn(user);
  const request = new Request("http://odm.test/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "do", characterId: sheet.id, ...post }) });
  const response = await handler.POST(request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, body: await response.json() };
}
const rowOf = (rows, spell) => rows.find((row) => row.spell === spell);

await test("The route answers the caster's own catalogue: Pact of the Chain's forms only with the pact, a ritual only where they may cast one", async () => {
  const mine = await catalogues(world.sheet(ivo.id));
  assert.ok(!mine["find familiar"].forms.some((form) => form.chainOnly), "no imp for a wizard");
  assert.equal(mine["find familiar"].ritual, true, "a wizard casts it from the book as a ritual");
  assert.equal(mine["find familiar"].long, true, "an hour's casting");
  assert.equal(mine["conjure minor elementals"].long, true);
  assert.equal(mine["animate objects"].long, undefined, "one action");
  const theirs = await catalogues(world.sheet(lark.id));
  assert.equal(theirs["unseen servant"].ritual, undefined, "a warlock without the Book of Ancient Secrets casts no ritual");
});

await test("Out of a fight the door offers every summoning on the sheet; in one only those of a minute, begun, held and then finished with the pick", async () => {
  const sheet = world.sheet(ivo.id);
  const offer = await catalogues(sheet);
  const out = summonDoorRows(sheet, WIZARD, offer, false);
  assert.deepEqual(out.map((row) => [row.spell, row.state]), WIZARD.map((spell) => [spell, "cast"]));
  assert.ok(rowOf(out, "Animate Dead").pick.summon.mix, "each corpse its own form");
  assert.equal(rowOf(out, "Unseen Servant").pick, null, "one creature: nothing to pick");
  assert.equal(rowOf(out, "Find Familiar").ritual, true);
  const fight = summonDoorRows(sheet, WIZARD, offer, true);
  assert.deepEqual(fight.map((row) => [row.spell, row.state]), [["Find Familiar", "begin"], ["Animate Dead", "begin"], ["Conjure Minor Elementals", "begin"]], "the one-action spells are the Hand's");
  const holding = { ...sheet, conditions: ["casting"], conditionMeta: { casting: { spell: "casting Conjure Minor Elementals", source: sheet.id, rounds: 7, slotLevel: 4 } } };
  assert.equal(rowOf(summonDoorRows(holding, WIZARD, offer, true), "Conjure Minor Elementals").state, "casting");
  const done = { ...sheet, conditions: ["casting complete"], conditionMeta: { "casting complete": { spell: "Conjure Minor Elementals", source: sheet.id, slotLevel: 4 } } };
  const finishing = rowOf(summonDoorRows(done, WIZARD, offer, true), "Conjure Minor Elementals");
  assert.equal(finishing.state, "finish");
  assert.equal(finishing.slotLevel, 4);
  assert.ok(finishing.pick.choice.options.some((option) => option.value === "Magma Mephit"));
});

await test("The door's card: the kind with the creature, a ritual with no slot, a casting begun with no creature, one finished with it", async () => {
  const dainOffer = await catalogues(world.sheet(dain.id));
  const steed = rowOf(summonDoorRows(world.sheet(dain.id), ["Find Steed"], dainOffer, false), "Find Steed");
  assert.equal(steed.pick.choice.options.length, 5);
  const fey = summonDoorPost(steed, { form: "Warhorse", kind: "fey" });
  assert.deepEqual(fey.intent, { card: "spell", spell: "Find Steed", slotLevel: 2, variant: "fey Warhorse", count: 1 });
  assert.equal(fey.content, "I cast Find Steed (Fey Warhorse) using a level 2 slot.");
  assert.ok(parseMessageIntent(fey.intent));
  const offer = await catalogues(world.sheet(ivo.id));
  const familiar = rowOf(summonDoorRows(world.sheet(ivo.id), WIZARD, offer, false), "Find Familiar");
  const ritual = summonDoorPost(familiar, { form: "Owl", kind: "fiend" }, true);
  assert.deepEqual(ritual.intent, { card: "spell", spell: "Find Familiar", slotLevel: null, variant: "fiend Owl", count: 1, ritual: true });
  assert.equal(ritual.content, "I cast Find Familiar (Fiend Owl) as a ritual.");
  const begun = summonDoorPost(rowOf(summonDoorRows(world.sheet(ivo.id), WIZARD, offer, true), "Conjure Minor Elementals"), { form: "Magma Mephit" });
  assert.deepEqual(begun.intent, { card: "spell", spell: "Conjure Minor Elementals", slotLevel: 4 }, "the creature waits for the casting to be done");
  // The engine's direct call: begin through the slot, finish through cast_buff.
  const context = { inFight: true, resolution: null, summon: "choose", long: true };
  assert.equal(directCardCall(begun.intent, ivo.id, context).name, "use_spell_slot");
  assert.equal(directCardCall({ ...begun.intent, variant: "Magma Mephit", count: 2 }, ivo.id, context).name, "cast_buff");
  assert.deepEqual(directCardCall({ card: "spell", spell: "Animate Dead", slotLevel: 4, mix: [{ variant: "Skeleton", count: 2 }] }, ivo.id, { inFight: false, summon: "choose", long: true }).args.mix, [{ variant: "Skeleton", count: 2 }]);
});

await test("The door holds a casting the cast guard would refuse, in its own words: Find Familiar's 10 gp of charcoal neither carried nor affordable", async () => {
  // The browser pass (scenario 115) pressed Cast as a ritual for a wizard
  // with no gold and heard the refusal only then; the Hand's spell cards
  // carry it before (hand-spells.ts).
  const offer = await catalogues(world.sheet(ivo.id));
  const poor = { ...world.sheet(ivo.id), gold: 0, copper: 0 };
  const held = rowOf(summonDoorRows(poor, WIZARD, offer, false), "Find Familiar");
  // Its words, here from the bundled facts (the table's own name the
  // charcoal); "needs  worth 10 gp" read as if a word had fallen out.
  assert.match(held.blocked ?? "", /^Find Familiar needs \S.* worth 10 gp, which the spell consumes\. Ivo carries none/);
  assert.equal(held.ritual, true, "the ritual is still the way it would be cast");
  assert.equal(rowOf(summonDoorRows(world.sheet(ivo.id), WIZARD, offer, false), "Find Familiar").blocked, null, "the purse buys it");
  // In a fight there is no buying one: beginning the casting is held too.
  assert.match(rowOf(summonDoorRows(poor, WIZARD, offer, true), "Find Familiar").blocked ?? "", /no buying one in the middle of a fight/);
  // A raging caster casts nothing.
  const raging = { ...world.sheet(ivo.id), conditions: ["raging"] };
  assert.match(rowOf(summonDoorRows(raging, WIZARD, offer, false), "Animate Dead").blocked ?? "", /is raging and cannot cast spells/);
});

await test("The Hand's Animate Objects card takes each object's size within the budget, and sends them as the mix", async () => {
  const offer = await catalogues(world.sheet(ivo.id));
  const [card] = deriveHand(world.sheet(ivo.id), undefined, { summons: offer }).filter((entry) => entry.name === "Animate Objects");
  assert.equal(card.summon.mix.budget, 10, "ten objects' worth from a 5th level slot");
  assert.equal(handReady(card, null, {}), false);
  const mix = { "Animated Object (Large)": 2, "Animated Object (Tiny)": 2 };
  assert.equal(handReady(card, null, { mix }), true);
  assert.deepEqual(intentBody(card, null, [], { mix }).mix, [{ variant: "Animated Object (Tiny)", count: 2 }, { variant: "Animated Object (Large)", count: 2 }]);
  assert.equal(composeSentence(card, null, [], { mix }), "I cast Animate Objects (2 Animated Object (Tiny) and 2 Animated Object (Large)) using a level 5 slot.");
  assert.deepEqual(intentBody(card, null, [], { mix: { "Animated Object (Huge)": 3 } }).mix, [{ variant: "Animated Object (Huge)", count: 1 }], "no more than the budget holds");
});

// ---- the casting, end to end ----

await test("At an AI-run table out of a fight: a fey warhorse comes as the door asked, and a ritual familiar spends no slot", async () => {
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: "A fey warhorse steps out of the mist." })]);
  await model.turn(world, "I cast Find Steed (Fey Warhorse) using a level 2 slot.", dain.id, dain.userId, {
    intent: { card: "spell", spell: "Find Steed", slotLevel: 2, variant: "fey Warhorse", count: 1 },
  });
  const [steed] = summonsOf(world.campaignId, dain.id, "Find Steed");
  assert.ok(steed && /warhorse/i.test(steed.name), JSON.stringify(summonsOf(world.campaignId, dain.id, "Find Steed").map((sheet) => sheet.name)));
  const results = model.requests[0].messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
  assert.ok(results.some((result) => /Warhorse \(fey,/.test(result.creature ?? "")), JSON.stringify(results));
  // The steed is the kind picked wherever its creature type is read.
  assert.equal(steed.summon.creatureType, "fey");
  assert.equal(sheetCreatureType(steed), "fey", "the type its attacks and the zones it walks into read");
  assert.equal(speciesAndClassWords(steed), "Warhorse, fey (Find Steed)", "its party card names its kind");
  model.script([reply({ text: "An owl of shadow settles on Ivo's shoulder." })]);
  await model.turn(world, "I cast Find Familiar (Fiend Owl) as a ritual.", ivo.id, ivo.userId, {
    intent: { card: "spell", spell: "Find Familiar", slotLevel: null, variant: "fiend Owl", count: 1, ritual: true },
  });
  assert.equal(world.sheet(ivo.id).pets?.[0]?.form, "Owl");
  assert.equal(world.sheet(ivo.id).pets?.[0]?.creatureType, "fiend", "the kind is kept on the pet record");
  // The record's schema keeps it through an undo's pre-image, and a pet
  // stored before the field existed reads as it did.
  const { fullPatchSheetSchema } = await import("../src/lib/schemas/sheet.ts");
  assert.equal(fullPatchSheetSchema.parse({ pets: world.sheet(ivo.id).pets }).pets[0].creatureType, "fiend");
  const { creatureType: _gone, ...older } = world.sheet(ivo.id).pets[0];
  void _gone;
  assert.equal(fullPatchSheetSchema.parse({ pets: [older] }).pets[0].creatureType, undefined);
  assert.equal(used(ivo, 1), 0, "a ritual spends no slot");
  const told = model.requests.at(-1).messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
  assert.ok(told.some((result) => /Owl \(Owl, a fiend\)/.test(result.pet ?? "")), JSON.stringify(told));
  model.close();
});

await test("The GM console's cast_buff picks Find Steed's kind and Animate Dead's per-target forms as the GM casts for anyone", async () => {
  const fiend = await world.invoke("cast_buff", { characterId: dain.id, spell: "Find Steed", level: 2, variant: "warhorse", kind: "fiend" });
  assert.equal(fiend.ok, true, fiend.error);
  const [steed] = summonsOf(world.campaignId, dain.id, "Find Steed");
  assert.equal(sheetCreatureType(steed), "fiend", "the console's Kind, not a word typed in Another choice");
  const before = summonsOf(world.campaignId, ivo.id, "Animate Dead").length;
  const raised = await world.invoke("cast_buff", { characterId: ivo.id, spell: "Animate Dead", level: 4, mix: [{ variant: "Skeleton", count: 1 }, { variant: "Zombie", count: 2 }] });
  assert.equal(raised.ok, true, raised.error);
  const made = summonsOf(world.campaignId, ivo.id, "Animate Dead").slice(before).map((sheet) => sheet.summon.form);
  assert.deepEqual(made.sort(), ["Skeleton", "Zombie", "Zombie"]);
  const familiar = await world.invoke("summon_pet", { characterId: wren.id, kind: "familiar", form: "Pseudodragon", creatureType: "celestial" });
  assert.equal(familiar.ok, true, familiar.error);
  assert.equal(world.sheet(wren.id).pets[0].creatureType, "celestial");
});

await test("The storyteller names a summoning's kind in variant, which its cast_buff no longer spends a kind field on: 'fey warhorse' brings a fey steed", async () => {
  const { castBuffTool } = await import("../src/lib/dm/cast-tools.ts");
  const properties = castBuffTool.function.parameters.properties;
  assert.equal(properties.kind, undefined, "the model's cast_buff still carries a kind field");
  assert.match(properties.variant.description, /fey warhorse/);
  const sheet = world.sheet(dain.id);
  world.patch(dain.id, { spellcasting: { ...sheet.spellcasting, slots: Object.fromEntries(Object.entries(sheet.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: 0 }])) } });
  const before = summonsOf(world.campaignId, dain.id, "Find Steed").length;
  const fey = await world.invoke("cast_buff", { characterId: dain.id, spell: "Find Steed", level: 2, variant: "fey warhorse" });
  assert.equal(fey.ok, true, fey.error);
  const steed = summonsOf(world.campaignId, dain.id, "Find Steed").at(-1);
  assert.ok(steed && summonsOf(world.campaignId, dain.id, "Find Steed").length >= before, "no steed");
  assert.equal(sheetCreatureType(steed), "fey", "the kind named in variant");
});

await test("The console's Each target's form names its steppers for the spell, as the Hand's card does, not for the field's own label", async () => {
  // The browser pass (scenario 115) heard the group as "Each target's form
  // for Each target's form".
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { FieldInput } = await import("../src/app/campaigns/[campaignId]/DmActionFields.tsx");
  const html = renderToStaticMarkup(
    createElement(FieldInput, {
      field: { name: "mix", label: "Each target's form", kind: "summonMix" },
      value: [],
      onChange: () => {},
      sheets: [],
      enemies: [],
      summon: { catalogue: summonCatalogue(summonSpellFor("Animate Dead")), slotLevel: 3 },
    }),
  );
  assert.match(html, /role="group" aria-label="Each target&#x27;s form for Animate Dead"/);
  assert.match(html, /aria-label="One more Skeleton"/);
  assert.doesNotMatch(html, /for Each target/);
});

setDmMode(world.campaignId, "human", world.owner.id);

await test("Summon a pet's Creature is picked from what the engine takes for each kind; a story pet not in the list keeps its hp and ac, and an unknown name is sent to the Bestiary", async () => {
  const { petFormOptions, petFormTyped } = await import("../src/lib/dm/pet-form-logic.ts");
  const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
  const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
  createHomebrewMonster(world.owner.id, draftFromCr("Moonmoth", 0.125), "");
  const handler = await world.route("campaigns/[campaignId]/dm/pet-forms");
  const get = async (user) => {
    world.signIn({ id: user.id });
    const response = await handler.GET(new Request("http://odm.test/dm/pet-forms"), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return { status: response.status, body: await response.json() };
  };
  assert.notEqual((await get({ id: ivo.userId })).status, 200, "a player is not shown the GM's list");
  const { catalogue } = (await get(world.owner)).body;
  assert.ok(catalogue.familiar.some((form) => form.name === "Owl" && !form.chainOnly));
  assert.ok(catalogue.familiar.some((form) => form.name === "Imp" && form.chainOnly));
  assert.ok(catalogue.companion.includes("Wolf") && !catalogue.companion.includes("Brown Bear"), "a companion is CR 1/4 or lower");
  assert.deepEqual(catalogue.table, ["Moonmoth"], "this table's own monsters");
  assert.ok(catalogue.srd.includes("Riding Horse"));
  const familiar = petFormOptions("familiar", catalogue);
  assert.equal(familiar[0].group, "Familiar forms", "the familiar forms come first");
  assert.equal(familiar.at(-1).group, "Pact of the Chain");
  const story = petFormOptions("other", catalogue);
  assert.deepEqual(story[0], { value: "Moonmoth", label: "Moonmoth", group: "This table's monsters" });
  assert.ok(story.some((option) => option.value === "Mastiff" && option.group === "SRD creatures"));
  assert.deepEqual(petFormOptions("drake", catalogue).map((option) => option.value), ["Drake"]);
  assert.equal(petFormTyped("other"), true, "only a story pet has Not in the list");
  assert.equal(petFormTyped("familiar"), false);
  // The engine: an unknown name is refused toward the Bestiary; the same
  // name with hit points and AC is a story pet by design; a table monster
  // takes its block.
  const unknown = await world.invoke("summon_pet", { characterId: dain.id, kind: "other", form: "Glimmerwing" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /build it in the workshop's Bestiary or the console's, then pick it\), or send its hp and ac/);
  const typed = await world.invoke("summon_pet", { characterId: dain.id, kind: "other", form: "Glimmerwing", hp: 4, ac: 12 });
  assert.equal(typed.ok, true, typed.error);
  const moth = await world.invoke("summon_pet", { characterId: dain.id, kind: "other", form: "Moonmoth" });
  assert.equal(moth.ok, true, moth.error);
  assert.ok(world.sheet(dain.id).pets.some((pet) => pet.form === "Moonmoth"));
});

await test("Summon a pet's familiar list holds Pact of the Chain's forms only for an owner with the pact, and a new kind lets go of a creature its list does not hold", async () => {
  const { petFormAfterKind } = await import("../src/lib/dm/pet-form-logic.ts");
  const handler = await world.route("campaigns/[campaignId]/dm/pet-forms");
  world.signIn(world.owner);
  const get = async (query) => {
    const response = await handler.GET(new Request(`http://odm.test/dm/pet-forms${query}`), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return { status: response.status, body: await response.json() };
  };
  const names = (body) => body.catalogue.familiar.map((form) => form.name);
  const chained = await get(`?characterId=${wren.id}`);
  assert.equal(chained.status, 200, JSON.stringify(chained.body));
  assert.ok(names(chained.body).includes("Imp") && names(chained.body).includes("Owl"), "an owner with the pact has its four");
  const plain = await get(`?characterId=${ivo.id}`);
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  assert.ok(names(plain.body).includes("Owl"));
  assert.ok(!names(plain.body).some((name) => ["Imp", "Pseudodragon", "Quasit", "Sprite"].includes(name)), "an owner without the pact is not offered its forms");
  assert.ok(names((await get("")).body).includes("Imp"), "an older console names no owner: the forms stay listed for the engine to judge");
  assert.equal((await get("?characterId=no-such-hero")).status, 404, "an owner from no table here is refused");
  const refused = await world.invoke("summon_pet", { characterId: ivo.id, kind: "familiar", form: "Imp" });
  assert.equal(refused.ok, false, "the engine still refuses the pact's forms to an owner without it");
  // The console's kind change keeps a creature the new list holds and lets
  // go of one it does not; a story pet keeps whatever was picked or typed.
  const catalogue = chained.body.catalogue;
  assert.equal(petFormAfterKind("drake", "Owl", catalogue), "", "a familiar's owl is no drake");
  assert.equal(petFormAfterKind("beast_companion", "Imp", catalogue), "", "an imp is no beast");
  assert.equal(petFormAfterKind("familiar", "Riding Horse", catalogue), "");
  assert.equal(petFormAfterKind("beast_companion", "Owl", catalogue), "Owl", "an owl is a beast a companion can be");
  assert.equal(petFormAfterKind("familiar", "Imp", catalogue), "Imp");
  assert.equal(petFormAfterKind("familiar", "owl", catalogue), "Owl", "a story pet typed by a list's name becomes that pick");
  assert.equal(petFormAfterKind("familiar", "Imp", plain.body.catalogue), "", "the pact's form goes with an owner without it");
  assert.equal(petFormAfterKind("other", "Glimmerwing", catalogue), "Glimmerwing", "a story pet may be any creature");
  assert.equal(petFormAfterKind("drake", "", catalogue), "");
});
const waiting =() => queuedIntents(listRecentMessages(world.campaignId, 40), []).map((row) => row.messageId);
async function resolve(messageId) {
  const handler = await world.route("campaigns/[campaignId]/dm/resolve-card");
  world.signIn(world.owner);
  const request = new Request("http://odm.test/dm/resolve-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId }) });
  const response = await handler.POST(request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, body: await response.json() };
}

await test("At a table a person runs: Animate Dead's skeletons and zombie wait for the GM, who resolves them as played", async () => {
  const before = summonsOf(world.campaignId, ivo.id, "Animate Dead").length;
  const out = await act(world.sheet(ivo.id), { content: "I cast Animate Dead (2 Skeleton and 1 Zombie) using a level 4 slot.", intent: { card: "spell", spell: "Animate Dead", slotLevel: 4, mix: [{ variant: "Skeleton", count: 2 }, { variant: "Zombie", count: 1 }] } });
  assert.equal(out.status, 202, JSON.stringify(out.body));
  const resolved = await resolve(waiting().at(-1));
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  const raised = summonsOf(world.campaignId, ivo.id, "Animate Dead").slice(before).map((sheet) => sheet.name);
  assert.equal(raised.filter((name) => /skeleton/i.test(name)).length, 2, raised.join(", "));
  assert.equal(raised.filter((name) => /zombie/i.test(name)).length, 1, raised.join(", "));
  assert.equal(used(ivo, 4), 2, "one slot for the lot (the console's casting took the other)");
});

await test("A mix past the slot's budget, an imp without the pact, or a ritual from a class that casts none is refused before it is posted", async () => {
  const before = waiting().length;
  const many = await act(world.sheet(ivo.id), { content: "I cast Animate Dead.", intent: { card: "spell", spell: "Animate Dead", slotLevel: 3, mix: [{ variant: "Skeleton", count: 2 }] } });
  assert.equal(many.status, 409);
  assert.match(many.body.error, /brings 1 at most/);
  const imp = await act(world.sheet(ivo.id), { content: "I cast Find Familiar (Imp).", intent: { card: "spell", spell: "Find Familiar", slotLevel: 1, variant: "fiend Imp" } });
  assert.equal(imp.status, 409);
  assert.match(imp.body.error, /needs Pact of the Chain/);
  const rite = await act(world.sheet(lark.id), { content: "I cast Unseen Servant as a ritual.", intent: { card: "spell", spell: "Unseen Servant", slotLevel: null, ritual: true } });
  assert.equal(rite.status, 409);
  assert.match(rite.body.error, /does not cast rituals/);
  assert.equal(waiting().length, before, "nothing was posted");
});

await test("In a fight a summoning of a minute is begun by its card, held through ten rounds of the engine's own turns, and finished by the next card with the creatures picked then", async () => {
  await kit.fight(1);
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 300, currentHp: 300 });
  kit.giveTurn(ivo.id);
  kit.freshTurn();
  setFloor(world.campaignId, initiativeFloorFor(world.campaignId));
  world.patch(ivo.id, { concentratingOn: null });
  const begun = await act(world.sheet(ivo.id), { content: "I begin casting Conjure Minor Elementals using a level 4 slot.", intent: { card: "spell", spell: "Conjure Minor Elementals", slotLevel: 4 } });
  assert.equal(begun.status, 202, JSON.stringify(begun.body));
  const first = await resolve(waiting().at(-1));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(world.sheet(ivo.id).conditionMeta?.casting?.rounds, 10, "a minute is ten rounds");
  const before = used(ivo, 4);
  // The turns go round as the table plays them (encounter-tools.ts
  // skipCurrentTurn, the enemies handed on), until the casting is done as
  // Ivo's turn starts.
  let turns = 0;
  while (!world.sheet(ivo.id).conditions.includes("casting complete") && turns < 200) {
    nextTurn(world);
    handOnDue(world);
    turns += 1;
    assert.equal(used(ivo, 4), before, `the slot was spent ${turns} turns in, before the casting was done`);
  }
  assert.ok(world.sheet(ivo.id).conditions.includes("casting complete"), `the casting never finished in ${turns} turns`);
  assert.equal(world.encounter().order[world.encounter().turnIndex]?.characterId, ivo.id, "it finishes as Ivo's turn starts");
  assert.ok(world.encounter().round >= 11, `ten rounds passed: round ${world.encounter().round}`);
  setFloor(world.campaignId, initiativeFloorFor(world.campaignId));
  const rows = summonDoorRows(world.sheet(ivo.id), WIZARD, await catalogues(world.sheet(ivo.id)), true);
  assert.equal(rowOf(rows, "Conjure Minor Elementals").state, "finish", "the door offers the pick now");
  const done = await act(world.sheet(ivo.id), { content: "I finish casting Conjure Minor Elementals (Magma Mephit, 2 of them).", intent: { card: "spell", spell: "Conjure Minor Elementals", slotLevel: 4, variant: "Magma Mephit", count: 2 } });
  assert.equal(done.status, 202, JSON.stringify(done.body));
  const second = await resolve(waiting().at(-1));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(summonsOf(world.campaignId, ivo.id, "Conjure Minor Elementals").length, 2, "the two mephits picked");
  assert.equal(used(ivo, 4), before + 1, "the slot is spent as it completes");
});

await test("A familiar's kind is the type its attack meets a ward with: Protection from Evil and Good turns a celestial pseudodragon, not one of old with no kind", async () => {
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { conditions: ["protected from evil and good"] });
  // A pet has no square of its own: it stands with its owner, and its bite
  // reaches from there (WAVE2 D2, src/lib/dm/pet-place.ts), so the goblin
  // stands beside Wren.
  const by = kit.token(wren.id);
  kit.place(goblin.id, by.x + 1, by.y);
  kit.giveTurn(wren.id);
  kit.freshTurn();
  world.dice(19, 2);
  const warded = await world.invoke("pet_attack", { characterId: wren.id, targetEnemyId: goblin.id, attack: "Bite" });
  world.clearDice();
  assert.equal(warded.ok, true, warded.error);
  assert.equal(warded.result.hit, false, "disadvantage: the 2 is kept");
  assert.match(String(warded.result.situation), /disadvantage for a celestial/);
  // A pet stored before the record kept a kind reads as its form: a dragon.
  const [pseudodragon] = world.sheet(wren.id).pets;
  const { creatureType: _kept, ...old } = pseudodragon;
  void _kept;
  world.patch(wren.id, { pets: [old] });
  kit.freshTurn();
  world.dice(19, 1, 1);
  const plain = await world.invoke("pet_attack", { characterId: wren.id, targetEnemyId: goblin.id, attack: "Bite" });
  world.clearDice();
  assert.equal(plain.ok, true, plain.error);
  assert.equal(plain.result.hit, true, "one die, the 19: no ward against a dragon");
  kit.setEnemy(goblin.id, { conditions: [] });
});

world.close();
finish();
