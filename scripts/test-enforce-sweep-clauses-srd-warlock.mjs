// The clause ledger's probes for the warlock's features (SRD 5.1) and the
// Fiend. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each clause that
// names it is staged. (The spells known, the invocations and the arcana are
// in test-enforce-sweep-clauses-srd-spells.mjs and -picks.mjs.)
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const fiend = (t, level, extra = {}) => t.hero({ class: "warlock", subclass: "The Fiend", level, ...extra, abilities: { cha: 16, ...(extra.abilities ?? {}) } });
const P = {};

P["warlock.dark-ones-own-luck.rest"] = async () => {
  const t = await rig.table();
  const who = fiend(t, 6);
  assert.deepEqual(t.sheet(who).resources.dark_ones_own_luck, { max: 1, used: 0 }, "one use");
  t.patch(who, { resources: { ...t.sheet(who).resources, dark_ones_own_luck: { max: 1, used: 1 } } });
  const spent = await t.use(who, "Dark One's Own Luck");
  assert.equal(spent.ok, false, "a second use before a rest");
  assert.equal((await t.rest("short")).ok, true);
  assert.equal(t.used(who, "dark_ones_own_luck"), 0, "a short rest gives the use back");
};

P["warlock.fiendish-resilience.magical-weapons"] = async () => {
  const t = await rig.table();
  const who = fiend(t, 10);
  const chosen = await t.use(who, "Fiendish Resilience", { variant: "slashing" });
  assert.equal(chosen.ok, true, chosen.error);
  const hit = async (args) => {
    const before = t.sheet(who).currentHp;
    const out = await t.damage(who, 10, "slashing", args);
    assert.equal(out.ok, true, out.error);
    return before - t.sheet(who).currentHp;
  };
  assert.equal(await hit({}), 5, "the chosen type is resisted");
  assert.equal(await hit({ magical: true }), 10, "a magical weapon's damage was halved");
};

// ---- Pact Boon ----

const options = await import("../src/lib/srd/options.ts");
const dropped = await import("../src/lib/db/dropped-items.ts");
const clock = await import("../src/lib/db/clock.ts");
const boon = (t, name, extra = {}) => {
  const who = t.hero({ class: "warlock", level: 5, abilities: { cha: 16, str: 14 }, proficiencies: { weapons: ["simple"], armor: ["light"], saves: ["wis", "cha"], skills: [], tools: [] }, ...extra });
  t.patch(who, { features: [...t.sheet(who).features, { name: options.optionFeatureName("pact_boon", name), source: "class" }] });
  return who;
};
const blade = (t, who, variant, faces = []) => t.use(who, "Pact of the Blade", variant ? { variant } : {}, faces);
const rows = (t, who) => t.sheet(who).equipment;
const pactRow = (t, who) => rows(t, who).find((item) => item.pact);
const onGround = (t, name) => dropped.listDroppedItems(t.world.campaignId).filter((entry) => entry.item.name === name);

P["warlock.pact-of-the-chain.familiar-attack"] = async () => {
  const t = await rig.table();
  const who = boon(t, "Pact of the Chain", { equipment: [{ name: "Dagger", qty: 1, equipped: true }] });
  const called = await t.invoke("summon_pet", { characterId: who.id, kind: "familiar", form: "imp" });
  assert.equal(called.ok, true, called.error);
  const [foe] = await t.fight([who]);
  const sting = await t.invoke("pet_attack", { characterId: who.id, targetEnemyId: foe.id }, [15, 3, 3, 3, 3, 10]);
  assert.equal(sting.ok, true, sting.error);
  // "forgo one of your own attacks": the warlock's one attack is spent.
  assert.equal(t.budget().attacksMade, 1, "the familiar's attack took none of the warlock's");
  const own = await t.swing(who, foe, [15, 3]);
  assert.equal(own.ok, false, "the warlock attacked as well as the familiar with one attack");
  // "one attack with its reaction": once.
  t.kit.freshTurn();
  assert.equal((await t.invoke("pet_attack", { characterId: who.id, targetEnemyId: foe.id }, [15, 3, 3, 3, 3, 10])).ok, true);
  const second = await t.invoke("pet_attack", { characterId: who.id, targetEnemyId: foe.id }, [15, 3, 3, 3, 3, 10]);
  assert.equal(second.ok, false, "a second familiar attack in one turn");
};

P["warlock.pact-of-the-blade.create"] = async () => {
  const t = await rig.table();
  const who = boon(t, "Pact of the Blade", { equipment: [{ name: "Dagger", qty: 1, equipped: false }, { name: "Leather armor", qty: 1, equipped: true }] });
  const [foe] = await t.fight([who]);
  // "choose the form that this melee weapon takes"
  const bow = await blade(t, who, "longbow");
  assert.match(String(bow.error), /melee weapon/, "a ranged form was made");
  assert.equal((t.budget()?.actionUsed ?? false), false, "a refused form spent the action");
  const made = await blade(t, who, "greatsword");
  assert.equal(made.ok, true, made.error);
  // "You can use your action to create a pact weapon"
  assert.equal((t.budget()?.actionUsed ?? false), true, "creating the weapon took no action");
  const sword = pactRow(t, who);
  assert.equal(sword?.name, "Pact Greatsword");
  assert.equal(sword.equipped, true, "the weapon is in hand");
  // "You are proficient with it while you wield it": a warlock has no martial
  // weapons. Strength +2, proficiency +3.
  t.freshTurn();
  const swing = await t.swing(who, foe, [10, 3, 3], { weapon: "Pact Greatsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.rolled, 15, `10 on the die with +5: ${JSON.stringify(swing.result).slice(0, 300)}`);
  // "each time you create it", and "It also disappears if you use this feature again".
  t.freshTurn();
  const again = await blade(t, who, "rapier");
  assert.equal(again.ok, true, again.error);
  assert.deepEqual(rows(t, who).filter((item) => item.pact).map((item) => item.name), ["Pact Rapier"]);
  // "in your empty hand": with both hands full there is none.
  t.freshTurn();
  t.patch(who, { equipment: [...rows(t, who).filter((item) => !item.pact), { name: "Shortsword", qty: 1, equipped: true }, { name: "Mace", qty: 1, equipped: true }] });
  const full = await blade(t, who, "longsword");
  assert.match(String(full.error), /no empty hand/, `a pact weapon in a full hand: ${JSON.stringify(full).slice(0, 200)}`);
  assert.equal((t.budget()?.actionUsed ?? false), false, "the refusal spent the action");
};

P["warlock.pact-of-the-blade.vanish"] = async () => {
  const t = await rig.table();
  const who = boon(t, "Pact of the Blade", { equipment: [{ name: "Leather armor", qty: 1, equipped: true }] });
  const friend = t.hero({ class: "fighter", name: "Dara" });
  assert.equal((await blade(t, who, "longsword")).ok, true);
  const handle = (args, as = who) => t.invoke("handle_item", { characterId: as.id, ...args });
  // Out of their hand: the minute starts, and the weapon lies where it fell.
  assert.equal((await handle({ action: "drop", item: "Pact Longsword" })).ok, true);
  assert.equal(t.has(who, "pact weapon apart"), true, "no minute started for a dropped pact weapon");
  assert.equal(onGround(t, "Pact Longsword").length, 1);
  // Taken back within the minute, it is theirs still.
  assert.equal((await handle({ action: "pick_up", item: "Pact Longsword" })).ok, true);
  assert.equal(t.has(who, "pact weapon apart"), false, "the minute ran on with the weapon back in hand");
  assert.ok(pactRow(t, who), "the weapon taken back lost its mark");
  // "more than 5 feet away from you for 1 minute or more": gone.
  assert.equal((await handle({ action: "drop", item: "Pact Longsword" })).ok, true);
  assert.equal((await t.invoke("pass_time", { amount: 2, unit: "minutes" })).ok, true);
  assert.equal(t.has(who, "pact weapon apart"), false);
  assert.equal(onGround(t, "Pact Longsword").length, 0, "the pact weapon lay on the ground past its minute");
  // In another's keeping when the warlock makes a new one, it is gone too.
  assert.equal((await blade(t, who, "longsword")).ok, true);
  assert.equal((await handle({ action: "drop", item: "Pact Longsword" })).ok, true);
  assert.equal((await handle({ action: "pick_up", item: "Pact Longsword" }, friend)).ok, true);
  assert.equal(rows(t, friend).some((item) => item.name === "Pact Longsword"), true, "the staging: the friend holds it");
  assert.equal((await blade(t, who, "scimitar")).ok, true);
  assert.equal(rows(t, friend).some((item) => item.name === "Pact Longsword"), false, "the old pact weapon outlived a new creation");
  // "if you dismiss the weapon (no action required)"
  const [foe] = await t.fight([who]);
  assert.ok(foe);
  const sent = await blade(t, who, "dismiss");
  assert.equal(sent.ok, true, sent.error);
  assert.equal((t.budget()?.actionUsed ?? false), false, "dismissing took the action");
  assert.equal(pactRow(t, who), undefined);
  // "or if you die"
  assert.equal((await blade(t, who, "longsword")).ok, true);
  t.patch(who, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  assert.equal(pactRow(t, who), undefined, "the pact weapon outlived its warlock");
};

P["warlock.pact-of-the-blade.bond"] = async () => {
  const t = await rig.table();
  const gear = [
    { name: "Leather armor", qty: 1, equipped: true },
    { name: "+1 Greatsword", qty: 1, equipped: true },
    { name: "+2 Longsword", qty: 1, equipped: false },
    { name: "Greataxe", qty: 1, equipped: false },
  ];
  const who = boon(t, "Pact of the Blade", { equipment: gear });
  const row = (name) => rows(t, who).find((item) => item.name === name);
  const hold = (name) => t.patch(who, { equipment: rows(t, who).map((item) => (item.name === "Leather armor" ? item : { ...item, equipped: item.name === name })) });
  // "one magic weapon"
  hold("Greataxe");
  assert.match(String((await blade(t, who, "bond Greataxe")).error), /magic weapon/);
  // "while you hold the weapon"
  assert.match(String((await blade(t, who, "bond +1 Greatsword")).error), /not in hand/);
  hold("+1 Greatsword");
  // "over the course of 1 hour, which can be done during a short rest": never in a fight.
  await t.fight([who]);
  assert.match(String((await blade(t, who, "bond +1 Greatsword")).error), /an hour/);
  await t.kit.endFight();
  const before = clock.getClock(t.world.campaignId);
  const bound = await blade(t, who, "bond +1 Greatsword");
  assert.equal(bound.ok, true, bound.error);
  assert.equal(row("+1 Greatsword").pact, "bonded");
  const after = clock.getClock(t.world.campaignId);
  assert.notDeepEqual(after, before, "the hour's ritual moved no clock");
  // It is the pact weapon now, and the other blades are not: proficiency
  // rides it alone (a warlock has no martial weapons).
  const [foe] = await t.fight([who]);
  const bonded = await t.swing(who, foe, [10, 3, 3], { weapon: "+1 Greatsword" });
  assert.equal(bonded.ok, true, bonded.error);
  hold("Greataxe");
  t.freshTurn();
  const plain = await t.swing(who, foe, [10, 3], { weapon: "Greataxe" });
  assert.equal(plain.ok, true, plain.error);
  const hitOf = (swing) => swing.result.rolled;
  // +1 Greatsword: 10 + 2 Strength + 3 proficiency + 1. Greataxe: 10 + 2.
  assert.equal(hitOf(bonded), 16, `the bonded weapon swings proficient: ${JSON.stringify(bonded.result).slice(0, 240)}`);
  assert.equal(hitOf(plain), 12, "a weapon that is not the pact weapon swings without proficiency");
  await t.kit.endFight();
  // "dismiss the weapon, shunting it into an extradimensional space, and it
  // appears whenever you create your pact weapon thereafter."
  hold("+1 Greatsword");
  assert.equal((await blade(t, who, "dismiss")).ok, true);
  assert.equal(row("+1 Greatsword").pact, "stowed");
  assert.equal(row("+1 Greatsword").equipped, false);
  const back = await blade(t, who, "");
  assert.equal(back.ok, true, back.error);
  assert.equal(row("+1 Greatsword").pact, "bonded");
  assert.equal(row("+1 Greatsword").equipped, true);
  // "if you perform the 1-hour ritual on a different weapon", and "The weapon
  // appears at your feet if it is in the extradimensional space when the
  // bond breaks."
  assert.equal((await blade(t, who, "dismiss")).ok, true);
  hold("+2 Longsword");
  const other = await blade(t, who, "bond +2 Longsword");
  assert.equal(other.ok, true, other.error);
  assert.equal(row("+2 Longsword").pact, "bonded");
  assert.equal(row("+1 Greatsword"), undefined, "the weapon in the space stayed there");
  assert.equal(onGround(t, "+1 Greatsword").length, 1, "the weapon in the space did not appear at their feet");
  assert.equal(onGround(t, "+1 Greatsword")[0].item.pact, undefined, "it is still marked as the pact weapon");
  // "or if you use a 1-hour ritual to break your bond to it"
  const broken = await blade(t, who, "break bond");
  assert.equal(broken.ok, true, broken.error);
  assert.equal(row("+2 Longsword").pact, undefined);
  // "The weapon ceases being your pact weapon if you die"
  assert.equal((await blade(t, who, "bond +2 Longsword")).ok, true);
  t.patch(who, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  assert.equal(row("+2 Longsword").pact, undefined, "the bond outlived its warlock");
  assert.ok(row("+2 Longsword"), "the bonded weapon vanished with its warlock");
};

P["warlock.pact-of-the-tome.book"] = async () => {
  const t = await rig.table();
  const who = boon(t, "Pact of the Tome", { equipment: [{ name: "Leather armor", qty: 1, equipped: true }] });
  const books = () => rows(t, who).filter((item) => item.name === "Book of Shadows");
  // "during a short or long rest": never in a fight.
  await t.fight([who]);
  assert.match(String((await t.use(who, "Book of Shadows")).error), /an hour/);
  await t.kit.endFight();
  const before = clock.getClock(t.world.campaignId);
  const first = await t.use(who, "Book of Shadows");
  assert.equal(first.ok, true, first.error);
  assert.equal(books().length, 1);
  assert.notDeepEqual(clock.getClock(t.world.campaignId), before, "the hour's ceremony moved no clock");
  // "it destroys the previous book", wherever it was lost.
  assert.equal((await t.invoke("handle_item", { characterId: who.id, action: "drop", item: "Book of Shadows" })).ok, true);
  assert.equal(onGround(t, "Book of Shadows").length, 1, "the staging: the book is lost");
  const second = await t.use(who, "Book of Shadows");
  assert.equal(second.ok, true, second.error);
  assert.equal(books().length, 1);
  assert.equal(onGround(t, "Book of Shadows").length, 0, "the previous book outlived the ceremony");
  // "The book turns to ash when you die."
  t.patch(who, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  assert.equal(books().length, 0, "the book outlived its warlock");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-warlock.mjs", P);
