// The clause probes of Lunar Phenomenon's three phases (Lunar Sorcery 18,
// scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-sorcerer.mjs):
// the saves, and what rides them, which the row left to the GM before
// (src/lib/dm/ar-ws-lunar-phenomenon.ts): the Full Moon's 3d8 healing, the
// New Moon's speed 0 and the sorcerer's invisibility, the Crescent Moon's
// companion and the resistance both of them carry.
import assert from "node:assert/strict";

export function probes(rig, shared) {
  const { kit, holder, sheet, foe, left, spend, call, hurt, stage, world } = rig;
  const { friend } = shared;
  const lunar = () => holder("sorcerer", "Lunar Sorcery");
  const uses = () => left(lunar(), "sub_lunar_phenomenon");
  const phase = async (name) => {
    await kit.endFight();
    const out = await spend(lunar(), "Lunar Phase", { variant: name });
    assert.ok(out.ok || / already; choosing it again changes nothing/.test(out.error ?? ""), out.error);
  };
  const metaOf = (conditionMeta, name) => {
    const entry = conditionMeta?.[name];
    return Array.isArray(entry?.instances) ? entry.instances[0] : entry;
  };
  const speedNow = async (enemy) => (await import("../../src/lib/srd/condition-effects.ts")).conditionSpeed(foe(enemy).conditions, 30);

  const PROBES = {
    // "each creature of your choice within 30 feet makes a Constitution save
    // or is blinded until the end of its next turn"
    "lunar-full-blinds": async () => {
      await phase("Full Moon");
      const [near, far] = await stage(lunar(), { count: 2 });
      kit.place(far.id, 12, 5);
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "full moon" }, [1, 4, 4, 4]);
      assert.equal(out.ok, true, out.error);
      assert.ok(foe(near).conditions.includes("blinded"), "the creature within 30 feet that failed is blinded");
      assert.ok(!foe(far).conditions.includes("blinded"), "a creature 35 feet off was caught");
      assert.equal(metaOf(foe(near).conditionMeta, "blinded")?.untilTurnEndOf, near.id, "blinded until the end of its own next turn, not the sorcerer's");
    },
    // "and one creature of your choice there regains 3d8 hit points"
    "lunar-full-heals": async () => {
      await phase("Full Moon");
      const ally = friend();
      const [near] = await stage(lunar(), { others: [ally] });
      rig.refill(ally);
      world.patch(ally.id, { currentHp: 5 });
      kit.place(ally.id, 5, 12);
      const beyond = await spend(lunar(), "Lunar Phenomenon", { variant: "full moon", targetCharacterId: ally.id }, [1, 4, 4, 4]);
      assert.equal(beyond.ok, false, "a creature 35 feet off was healed");
      assert.equal(uses(), 1, "the refused use was spent");
      assert.ok(!foe(near).conditions.includes("blinded"), "the refused use rolled the saves");
      kit.place(ally.id, 4, 5);
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "full moon", targetCharacterId: ally.id }, [1, 4, 4, 4]);
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(ally).currentHp, 17, `3d8 of 12 healed: ${JSON.stringify(out.result).slice(0, 300)}`);
    },
    // "New Moon: each creature of your choice within 30 feet makes a
    // Dexterity save or takes 3d10 necrotic damage and has speed 0 until the
    // end of its next turn"
    "lunar-new-save": async () => {
      await phase("New Moon");
      const [near] = await stage(lunar());
      kit.setEnemy(near.id, { maxHp: 400, currentHp: 400 });
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "new moon" }, [5, 5, 5, 1]);
      assert.equal(out.ok, true, out.error);
      assert.equal(400 - foe(near).currentHp, 15, "3d10 necrotic");
      assert.equal(await speedNow(near), 0, "speed 0 on a failed save");
      assert.equal(metaOf(foe(near).conditionMeta, "new moon's stillness")?.untilTurnEndOf, near.id, "until the end of its own next turn");
    },
    // "and you are invisible until the end of your next turn or until you
    // attack or cast a spell"
    "lunar-new-invisible": async () => {
      await phase("New Moon");
      const [near] = await stage(lunar());
      kit.setEnemy(near.id, { maxHp: 400, currentHp: 400 });
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "new moon" }, [5, 5, 5, 20]);
      assert.equal(out.ok, true, out.error);
      assert.ok(sheet(lunar()).conditions.includes("invisible"), "the sorcerer is invisible");
      assert.equal(metaOf(sheet(lunar()).conditionMeta, "invisible")?.untilTurnEndOf, lunar().id, "until the end of their next turn");
      const cast = await call("cast_at_enemy", { characterId: lunar().id, targetEnemyId: near.id, spell: "Sacred Flame" }, [10, 3]);
      assert.equal(cast.ok, true, cast.error);
      assert.ok(!sheet(lunar()).conditions.includes("invisible"), "a spell cast ends it");
    },
    // "Crescent Moon: you teleport up to 60 feet with one willing creature
    // within 5 feet of you"
    "lunar-crescent-teleport": async () => {
      await phase("Crescent Moon");
      const ally = friend();
      await stage(lunar(), { others: [ally] });
      rig.refill(ally);
      kit.place(ally.id, 2, 5);
      const beyond = await spend(lunar(), "Lunar Phenomenon", { variant: "crescent moon", targetCharacterId: ally.id, x: 15, y: 5 });
      assert.equal(beyond.ok, false, "a creature 15 feet off went along");
      assert.deepEqual([kit.token(lunar().id).x, uses()], [5, 1], "the refused use moved or spent something");
      kit.place(ally.id, 4, 5);
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "crescent moon", targetCharacterId: ally.id, x: 15, y: 5 });
      assert.equal(out.ok, true, out.error);
      assert.deepEqual([kit.token(lunar().id).x, kit.token(lunar().id).y], [15, 5], "the sorcerer goes to the square named");
      const [mine, theirs] = [kit.token(lunar().id), kit.token(ally.id)];
      assert.ok(Math.max(Math.abs(mine.x - theirs.x), Math.abs(mine.y - theirs.y)) === 1, `the companion arrives beside them: ${JSON.stringify(out.result).slice(0, 300)}`);
    },
    // "and each of you resists all damage until the start of your next turn"
    "lunar-crescent-ward": async () => {
      await phase("Crescent Moon");
      const ally = friend();
      await stage(lunar(), { others: [ally] });
      rig.refill(ally);
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "crescent moon", targetCharacterId: ally.id });
      assert.equal(out.ok, true, out.error);
      assert.deepEqual([await hurt(lunar(), 10, "fire"), await hurt(ally, 10, "slashing")], [5, 5], "both resist all damage");
      assert.equal(metaOf(sheet(lunar()).conditionMeta, "crescent moon's ward")?.untilTurnOf, lunar().id, "until the start of the sorcerer's next turn");
      assert.equal(metaOf(sheet(ally).conditionMeta, "crescent moon's ward")?.untilTurnOf, lunar().id, "the companion's ends with the sorcerer's");
    },
  };
  return { PROBES, KNOWN: {} };
}
