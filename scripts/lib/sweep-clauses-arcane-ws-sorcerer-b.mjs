// The sorcerer clause probes written in the fifth round of the arcane repair,
// for Wild Magic, the Divine Soul, the Clockwork Soul and Lunar Sorcery: the clauses the ledger had marked "not run" (read_only), each
// now staged and run, and the focused cases of the mechanisms that round built
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-sorcerer.mjs).
// The probes a clause already had stay in the file that held them.
import assert from "node:assert/strict";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, budget, call, spend, stage } = rig;
  const { friend } = shared;
  const lunar = () => holder("sorcerer", "Lunar Sorcery");
  const core = lazy(() => import("../../src/lib/db/core.ts"));
  const maps = lazy(() => import("../../src/lib/db/battle-maps.ts"));
  const light = lazy(() => import("../../src/lib/dm/attack-light.ts"));
  const tiles = lazy(() => import("../../src/lib/battlemap/types.ts"));
  const phase = async (name) => {
    await kit.endFight();
    const out = await spend(lunar(), "Lunar Phase", { variant: name });
    assert.equal(out.ok, true, out.error);
  };
  // The fight's board with no light of its own: an unlit cave.
  const nightfall = async () => (await core()).getDatabase().prepare("UPDATE battle_maps SET ambient = 'dark', outdoors = 0 WHERE id = ?").run(kit.map().id);
  // [bright radius, where the dim light ends] of a token's carried light, in feet.
  const carried = async (who) => {
    const token = kit.token(who.id);
    return [token.lightRadius * 5, (await tiles()).carriedDimRadius(token) * 5];
  };
  const inDarkness = async (ref) => (await light()).standsInDarkness(world.campaignId, world.encounter().id, ref.id);
  const moonlit = (who) => sheet(who).conditions.includes("moonlight");

  const PROBES = {
    // "Full Moon: a bonus action sheds bright light in 10 feet and dim light
    // 10 feet beyond (or douses it)": a light on the sorcerer's own token, read
    // by the board's light, carried as they move, doused by the same call and
    // by leaving the phase, and refused in another phase.
    "empowerment-light": async () => {
      const who = lunar();
      await phase("Full Moon");
      const [enemy] = await stage(who);
      await nightfall();
      kit.place(enemy.id, 9, 5);
      assert.deepEqual([await carried(who), await inDarkness(who), await inDarkness(enemy)], [[0, 0], true, true], "an unlit cave, before the light");
      const lit = await spend(who, "Lunar Empowerment");
      assert.equal(lit.ok, true, lit.error);
      assert.equal(budget().bonusUsed, true, "a bonus action");
      assert.deepEqual([await carried(who), moonlit(who)], [[10, 20], true], "[bright, dim ends] in feet, and the sheet says so");
      // The creature 20 feet off stands in the dim light; at 25 feet it is dark.
      assert.deepEqual([await inDarkness(who), await inDarkness(enemy)], [false, false]);
      kit.place(enemy.id, 10, 5);
      assert.equal(await inDarkness(enemy), true, "25 feet from the sorcerer");
      // Carried: the sorcerer walks 10 feet toward it.
      kit.place(who.id, 7, 5);
      assert.equal(await inDarkness(enemy), false, "the light moved with the sorcerer");
      // The same call douses it.
      kit.freshTurn();
      const doused = await spend(who, "Lunar Empowerment");
      assert.equal(doused.ok, true, doused.error);
      assert.deepEqual([await carried(who), moonlit(who), await inDarkness(who), budget().bonusUsed], [[0, 0], false, true, true], "doused");
      // Leaving the Full Moon ends it (Waxing and Waning, 1 sorcery point).
      kit.freshTurn();
      assert.equal((await spend(who, "Lunar Empowerment")).ok, true);
      kit.freshTurn();
      const waned = await spend(who, "Waxing and Waning", { variant: "New Moon" });
      assert.equal(waned.ok, true, waned.error);
      assert.deepEqual([await carried(who), moonlit(who)], [[0, 0], false], "the New Moon sheds no light");
      // In another phase there is no such light to shed.
      kit.freshTurn();
      const refused = await spend(who, "Lunar Empowerment");
      assert.equal(refused.ok, false, "in the New Moon phase");
      assert.deepEqual([await carried(who), moonlit(who), budget()?.bonusUsed ?? false], [[0, 0], false, false], "nothing lit, nothing spent");
      // Lit before the fight, it is on the board when the fight opens.
      await phase("Full Moon");
      assert.equal((await spend(who, "Lunar Empowerment")).ok, true);
      await kit.fight(1);
      assert.deepEqual(await carried(who), [10, 20], "carried onto the board");
      await kit.endFight();
    },
    // "New Moon: ... attack rolls against you have disadvantage while you are
    // entirely in darkness": an enemy_attack on the sorcerer, both creatures
    // seeing in the dark so nothing else leans on the roll. d20s thrown.
    "empowerment-dark": async () => {
      const who = lunar();
      const stand = async (phaseName) => {
        await phase(phaseName);
        const [enemy] = await stage(who, { others: [friend()], first: friend() });
        kit.place(friend().id, 1, 9);
        kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, senses: { ...foe(enemy).stats.senses, darkvision: 60 } } });
        world.patch(who.id, { features: [...sheet(who).features.filter((feature) => feature.name !== "Darkvision 60 ft."), { name: "Darkvision 60 ft.", source: "race", description: "" }] });
        return enemy;
      };
      const d20s = async (enemy) => {
        kit.freshRound();
        const out = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: who.id }, [15, 15, 3]);
        assert.equal(out.ok, true, out.error);
        return out.rolled.filter((die) => die.sides === 20).length;
      };
      let enemy = await stand("New Moon");
      const seen = { light: await d20s(enemy) };
      await nightfall();
      seen.darkness = await d20s(enemy);
      // A torch beside them: no longer entirely in darkness.
      kit.place(friend().id, 4, 5);
      (await maps()).setTokenLight(kit.token(friend().id).id, 4, 0, 0, 8);
      seen.torchlit = await d20s(enemy);
      // Another phase has no such veil.
      enemy = await stand("Full Moon");
      await nightfall();
      seen.fullMoon = await d20s(enemy);
      assert.deepEqual(seen, { light: 1, darkness: 2, torchlit: 1, fullMoon: 1 }, "d20s an attacker throws at the sorcerer");
      world.patch(who.id, { features: sheet(who).features.filter((feature) => feature.name !== "Darkvision 60 ft.") });
    },
  };
  const KNOWN = {};
  return { PROBES, KNOWN };
}

// A module loaded on first use and kept.
function lazy(load) {
  let seen = null;
  return () => (seen ??= load());
}
