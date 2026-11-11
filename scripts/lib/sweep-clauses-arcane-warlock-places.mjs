// The warlock clauses about where the warlock and their friends are: the
// Genie's vessel as a place and a thing (Sanctuary Vessel, Genie's Vessel),
// the Fathomless Plunge, and the Undead's Spirit Projection (its body, its
// passage, its healing). scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-warlock.mjs.
import assert from "node:assert/strict";
import { prof, spellDc } from "./sweep-clauses-arcane.mjs";

const VESSEL = "in the genie's vessel";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, call, spend, stage } = rig;
  const { friend } = shared;
  const genie = (level = 20) => holder("warlock", "The Genie", level);
  const pb = (who) => rig.srd.computeSheetDerived(sheet(who)).proficiencyBonus;
  const inside = (who) => sheet(who).conditions.includes(VESSEL);
  // Every counter spent to the last use.
  const drained = (who) => world.patch(who.id, { resources: Object.fromEntries(Object.entries(sheet(who).resources ?? {}).map(([id, state]) => [id, { ...state, used: state.max }])) });
  const spentCount = (who) => Object.values(sheet(who).resources ?? {}).filter((state) => state.used > 0).length;
  // Bottled Respite in a fight, the friend a square away and another hero 35
  // feet off; the fight then ends with the vessel's mark kept.
  async function bottled(level = 20) {
    const far = holder("fighter", "Champion", 5, {}, "far");
    await stage(genie(level), { others: [friend(), far] });
    kit.place(far.id, 5, 5 + 7);
    rig.refill(friend());
    const out = await spend(genie(level), "Bottled Respite");
    assert.equal(out.ok, true, out.error);
    if (world.encounter()) await world.invoke("end_encounter", { outcome: "truce" });
    return { far, out };
  }
  const leave = () => [genie(), friend(), genie(5)].forEach((who) => rig.refill(who));

  const PROBES = {
    // ---- Genie's Vessel (The Genie, 1st level)
    "vessel-object": async () => {
      await kit.endFight();
      const name = `${sheet(genie()).name}'s vessel`;
      const asked = await call("damage_object", { name, ac: 5, hp: 200 });
      assert.equal(asked.ok, true, asked.error);
      assert.deepEqual([asked.result.ac, asked.result.hp], [spellDc("warlock", 20), 20 + prof(20)], `the vessel's AC is the spell save DC and its hit points warlock level + proficiency bonus: ${JSON.stringify(asked.result).slice(0, 240)}`);
      const blow = await call("damage_object", { name, damage: String(20 + prof(20)), damageType: "fire" });
      assert.equal(blow.result.broken, true, "the vessel's own hit points break it");
    },
    "vessel-focus": async () => {
      const { focusProblem } = await import("../../src/lib/dm/cast-materials.ts");
      const { spellFactsFor } = await import("../../src/lib/content/index.ts");
      const light = spellFactsFor("Light");
      assert.ok(light?.material, "the staging: Light has a material with no price");
      const bare = (who) => ({ ...sheet(who), equipment: [] });
      assert.notEqual(focusProblem(bare(holder("warlock", "The Hexblade", 20)), light), null, "a warlock with no focus is refused");
      assert.equal(focusProblem(bare(genie()), light), null, "the Genie's vessel is the focus");
    },
    // ---- Sanctuary Vessel (The Genie, 10th level)
    "sanctuary-party": async () => {
      const { far } = await bottled();
      try {
        assert.ok(inside(genie()), "the warlock is in the vessel");
        assert.ok(inside(friend()), "the friend within 30 feet came in with them");
        assert.equal(sheet(friend()).conditionMeta?.[VESSEL]?.source, genie().id, "inside under the warlock's name");
        assert.equal(inside(far), false, "a hero 35 feet off stays outside");
        // Below 10th level the vessel takes nobody else.
        leave();
        await bottled(5);
        assert.ok(inside(genie(5)));
        assert.equal(inside(friend()), false, "a 5th-level vessel took the friend in");
      } finally {
        leave();
      }
    },
    "sanctuary-rest": async () => {
      const { far } = await bottled();
      try {
        drained(friend());
        drained(far);
        const before = [spentCount(friend()), spentCount(far)];
        assert.ok(before[0] > 0 && before[1] > 0, "the staging: counters spent");
        const out = await call("take_rest", { kind: "short" });
        assert.equal(out.ok, true, out.error);
        assert.match(String(out.result.restedFor), /^10 minutes?$/, `ten minutes inside give a short rest: ${JSON.stringify(out.result).slice(0, 200)}`);
        assert.ok(spentCount(friend()) < before[0], "the friend inside got their short-rest uses back");
        assert.equal(spentCount(far), before[1], "the hero outside only waited ten minutes");
        assert.match(String(out.result.sanctuaryVessel), /stayed outside/);
      } finally {
        leave();
        rig.refill(far);
      }
    },
    "sanctuary-dice": async () => {
      await bottled();
      try {
        world.patch(friend().id, { currentHp: 1, hitDice: { ...sheet(friend()).hitDice, spent: 0 } });
        const con = rig.srd.computeSheetDerived(sheet(friend())).abilityMods.con;
        const out = await call("take_rest", { kind: "short", spend: [{ characterId: friend().id, dice: 2 }] }, [3, 4]);
        assert.equal(out.ok, true, out.error);
        const row = out.result.results.find((entry) => entry.name === sheet(friend()).name);
        assert.equal(row?.healed, 3 + 4 + 2 * con + 2 * pb(genie()), `each die adds the warlock's proficiency bonus: ${JSON.stringify(row)}`);
      } finally {
        leave();
      }
    },
  };
  const KNOWN = {};
  return { PROBES, KNOWN };
}
