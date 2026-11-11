// The wizard clause probes written in the fifth round of the arcane repair,
// for Chronurgy, Graviturgy and the Order of Scribes: the clauses the ledger had marked "not run" (read_only), each
// now staged and run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-wizard.mjs).
// The probes a clause already had stay in the file that held them.
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, call, spend, stage } = rig;
  const { friend } = shared;
  const gra = () => holder("wizard", "Graviturgy Magic");

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
  const KNOWN = {};
  void [MOD, prof, spellDc];
  return { PROBES, KNOWN };
}
