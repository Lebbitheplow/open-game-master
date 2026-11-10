// Builder sweep, part 4: one workshop thing of each kind a character stands
// on (a class, a subclass of it, a subclass of a published class, a species,
// a background, a spell on the class's list, a feat, an item), driven through
// every door a published one goes through.
//
// The table's GM writes them through the real save route; a player at that
// table then meets each door in turn. A row is one kind at one door, and the
// question is the same at each: does the door know the table's own thing as
// it knows a published one (issue #833's "Unknown class" was one door of
// this table; the level-up offer, the GM's tools and the companion door are
// others).
//
//   offer:<kind>      the table's builder lists it
//   build             a character of the workshop class, species and
//                     background fills, passes the gate and is seated
//   levelup-offer     GET /sheet/level-up reads the class
//   climb             levels 2 to 5 through the offer, the workshop subclass
//                     taken at 3, nothing owed, and the same class features
//                     as the character made at 5
//   library           the author's own library door takes the same build
//   tool:<name>       the GM's tool takes the workshop spell, item and class
//                     (learn_spell, grant_item, add_companion)
//   rename:<kind>     renamed through the entry route, the seated sheet
//                     follows
//   deleted:<kind>    deleted through the entry route, the delete is refused
//                     naming the character, or the character's next level
//                     still goes through with nothing newly owed
//
// Import scripts/lib/enforce-world.mjs first.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { assertClean, assertOffered, openLevelSweep, twinDifferences } from "./lib/sweep-builder-levelup.mjs";
import { doors, key, openSweepBuilder } from "./lib/sweep-builder.mjs";
import * as known from "./lib/sweep-builder-known-workshop.mjs";

const nopack = process.env.CONTENT_DB_PATH === "/nonexistent";
const prefix = nopack ? "nopack-workshop" : "workshop";
const rows = sweepRows(`test-enforce-sweep-builder-${nopack ? "workshop-nopack" : "workshop"}`, {
  KNOWN: expand((nopack ? known.KNOWN_WORKSHOP_NOPACK : known.KNOWN_WORKSHOP) ?? []),
  SKIP: (nopack ? known.SKIP_WORKSHOP_NOPACK : known.SKIP_WORKSHOP) ?? {},
});

const { workshopClassId } = await import("../src/lib/homebrew/class-data.ts");
const { bundledBackgroundRows } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");

const made = {};
async function brewAll(creation) {
  const { world } = creation;
  const homebrew = await world.route("homebrew");
  async function brew(kind, name, data) {
    world.signIn(world.owner);
    const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind, name, data }) }));
    const body = await response.json();
    assert.equal(response.status, 201, `saving the ${kind} "${name}": ${JSON.stringify(body).slice(0, 300)}`);
    return body.entry;
  }
  made.klass = await brew("class", "Spellblade", {
    desc: "A warrior who folds a wizard's spells into the swing of a blade.",
    hitDie: 10,
    saves: ["str", "int"],
    skillChoices: { count: 2, from: ["arcana", "athletics", "history", "perception"] },
    armor: ["light", "medium"],
    weapons: ["simple", "martial"],
    tools: [],
    casterType: "half",
    spellListFrom: "wizard",
    spellAbility: "int",
    subclassLevel: 3,
    levels: {
      1: [{ n: "Arcane Strike", d: "Once a turn, a weapon hit deals an extra 1d8 force damage." }],
      4: [{ n: "Ability Score Improvement", d: "Raise one ability score by 2, or two by 1, or take a feat." }],
      5: [{ n: "Extra Attack", d: "Attack twice when you take the Attack action." }],
    },
  });
  made.classId = workshopClassId(made.klass.id);
  made.subclass = await brew("archetype", "Order of Ash", { desc: "", classSlug: made.classId, levels: { 3: [{ n: "Ashen Ward", d: "Resistance to fire damage." }] } });
  made.fighterSubclass = await brew("archetype", "Knights of the Ember", { desc: "", classSlug: "fighter", levels: { 3: [{ n: "Ember Guard", d: "You stand firm." }] } });
  made.race = await brew("race", "Emberkin", {
    asi: [{ attributes: ["Charisma"], value: 2 }, { attributes: ["Dexterity"], value: 1 }],
    speed: { walk: 30 },
    size: "Medium",
    languages: ["Common"],
    traits: "**_Ember Blood._** Your veins run hot.",
  });
  made.raceId = `homebrew:${made.race.id}`;
  const [criminal] = bundledBackgroundRows("criminal", []).filter((entry) => entry.slug === "criminal");
  made.background = await brew("background", "Fence", draftFromCatalog("background", criminal).data);
  made.backgroundId = `homebrew:${made.background.id}`;
  made.spell = await brew("spell", "Ashbolt", { level: 1, school: "evocation", desc: "A bolt of ash. Make a ranged spell attack; on a hit the target takes 2d6 fire damage.", classes: [made.classId] });
  made.feat = await brew("feat", "Fleetfoot", { desc: "You are quick on your feet. Your speed increases by 10 feet.", prerequisite: "" });
  made.item = await brew("item", "Cinderbrand", {
    itemKind: "magic_item",
    requiresAttunement: false,
    weapon: { category: "martial", kind: "melee", damage: "1d8 slashing", properties: ["versatile"] },
    weaponRiders: { bonus: 1 },
  });
}

const sweep = await openLevelSweep({ prepare: brewAll });
const { sb, world, campaignId, player } = sweep;
const entryRoute = await world.route("homebrew/[id]");

// ---- the builder's lists ----
const offers = {
  class: () => sb.classes.some((entry) => entry.id === made.classId),
  species: () => sb.races.some((entry) => entry.id === made.raceId),
  background: () => sb.backgrounds.some((entry) => entry.id === made.backgroundId),
  "subclass-of-workshop-class": async () => (await sb.subclassesOf(made.classId)).some((entry) => entry.name === "Order of Ash"),
  "subclass-of-published-class": async () => (await sb.subclassesOf("fighter")).some((entry) => entry.name === "Knights of the Ember"),
  "spell-on-class-list": async () => (await sb.spellPool(made.classId, 1)).some((entry) => entry.name === "Ashbolt"),
  feat: async () => ((await sb.content("feats", "q=Fleetfoot&limit=20")).results ?? []).some((entry) => entry.name === "Fleetfoot"),
  item: async () => ((await sb.content("items", "q=Cinderbrand&limit=20")).results ?? []).some((entry) => entry.name === "Cinderbrand"),
};
for (const [kind, offered] of Object.entries(offers)) {
  await rows.row(`${prefix}:offer:${kind}`, async () => {
    assert.ok(await offered(), `the table's builder does not list the workshop ${kind}`);
  });
}

// ---- built, seated, levelled ----
let seated = null;
await rows.row(`${prefix}:build`, async () => {
  seated = await sweep.seat({ level: 1, classId: made.classId, raceId: made.raceId, backgroundId: made.backgroundId });
  const stored = sweep.sheet();
  assert.equal(stored.class, made.classId);
  assert.equal(stored.race, made.raceId);
  assert.equal(stored.background, made.backgroundId);
});
await rows.row(`${prefix}:levelup-offer`, async () => {
  assert.ok(seated, "no seated character to level");
  const offered = await sweep.offer();
  assert.equal(offered.status, 200, `GET /sheet/level-up answered ${offered.status}: ${JSON.stringify(offered.json).slice(0, 200)}`);
  assert.equal(offered.json.ready, true, offered.json.notReady);
});
let walk = null;
await rows.row(`${prefix}:climb`, async () => {
  assert.ok(seated, "no seated character to level");
  walk = await sweep.climb({ to: 5, subclass: "Order of Ash" });
  assertClean(walk, "1 to 5");
  assertOffered(walk, "1 to 5");
  assert.equal(walk.sheet.subclass, "Order of Ash");
  for (const feature of ["Arcane Strike", "Extra Attack", "Ashen Ward"]) {
    assert.ok(walk.sheet.features.some((entry) => key(entry.name) === key(feature)), `grown to 5 without ${feature}: ${walk.sheet.features.map((entry) => entry.name).join(", ")}`);
  }
  assert.ok(Object.keys(walk.sheet.spellcasting?.slots ?? {}).length > 0, "a half caster at 5 with no spell slots");
});
await rows.row(`${prefix}:twin`, async () => {
  assert.ok(walk, "no grown character to set a twin beside");
  // Made in the author's own library: another table would have another GM,
  // whose workshop this is not.
  const own = await openSweepBuilder({ world, user: world.owner });
  const { fields } = await own.fill(own.fresh({ level: 5, classId: made.classId, subclass: "Order of Ash", raceId: made.raceId, backgroundId: made.backgroundId }));
  const built = own.derive(fields);
  assert.equal(built.blocker, null, `the author's builder refuses the level 5 twin: ${JSON.stringify(built.blocker)}`);
  const stored = await doors({ creation: sweep.creation }).library(built, world.owner);
  assert.ok(stored.ok, `the author's library refused the level 5 twin (${stored.status}): ${stored.error}`);
  // A library sheet carries no counters: features, slots, hit dice, training.
  const differences = twinDifferences({ ...walk.sheet, resources: {} }, { ...stored.sheet, resources: {} });
  assert.ok(!differences.length, `grown to 5 and made at 5 differ: ${differences.join(" | ")}`);
});

// ---- the GM's tools ----
const hero = () => sweep.sheet();
await rows.row(`${prefix}:tool:learn_spell`, async () => {
  assert.ok(seated, "no seated character");
  const out = await world.invoke("learn_spell", { characterId: hero().id, action: "add", spell: "Ashbolt", reason: "taught by the order" });
  assert.ok(out.ok && !out.result?.error, `learn_spell Ashbolt: ${JSON.stringify(out).slice(0, 300)}`);
  const casting = hero().spellcasting ?? {};
  const held = [casting.known, casting.prepared, casting.spellbook, ...(casting.casters ?? []).flatMap((entry) => [entry.known, entry.prepared, entry.spellbook])].flat().filter(Boolean);
  assert.ok(held.some((name) => key(name) === "ashbolt"), `the sheet does not hold Ashbolt: ${JSON.stringify(held)}`);
});
await rows.row(`${prefix}:tool:grant_item`, async () => {
  assert.ok(seated, "no seated character");
  const out = await world.invoke("grant_item", { characterId: hero().id, item: "Cinderbrand", qty: 1, reason: "a gift" });
  assert.ok(out.ok && !out.result?.error, `grant_item Cinderbrand: ${JSON.stringify(out).slice(0, 300)}`);
  const line = hero().equipment.find((entry) => key(entry.name) === "cinderbrand");
  assert.ok(line, "the sheet holds no Cinderbrand");
  // The line carries the workshop item's own block, not a published
  // Cinderbrand's or a bare name (issue #758's family).
  assert.equal(line.gear?.weapon?.damage, "1d8 slashing", `the line does not carry the workshop item's own entry: ${JSON.stringify(line)}`);
  assert.equal(line.gear?.def?.weapon?.bonus, 1, `the line lost the item's +1: ${JSON.stringify(line)}`);
});
await rows.row(`${prefix}:tool:add_companion`, async () => {
  const out = await world.invoke("add_companion", { name: "Sable", class: made.classId, race: "human", gender: "female", level: 3, kind: "party", personality: "Dry and watchful." });
  assert.ok(out.ok && !out.result?.error, `add_companion of the workshop class: ${JSON.stringify(out).slice(0, 300)}`);
});
await rows.row(`${prefix}:tool:add_companion-by-name`, async () => {
  // What a GM types, and what a model writes: the class as the table calls it.
  const out = await world.invoke("add_companion", { name: "Wren", class: "Spellblade", race: "human", gender: "male", level: 3, kind: "party", personality: "Quick to laugh." });
  assert.ok(out.ok && !out.result?.error, `add_companion class "Spellblade": ${JSON.stringify(out).slice(0, 300)}`);
});

// ---- renamed ----
async function rename(entry, name) {
  world.signIn(world.owner);
  const response = await entryRoute.PATCH(new Request("http://test/", { method: "PATCH", body: JSON.stringify({ name }) }), { params: Promise.resolve({ id: entry.id }) });
  const body = await response.json();
  assert.ok(response.status < 400, `renaming "${entry.name}" to "${name}": ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
}
await rows.row(`${prefix}:rename:subclass`, async () => {
  assert.ok(walk, "no levelled character holds the subclass");
  await rename(made.subclass, "Order of Cinders");
  assert.equal(hero().subclass, "Order of Cinders", "the seated sheet kept the old subclass name");
  assert.ok(hero().features.some((entry) => key(entry.name) === "ashen ward"), "the renamed subclass's feature left the sheet");
});
await rows.row(`${prefix}:rename:spell`, async () => {
  assert.ok(seated, "no seated character");
  await rename(made.spell, "Cinderbolt");
  const casting = hero().spellcasting ?? {};
  const held = [casting.known, casting.prepared, casting.spellbook, ...(casting.casters ?? []).flatMap((entry) => [entry.known, entry.prepared, entry.spellbook])].flat().filter(Boolean).map(key);
  assert.ok(!held.includes("ashbolt"), `the sheet still names Ashbolt: ${JSON.stringify(held)}`);
  assert.ok((await (await openSweepBuilder({ world, user: player, campaignId })).spellPool(made.classId, 1)).some((entry) => entry.name === "Cinderbolt"), "the class's list does not offer the renamed spell");
});
await rows.row(`${prefix}:rename:class`, async () => {
  assert.ok(seated, "no seated character");
  await rename(made.klass, "Ashblade");
  const offered = await sweep.offer();
  assert.equal(offered.status, 200, `after the class was renamed GET /sheet/level-up answers ${offered.status}: ${JSON.stringify(offered.json).slice(0, 200)}`);
  // The id is the class's key and may be named as one; no sentence a
  // player reads may spell it out (PR #839, "workshop ids in sentences").
  const sentences = [offered.json.notReady, ...(offered.json.owedFromEarlierLevels ?? []), ...(offered.json.hitPoints?.extras ?? []), offered.json.choices?.spells?.note].filter(Boolean).join(" ");
  assert.doesNotMatch(sentences, /homebrew[- ][0-9a-f]{4}/, `a sentence of the offer spells out the class's id: ${sentences.slice(0, 200)}`);
});
await rows.row(`${prefix}:rename:species-and-background`, async () => {
  assert.ok(seated, "no seated character");
  await rename(made.race, "Cinderkin");
  await rename(made.background, "Broker");
  const stored = hero();
  assert.equal(stored.raceLabel, "Cinderkin", `the sheet shows the species as ${stored.raceLabel}`);
});

// ---- taken away (package brief part 5) ----
// A stored pick whose content is deleted must not stop what the player does
// next (PR #840: "A stored pick whose option had been deleted refused a later
// save or level-up"). Either the workshop refuses to delete what a seated
// character stands on, or the next level-up still goes through.
async function remove(entry) {
  world.signIn(world.owner);
  const response = await entryRoute.DELETE(new Request("http://test/", { method: "DELETE" }), { params: Promise.resolve({ id: entry.id }) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
for (const [kind, entry, to] of [["spell", () => made.spell, 6], ["feat", () => made.feat, 7], ["subclass", () => made.subclass, 8], ["species", () => made.race, 9], ["background", () => made.background, 10], ["class", () => made.klass, 11]]) {
  await rows.row(`${prefix}:deleted:${kind}`, async () => {
    assert.ok(walk, "no levelled character");
    const before = hero();
    const gone = await remove(entry());
    if (gone.status >= 400) {
      assert.match(JSON.stringify(gone.body), new RegExp(before.name, "i"), `the delete was refused without naming who stands on it: ${JSON.stringify(gone.body).slice(0, 200)}`);
      return;
    }
    const offered = await sweep.offer();
    assert.equal(offered.status, 200, `with the ${kind} deleted GET /sheet/level-up answers ${offered.status}: ${JSON.stringify(offered.json).slice(0, 240)}`);
    const next = await sweep.climb({ to });
    assert.equal(next.sheet.level, to);
    assertClean(next, `after the ${kind} was deleted`);
  });
}

sweep.close();
rows.finish();
