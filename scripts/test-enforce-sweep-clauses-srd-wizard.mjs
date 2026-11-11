// The clause ledger's probes for the wizard's features (SRD 5.1) and the
// School of Evocation. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each clause that
// names it is staged. (What the spellbook and the prepared list may hold is
// in test-enforce-sweep-clauses-srd-spells.mjs.)
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const BOOK = ["Magic Missile", "Burning Hands", "Misty Step", "Fireball", "Counterspell", "Detect Magic"];
const wizard = (t, level, extra = {}) =>
  t.hero({
    class: "wizard", level, abilities: { int: 18 },
    spellcasting: { ability: "int", slots: slots(4, 3, 3, 3, 2), prepared: BOOK, known: [], cantrips: [], spellbook: BOOK },
    ...extra,
  });
const hold = (t, who, ...names) => t.patch(who, { features: [...t.sheet(who).features, ...names.map((name) => ({ name, source: "choice" }))] });
const usedSlots = (t, who) => Object.fromEntries(Object.entries(t.sheet(who).spellcasting.slots).map(([level, slot]) => [level, slot.used]));
const P = {};

P["wizard.spell-mastery.higher-slot"] = async () => {
  const t = await rig.table();
  const who = wizard(t, 18);
  hold(t, who, "Spell Mastery: Magic Missile, Misty Step");
  const [foe] = await t.fight([who]);
  const own = await t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Magic Missile" }, [3, 3, 3]);
  assert.equal(own.ok, true, own.error);
  assert.equal(usedSlots(t, who)[1], 0, "the mastered spell at its lowest level spent a slot");
  t.freshTurn();
  const higher = await t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Magic Missile", level: 3 }, [3, 3, 3, 3, 3]);
  assert.equal(higher.ok, true, higher.error);
  assert.equal(usedSlots(t, who)[3], 1, "the mastered spell at a higher level spent no slot of that level");
};

P["wizard.signature-spells.higher-slot"] = async () => {
  const t = await rig.table();
  const who = wizard(t, 20);
  hold(t, who, "Signature Spells: Fireball, Counterspell");
  const [foe] = await t.fight([who]);
  const counter = Object.keys(t.sheet(who).resources).filter((id) => /signature/.test(id));
  assert.ok(counter.length, `no Signature Spells counter: ${Object.keys(t.sheet(who).resources).join(", ")}`);
  const spentUses = () => counter.reduce((sum, id) => sum + t.used(who, id), 0);
  const higher = await t.invoke("aoe_damage", { casterId: who.id, spell: "Fireball", level: 4, enemyIds: [foe.id] }, [10, ...new Array(9).fill(3)]);
  assert.equal(higher.ok, true, higher.error);
  assert.equal(usedSlots(t, who)[4], 1, "the signature spell at 4th level spent no 4th-level slot");
  assert.equal(spentUses(), 0, "the signature use was spent on a casting above 3rd level");
  t.freshTurn();
  const third = await t.invoke("aoe_damage", { casterId: who.id, spell: "Fireball", level: 3, enemyIds: [foe.id] }, [10, ...new Array(8).fill(3)]);
  assert.equal(third.ok, true, third.error);
  assert.equal(usedSlots(t, who)[3], 0, "the signature spell at 3rd level spent a slot");
  assert.equal(spentUses(), 1, "the signature use");
};

P["wizard.overchannel.repeat"] = async () => {
  const t = await rig.table();
  const who = wizard(t, 14, { subclass: "School of Evocation" });
  // Necrotic resistance, which the cost goes through.
  hold(t, who, "Fiendish Resilience (necrotic)");
  const [foe] = await t.fight([who]);
  const cast = async (dice) => {
    t.freshTurn();
    const before = t.sheet(who).currentHp;
    const out = await t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Burning Hands", level: 1, overchannel: true }, [6, ...dice]);
    assert.equal(out.ok, true, out.error);
    return before - t.sheet(who).currentHp;
  };
  assert.equal(await cast([]), 0, "the first use since a long rest costs nothing");
  // 2d12 a spell level, then 1d12 more a level each further use; 6 on each die.
  assert.equal(await cast([6, 6]), 12, "the second use: 2d12 necrotic for a 1st-level spell, no resistance");
  assert.equal(await cast([6, 6, 6]), 18, "the third use: 3d12");
  const rested = await t.invoke("end_encounter", { outcome: "truce" });
  assert.equal(rested.ok, true, rested.error);
  assert.equal((await t.rest("long")).ok, true);
  assert.equal(t.used(who, "overchannel"), 0, "a long rest starts the count again");
};

P["wizard.evocation-savant.copy"] = async () => {
  const cost = {};
  for (const subclass of ["School of Evocation", ""]) {
    const t = await rig.table();
    const who = wizard(t, 5, { ...(subclass ? { subclass } : {}), gold: 500 });
    // Fireball (evocation, 3rd level): 150 gp and 6 hours as anyone copies it.
    t.patch(who, { spellcasting: { ...t.sheet(who).spellcasting, prepared: ["Magic Missile"], spellbook: ["Magic Missile"] }, gold: 500 });
    const before = (await import("../src/lib/db/clock.ts")).getClock(t.world.campaignId).instant;
    const out = await t.invoke("learn_spell", { characterId: who.id, action: "add", spell: "Fireball" });
    assert.equal(out.ok, true, out.error);
    const fly = await t.invoke("learn_spell", { characterId: who.id, action: "add", spell: "Fly" });
    assert.equal(fly.ok, true, fly.error);
    cost[subclass || "none"] = { gold: 500 - t.sheet(who).gold, hours: ((await import("../src/lib/db/clock.ts")).getClock(t.world.campaignId).instant - before) / 60 };
  }
  // Fly is a transmutation: full price for both. Fireball is halved for the evoker.
  assert.deepEqual(cost.none, { gold: 300, hours: 12 }, "the staging: two 3rd-level spells at 50 gp and 2 hours a level");
  assert.deepEqual(cost["School of Evocation"], { gold: 75 + 150, hours: 3 + 6 }, "an evocation spell copied for half the gold and half the time");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-wizard.mjs", P);
