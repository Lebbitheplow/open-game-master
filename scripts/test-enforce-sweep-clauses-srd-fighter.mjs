// The clause ledger's probes for the fighter (SRD 5.1) and the Champion. The
// clause text and the verdict live in scripts/clauses/srd-classes.json; this
// file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runProbes } from "./lib/sweep-clauses-srd.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const SWORD = [{ name: "Longsword", qty: 1, equipped: true }];
const SHIELD = { name: "Shield", qty: 1, equipped: true };
const style = (name) => ({ name: `Fighting Style: ${name}`, source: "choice" });
const fighter = (t, level, extra = {}) => t.hero({ class: "fighter", level, equipment: SWORD, ...extra });
const champion = (t, level, extra = {}) => fighter(t, level, { subclass: "Champion", ...extra });
const d20s = (roll) => roll.breakdown.terms[0].dice.length;
const diceIn = (roll) => roll.breakdown.terms.filter((term) => term.kind === "dice").reduce((sum, term) => sum + term.count, 0);

const P = {};

// ---- Fighting Style ----

P["fighter.fighting-style.no-repeat"] = async () => {
  const t = await rig.table();
  const who = champion(t, 10, { features: [style("Defense"), style("Defense")], equipment: [...SWORD, { name: "Chain Mail", qty: 1, equipped: true }] });
  const held = t.sheet(who).features.filter((entry) => entry.name === "Fighting Style: Defense");
  assert.equal(held.length, 1, `Defense is held ${held.length} times`);
  assert.equal(t.ac(who), 17, "chain mail 16 and Defense once");
};

P["fighter.fighting-style.defense"] = async () => {
  const t = await rig.table();
  const mail = fighter(t, 1, { features: [style("Defense")], equipment: [...SWORD, { name: "Chain Mail", qty: 1, equipped: true }] });
  const plain = fighter(t, 1, { equipment: [...SWORD, { name: "Chain Mail", qty: 1, equipped: true }] });
  const bare = fighter(t, 1, { features: [style("Defense")] });
  assert.equal(t.ac(plain), 16);
  assert.equal(t.ac(mail), 17, "Defense adds 1 in armor");
  assert.equal(t.ac(bare), 12, "Defense adds nothing with no armor on (10 + DEX 2)");
};

async function guarded(t, guardExtra = {}) {
  const guard = fighter(t, 5, { features: [style("Protection")], equipment: [...SWORD, SHIELD], ...guardExtra });
  const ally = t.hero({ class: "rogue", level: 5 });
  const [foe] = await t.fight([guard, ally]);
  t.kit.place(ally.id, 5, 6);
  t.foesTurn(foe);
  return { guard, ally, foe };
}

P["fighter.fighting-style.protection-sight"] = async () => {
  const t = await rig.table();
  const { guard, ally, foe } = await guarded(t);
  t.patch(guard, { conditions: ["blinded"], conditionMeta: {} });
  const hit = await t.strike(foe, ally);
  assert.equal(hit.ok, true, hit.error);
  const out = await t.invoke("use_reaction", { characterId: guard.id, feature: "Protection", targetCharacterId: ally.id }, [2, 2]);
  assert.equal(out.ok, false, "a blinded fighter imposed Protection against an attacker they cannot see");
};

P["fighter.fighting-style.protection-not-self"] = async () => {
  const t = await rig.table();
  const { guard, foe } = await guarded(t);
  const hit = await t.strike(foe, guard);
  assert.equal(hit.ok, true, hit.error);
  const out = await t.invoke("use_reaction", { characterId: guard.id, feature: "Protection", targetCharacterId: guard.id }, [2, 2]);
  assert.equal(out.ok, false, "Protection was used against an attack on the protector");
};

// ---- Second Wind, Action Surge ----

for (const [id, resource] of [["fighter.second-wind.recharge", "second_wind"], ["fighter.action-surge-1-use.recharge", "action_surge"]]) {
  P[id] = async () => {
    const t = await rig.table();
    const who = fighter(t, 5);
    await t.fight([who]);
    t.patch(who, { currentHp: 20 });
    assert.equal(t.max(who, resource), 1);
    const first = await t.use(who, resource, {}, [5]);
    assert.equal(first.ok, true, first.error);
    t.freshTurn();
    const second = await t.use(who, resource, {}, [5]);
    assert.equal(second.ok, false, "a second use before a rest");
    await t.kit.endFight();
    const rest = await t.rest("short");
    assert.equal(rest.ok, true, rest.error);
    assert.equal(t.used(who, resource), 0, "a short rest did not give it back");
  };
}

// ---- Martial Archetype ----

P["fighter.martial-archetype.archetypes"] = async () => {
  const names = (await import("../src/lib/srd/features.ts")).subclassNamesFor("fighter");
  for (const name of ["Champion", "Battle Master", "Eldritch Knight"]) {
    assert.ok(names.includes(name), `no ${name}`);
  }
};

// ---- Extra Attack ----

P["fighter.extra-attack.attacks"] = async () => {
  for (const [level, attacks] of [[5, 2], [10, 2], [11, 3], [19, 3], [20, 4]]) {
    const t = await rig.table();
    const who = fighter(t, level);
    const [foe] = await t.fight([who]);
    for (let at = 0; at < attacks; at += 1) {
      const swing = await t.swing(who, foe, [10, 5]);
      assert.equal(swing.ok, true, `fighter ${level}, attack ${at + 1}: ${swing.error}`);
    }
    const over = await t.swing(who, foe, [10, 5]);
    assert.equal(over.ok, false, `fighter ${level} made attack ${attacks + 1} with one action`);
  }
};

// ---- Indomitable ----

P["fighter.indomitable-1-use.new-roll-stands"] = async () => {
  const t = await rig.table();
  const who = fighter(t, 9, { abilities: { wis: 10 } });
  const held = await t.invoke("cast_at_player", { characterId: who.id, saveAbility: "wis", dc: 15, condition: "paralyzed", source: "Hold Person" }, [2]);
  assert.equal(held.ok, true, held.error);
  assert.ok(t.has(who, "paralyzed"));
  // The new roll fails too: it stands, the use is gone, the condition stays.
  const reroll = await t.use(who, "Indomitable", {}, [3]);
  assert.equal(reroll.ok, true, reroll.error);
  assert.ok(t.has(who, "paralyzed"), "a failed reroll lifted the condition");
  assert.equal(t.used(who, "indomitable"), 1);
  const again = await t.use(who, "Indomitable", {}, [19]);
  assert.equal(again.ok, false, "a second reroll with one use");
};

// ---- Remarkable Athlete ----

P["fighter.remarkable-athlete.initiative"] = async () => {
  const t = await rig.table();
  const plain = champion(t, 6);
  const who = champion(t, 7);
  const before = await t.roll(plain, { kind: "initiative" }, [10]);
  assert.equal(before.total, 12, "DEX 14 alone at 6th level");
  // Initiative is a Dexterity check: 10 + DEX 2 + half of proficiency 3, rounded up.
  const roll = await t.roll(who, { kind: "initiative" }, [10]);
  assert.equal(roll.total, 14, `a 7th level Champion's initiative on a 10 is ${roll.total}`);
};

// ---- Superior Critical ----

P["fighter.superior-critical.crit-18"] = async () => {
  const t = await rig.table();
  const young = champion(t, 14);
  const old = champion(t, 15);
  const [foe] = await t.fight([young, old]);
  t.kit.place(old.id, 6, 4);
  const miss = await t.swing(young, foe, [18, 4, 4]);
  assert.equal(diceIn(miss.damage), 1, "an 18 at 14th level is an ordinary hit");
  t.kit.giveTurn(old.id);
  const crit = await t.swing(old, foe, [18, 4, 4]);
  assert.equal(crit.ok, true, crit.error);
  assert.equal(diceIn(crit.damage), 2, "an 18 at 15th level doubles the weapon's die");
  t.freshTurn();
  const plain = await t.swing(old, foe, [17, 4, 4]);
  assert.equal(diceIn(plain.damage), 1, "a 17 is no critical hit");
};

await runProbes("scripts/test-enforce-sweep-clauses-srd-fighter.mjs", P);
