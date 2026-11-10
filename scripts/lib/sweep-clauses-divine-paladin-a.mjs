// The scenes of the clause ledger for the paladin's Oaths of the Ancients,
// Vengeance, Conquest and Redemption (scripts/clauses/divine.json). See
// scripts/lib/sweep-clauses-divine.mjs for how a scene answers its clauses.
import { assert, modOf, castingScore } from "./sweep-clauses-divine.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);
const cha = (level) => modOf(castingScore(level));
const fire = { attacks: [{ name: "Fire Lash", toHit: 4, damage: "1d6+2", type: "fire" }] };

// A d20 roll the table kept for a creature's save, by what its detail names.
export const saveRoll = (rig, text) => rig.lastRolls(8).find((roll) => roll.kind === "saving_throw" && roll.detail.includes(text)) ?? null;
// The save a call made the table roll: the newest one that was not there before.
export async function saveMadeBy(rig, run) {
  const before = new Set(rig.lastRolls(40).map((roll) => roll.id));
  const out = await run();
  const roll = rig.lastRolls(40).find((entry) => !before.has(entry.id) && entry.kind === "saving_throw") ?? null;
  return { out, roll };
}

// A level 20 capstone the engine keeps as a counter and a condition: what it
// costs, how long it lasts, and whether the words on the sheet say so.
export async function capstone(rig, oath, name, counter, { action, rounds, faces = [] }) {
  const who = rig.hero("paladin", oath, 20);
  const [foe] = await rig.fight(who);
  // Faces for any save the spend itself throws (Avenging Angel's fear), so
  // the scene does not hang on the server's own dice.
  const out = await rig.spend(who, name, {}, faces);
  const state = { budget: rig.budget(), meta: rig.meta(who, name.toLowerCase()), used: rig.res(who, counter)?.used };
  rig.note(`${name} spend`, [out.ok, out.error, brief(out.result), state]);
  return {
    who, foe, out, state,
    checks: {
      cost: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(action === "bonus" ? state.budget?.bonusUsed : state.budget?.actionUsed, true, `it is ${action === "bonus" ? "a bonus action" : "an action"}: ${brief(state.budget)}`);
      },
      lasts: () => assert.equal(state.meta?.rounds, rounds, brief(state.meta)),
    },
  };
}

// The same blow taken for an ally, by a paladin who resists its type.
export async function takenForAlly(rig, oath, level, feature, feetOff) {
  rig.reset();
  const who = rig.hero("paladin", oath, level, { race: "Tiefling" });
  const friend = rig.hero("cleric", "Life Domain", level);
  const [foe] = await rig.fight(friend);
  rig.kit.setEnemy(foe.id, { stats: fire });
  rig.kit.place(who.id, 5 + feetOff / 5, 5);
  rig.foesTurn(foe);
  await rig.enemyHits(foe, friend, [16, 4]);
  const out = await rig.react(who, feature, { targetCharacterId: friend.id });
  return { out, friend: rig.hp(friend), who: rig.hp(who) };
}

export const PALADIN_A = {
  "paladin::Channel Divinity: Nature's Wrath": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Ancients", 3);
    const [foe] = await rig.fight(who);
    rig.kit.place(foe.id, 5, 8);
    const far = await rig.channel(who, "nature's wrath", { targetEnemyId: foe.id }, [1, 1]);
    rig.kit.place(foe.id, 5, 7);
    const near = await rig.channel(who, "nature's wrath", { targetEnemyId: foe.id }, [1, 1]);
    rig.note("wrath", [far.ok, far.error, near.ok, near.error, rig.enemy(foe.id).conditions, rig.budget()]);
    return {
      "10-feet": () => {
        assert.equal(far.ok, false, "a creature 15 feet away was taken");
        assert.equal(near.ok, true, near.error);
        assert.ok(rig.enemy(foe.id).conditions.includes("restrained"));
      },
    };
  },

  "paladin::Channel Divinity: Turn the Faithless": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Ancients", 3);
    const [near, far] = await rig.fight(who, { enemies: 2, stats: { type: "fey" } });
    rig.kit.place(far.id, 12, 5);
    const out = await rig.channel(who, "turn the faithless", {}, [1, 1]);
    const state = { near: rig.enemy(near.id), far: rig.enemy(far.id) };
    rig.note("faithless", [out.ok, out.error, brief(out.result), state.near.conditions, state.near.conditionMeta, state.far.conditions]);
    return {
      "30-feet": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual([state.near.conditions.includes("turned"), state.far.conditions.includes("turned")], [true, false]);
      },
      minute: () => assert.equal(state.near.conditionMeta?.turned?.rounds, 10, brief(state.near.conditionMeta)),
    };
  },

  "paladin::Aura of Warding": async (rig) => {
    const run = async (level, feetOff) => {
      rig.reset();
      const who = rig.hero("paladin", "Oath of the Ancients", level, { spells: { prepared: [] } });
      const friend = rig.hero("cleric", "Life Domain", level);
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: { spells: ["Fire Bolt", "Burning Hands"], spellcasting: null } });
      rig.kit.place(friend.id, 5 + feetOff / 5, 5);
      rig.foesTurn(foe);
      const cast = await rig.call("cast_at_player", { characterId: friend.id, saveAbility: "dex", dc: 30, casterEnemyId: foe.id, spell: "Burning Hands", damage: "3d6" }, [1, 4, 4, 4]);
      const friendTook = 100 - rig.hp(friend);
      rig.foesTurn(foe);
      rig.kit.freshRound();
      const own = await rig.call("cast_at_player", { characterId: who.id, saveAbility: "dex", dc: 30, casterEnemyId: foe.id, spell: "Burning Hands", damage: "3d6" }, [1, 4, 4, 4]);
      const ownTook = 100 - rig.hp(who);
      rig.world.patch(who.id, { currentHp: 100 });
      await rig.damage(who, 10, "fire");
      return { cast, own, friendTook, ownTook, plain: 100 - rig.hp(who) };
    };
    const near = await run(7, 10);
    const far = await run(7, 15);
    const wide = await run(18, 30);
    rig.note("warding", [near.cast.ok, near.cast.error, brief(near.cast.result), near.friendTook, near.ownTook, near.plain, far.friendTook, wide.friendTook]);
    return {
      spells: () => {
        assert.equal(near.own.ok, true, near.own.error);
        assert.equal(near.ownTook, 6, `the paladin took ${near.ownTook} of a spell's 12 fire`);
        assert.equal(near.plain, 10, `and ${near.plain} of 10 fire that came from no spell`);
      },
      "10-feet": () => assert.deepEqual([near.friendTook, far.friendTook], [6, 12], "an ally 10 feet away takes half of the spell's 12, one 15 feet away all of it"),
      "30-feet-at-18": () => assert.equal(wide.friendTook, 6, `at 18th level an ally 30 feet away took ${wide.friendTook}`),
    };
  },

  "paladin::Undying Sentinel": async (rig) => {
    const facts = await rig.counterFacts("paladin", "Oath of the Ancients", 15, "sub_undying_sentinel");
    return { "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]) };
  },

  "paladin::Elder Champion": async (rig) => {
    const { who, foe, checks } = await capstone(rig, "Oath of the Ancients", "Elder Champion", "sub_elder_champion", { action: "action", rounds: 10 });
    rig.world.patch(who.id, { currentHp: 50, spellcasting: { ...rig.world.sheet(who.id).spellcasting, prepared: ["Command"] } });
    rig.endTurnOf(who);
    const afterEnd = rig.hp(who);
    rig.kit.handOnEnemies();
    const round = { pointer: rig.pointer()?.characterId === who.id, hp: rig.hp(who) };
    rig.kit.giveTurn(who.id);
    const command = () => rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Command", saveAbility: "wis", level: 1 }, [18, 3]);
    const { out: cast, roll: nearSave } = await saveMadeBy(rig, command);
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 8);
    const { out: farCast, roll: farSave } = await saveMadeBy(rig, command);
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 6);
    const { out: vines, roll: vineSave } = await saveMadeBy(rig, () => rig.channel(who, "nature's wrath", { targetEnemyId: foe.id }, [18, 3, 18, 3]));
    rig.note("elder", [afterEnd, round, cast.ok, cast.error, nearSave?.advantage, vines.ok, vines.error, vineSave?.advantage, vineSave?.detail, farCast.ok, farSave?.advantage]);
    return {
      ...checks,
      "10-a-turn": () => assert.equal(round.hp, 60, `at 50 hit points when their turn ended, the paladin stands at ${round.hp} when the order comes back to them`),
      "spell-saves": () => {
        assert.equal(cast.ok, true, cast.error);
        assert.equal(nearSave?.advantage, "disadvantage", `a creature 5 feet away saved against Command with ${nearSave?.advantage}`);
        assert.equal(farSave?.advantage, "none", `one 15 feet away with ${farSave?.advantage}`);
      },
      "channel-saves": () => {
        assert.equal(vines.ok, true, vines.error);
        assert.equal(vineSave?.advantage, "disadvantage", `a creature 5 feet away saved against Nature's Wrath, a Channel Divinity, with ${vineSave?.advantage} (${vineSave?.detail})`);
      },
      "limit-in-the-words": () => assert.match(rig.textOf("paladin::Elder Champion"), /long rest|action/i, "the engine takes an action and one use a long rest; the words on the sheet name neither"),
    };
  },

  "paladin::Channel Divinity: Abjure Enemy": async (rig) => {
    const who = rig.hero("paladin", "Oath of Vengeance", 3);
    const [foe] = await rig.fight(who);
    const out = await rig.channel(who, "abjure enemy", { targetEnemyId: foe.id }, [1]);
    const now = rig.enemy(foe.id);
    rig.note("abjure", [out.ok, out.error, now.conditions, now.conditionMeta, rig.budget()]);
    return {
      minute: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(now.conditionMeta?.frightened?.rounds, 10, brief(now.conditionMeta));
      },
      action: () => assert.equal(rig.budget()?.actionUsed, true),
    };
  },

  "paladin::Channel Divinity: Vow of Enmity": async (rig) => {
    const who = rig.hero("paladin", "Oath of Vengeance", 3);
    const [foe] = await rig.fight(who);
    const out = await rig.channel(who, "vow of enmity", { targetEnemyId: foe.id });
    const marks = [rig.world.sheet(who.id).conditionMeta, rig.enemy(foe.id).conditionMeta];
    rig.note("vow", [out.ok, out.error, marks]);
    return {
      minute: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(brief(marks, 600).includes('"rounds":10'), `the vow is kept as ${brief(marks, 300)}`);
      },
    };
  },

  "paladin::Avenging Angel": async (rig) => {
    const { who, foe, checks, out } = await capstone(rig, "Oath of Vengeance", "Avenging Angel", "sub_avenging_angel", { action: "action", rounds: 600, faces: [1] });
    const speeds = rig.srd.computeSheetDerived(rig.world.sheet(who.id)).speeds;
    const near = rig.enemy(foe.id);
    rig.kit.freshTurn();
    const swing = await rig.kit.swing(who.id, foe.id, [15, 15, 4, 4, 4]);
    const afterBlow = rig.enemy(foe.id).conditions;
    rig.reset();
    // An enemy 50 feet off when the wings open, which then walks into the aura.
    const again = rig.hero("paladin", "Oath of Vengeance", 20);
    const [walker] = await rig.fight(again);
    rig.kit.place(walker.id, 15, 5);
    const opened = await rig.spend(again, "Avenging Angel", {}, [1]);
    const outside = rig.enemy(walker.id).conditions;
    const move = await rig.call("move_token", { token: walker.id, x: 8, y: 5 }, [1, 1]);
    rig.endTurnOf(again);
    const entered = rig.enemy(walker.id).conditions;
    rig.note("angel", [brief(out.result), speeds, near.conditions, near.conditionMeta, swing.toHit?.advantage, opened.ok, outside, move.ok, move.error, entered, rig.pointer()]);
    rig.reset();
    const facts = await rig.counterFacts("paladin", "Oath of Vengeance", 20, "sub_avenging_angel");
    return {
      ...checks,
      "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]),
      fly: () => assert.equal(speeds?.fly, 60, brief(speeds)),
      "frightened-minute": () => {
        assert.ok(near.conditions.includes("frightened"), `a creature 5 feet off that failed carries ${near.conditions}`);
        assert.equal(near.conditionMeta?.frightened?.rounds, 10);
      },
      "until-damage": () => {
        assert.equal(swing.result.hit, true, swing.error);
        assert.ok(!afterBlow.includes("frightened"), `the paladin's longsword hit the frightened creature, which still carries ${brief(afterBlow)} (the fear is kept as ${brief(near.conditionMeta?.frightened)})`);
      },
      advantage: () => assert.equal(swing.toHit?.advantage, "advantage"),
      "enters-the-aura": () => {
        assert.deepEqual(outside.includes("frightened"), false, "a creature 50 feet off was frightened as the wings opened");
        assert.ok(entered.includes("frightened"), `a creature that walked to 15 feet from the paladin and started its turn there carries ${brief(entered)}: no save was asked of it`);
      },
    };
  },

  "paladin::Channel Divinity: Conquering Presence": async (rig) => {
    const who = rig.hero("paladin", "Oath of Conquest", 3);
    const [near, other, far] = await rig.fight(who, { enemies: 3 });
    rig.kit.place(other.id, 6, 6);
    rig.kit.place(far.id, 12, 5);
    const chosen = await rig.channel(who, "conquering presence", { targetEnemyIds: [near.id] }, [1, 1, 1]);
    const picked = [rig.enemy(near.id).conditions.includes("frightened"), rig.enemy(other.id).conditions.includes("frightened")];
    const meta = rig.enemy(near.id).conditionMeta?.frightened;
    rig.reset();
    const again = rig.hero("paladin", "Oath of Conquest", 3);
    const [a, b] = await rig.fight(again, { enemies: 2 });
    rig.kit.place(b.id, 12, 5);
    const all = await rig.channel(again, "conquering presence", {}, [1, 1]);
    const reach = [rig.enemy(a.id).conditions.includes("frightened"), rig.enemy(b.id).conditions.includes("frightened")];
    rig.note("presence", [chosen.ok, chosen.error, picked, meta, all.ok, all.error, reach]);
    return {
      choice: () => {
        assert.equal(chosen.ok, true, chosen.error);
        assert.deepEqual(picked, [true, false]);
      },
      "30-feet": () => assert.deepEqual(reach, [true, false]),
      minute: () => assert.equal(meta?.rounds, 10, brief(meta)),
    };
  },

  "paladin::Aura of Conquest": async (rig) => {
    const run = async (level, feetOff, frightened = true) => {
      rig.reset();
      const who = rig.hero("paladin", "Oath of Conquest", level);
      const [foe] = await rig.fight(who);
      rig.kit.place(foe.id, 5, 5 + feetOff / 5);
      if (frightened) rig.kit.setEnemy(foe.id, { conditions: ["frightened"], conditionMeta: { frightened: { rounds: 10, source: who.id } } });
      rig.endTurnOf(who);
      const took = 300 - rig.enemy(foe.id).currentHp;
      const move = await rig.call("move_token", { token: foe.id, x: 5, y: 5 + feetOff / 5 + 1 });
      return { took, move, pointer: rig.pointer() };
    };
    const near = await run(7, 10);
    const calm = await run(7, 10, false);
    const far = await run(7, 15);
    const wide = await run(18, 30);
    rig.note("conquest", [near.took, near.pointer, near.move.ok, near.move.error, calm.took, far.took, wide.took]);
    return {
      damage: () => assert.equal(near.took, 3, `a frightened creature that started its turn 10 feet from a 7th-level paladin took ${near.took}`),
      frightened: () => assert.equal(calm.took, 0, "a creature that is not frightened took the aura's damage"),
      "10-feet": () => assert.equal(far.took, 0, "a frightened creature 15 feet off took the aura's damage at 7th level"),
      "30-feet-at-18": () => assert.equal(wide.took, 9, `at 18th level a frightened creature 30 feet off took ${wide.took}`),
      "speed-0": () => assert.equal(near.move.ok, false, `the frightened creature in the aura walked 5 feet on its turn; the row's note: "Their speed of 0 is the frightened creature's to keep; the board does not stop it."`),
    };
  },

  "paladin::Scornful Rebuke": async (rig) => {
    const who = rig.hero("paladin", "Oath of Conquest", 15);
    const [foe] = await rig.fight(who);
    rig.foesTurn(foe);
    const hit = await rig.enemyHits(foe, who, [16, 4]);
    const took = 300 - rig.enemy(foe.id).currentHp;
    rig.kit.setEnemy(foe.id, { currentHp: 300 });
    const miss = await rig.enemyHits(foe, who, [2, 4]);
    const missTook = 300 - rig.enemy(foe.id).currentHp;
    rig.note("rebuke", [brief(hit.result, 400), took, miss.result?.hit, missTook]);
    return {
      damage: () => assert.equal(took, cha(15), `the creature that hit took ${took} (Charisma +${cha(15)})`),
      hits: () => assert.equal(missTook, 0, "a miss was rebuked"),
    };
  },

  "paladin::Invincible Conqueror": async (rig) => {
    const { who, foe, checks } = await capstone(rig, "Oath of Conquest", "Invincible Conqueror", "sub_invincible_conqueror", { action: "action", rounds: 10 });
    await rig.damage(who, 10, "fire");
    const took = 100 - rig.hp(who);
    rig.kit.freshTurn();
    const crit = await rig.kit.swing(who.id, foe.id, [19, 4, 4, 4, 4, 4, 4]);
    const allowed = rig.budget()?.attacksAllowed;
    rig.note("conqueror", [took, crit.ok, crit.error, brief(crit.result, 300), allowed]);
    return {
      ...checks,
      resistance: () => assert.equal(took, 5, `10 fire took ${took}`),
      "extra-attack": () => assert.equal(allowed, 3, `the Attack action allows ${allowed} attacks while it lasts (a paladin's Extra Attack gives 2); the counter's guidance: "the extra attack and the 19-20 critical are narrated."`),
      "crit-19": () => assert.equal(crit.result.crit, true, `a melee hit on a natural 19 is ${crit.result.crit ? "a critical" : "an ordinary hit"}`),
      "limit-in-the-words": () => assert.match(rig.textOf("paladin::Invincible Conqueror"), /long rest|action/i, "the engine takes an action and one use a long rest; the words on the sheet name neither"),
    };
  },

  "paladin::Channel Divinity: Emissary of Peace": async (rig) => {
    const who = rig.hero("paladin", "Oath of Redemption", 3);
    const out = await rig.channel(who, "emissary of peace");
    const meta = rig.meta(who, "emissary of peace");
    return {
      "10-minutes": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(meta?.rounds, 100);
      },
    };
  },

  "paladin::Aura of the Guardian": async (rig) => {
    const near = await takenForAlly(rig, "Oath of Redemption", 7, "Aura of the Guardian", 10);
    const far = await takenForAlly(rig, "Oath of Redemption", 7, "Aura of the Guardian", 15);
    const wide = await takenForAlly(rig, "Oath of Redemption", 18, "Aura of the Guardian", 30);
    rig.note("guardian", [near.out.ok, near.out.error, brief(near.out.result), near.friend, near.who, far.out.ok, wide.out.ok, wide.out.error, wide.who]);
    return {
      takes: () => {
        assert.equal(near.out.ok, true, near.out.error);
        assert.equal(near.friend, 100, "the ally's 6 hit points come back");
      },
      "ignoring-resistance": () => assert.equal(near.who, 94, `a tiefling paladin, who resists fire, took ${100 - near.who} of the 6 fire meant for the ally`),
      "10-feet": () => assert.equal(far.out.ok, false, "an ally 15 feet away was covered at 7th level"),
      "30-feet-at-18": () => assert.equal(wide.out.ok, true, wide.out.error),
    };
  },

  "paladin::Protective Spirit": async (rig) => {
    const who = rig.hero("paladin", "Oath of Redemption", 15);
    await rig.fight(who);
    rig.world.patch(who.id, { currentHp: 60 });
    rig.world.dice(4);
    rig.endTurnOf(who);
    rig.world.clearDice();
    const above = rig.hp(who);
    return { "below-half": () => assert.equal(above, 60, `at 60 of 100 hit points the paladin ended a turn and stands at ${above}`) };
  },

  "paladin::Emissary of Redemption": async (rig) => {
    const who = rig.hero("paladin", "Oath of Redemption", 20);
    const [first, second] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(second.id, 4, 6);
    rig.foesTurn(first);
    const hit = await rig.enemyHits(first, who, [16, 4]);
    const taken = 100 - rig.hp(who);
    const back = 300 - rig.enemy(first.id).currentHp;
    rig.world.patch(who.id, { currentHp: 100 });
    await rig.damage(who, 10, "fire");
    const hazard = 100 - rig.hp(who);
    rig.kit.giveTurn(who.id);
    const swing = await rig.kit.swing(who.id, first.id, [18, 4, 4, 4, 4]);
    const afterSwing = rig.enemy(first.id).currentHp;
    rig.world.patch(who.id, { currentHp: 100 });
    rig.foesTurn(first);
    await rig.enemyHits(first, who, [16, 4]);
    const lapsed = { taken: 100 - rig.hp(who), back: afterSwing - rig.enemy(first.id).currentHp };
    rig.world.patch(who.id, { currentHp: 100 });
    rig.foesTurn(second);
    await rig.enemyHits(second, who, [16, 4]);
    const other = { taken: 100 - rig.hp(who), back: 300 - rig.enemy(second.id).currentHp };
    rig.note("redemption", [brief(hit.result, 300), taken, back, hazard, swing.ok, lapsed, other, rig.conditions(who), rig.world.sheet(who.id).conditionMeta]);
    return {
      resistance: () => assert.equal(taken, 3, `a club's 6 took ${taken}`),
      radiant: () => assert.equal(back, 1, `the paladin took ${taken} of the club's 6 and the attacker took ${back} radiant: half of what the paladin took is 1`),
      "other-creatures": () => assert.equal(hazard, 10, `10 fire dealt by no creature (apply_damage with no source) took ${hazard}`),
      lapses: () => assert.deepEqual(lapsed, { taken: 6, back: 0 }, "after the paladin attacked it, the creature's club takes the full 6 and nothing comes back"),
      "that-creature": () => assert.ok(other.taken === 3 && other.back > 0, `another creature, never attacked, is still resisted and burned: ${brief(other)}`),
    };
  },
};
