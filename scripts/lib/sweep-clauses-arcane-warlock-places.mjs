// The warlock clauses about where the warlock and their friends are: the
// Genie's vessel as a place and a thing (Sanctuary Vessel, Genie's Vessel),
// the Fathomless Plunge, and the Undead's Spirit Projection (its body, its
// passage, its healing). scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-warlock.mjs.
import assert from "node:assert/strict";
import { prof, spellDc } from "./sweep-clauses-arcane.mjs";

const VESSEL = "in the genie's vessel";

const { listTokens: boardTokens } = await import("../../src/lib/db/battle-maps.ts");

export function probes(rig, shared) {
  const { world, kit, holder, sheet, call, spend, stage, budget } = rig;
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
  const tokens = () => {
    const map = kit.map();
    return map ? boardTokens(map.id) : [];
  };
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
    // ---- Spirit Projection (The Undead, 14th level)
    "projection-body": async () => {
      const who = holder("warlock", "The Undead", 20);
      const [enemy] = await stage(who);
      assert.equal((await spend(who, "Spirit Projection")).ok, true);
      const name = `${sheet(who).name}'s body`;
      const body = () => tokens().find((token) => token.kind === "prop" && token.name === name) ?? null;
      assert.deepEqual([body()?.x, body()?.y], [5, 5], "the body lies where the projection began");
      kit.place(who.id, 5, 8);
      const before = sheet(who).currentHp;
      // Two d20s (advantage on the unconscious), a hit from beside it is a
      // critical (2d6+2 of the club), and the concentration save holds.
      const out = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: name }, [3, 18, 4, 4, 20]);
      assert.equal(out.ok, true, out.error);
      assert.equal(out.rolled.filter((die) => die.sides === 20).length >= 2, true, "the attack on the body is rolled with advantage");
      assert.equal(out.result.critical, true, `a hit from within 5 feet is a critical hit: ${JSON.stringify(out.result).slice(0, 240)}`);
      assert.ok(sheet(who).currentHp < before, "the blow to the body is a blow to the warlock");
      // The projection over, its body is gone as the turn ends.
      world.patch(who.id, { conditions: sheet(who).conditions.filter((entry) => entry !== "spirit projection"), concentratingOn: null });
      kit.giveTurn(who.id);
      rig.endCurrent();
      assert.equal(body(), null, "the body stayed after the projection ended");
    },
    "projection-passage": async () => {
      const { movesThroughEverything } = await import("../../src/lib/dm/ar-ws-umbral-logic.ts");
      const who = holder("warlock", "The Undead", 20);
      await stage(who);
      assert.equal(movesThroughEverything(sheet(who).conditions), false, "the staging: no projection yet");
      assert.equal((await spend(who, "Spirit Projection")).ok, true);
      assert.equal(movesThroughEverything(sheet(who).conditions), true, "the spirit passes through creatures and objects");
    },
    "projection-inside": async () => {
      const who = holder("warlock", "The Undead", 20);
      await stage(who);
      assert.equal((await spend(who, "Spirit Projection")).ok, true);
      kit.place(who.id, 6, 5);
      const before = sheet(who).currentHp;
      world.clearDice();
      world.dice(7, 20);
      rig.endCurrent();
      world.clearDice();
      assert.equal(before - sheet(who).currentHp, 7, "the turn ended inside the dummy: 1d10 force");
    },
    "projection-dread": async () => {
      const who = holder("warlock", "The Undead", 20, { cantrips: ["Chill Touch"], spells: ["Chill Touch"] }, "chill");
      const [enemy] = await stage(who);
      kit.place(enemy.id, 9, 5);
      assert.equal((await spend(who, "Spirit Projection")).ok, true);
      assert.equal((await spend(who, "Form of Dread", {}, [5])).ok, true);
      world.patch(who.id, { currentHp: 40 });
      const chill = () => {
        kit.freshTurn();
        return call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, spell: "Chill Touch" }, [15, 4, 4, 4, 4]);
      };
      const hpOf = () => rig.foe(enemy).currentHp;
      const before = hpOf();
      const first = await chill();
      assert.equal(first.ok, true, first.error);
      const dealt = before - hpOf();
      assert.ok(dealt > 0, "the staging: Chill Touch hit");
      assert.equal(sheet(who).currentHp, 40 + Math.floor(dealt / 2), `half of the ${dealt} necrotic dealt comes back: ${JSON.stringify(first.result).slice(0, 240)}`);
      const healed = sheet(who).currentHp;
      const second = await chill();
      assert.equal(second.ok, true, second.error);
      assert.equal(sheet(who).currentHp, healed, "once on each of the warlock's turns");
    },
    // ---- Fathomless Plunge (The Fathomless, 14th level)
    plunge: async () => {
      const deep = holder("warlock", "The Fathomless", 20);
      const far = holder("fighter", "Champion", 5, {}, "far");
      const onBoard = (who) => Boolean(kit.token(who.id)) || (world.encounter()?.order ?? []).some((entry) => entry.characterId === who.id);
      await stage(deep, { others: [friend(), far] });
      kit.place(far.id, 5, 5 + 7);
      const out = await spend(deep, "Fathomless Plunge");
      assert.equal(out.ok, true, out.error);
      assert.equal(onBoard(deep), false, `the warlock left the board: ${JSON.stringify(out.result).slice(0, 240)}`);
      assert.equal(onBoard(friend()), false, "the friend within 30 feet went with them");
      assert.equal(onBoard(far), true, "a hero 35 feet off stays in the fight");
      assert.ok(world.encounter(), "the fight goes on for the hero left in it");
      // With nobody left behind, the GM is told to end the fight.
      // The staging: a fight of the two of them and the dummy (the rig puts
      // every hero of the world in the order).
      await stage(deep, { others: [friend()] });
      const order = world.encounter().order.filter((entry) => entry.kind !== "pc" || [deep.id, friend().id].includes(entry.characterId));
      kit.saveEncounter({ ...world.encounter(), order, turnIndex: order.findIndex((entry) => entry.characterId === deep.id) });
      const again = await spend(deep, "Fathomless Plunge");
      assert.equal(again.ok, true, again.error);
      assert.equal((world.encounter()?.order ?? []).some((entry) => entry.kind === "pc"), false, "no hero is left in the fight's order");
      assert.match(String(again.result.plunge), /party_fled/, `the GM is told to end the fight: ${JSON.stringify(again.result).slice(0, 300)}`);
      assert.equal(budget()?.actionUsed, true, "the plunge's action stays spent");
      // A dead friend left in the order: the living went, so the fight is the
      // GM's to end as fled, never lost because only the dead stay on the board.
      const dead = holder("fighter", "Champion", 5, {}, "dead");
      await stage(deep, { others: [friend(), dead] });
      world.patch(dead.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
      const withDead = world.encounter().order.filter((entry) => entry.kind !== "pc" || [deep.id, friend().id, dead.id].includes(entry.characterId));
      kit.saveEncounter({ ...world.encounter(), order: withDead, turnIndex: withDead.findIndex((entry) => entry.characterId === deep.id) });
      const third = await spend(deep, "Fathomless Plunge");
      assert.equal(third.ok, true, third.error);
      assert.match(String(third.result.plunge), /party_fled/, `the dead friend is no hero still in the fight: ${JSON.stringify(third.result).slice(0, 300)}`);
      assert.ok(world.encounter(), "the fight was not lost to the dead friend left behind");
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
