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
    // The phase already held stands: choosing an option again changes nothing
    // and is refused with nothing spent (authored-spend-effects.ts, choose).
    assert.ok(out.ok || / already; choosing it again changes nothing/.test(out.error ?? ""), out.error);
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

  const wild = () => holder("sorcerer", "Wild Magic");
  const surges = lazy(() => import("../../src/lib/srd/ar-ws-wild-surge-table.ts"));

  const PROBES = {
    // "the GM may have you roll a d20; on a 1 you roll on the wild magic
    // table": the GM's use_resource after a sorcerer spell of 1st level or
    // higher. The table is the app's own (src/lib/srd/ar-ws-wild-surge-table.ts);
    // each case forces the d20, the table's die and the entry's dice.
    "surge-roll": async () => {
      // Below 14th level: from 14th, Controlled Chaos rolls the table twice
      // for a pick ("roll twice and use either number"), probed in
      // sweep-clauses-arcane-sorcerer.mjs controlled-chaos.
      const who = holder("sorcerer", "Wild Magic", 13);
      const table = (await surges()).WILD_SURGE_TABLE;
      const at = (name) => table.findIndex((entry) => entry.name === name) + 1;
      const surge = (faces) => spend(who, "Wild Magic Surge", {}, faces);
      const chance = () => sheet(who).conditions.includes("surge chance");
      const thrown = (out) => out.rolled.map((die) => [die.sides, die.face]);
      // A fresh sorcerer, whatever the case needs first, then Burning Hands.
      const cast = async (before = () => {}, spell = "Burning Hands") => {
        rig.refill(who);
        before();
        kit.freshTurn();
        const out = await call("use_spell_slot", { characterId: who.id, spell });
        assert.equal(out.ok, true, out.error);
        return out;
      };
      const [enemy] = await stage(who, { others: [friend()] });
      kit.place(friend().id, 1, 9);
      assert.equal(table.length, 10, "a d10's worth of entries");
      // With no spell just cast, and after a cantrip, there is nothing to roll.
      assert.equal((await surge([1, 5, 3])).ok, false, "with no spell cast");
      await cast(() => {}, "Poison Spray");
      assert.deepEqual([chance(), (await surge([1, 5, 3])).ok], [false, false], "after a cantrip");
      // A sorcerer spell of 1st level: the d20, and on a 7 nothing more.
      const told = await cast();
      assert.match(String(told.result.wildMagicSurge), /roll a d20/);
      assert.equal(chance(), true);
      const quiet = await surge([7, 5, 3]);
      assert.deepEqual([quiet.ok, quiet.result.d20, quiet.result.surge ?? null, thrown(quiet), chance()], [true, 7, null, [[20, 7]], false], "a 7 on the d20");
      assert.equal((await surge([1, 5, 3])).ok, false, "one casting, one roll");
      // On a 1 the table is rolled: Second Skin is 1d8 + the sorcerer level in temporary hit points.
      await cast();
      const skin = await surge([1, at("Second Skin"), 3]);
      assert.deepEqual([skin.result.surge?.name, thrown(skin), sheet(who).tempHp], ["Second Skin", [[20, 1], [10, at("Second Skin")], [8, 3]], 3 + 13], "a 1, then the table");
      // Thunderclap Hiccup: 2d8 thunder to the creature 5 feet away, which fails its save on a 1.
      await cast();
      const hp = foe(enemy).currentHp;
      const clap = await surge([1, at("Thunderclap Hiccup"), 6, 5, 1]);
      assert.deepEqual([clap.ok, hp - foe(enemy).currentHp], [true, 11], clap.error);
      // Loose Change: 1d4 of five spent sorcery points come back.
      await cast(() => world.patch(who.id, { resources: { ...sheet(who).resources, sorcery_points: { max: 20, used: 5 } } }));
      await surge([1, at("Loose Change"), 3]);
      assert.equal(sheet(who).resources.sorcery_points.used, 2);
      // Tides of Chaos spent: the surge is triggered outright, no d20, and the use comes back.
      const spent = await cast(() => world.patch(who.id, { currentHp: 50, resources: { ...sheet(who).resources, sub_tides_of_chaos: { max: 1, used: 1 } } }));
      assert.match(String(spent.result.wildMagicSurge), /Tides of Chaos is spent/);
      const tide = await surge([at("Mended Seam"), 2, 5]);
      assert.deepEqual([tide.result.d20 ?? null, tide.result.surge?.name, thrown(tide), sheet(who).currentHp, sheet(who).resources.sub_tides_of_chaos.used], [null, "Mended Seam", [[10, at("Mended Seam")], [6, 2], [6, 5]], 57, 0], "[d20, entry, dice, hit points, Tides of Chaos spent]");
      // Every entry of the table is one the server applies.
      for (const [index, entry] of table.entries()) {
        await cast();
        const out = await surge([1, index + 1, 3, 3, 3, 3]);
        assert.deepEqual([out.ok, out.result?.surge?.name], [true, entry.name], `entry ${index + 1}: ${String(out.error ?? "")}`);
      }
      await kit.endFight();
    },
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
