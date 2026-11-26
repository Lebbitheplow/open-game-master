// A thing or money the story moves with no tool behind it (issue 1097). A
// player handed an NPC one of their ten rations, the narrator wrote her taking
// it and called no tool, and the sheet still showed ten. Nothing read the
// prose for it: a spell, a blow and a fight told in prose alone were each
// caught, a hand-off was not.
//
// One read of the exchange now finds it (src/lib/dm/item-claims.ts
// readItemMoves, its words in item-read-logic.ts), and the rulings on what it
// read are src/lib/dm/item-claims-logic.ts: what a player's own words declared and the
// narration showed is carried out by the server; anything else sends the
// narrator back to its tools once, and what is still open when the turn ends
// is a note it reads next turn.
//
// Pure checks of the read and the rulings, then whole DM turns against the
// scripted fake model (scripts/lib/enforce-narrator.mjs), the read answering
// what a reader would read in the prose (model.items).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED, combatKit } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-items-change-hands");
const logic = { ...(await import("../src/lib/dm/item-read-logic.ts")), ...(await import("../src/lib/dm/item-claims-logic.ts")) };
const { readerSystem } = await import("../src/lib/dm/claims-logic.ts");

// ---- the read ----

const CONTEXT = {
  party: new Map([
    ["j", "Jason"],
    ["b", "Bram"],
  ]),
  carried: new Map([
    ["i1", { characterId: "j", name: "Rations (1 day)" }],
    ["i2", { characterId: "j", name: "Longsword" }],
    ["i3", { characterId: "b", name: "Rope, hempen (50 feet)" }],
    ["i4", { characterId: "j", name: "Potion of Healing" }],
    ["i5", { characterId: "j", name: "Potion of Climbing" }],
  ]),
  language: "english",
};
const read = (text, claims) => logic.checkItemMoves(JSON.stringify({ claims }), { ...CONTEXT, text });

await test("The read's message names its one kind, the packs by ref, the players' words and the narration, after the claims reader's own system prompt.", () => {
  const refs = { party: [{ ref: "j", name: "Jason" }], carried: [{ ref: "i1", name: "Rations (1 day)", qty: 10, by: "Jason" }] };
  const asked = logic.itemRequest(refs, "Jason: I hand her one of my rations.", "Mira takes the ration.");
  assert.ok(asked.startsWith(logic.ITEM_ASK_START), "the harness and the reader both know it by its first line");
  assert.match(asked, /Item refs: "i1" for Rations \(1 day\) x10 \(Jason\)/);
  assert.match(asked, /Player's words:\n<<<\nJason: I hand her one of my rations\.\n>>>\n\nNarration:\n<<<\nMira takes the ration\.\n>>>$/);
  assert.match(logic.itemRequest(refs, "", "The wind howls."), /Player's words:\n<<<\n\(none\)\n>>>/);
  // What changes least comes first, so a server that keeps what it read keeps the ask and the packs.
  assert.ok(asked.indexOf("One item claim:") < asked.indexOf("Item refs:") && asked.indexOf("Item refs:") < asked.indexOf("Player's words:"));
  // The claims reader's prompt is untouched: the kind lives in the message alone.
  assert.ok(!readerSystem(["stealth"], false).includes('"kind":"item"'));
});

await test("A thing leaves only the pack that holds it, by its ref or its own name; a thing nobody carries is no claim, and money is read by its codes.", () => {
  const text = "Mira takes the ration and the three silver, and presses a soot-stained ledger into your hands.";
  const gives = read(text, [{ kind: "item", who: "j", change: "gives", item: "i1", said: true, quote: "Mira takes the ration" }]);
  assert.deepEqual(gives, [{ kind: "item", character: "j", name: "Jason", quote: "Mira takes the ration", said: true, change: "gives", item: "Rations (1 day)", carried: true }]);
  // The line's own name, its name without the note, or one of it, where the reader wrote it out.
  for (const written of ["Rations (1 day)", "Rations", "ration", "Ration"]) {
    assert.equal(read(text, [{ kind: "item", who: "j", change: "gives", item: written, qty: 2, quote: "Mira takes the ration" }])?.[0]?.item, "Rations (1 day)", written);
  }
  assert.equal(read(text, [{ kind: "item", who: "j", change: "gives", item: "Rations", qty: 2, quote: "Mira takes the ration" }])[0].qty, 2);
  // A word of a name picks out nothing: "potion" is two lines, and neither.
  assert.deepEqual(read(text, [{ kind: "item", who: "j", change: "gives", item: "potion", quote: "Mira takes the ration" }]), []);
  // Dried meat is on no sheet: flavour, never a claim. Nor is another's line theirs to give.
  assert.deepEqual(read(text, [{ kind: "item", who: "j", change: "uses", item: "dried meat", quote: "Mira takes the ration" }]), []);
  assert.deepEqual(read(text, [{ kind: "item", who: "j", change: "gives", item: "i3", quote: "Mira takes the ration" }]), []);
  // A gain is named in the narration's words; what they already carry is no gain.
  assert.deepEqual(read(text, [{ kind: "item", who: "j", change: "gains", item: "soot-stained ledger", quote: "presses a soot-stained ledger into your hands" }]).map((claim) => claim.item), ["soot-stained ledger"]);
  assert.deepEqual(read(text, [{ kind: "item", who: "j", change: "gains", item: "i2", quote: "presses a soot-stained ledger into your hands" }]), []);
  // Another's line gained is named by its name.
  assert.equal(read(text, [{ kind: "item", who: "j", change: "gains", item: "i3", quote: "presses a soot-stained ledger into your hands" }])[0]?.item, "Rope, hempen (50 feet)");
  assert.equal(read(text, [{ kind: "item", who: "j", change: "gives", item: "3 sp", quote: "the three silver" }])[0]?.copper, 30);
  // The quote must be the narration's, the character one of the party, and a null count is one.
  assert.deepEqual(read(text, [{ kind: "item", who: "j", change: "gives", item: "i1", quote: "I hand her one of my rations" }]), []);
  assert.deepEqual(read(text, [{ kind: "item", who: "mira", change: "gains", item: "ration", quote: "Mira takes the ration" }]), []);
  assert.equal(read(text, [{ kind: "item", who: "j", change: "gives", item: "i1", qty: null, to: null, said: null, quote: "Mira takes the ration" }]).length, 1);
  // Only another of the party is a receiver, and only a thing given has one.
  assert.equal(read(text, [{ kind: "item", who: "j", change: "gives", item: "i1", to: "b", quote: "Mira takes the ration" }])[0].to, "b");
  assert.equal(read(text, [{ kind: "item", who: "j", change: "gives", item: "i1", to: "mira", quote: "Mira takes the ration" }])[0].to, undefined);
  // A thing the world takes was never the player's word, whatever the reader ticked.
  assert.equal(read(text, [{ kind: "item", who: "j", change: "loses", item: "i1", said: true, quote: "Mira takes the ration" }])[0].said, undefined);
  // A reply that is no reading at all is told apart from one that found nothing.
  assert.equal(logic.checkItemMoves("I could not say.", { ...CONTEXT, text }), null);
  assert.deepEqual(logic.checkItemMoves('{"claims":[]}', { ...CONTEXT, text }), []);
  assert.equal(logic.copperOf("5 gp"), 500);
  assert.equal(logic.copperOf("2 rations"), null);
  assert.equal(logic.copperOf("5"), null, "a bare number is five of anything");
});

// ---- the rulings ----

const claim = (fields) => ({ kind: "item", character: "j", name: "Jason", change: "gives", item: "Rations (1 day)", carried: true, quote: "Mira takes the ration", ...fields });
const ok = (name, args) => ({ name, args, result: { ok: true } });

await test("A claim is recorded by a call of the turn that moved that thing that way for that character, and by no other.", () => {
  const given = claim({});
  assert.deepEqual(logic.unrecordedItems([given], []), [given]);
  assert.deepEqual(logic.unrecordedItems([given], [ok("remove_item", { characterId: "j", item: "Rations" })]), []);
  assert.deepEqual(logic.unrecordedItems([given], [ok("handle_item", { characterId: "j", action: "hand", item: "Rations (1 day)", toCharacterId: "b" })]), []);
  assert.deepEqual(logic.unrecordedItems([claim({ change: "uses" })], [ok("use_item", { characterId: "j", item: "Rations (1 day)" })]), []);
  // A night's rest eats what it eats.
  assert.deepEqual(logic.unrecordedItems([claim({ change: "uses" })], [ok("take_rest", { type: "long" })]), []);
  // Another character's call, another line, a call the rules refused, a line only put on: none of them recorded it.
  assert.equal(logic.unrecordedItems([given], [ok("remove_item", { characterId: "b", item: "Rations" })]).length, 1);
  assert.equal(logic.unrecordedItems([given], [ok("remove_item", { characterId: "j", item: "Waterskin" })]).length, 1);
  assert.equal(logic.unrecordedItems([given], [{ name: "remove_item", args: { characterId: "j", item: "Rations" }, result: { error: "no", refused: "rules" } }]).length, 1);
  assert.equal(logic.unrecordedItems([given], [ok("handle_item", { characterId: "j", action: "equip", item: "Rations (1 day)" })]).length, 1);
  // The same hand-off read in two parts of the narration is one.
  assert.equal(logic.unrecordedItems([given, claim({ quote: "the ration is hers" })], []).length, 1);
});

await test("A gain is recorded by a grant under any name, one grant a gain, and money by coin moved the same way.", () => {
  const ledger = claim({ change: "gains", item: "soot-stained ledger", carried: undefined, quote: "presses a ledger into your hands" });
  const key = claim({ change: "gains", item: "iron key", carried: undefined, quote: "and an iron key" });
  assert.deepEqual(logic.unrecordedItems([ledger], [ok("grant_item", { characterId: "j", items: [{ item: "Charred Ledger" }] })]), []);
  // Two things gained and one granted: the one of the same name is recorded, the other is not.
  assert.deepEqual(logic.unrecordedItems([ledger, key], [ok("grant_item", { characterId: "j", items: [{ item: "Iron Key" }] })]), [ledger]);
  assert.deepEqual(logic.unrecordedItems([ledger], [ok("handle_item", { characterId: "j", action: "pick_up", item: "Ledger" })]), []);
  assert.deepEqual(logic.unrecordedItems([ledger], [ok("party_award", { characterIds: ["j"], xp: 50, item: "Ledger" })]), []);
  const paid = claim({ item: "5 gp", copper: 500, carried: undefined, quote: "you count out five gold" });
  assert.equal(logic.unrecordedItems([paid], []).length, 1);
  assert.deepEqual(logic.unrecordedItems([paid], [ok("modify_gold", { characterId: "j", coins: "-5 gp" })]), []);
  assert.deepEqual(logic.unrecordedItems([paid], [ok("purchase", { characterId: "j", action: "buy", items: [{ item: "Rope" }] })]), []);
  assert.equal(logic.unrecordedItems([paid], [ok("modify_gold", { characterId: "j", coins: "+5 gp" })]).length, 1, "coin gained is not coin paid");
  assert.deepEqual(logic.unrecordedItems([claim({ change: "gains", item: "40 gp", copper: 4000, carried: undefined })], [ok("roll_treasure", { cr: 2 })]), []);
});

await test("The engine carries out only what the player's own words declared: a thing handed over or used from their pack, or coin they counted out.", () => {
  const input = { said: "I reach in my pack and hand her one of my rations.", language: "english", others: [{ id: "b", name: "Bram" }], receiverId: null, purse: 1200 };
  assert.deepEqual(logic.engineItemCall(claim({}), input), { name: "remove_item", args: { characterId: "j", item: "Rations (1 day)", reason: "Given away in the story" } });
  assert.equal(logic.engineItemCall(claim({ qty: 3 }), input).args.qty, 3);
  assert.deepEqual(logic.engineItemCall(claim({ change: "uses", item: "Potion of Healing" }), { ...input, said: "I drink my healing potion." }), { name: "use_item", args: { characterId: "j", item: "Potion of Healing" } });
  assert.equal(logic.engineItemCall(claim({ change: "gives", item: "Potion of Healing" }), { ...input, said: "I give the guard my healing potion." }).name, "remove_item");
  // Their player said nothing of it, or nothing at all: the narrator's to settle, never the engine's to invent.
  assert.equal(logic.engineItemCall(claim({}), { ...input, said: "I thank her and ask about Kethan." }), null);
  assert.equal(logic.engineItemCall(claim({}), { ...input, said: "" }), null);
  // Words in another language name no English line; the reader's reading of them does.
  const italian = { ...input, language: "italian", said: "Prendo una delle mie razioni e la do alla donna." };
  assert.equal(logic.engineItemCall(claim({}), italian), null);
  assert.equal(logic.engineItemCall(claim({ said: true }), italian).name, "remove_item");
  // A thing the world takes or gives is the narrator's.
  assert.equal(logic.engineItemCall(claim({ change: "loses" }), input), null);
  assert.equal(logic.engineItemCall(claim({ change: "gains", carried: undefined }), input), null);
  // Passed to a party member it is handed, never destroyed, and only when the reader read them receiving it.
  const toBram = { ...input, said: "I hand Bram one of my rations." };
  assert.equal(logic.engineItemCall(claim({}), toBram), null);
  const handed = { characterId: "j", action: "hand", item: "Rations (1 day)", toCharacterId: "b", reason: "Handed over in the story" };
  assert.deepEqual(logic.engineItemCall(claim({}), { ...toBram, receiverId: "b" }).args, handed);
  assert.deepEqual(logic.engineItemCall(claim({ to: "b" }), toBram).args, handed);
  assert.deepEqual(logic.engineItemCall(claim({ to: "b" }), { ...input, said: "I hand him one of my rations." }).args, handed, "named by the reader alone");
  assert.equal(logic.engineItemCall(claim({ to: "b" }), { ...input, others: [...input.others, { id: "k", name: "Kara" }], said: "I hand Kara one of my rations." }), null, "their words name someone else");
  // Coin: the amount their words wrote, from a purse that holds it, however the reader filed it leaving.
  const paid = claim({ item: "5 gp", copper: 500, carried: undefined });
  const fare = { name: "modify_gold", args: { characterId: "j", coins: "-5 gp", reason: "Paid in the story" } };
  assert.deepEqual(logic.engineItemCall(paid, { ...input, said: "I pay the ferryman 5 gold." }), fare);
  assert.deepEqual(logic.engineItemCall({ ...paid, change: "loses" }, { ...input, said: "I pay the ferryman 5 gold." }), fare);
  assert.deepEqual(logic.engineItemCall({ ...paid, said: true }, { ...input, said: "I pay the ferryman five gold." }), fare, "an amount in words, as the reader read it");
  assert.equal(logic.engineItemCall(paid, { ...input, said: "I pay the ferryman." }), null, "no amount of theirs");
  assert.equal(logic.engineItemCall({ ...paid, change: "loses" }, { ...input, said: "I walk on." }), null, "coin the world takes is the narrator's");
  assert.equal(logic.engineItemCall(paid, { ...input, said: "I pay the ferryman 5 gold.", purse: 300 }), null, "more than the purse holds");
});

await test("The narrator is told what moved, which tool makes each real, and that it may answer nothing changed hands.", () => {
  const prompt = logic.unrecordedItemsPrompt([claim({ change: "gains", item: "soot-stained ledger", carried: undefined, quote: "presses a ledger into your hands" }), claim({ change: "loses", qty: 2 })]);
  assert.match(prompt, /Jason gains soot-stained ledger \("presses a ledger into your hands"\)/);
  assert.match(prompt, /Jason loses 2 Rations \(1 day\)/);
  assert.match(prompt, /grant_item for a thing gained/);
  assert.match(prompt, /If nothing changed hands .* call no tool and give the same narration again/);
  assert.match(logic.itemNote([claim({ change: "gains", item: "soot-stained ledger", carried: undefined })]), /make it real now with grant_item; if it did not/);
});

// ---- whole turns ----

const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: true } });
const model = await fakeModel();
model.pointAt(world);
const { listActiveFacts } = await import("../src/lib/db/facts.ts");
const jason = world.addHero({
  name: "Jason",
  class: "fighter",
  level: 3,
  maxHp: 30,
  abilities: { str: 16 },
  proficiencies: TRAINED,
  gold: 12,
  equipment: [
    { name: "Longsword", qty: 1, equipped: true },
    { name: "Rations (1 day)", qty: 10 },
    { name: "Waterskin", qty: 1 },
  ],
});

const LONG = " The wind howls through the ruined courtyard, carrying the smell of ash and old snow down from the pines.";
const asked = () => model.requests.flatMap((request) => request.messages).filter((message) => message.role === "user").map((message) => String(message.content));
const pack = (name) => world.sheet(jason.id).equipment.find((item) => item.name === name)?.qty ?? 0;
const notes = () => listActiveFacts(world.campaignId).filter((fact) => fact.subject.startsWith("unrecorded item"));
const fresh = () =>
  world.patch(jason.id, {
    gold: 12,
    copper: 0,
    equipment: [
      { name: "Longsword", qty: 1, equipped: true },
      { name: "Rations (1 day)", qty: 10 },
      { name: "Waterskin", qty: 1 },
    ],
  });
const GIVEN = "Mira takes the ration";
const given = (quote = GIVEN) => ({ kind: "item", who: jason.id, change: "gives", item: "i2", said: true, quote });
const takes = (n) => `Mira takes the ration, her fingers brushing your glove${"!".repeat(n)} "You're a good man, Jason," she says quietly.${LONG}`;

await test("Issue 1097: a ration a player hands an NPC, told with no tool, leaves the pack, with no call back to the narrator and the story as it was told.", async () => {
  fresh();
  model.script([reply({ text: takes(0) })]);
  model.items([[given()], [given()]]);
  const message = await model.turn(world, '"I\'m sorry..." I reach in my pack and hand her one of my rations.', jason.id, jason.userId);
  assert.equal(pack("Rations (1 day)"), 9, "ten rations are nine");
  assert.match(message?.content ?? "", /Mira takes the ration/);
  assert.ok(!asked().some((text) => /no tool moved this turn/.test(text)), "the narrator was not sent back: the player's words settled it");
  assert.equal(model.requests.length, 1, "one narrator call");
  assert.equal(notes().length, 0);
});

await test("A hand-off the narrator recorded itself is not carried out twice.", async () => {
  fresh();
  model.script([reply({ calls: [call("remove_item", { characterId: jason.id, item: "Rations", qty: 1 })] }), reply({ text: takes(1) })]);
  model.items([[given()], [given()]]);
  await model.turn(world, "I hand her one of my rations.", jason.id, jason.userId);
  assert.equal(pack("Rations (1 day)"), 9);
  assert.ok(!asked().some((text) => /no tool moved this turn/.test(text)));
});

await test("A thing the world hands a hero in prose alone sends the narrator back once to grant it, and the pack holds it.", async () => {
  fresh();
  const pressed = `Mira presses a soot-stained ledger into your hands, charred at the edges but legible.${LONG}`;
  const gains = { kind: "item", who: jason.id, change: "gains", item: "soot-stained ledger", quote: "presses a soot-stained ledger into your hands" };
  model.script([
    reply({ text: pressed }),
    reply({ calls: [call("grant_item", { characterId: jason.id, items: [{ item: "Soot-stained Ledger", tags: [] }] })] }),
    reply({ text: pressed.replace("charred", "burnt") }),
  ]);
  model.items([[gains], [gains], [gains]]);
  const message = await model.turn(world, "Are you alright here by yourself?", jason.id, jason.userId);
  assert.ok(asked().some((text) => /no tool moved this turn/.test(text) && /Jason gains soot-stained ledger/.test(text)), asked().join("\n---\n").slice(0, 800));
  assert.equal(pack("Soot-stained Ledger"), 1, "the ledger is in the pack");
  assert.match(message?.content ?? "", /burnt at the edges/, "the moment is told again from the tool's result");
  assert.equal(notes().length, 0);
});

await test("A narrator that answers nothing changed hands keeps its story, nothing moves, and it reads a note next turn that the turn after clears.", async () => {
  fresh();
  const held = `Mira holds a soot-stained ledger out across the fire, waiting to see whether you will take it.${LONG}`;
  const gains = { kind: "item", who: jason.id, change: "gains", item: "soot-stained ledger", quote: "holds a soot-stained ledger out across the fire" };
  model.script([reply({ text: held }), reply({ text: held })]);
  model.items([[gains], [gains], [gains]]);
  const message = await model.turn(world, "What is that she carries?", jason.id, jason.userId);
  assert.equal(asked().filter((text) => /no tool moved this turn/.test(text)).length, 1, "sent back once, never twice");
  assert.equal(pack("soot-stained ledger"), 0);
  assert.match(message?.content ?? "", /holds a soot-stained ledger out/);
  assert.equal(notes().length, 1);
  assert.match(notes()[0].fact, /Jason gains soot-stained ledger .* make it real now with grant_item; if it did not/);
  // The next exchange moves nothing in prose: the note has had its turn.
  model.script([reply({ text: `Mira shrugs and tucks it back beneath her furs.${LONG}` })]);
  model.items([[]]);
  await model.turn(world, "I leave it with her.", jason.id, jason.userId);
  assert.equal(notes().length, 0, "a note lasts one exchange");
});

await test("A reply held back for a thing it moved stands when the narrator then tells nothing, and the move is left as a note (issues 1097 and 1100 together).", async () => {
  fresh();
  const pressed = `Mira presses a sealed letter into your hands, its wax stamped with a heron.${LONG}`;
  const gains = { kind: "item", who: jason.id, change: "gains", item: "sealed letter", quote: "presses a sealed letter into your hands" };
  model.script([reply({ text: pressed }), ...Array.from({ length: 8 }, () => reply({ text: "" }))]);
  model.items([[gains], [gains], [gains]]);
  const message = await model.turn(world, "Is there word from the village?", jason.id, jason.userId);
  assert.ok(asked().some((text) => /no tool moved this turn/.test(text)), "the reply was never sent back for the letter");
  assert.match(message?.content ?? "", /presses a sealed letter into your hands/, `the story the turn was told is gone: ${message?.content}`);
  assert.equal(pack("sealed letter"), 0, "nothing the narrator did not grant");
  assert.equal(notes().length, 1, "the letter nobody granted is a note for the GM");
});

await test("A thing the world takes in prose alone is the narrator's to record: the engine never takes what no player gave.", async () => {
  fresh();
  const stolen = `A small hand darts from the crowd and your waterskin is gone before you can turn.${LONG}`;
  const loses = { kind: "item", who: jason.id, change: "loses", item: "i3", quote: "your waterskin is gone" };
  model.script([reply({ text: stolen }), reply({ calls: [call("remove_item", { characterId: jason.id, item: "Waterskin" })] }), reply({ text: stolen.replace("small", "quick") })]);
  model.items([[loses], [loses], [loses]]);
  await model.turn(world, "I push through the market crowd.", jason.id, jason.userId);
  assert.ok(asked().some((text) => /Jason loses Waterskin/.test(text)));
  assert.equal(pack("Waterskin"), 0);
});

await test("Coin a player counts out and the story takes is paid from the purse; a gift the player never made is not.", async () => {
  fresh();
  const paid = { kind: "item", who: jason.id, change: "gives", item: "5 gp", quote: "The ferryman pockets the coins" };
  model.script([reply({ text: `The ferryman pockets the coins and waves you aboard.${LONG}` })]);
  model.items([[paid], [paid]]);
  await model.turn(world, "I pay the ferryman 5 gold for the crossing.", jason.id, jason.userId);
  assert.equal(world.sheet(jason.id).gold, 7, "twelve gold are seven");
  // The narrator has Jason hand a ration over that his player never offered:
  // sent back, it tells the moment again without it, and nothing leaves.
  fresh();
  // (Told in words of its own: a passage that repeats an earlier one is sent
  // back for that alone.)
  const uninvited = `Jason digs a ration from his pack and Mira accepts it without a word, turning it over in her soot-black hands.${LONG}`;
  model.script([reply({ text: uninvited }), reply({ text: `Mira only nods, her eyes on the fire.${LONG}` })]);
  model.items([[{ ...given("Mira accepts it without a word"), said: false }], []]);
  await model.turn(world, "I ask her where Kethan went.", jason.id, jason.userId);
  assert.equal(pack("Rations (1 day)"), 10, "nothing the player did not give");
  assert.ok(asked().some((text) => /Jason hands over Rations \(1 day\)/.test(text)));
});

await test("With the table's outcome check off nothing is read, and nothing moves.", async () => {
  fresh();
  const off = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
  model.pointAt(off);
  const hero = off.addHero({ name: "Jason", class: "fighter", level: 3, maxHp: 30, equipment: [{ name: "Rations (1 day)", qty: 10 }] });
  model.script([reply({ text: takes(3) })]);
  model.items([[{ kind: "item", who: hero.id, change: "gives", item: "Rations (1 day)", said: true, quote: GIVEN }]]);
  await model.turn(off, "I hand her one of my rations.", hero.id, hero.userId);
  assert.equal(off.sheet(hero.id).equipment.find((item) => item.name === "Rations (1 day)")?.qty, 10);
  assert.equal(model.itemRequests.length, 0, "no read is made");
  model.pointAt(world);
});

await test("In a fight the exchange is read only when a player's own words name something they carry that is no weapon; a potion they drink in prose alone is drunk.", async () => {
  fresh();
  world.patch(jason.id, { currentHp: 12, equipment: [...world.sheet(jason.id).equipment, { name: "Potion of Healing", qty: 2 }] });
  const kit = await combatKit(world);
  await kit.fight(1);
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 200, currentHp: 200 });
  kit.place(jason.id, 2, 2);
  kit.place(goblin.id, 6, 2);
  kit.giveTurn(jason.id);
  // A swing names a weapon: nothing is read, whatever the prose says.
  model.script([reply({ text: `Jason sets his feet and watches the goblin circle, blade low.${LONG}` })]);
  model.items([[{ kind: "item", who: jason.id, change: "gives", item: "Longsword", said: true, quote: "blade low" }]]);
  await model.turn(world, "I ready my longsword and wait for it to come to me.", jason.id, jason.userId);
  assert.equal(model.itemRequests.length, 0, "no read for a line about a weapon");
  assert.equal(pack("Longsword"), 1);
  // A potion named in their words is read, and drunk through use_item: the pack and the hit points both show it.
  const drunk = { kind: "item", who: jason.id, change: "uses", item: "Potion of Healing", said: true, quote: "drains the vial in one swallow" };
  model.script([reply({ text: `Jason pulls the cork with his teeth and drains the vial in one swallow, warmth spreading through his chest.${LONG}` })]);
  model.items([[drunk], [drunk]]);
  await model.turn(world, "I drink one of my Potions of Healing.", jason.id, jason.userId);
  assert.ok(model.itemRequests.length >= 1, "the exchange was read");
  assert.equal(pack("Potion of Healing"), 1, "one potion drunk");
  assert.ok(world.sheet(jason.id).currentHp > 12, `healed (${world.sheet(jason.id).currentHp})`);
  await kit.endFight();
});

await test("A connected agent program's narration is read the same way and told what it moved, never done for it.", async () => {
  fresh();
  const { readAgentNarration } = await import("../src/lib/dm/agent-turn.ts");
  const campaigns = await import("../src/lib/db/campaigns.ts");
  const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
  insertCampaignMessage({ campaignId: world.campaignId, seq: campaigns.allocateSeq(world.campaignId), authorType: "player", userId: jason.userId, characterId: jason.id, content: "I hand her one of my rations." });
  model.items([[given("Mira takes the ration")]]);
  const told = await readAgentNarration(campaigns.getCampaignById(world.campaignId), `Mira takes the ration and tucks it beneath her furs.${LONG}`);
  assert.equal(told.problem, null, "the narration stands");
  assert.equal(pack("Rations (1 day)"), 10, "the program is the GM: nothing is taken for it");
  assert.equal(notes().length, 1);
  assert.match(notes()[0].fact, /Jason hands over Rations \(1 day\) .* make it real now with remove_item/);
});

model.close();
await finish();
