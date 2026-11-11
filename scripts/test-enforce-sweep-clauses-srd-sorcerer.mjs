// The clause ledger's probes for the sorcerer (SRD 5.1) and the Draconic
// Bloodline. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each clause that
// names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const options = await import("../src/lib/srd/options.ts");
const P = {};

P["sorcerer.draconic-resilience.ac"] = async () => {
  const t = await rig.table();
  const who = t.hero({ class: "sorcerer", subclass: "Draconic Bloodline", level: 1, equipment: [], abilities: { dex: 14 } });
  assert.equal(t.ac(who), 13 + 2, "no armor: 13 + Dexterity");
};

P["sorcerer.metamagic.heightened"] = async () => {
  const t = await rig.table();
  const who = t.hero({
    class: "sorcerer", level: 5, abilities: { cha: 18 },
    spellcasting: { ability: "cha", slots: slots(4, 3, 2), prepared: [], known: ["Hold Person"], cantrips: [] },
  });
  t.patch(who, { features: [...t.sheet(who).features, { name: options.optionFeatureName("metamagic", "Heightened Spell"), source: "class" }] });
  const [foe] = await t.fight([who]);
  const spent = await t.use(who, "sorcery_points", { variant: "Heightened Spell" });
  assert.equal(spent.ok, true, spent.error);
  const out = await t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Hold Person", saveAbility: "wis", level: 2 }, [18, 2]);
  assert.equal(out.ok, true, out.error);
  const d20s = out.rolled.filter((die) => die.sides === 20).length;
  assert.equal(d20s, 2, `after Heightened Spell (3 points spent) the creature's first save is rolled with ${d20s} d20`);
};

const sorcerer = (t, picks, extra = {}) => {
  const who = t.hero({
    class: "sorcerer", level: 5, abilities: { cha: 18 }, equipment: [{ name: "Component pouch", qty: 1 }],
    spellcasting: { ability: "cha", slots: slots(4, 3, 2), prepared: [], known: ["Hold Person"], cantrips: [] }, ...extra,
  });
  t.patch(who, { features: [...t.sheet(who).features, ...picks.map((pick) => ({ name: options.optionFeatureName("metamagic", pick), source: "class" }))] });
  return who;
};
const pointsUsed = (t, who) => t.sheet(who).resources.sorcery_points.used;

P["sorcerer.metamagic.one-option"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Heightened Spell", "Subtle Spell", "Empowered Spell"]);
  await t.fight([who]);
  const first = await t.use(who, "sorcery_points", { variant: "Heightened Spell" });
  assert.equal(first.ok, true, first.error);
  assert.equal(pointsUsed(t, who), 3);
  const second = await t.use(who, "sorcery_points", { variant: "Subtle Spell" });
  assert.match(String(second.error), /one Metamagic option/, "a second option was paid on one spell");
  assert.equal(pointsUsed(t, who), 3, "the refused option spent points");
  // "even if you have already used a different Metamagic option"
  const empowered = await t.use(who, "sorcery_points", { variant: "Empowered Spell" });
  assert.equal(empowered.ok, true, `Empowered Spell beside another option: ${empowered.error}`);
  assert.equal(pointsUsed(t, who), 4);
};

P["sorcerer.metamagic.subtle"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Subtle Spell"]);
  const [foe] = await t.fight([who]);
  t.patch(who, { conditions: ["silenced"] });
  const cast = () => t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Hold Person", saveAbility: "wis", level: 2 }, [18]);
  const mute = await cast();
  assert.match(String(mute.error), /verbal/, "the staging: a silenced sorcerer cannot speak Hold Person");
  const spent = await t.use(who, "sorcery_points", { variant: "Subtle Spell" });
  assert.equal(spent.ok, true, spent.error);
  const subtle = await cast();
  assert.equal(subtle.ok, true, `Hold Person cast with no words: ${subtle.error}`);
  // The point bought one spell.
  t.freshTurn();
  const again = await cast();
  assert.match(String(again.error), /verbal/, "Subtle Spell lasted past the spell it was paid for");
};

// ---- the options a cast reads off the one reader (mt-srd-metamagic.ts) ----

const metamagic = await import("../src/lib/dm/mt-srd-metamagic.ts");
const casting = (known, cantrips = []) => ({ spellcasting: { ability: "cha", slots: slots(4, 3, 2), prepared: [], known, cantrips } });
const pay = async (t, who, option, amount) => {
  const spent = await t.use(who, "sorcery_points", { variant: option, ...(amount ? { amount } : {}) });
  assert.equal(spent.ok, true, `${option}: ${spent.error}`);
};
const slotsUsed = (t, who, level) => t.sheet(who).spellcasting.slots[String(level)].used;
// The Hand's card for a spell, dealt off the sheet as it stands: it reads
// the same reader the cast does, so it says what the cast will apply.
const hand = await import("../src/lib/battlemap/hand.ts");
const cardOf = (t, who, spell) => {
  const card = hand.deriveHand(t.sheet(who)).find((entry) => entry.name === spell);
  assert.ok(card, `the Hand deals ${spell}`);
  return card;
};

P["sorcerer.metamagic.careful"] = async () => {
  const t = await rig.table();
  // Charisma 12: "up to your Charisma modifier (minimum of one creature)" is one.
  const who = sorcerer(t, ["Careful Spell"], { ...casting(["Fireball"]), abilities: { cha: 12 } });
  const first = t.hero({ class: "fighter", name: "Ansel" });
  const second = t.hero({ class: "fighter", name: "Berit" });
  const [foe] = await t.fight([who, first, second]);
  const blast = () => t.invoke("aoe_damage", { casterCharacterId: who.id, spell: "Fireball", level: 3, enemyIds: [foe.id], characterIds: [first.id, second.id] }, new Array(40).fill(3));
  await pay(t, who, "Careful Spell");
  assert.match(cardOf(t, who, "Fireball").description, /Careful Spell: up to 1 of your allies/);
  const out = await blast();
  assert.equal(out.ok, true, out.error);
  const rows = JSON.stringify(out);
  const row = (name) => out.result.results.find((entry) => entry.target === name);
  const spared = row("Ansel");
  const rolled = row("Berit");
  assert.ok(spared && rolled, `the result names both allies: ${rows.slice(0, 400)}`);
  assert.ok(spared.careful, `the chosen ally succeeds with no roll: ${JSON.stringify(spared)}`);
  assert.equal(spared.success, true);
  assert.equal(spared.save, undefined, "a chosen creature rolled its save");
  // Fireball's eight d6 came up 3 each: 24, and a success takes half.
  assert.equal(spared.damage, 12, "a success against Fireball takes half");
  assert.equal(rolled.careful, undefined, "a second creature was protected at Charisma modifier +1");
  assert.equal(typeof rolled.save, "number", "the creature not chosen rolls its save");
  // The point bought one spell.
  t.freshTurn();
  const next = await blast();
  assert.equal(next.ok, true, next.error);
  assert.equal(JSON.stringify(next).includes("Careful Spell"), false, "Careful Spell lasted past the spell it was paid for");
};

P["sorcerer.metamagic.distant"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Distant Spell"], casting(["Mage Armor"], ["Poison Spray"]));
  const ally = t.hero({ class: "monk", name: "Corin", equipment: [] });
  const [foe] = await t.fight([who, ally]);
  // Poison Spray reaches 10 feet; the foe stands 15 feet off.
  t.kit.place(foe.id, 8, 5);
  const spray = () => t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Poison Spray" }, [18, 6, 6]);
  const short = await spray();
  assert.match(String(short.error), /reach of 10 ft/, "the staging: 15 feet is beyond Poison Spray");
  assert.match(cardOf(t, who, "Poison Spray").range, /^10\b/);
  await pay(t, who, "Distant Spell");
  assert.match(cardOf(t, who, "Poison Spray").range, /^20\b/, "the card shows the range the cast will reach");
  assert.match(cardOf(t, who, "Mage Armor").range, /^30\b/, "a touch spell's card shows 30 feet");
  const far = await spray();
  assert.equal(far.ok, true, `Poison Spray at 15 feet with its range doubled: ${far.error}`);
  // A touch spell reaches 30 feet, and no farther.
  const armor = () => t.invoke("cast_buff", { characterId: who.id, spell: "Mage Armor", targetCharacterIds: [ally.id] });
  t.freshTurn();
  t.kit.place(ally.id, 5, 10);
  const touch = await armor();
  assert.match(String(touch.error), /touch spell/, "the staging: 25 feet is beyond a touch");
  t.kit.place(ally.id, 5, 12);
  await pay(t, who, "Distant Spell");
  const beyond = await armor();
  assert.match(String(beyond.error), /reach of 30 ft/, `a touch spell reached 35 feet: ${JSON.stringify(beyond).slice(0, 200)}`);
  t.kit.place(ally.id, 5, 11);
  const reached = await armor();
  assert.equal(reached.ok, true, `Mage Armor at 30 feet with Distant Spell: ${reached.error}`);
};

P["sorcerer.metamagic.empowered"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Empowered Spell"], casting([], ["Poison Spray"]));
  const [foe] = await t.fight([who]);
  const spray = (faces) => t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Poison Spray" }, faces);
  const hpOf = () => t.enemy(foe).currentHp;
  // A 5th level caster's Poison Spray is 2d12. The save fails on a 2; the
  // dice come up 5 and 11.
  const before = hpOf();
  const plain = await spray([2, 5, 11]);
  assert.equal(plain.ok, true, plain.error);
  assert.equal(before - hpOf(), 16, "the staging: 5 + 11");
  t.freshTurn();
  await pay(t, who, "Empowered Spell");
  assert.match(cardOf(t, who, "Poison Spray").description, /Empowered Spell: up to 4 low damage dice/);
  const mid = hpOf();
  // The 5 fell below a d12's average and is thrown again; it comes up 3, and
  // "You must use the new rolls": 3 + 11.
  const empowered = await spray([2, 5, 11, 3]);
  assert.equal(empowered.ok, true, empowered.error);
  assert.equal(empowered.rolled.filter((die) => die.sides === 12).length, 3, "one die was thrown again");
  assert.equal(mid - hpOf(), 14, "the new roll stands in place of the old");
  assert.match(String(empowered.result.empowered), /Empowered Spell/);
  // The point bought one roll.
  t.freshTurn();
  const after = hpOf();
  const next = await spray([2, 5, 11, 3]);
  assert.equal(next.ok, true, next.error);
  assert.equal(after - hpOf(), 16, "Empowered Spell lasted past the roll it was paid for");
};

P["sorcerer.metamagic.extended"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Extended Spell"], { ...casting(["Hold Person", "Mage Armor"]), equipment: [{ name: "Component pouch", qty: 1 }] });
  const [foe] = await t.fight([who]);
  const hold = () => t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Hold Person", saveAbility: "wis", level: 2 }, [2]);
  const held = () => t.enemy(foe).conditionMeta?.paralyzed?.rounds;
  const plain = await hold();
  assert.equal(plain.ok, true, plain.error);
  assert.equal(held(), 10, "the staging: Hold Person lasts a minute");
  t.kit.setEnemy(foe.id, { conditions: [], conditionMeta: {} });
  t.patch(who, { concentratingOn: null });
  t.freshTurn();
  await pay(t, who, "Extended Spell");
  assert.match(cardOf(t, who, "Hold Person").description, /Extended Spell: it lasts 2 minutes/);
  const long = await hold();
  assert.equal(long.ok, true, long.error);
  assert.equal(held(), 20, "Extended Spell doubles a minute to two");
  // Mage Armor's 8 hours become 16.
  t.freshTurn();
  await pay(t, who, "Extended Spell");
  const armor = await t.invoke("cast_buff", { characterId: who.id, spell: "Mage Armor", targetCharacterIds: [who.id] });
  assert.equal(armor.ok, true, armor.error);
  const lasting = Object.values(t.sheet(who).conditionMeta).find((meta) => meta.spell === "Mage Armor");
  assert.equal(lasting?.rounds, 16 * 600, `Mage Armor extended: ${JSON.stringify(lasting)}`);
  // "to a maximum duration of 24 hours", and nothing under a minute.
  const paid = { conditions: ["metamagic: extended spell"] };
  assert.equal(metamagic.extendedRounds(paid, 15 * 600), 24 * 600);
  assert.equal(metamagic.extendedRounds(paid, 5), 5);
  assert.equal(metamagic.extendedRounds({ conditions: [] }, 100), 100);
};

P["sorcerer.metamagic.twinned"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Twinned Spell"], casting(["Hold Person", "Magic Missile", "Burning Hands"], ["Poison Spray"]));
  const [near, far] = await t.fight([who], { foes: 2 });
  const hold = (enemy) => t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 }, [2]);
  const reset = () => {
    for (const enemy of [near, far]) t.kit.setEnemy(enemy.id, { conditions: [], conditionMeta: {} });
    const sheet = t.sheet(who);
    t.patch(who, { concentratingOn: null, resources: { ...sheet.resources, sorcery_points: { ...sheet.resources.sorcery_points, used: 0 } } });
    t.freshTurn();
  };
  // "a number of sorcery points equal to the spell's level"
  await pay(t, who, "Twinned Spell", 2);
  assert.equal(pointsUsed(t, who), 2);
  assert.match(cardOf(t, who, "Hold Person").description, /Twinned Spell: a second creature, for 2 sorcery points/);
  assert.match(cardOf(t, who, "Magic Missile").description, /Twinned Spell does not take it/);
  assert.match(cardOf(t, who, "Burning Hands").description, /Twinned Spell does not take it: it has a range of self/);
  const first = await hold(near);
  assert.equal(first.ok, true, first.error);
  assert.match(String(first.result.metamagic), /Twinned Spell: Hold Person takes a second creature/);
  // "target a second creature": never the first again.
  const again = await hold(near);
  assert.match(String(again.error), /another creature/, `the first creature took the spell twice: ${JSON.stringify(again).slice(0, 200)}`);
  const second = await hold(far);
  assert.equal(second.ok, true, `the second creature: ${second.error}`);
  assert.equal(slotsUsed(t, who, 2), 1, "the second target spent a second slot");
  assert.equal(t.foeHas(far, "paralyzed"), true);
  assert.equal(pointsUsed(t, who), 2);
  // The price is the spell's level whatever the spend named.
  reset();
  await pay(t, who, "Twinned Spell", 1);
  const short = await hold(near);
  assert.equal(short.ok, true, short.error);
  assert.equal(pointsUsed(t, who), 2, "a 2nd level spell was twinned for 1 point");
  // Without the option a second creature is a second casting.
  reset();
  const one = await hold(near);
  assert.equal(one.ok, true, one.error);
  const other = await hold(far);
  assert.equal(other.ok === true && slotsUsed(t, who, 2) === 2, false, "a second creature took the spell with no Twinned Spell and no second slot");
  // "1 sorcery point if the spell is a cantrip"
  reset();
  await pay(t, who, "Twinned Spell", 3);
  t.kit.place(far.id, 6, 6);
  const spray = (enemy) => t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Poison Spray" }, [18]);
  assert.equal((await spray(near)).ok, true);
  const twin = await spray(far);
  assert.equal(twin.ok, true, `a twinned cantrip's second creature: ${twin.error}`);
  assert.equal(pointsUsed(t, who), 1, "a twinned cantrip costs 1 point");
  // "incapable of targeting more than one creature at the spell's current
  // level": Magic Missile is not, and the points come back.
  reset();
  await pay(t, who, "Twinned Spell", 1);
  assert.equal(pointsUsed(t, who), 1);
  const darts = await t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: near.id, spell: "Magic Missile", level: 1 }, [3, 3, 3]);
  assert.equal(darts.ok, true, darts.error);
  assert.match(String(darts.result.metamagic), /does not take Magic Missile/);
  assert.equal(pointsUsed(t, who), 0, "the points paid for a spell that cannot be twinned were kept");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-sorcerer.mjs", P);
