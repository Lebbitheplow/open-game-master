// The clause ledger's probes for the barbarian (SRD 5.1) and the Path of the
// Berserker: each clause of scripts/clauses/srd-classes.json that names this
// file is run here, as a test() where the ledger says the engine holds it and
// as a gap() where it says the engine does not. The clause text and the
// verdict live in the ledger; this file holds only how each is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const AXE = [{ name: "Greataxe", qty: 1, equipped: true }];
const barbarian = (t, level, extra = {}) => t.hero({ class: "barbarian", level, equipment: AXE, ...extra });
const berserker = (t, level, extra = {}) => barbarian(t, level, { subclass: "Path of the Berserker", ...extra });

async function raging(t, who) {
  const out = await t.use(who, "rage");
  assert.equal(out.ok, true, `the rage was refused: ${out.error}`);
  assert.ok(t.has(who, "raging"));
}

const P = {};

// ---- Rage ----

P["barbarian.rage.on-your-turn"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 5);
  const [foe] = await t.fight([who]);
  t.foesTurn(foe);
  const out = await t.use(who, "rage");
  assert.equal(out.ok, false, "a rage was entered on a foe's turn");
  assert.equal(t.has(who, "raging"), false);
  assert.equal(t.used(who, "rage"), 0, "the refused rage was spent");
};

P["barbarian.rage.str-save"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 5);
  await t.fight([who]);
  const calm = await t.roll(who, { kind: "saving_throw", ability: "str", dc: 10 }, [3]);
  assert.equal(calm.faces.length, 1, "a Strength save rolls one d20 before the rage");
  await raging(t, who);
  const save = await t.roll(who, { kind: "saving_throw", ability: "str", dc: 10 }, [3, 17]);
  assert.equal(save.faces.length, 2, "a raging barbarian's Strength save rolls two d20s");
  const con = await t.roll(who, { kind: "saving_throw", ability: "con", dc: 10 }, [3]);
  assert.equal(con.faces.length, 1, "the rage gives nothing on a Constitution save");
};

P["barbarian.rage.unconscious"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 5);
  await t.fight([who]);
  await raging(t, who);
  // Knocked out with hit points left: a Sleep spell, a drow's poison.
  const out = await t.condition(who, "unconscious", { rounds: 10 });
  assert.equal(out.ok, true, out.error);
  assert.ok(t.has(who, "unconscious"));
  assert.equal(t.has(who, "raging"), false, "the barbarian is unconscious and still raging");
};

P["barbarian.rage.end-bonus"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 5);
  await t.fight([who]);
  await raging(t, who);
  t.freshTurn();
  // The barbarian's own choice: the spend's door first, then the condition's.
  const spend = await t.use(who, "rage", { variant: "end" });
  if (!spend.ok) {
    await t.invoke("clear_condition", { characterId: who.id, condition: "raging" });
  }
  assert.equal(t.has(who, "raging"), false, "nothing ended the rage");
  assert.equal(t.used(who, "rage"), 1, "ending a rage spent another");
  assert.equal(t.budget()?.bonusUsed ?? false, true, `ending the rage took no bonus action (use_resource: ${spend.ok ? "accepted" : spend.error})`);
};

P["barbarian.rage.long-rest"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 1);
  assert.equal(t.max(who, "rage"), 2);
  await t.fight([who]);
  for (let at = 0; at < 2; at += 1) {
    await raging(t, who);
    t.patch(who, { conditions: [], conditionMeta: {} });
    t.freshTurn();
  }
  const third = await t.use(who, "rage");
  assert.equal(third.ok, false, "a third rage at level 1");
  await t.kit.endFight();
  const short = await t.rest("short");
  assert.equal(short.ok, true, short.error);
  assert.equal(t.used(who, "rage"), 2, "a short rest gave rages back");
  const long = await t.rest("long");
  assert.equal(long.ok, true, long.error);
  assert.equal(t.used(who, "rage"), 0, "a long rest gave no rages back");
};

// ---- Reckless Attack ----

P["barbarian.reckless-attack.first-attack"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 5);
  const [foe] = await t.fight([who]);
  const first = await t.swing(who, foe, [10, 5]);
  assert.equal(first.ok, true, first.error);
  const second = await t.swing(who, foe, [10, 12, 5], { reckless: true });
  assert.equal(second.ok, false, "Reckless Attack was decided on the second attack of the turn");
  assert.equal(t.budget().attacksMade, 1, "the refused swing was counted");
};

P["barbarian.reckless-attack.whole-turn"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 5);
  const [foe] = await t.fight([who]);
  const first = await t.swing(who, foe, [10, 12, 5], { reckless: true });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.toHit.breakdown.terms[0].dice.length, 2, "the reckless attack rolls two d20s");
  // The second attack of the same turn, with nothing said again.
  const second = await t.swing(who, foe, [10, 12, 5]);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.toHit.breakdown.terms[0].dice.length, 2, "the second attack of a reckless turn rolls one d20");
};

// ---- Danger Sense ----

P["barbarian.danger-sense.senses"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 5);
  for (const lost of ["blinded", "deafened", "incapacitated"]) {
    t.patch(who, { conditions: [lost], conditionMeta: {} });
    const save = await t.roll(who, { kind: "saving_throw", ability: "dex", dc: 10 }, [3]);
    assert.equal(save.faces.length, 1, `Danger Sense worked while ${lost}`);
  }
  t.patch(who, { conditions: [], conditionMeta: {} });
  const clear = await t.roll(who, { kind: "saving_throw", ability: "dex", dc: 10 }, [3, 17]);
  assert.equal(clear.faces.length, 2);
};

// ---- Primal Path ----

P["barbarian.primal-path.paths"] = async () => {
  const names = (await import("../src/lib/srd/features.ts")).subclassNamesFor("barbarian");
  assert.ok(names.includes("Path of the Berserker"), "no Path of the Berserker");
  assert.ok(names.includes("Path of the Totem Warrior"), "no Path of the Totem Warrior");
};

// ---- Fast Movement ----

P["barbarian.fast-movement.speed"] = async () => {
  const t = await rig.table();
  const four = barbarian(t, 4);
  const five = barbarian(t, 5);
  const plate = barbarian(t, 5, { equipment: [...AXE, { name: "Plate Armor", qty: 1, equipped: true }], abilities: { str: 16 } });
  const chain = barbarian(t, 5, { equipment: [...AXE, { name: "Half Plate", qty: 1, equipped: true }] });
  assert.equal(t.speed(four), 30, "a 4th level barbarian walks 30 feet");
  assert.equal(t.speed(five), 40, "a 5th level barbarian walks 40 feet");
  assert.equal(t.speed(chain), 40, "medium armor does not stop Fast Movement");
  assert.equal(t.speed(plate), 30, "Fast Movement in heavy armor");
};

// ---- Feral Instinct ----

P["barbarian.feral-instinct.surprised-rage"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 7);
  const other = t.hero({ class: "fighter", level: 7, equipment: AXE });
  await t.kit.fight(1, { surprised: "party", enemyFace: 1, heroFaces: { [who.id]: 20, [other.id]: 2 } });
  const [foe] = t.world.enemies();
  t.kit.place(who.id, 5, 5);
  t.kit.place(foe.id, 6, 5);
  // Not incapacitated, so the first turn is theirs to take if they rage first.
  assert.equal(t.world.encounter().round, 1, "the barbarian's first turn was skipped: the fight opened in round 2");
  assert.equal(t.kit.current()?.characterId, who.id, "the fight did not open on the barbarian");
  const rage = await t.use(who, "rage");
  assert.equal(rage.ok, true, `a surprised barbarian with Feral Instinct could not enter a rage: ${rage.error}`);
  const swing = await t.swing(who, foe, [15, 5]);
  assert.equal(swing.ok, true, `having raged first, they still could not act: ${swing.error}`);
};

// ---- Brutal Critical ----

P["barbarian.brutal-critical-1-die.melee-only"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 9, { equipment: [{ name: "Longbow", qty: 1, equipped: true }], abilities: { dex: 16 } });
  const [foe] = await t.fight([who]);
  t.kit.place(foe.id, 12, 5);
  const shot = await t.swing(who, foe, [20, 4, 4, 4, 4]);
  assert.equal(shot.ok, true, shot.error);
  const dice = shot.damage.breakdown.terms.filter((term) => term.kind === "dice").reduce((sum, term) => sum + term.count, 0);
  assert.equal(dice, 2, `a longbow critical hit rolled ${dice} dice: Brutal Critical is for a melee attack`);
};

// ---- Relentless Rage ----

P["barbarian.relentless-rage.only-raging"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 11);
  await t.fight([who]);
  t.patch(who, { currentHp: 5 });
  const out = await t.invoke("apply_damage", { characterId: who.id, amount: 9, type: "fire" }, [20]);
  assert.equal(out.ok, true, out.error);
  assert.equal(t.sheet(who).currentHp, 0, "not raging, the barbarian stayed up");
  assert.equal(t.used(who, "relentless_rage"), 0);
};

P["barbarian.relentless-rage.not-outright"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 11);
  await t.fight([who]);
  await raging(t, who);
  t.patch(who, { currentHp: 5 });
  // 5 left of 80: 200 fire damage leaves more than the maximum over.
  const out = await t.invoke("apply_damage", { characterId: who.id, amount: 200, type: "fire" }, [20]);
  assert.equal(out.ok, true, out.error);
  const sheet = t.sheet(who);
  assert.equal(sheet.currentHp, 0, "massive damage left them standing");
  assert.equal(sheet.deathSaves?.dead, true, "massive damage did not kill outright");
};

P["barbarian.relentless-rage.dc-resets"] = async () => {
  const t = await rig.table();
  const who = barbarian(t, 11);
  await t.fight([who]);
  await raging(t, who);
  t.patch(who, { currentHp: 5 });
  const first = await t.invoke("apply_damage", { characterId: who.id, amount: 9, type: "fire" }, [15]);
  assert.equal(first.ok, true, first.error);
  assert.equal(t.sheet(who).currentHp, 1, "the first save (DC 10) did not hold them at 1");
  assert.equal(t.used(who, "relentless_rage"), 1);
  await t.kit.endFight();
  const rest = await t.rest("short");
  assert.equal(rest.ok, true, rest.error);
  assert.equal(t.used(who, "relentless_rage"), 0, "a short rest did not reset the DC");
};

// ---- Persistent Rage ----

P["barbarian.persistent-rage.no-early-end"] = async () => {
  const t = await rig.table();
  const young = barbarian(t, 14);
  const old = barbarian(t, 15);
  for (const who of [young, old]) {
    await t.fight([who]);
    await raging(t, who);
    assert.ok(t.endTurn(who), "End Turn was refused");
  }
  assert.equal(t.has(young, "raging"), false, "at 14th level an idle turn should end the rage");
  assert.equal(t.has(old, "raging"), true, "Persistent Rage: the rage ended on an idle turn");
};

// ---- Frenzy ----

P["barbarian.frenzy.enter"] = async () => {
  const t = await rig.table();
  const who = berserker(t, 3);
  const [foe] = await t.fight([who]);
  await raging(t, who);
  // The turn the rage begins on: its bonus action is the rage's.
  const now = await t.swing(who, foe, [15, 5], { feature: "frenzy" });
  assert.equal(now.ok, false, "a frenzy attack on the turn the rage began");
  const attack = await t.swing(who, foe, [15, 5]);
  assert.equal(attack.ok, true, attack.error);
  assert.ok(t.endTurn(who));
  const next = await t.swing(who, foe, [15, 5], { feature: "frenzy" });
  assert.equal(next.ok, true, `the frenzy attack on the next turn was refused: ${next.error}`);
  assert.equal(t.budget().bonusUsed, true, "the frenzy attack took no bonus action");
  assert.ok(t.has(who, "frenzied"));
};

P["barbarian.frenzy.exhaustion"] = async () => {
  const t = await rig.table();
  const who = berserker(t, 3);
  const [foe] = await t.fight([who]);
  await raging(t, who);
  const attack = await t.swing(who, foe, [15, 5]);
  assert.equal(attack.ok, true, attack.error);
  assert.ok(t.endTurn(who));
  const next = await t.swing(who, foe, [15, 5], { feature: "frenzy" });
  assert.equal(next.ok, true, next.error);
  assert.equal(t.sheet(who).exhaustion, 0);
  // The fight ends with the rage still running; its minute runs out on the clock.
  const over = await t.invoke("end_encounter", { outcome: "truce" });
  assert.equal(over.ok, true, over.error);
  const later = await t.invoke("pass_time", { amount: 5, unit: "minutes" });
  assert.equal(later.ok, true, later.error);
  assert.equal(t.has(who, "raging"), false, "the rage outlived its minute");
  assert.equal(t.sheet(who).exhaustion, 1, `the rage ended and the frenzy cost no exhaustion (conditions: ${t.sheet(who).conditions.join(", ") || "none"})`);
};

// ---- Mindless Rage ----

P["barbarian.mindless-rage.suspended"] = async () => {
  const t = await rig.table();
  const who = berserker(t, 6);
  const [foe] = await t.fight([who]);
  const scared = await t.condition(who, "frightened", { rounds: 20, sourceEnemyId: foe.id });
  assert.equal(scared.ok, true, scared.error);
  const before = await t.swing(who, foe, [10, 12, 5]);
  assert.equal(before.toHit.breakdown.terms[0].dice.length, 2, "frightened of the foe in sight: disadvantage");
  t.freshTurn();
  await raging(t, who);
  const during = await t.swing(who, foe, [10, 5]);
  assert.equal(during.ok, true, during.error);
  assert.equal(during.toHit.breakdown.terms[0].dice.length, 1, "the fear still gives disadvantage during the rage");
  // Suspended, not ended: the rage over, the fear is back with its clock.
  t.freshTurn();
  const calm = await t.use(who, "rage", { variant: "end" });
  assert.equal(calm.ok, true, calm.error);
  assert.ok(t.has(who, "frightened"), `the rage ended and the fear it suspended did not come back (${t.sheet(who).conditions.join(", ") || "none"})`);
  const after = await t.swing(who, foe, [10, 12, 5]);
  assert.equal(after.toHit.breakdown.terms[0].dice.length, 2, "the fear given back costs no disadvantage");
};

// ---- Intimidating Presence ----

async function presence(t, extra = {}) {
  const who = berserker(t, 10, { abilities: { cha: 14 }, ...extra });
  const foes = await t.fight([who], { foes: 2 });
  return { who, foe: foes[0], far: foes[1] };
}

P["barbarian.intimidating-presence.range"] = async () => {
  const t = await rig.table();
  const { who, far } = await presence(t);
  const out = await t.use(who, "intimidating presence", { targetEnemyId: far.id }, [1]);
  assert.equal(out.ok, false, "a creature 60 feet away was menaced");
  assert.equal(t.budget()?.actionUsed ?? false, false, "the refused use took the action");
};

P["barbarian.intimidating-presence.sight"] = async () => {
  const t = await rig.table();
  const { who, foe } = await presence(t);
  t.patch(who, { conditions: ["blinded"], conditionMeta: {} });
  const out = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [1]);
  assert.equal(out.ok, false, "a blinded barbarian chose a creature they can see");
  assert.equal(t.foeHas(foe, "frightened"), false);
};

P["barbarian.intimidating-presence.sees-or-hears"] = async () => {
  const t = await rig.table();
  const { who, foe } = await presence(t);
  t.kit.setEnemy(foe.id, { conditions: ["blinded", "deafened"] });
  const out = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [1]);
  assert.equal(t.foeHas(foe, "frightened"), false, `a creature that can neither see nor hear the barbarian was frightened (${out.ok ? "accepted" : out.error})`);
};

P["barbarian.intimidating-presence.dc"] = async () => {
  const t = await rig.table();
  const { who, foe } = await presence(t);
  // 8 + 4 (proficiency at 10th) + 2 (CHA 14) = 14; the dummy's WIS save is +0.
  const held = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [14]);
  assert.equal(held.ok, true, held.error);
  assert.equal(t.foeHas(foe, "frightened"), false, "a 14 failed against DC 14");
  const t2 = await rig.table();
  const second = await presence(t2);
  const failed = await t2.use(second.who, "intimidating presence", { targetEnemyId: second.foe.id }, [13]);
  assert.equal(failed.ok, true, failed.error);
  assert.equal(t2.foeHas(second.foe, "frightened"), true, "a 13 saved against DC 14");
};

P["barbarian.intimidating-presence.extend"] = async () => {
  const t = await rig.table();
  const { who, foe } = await presence(t);
  const first = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [2]);
  assert.equal(first.ok, true, first.error);
  assert.ok(t.endTurn(who));
  assert.ok(t.foeHas(foe, "frightened"), "the fear ended before the barbarian's next turn was over");
  // The action again, and no new save: no die is queued, a 20 would free it.
  const again = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [20]);
  assert.equal(again.ok, true, again.error);
  assert.equal(again.unused, 1, "extending the fear rolled a new save");
  assert.ok(t.endTurn(who));
  assert.ok(t.foeHas(foe, "frightened"), "the extended fear ended with the turn it was extended on");
  assert.ok(t.endTurn(who));
  assert.equal(t.foeHas(foe, "frightened"), false, "the fear outlived the turn after its extension");
};

P["barbarian.intimidating-presence.ends-far"] = async () => {
  const t = await rig.table();
  const { who, foe } = await presence(t);
  const first = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [2]);
  assert.equal(first.ok, true, first.error);
  assert.ok(t.foeHas(foe, "frightened"));
  // The creature ends its own turn 65 feet from the barbarian.
  t.kit.place(foe.id, 18, 5);
  assert.ok(t.endTurn(who));
  assert.equal(t.kit.current()?.characterId, who.id);
  assert.equal(t.foeHas(foe, "frightened"), false, "the creature ended its turn 65 feet away and is still frightened");
};

P["barbarian.intimidating-presence.unmoved"] = async () => {
  const t = await rig.table();
  const { who, foe } = await presence(t);
  const first = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [20]);
  assert.equal(first.ok, true, first.error);
  assert.equal(t.foeHas(foe, "frightened"), false);
  t.freshTurn();
  const again = await t.use(who, "intimidating presence", { targetEnemyId: foe.id }, [1]);
  assert.equal(again.ok, false, "the creature that saved was menaced again within the day");
  assert.equal(t.budget()?.actionUsed ?? false, false, "the refused use took the action");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-barbarian.mjs", P);
