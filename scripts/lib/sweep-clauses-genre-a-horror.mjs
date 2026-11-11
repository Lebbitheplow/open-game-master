// The horror ledger's probes for clauses the shared kinds cannot stage
// (scripts/lib/sweep-clauses-genre-a-probes.mjs and -named.mjs): a rule that
// reads who forces a save, who lays a condition, or where the party stands.
// Each plays the clause and its control, so a rule that holds everywhere (the
// text's "from fiends" dropped) fails as surely as one that holds nowhere.
import assert from "node:assert/strict";
import { eq, must } from "./sweep-clauses-genre-a.mjs";
import { TRAINED } from "./enforce-combat.mjs";

const d20s = (t) => t.world.diceLog().filter((die) => die.sides === 20).length;

export const HORROR = {
  // Advantage on a save a creature of the named type forces: two d20s with
  // it, one against the same save from a humanoid.
  async save_adv_from(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    const save = async (casterType, against) => {
      t.world.clearDice();
      t.world.diceLog();
      t.world.dice(5, 17);
      must(await t.world.invoke("request_roll", {
        characterId: hero.id, kind: "saving_throw", ability: run.ability, dc: 10, reason: "a probe", casterType,
        ...(against ? { against } : {}), ...(run.magical ? { magical: true } : {}),
      }), "the save");
      t.world.clearDice();
      return d20s(t);
    };
    for (const against of run.against ?? [null]) {
      for (const from of run.from) {
        eq(await save(from, against), 2, `d20s thrown for the ${run.ability} save${against ? ` against ${against}` : ""} from a ${from}`);
      }
      eq(await save("humanoid", against), 1, `d20s thrown for the same save from a humanoid`);
    }
  },

  // Immunity to a condition a creature of the named type lays: refused from
  // it, laid by a creature of another type.
  async cond_immune_from(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, type: run.from } });
    t.kit.setEnemy(scene.far.id, { stats: { ...t.kit.enemy(scene.far.id).stats, type: "humanoid" } });
    const held = () => t.world.sheet(scene.holder.id).conditions.map((entry) => entry.toLowerCase());
    for (const condition of run.conditions) {
      const out = await t.world.invoke("set_condition", { characterId: scene.holder.id, condition, sourceEnemyId: scene.near.id });
      assert.ok(!out.ok || !held().includes(condition), `${condition} from a ${run.from} was laid on a character the text makes immune to it`);
      must(await t.world.invoke("set_condition", { characterId: scene.holder.id, condition, sourceEnemyId: scene.far.id }), `${condition} from a humanoid`);
      eq(held().includes(condition), true, `${condition} from a humanoid holds`);
    }
  },

  // A spend that asks which option: with the variant named, something other
  // than the counter and the turn's cost moves.
  async spend_variant(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    const before = t.reader.snapshot();
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: run.id, variant: run.variant }), `spending ${run.id} (${run.variant})`);
    const moved = t.readChanges(scene, t.reader.diff(before, t.reader.snapshot()));
    assert.ok(moved.effects.length > 0, `spending ${run.id} (${run.variant}) moved its counter and the turn's cost and nothing else`);
  },

  // Advantage on a check while no ally stands within 10 feet on the board:
  // two d20s alone, one with the hurt ally beside the holder.
  async check_alone(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level, extra: { proficiencies: { ...TRAINED, skills: [run.skill] } } });
    const check = async () => {
      t.world.clearDice();
      t.world.diceLog();
      t.world.dice(10, 17);
      must(await t.world.invoke("request_roll", { characterId: scene.holder.id, kind: "skill_check", skill: run.skill, dc: 10, reason: "a probe" }), "the check");
      t.world.clearDice();
      return d20s(t);
    };
    eq(await check(), 1, `d20s thrown for the ${run.skill} check with an ally beside them`);
    t.kit.place(scene.ally.id, 15, 12);
    t.kit.place(scene.fallen.id, 16, 12);
    eq(await check(), 2, `d20s thrown for the ${run.skill} check with no ally within 10 ft`);
  },
};
