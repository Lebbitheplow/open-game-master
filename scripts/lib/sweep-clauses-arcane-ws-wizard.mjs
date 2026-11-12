// The wizard clause probes written in the fifth round of the arcane repair:
// the clauses the ledger had marked "not run" (read_only), each now staged and
// run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-wizard.mjs
// beside sweep-clauses-arcane-wizard-a.mjs and -b.mjs, which keep the probes
// they already had).
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";

export function probes(rig, shared) {
  const { world, kit, holder, foe, call, spend, stage } = rig;
  const { friend } = shared;
  const enc = () => holder("wizard", "School of Enchantment");
  const conds = (enemy) => foe(enemy).conditions;
  // The Hypnotic Gaze laid on the creature beside the enchanter (it fails).
  async function gazed() {
    const foes = await stage(enc(), { others: [friend()] });
    const out = await spend(enc(), "Hypnotic Gaze", { targetEnemyId: foes[0].id }, [1]);
    assert.equal(out.ok, true, out.error);
    assert.ok(conds(foes[0]).includes("charmed") && conds(foes[0]).includes("incapacitated"), "the gaze was to hold");
    return foes;
  }

  const PROBES = {
    // ---- Enchantment
    // "It ends ... if it can't see or hear you": blinded alone, the creature
    // still hears the wizard and stays held; deafened as well, it is free.
    "gaze-unsensed": async () => {
      const [enemy] = await gazed();
      const blind = await call("set_condition", { enemyId: enemy.id, condition: "blinded", rounds: 10 });
      assert.equal(blind.ok, true, blind.error);
      assert.ok(conds(enemy).includes("charmed"), "blinded, it still hears the wizard");
      const deaf = await call("set_condition", { enemyId: enemy.id, condition: "deafened", rounds: 10 });
      assert.equal(deaf.ok, true, deaf.error);
      assert.deepEqual([conds(enemy).includes("charmed"), conds(enemy).includes("incapacitated")], [false, false], `[charmed, incapacitated] once it can neither see nor hear the wizard: ${conds(enemy).join(", ")}`);
      assert.ok(conds(enemy).includes("blinded") && conds(enemy).includes("deafened"), "what blinded and deafened it stays");
    },
    // ---- Necromancy
    // "An undead with an Intelligence of 12 or higher that failed repeats the
    // save at the end of every hour, breaking free on a success": the clock is
    // moved with pass_time, and the server rolls the Charisma save against the
    // wizard's spell save DC (with the advantage an Intelligence of 8 gave the
    // first save, so two d20s an hour). A duller undead never rolls.
    "command-undead-hourly": async () => {
      const nec = holder("wizard", "School of Necromancy");
      const d20s = (out) => out.rolled.filter((die) => die.sides === 20).length;
      const pass = async (amount, unit, faces) => {
        const out = await call("pass_time", { amount, unit }, faces);
        assert.equal(out.ok, true, out.error);
        return out;
      };
      // An undead of this Intelligence, commanded (it fails the first save).
      const commanded = async (int) => {
        const [enemy] = await stage(nec);
        kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "undead", abilities: { ...foe(enemy).stats.abilities, int, cha: 10 } } });
        const out = await spend(nec, "Command Undead", { targetEnemyId: enemy.id }, [1, 1]);
        assert.equal(out.ok, true, out.error);
        assert.ok(conds(enemy).includes("charmed"), "the undead was to fail and be commanded");
        return enemy;
      };
      const bright = await commanded(12);
      const early = await pass(50, "minutes", [20, 20]);
      assert.deepEqual([d20s(early), conds(bright).includes("charmed")], [0, true], "[d20s rolled, still commanded] after fifty minutes: no hour has ended");
      const hour = await pass(10, "minutes", [2, 3]);
      assert.deepEqual([d20s(hour), conds(bright).includes("charmed")], [2, true], "[d20s rolled, still commanded] as the first hour ends on a 2 and a 3");
      assert.match(JSON.stringify(hour.result.hourlySaves ?? null), new RegExp(`CHA save against Command Undead at the end of the hour \\(3 vs DC ${spellDc("wizard", 20)}\\) and fails`));
      // Three hours more: it fails the first, makes the second on a 19, and
      // the third hour rolls nothing for a creature already free.
      const three = await pass(3, "hours", [2, 3, 2, 19, 20, 20]);
      assert.deepEqual([d20s(three), three.unused, conds(bright).includes("charmed")], [4, 2, false], `[d20s rolled, faces left, still commanded] over three hours: ${JSON.stringify(three.result.hourlySaves ?? null)}`);
      assert.match(JSON.stringify(three.result.hourlySaves), /breaks free: it no longer obeys Necromancy 20/);
      const after = await pass(2, "hours", [20, 20]);
      assert.equal(d20s(after), 0, "a freed creature saves no more");
      // Intelligence 11: commanded for good, however long.
      const dull = await commanded(11);
      const day = await pass(30, "hours", [20, 20]);
      assert.deepEqual([d20s(day), conds(dull).includes("charmed"), day.result.hourlySaves ?? null], [0, true, null], "[d20s rolled, still commanded, lines] for an undead of Intelligence 11 over thirty hours");
      await kit.endFight();
    },
  };
  const KNOWN = {};
  void [MOD, prof, spellDc, world, kit];
  return { PROBES, KNOWN };
}
