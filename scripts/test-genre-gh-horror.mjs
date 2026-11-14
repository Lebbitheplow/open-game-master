// The horror classes' features wired in the cc1113 genre-c completeness pass
// (ids GH..): each case fails without its mechanism, and the clause ledger
// (scripts/clauses/genre-horror.json) points here for the clauses it holds.
import assert from "node:assert/strict";
import { dice, clearDice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const { focusProblem } = await load("lib/dm/cast-materials.ts");
const { bundledSpellFacts } = await load("lib/srd/spell-facts.ts");
const { classSpellGrants, offListProblems } = await load("lib/srd/class-spell-grants.ts");
const { mysticArcanumTop } = await load("lib/srd/spell-prep.ts");
const { marginaliaProblem } = await load("lib/srd/genre-gh-horror-spells.ts");

const { test, finish } = suite("test-genre-gh-horror");
const rig = await clausesRig();
const { world, kit } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    await kit.endFight();
    rig.reset();
  }
};

// ---- GH01: the horror casters' focus ----

const caster = (classId, feature, equipment) => ({ name: "Caster", class: classId, classes: [], features: [{ name: feature }], equipment });
const focusCases = [
  ["exorcist", "Liturgy", "Bless", [{ name: "Holy Symbol", qty: 1 }], [{ name: "Ritual Kit", qty: 1 }], [{ name: "Wand", qty: 1 }]],
  ["occultist", "Pact of the Page", "Hex", [{ name: "Grimoire", qty: 1 }], [{ name: "Spellbook", qty: 1 }], [{ name: "Holy Symbol", qty: 1 }]],
  ["parapsychologist", "Applied Theory", "Mage Armor", [{ name: "Field Instruments", qty: 1 }], [{ name: "Field Instruments", qty: 1 }], [{ name: "Holy Symbol", qty: 1 }]],
];
for (const [classId, feature, spell, focus, other, wrong] of focusCases) {
  await test(`${feature}: a ${classId}'s material spell needs the focus the feature names (or a pouch), and another class's focus is refused`, () => {
    const facts = bundledSpellFacts(spell);
    assert.ok(facts?.material, `${spell} has no material component`);
    assert.equal(focusProblem(caster(classId, feature, focus), facts), null, `${feature}: ${focus[0].name} was refused`);
    assert.equal(focusProblem(caster(classId, feature, other), facts), null, `${feature}: ${other[0].name} was refused`);
    assert.equal(focusProblem(caster(classId, feature, [{ name: "Component Pouch", qty: 1 }]), facts), null, `${feature}: a component pouch was refused`);
    assert.match(focusProblem(caster(classId, feature, wrong), facts)?.error ?? "accepted", new RegExp(feature), `${feature}: ${wrong[0].name} served as the focus`);
  });
}

// ---- GH02: Hunted Instincts ----

await run("Hunted Instincts: an apostate rolls initiative with advantage while a cultist is in the fight, and not against goblins or without the feature", async () => {
  const row = feature("apostate", "Hunted Instincts", 7);
  const hero = rig.holder(row);
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  assert.doesNotMatch(rig.initiative(hero), /2d20/, "advantage on initiative against goblins");
  await kit.endFight();
  await world.beginFight([{ monster: "cultist", count: 1 }]);
  assert.equal(world.enemies()[0]?.slug, "cultist", "the fight holds no cultist");
  const { on, off } = await rig.both(hero, row, async () => rig.initiative(hero));
  assert.match(on, /2d20/, `initiative ${on} with a cultist present`);
  assert.doesNotMatch(off, /2d20/, "advantage without the feature");
});

// ---- GH03: spells past the list and past the slots ----

const offList = (grants, strays) => offListProblems({ grants, allowedBefore: grants.anyList, kept: 0, strays, list: "warlock", label: "level 10 occultist" });

await test("Marginalia: a 10th-level occultist holds two rituals from any list on top of their spells known, and a non-ritual off the list is refused", () => {
  const grants = classSpellGrants({ classId: "occultist", level: 10, features: [{ name: "Marginalia" }] });
  assert.equal(grants.anyList, 2, "Marginalia's picks");
  assert.equal(grants.extraSpells, 2, "the picks sit on top of the spells known");
  assert.deepEqual(offList(grants, [{ name: "Detect Magic", cantrip: false, ritual: true }, { name: "Alarm", cantrip: false, ritual: true }]), []);
  assert.equal(offList(grants, [{ name: "Fireball", cantrip: false, ritual: false }]).length, 1, "a non-ritual off the list was taken");
  assert.equal(classSpellGrants({ classId: "occultist", level: 9 }).anyList, 0, "Marginalia before 10th level");
});

await test("Marginalia: a spell it brought is cast as a ritual only, and a warlock spell is cast as ever", () => {
  const sheet = { name: "Inkwell", class: "occultist", classes: [], features: [{ name: "Marginalia" }] };
  assert.match(marginaliaProblem(sheet, bundledSpellFacts("Detect Magic"), false) ?? "cast", /ritual only/);
  assert.equal(marginaliaProblem(sheet, bundledSpellFacts("Detect Magic"), true), null);
  assert.equal(marginaliaProblem(sheet, bundledSpellFacts("Hex"), false), null);
});

await test("Unified Theory: a 17th-level parapsychologist holds three spells from any list, cast as the class's own", () => {
  const grants = classSpellGrants({ classId: "parapsychologist", level: 17, features: [{ name: "Unified Theory" }] });
  assert.equal(grants.anyList, 3);
  assert.deepEqual(offListProblems({ grants, allowedBefore: 3, kept: 0, strays: [{ name: "Bless", cantrip: false }, { name: "Cure Wounds", cantrip: false }, { name: "Hex", cantrip: false }], list: "wizard", label: "parapsychologist" }), []);
  assert.equal(classSpellGrants({ classId: "parapsychologist", level: 16 }).anyList, 0);
});

await test("Apocrypha and Seventh Seal: an occultist's list reaches a 6th-level spell at 13th and a 7th-level one at 17th, and no further", () => {
  assert.deepEqual([12, 13, 16, 17, 20].map((level) => mysticArcanumTop("occultist", level)), [0, 6, 6, 7, 7]);
});

// ---- GH04: plays of the horror counters ----

const spend = (hero, resource, args = {}) => world.invoke("use_resource", { characterId: hero.id, resource, reason: "probe", ...args });
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
async function failedSave(who, ability, condition) {
  clearDice();
  dice(2);
  rig.must(await world.invoke("request_roll", { characterId: who.id, kind: "saving_throw", ability, dc: 15, reason: "probe" }), "the save");
  if (condition) world.patch(who.id, { conditions: [condition], conditionMeta: { [condition]: { saveEnds: { ability, dc: 15 } } } });
}

await run("Peer Review: an ally's failed WIS save is rolled again, a success ends what the save would have ended, and the use is spent; a failed STR save is not its to reroll", async () => {
  const hero = rig.holder(feature("parapsychologist", "Peer Review", 6));
  await failedSave(rig.ally, "str");
  assert.ok((await spend(hero, "Peer Review", { targetCharacterId: rig.ally.id })).error, "a failed STR save was rerolled");
  await failedSave(rig.ally, "wis", "frightened");
  dice(19);
  const out = rig.must(await spend(hero, "Peer Review", { targetCharacterId: rig.ally.id }), "Peer Review");
  assert.match(JSON.stringify(out), /success/);
  assert.deepEqual(world.sheet(rig.ally.id).conditions, [], "the fear the save ends still holds");
  assert.equal(used(hero, "horror_peer_review"), 1);
});

await run("The Final Chapter: the occultist's own save is rolled again and the reroll stands; an attack on them is answered by its reaction", async () => {
  const hero = rig.holder(feature("occultist", "The Final Chapter", 18));
  await failedSave(hero, "con", "poisoned");
  dice(18);
  const out = rig.must(await spend(hero, "The Final Chapter"), "The Final Chapter");
  assert.match(JSON.stringify(out), /success/);
  assert.deepEqual(world.sheet(hero.id).conditions, []);
  assert.equal(used(hero, "horror_the_final_chapter"), 1);
  const { authored: held } = rig.engineHooks(hero, { name: "The Final Chapter" });
  assert.ok(held.length, "no authored row answers The Final Chapter");
});

await run("Rite of Severance: an exorcist's Wisdom contest, with advantage, expels the entity possessing an ally", async () => {
  const hero = rig.holder(feature("exorcist", "Rite of Severance", 15));
  world.patch(rig.ally.id, { conditions: ["possessed"], conditionMeta: {} });
  clearDice();
  dice(18, 3, 2);
  const out = rig.must(await spend(hero, "Rite of Severance", { targetCharacterId: rig.ally.id }), "Rite of Severance");
  assert.match(JSON.stringify(out), /expelled/);
  assert.deepEqual(world.sheet(rig.ally.id).conditions, []);
  assert.ok((await spend(hero, "Rite of Severance", { targetCharacterId: rig.ally.id })).error, "a second rite on a free host");
});

await run("Stitch the Tear: a summoned creature of CR 5 or lower is sent back, and one that was not summoned is refused", async () => {
  const hero = rig.holder(feature("occultist", "Stitch the Tear", 7));
  const { near, far } = await rig.fight(hero);
  assert.ok((await spend(hero, "Stitch the Tear", { targetEnemyId: near.id })).error, "a creature never summoned was sent back");
  kit.setEnemy(far.id, { conditions: ["summoned"] });
  rig.must(await spend(hero, "Stitch the Tear", { targetEnemyId: far.id }), "Stitch the Tear");
  assert.notEqual(kit.enemy(far.id).status, "alive", "the summoned creature is still here");
  assert.equal(used(hero, "horror_stitch_the_tear"), 1);
});

// ---- GH05: marks a spell reads ----

const { genreCastsAtMaximum, genreFreeCast } = await load("lib/dm/genre-a-casts.ts");
const { proofUnresisted } = await load("lib/dm/genre-gh-proof.ts");
const { enemyCounterspell } = await load("lib/dm/enemy-reactions.ts");

await run("Proof: the spend marks the parapsychologist's next spell, cast at its maximum and not resisted by Legendary Resistance", async () => {
  const hero = rig.holder(feature("parapsychologist", "Proof", 20));
  assert.equal(genreCastsAtMaximum(world.sheet(hero.id), 3), null);
  rig.must(await spend(hero, "Proof"), "Proof");
  const sheet = world.sheet(hero.id);
  assert.equal(genreCastsAtMaximum(sheet, 3), "Proof", "the spell is not cast at its maximum");
  assert.equal(proofUnresisted(true, sheet), false, "Legendary Resistance may still be spent");
  assert.equal(proofUnresisted(true, { conditions: [] }), true);
  assert.equal(used(hero, "horror_proof"), 1);
});

await run("Ritual Echo: spent after a stigmata, the same spell of 2nd level or lower is cast again with no slot, and a 3rd-level one is not", async () => {
  const hero = rig.holder(feature("apostate", "Ritual Echo", 6));
  rig.must(await spend(hero, "Ritual Echo"), "Ritual Echo");
  const sheet = world.sheet(hero.id);
  assert.equal(genreFreeCast(sheet, bundledSpellFacts("Hold Person"), undefined)?.row.feature, "Ritual Echo");
  assert.equal(genreFreeCast(sheet, bundledSpellFacts("Fireball"), undefined)?.row.feature ?? null, null);
});

await run("The Rite Completed: for a minute no enemy's Counterspell is tried on the apostate's spells", async () => {
  const hero = rig.holder(feature("apostate", "The Rite Completed", 14));
  rig.must(await spend(hero, "The Rite Completed"), "The Rite Completed");
  const sheet = world.sheet(hero.id);
  assert.ok(sheet.conditions.includes("the rite completed"), `conditions ${sheet.conditions}`);
  assert.equal(enemyCounterspell(world.campaign().id, null, { id: "none" }, sheet, "Hold Person", 2), null);
});

rig.world.close();
finish();
