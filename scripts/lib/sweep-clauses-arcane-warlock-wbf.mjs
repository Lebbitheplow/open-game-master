// The warlock clauses nobody had staged (wave 2, part wbf), each run at the
// table's own door: scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-warlock.mjs beside the probes of
// sweep-clauses-arcane-warlock.mjs.
import assert from "node:assert/strict";
import { MOD } from "./sweep-clauses-arcane.mjs";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, budget, show, call, spend, stage } = rig;
  const { friend } = shared;
  const W = (patron, level = 20, extra = {}, tag = "") => holder("warlock", patron, level, extra, tag);
  const hex = () => W("The Hexblade");
  const d = (out, sides) => out.rolled.filter((die) => die.sides === sides).length;
  // The curse itself ("hexblade's curse (+6)"), not the marker its healing leaves.
  const curseOn = (who) => sheet(who).conditions.find((entry) => entry.startsWith("hexblade's curse (+")) ?? null;
  // The round walked on to this hero's next turn: every other turn ended, the
  // enemies' handed on unplayed (which is what ticks the round).
  const nextTurn = (who) => {
    rig.cycleTo(who);
    kit.handOnEnemies();
    assert.equal(kit.current()?.characterId, who.id, "the staging: the hero's next turn");
  };
  const zoneOf = () => (kit.map()?.spellZones ?? []).find((entry) => /tentacle/i.test(entry.spell)) ?? null;
  const strike = (who, enemy, faces) => call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, weapon: "Tentacle of the Deeps" }, faces);
  // The tentacle up and its first strike (the one that comes with it) made,
  // then the round walked on to the warlock's next turn.
  async function tentacleNextTurn(who, count = 1) {
    const foes = await stage(who, { count });
    assert.equal((await spend(who, "Tentacle of the Deeps")).ok, true);
    const first = await strike(who, foes[0], [15, 3, 3]);
    assert.equal(first.ok, true, first.error);
    nextTurn(who);
    return foes;
  }

  const PROBES = {
    // ---- The Celestial
    // The ruling: with more than five others resting, the five with the
    // fewest hit points gain them, and the result names who went without.
    "resilience-choice": async () => {
      await kit.endFight();
      const warlock = W("The Celestial");
      // Seven beside the warlock whatever else this world holds.
      for (let at = 0; at < 7; at += 1) holder("warlock", "The Celestial", 3, {}, `resting ${at + 1}`);
      const others = world.sheets().filter((entry) => entry.id !== warlock.id && !entry.deathSaves?.dead);
      assert.ok(others.length > 6, `the staging: ${others.length} others rest beside the warlock`);
      for (const entry of world.sheets()) world.patch(entry.id, { currentHp: entry.maxHp, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null });
      // The last five in rest order are the hurt ones, so "the first five" fails.
      const hurt = others.slice(-5);
      hurt.forEach((entry, at) => world.patch(entry.id, { currentHp: 1 + at }));
      const out = await call("take_rest", { kind: "short" });
      assert.equal(out.ok, true, out.error);
      const each = 10 + MOD.cha;
      assert.deepEqual(hurt.map((entry) => world.sheet(entry.id).tempHp), hurt.map(() => each), "the five with the fewest hit points gain half the warlock level + CHA");
      const unhurt = others.filter((entry) => !hurt.includes(entry));
      assert.deepEqual(unhurt.map((entry) => world.sheet(entry.id).tempHp).filter((temp) => temp > 0), [], "a sixth creature gained them");
      assert.equal(sheet(warlock).tempHp, 20 + MOD.cha, "the warlock's own");
      const said = (out.result.restTempHp ?? []).join(" ");
      assert.ok(hurt.every((entry) => said.includes(entry.name)), `the result names who gained them: ${said.slice(0, 300)}`);
      assert.match(said, /went without/, "the result says somebody went without, so the table can ask the GM to change it");
    },
    // ---- The Hexblade
    "curse-death": async () => {
      // The cursed creature dies: the curse is over.
      const [enemy] = await stage(hex(), { count: 2 });
      assert.equal((await spend(hex(), "Hexblade's Curse", { targetEnemyId: enemy.id })).ok, true);
      kit.setEnemy(enemy.id, { currentHp: 1 });
      kit.freshTurn();
      assert.equal((await kit.swing(hex().id, enemy.id, [15, 4], { weapon: "Longsword" })).ok, true);
      assert.equal(curseOn(hex()), null, "the cursed creature died and the curse stands on the warlock");
      // The warlock dies: so is theirs.
      const [other] = await stage(hex());
      assert.equal((await spend(hex(), "Hexblade's Curse", { targetEnemyId: other.id })).ok, true);
      assert.ok(curseOn(hex()), "the curse is laid");
      const out = await call("apply_damage", { characterId: hex().id, amount: sheet(hex()).maxHp * 3, type: "fire" });
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(hex()).deathSaves?.dead, true, "the staging: the warlock is dead");
      assert.equal(curseOn(hex()), null, "the warlock died and their curse stands");
    },
    "hexes-incapacitated": async () => {
      const [first, second] = await stage(hex(), { count: 2 });
      assert.equal((await spend(hex(), "Hexblade's Curse", { targetEnemyId: first.id })).ok, true);
      kit.setEnemy(first.id, { currentHp: 1 });
      kit.freshTurn();
      assert.equal((await kit.swing(hex().id, first.id, [15, 4], { weapon: "Longsword" })).ok, true);
      const stunned = await call("set_condition", { characterId: hex().id, condition: "incapacitated", rounds: 10 });
      assert.equal(stunned.ok, true, stunned.error);
      const out = await spend(hex(), "Master of Hexes", { targetEnemyId: second.id });
      assert.equal(out.ok, false, "an incapacitated warlock moved the curse");
      assert.equal(counter(hex(), "sub_hexblades_curse")?.used ?? 0, 1, "the refusal moved the curse's counter");
      const freed = sheet(hex());
      world.patch(hex().id, { conditions: freed.conditions.filter((name) => name !== "incapacitated") });
      const then = await spend(hex(), "Master of Hexes", { targetEnemyId: second.id });
      assert.equal(then.ok, true, `no longer incapacitated: ${then.error}`);
    },
    // "With Pact of the Blade, this also holds for every pact weapon you
    // conjure": a rapier, which is not the weapon bound at the rest.
    "hexwarrior-pact": async () => {
      const blow = async (who) => {
        await kit.endFight();
        const bound = await spend(who, "Hex Warrior Weapon", { variant: "Longsword" });
        assert.equal(bound.ok, true, bound.error);
        world.patch(who.id, { equipment: [...sheet(who).equipment.filter((item) => item.name !== "Rapier"), { name: "Rapier", qty: 1, equipped: true }] });
        const [enemy] = await stage(who);
        const out = await kit.swing(who.id, enemy.id, [5, 4], { weapon: "Rapier" });
        assert.equal(out.ok, true, out.error);
        return 300 - foe(enemy).currentHp;
      };
      // Without the pact the rapier is a finesse weapon: Dexterity (+2).
      const plain = W("The Hexblade", 20, {}, "no pact");
      assert.equal(await blow(plain), 4 + MOD.dex, "the staging: a Hexblade without the pact swings a rapier with Dexterity");
      const blade = W("The Hexblade", 20, {}, "pact of the blade");
      world.patch(blade.id, { features: [...sheet(blade).features, { name: "Pact Boon: Pact of the Blade", source: "choice" }] });
      assert.equal(await blow(blade), 4 + MOD.cha, "a pact weapon that is not the bound one swings with Charisma");
    },
    // ---- The Fathomless
    "tentacle-later": async () => {
      const who = W("The Fathomless");
      const [enemy] = await tentacleNextTurn(who);
      assert.equal(budget()?.bonusUsed ?? false, false, "the staging: a fresh turn");
      const out = await strike(who, enemy, [15, 3, 3]);
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true, "a later turn's strike is the bonus action");
      const again = await strike(who, enemy, [15, 3, 3]);
      assert.equal(again.ok, false, "a second strike on one bonus action");
    },
    "tentacle-dice": async () => {
      const rolled = {};
      for (const level of [1, 9, 10]) {
        const who = W("The Fathomless", level);
        const [enemy] = await stage(who);
        assert.equal((await spend(who, "Tentacle of the Deeps")).ok, true);
        const before = foe(enemy).currentHp;
        const out = await strike(who, enemy, [15, 3, 3]);
        assert.equal(out.ok, true, out.error);
        rolled[level] = [d(out, 8), before - foe(enemy).currentHp];
      }
      assert.deepEqual(rolled, { 1: [1, 3], 9: [1, 3], 10: [2, 6] }, "d8s and cold damage, with no ability modifier");
    },
    "tentacle-slow": async () => {
      const { enemySpeedTiles } = await import("../../src/lib/dm/enemy-speed.ts");
      const who = W("The Fathomless");
      const [enemy] = await stage(who);
      const walks = () => enemySpeedTiles(foe(enemy)) * 5;
      const before = walks();
      assert.equal((await spend(who, "Tentacle of the Deeps")).ok, true);
      const out = await strike(who, enemy, [15, 3, 3]);
      assert.equal(out.ok, true, out.error);
      assert.equal(before - walks(), 10, `the struck creature's speed (${before} before): ${show(out).slice(0, 200)}`);
      nextTurn(who);
      assert.equal(walks(), before, "the speed is back at the start of the warlock's next turn");
    },
    "tentacle-move": async () => {
      const who = W("The Fathomless");
      const [near, far] = await tentacleNextTurn(who, 2);
      const from = zoneOf();
      assert.ok(from, "the tentacle stands on the board");
      // 60 feet from the tentacle: 30 of move and 10 of reach fall short.
      kit.place(far.id, Math.min(kit.map().width - 1, from.origin.x + 12), from.origin.y);
      const short = await strike(who, far, [15, 3, 3]);
      assert.equal(short.ok, false, `a creature ${Math.abs(kit.token(far.id).x - from.origin.x) * 5} feet from the tentacle was struck`);
      assert.equal(budget()?.bonusUsed ?? false, false, "the refusal spent the bonus action");
      // 35 feet from it: the tentacle moves up to 30 and strikes within 10.
      kit.place(far.id, from.origin.x + 7, from.origin.y);
      const out = await strike(who, far, [15, 3, 3]);
      assert.equal(out.ok, true, out.error);
      const to = zoneOf();
      const moved = Math.max(Math.abs(to.origin.x - from.origin.x), Math.abs(to.origin.y - from.origin.y)) * 5;
      const reach = Math.max(Math.abs(to.origin.x - kit.token(far.id).x), Math.abs(to.origin.y - kit.token(far.id).y)) * 5;
      assert.ok(moved > 0 && moved <= 30 && reach <= 10, `the tentacle moved ${moved} feet and stands ${reach} feet from the creature it struck`);
      assert.ok(near, "the first creature stays where it was");
    },
    // ---- The Undead
    "grave-necrotic": async () => {
      const who = W("The Undead");
      const [enemy] = await stage(who);
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, resist: "necrotic" } });
      const out = await call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, weapon: "Longsword", damageType: "necrotic" }, [15, 6]);
      assert.equal(out.ok, true, out.error);
      assert.equal(300 - foe(enemy).currentHp, 3, `a longsword's 6 made necrotic, against a creature resisting necrotic: ${show(out).slice(0, 200)}`);
      // Once on each turn: the second hit's type is the weapon's own.
      kit.saveEncounter({ ...world.encounter(), turnBudget: { ...budget(), actionUsed: false, attacksMade: 0 } });
      const before = foe(enemy).currentHp;
      const again = await call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, weapon: "Longsword", damageType: "necrotic" }, [15, 6]);
      assert.ok(!again.ok || before - foe(enemy).currentHp === 6, `a second hit of the turn made necrotic: ${show(again).slice(0, 200)}`);
      // A warlock without the feature changes nothing.
      const plain = W("The Undead", 5);
      const [other] = await stage(plain);
      kit.setEnemy(other.id, { stats: { ...foe(other).stats, resist: "necrotic" } });
      const refused = await call("pc_attack", { characterId: plain.id, targetEnemyId: other.id, weapon: "Longsword", damageType: "necrotic" }, [15, 6]);
      assert.ok(!refused.ok || 300 - foe(other).currentHp === 6, "a 5th-level warlock made a sword's damage necrotic");
    },
    // "your conjuration and necromancy spells need no verbal or somatic
    // components": with a blade in each hand no gesture can be made.
    "projection-components": async () => {
      const who = W("The Undead", 20, {
        cantrips: ["Chill Touch", "Fire Bolt"], spells: ["Chill Touch", "Fire Bolt"],
        equipment: [{ name: "Shortsword", qty: 1, equipped: true }, { name: "Dagger", qty: 1, equipped: true }],
      }, "a blade in each hand");
      const [enemy] = await stage(who);
      const cast = (spell) => {
        kit.freshTurn();
        return call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, spell }, [15, 4]);
      };
      const bound = await cast("Chill Touch");
      assert.equal(bound.ok, false, "the staging: with both hands full a necromancy cantrip's gestures are refused");
      assert.match(String(bound.error), /hand/i, `the staging's refusal is about the hands: ${bound.error}`);
      kit.freshTurn();
      const out = await spend(who, "Spirit Projection");
      assert.equal(out.ok, true, out.error);
      const necromancy = await cast("Chill Touch");
      assert.equal(necromancy.ok, true, `a necromancy spell in the projection, hands full: ${necromancy.error}`);
      const evocation = await cast("Fire Bolt");
      assert.equal(evocation.ok, false, "an evocation spell cast without its gestures in the projection");
    },
    // ---- The Undying
    "dead-spell": async () => {
      const who = W("The Undying");
      const [enemy] = await stage(who, { others: [friend()], first: friend() });
      shared.mage(enemy);
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "undead" } });
      const bolt = async (faces) => {
        kit.freshRound();
        const before = hp(who);
        const out = await call("cast_at_player", { characterId: who.id, casterEnemyId: enemy.id, spell: "Magic Missile" }, faces);
        return { out, took: before - hp(who) };
      };
      // A living caster's darts land (the control).
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "humanoid" } });
      const living = await bolt([2, 2, 2]);
      assert.ok(living.out.ok && living.took > 0, `the staging: a living caster's Magic Missile hurts the warlock: ${show(living.out).slice(0, 200)}`);
      // An undead's: the ward's Wisdom save first (a 1 fails), and the spell is lost.
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "undead" } });
      const undead = await bolt([1, 2, 2, 2]);
      assert.equal(undead.took, 0, `an undead that failed the ward's save cast at the warlock: ${show(undead.out).slice(0, 220)}`);
    },
    "dead-area": async () => {
      const who = W("The Undying");
      const [enemy] = await stage(who, { others: [friend()], first: friend() });
      shared.mage(enemy);
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "undead" } });
      kit.freshRound();
      const before = hp(who);
      // An area takes no ward save: the one d20 is the warlock's own save (a 1).
      const out = await call("cast_at_player", { characterId: who.id, casterEnemyId: enemy.id, spell: "Burning Hands" }, [1, 3, 3, 3]);
      assert.equal(out.ok, true, out.error);
      assert.ok(hp(who) < before, `the undead's Burning Hands left the warlock unhurt: ${show(out).slice(0, 220)}`);
      assert.equal(d(out, 20), 1, `d20s: the warlock's save against the area, and no ward save for the undead (${JSON.stringify(out.rolled).slice(0, 200)})`);
    },
    // ---- The Genie
    // "Bottled Respite: as an action, vanish into it for up to twice your
    // proficiency bonus in hours": 4 hours at +2, 12 at +6. It was 2,400
    // rounds at every bonus.
    "respite-hours": async () => {
      for (const [level, bonus] of [[1, 2], [20, 6]]) {
        const who = W("The Genie", level, {}, `respite ${level}`);
        await stage(who);
        const out = await spend(who, "Bottled Respite");
        assert.equal(out.ok, true, out.error);
        assert.equal(budget().actionUsed, true, "as an action");
        const entry = sheet(who).conditionMeta?.["in the genie's vessel"];
        const meta = Array.isArray(entry?.instances) ? entry.instances[0] : entry;
        assert.equal(meta?.rounds, 2 * bonus * 600, `at proficiency +${bonus}: ${2 * bonus} hours`);
      }
    },
    // Disintegrate is a 6th-level spell of one action that no warlock list
    // holds: the wish casts it with no slot (a 2 fails the Dexterity save).
    "wish-spell": async () => {
      const who = W("The Genie");
      const [enemy] = await stage(who);
      const ray = () => call("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Disintegrate" }, [2, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
      assert.equal((await ray()).ok, false, "the staging: Disintegrate is no spell of this warlock's");
      kit.freshTurn();
      for (const [spell, why] of [["Wish", "a 9th-level spell"], ["Find the Path", "a casting time of a minute"]]) {
        const refused = await spend(who, "Limited Wish", { variant: spell });
        assert.equal(refused.ok, false, why);
      }
      assert.equal(sheet(who).resources.sub_limited_wish.used, 0, "a refusal spends nothing");
      const slots = JSON.stringify([sheet(who).spellcasting.slots, sheet(who).spellcasting.pact ?? null]);
      const out = await spend(who, "Limited Wish", { variant: "Disintegrate" });
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().actionUsed, true, "the wish is the action");
      const before = foe(enemy).currentHp;
      const cast = await ray();
      assert.equal(cast.ok, true, `the wished spell, cast with its own tool: ${String(cast.error).slice(0, 220)}`);
      assert.ok(before - foe(enemy).currentHp >= 100, `Disintegrate's 10d6 + 40: ${before - foe(enemy).currentHp}`);
      assert.equal(JSON.stringify([sheet(who).spellcasting.slots, sheet(who).spellcasting.pact ?? null]), slots, "no slot is spent");
      assert.equal(sheet(who).resources.sub_limited_wish.used, 1, "the use is");
      kit.freshTurn();
      assert.equal((await ray()).ok, false, "a second casting on the one wish");
      // The Hand's card sends the wish with no spell: the use is spent and
      // waits, and the call that names the spell spends nothing more.
      world.patch(who.id, { conditions: [], conditionMeta: {}, resources: { ...sheet(who).resources, sub_limited_wish: { max: 1, used: 0 } } });
      kit.freshTurn();
      const bare = await spend(who, "Limited Wish");
      assert.equal(bare.ok, true, bare.error);
      assert.equal(sheet(who).resources.sub_limited_wish.used, 1, "the bare wish spends the use");
      assert.equal((await spend(who, "Limited Wish", { variant: "Wish" })).ok, false, "a 9th-level spell named for the waiting wish");
      const named = await spend(who, "Limited Wish", { variant: "Disintegrate" });
      assert.equal(named.ok, true, named.error);
      assert.equal(sheet(who).resources.sub_limited_wish.used, 1, "naming the spell spends nothing more");
      assert.equal((await ray()).ok, true, "the named spell is cast");
      assert.equal((await spend(who, "Limited Wish", { variant: "Disintegrate" })).ok, false, "a second spell on the one wish");
    },
  };
  const KNOWN = {};
  return { PROBES, KNOWN };
}
