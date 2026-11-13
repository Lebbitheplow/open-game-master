// More probes of the genre-a clause ledgers (the contract of
// sweep-clauses-genre-a-probes.mjs), for rules the first two files had no
// staging for.
import assert from "node:assert/strict";
import { must, eq } from "./sweep-clauses-genre-a.mjs";

// A shortbow on the near foe, for a ranged attack the reaction can answer.
function bow(t, foe) {
  const stats = t.kit.enemy(foe.id).stats;
  t.kit.setEnemy(foe.id, { stats: { ...stats, attacks: [...stats.attacks, { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing", mode: "ranged", range: { normal: 80, long: 320 } }] } });
}

export const MORE = {
  // "Reaction": played with use_reaction once a hit is open on the holder (or
  // the ally the text covers), it spends the reaction and the counter's use.
  // use_resource has no hit to answer and is refused.
  async reaction_cost(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    const target = run.ally ? scene.ally : scene.holder;
    if (run.ranged) {
      bow(t, scene.near);
      t.kit.place(scene.near.id, 5, 11);
      t.foesTurn(scene);
      t.kit.freshRound();
      t.world.clearDice();
      t.world.dice(16, 4);
      must(await t.world.invoke("enemy_attack", { enemyId: scene.near.id, targetCharacterId: target.id, attack: "Shortbow" }), "the staged shortbow");
      t.world.clearDice();
    } else {
      await t.clubs(scene, target, 16, 4);
    }
    const before = t.world.sheet(scene.holder.id).resources[run.id].used;
    must(await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: feature.name, ...(run.ally ? { targetCharacterId: target.id } : {}) }), feature.name);
    assert.ok(t.world.encounter().reactionsUsed.includes(scene.holder.id), `${feature.name} did not spend the reaction`);
    eq(t.world.sheet(scene.holder.id).resources[run.id].used, before + 1, `uses of ${run.id} spent`);
  },
};
