// The feats use_resource answers by name (wave 2, part wbf, round 7): War
// Caster's spell as the opportunity attack, Telekinetic, Linguist's cipher and
// Mounted Combatant. Each is run at the table's own door, for a holder of the
// feat and for a character without it (scripts/clauses/feats.json; run by
// test-enforce-sweep-clauses-feats.mjs; src/lib/dm/ar-wbf-feat-doors.ts).
import { assert } from "./sweep-clauses-srd-rig.mjs";
import { hasPack } from "./enforce-world.mjs";
import { d20s, tableKit, worn } from "./sweep-clauses-feats-wbf-table.mjs";

export function doorProbes(rig, P) {
  const { each } = tableKit(rig);
  const hp = (t, foe) => t.enemy(foe).currentHp;
  const strike = (t, hero, foe) => t.invoke("pc_attack", { characterId: hero.id, targetEnemyId: foe.id, weapon: "Longsword" }, [15, 15, 4]);

  // A creature walks out of a wizard's reach on its own turn. With no feat
  // (and for a War Caster who named no spell) the fist swings; the War Caster
  // who named a spell casts it with the reaction: a cantrip's die, a levelled
  // spell's slot, a save spell's save.
  P["feat.war-caster.opportunity"] = async () => {
    const build = { class: "wizard", level: 4, abilities: { int: 16, str: 10 }, cantrips: ["Shocking Grasp", "Poison Spray", "Fire Bolt"], spells: ["Burning Hands", "Misty Step", "Ray of Sickness"] };
    const seen = await each("War Caster", build, async (t, hero, label) => {
      const [foe] = await t.fight([hero]);
      const leaves = async (faces) => {
        t.kit.place(foe.id, 6, 5);
        t.foesTurn(foe);
        const before = hp(t, foe);
        const slots = t.sheet(hero).spellcasting.slots["1"].used;
        const out = await t.invoke("move_token", { token: foe.id, x: 10, y: 5 }, faces);
        assert.equal(out.ok, true, out.error);
        const at = t.kit.token(foe.id);
        return { took: before - hp(t, foe), slot: t.sheet(hero).spellcasting.slots["1"].used - slots, reacted: t.world.encounter().reactionsUsed.includes(hero.id), at: [at.x, at.y], text: JSON.stringify(out) };
      };
      const named = await t.use(hero, "War Caster", { variant: "Shocking Grasp" });
      if (label === "plain") {
        const fist = await leaves([15, 8]);
        return { named: named.ok, took: fist.took, reacted: fist.reacted };
      }
      assert.equal(named.ok, true, named.error);
      // The spell's own limits: one action, one creature, a spell they hold.
      for (const spell of ["Burning Hands", "Misty Step", "Chill Touch"]) {
        const refused = await t.use(hero, "War Caster", { variant: spell });
        assert.equal(refused.ok, false, `${spell} taken as a War Caster's opportunity spell: ${JSON.stringify(refused)}`);
        assert.equal(typeof refused.error, "string", `${spell}: ${JSON.stringify(refused)}`);
      }
      // Shocking Grasp at 4th level: +5 to hit, 1d8 lightning (an 8).
      const grasp = await leaves([15, 8]);
      assert.match(grasp.text, /casts Shocking Grasp/, `the move's lines name the spell: ${grasp.text.slice(0, 400)}`);
      // A levelled spell attack pays its slot: Ray of Sickness, 2d8 (8 + 8)
      // after the Constitution save its hit asks (the first 8).
      // Ray of Sickness is known as a spell attack only from the content pack's
      // record; with no pack (CI) War Caster cannot name it, so that leg is run
      // where the pack is.
      let ray = null;
      if (hasPack) {
        assert.equal((await t.use(hero, "War Caster", { variant: "Ray of Sickness" })).ok, true);
        ray = await leaves([15, 8, 8, 8]);
      }
      // A save spell: Poison Spray, a Constitution save (a 2 fails), 1d12.
      assert.equal((await t.use(hero, "War Caster", { variant: "Poison Spray" })).ok, true);
      const spray = await leaves([2, 12]);
      // Back to the weapon: the fist again (1 + Strength 10's 0).
      assert.equal((await t.use(hero, "War Caster", { variant: "weapon" })).ok, true);
      const fist = await leaves([15, 8]);
      return { named: true, took: grasp.took, reacted: grasp.reacted, at: grasp.at, ray: ray && [ray.took, ray.slot, ray.reacted], spray: [spray.took, spray.slot, spray.reacted], fist: fist.took };
    });
    assert.deepEqual(seen.plain, { named: false, took: 1, reacted: true }, `with no feat the spell cannot be named and the fist swings: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { named: true, took: 8, reacted: true, at: [10, 5], ray: hasPack ? [16, 1, true] : null, spray: [12, 0, true], fist: 1 }, `a War Caster's opportunity attacks: ${JSON.stringify(seen)}`);
  };

  // Intelligence 16 with the feat's +1 on record there: DC 8 + 2 + 3 = 13.
  P["feat.telekinetic.shove"] = async () => {
    const seen = await each("Telekinetic", { abilities: { int: 16, wis: 10, cha: 10 } }, async (t, hero, label) => {
      const [foe] = await t.fight([hero]);
      const failed = await t.use(hero, "Telekinetic", { targetEnemyId: foe.id }, [5]);
      if (label === "plain") {
        return { ok: failed.ok, bonus: t.budget()?.bonusUsed === true };
      }
      assert.equal(failed.ok, true, failed.error);
      const pushedTo = t.kit.token(foe.id).x;
      const bonus = t.budget()?.bonusUsed === true;
      const again = await t.use(hero, "Telekinetic", { targetEnemyId: foe.id }, [5]);
      t.freshTurn();
      const saved = await t.use(hero, "Telekinetic", { targetEnemyId: foe.id }, [19]);
      const held = t.kit.token(foe.id).x;
      t.freshTurn();
      t.kit.place(foe.id, 13, 5);
      const far = await t.use(hero, "Telekinetic", { targetEnemyId: foe.id }, [5]);
      return { dc: failed.result.dc, d20: d20s(failed), pushedTo, bonus, again: again.ok, saved: saved.result?.saved, held, far: far.ok, farBonus: t.budget()?.bonusUsed === true };
    });
    assert.deepEqual(seen.plain, { ok: false, bonus: false }, `Telekinetic's shove with no feat: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { dc: 13, d20: 1, pushedTo: 7, bonus: true, again: false, saved: true, held: 7, far: false, farBonus: false }, `the shove: ${JSON.stringify(seen)}`);
  };

  // Mage Hand has words and gestures; a blade in each hand stops the
  // gestures for anyone but a Telekinetic.
  P["feat.telekinetic.hand"] = async () => {
    const seen = await each("Telekinetic", { class: "wizard", cantrips: ["Mage Hand"], spells: ["Magic Missile"], equipment: worn("Shortsword", "Dagger") }, async (t, hero) => {
      await t.fight([hero]);
      const out = await t.invoke("use_spell_slot", { characterId: hero.id, spell: "Mage Hand" });
      return out.ok === true;
    });
    assert.deepEqual(seen, { plain: false, holder: true }, "Mage Hand cast with both hands full");
  };

  // Intelligence 16 at 4th level: DC 8 + 3 + 2 = 13.
  P["feat.linguist.cipher"] = async () => {
    const seen = await each("Linguist", { abilities: { int: 16 } }, async (t, hero) => {
      const out = await t.use(hero, "Linguist");
      return out.ok === true ? out.result.cipherDc : null;
    });
    assert.deepEqual(seen, { plain: null, holder: 13 }, "the DC to read a Linguist's cipher");
  };

  // On a warhorse (Large) beside a Medium dummy: the lance-less longsword
  // rolls two d20s for a Mounted Combatant, one for anyone else, and one
  // against a creature as big as the horse.
  P["feat.mounted-combatant.advantage"] = async () => {
    const seen = await each("Mounted Combatant", { equipment: worn("Longsword") }, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      const up = await t.invoke("mount_up", { characterId: hero.id, mount: "warhorse" });
      assert.equal(up.ok, true, up.error);
      t.freshTurn();
      const small = d20s(await strike(t, hero, foe));
      t.kit.setEnemy(foe.id, { stats: { ...t.enemy(foe).stats, size: "Large" } });
      t.freshTurn();
      const large = d20s(await strike(t, hero, foe));
      await t.invoke("dismount", { characterId: hero.id });
      t.kit.setEnemy(foe.id, { stats: { ...t.enemy(foe).stats, size: "Medium" } });
      t.kit.place(foe.id, t.kit.token(hero.id).x + 1, t.kit.token(hero.id).y);
      t.freshTurn();
      const afoot = d20s(await strike(t, hero, foe));
      return { small, large, afoot };
    });
    assert.deepEqual(seen.plain, { small: 1, large: 1, afoot: 1 }, `with no feat: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { small: 2, large: 1, afoot: 1 }, `a Mounted Combatant's melee attacks: ${JSON.stringify(seen)}`);
  };

  // An attack aimed at the warhorse (AC 11, 19 hit points): the Mounted
  // Combatant takes it (their AC, their hit points) until they say to let it
  // land, and whenever they cannot act.
  // "If your mount is subjected to an effect that allows it to make a
  // Dexterity saving throw to take only half damage, it instead takes no
  // damage if it succeeds on the saving throw, and only half damage if it
  // fails": an area that catches the rider catches the warhorse under them
  // (Dexterity +1), which saves for itself (src/lib/dm/mount-area.ts).
  P["feat.mounted-combatant.mount-save"] = async () => {
    const { getMounts } = await import("../../src/lib/db/mounts.ts");
    const seen = await each("Mounted Combatant", {}, async (t, hero) => {
      const [foe] = await t.fight([hero]);
      const up = await t.invoke("mount_up", { characterId: hero.id, mount: "warhorse" });
      assert.equal(up.ok, true, up.error);
      const horse = () => getMounts(t.world.campaignId)[hero.id]?.hp;
      // A 20-foot blast of 12 fire on the rider's square, DC 12: the rider's
      // d20, the 12, then the horse's d20.
      const blast = async (horseFace) => {
        t.foesTurn(foe);
        const before = horse();
        const at = t.kit.token(hero.id);
        const out = await t.invoke("aoe_damage", { characterIds: [hero.id], saveAbility: "dex", dc: 12, damage: "2d6", damageType: "fire", halfOnSave: true, reason: "a burst of flame", x: at.x, y: at.y }, [10, 6, 6, horseFace]);
        assert.equal(out.ok, true, out.error);
        return before - horse();
      };
      return { failed: await blast(5), saved: await blast(15) };
    });
    assert.deepEqual(seen.plain, { failed: 12, saved: 6 }, `with no feat the horse takes all of it or half: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { failed: 6, saved: 0 }, `a Mounted Combatant's horse takes half or none: ${JSON.stringify(seen)}`);
  };

  P["feat.mounted-combatant.redirect"] = async () => {
    const { getMounts } = await import("../../src/lib/db/mounts.ts");
    const seen = await each("Mounted Combatant", {}, async (t, hero, label) => {
      const [foe] = await t.fight([hero]);
      const up = await t.invoke("mount_up", { characterId: hero.id, mount: "warhorse" });
      assert.equal(up.ok, true, up.error);
      const horse = () => getMounts(t.world.campaignId)[hero.id]?.hp;
      const at = async () => {
        t.foesTurn(foe);
        const before = { rider: t.sheet(hero).currentHp, horse: horse() };
        const out = await t.strike(foe, hero, [16, 4], { targetMount: true });
        assert.equal(out.ok, true, out.error);
        return [before.rider - t.sheet(hero).currentHp, before.horse - horse()];
      };
      const first = await at();
      if (label === "plain") {
        return { first, choice: (await t.use(hero, "Mounted Combatant", { variant: "mount" })).ok };
      }
      assert.equal((await t.use(hero, "Mounted Combatant", { variant: "mount" })).ok, true);
      const letLand = await at();
      assert.equal((await t.use(hero, "Mounted Combatant", { variant: "rider" })).ok, true);
      const again = await at();
      t.patch(hero, { conditions: [...t.sheet(hero).conditions, "stunned"] });
      const stunned = await at();
      return { first, letLand, again, stunned };
    });
    assert.deepEqual(seen.plain, { first: [0, 6], choice: false }, `with no feat the horse is hit: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.holder, { first: [6, 0], letLand: [0, 6], again: [6, 0], stunned: [0, 6] }, `a Mounted Combatant and the attack at their mount: ${JSON.stringify(seen)}`);
  };
}
