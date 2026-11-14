// The horror classes' features wired in the cc1113 genre-c completeness pass
// (ids GH..): each case fails without its mechanism, and the clause ledger
// (scripts/clauses/genre-horror.json) points here for the clauses it holds.
import assert from "node:assert/strict";
import { dice, clearDice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { afterRollKit } from "./lib/sweep-clauses-mt-mr.mjs";

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

// ---- GH07: the wards ----

const { getClock } = await load("lib/db/clock.ts");
const { getCampaignById } = await load("lib/db/campaigns.ts");
const { getBattleMapForEncounter, listTokens } = await load("lib/db/battle-maps.ts");
const { layStandingWards } = await load("lib/dm/genre-gh-wards.ts");
const { liveZones, saveZones } = await load("lib/dm/zone-store.ts");
const { zonesAfterMove } = await load("lib/dm/zone-triggers.ts");
const { horrorTeleportRefusal } = await load("lib/dm/genre-a-horror-wards.ts");
const { withEdges, BARRED } = await load("lib/battlemap/zones-movers.ts");
const { tileIndex } = await load("lib/battlemap/types.ts");

const minute = () => getClock(world.campaignId).instant;
const boardMap = () => getBattleMapForEncounter(world.encounter().id);
const zones = () => liveZones(boardMap(), world.encounter());
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
const typed = (enemy, type) => kit.setEnemy(enemy.id, { stats: { ...kit.enemy(enemy.id).stats, type } });
const withFeature = (hero, name) => world.patch(hero.id, { features: [...world.sheet(hero.id).features, { ...world.sheet(hero.id).features[0], name }] });
// The ward set out of a fight, the minutes it took on the clock.
async function setWard(hero, name) {
  await kit.endFight();
  const before = minute();
  rig.must(await spend(hero, name), name);
  return minute() - before;
}
// The fight begun at the ward's place, its board's areas laid again where
// the setter now stands (the fight's opening placed everyone at random).
async function fightInWard(hero) {
  // kit.fight, not rig.fight: rig.fight clears every condition first.
  await kit.fight(2, { heroFaces: { [hero.id]: 19, [rig.ally.id]: 3 } });
  const [near, far] = world.enemies();
  for (const enemy of [near, far]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  assert.ok(zones().length, "the fight's board holds no ward");
  saveZones(boardMap().id, []);
  kit.place(hero.id, 5, 2);
  kit.place(rig.ally.id, 5, 3);
  kit.place(near.id, 6, 2);
  kit.place(far.id, 18, 2);
  rig.myTurn(hero);
  return { near: kit.enemy(near.id), far: kit.enemy(far.id) };
}
const lay = () => layStandingWards(world.campaignId);
function walk(enemy, from, path) {
  kit.place(enemy.id, from.x, from.y);
  return zonesAfterMove(getCampaignById(world.campaignId), world.encounter().id, { kind: "enemy", refId: enemy.id }, from, path);
}

await run("Sanctified Ground: ten minutes of ritual (one with Wax and Wick), refused in a fight; a fight begun there holds it, and a hostile spirit walking in is seen and takes 1d8 radiant while a humanoid takes nothing", async () => {
  const hero = rig.holder(feature("exorcist", "Sanctified Ground", 5));
  world.patch(hero.id, { features: world.sheet(hero.id).features.filter((entry) => entry.name !== "Wax and Wick") });
  assert.equal(await setWard(hero, "Sanctified Ground"), 10, "the ritual's minutes");
  assert.ok(world.sheet(hero.id).conditions.includes("sanctified ground"), "the ward holds nowhere");
  const { near, far } = await fightInWard(hero);
  assert.ok((await spend(hero, "Sanctified Ground")).error, "a ten-minute ritual made in a fight");
  lay();
  typed(far, "undead");
  kit.setEnemy(far.id, { conditions: ["invisible"] });
  clearDice();
  dice(5);
  walk(far, { x: 10, y: 2 }, [{ x: 9, y: 2 }, { x: 8, y: 2 }, { x: 7, y: 2 }]);
  clearDice();
  assert.equal(lost(far), 5, `the spirit entering lost ${lost(far)}`);
  assert.deepEqual(kit.enemy(far.id).conditions, [], "the spirit is still unseen inside");
  typed(near, "humanoid");
  dice(5);
  walk(near, { x: 10, y: 4 }, [{ x: 9, y: 4 }, { x: 8, y: 4 }, { x: 7, y: 4 }]);
  clearDice();
  assert.equal(lost(near), 0, "a humanoid walking in was burned");
  rig.must(await world.invoke("end_encounter", { outcome: "truce" }), "end_encounter");
  assert.ok(world.sheet(hero.id).conditions.includes("sanctified ground"), "the eight-hour ward ended with the fight");
  withFeature(hero, "Wax and Wick");
  assert.equal(await setWard(hero, "Sanctified Ground"), 1, "Wax and Wick's minute");
});

await run("Warding Sigil: a minute's chalk-work; the first hostile creature crossing makes an INT save or takes 2d6 psychic, half on a success, and the sigil is spent; Rite of the Threshold covers 15 feet an ethereal creature cannot cross", async () => {
  const hero = rig.holder(feature("occultist", "Warding Sigil", 9));
  world.patch(hero.id, { features: world.sheet(hero.id).features.filter((entry) => entry.name !== "Rite of the Threshold") });
  assert.equal(await setWard(hero, "Warding Sigil"), 1, "the chalk-work's minutes");
  const { near, far } = await fightInWard(hero);
  kit.place(near.id, 12, 2);
  kit.place(far.id, 9, 2);
  lay();
  const [sigil] = zones();
  assert.deepEqual([sigil?.cells.length, sigil?.origin.x], [1, 6], "the sigil is not the square beside the occultist toward the foe");
  clearDice();
  dice(2, 4, 4);
  walk(far, { x: 9, y: 2 }, [{ x: 8, y: 2 }, { x: 7, y: 2 }, { x: 6, y: 2 }]);
  clearDice();
  assert.equal(lost(far), 8, `the first across lost ${lost(far)}`);
  assert.equal(zones().length, 0, "the sigil outlasted its first");
  withFeature(hero, "Rite of the Threshold");
  lay();
  const [threshold] = zones();
  assert.ok(threshold && threshold.cells.length > 9, "Rite of the Threshold's sigil covers no radius");
  const inside = tileIndex(boardMap().width, 5, 2);
  const outside = tileIndex(boardMap().width, 15, 2);
  assert.equal(withEdges(null, zones(), { conditions: ["ethereal"] })(inside, outside, 5), BARRED, "an ethereal creature crossed the sigil");
  assert.equal(withEdges(null, zones(), { conditions: [] })?.(inside, outside, 5) ?? 5, 5, "a creature on foot was barred");
});

await run("Grounding Rig: a ten-minute setup, one a long rest; a fight there lays 20 feet nothing teleports into or out of, and an ethereal creature cannot cross", async () => {
  const hero = rig.holder(feature("parapsychologist", "Grounding Rig", 11));
  assert.equal(await setWard(hero, "Grounding Rig"), 10, "the setup's minutes");
  assert.equal(used(hero, "horror_grounding_rig"), 1);
  const { far } = await fightInWard(hero);
  lay();
  const map = boardMap();
  const token = listTokens(map.id).find((entry) => entry.refId === far.id);
  assert.match(horrorTeleportRefusal(world.campaignId, map, token, { x: 6, y: 3 }, undefined)?.error ?? "allowed", /cannot teleport into/);
  assert.equal(horrorTeleportRefusal(world.campaignId, map, token, { x: 17, y: 4 }, undefined), null, "a jump far from the rig was refused");
  const inside = tileIndex(map.width, 5, 2);
  assert.equal(withEdges(null, zones(), { conditions: ["ethereal"] })(inside, tileIndex(map.width, 15, 2), 5), BARRED, "a phasing creature crossed the rig");
});

// ---- GH08: Hunter's Kit wardings ----

const { acWithEffects } = await load("lib/dm/ac-effects.ts");

await run("Hunter's Kit: a warding made out of a fight gives the ally +2 AC against the monster type named for the night, not against another type; with Stake and Salt it covers the whole party", async () => {
  const hero = rig.holder(feature("slayer", "Hunter's Kit", 2));
  await kit.endFight();
  assert.ok((await spend(hero, "Hunter's Kit", { targetCharacterId: rig.ally.id })).error, "a warding against no type");
  rig.must(await spend(hero, "Hunter's Kit", { targetCharacterId: rig.ally.id, variant: "undead" }), "Hunter's Kit");
  assert.ok(world.sheet(rig.ally.id).conditions.includes("warded (undead)"), `conditions ${world.sheet(rig.ally.id).conditions}`);
  assert.deepEqual(world.sheet(hero.id).conditions, [], "the slayer warded themself too");
  await kit.fight(2);
  const [near, far] = world.enemies();
  typed(near, "undead");
  typed(far, "humanoid (goblinoid)");
  const ac = (enemy) => acWithEffects(world.campaignId, world.sheet(rig.ally.id), kit.enemy(enemy.id));
  assert.equal(ac(near) - ac(far), 2, `AC ${ac(near)} against the undead, ${ac(far)} against the goblin`);
  assert.ok((await spend(hero, "Hunter's Kit", { variant: "undead" })).error, "a warding crafted in a fight");
  await kit.endFight();
  withFeature(hero, "Stake and Salt");
  rig.must(await spend(hero, "Hunter's Kit", { variant: "fiend" }), "Hunter's Kit with Stake and Salt");
  for (const who of [hero, rig.ally]) assert.ok(world.sheet(who.id).conditions.includes("warded (fiend)"), `${who.name} is not warded`);
});

// ---- GH09: Extinction's reroll ----

await run("Extinction: once on each of the slayer's turns a missed attack on their Quarry is rolled again and the new roll stands; a second miss that turn, or a miss on another creature, is not offered it", async () => {
  const hero = rig.holder(feature("slayer", "Extinction", 20));
  const card = await afterRollKit(world);
  const { near, far } = await rig.fight(hero);
  rig.must(await spend(hero, "Quarry", { targetEnemyId: near.id }), "Quarry");
  kit.place(far.id, 5, 1);
  const miss = async (enemy) => {
    const out = await kit.swing(hero.id, enemy.id, [2, 3, 3, 3, 3]);
    assert.ok(!out.error, `pc_attack: ${out.error}`);
  };
  await miss(near);
  assert.ok(card.offered().includes("extinction"), `offered ${card.offered()} on a missed Quarry`);
  const again = await card.choose(hero, "extinction", 19, 3, 3, 3, 3);
  assert.match(again.note, /HIT/, `the reroll (a 19) stands: ${again.note}`);
  await card.keepAll(hero);
  await miss(near);
  assert.ok(!card.offered().includes("extinction"), "a second reroll the same turn");
  await card.keepAll(hero);
  rig.myTurn(hero);
  await miss(far);
  assert.ok(!card.offered().includes("extinction"), "a reroll on a creature that is not the Quarry");
  await card.keepAll(hero);
});

rig.world.close();
finish();
