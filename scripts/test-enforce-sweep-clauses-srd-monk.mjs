// The clause ledger's probes for the monk (SRD 5.1) and the Way of the Open
// Hand. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each clause that
// names it is staged.
import "./lib/enforce-world.mjs";
import { runProbes } from "./lib/sweep-clauses-srd.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const worn = (...names) => names.map((name) => ({ name, qty: 1, equipped: true }));
const monk = (t, level, extra = {}) => t.hero({ class: "monk", level, ...extra, abilities: { str: 10, dex: 16, wis: 16, ...(extra.abilities ?? {}) } });
const openHand = (t, level, extra = {}) => monk(t, level, { subclass: "Way of the Open Hand", ...extra });
const BOW = { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing", mode: "ranged", range: { normal: 80, long: 320 } };
const UNARMED = { weapon: "unarmed strike" };

const P = {};

// ---- Martial Arts ----

P["monk.martial-arts.monk-weapons"] = async () => {
  // STR 10, DEX 16, proficiency +2: a monk weapon attacks at +5, any other at +2.
  for (const [weapon, toHit] of [["Shortsword", "1d20+5"], ["Quarterstaff", "1d20+5"], ["Dagger", "1d20+5"], ["Greatclub", "1d20+2"], ["Longsword", "1d20+2"]]) {
    const t = await rig.table();
    const who = monk(t, 1, { equipment: worn(weapon) });
    const [foe] = await t.fight([who]);
    const swing = await t.swing(who, foe, [10, 3], { weapon });
    assert.equal(swing.ok, true, `${weapon}: ${swing.error}`);
    assert.equal(swing.toHit.expression, toHit, `${weapon} attacks with ${swing.toHit.expression}`);
  }
};

P["monk.martial-arts.only-monk-weapons"] = async () => {
  const t = await rig.table();
  const who = monk(t, 1, { equipment: worn("Longsword") });
  const [foe] = await t.fight([who]);
  // A longsword in hand is no monk weapon: the monk is not "wielding only
  // monk weapons", so the unarmed strike is anyone's: STR, 1 damage.
  const swing = await t.swing(who, foe, [15, 3], UNARMED);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.expression, "1d20+2", `with a longsword in hand the unarmed strike attacks with ${swing.toHit.expression}`);
};

// ---- Ki ----

P["monk.ki.recharge"] = async () => {
  const t = await rig.table();
  const who = monk(t, 5);
  await t.fight([who]);
  const spent = await t.use(who, "ki", { variant: "patient defense" });
  assert.equal(spent.ok, true, spent.error);
  assert.equal(t.used(who, "ki"), 1);
  await t.kit.endFight();
  const rest = await t.rest("short");
  assert.equal(rest.ok, true, rest.error);
  assert.equal(t.used(who, "ki"), 0, "a short rest did not bring the ki back");
};

P["monk.ki.dc"] = async () => {
  // Monk 5, WIS 16: 8 + 3 + 3 = 14. The dummy's CON save is +1.
  for (const [face, stunned] of [[12, true], [13, false]]) {
    const t = await rig.table();
    const who = monk(t, 5);
    const [foe] = await t.fight([who]);
    const hit = await t.swing(who, foe, [15, 3, face], { ...UNARMED, stunningStrike: true });
    assert.equal(hit.ok, true, hit.error);
    assert.equal(t.foeHas(foe, "stunned"), stunned, `a CON save of ${face + 1} against the ki DC of 14`);
  }
};

// ---- Unarmored Movement ----

P["monk.unarmored-movement.speed"] = async () => {
  const t = await rig.table();
  assert.equal(t.speed(monk(t, 1)), 30);
  assert.equal(t.speed(monk(t, 2)), 40, "a 2nd level monk walks 40 feet");
  assert.equal(t.speed(monk(t, 2, { equipment: worn("Shield") })), 30, "Unarmored Movement behind a shield");
  assert.equal(t.speed(monk(t, 2, { equipment: worn("Leather Armor") })), 30, "Unarmored Movement in armor");
};

// ---- Monastic Tradition ----

P["monk.monastic-tradition.traditions"] = async () => {
  const names = (await import("../src/lib/srd/features.ts")).subclassNamesFor("monk");
  for (const name of ["Way of the Open Hand", "Way of Shadow", "Way of the Four Elements"]) {
    assert.ok(names.includes(name), `no ${name}`);
  }
};

// ---- Deflect Missiles ----

async function shotAt(t, who, x) {
  const [foe] = await t.fight([who]);
  t.kit.setEnemy(foe.id, { stats: { attacks: [BOW] } });
  t.kit.place(foe.id, x, 5);
  t.foesTurn(foe);
  // 15 + 4 hits; 1 + 2 piercing.
  const shot = await t.strike(foe, who, [15, 1]);
  assert.equal(shot.ok, true, shot.error);
  return foe;
}

P["monk.deflect-missiles.free-hand"] = async () => {
  const t = await rig.table();
  const who = monk(t, 5, { equipment: worn("Shortsword", "Dagger") });
  const foe = await shotAt(t, who, 9);
  // The d10, then (were it thrown) the attack and its damage.
  const out = await t.invoke("use_reaction", { characterId: who.id, feature: "Deflect Missiles", targetEnemyId: foe.id }, [10, 15, 4]);
  assert.equal(t.used(who, "ki"), 0, `with a weapon in each hand the monk caught the missile and threw it back (${out.ok ? "accepted" : out.error})`);
};

P["monk.deflect-missiles.throw-range"] = async () => {
  const t = await rig.table();
  const who = monk(t, 5);
  const foe = await shotAt(t, who, 18);
  const before = t.enemy(foe).currentHp;
  // The archer stands 65 feet off: past the caught missile's long range of 60.
  const out = await t.invoke("use_reaction", { characterId: who.id, feature: "Deflect Missiles", targetEnemyId: foe.id }, [10, 15, 4]);
  assert.equal(t.enemy(foe).currentHp, before, `the missile was thrown back 65 feet and hit (${out.ok ? "accepted" : out.error})`);
  assert.equal(t.used(who, "ki"), 0, "ki was spent on a throw past the long range");
};

// ---- Stillness of Mind ----

P["monk.stillness-of-mind.frightened"] = async () => {
  const t = await rig.table();
  const who = monk(t, 7);
  const [foe] = await t.fight([who]);
  const scared = await t.condition(who, "frightened", { rounds: 20, sourceEnemyId: foe.id });
  assert.equal(scared.ok, true, scared.error);
  const out = await t.use(who, "stillness of mind");
  assert.equal(out.ok, true, out.error);
  assert.equal(t.has(who, "frightened"), false, "the fear stayed");
};

P["monk.stillness-of-mind.action"] = async () => {
  const t = await rig.table();
  const who = monk(t, 7);
  const [foe] = await t.fight([who]);
  t.patch(who, { conditions: ["charmed"], conditionMeta: { charmed: { rounds: 10 } } });
  const out = await t.use(who, "stillness of mind");
  assert.equal(out.ok, true, out.error);
  assert.equal(t.has(who, "charmed"), false);
  assert.equal(t.budget()?.actionUsed ?? false, true, "Stillness of Mind ended the charm and took no action");
  const swing = await t.swing(who, foe, [15, 3], UNARMED);
  assert.equal(swing.ok, false, "the monk attacked with the action Stillness of Mind had taken");
};

// ---- Timeless Body ----

P["monk.timeless-body.no-food"] = async () => {
  const t = await rig.table({ gameSettings: { variantRules: { supplies: true } } });
  const other = t.hero({ class: "fighter", level: 15 });
  const who = monk(t, 15);
  // Nobody carries food or water: two dawns pass.
  const days = await t.invoke("pass_time", { amount: 2, unit: "days" }, []);
  assert.equal(days.ok, true, days.error);
  assert.ok(t.sheet(other).exhaustion > 0, "the staging is wrong: two days without water cost the fighter nothing");
  assert.equal(t.sheet(who).exhaustion, 0, `a 15th level monk went without food and water and has exhaustion ${t.sheet(who).exhaustion}`);
};

// ---- Open Hand Technique ----

async function flurry(t, choice, faces) {
  const who = openHand(t, 5);
  const [foe] = await t.fight([who]);
  const first = await t.swing(who, foe, [15, 3], UNARMED);
  assert.equal(first.ok, true, first.error);
  const strike = await t.swing(who, foe, faces, { ...UNARMED, feature: "flurry of blows", openHand: choice });
  assert.equal(strike.ok, true, strike.error);
  return { who, foe };
}

P["monk.open-hand-technique.push"] = async () => {
  const t = await rig.table();
  // To hit, the Martial Arts die, then the creature's STR save (+1): a 2 fails.
  const { foe } = await flurry(t, "push", [15, 3, 2]);
  const at = t.kit.token(foe.id);
  assert.equal(at.x, 9, `the creature that failed its Strength save stands at column ${at.x}, not 15 feet further off (9)`);
  const t2 = await rig.table();
  const kept = await flurry(t2, "push", [15, 3, 19]);
  assert.equal(t2.kit.token(kept.foe.id).x, 6, "a creature that made its Strength save was pushed");
};

P["monk.open-hand-technique.no-reactions"] = async () => {
  const t = await rig.table();
  const { who, foe } = await flurry(t, "no reactions", [15, 3]);
  const marked = () => t.enemy(foe).conditions.length;
  assert.equal(marked(), 1, `the creature carries ${t.enemy(foe).conditions.join(", ") || "nothing"}`);
  assert.ok(t.endTurn(who));
  assert.equal(marked(), 1, "it has its reactions back before the monk's next turn has ended");
  assert.ok(t.endTurn(who));
  assert.equal(marked(), 0, "it still cannot react after the end of the monk's next turn");
};

// ---- Tranquility ----

P["monk.tranquility.ends-on-attack"] = async () => {
  const t = await rig.table();
  const who = openHand(t, 11);
  const rest = await t.rest("long");
  assert.equal(rest.ok, true, rest.error);
  const kept = t.sheet(who).conditions.find((entry) => /sanctuary/i.test(entry));
  assert.ok(kept, `after a long rest the monk carries ${t.sheet(who).conditions.join(", ") || "nothing"}`);
  const [foe] = await t.fight([who]);
  t.patch(who, { conditions: [kept], conditionMeta: t.sheet(who).conditionMeta });
  const swing = await t.swing(who, foe, [15, 3], UNARMED);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(t.sheet(who).conditions.some((entry) => /sanctuary/i.test(entry)), false, "the monk attacked and is still under Sanctuary");
};

// ---- Quivering Palm ----

async function palm(t, foes = 1) {
  const who = openHand(t, 17);
  const list = await t.fight([who], { foes });
  const hit = await t.swing(who, list[0], [18, 4], UNARMED);
  assert.equal(hit.result.hit, true, hit.error);
  const set = await t.use(who, "Quivering Palm", { targetEnemyId: list[0].id });
  assert.equal(set.ok, true, set.error);
  return { who, list };
}

P["monk.quivering-palm.days"] = async () => {
  const t = await rig.table();
  const { list } = await palm(t);
  const meta = t.enemy(list[0]).conditionMeta["quivering palm"];
  // A round is six seconds: a day is 14,400 of them, and the monk is 17th level.
  assert.equal(meta.rounds, 14400 * 17, `the vibrations last ${meta.rounds / 14400} day(s) for a 17th level monk`);
};

P["monk.quivering-palm.saved"] = async () => {
  const t = await rig.table();
  const { who, list } = await palm(t);
  const before = t.enemy(list[0]).currentHp;
  t.freshTurn();
  const end = await t.use(who, "Quivering Palm", { targetEnemyId: list[0].id }, [20, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
  assert.equal(end.ok, true, end.error);
  assert.equal(t.enemy(list[0]).currentHp, before - 50, "a creature that saved takes 10d10 necrotic");
  assert.equal(t.budget()?.actionUsed, true, "ending the vibrations took no action");
};

P["monk.quivering-palm.one-at-a-time"] = async () => {
  const t = await rig.table();
  const { who, list } = await palm(t, 2);
  t.kit.place(list[1].id, 5, 6);
  t.freshTurn();
  const hit = await t.swing(who, list[1], [18, 4], UNARMED);
  assert.equal(hit.result.hit, true, hit.error);
  await t.use(who, "Quivering Palm", { targetEnemyId: list[1].id });
  const holding = list.filter((foe) => t.foeHas(foe, "quivering palm")).length;
  assert.equal(holding, 1, `${holding} creatures carry the monk's vibrations at once`);
};

await runProbes("scripts/test-enforce-sweep-clauses-srd-monk.mjs", P);
