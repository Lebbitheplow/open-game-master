// The wizard clause probes written in the fifth round of the arcane repair,
// for Chronurgy, Graviturgy and the Order of Scribes: the clauses the ledger had marked "not run" (read_only), each
// now staged and run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-wizard.mjs).
// The probes a clause already had stay in the file that held them.
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";
import { SCRIBE_BOOK } from "./sweep-clauses-arcane-wizard-b.mjs";
import { hasPack } from "./enforce-world.mjs";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, counter, budget, show, call, spend, stage } = rig;
  const { friend } = shared;
  const gra = () => holder("wizard", "Graviturgy Magic");
  const scr = () => holder("wizard", "Order of Scribes");
  // The scribe with this book and nothing vanished from it.
  const withBook = (spells) => {
    const { vanished: _gone, ...casting } = sheet(scr()).spellcasting;
    void _gone;
    world.patch(scr().id, { concentratingOn: null, spellcasting: { ...casting, prepared: spells, known: spells } });
  };

  const PROBES = {
    // ---- Graviturgy
    // "changing its ... carrying capacity": the lift tool's numbers for the
    // creature whose weight was changed (Strength 10 here: 150 lb carried, 300
    // lifted), doubled with its weight and halved with it, and a pack that a
    // halved creature can no longer take on.
    "density-carry": async () => {
      await stage(gra(), { others: [friend()] });
      const str = sheet(friend()).abilities.str;
      const limits = async () => {
        const out = await call("lift", { characterId: friend().id, weightLb: 1 });
        assert.equal(out.ok, true, out.error);
        return [out.result.capacityLb, out.result.limitLb];
      };
      assert.deepEqual(await limits(), [str * 15, str * 30], "the staging: an unchanged creature");
      assert.equal((await spend(gra(), "Adjust Density", { targetCharacterId: friend().id, variant: "heavier" })).ok, true);
      assert.deepEqual(await limits(), [str * 30, str * 60], "doubled weight: [carrying capacity, lift] doubled");
      kit.freshTurn();
      assert.equal((await spend(gra(), "Adjust Density", { targetCharacterId: friend().id, variant: "lighter" })).ok, true);
      assert.deepEqual(await limits(), [str * 7.5, str * 15], "halved weight: [carrying capacity, lift] halved");
      // 100 lb is within Strength 10's 150 lb and past the halved 75 lb.
      const pack = sheet(friend()).equipment;
      const heavy = await call("lift", { characterId: friend().id, weightLb: str * 10 });
      assert.equal(heavy.result?.speed, 5, `lifting ${str * 10} lb while halved: past the capacity, 5 feet`);
      const tooMuch = await call("lift", { characterId: friend().id, weightLb: str * 15 + 1 });
      assert.equal(tooMuch.ok, false, "past the halved lift it does not move");
      world.patch(friend().id, { conditions: [], conditionMeta: {}, equipment: pack });
      const normal = await call("lift", { characterId: friend().id, weightLb: str * 10 });
      assert.equal(normal.result?.speed, undefined, "the same weight with the weight unchanged: carried");
    },
  };
  // ---- Order of Scribes
  // The book: Fireball and Lightning Bolt at 3rd level, Cone of Cold at 5th,
  // Magic Missile and Thunderwave at 1st.
  PROBES["awakened-type"] = async () => {
    const who = scr();
    withBook([...SCRIBE_BOOK, "Thunderwave"]);
    const [enemy] = await stage(who);
    kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300, stats: { ...foe(enemy).stats, immune: "fire, force" } });
    const hp = () => foe(enemy).currentHp;
    const third = () => sheet(who).spellcasting.slots[3].used;
    // The damage dice are thrown first, then the creature's save (a 1).
    const fireball = (extra, dice) => call("aoe_damage", { casterCharacterId: who.id, spell: "Fireball", enemyIds: [enemy.id], ...extra }, [...Array(dice).fill(2), 1]);
    // Its own fire does nothing to a creature immune to fire.
    let before = hp();
    const own = await fireball({}, 8);
    assert.equal(own.ok, true, own.error);
    assert.equal(before - hp(), 0, "Fireball's own fire against a creature immune to fire");
    // Lightning is found in Lightning Bolt, a 3rd-level spell of the book.
    kit.freshTurn();
    before = hp();
    const swapped = await fireball({ type: "lightning" }, 8);
    assert.equal(swapped.ok, true, swapped.error);
    assert.equal(before - hp(), 16, `Fireball as lightning from a 3rd-level slot (8d6 of 2 each, the save failed): ${show(swapped).slice(0, 160)}`);
    // Cold is in the book only at 5th level (Cone of Cold): refused from a
    // 3rd-level slot with nothing spent, taken from a 5th-level one.
    kit.freshTurn();
    const used = third();
    before = hp();
    const cold = await fireball({ type: "cold" }, 8);
    assert.equal(cold.ok, false, "cold from a 3rd-level slot, with no 3rd-level cold spell in the book");
    assert.match(cold.error, /Nothing was spent/);
    assert.deepEqual([third(), budget()?.actionUsed ?? false, before - hp()], [used, false, 0], "[3rd-level slots, action, damage] after the refusal");
    const fifth = await fireball({ type: "cold", level: 5 }, 10);
    assert.equal(fifth.ok, true, fifth.error);
    assert.equal(before - hp(), 20, "Fireball as cold from a 5th-level slot (10d6 of 2 each)");
    // One creature: Magic Missile's force as Thunderwave's thunder.
    kit.freshTurn();
    before = hp();
    assert.equal((await call("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Magic Missile" }, [1, 1, 1])).ok, true);
    assert.equal(before - hp(), 0, "Magic Missile's own force against a creature immune to force");
    kit.freshTurn();
    const darts = await call("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Magic Missile", damageType: "thunder" }, [1, 1, 1]);
    assert.equal(darts.ok, true, darts.error);
    assert.ok(before - hp() > 0, `Magic Missile as thunder: ${show(darts).slice(0, 160)}`);
    // Acid Arrow's damage and type are the content pack's (pc_attack reads the
    // spell's record): with no pack, as on CI, the spell is unknown and this half
    // cannot be staged. Every install carries the pack, so it runs where play does.
    if (hasPack) {
      // A spell attack through pc_attack: Acid Arrow's acid as Shatter's
      // thunder, both of 2nd level in the book. The attack's own type was kept
      // before, whatever damageType the call sent.
      withBook([...SCRIBE_BOOK, "Thunderwave", "Acid Arrow", "Shatter"]);
      kit.freshTurn();
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, immune: "acid, fire, force" } });
      const arrow = (extra) => call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, spell: "Acid Arrow", ...extra }, [19, 2, 2, 2, 2]);
      before = hp();
      const acid = await arrow({});
      assert.equal(acid.ok, true, acid.error);
      assert.equal(before - hp(), 0, "Acid Arrow's own acid against a creature immune to acid");
      kit.freshTurn();
      before = hp();
      const thunder = await arrow({ damageType: "thunder" });
      assert.equal(thunder.ok, true, thunder.error);
      assert.equal(before - hp(), 8, `Acid Arrow as thunder (4d4 of 2 each): ${show(thunder).slice(0, 200)}`);
      kit.freshTurn();
      const second = () => sheet(who).spellcasting.slots[2].used;
      const usedSecond = second();
      const cold2 = await arrow({ damageType: "cold" });
      assert.equal(cold2.ok, false, "cold from a 2nd-level slot, with no 2nd-level cold spell in the book");
      assert.equal(second(), usedSecond, "the refusal spends no slot");
    }
    // A wizard of another school: the type sent is nothing to the server.
    const war = holder("wizard", "War Magic");
    const [other] = await stage(war);
    kit.setEnemy(other.id, { stats: { ...foe(other).stats, immune: "force" } });
    const plain = await call("cast_at_enemy", { characterId: war.id, targetEnemyId: other.id, spell: "Magic Missile", damageType: "thunder" }, [1, 1, 1]);
    assert.equal(plain.ok, true, plain.error);
    assert.equal(foe(other).currentHp, foe(other).maxHp, "a war mage's Magic Missile stays force");
    withBook(SCRIBE_BOOK);
  };
  // Detect Magic is a ritual cast with an action: 10 minutes as a ritual,
  // none with the day's use of Awakened Spellbook, 10 again after it.
  PROBES["awakened-ritual"] = async () => {
    const { getClock } = await import("../../src/lib/db/clock.ts");
    const who = scr();
    const day = async () => assert.equal((await call("pass_time", { amount: 1, unit: "days" })).ok, true);
    const marked = () => sheet(who).conditions.includes("swift ritual");
    const uses = () => counter(who, "sub_awakened_spellbook").used;
    const ritual = async () => {
      const from = getClock(world.campaignId).instant;
      const out = await call("use_spell_slot", { characterId: who.id, spell: "Detect Magic", ritual: true });
      assert.equal(out.ok, true, out.error);
      const minutes = getClock(world.campaignId).instant - from;
      world.patch(who.id, { concentratingOn: null });
      return { minutes, out };
    };
    await kit.endFight();
    withBook(SCRIBE_BOOK);
    rig.refill(who);
    const slots = JSON.stringify(sheet(who).spellcasting.slots);
    assert.equal((await ritual()).minutes, 10, "a ritual's 10 extra minutes");
    const armed = await spend(who, "Awakened Spellbook");
    assert.equal(armed.ok, true, armed.error);
    assert.deepEqual([uses(), marked()], [1, true], "[uses spent, the mark] once the use is spent");
    assert.equal((await ritual()).minutes, 0, "the ritual the day's use sped");
    assert.equal(marked(), false, "the mark is used up by that ritual");
    assert.equal((await ritual()).minutes, 10, "the next ritual takes its 10 minutes again");
    assert.equal(JSON.stringify(sheet(who).spellcasting.slots), slots, "a ritual spends no slot");
    assert.equal((await spend(who, "Awakened Spellbook")).ok, false, "a second use before a long rest");
    // In a fight a ritual is begun and held for its minutes; sped, one cast
    // with an action takes effect at once for that action.
    await stage(who);
    const held = await call("use_spell_slot", { characterId: who.id, spell: "Detect Magic", ritual: true });
    assert.equal(typeof held.result?.casting, "string", `a ritual in a fight is a casting held across turns: ${show(held).slice(0, 160)}`);
    await stage(who);
    assert.equal((await spend(who, "Awakened Spellbook")).ok, true);
    const quick = await call("use_spell_slot", { characterId: who.id, spell: "Detect Magic", ritual: true });
    assert.equal(quick.ok, true, quick.error);
    assert.deepEqual([typeof quick.result.casting, budget()?.actionUsed ?? false, marked()], ["undefined", true, false], `[held casting, action spent, the mark] for the sped ritual in a fight: ${show(quick).slice(0, 160)}`);
    // The long rest gives the use back, and an unused mark does not outlast it.
    await kit.endFight();
    world.patch(who.id, { concentratingOn: null });
    rig.refill(who);
    assert.equal((await spend(who, "Awakened Spellbook")).ok, true);
    await day();
    assert.equal(marked(), true, "the mark waits a day for its ritual");
    await rig.rest("long");
    assert.deepEqual([uses(), marked()], [0, false], "[uses spent, the mark] after a long rest");
    await day();
  };
  const KNOWN = {};
  void [MOD, prof, spellDc];
  return { PROBES, KNOWN };
}
