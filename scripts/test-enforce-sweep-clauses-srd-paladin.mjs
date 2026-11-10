// The clause ledger's probes for the paladin (SRD 5.1) and the Oath of
// Devotion. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each clause that
// names it is staged.
import "./lib/enforce-world.mjs";
import { runProbes } from "./lib/sweep-clauses-srd.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const SWORD = [{ name: "Longsword", qty: 1, equipped: true }];
const paladin = (t, level, extra = {}) => t.hero({ class: "paladin", level, equipment: SWORD, spells: ["Bless", "Cure Wounds"], ...extra, abilities: { cha: 16, ...(extra.abilities ?? {}) } });
const devotion = (t, level, extra = {}) => paladin(t, level, { subclass: "Oath of Devotion", ...extra });
const diceIn = (roll) => roll.breakdown.terms.filter((term) => term.kind === "dice").reduce((sum, term) => sum + term.count, 0);

const P = {};

P["paladin.divine-sense.uses"] = async () => {
  const t = await rig.table();
  const who = paladin(t, 1);
  assert.equal(t.max(who, "divine_sense"), 4, "1 + CHA 3");
  assert.equal(t.max(paladin(t, 1, { abilities: { cha: 8 } }), "divine_sense"), 1);
  await t.fight([who]);
  const out = await t.use(who, "divine sense");
  assert.equal(out.ok, true, out.error);
  assert.equal(t.budget()?.actionUsed, true, "Divine Sense took no action");
  await t.kit.endFight();
  await t.rest("short");
  assert.equal(t.used(who, "divine_sense"), 1, "a short rest gave the use back");
  await t.rest("long");
  assert.equal(t.used(who, "divine_sense"), 0);
};

P["paladin.lay-on-hands.touch"] = async () => {
  const t = await rig.table();
  const who = paladin(t, 5);
  const ally = t.hero({ class: "fighter", level: 5 });
  await t.fight([who, ally]);
  t.patch(ally, { currentHp: 10 });
  t.kit.place(ally.id, 12, 5);
  const far = await t.use(who, "lay on hands", { amount: 10, targetCharacterId: ally.id });
  assert.equal(far.ok, false, "Lay on Hands reached an ally 35 feet away");
  assert.equal(t.used(who, "lay_on_hands"), 0);
  t.kit.place(ally.id, 4, 5);
  const near = await t.use(who, "lay on hands", { amount: 10, targetCharacterId: ally.id });
  assert.equal(near.ok, true, near.error);
  assert.equal(t.sheet(ally).currentHp, 20);
  assert.equal(t.budget().actionUsed, true, "Lay on Hands took no action");
};

P["paladin.lay-on-hands.cure"] = async () => {
  const t = await rig.table();
  const who = paladin(t, 5);
  const ally = t.hero({ class: "fighter", level: 5 });
  await t.fight([who, ally]);
  t.patch(ally, { currentHp: 30, conditions: ["poisoned"], conditionMeta: { poisoned: { rounds: 100 } } });
  let out = await t.use(who, "lay on hands", { amount: 5, variant: "neutralize poison", targetCharacterId: ally.id });
  if (!out.ok) out = await t.use(who, "lay on hands", { amount: 5, variant: "cure", targetCharacterId: ally.id });
  assert.equal(t.has(ally, "poisoned"), false, `5 points of the pool did not neutralize the poison (${out.ok ? `accepted: ally at ${t.sheet(ally).currentHp} hit points, still poisoned` : out.error})`);
  assert.equal(t.used(who, "lay_on_hands"), 5);
};

P["paladin.sacred-oath.oaths"] = async () => {
  const names = (await import("../src/lib/srd/features.ts")).subclassNamesFor("paladin");
  for (const name of ["Oath of Devotion", "Oath of the Ancients", "Oath of Vengeance"]) {
    assert.ok(names.includes(name), `no ${name}`);
  }
};

async function scare(t, ally, foe) {
  return t.condition(ally, "frightened", { rounds: 5, sourceEnemyId: foe.id });
}

P["paladin.aura-of-courage.conscious"] = async () => {
  const t = await rig.table();
  const who = paladin(t, 10);
  const ally = t.hero({ class: "fighter", level: 5 });
  const [foe] = await t.fight([who, ally]);
  const held = await scare(t, ally, foe);
  assert.equal(held.ok, false, "an ally 5 feet from a conscious paladin was frightened");
  t.patch(who, { currentHp: 0, conditions: ["unconscious", "prone"], conditionMeta: {}, deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  const out = await scare(t, ally, foe);
  assert.equal(out.ok, true, `with the paladin unconscious the aura still stopped the fear: ${out.error}`);
};

P["paladin.aura-of-courage.range-18"] = async () => {
  for (const [level, covered] of [[17, false], [18, true]]) {
    const t = await rig.table();
    const who = paladin(t, level);
    const ally = t.hero({ class: "fighter", level: 5 });
    const [foe] = await t.fight([who, ally]);
    t.kit.place(ally.id, 10, 5);
    const out = await scare(t, ally, foe);
    assert.equal(out.ok, !covered, `an ally 25 feet from a level ${level} paladin: ${out.ok ? "frightened" : "kept from fear"}`);
  }
};

P["paladin.improved-divine-smite.d8"] = async () => {
  const t = await rig.table();
  const ten = paladin(t, 10);
  const eleven = paladin(t, 11);
  const [foe] = await t.fight([ten, eleven]);
  t.kit.place(eleven.id, 6, 4);
  const plain = await t.swing(ten, foe, [15, 4]);
  assert.equal(diceIn(plain.damage), 1, "no rider at 10th level");
  t.kit.giveTurn(eleven.id);
  const hit = await t.swing(eleven, foe, [15, 4, 4]);
  assert.equal(hit.ok, true, hit.error);
  assert.equal(diceIn(hit.damage), 2, "the longsword's die and 1d8 radiant");
  const smite = await t.swing(eleven, foe, [15, 4, 4, 4, 4], { smite: 1 });
  assert.equal(smite.ok, true, smite.error);
  assert.equal(diceIn(smite.damage), 4, "the longsword's die, 2d8 of smite and Improved Divine Smite's d8");
};

P["paladin.cleansing-touch.ends-spell"] = async () => {
  const t = await rig.table();
  const who = paladin(t, 14);
  await t.fight([who]);
  const bless = await t.invoke("cast_buff", { characterId: who.id, spell: "Bless", targetCharacterIds: [who.id] });
  assert.equal(bless.ok, true, bless.error);
  const blessed = t.sheet(who).conditions.find((entry) => /bless/i.test(entry));
  assert.ok(blessed, `Bless left ${t.sheet(who).conditions.join(", ") || "nothing"}`);
  t.freshTurn();
  const out = await t.use(who, "cleansing touch", { targetCharacterId: who.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(t.has(who, blessed), false, "Cleansing Touch was spent and the spell is still on the paladin");
};

P["paladin.channel-divinity-sacred-weapon.min1"] = async () => {
  const t = await rig.table();
  const who = devotion(t, 3, { abilities: { cha: 8, str: 16 } });
  const [foe] = await t.fight([who]);
  const before = await t.swing(who, foe, [10, 4]);
  t.freshTurn();
  const out = await t.use(who, "channel divinity", { variant: "sacred weapon" });
  assert.equal(out.ok, true, out.error);
  t.freshTurn();
  const after = await t.swing(who, foe, [10, 4]);
  assert.equal(after.toHit.total, before.toHit.total + 1, "with CHA 8 the Sacred Weapon adds the minimum of +1");
};

P["paladin.channel-divinity-sacred-weapon.ends-unconscious"] = async () => {
  const t = await rig.table();
  const who = devotion(t, 3);
  await t.fight([who]);
  const out = await t.use(who, "channel divinity", { variant: "sacred weapon" });
  assert.equal(out.ok, true, out.error);
  const mark = t.sheet(who).conditions.find((entry) => /sacred weapon/i.test(entry));
  assert.ok(mark, `Sacred Weapon left ${t.sheet(who).conditions.join(", ") || "nothing"}`);
  // Dropped to 0 hit points: unconscious.
  const hurt = await t.invoke("apply_damage", { characterId: who.id, amount: 79, type: "fire" });
  assert.equal(hurt.ok, true, hurt.error);
  const down = await t.invoke("apply_damage", { characterId: who.id, amount: 5, type: "fire" });
  assert.equal(down.ok, true, down.error);
  assert.ok(t.has(who, "unconscious"));
  assert.equal(t.has(who, mark), false, "the paladin fell unconscious and the weapon is still sacred");
};

P["paladin.aura-of-devotion.charmed"] = async () => {
  for (const [level, feet, covered] of [[7, 5, true], [7, 25, false], [18, 25, true]]) {
    const t = await rig.table();
    const who = devotion(t, level);
    const ally = t.hero({ class: "fighter", level: 5 });
    const [foe] = await t.fight([who, ally]);
    t.kit.place(ally.id, 5 + feet / 5, 6);
    const out = await t.condition(ally, "charmed", { rounds: 5, sourceEnemyId: foe.id });
    assert.equal(out.ok, !covered, `an ally ${feet} feet from a level ${level} Devotion paladin: ${out.ok ? "charmed" : "kept from the charm"}`);
  }
  const t = await rig.table();
  const who = devotion(t, 7);
  const ally = t.hero({ class: "fighter", level: 5 });
  const [foe] = await t.fight([who, ally]);
  t.patch(who, { currentHp: 0, conditions: ["unconscious", "prone"], conditionMeta: {}, deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  const out = await t.condition(ally, "charmed", { rounds: 5, sourceEnemyId: foe.id });
  assert.equal(out.ok, true, `with the paladin unconscious the aura still stopped the charm: ${out.error}`);
};

P["paladin.purity-of-spirit.protection"] = async () => {
  const t = await rig.table();
  const who = devotion(t, 15);
  const [foe] = await t.fight([who]);
  t.kit.setEnemy(foe.id, { stats: { type: "fiend" } });
  t.foesTurn(foe);
  const hit = await t.strike(foe, who, [16, 3, 4]);
  assert.equal(hit.ok, true, hit.error);
  const roll = t.lastRolls(4).find((entry) => entry.kind === "attack");
  assert.equal(roll.breakdown.terms[0].dice.length, 2, "a fiend attacks the paladin with one d20: no disadvantage");
};

P["paladin.holy-nimbus.once"] = async () => {
  const t = await rig.table();
  const who = devotion(t, 20);
  await t.fight([who]);
  const first = await t.use(who, "holy nimbus");
  assert.equal(first.ok, true, first.error);
  assert.equal(t.budget().actionUsed, true, "Holy Nimbus took no action");
  t.freshTurn();
  const again = await t.use(who, "holy nimbus");
  assert.equal(again.ok, false, "a second Holy Nimbus before a long rest");
  await t.kit.endFight();
  await t.rest("short");
  t.patch(who, { conditions: [], conditionMeta: {} });
  await t.fight([who]);
  const third = await t.use(who, "holy nimbus");
  assert.equal(third.ok, false, "a short rest gave Holy Nimbus back");
};

await runProbes("scripts/test-enforce-sweep-clauses-srd-paladin.mjs", P);
