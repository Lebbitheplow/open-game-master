// The clause ledger's probes for the artificer (ODM's class: its features
// are the glosses of src/lib/help/srd-features.json). The clause text and
// the verdict live in scripts/clauses/srd-classes.json; this file holds how
// each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots, feature } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const prep = await import("../src/lib/srd/spell-prep.ts");
const items = await import("../src/lib/srd/magic-items.ts");
const P = {};

const artificer = (t, level, extra = {}) =>
  t.hero({
    class: "artificer", level, abilities: { int: 18, ...(extra.abilities ?? {}) },
    spellcasting: { ability: "int", slots: slots(4, 3, 3), prepared: ["Cure Wounds"], known: ["Cure Wounds"], cantrips: [] },
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "abilities")),
  });

// "which list you learn from, how many spells you can have ready, and the
// slots you spend to cast them."
P["artificer.spellcasting"] = async () => {
  const { srd } = rig;
  const view = (level) => ({ classId: "artificer", level, subclass: "", ability: "int" });
  // The slots: an artificer casts from 1st level, half a full caster's
  // progression rounded up.
  const table = { 1: { 1: 2 }, 3: { 1: 3 }, 5: { 1: 4, 2: 2 }, 9: { 1: 4, 2: 3, 3: 2 }, 13: { 1: 4, 2: 3, 3: 3, 4: 1 }, 17: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, 20: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 } };
  for (const [level, wanted] of Object.entries(table)) {
    const got = Object.fromEntries(Object.entries(srd.spellSlotsFor("artificer", Number(level))).filter(([, count]) => count > 0).map(([slot, count]) => [Number(slot), count]));
    assert.deepEqual(got, wanted, `artificer ${level}`);
  }
  // How many are ready: the Intelligence modifier and half the level, one at least.
  for (const [score, level, count] of [[18, 5, 6], [16, 2, 4], [8, 1, 1], [20, 20, 15]]) {
    assert.equal(prep.spellCapOf(view(level), { str: 10, dex: 10, con: 10, int: score, wis: 10, cha: 10 })?.count, count, `artificer ${level} with Intelligence ${score}`);
  }
  // The list: a spell of the artificer's list is theirs to ready, a wizard's
  // alone is not.
  assert.equal(prep.spellOnCasterList(view(5), { name: "Cure Wounds", classes: ["artificer", "cleric"] }), true);
  assert.equal(prep.spellOnCasterList(view(5), { name: "Fireball", classes: ["sorcerer", "wizard"] }), false, "a spell off the artificer's list is on it");
  // A ready spell spends a slot; one not ready is not cast.
  const t = await rig.table();
  const who = artificer(t, 5);
  const cast = await t.invoke("use_spell_slot", { characterId: who.id, level: 1, spell: "Cure Wounds" });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(t.sheet(who).spellcasting.slots["1"].used, 1, "the cast spent no slot");
  const unready = await t.invoke("use_spell_slot", { characterId: who.id, level: 1, spell: "Faerie Fire" });
  assert.equal(unready.ok, false, "an artificer cast a spell they have not readied");
};

P["artificer.magical-tinkering.count"] = async () => {
  const t = await rig.table();
  // Intelligence 14: two objects.
  const who = artificer(t, 1, { abilities: { int: 14 } });
  t.patch(who, { features: [...t.sheet(who).features.filter((entry) => entry.name !== "Magical Tinkering"), feature("Magical Tinkering")] });
  const tinker = (variant) => t.use(who, "Magical Tinkering", variant ? { variant } : {});
  assert.equal((await tinker()).ok, true);
  assert.equal((await tinker()).ok, true);
  assert.equal(t.has(who, "tinkered objects (2)"), true, `two objects are counted: ${JSON.stringify(t.sheet(who).conditions)}`);
  const third = await tinker();
  assert.match(String(third.error), /Intelligence modifier/, "a third object at Intelligence modifier +2");
  assert.equal((await tinker("end")).ok, true);
  assert.equal(t.has(who, "tinkered objects (1)"), true);
  assert.equal((await tinker()).ok, true, "an ended object freed no room");
  // Intelligence 8: one at least.
  const dull = artificer(t, 1, { abilities: { int: 8 } });
  t.patch(dull, { features: [...t.sheet(dull).features.filter((entry) => entry.name !== "Magical Tinkering"), feature("Magical Tinkering")] });
  assert.equal((await t.use(dull, "Magical Tinkering")).ok, true, "an artificer with a negative modifier has none");
  assert.match(String((await t.use(dull, "Magical Tinkering")).error), /Intelligence modifier/);
};

// "With thieves' tools or artisan's tools in hand, you can magically create
// one set of artisan's tools ... This creation requires 1 hour of
// uninterrupted work ... they vanish when you use this feature again": no
// tools in hand is refused; with tinker's tools the smith's tools land in the
// pack and an hour passes; after a rest the next use makes a weaver's set and
// the smith's tools are gone.
P["artificer.right-tool.makes-tools"] = async () => {
  const t = await rig.table();
  const { getClock } = await import("../src/lib/db/clock.ts");
  const who = artificer(t, 3, { equipment: [] });
  t.patch(who, { features: [...t.sheet(who).features.filter((entry) => entry.name !== "The Right Tool for the Job"), feature("The Right Tool for the Job")] });
  const make = (variant) => t.use(who, "The Right Tool for the Job", { variant });
  const holds = (name) => t.sheet(who).equipment.some((item) => item.name.toLowerCase() === name);
  assert.match(String((await make("Smith's tools")).error), /thieves' tools or a set of artisan's tools/, "no tools in hand");
  t.patch(who, { equipment: [{ name: "Tinker's tools", qty: 1 }] });
  const before = getClock(t.world.campaignId).instant;
  const out = await make("Smith's tools");
  assert.equal(out.ok, true, out.error);
  assert.equal(holds("smith's tools"), true, "the smith's tools are in the pack");
  assert.equal(getClock(t.world.campaignId).instant - before, 60, "an hour's work");
  assert.equal((await make("Weaver's tools")).ok, false, "once until a rest");
  assert.equal((await t.world.invoke("take_rest", { kind: "short" })).ok, true);
  assert.equal((await make("Weaver's tools")).ok, true);
  assert.deepEqual([holds("weaver's tools"), holds("smith's tools")], [true, false], "the new set, and the last one gone");
};

// "store a 1st or 2nd-level artificer spell of one action in a weapon or
// spellcasting focus you carry, and whoever holds it can cast it with your
// numbers, twice your Intelligence modifier in times (once at least)": the
// artificer lays Cure Wounds in a dagger (Intelligence 18: eight castings), a
// fighter holding it casts it with no slot, and the count goes down by one.
P["artificer.spell-storing-item.casts"] = async () => {
  const t = await rig.table();
  const who = artificer(t, 11, { equipment: [{ name: "Dagger", qty: 1, equipped: true }] });
  const dagger = (holder) => t.sheet(holder).equipment.find((item) => item.name === "Dagger") ?? null;
  // The Hand's card offers the list as the spell use_resource reads.
  const { featureCards } = await import("../src/lib/battlemap/hand-spells.ts");
  const card = featureCards(t.sheet(who), { myTurn: true, actionUsed: false, bonusUsed: false, reactionUsed: false, attacksMade: 0, table: null })
    .find((entry) => entry.intent?.resourceId === "art_spell_storing_item");
  assert.equal(card?.choice?.arg, "variant", `the card names the spell it stores: ${JSON.stringify(card?.choice ?? null).slice(0, 160)}`);
  assert.ok(card.choice.options.some((option) => option.value === "Cure Wounds"), "Cure Wounds is among the card's spells");
  assert.equal((await t.use(who, "Spell-Storing Item", { variant: "Fireball" })).ok, false, "a 3rd level spell off the artificer's list");
  const out = await t.use(who, "Spell-Storing Item", { variant: "Cure Wounds" });
  assert.equal(out.ok, true, out.error);
  const [stored] = dagger(who)?.storedSpells ?? [];
  assert.deepEqual([stored?.spell, stored?.level, stored?.uses], ["Cure Wounds", 1, 8], `the dagger holds the spell: ${JSON.stringify(dagger(who))}`);
  const friend = t.hero({ class: "fighter", level: 5, equipment: [dagger(who)] });
  t.patch(who, { equipment: [] });
  t.patch(friend, { currentHp: 1 });
  const cast = await t.world.invoke("use_item", { characterId: friend.id, item: "Dagger", spell: "Cure Wounds" });
  assert.equal(cast.ok, true, cast.error);
  const healed = await t.world.invoke("heal", { characterId: friend.id, casterId: friend.id, spell: "Cure Wounds" });
  assert.equal(healed.ok, true, healed.error);
  assert.ok(t.sheet(friend).currentHp > 1, "the fighter holding the dagger cast Cure Wounds from it");
  assert.equal(dagger(friend)?.storedSpells?.[0]?.uses, 7, "one casting of eight spent, the spell still in the dagger");
};

// "you ignore all class, race, spell and level requirements on using them"
P["artificer.magic-item-savant.requirements"] = async () => {
  const rule = (attunedBy) => ({ attunedBy: { text: "someone else", ...attunedBy } });
  const savant = { class: "artificer", level: 14, race: "Human", features: [] };
  const adept = { class: "artificer", level: 13, race: "Human", features: [] };
  for (const [what, def] of [["class", rule({ classes: ["paladin"] })], ["race", rule({ race: "dwarf" })]]) {
    assert.equal(items.mayAttune(def, adept), false, `the staging: a 13th level artificer meets no ${what} requirement`);
    assert.equal(items.mayAttune(def, savant), true, `a 14th level artificer is held to an item's ${what} requirement`);
  }
  const caster = rule({ spellcaster: true });
  assert.equal(items.mayAttune(caster, { class: "fighter", level: 14, features: [] }), false, "the staging: a fighter is no spellcaster");
  assert.equal(items.mayAttune(caster, { classes: [{ id: "fighter", level: 2 }, { id: "artificer", level: 14 }], features: [] }), true, "a 14th level artificer is held to an item's spell requirement");
  // On the sheet: the attunement goes through.
  const t = await rig.table();
  const who = artificer(t, 14, { equipment: [{ name: "Holy Avenger", qty: 1, equipped: true }] });
  const fighter = t.hero({ class: "fighter", level: 14, name: "Edda", equipment: [{ name: "Holy Avenger", qty: 1, equipped: true }] });
  const row = (sheet) => t.sheet(sheet).equipment.find((item) => item.name === "Holy Avenger");
  assert.notEqual(items.attunementProblem(row(fighter), [], t.sheet(fighter)), null, "the staging: a Holy Avenger asks for a paladin");
  assert.equal(items.attunementProblem(row(who), [], t.sheet(who)), null, "a 14th level artificer cannot attune to a paladin's sword");
};

// "You know four infusions at 2nd level, six at 6th, eight at 10th, ten at
// 14th and twelve at 18th": the picks the builder and the level-up open.
P["artificer.infuse-item.known"] = async () => {
  const { optionSlotsFor } = await import("../src/lib/srd/options.ts");
  const counts = [1, 2, 5, 6, 10, 14, 18, 20].map((level) => optionSlotsFor("artificer", "", level, "infusion"));
  assert.deepEqual(counts, [0, 4, 4, 6, 8, 10, 12, 12], "the infusions known by level");
};

const infuser = (t, level, known, equipment, extra = {}) => {
  const who = artificer(t, level, { equipment, ...extra });
  t.patch(who, { features: [...t.sheet(who).features, ...known.map((name) => feature(`Infusion: ${name}`))] });
  return who;
};
const marksOf = (t, who) => t.sheet(who).equipment.filter((row) => row.infusion).map((row) => `${row.name}=${row.infusion.name}`).sort();

// "At the end of a long rest, out of a fight, you lay infusions you know in
// nonmagical items you carry: two items at a time, three from 6th level ...",
// "An item bears one infusion and each infusion is in one item at a time;
// laying one past your limit ends the oldest", "An infusion ends when you
// forget it, and as many days after your death as your Intelligence modifier
// (one at least)."
P["artificer.infuse-item.lays"] = async () => {
  const { advanceClock } = await import("../src/lib/db/clock.ts");
  const t = await rig.table();
  const gear = [
    { name: "Longsword", qty: 1, equipped: true },
    { name: "Handaxe", qty: 1 },
    { name: "Javelin", qty: 3 },
    { name: "Chain Mail", qty: 1, equipped: true },
    { name: "Shield", qty: 1, equipped: true },
    { name: "+1 Dagger", qty: 1 },
  ];
  const who = infuser(t, 6, ["Enhanced Weapon", "Enhanced Defense", "Returning Weapon", "Resistant Armor"], gear);
  const lay = (variant, item) => t.use(who, "Infuse Item", { variant, ...(item ? { item } : {}) });
  assert.equal(t.max(who, "art_infuse_item"), 3, "three infusions a long rest at 6th level");
  assert.equal((await lay("Mind Sharpener", "Chain Mail")).ok, false, "an infusion the artificer does not know");
  assert.match(String((await lay("Enhanced Weapon", "+1 Dagger")).error), /nonmagical/, "a magic item takes no infusion");
  assert.match(String((await lay("Returning Weapon", "Longsword")).error), /thrown/, "Returning Weapon on a weapon that is not thrown");
  for (const [variant, item] of [["Enhanced Weapon", "Longsword"], ["Enhanced Defense", "Shield"], ["Returning Weapon", "Javelin"]]) {
    const out = await lay(variant, item);
    assert.equal(out.ok, true, `${variant} in ${item}: ${out.error}`);
  }
  assert.deepEqual(marksOf(t, who), ["Javelin=Returning Weapon", "Longsword=Enhanced Weapon", "Shield=Enhanced Defense"]);
  assert.deepEqual(t.sheet(who).equipment.filter((row) => row.name === "Javelin").map((row) => [row.qty, Boolean(row.infusion)]), [[2, false], [1, true]], "one javelin of three is infused");
  assert.match(String((await lay("Resistant Armor: fire", "Chain Mail")).error), /long rest/, "a fourth before the next long rest");
  assert.equal((await t.rest("long")).ok, true);
  // Each infusion in one item: Enhanced Weapon leaves the longsword.
  assert.equal((await lay("Enhanced Weapon", "Handaxe")).ok, true);
  assert.deepEqual(marksOf(t, who), ["Handaxe=Enhanced Weapon", "Javelin=Returning Weapon", "Shield=Enhanced Defense"]);
  // Past the three the oldest, the shield's, ends.
  const past = await lay("Resistant Armor: fire", "Chain Mail");
  assert.equal(past.ok, true, past.error);
  assert.deepEqual(marksOf(t, who), ["Chain Mail=Resistant Armor", "Handaxe=Enhanced Weapon", "Javelin=Returning Weapon"], `the oldest ended: ${past.ended}`);
  // One infusion an item: the chain mail's resistance gives way.
  assert.equal((await lay("Enhanced Defense", "Chain Mail")).ok, true);
  assert.deepEqual(marksOf(t, who), ["Chain Mail=Enhanced Defense", "Handaxe=Enhanced Weapon", "Javelin=Returning Weapon"]);
  // An item given away keeps its infusion; another artificer cannot lay one over it.
  const friend = infuser(t, 2, ["Enhanced Weapon"], [], { name: "Tamsin" });
  const handaxe = t.sheet(who).equipment.find((row) => row.name === "Handaxe");
  t.patch(friend, { equipment: [handaxe] });
  t.patch(who, { equipment: t.sheet(who).equipment.filter((row) => row.name !== "Handaxe") });
  assert.match(String((await t.use(friend, "Infuse Item", { variant: "Enhanced Weapon", item: "Handaxe" })).error), /bears/, "another artificer's infusion is overlaid");
  assert.equal(t.sheet(friend).equipment[0].infusion?.name, "Enhanced Weapon", "the handaxe lost its infusion in other hands");
  // Forgotten, an infusion ends.
  t.patch(who, { features: t.sheet(who).features.filter((entry) => entry.name !== "Infusion: Returning Weapon") });
  advanceClock(t.world.campaignId, 1, "minutes");
  assert.deepEqual(marksOf(t, who), ["Chain Mail=Enhanced Defense"], "the forgotten Returning Weapon ended");
  // Dead, the infusions last four days (Intelligence 18), then end.
  t.patch(who, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  advanceClock(t.world.campaignId, 72, "hours");
  assert.deepEqual([marksOf(t, who).length, Boolean(t.sheet(friend).equipment[0].infusion)], [1, true], "three days after the death the infusions stand");
  advanceClock(t.world.campaignId, 24, "hours");
  assert.deepEqual([marksOf(t, who).length, Boolean(t.sheet(friend).equipment[0].infusion)], [0, false], "four days after the death every infusion has ended");
};

// "An infused item is a magic item for whoever holds it: ..." The weapon's
// bonus at the attack, the armor's at the AC, the focus's at the spell
// attack, the resistance at the damage, a replica's own riders, and the
// charges the item holds.
P["artificer.infuse-item.effects"] = async () => {
  const { buildAttackProfile } = await import("../src/lib/dm/pc-attack-profile.ts");
  const { chargeRuleOf, chargeMax } = await import("../src/lib/srd/item-charge-rules.ts");
  const t = await rig.table();
  const gear = [
    { name: "Longsword", qty: 1, equipped: true },
    { name: "Chain Mail", qty: 1, equipped: true },
    { name: "Wand", qty: 1, equipped: true },
    { name: "Cloak", qty: 1, equipped: true },
  ];
  const who = infuser(t, 10, ["Enhanced Weapon", "Enhanced Defense", "Enhanced Arcane Focus", "Replicate Magic Item"], gear);
  const profile = (sheet, weapon) => buildAttackProfile(t.world.campaignId, t.sheet(sheet), { weapon }).profile;
  const before = { bonus: profile(who, "Longsword").magicBonus, ac: t.ac(who), spell: t.derived(who).spellAttack, save: t.derived(who).saves.dex };
  for (const [variant, item] of [["Enhanced Weapon", "Longsword"], ["Enhanced Defense", "Chain Mail"], ["Enhanced Arcane Focus", "Wand"], ["Replicate Magic Item: Cloak of Protection", "Cloak"]]) {
    const out = await t.use(who, "Infuse Item", { variant, item });
    assert.equal(out.ok, true, `${variant}: ${out.error}`);
  }
  // 10th level: +2 on the weapon and the armor, the rest wait on attunement.
  assert.deepEqual([profile(who, "Longsword").magicBonus, t.ac(who) - before.ac, t.derived(who).spellAttack - before.spell], [2, 2, 0], "Enhanced Weapon and Defense at 10th, the focus not attuned");
  t.patch(who, { equipment: t.sheet(who).equipment.map((row) => (["Wand", "Cloak"].includes(row.name) ? { ...row, attuned: true } : row)) });
  assert.deepEqual([t.derived(who).spellAttack - before.spell, t.ac(who) - before.ac, t.derived(who).saves.dex - before.save], [2, 3, 1], "the attuned focus's +2 to spell attacks, the replica Cloak of Protection's +1 to AC and saves");
  // 6th level: Radiant Weapon's +1 once attuned and its four charges,
  // Resistant Armor's fire halved.
  const low = infuser(t, 6, ["Radiant Weapon", "Resistant Armor"], [{ name: "Mace", qty: 1, equipped: true }, { name: "Scale Mail", qty: 1, equipped: true }], { name: "Orrin" });
  assert.equal((await t.use(low, "Infuse Item", { variant: "Radiant Weapon", item: "Mace" })).ok, true);
  assert.equal((await t.use(low, "Infuse Item", { variant: "Resistant Armor: fire", item: "Scale Mail" })).ok, true);
  const mace = () => t.sheet(low).equipment.find((row) => row.name === "Mace");
  assert.equal(profile(low, "Mace").magicBonus, 0, "Radiant Weapon gave its bonus unattuned");
  assert.equal(chargeMax(chargeRuleOf(mace())), 4, "Radiant Weapon holds four charges");
  t.patch(low, { equipment: t.sheet(low).equipment.map((row) => ({ ...row, attuned: true })), currentHp: 40 });
  assert.equal(profile(low, "Mace").magicBonus, 1, "Radiant Weapon's +1 once attuned");
  await t.damage(low, 10, "fire");
  assert.equal(t.sheet(low).currentHp, 35, "Resistant Armor halved the fire");
};

// The rest of each infusion's entry, where the item is used: Helm of
// Awareness's initiative and surprise, Arcane Propulsion Armor's speed and
// gauntlets, Repeating Shot's loading and ammunition, Mind Sharpener's
// concentration, Armor of Magical Strength's Strength save and footing,
// Radiant Weapon's flash, Repulsion Shield's push, Spell-Refueling Ring's slot.
P["artificer.infuse-item.rules"] = async () => {
  const { buildAttackProfile } = await import("../src/lib/dm/pc-attack-profile.ts");
  const { initiativeAdvantage } = await import("../src/lib/srd/trait-rules.ts");
  const { hasAlert } = await import("../src/lib/dm/encounter-open.ts");
  const { makesOwnAmmunition } = await import("../src/lib/srd/infusions.ts");
  const { setConcentration } = await import("../src/lib/dm/concentration.ts");
  const { rollCharacterSave } = await import("../src/lib/dm/forced-save.ts");
  const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
  const t = await rig.table();
  const campaign = () => getCampaignById(t.world.campaignId);
  const known = ["Helm of Awareness", "Arcane Propulsion Armor", "Repeating Shot", "Mind Sharpener", "Armor of Magical Strength", "Radiant Weapon", "Repulsion Shield", "Spell-Refueling Ring"];
  const lay = async (who, variant, item) => {
    const out = await t.use(who, "Infuse Item", { variant, item });
    assert.equal(out.ok, true, `${variant} in ${item}: ${out.error}`);
  };
  const attuneAll = (who) => t.patch(who, { equipment: t.sheet(who).equipment.map((row) => ({ ...row, attuned: Boolean(row.infusion) })) });
  const a = infuser(t, 14, known, [{ name: "Helmet", qty: 1, equipped: true }, { name: "Plate", qty: 1, equipped: true }, { name: "Light Crossbow", qty: 1, equipped: true }]);
  const speed = t.speed(a);
  for (const [variant, item] of [["Helm of Awareness", "Helmet"], ["Arcane Propulsion Armor", "Plate"], ["Repeating Shot", "Light Crossbow"]]) await lay(a, variant, item);
  assert.equal(initiativeAdvantage(t.sheet(a)), null, "the helm's advantage before attunement");
  attuneAll(a);
  assert.match(String(initiativeAdvantage(t.sheet(a))), /Helm of Awareness/, "Helm of Awareness: advantage on initiative");
  assert.equal(hasAlert(t.sheet(a)), true, "Helm of Awareness: the wearer cannot be surprised");
  assert.equal(t.speed(a) - speed, 5, "Arcane Propulsion Armor: 5 feet of walking speed");
  const fist = buildAttackProfile(t.world.campaignId, t.sheet(a), { weapon: "Unarmed Strike" }).profile;
  assert.deepEqual([/1d8/.test(fist.damageExpression), fist.damageType, fist.proficient, fist.thrown, fist.rangeTiles, fist.longRangeTiles], [true, "force", true, true, 4, 12], `the gauntlets: ${JSON.stringify(fist).slice(0, 300)}`);
  const bow = buildAttackProfile(t.world.campaignId, t.sheet(a), { weapon: "Light Crossbow" }).profile;
  assert.deepEqual([bow.magicBonus, (bow.properties ?? []).includes("loading"), makesOwnAmmunition(t.sheet(a).equipment, "Light Crossbow")], [1, false, true], "Repeating Shot: +1, no loading, its own bolts");

  const b = infuser(t, 14, known, [{ name: "Robes", qty: 1, equipped: true }, { name: "Chain Mail", qty: 1, equipped: true }, { name: "Mace", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }, { name: "Ring", qty: 1, equipped: true }], { name: "Brisa" });
  for (const [variant, item] of [["Mind Sharpener", "Robes"], ["Armor of Magical Strength", "Chain Mail"], ["Radiant Weapon", "Mace"], ["Repulsion Shield", "Shield"], ["Spell-Refueling Ring", "Ring"]]) await lay(b, variant, item);
  attuneAll(b);
  const charges = (item) => t.sheet(b).equipment.find((row) => row.name === item)?.charges;
  // Mind Sharpener: a failed concentration save holds.
  setConcentration(campaign(), null, b.id, "Bless");
  const hurt = await t.invoke("apply_damage", { characterId: b.id, amount: 10, type: "slashing" }, [1]);
  assert.deepEqual([t.sheet(b).concentratingOn, charges("Robes")], ["Bless", 3], `Mind Sharpener held Bless on a 1: ${JSON.stringify(hurt.concentration ?? hurt).slice(0, 300)}`);
  // Armor of Magical Strength: Intelligence 18 lifts a Strength save of 9 + 3 to 16.
  t.world.clearDice();
  t.world.dice(9);
  const save = rollCharacterSave(campaign(), null, t.sheet(b), "str", 15, "a shove");
  t.world.clearDice();
  assert.deepEqual([save.success, charges("Chain Mail")], [true, 5], `the armor's charge on a failing Strength save: ${JSON.stringify(save)}`);
  // Radiant Weapon and Repulsion Shield answer a hit (Bless let go, so no
  // concentration save takes the reaction first).
  t.patch(b, { concentratingOn: null });
  const [foe] = await t.fight([b]);
  t.foesTurn(foe);
  // Knocked prone in the fight, the armor's reaction keeps them standing.
  t.patch(b, { conditions: [...t.sheet(b).conditions, "prone"] });
  const footing = await t.invoke("use_reaction", { characterId: b.id, feature: "Armor of Magical Strength" });
  assert.deepEqual([footing.ok, t.has(b, "prone"), charges("Chain Mail")], [true, false, 4], `the armor keeps them on their feet: ${footing.error}`);
  t.kit.freshRound();
  t.foesTurn(foe);
  assert.equal((await t.strike(foe, b, [19, 4])).ok, true);
  const flash = await t.invoke("use_reaction", { characterId: b.id, feature: "Radiant Weapon" }, [1]);
  assert.deepEqual([flash.ok, t.foeHas(foe, "blinded"), charges("Mace")], [true, true, 3], `Radiant Weapon blinds the attacker: ${flash.error ?? flash.save}`);
  // Its eyes cleared, the creature swings again.
  t.kit.setEnemy(foe.id, { conditions: [] });
  t.kit.freshRound();
  t.foesTurn(foe);
  assert.equal((await t.strike(foe, b, [19, 4])).ok, true);
  const push = await t.invoke("use_reaction", { characterId: b.id, feature: "Repulsion Shield" });
  assert.deepEqual([push.ok, charges("Shield")], [true, 3], `Repulsion Shield pushes the attacker: ${push.error ?? push.pushed}`);
  assert.match(JSON.stringify(push), /pushed 15 feet/, `the push: ${JSON.stringify(push).slice(0, 400)}`);
  await t.kit.endFight();
  // Radiant Weapon's light: lit and put out.
  const { carriedLight } = await import("../src/lib/dm/light-timers.ts");
  const lit = await t.use(b, "Radiant Weapon");
  const glow = carriedLight(t.sheet(b)).radius;
  const out = await t.use(b, "Radiant Weapon", { variant: "out" });
  assert.deepEqual([lit.ok, glow, out.ok, carriedLight(t.sheet(b)).radius], [true, 6, true, 0], `the weapon's 30 feet of light: ${lit.error ?? out.error}`);
  // Spell-Refueling Ring: a spent 2nd level slot comes back, once a day.
  t.patch(b, { spellcasting: { ...t.sheet(b).spellcasting, slots: { ...t.sheet(b).spellcasting.slots, 2: { max: 3, used: 2 } } } });
  const refuel = await t.invoke("use_item", { characterId: b.id, item: "Ring" });
  assert.deepEqual([refuel.ok, t.sheet(b).spellcasting.slots["2"].used], [true, 1], `the ring recovers a slot: ${refuel.error}`);
  assert.equal((await t.invoke("use_item", { characterId: b.id, item: "Ring" })).ok, false, "the ring twice before dawn");
};

// Enhanced Arcane Focus: "spells ignore half cover". Int 18 and +2: Fire
// Bolt at +7 with the focus. A 7 is 14: past AC 13, short of 15 behind the
// creature in between.
P["artificer.infuse-item.focus"] = async () => {
  const t = await rig.table();
  const casting = { ability: "int", slots: slots(3), prepared: [], known: [], cantrips: ["Fire Bolt"] };
  const who = infuser(t, 2, ["Enhanced Arcane Focus"], [{ name: "Wand", qty: 1, equipped: true }], { spellcasting: casting });
  assert.equal((await t.use(who, "Infuse Item", { variant: "Enhanced Arcane Focus", item: "Wand" })).ok, true);
  const shoot = async (attuned) => {
    t.patch(who, { equipment: t.sheet(who).equipment.map((row) => ({ ...row, attuned })) });
    const [screen, target] = await t.fight([who], { foes: 2 });
    t.kit.place(screen.id, 8, 5);
    t.kit.place(target.id, 11, 5);
    const before = t.enemy(target).currentHp;
    const out = await t.invoke("pc_attack", { characterId: who.id, targetEnemyId: target.id, spell: "Fire Bolt" }, [7, 5]);
    assert.equal(out.ok, true, out.error);
    return before - t.enemy(target).currentHp > 0;
  };
  assert.deepEqual([await shoot(false), await shoot(true)], [false, true], "a 7 for Fire Bolt behind half cover, without the attuned focus and with it");
};

// Homunculus Servant: the gem worth 100 gp becomes the heart of a construct
// with 1 + Intelligence modifier + artificer level hit points, gone with the
// infusion. Boots of the Winding Path: a bonus action back to a square the
// wearer stood in this turn.
P["artificer.infuse-item.servants"] = async () => {
  const { summonsOf } = await import("../src/lib/dm/summon-store.ts");
  const { advanceClock } = await import("../src/lib/db/clock.ts");
  const t = await rig.table();
  const gear = [{ name: "Agate", qty: 1, worth: 10 }, { name: "Diamond", qty: 1, worth: 300 }, { name: "Boots", qty: 1, equipped: true }];
  const who = infuser(t, 6, ["Homunculus Servant", "Boots of the Winding Path"], gear);
  assert.match(String((await t.use(who, "Infuse Item", { variant: "Homunculus Servant", item: "Agate" })).error), /100 gp/, "a 10 gp gem for the homunculus's heart");
  const laid = await t.use(who, "Infuse Item", { variant: "Homunculus Servant", item: "Diamond" });
  assert.equal(laid.ok, true, laid.error);
  const servants = () => summonsOf(t.world.campaignId, who.id, "Homunculus Servant");
  assert.deepEqual(servants().map((entry) => [entry.maxHp, entry.ac]), [[11, 13]], `one homunculus, 1 + 4 + 6 hit points: ${laid.servant}`);
  assert.equal((await t.use(who, "Infuse Item", { variant: "Boots of the Winding Path", item: "Boots" })).ok, true);
  t.patch(who, { equipment: t.sheet(who).equipment.map((row) => ({ ...row, attuned: row.name === "Boots" })) });
  await t.fight([who]);
  const start = t.kit.token(who.id);
  // Ten feet walked, through the walk's own door.
  const { moveToken } = await import("../src/lib/db/battle-maps.ts");
  moveToken(start.id, start.x, start.y + 2, start.movedThisRound + 2);
  assert.equal((await t.use(who, "Boots of the Winding Path", { x: start.x + 2, y: start.y + 2 })).ok, false, "a square never stood in");
  const back = await t.use(who, "Boots of the Winding Path");
  const now = t.kit.token(who.id);
  assert.deepEqual([back.ok, now.x, now.y, t.budget()?.bonusUsed], [true, start.x, start.y, true], `back to where the turn began: ${back.error}`);
  await t.kit.endFight();
  // Forgotten, the infusion ends and the homunculus with it.
  t.patch(who, { features: t.sheet(who).features.filter((entry) => entry.name !== "Infusion: Homunculus Servant") });
  advanceClock(t.world.campaignId, 1, "minutes");
  assert.equal(servants().length, 0, "the homunculus outlived its infusion");
};

// "You gain +1 to every saving throw per attuned magic item"
// "you can end one attunement as a reaction to drop to 1 hit point instead
// of 0": the readied item's attunement ends and the artificer stands at 1;
// with several attuned and none readied, the drop lands.
P["artificer.soul-of-artifice.reaction"] = async () => {
  const t = await rig.table();
  const gear = [
    { name: "Cloak of Elvenkind", qty: 1, equipped: true, attuned: true },
    { name: "Winged Boots", qty: 1, equipped: false, attuned: true },
  ];
  const who = artificer(t, 20, { equipment: gear });
  const unready = await t.invoke("apply_damage", { characterId: who.id, amount: t.sheet(who).currentHp, type: "slashing" });
  assert.equal(t.sheet(who).currentHp, 0, `with two attuned and none readied the drop lands: ${JSON.stringify(unready)}`);
  t.patch(who, { currentHp: 20, deathSaves: { successes: 0, failures: 0 }, conditions: [] });
  const ready = await t.invoke("use_resource", { characterId: who.id, resource: "Soul of Artifice", variant: "winged boots" });
  assert.equal(ready.ok, true, ready.error);
  const held = await t.invoke("apply_damage", { characterId: who.id, amount: 25, type: "slashing" });
  assert.equal(held.ok, true, held.error);
  assert.equal(t.sheet(who).currentHp, 1, `held at 1 hit point: ${JSON.stringify(held)}`);
  assert.deepEqual(t.sheet(who).equipment.filter((item) => item.attuned).map((item) => item.name), ["Cloak of Elvenkind"], "the readied attunement ended");
};

P["artificer.soul-of-artifice.saves"] = async () => {
  const t = await rig.table();
  const gear = [
    { name: "Cloak of Elvenkind", qty: 1, equipped: true, attuned: true },
    { name: "Boots of Elvenkind", qty: 1, equipped: true },
    { name: "Winged Boots", qty: 1, equipped: false, attuned: true },
  ];
  const who = artificer(t, 20, { equipment: gear });
  const lesser = artificer(t, 19, { equipment: gear, name: "Fenn" });
  const saves = (sheet) => t.derived(sheet).saves;
  const plain = saves(lesser);
  const soul = saves(who);
  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    // Two attuned items: +2 on every save (the proficiency bonus is +6 at both levels).
    assert.equal(soul[ability] - plain[ability], 2, `${ability}: ${soul[ability]} against ${plain[ability]} with two attuned items`);
  }
  t.patch(who, { equipment: gear.map((item) => ({ ...item, attuned: false })) });
  assert.equal(saves(who).wis, plain.wis, "the bonus stood with no item attuned");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-artificer.mjs", P);
