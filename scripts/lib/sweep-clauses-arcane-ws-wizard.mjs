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
  };
  const KNOWN = {};
  void [MOD, prof, spellDc, world, kit];
  return { PROBES, KNOWN };
}
