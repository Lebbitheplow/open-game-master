// Probes for the read-only clauses of the cleric's Forge, Grave, Order, Peace,
// Twilight and Arcana domains in the divine clause ledger
// (scripts/clauses/divine.json). Keys are "ro::<ledger key>"; see
// scripts/lib/sweep-clauses-divine.mjs for how a scene answers its clauses.
import { assert, modOf, castingScore } from "./sweep-clauses-divine.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);
const SAVES = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

// Damage of each type taken from 100 hit points, one blow at a time.
async function takes(rig, who, blows) {
  const out = {};
  for (const [label, amount, type] of blows) {
    rig.world.patch(who.id, { currentHp: 100 });
    await rig.damage(who, amount, type);
    out[label] = 100 - rig.hp(who);
  }
  return out;
}

export const RO_CLERIC_B = {
  "ro::cleric::Saint of Forge and Fire": async (rig) => {
    const who = rig.hero("cleric", "Forge Domain", 17);
    const taken = await takes(rig, who, [["fire", 10, "fire"], ["cold", 10, "cold"]]);
    return { "fire-immune": () => assert.deepEqual(taken, { fire: 0, cold: 10 }, "10 fire and 10 cold at the 17th-level Forge cleric") };
  },

  "ro::cleric::Channel Divinity: Artisan's Blessing": async (rig) => {
    const who = rig.hero("cleric", "Forge Domain", 2);
    const before = (rig.world.sheet(who.id).equipment ?? []).map((item) => item.name);
    const out = await rig.channel(who, "artisan's blessing", { reason: "a steel shield" });
    const after = (rig.world.sheet(who.id).equipment ?? []).map((item) => item.name);
    rig.note("artisan", [out.ok, out.error, brief(out.result, 300), before, after]);
    return {
      item: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(after.length > before.length, `an hour of ritual smithing made nothing: the cleric carries ${brief(after)}, as before (${brief(before)})`);
      },
    };
  },

  "ro::cleric::Circle of Mortality": async (rig) => {
    const who = rig.hero("cleric", "Grave Domain", 1, { spells: { prepared: ["Cure Wounds"] } });
    const fallen = rig.hero("cleric", "Life Domain", 1);
    const hurt = rig.hero("cleric", "Life Domain", 1);
    rig.world.patch(fallen.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    rig.world.patch(hurt.id, { currentHp: 50 });
    const atZero = await rig.call("heal", { characterId: fallen.id, casterId: who.id, spell: "Cure Wounds", level: 1 }, [1]);
    const standing = await rig.call("heal", { characterId: hurt.id, casterId: who.id, spell: "Cure Wounds", level: 1 }, [1]);
    const gained = [rig.hp(fallen), rig.hp(hurt) - 50];
    rig.note("mortality", [atZero.ok, atZero.error, brief(atZero.result), standing.ok, standing.error, gained]);
    return {
      "max-heal": () => {
        assert.equal(atZero.ok, true, atZero.error);
        assert.deepEqual(gained, [8 + 5, 1 + 5], "Cure Wounds (1d8 + 5, the die a 1) on a creature at 0 hit points heals the maximum, 13; on one standing, what it rolls");
      },
    };
  },

  "ro::cleric::Eyes of the Grave": async (rig) => {
    const who = rig.hero("cleric", "Grave Domain", 1);
    const [near, far] = await rig.fight(who, { enemies: 2, stats: { type: "undead" } });
    rig.kit.place(near.id, 15, 5);
    rig.kit.place(far.id, 19, 5);
    for (const foe of [near, far]) rig.kit.setEnemy(foe.id, { conditions: ["hidden"], conditionMeta: { hidden: { rounds: 10 } } });
    const out = await rig.spend(who, "Eyes of the Grave");
    const state = { near: rig.enemy(near.id).conditions, far: rig.enemy(far.id).conditions, apart: [rig.feetApart(who, near), rig.feetApart(who, far)] };
    rig.note("eyes", [out.ok, out.error, brief(out.result, 300), state]);
    return {
      "60-feet": () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(!state.near.includes("hidden"), `an undead hidden ${state.apart[0]} feet away is still hidden after Eyes of the Grave: ${brief(state.near)}`);
        assert.ok(state.far.includes("hidden"), `an undead hidden ${state.apart[1]} feet away was found`);
      },
    };
  },

  "ro::cleric::Sentinel at Death's Door": async (rig) => {
    // The cleric at (5,5), the ally `apart` squares east and the creature beside it.
    const stage = async (apart) => {
      rig.reset();
      const who = rig.hero("cleric", "Grave Domain", 6);
      const friend = rig.hero("cleric", "Life Domain", 6);
      const [foe] = await rig.fight(who);
      rig.kit.place(friend.id, 5 + apart, 5);
      rig.kit.place(foe.id, 5 + apart, 6);
      rig.foesTurn(foe);
      const hit = await rig.enemyHits(foe, friend, [20, 4, 4]);
      const crit = rig.hp(friend);
      const out = await rig.react(who, "Sentinel at Death's Door", { targetCharacterId: friend.id });
      return { hit: hit.result, crit, after: rig.hp(friend), out, reacted: rig.reacted(who) };
    };
    const near = await stage(6);
    const far = await stage(7);
    rig.note("sentinel", { near: [near.crit, near.after, near.out.ok, near.out.error, brief(near.out.result, 200), near.reacted], far: [far.crit, far.after, far.out.ok, far.out.error] });
    return {
      uncrit: () => {
        assert.equal(near.crit, 90, `the staged critical (two 4s + 2) left the ally at ${near.crit}`);
        assert.equal(near.out.ok, true, near.out.error);
        assert.equal(near.reacted, true);
        assert.ok(near.after >= 92 && near.after < 100, `after the reaction the ally stands at ${near.after}: a normal hit of 1d6 + 2 takes 3 to 8`);
        assert.equal(far.out.ok, false, "a critical against an ally 35 feet away was turned");
      },
    };
  },

  "ro::cleric::Keeper of Souls": async (rig) => {
    const stage = async ({ cleric = 100, friend = 100, other = null } = {}) => {
      rig.reset();
      const who = rig.hero("cleric", "Grave Domain", 17);
      const ally = rig.hero("cleric", "Life Domain", 17);
      const third = rig.hero("cleric", "Life Domain", 17);
      const foes = await rig.fight(ally, { enemies: 3, hp: 1 });
      foes.forEach((foe, index) => rig.kit.place(foe.id, 4 + index, 6));
      rig.kit.place(who.id, 5, 4);
      rig.kit.place(third.id, 19, 4);
      rig.world.patch(who.id, { currentHp: cleric });
      rig.world.patch(ally.id, { currentHp: friend });
      rig.world.patch(third.id, { currentHp: other ?? 100 });
      const swing = await rig.kit.swing(ally.id, foes[1].id, [18, 4]);
      return { dead: swing.result.dead, gained: [rig.hp(who) - cleric, rig.hp(ally) - friend, rig.hp(third) - (other ?? 100)], apart: rig.feetApart(who, third) };
    };
    const other = await stage({ friend: 40 });
    const both = await stage({ cleric: 40, friend: 50 });
    const beyond = await stage({ other: 40 });
    rig.note("keeper", { other, both, beyond });
    return {
      choice: () => {
        assert.equal(other.dead, true);
        assert.ok(other.gained[1] > 0 && other.gained[0] === 0, `with the cleric unhurt, the ally beside them regained ${other.gained[1]}`);
        assert.equal(both.gained.filter((amount) => amount > 0).length, 1, `with the cleric and the ally both hurt, ${brief(both.gained)} were healed: one creature regains the hit points`);
        assert.equal(beyond.gained[2], 0, `a hurt creature ${beyond.apart} feet from the cleric regained ${beyond.gained[2]}`);
      },
    };
  },

  "ro::cleric::Channel Divinity: Order's Demand": async (rig) => {
    const who = rig.hero("cleric", "Order Domain", 2);
    const [steady, weak] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(weak.id, 6, 6);
    rig.kit.setEnemy(steady.id, { stats: { saveMods: { ...SAVES, wis: 20 } } });
    rig.kit.setEnemy(weak.id, { stats: { saveMods: { ...SAVES, dex: 20, con: 20 } } });
    const out = await rig.channel(who, "order's demand", { targetEnemyIds: [steady.id, weak.id] }, [1, 1]);
    const charmed = { steady: rig.enemy(steady.id).conditions, weak: rig.enemy(weak.id).conditions, meta: rig.enemy(weak.id).conditionMeta?.charmed ?? null, stats: rig.enemy(weak.id).stats?.attacks };
    const dropped = /drop|disarm/i.test(JSON.stringify([rig.enemy(weak.id).conditions, rig.enemy(weak.id).conditionMeta]));
    const hurt = await rig.call("apply_damage", { enemyId: weak.id, amount: 3, type: "slashing" });
    const afterHurt = rig.enemy(weak.id).conditions;
    rig.note("demand", [out.ok, out.error, brief(out.result, 300), charmed, dropped, hurt.ok, hurt.error, afterHurt]);
    return {
      "save-charm": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual([charmed.steady.includes("charmed"), charmed.weak.includes("charmed")], [false, true], "a creature with Wisdom +20 saves on a 1 and one with Wisdom +0 (Dexterity and Constitution +20) fails");
        assert.equal(charmed.meta?.untilTurnEndOf, who.id, `the charm lasts ${brief(charmed.meta)}: until the end of the cleric's next turn`);
        assert.ok(!afterHurt.includes("charmed"), `3 damage did not end the charm (${hurt.error || "dealt"})`);
        assert.ok(dropped, `nothing on the table says the charmed creature dropped what it holds: ${brief(charmed)}`);
      },
    };
  },

  "ro::cleric::Emboldening Bond": async (rig) => {
    const me = rig.hero("cleric", "Peace Domain", 1);
    const near = rig.hero("cleric", "Life Domain", 1);
    await rig.fight(me);
    rig.kit.place(near.id, 6, 5);
    const out = await rig.spend(me, "Emboldening Bond", { targetCharacterIds: [me.id, near.id] });
    // The latest save: listRecentRolls lists the oldest first.
    const expressionOf = () => rig.lastRolls(4).findLast((roll) => roll.kind === "saving_throw" && roll.characterId === near.id)?.expression;
    await rig.save(near, "wis", {}, [10, 2]);
    const first = expressionOf();
    await rig.save(near, "wis", {}, [10, 2]);
    const second = expressionOf();
    rig.note("bond", [out.ok, out.error, first, second]);
    return {
      "once-a-turn": () => {
        assert.equal(out.ok, true, out.error);
        assert.match(String(first), /1d4/, `the first save of the turn rolled ${first}: no d4 to limit`);
        assert.doesNotMatch(String(second), /1d4/, `the second save of the same turn rolled ${second}`);
      },
    };
  },

  "ro::cleric::Channel Divinity: Balm of Peace": async (rig) => {
    const who = rig.hero("cleric", "Peace Domain", 2);
    const a = rig.hero("cleric", "Life Domain", 2);
    const b = rig.hero("cleric", "Life Domain", 2);
    const c = rig.hero("cleric", "Life Domain", 2);
    const [foe] = await rig.fight(who);
    rig.kit.place(a.id, 7, 5);
    rig.kit.place(b.id, 9, 5);
    rig.kit.place(c.id, 19, 14);
    for (const ally of [a, b, c]) rig.world.patch(ally.id, { currentHp: 50 });
    const from = rig.kit.token(who.id);
    const out = await rig.channel(who, "balm of peace", {}, [3, 3, 3, 3, 3, 3, 3, 3]);
    const to = rig.kit.token(who.id);
    const state = { healed: [rig.hp(a) - 50, rig.hp(b) - 50, rig.hp(c) - 50], from: [from.x, from.y], to: [to.x, to.y], hp: rig.hp(who), foeReacted: rig.world.encounter()?.reactionsUsed?.includes(foe.id) ?? null };
    rig.note("balm", [out.ok, out.error, brief(out.result, 300), state]);
    const heal = 3 + 3 + modOf(castingScore(2));
    return {
      "walk-heal": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual(state.healed, [heal, heal, 0], `each creature passed within 5 feet regains 2d6 + 5 (two 3s): ${heal}; one 70 feet off, none`);
        assert.notDeepEqual(state.to, state.from, "the cleric did not move");
        assert.equal(state.hp, 100, "the walk away from the creature beside the cleric provoked");
      },
    };
  },

  "ro::cleric::Protective Bond": async (rig) => {
    const who = rig.hero("cleric", "Peace Domain", 6);
    const a = rig.hero("cleric", "Life Domain", 6);
    const b = rig.hero("cleric", "Life Domain", 6);
    const [foe] = await rig.fight(a);
    rig.kit.place(who.id, 4, 5);
    rig.kit.place(b.id, 7, 5);
    for (const entry of [a, b]) rig.world.patch(entry.id, { conditions: ["emboldening bond"], conditionMeta: { "emboldening bond": { rounds: 100, source: who.id } } });
    rig.foesTurn(foe);
    // Nothing has hit a: there is no damage to take for it.
    const unhurt = await rig.react(b, "Protective Bond", { targetCharacterId: a.id });
    await rig.enemyHits(foe, a, [16, 4]);
    // The creature the blow struck cannot stand in for itself.
    const itself = await rig.react(a, "Protective Bond", { targetCharacterId: a.id });
    rig.note("protective", [unhurt.ok, unhurt.error, itself.ok, itself.error, rig.hp(a), rig.hp(b)]);
    return {
      "about-to-take": () => {
        assert.equal(unhurt.ok, false, `Protective Bond was taken for a creature no damage was coming to: ${brief(unhurt.result, 160)}`);
        assert.equal(itself.ok, false, `the bonded creature that was hit took its own damage "instead": ${brief(itself.result, 160)}`);
      },
    };
  },

  "ro::cleric::Expansive Bond": async (rig) => {
    const who = rig.hero("cleric", "Peace Domain", 17);
    const a = rig.hero("cleric", "Life Domain", 17);
    const [foe] = await rig.fight(a);
    rig.kit.place(who.id, 4, 5);
    rig.world.patch(a.id, { conditions: ["emboldening bond"], conditionMeta: { "emboldening bond": { rounds: 100, source: who.id } } });
    rig.foesTurn(foe);
    await rig.enemyHits(foe, a, [16, 4]);
    const direct = 100 - rig.hp(a);
    rig.note("expansive", [direct]);
    return {
      "through-bond": () => assert.equal(direct, 6, `a bonded creature hit itself (1d6 + 2, a 4) took ${direct}: the resistance is for damage taken through Protective Bond only`),
    };
  },

  "ro::cleric::Channel Divinity: Twilight Sanctuary": async (rig) => {
    const who = rig.hero("cleric", "Twilight Domain", 2);
    const near = rig.hero("cleric", "Life Domain", 2);
    const far = rig.hero("cleric", "Life Domain", 2);
    const charmed = rig.hero("cleric", "Life Domain", 2);
    await rig.fight(who);
    rig.kit.place(near.id, 11, 5);
    rig.kit.place(far.id, 12, 5);
    rig.kit.place(charmed.id, 6, 5);
    rig.world.patch(charmed.id, { conditions: ["charmed"], conditionMeta: { charmed: { rounds: 10 } } });
    const out = await rig.channel(who, "twilight sanctuary");
    const ends = [];
    const endOf = async (hero, faces) => {
      rig.kit.giveTurn(hero.id);
      // No enemy turn owed in between: the pointer is put on each ally by hand.
      const live = rig.world.encounter();
      rig.kit.saveEncounter({ ...live, legendary: { ...live.legendary, due: [] } });
      rig.world.clearDice();
      rig.world.dice(...faces);
      const ended = await rig.endTurnOf(hero);
      ends.push(brief(ended, 120));
      rig.world.clearDice();
      return rig.world.sheet(hero.id).tempHp ?? 0;
    };
    const nearTemp = await endOf(near, [4]);
    const farTemp = await endOf(far, [4]);
    const charmTemp = await endOf(charmed, [4]);
    const charmLeft = rig.conditions(charmed).includes("charmed");
    rig.world.patch(near.id, { tempHp: 0 });
    // The round after: the aura's second minute-round.
    rig.kit.saveEncounter({ ...rig.world.encounter(), round: rig.world.encounter().round + 1 });
    const nextRound = await endOf(near, [3]);
    rig.note("sanctuary", [out.ok, out.error, { nearTemp, farTemp, charmTemp, charmLeft, nextRound }, ends, rig.meta(who, "twilight sanctuary")]);
    return {
      "30-feet": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(nearTemp, 4 + 2, `an ally 30 feet away ended its turn with ${nearTemp} temporary hit points: 1d6 (a 4) + cleric level 2`);
        assert.equal(farTemp, 0, `an ally 35 feet away ended its turn with ${farTemp}`);
      },
      grants: () => {
        assert.equal(nearTemp, 6, `the ally in the aura gained ${nearTemp}`);
        assert.equal(charmLeft, false, "a charmed ally ended its turn in the aura still charmed");
        assert.ok(nextRound >= 1 + 2 && nextRound <= 6 + 2, `the next round the ally gained ${nextRound}: 1d6 + 2 again`);
      },
    };
  },

  "ro::cleric::Steps of Night": async (rig) => {
    const { getDatabase } = await rig.load("lib/db/core.ts");
    const stage = async (ambient) => {
      rig.reset();
      const who = rig.hero("cleric", "Twilight Domain", 6);
      await rig.fight(who);
      getDatabase().prepare("UPDATE battle_maps SET ambient = ?, outdoors = 0 WHERE id = ?").run(ambient, rig.kit.map().id);
      const out = await rig.spend(who, "Steps of Night");
      return { out, flies: rig.has(who, "flying"), ambient: rig.kit.map().ambient };
    };
    const bright = await stage("bright");
    const dark = await stage("dark");
    rig.note("steps", { bright: [bright.out.ok, bright.out.error, bright.flies, bright.ambient], dark: [dark.out.ok, dark.out.error, dark.flies, dark.ambient] });
    return {
      "dim-or-dark": () => {
        assert.equal(bright.ambient, "bright");
        assert.equal(bright.out.ok || bright.flies, false, "Steps of Night was taken on a brightly lit board, and the cleric flies");
        assert.equal(dark.out.ok && dark.flies, true, `on a dark board: ${dark.out.error}`);
      },
    };
  },

  "ro::cleric::Channel Divinity: Arcane Abjuration": async (rig) => {
    const stage = async (level, { saves = SAVES, cr = 0.25, hurt = false } = {}) => {
      rig.reset();
      const who = rig.hero("cleric", "Arcana Domain", level);
      const [foe] = await rig.fight(who, { stats: { type: "fiend", cr, saveMods: saves } });
      const out = await rig.channel(who, "arcane abjuration", { targetEnemyId: foe.id }, [1]);
      const conditions = rig.enemy(foe.id).conditions;
      if (hurt) await rig.call("apply_damage", { enemyId: foe.id, amount: 3, type: "slashing" });
      const now = rig.enemy(foe.id);
      return { out, conditions, after: now.conditions, status: now.status };
    };
    const isTurned = (list) => list.some((name) => /turned/i.test(name));
    const isBanished = (entry) => entry.after.some((name) => /banish/i.test(name)) || entry.status !== "alive";
    const strong = await stage(2, { saves: { ...SAVES, wis: 20 } });
    const weak = await stage(2, { saves: { ...SAVES, dex: 20, con: 20, cha: 20 } });
    const hurt = await stage(2, { hurt: true });
    const small = await stage(5, { cr: 0.25 });
    const big = await stage(5, { cr: 1 });
    rig.note("abjuration", { strong: [strong.out.ok, strong.conditions], weak: [weak.out.ok, weak.conditions], hurt: [hurt.conditions, hurt.after], small: [small.after, small.status, brief(small.out.result, 200)], big: [big.after, big.status] });
    return {
      "wis-save": () => {
        assert.equal(strong.out.ok, true, strong.out.error);
        assert.deepEqual([isTurned(strong.conditions), isTurned(weak.conditions)], [false, true], "a fiend with Wisdom +20 saves on a 1, and one with Wisdom +0 (the other saves +20) is turned");
      },
      "until-damage": () => {
        assert.ok(isTurned(hurt.conditions), `the staged fiend was not turned: ${brief(hurt.conditions)}`);
        assert.equal(isTurned(hurt.after), false, `3 damage did not end the turning: ${brief(hurt.after)}`);
      },
      "cr-limit": () => {
        assert.equal(isBanished(small), true, `at 5th level a CR 1/4 fiend that failed is ${brief(small.after)} (${small.status}), not banished`);
        assert.equal(isBanished(big), false, `at 5th level a CR 1 fiend, above the 1/2 limit, was banished`);
        assert.ok(isTurned(big.after), `the CR 1 fiend that failed is ${brief(big.after)}: turned, not banished`);
      },
    };
  },
};
