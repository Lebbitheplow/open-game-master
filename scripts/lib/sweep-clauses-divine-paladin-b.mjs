// The scenes of the clause ledger for the paladin's Oaths of Glory, the
// Watchers and the Crown, and the Oathbreaker (scripts/clauses/divine.json).
// See scripts/lib/sweep-clauses-divine.mjs for how a scene answers its clauses.
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";
import { capstone, takenForAlly, saveMadeBy } from "./sweep-clauses-divine-paladin-a.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);
const cha = (level) => modOf(castingScore(level));

// A Channel Divinity that takes the creatures of the paladin's choice within
// 30 feet: one chosen of two beside them, and one 35 feet off.
async function chosenInReach(rig, oath, option, condition, stats = null) {
  const who = rig.hero("paladin", oath, 3);
  const [near, other, far] = await rig.fight(who, { enemies: 3, ...(stats ? { stats } : {}) });
  rig.kit.place(other.id, 6, 6);
  rig.kit.place(far.id, 12, 5);
  const chosen = await rig.channel(who, option, { targetEnemyIds: [near.id] }, [1, 1, 1]);
  const has = (enemy) => rig.enemy(enemy.id).conditions.some((name) => name.includes(condition));
  const picked = [has(near), has(other)];
  const meta = Object.entries(rig.enemy(near.id).conditionMeta ?? {}).find(([name]) => name.includes(condition))?.[1];
  const budget = rig.budget();
  rig.reset();
  const again = rig.hero("paladin", oath, 3);
  const [a, b] = await rig.fight(again, { enemies: 2, ...(stats ? { stats } : {}) });
  rig.kit.place(b.id, 12, 5);
  const all = await rig.channel(again, option, {}, [1, 1]);
  const reach = [has(a), has(b)];
  rig.note(option, [chosen.ok, chosen.error, picked, meta, all.ok, all.error, reach]);
  return { chosen, picked, meta, reach, budget };
}

async function physicalResistance(rig, who) {
  const taken = {};
  for (const [label, type, args] of [["bludgeoning", "bludgeoning", {}], ["piercing", "piercing", {}], ["slashing", "slashing", {}], ["magical", "slashing", { magical: true }], ["fire", "fire", {}]]) {
    rig.world.patch(who.id, { currentHp: 100 });
    await rig.damage(who, 10, type, args);
    taken[label] = 100 - rig.hp(who);
  }
  return taken;
}

export const PALADIN_B = {
  "paladin::Channel Divinity: Peerless Athlete": async (rig) => {
    const who = rig.hero("paladin", "Oath of Glory", 3);
    const out = await rig.channel(who, "peerless athlete");
    const meta = rig.meta(who, "peerless athlete");
    return {
      "10-minutes": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(meta?.rounds, 100);
      },
    };
  },

  "paladin::Channel Divinity: Inspiring Smite": async (rig) => {
    const who = rig.hero("paladin", "Oath of Glory", 3);
    const friend = rig.hero("cleric", "Life Domain", 3);
    const away = rig.hero("cleric", "Life Domain", 3);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 4, 5);
    rig.kit.place(away.id, 15, 15);
    const before = await rig.channel(who, "inspiring smite", { targetCharacterId: friend.id }, [5, 5]);
    const smite = await rig.kit.swing(who.id, foe.id, [18, 4, 4, 4], { smite: 1 });
    const far = await rig.channel(who, "inspiring smite", { targetCharacterId: away.id }, [5, 5]);
    const usedFar = rig.res(who, "channel_divinity").used;
    const out = await rig.channel(who, "inspiring smite", { targetCharacterIds: [friend.id], targetCharacterId: friend.id }, [5, 5]);
    const state = { budget: rig.budget(), temp: [rig.world.sheet(who.id).tempHp, rig.world.sheet(friend.id).tempHp] };
    rig.note("smite", [smite.ok, smite.error, smite.damage?.expression, out.ok, out.error, brief(out.result, 160), state]);
    return {
      bonus: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(state.budget?.bonusUsed, "it is a bonus action");
      },
      "within-30": () => {
        assert.equal(before.ok, false, "Inspiring Smite was taken with no Divine Smite this turn");
        assert.equal(far.ok, false, "an ally 50 feet off was given temporary hit points");
        assert.equal(usedFar, 0, "a refusal spent the use");
      },
      "temp-hp": () => assert.equal(state.temp[0] + state.temp[1], 5 + 5 + 3, `after a Divine Smite the use and the bonus action were spent, and the paladin and the ally beside them hold ${state.temp[0]} and ${state.temp[1]} temporary hit points: 2d8 (two 5s) + paladin level 3 were to be shared out; the result is ${brief(out.result, 140)}`),
    };
  },

  "paladin::Aura of Alacrity": async (rig) => {
    const speeds = [7, 6].map((level) => rig.srd.speedFor(rig.world.sheet(rig.hero("paladin", "Oath of Glory", level).id)));
    return { speed: () => assert.deepEqual(speeds, [40, 30]) };
  },

  "paladin::Glorious Defense": async (rig) => {
    const facts = await rig.counterFacts("paladin", "Oath of Glory", 15, "sub_glorious_defense");
    return {
      uses: () => assert.equal(facts.max, cha(15), `${facts.max} uses at 15th level (Charisma +${cha(15)}, proficiency +${profOf(15)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "paladin::Living Legend": async (rig) => {
    const { who, foe, checks } = await capstone(rig, "Oath of Glory", "Living Legend", "sub_living_legend", { action: "bonus", rounds: 10 });
    const checksRolled = [rig.d20s((await rig.check(who, "persuasion")).result), rig.d20s((await rig.check(who, "intimidation")).result), rig.d20s((await rig.check(who, "perception")).result)];
    rig.kit.setEnemy(foe.id, { ac: 15 });
    const miss = await rig.kit.swing(who.id, foe.id, [2, 4, 4]);
    const failed = await rig.save(who, "dex", { dc: 25 }, [2]);
    const reroll = await rig.spend(who, "Living Legend Reroll", {}, [19]);
    const rerolled = rig.lastRolls(4).find((roll) => roll.kind === "saving_throw" && /living legend/i.test(roll.detail));
    const reacted = rig.reacted(who) || rig.budget()?.reactionUsed === true;
    // A turn later: "As a bonus action", and this turn's went on the first use.
    rig.kit.freshTurn();
    const again = await rig.spend(who, "Living Legend", { level: 5 });
    const slots = rig.world.sheet(who.id).spellcasting.slots["5"];
    rig.note("legend", [checksRolled, miss.ok, brief(miss.result, 200), failed.result.success, reroll.ok, reroll.error, brief(reroll.result, 200), rerolled?.total, reacted, again.ok, again.error, brief(again.result, 160), slots]);
    rig.reset();
    const facts = await rig.counterFacts("paladin", "Oath of Glory", 20, "sub_living_legend");
    return {
      ...checks,
      "charisma-checks": () => assert.deepEqual(checksRolled, [2, 2, 1], "Persuasion and Intimidation with advantage, Perception without"),
      "miss-hits": () => assert.ok(miss.result.hit === true || miss.result._parked === true, `a longsword's miss (a 2 on the die) while the feature runs is ${brief(miss.result, 160)}: nothing lets it hit instead; the condition's summary: "(the GM rules the hit)"`),
      reroll: () => {
        assert.equal(failed.result.success, false);
        assert.equal(reroll.ok, true, reroll.error);
        assert.ok(rerolled, "no second saving throw was rolled");
        assert.equal(reacted, true, "the reroll takes the reaction");
      },
      "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]),
      "5th-level-slot": () => assert.ok(again.ok === true && slots.used === 1, `with the one use spent, Living Legend named again with a 5th-level slot: ${again.ok ? brief(again.result, 140) : again.error} (5th-level slots used: ${slots.used})`),
    };
  },

  "paladin::Channel Divinity: Watcher's Will": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Watchers", 3);
    await rig.fight(who);
    const out = await rig.channel(who, "watcher's will");
    const meta = rig.meta(who, "watcher's will");
    return {
      minute: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(meta?.rounds, 10);
      },
      "range-in-the-words": () => assert.match(rig.textOf("paladin::Channel Divinity: Watcher's Will"), /30 feet/, "the engine takes allies within 30 feet only (scripts/test-channel-table.mjs holds it), and the words on the sheet give no range"),
    };
  },

  "paladin::Channel Divinity: Abjure the Extraplanar": async (rig) => {
    const seen = await chosenInReach(rig, "Oath of the Watchers", "abjure the extraplanar", "turned", { type: "aberration" });
    return {
      "30-feet": () => assert.deepEqual(seen.reach, [true, false]),
      minute: () => assert.equal(seen.meta?.rounds, 10, brief(seen.meta)),
    };
  },

  "paladin::Aura of the Sentinel": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Watchers", 7);
    const friend = rig.hero("cleric", "Life Domain", 7);
    const own = await rig.call("request_roll", { characterId: who.id, kind: "initiative", reason: "a fight" }, [10]);
    const ally = await rig.call("request_roll", { characterId: friend.id, kind: "initiative", reason: "a fight" }, [10]);
    // The 6th-level paladin rolls in a world of their own: beside the 7th-level
    // one (no board, so in reach) they would take that paladin's aura as an
    // ally, and the check is about their own feature not yet held.
    rig.reset();
    const low = await rig.call("request_roll", { characterId: rig.hero("paladin", "Oath of the Watchers", 6).id, kind: "initiative", reason: "a fight" }, [10]);
    rig.note("sentinel", [own.result.total, ally.result.total, low.result.total]);
    return {
      own: () => assert.deepEqual([own.result.total, low.result.total], [10 + 2 + profOf(7), 12], "the paladin's initiative at 7th level, and at 6th"),
      allies: () => assert.equal(ally.result.total, 10 + 2 + profOf(7), `an ally at the paladin's side rolled initiative ${ally.result.total} on a 10 (Dexterity +2): the paladin's proficiency bonus (+3) is not added; the row's note: "Allies within 10 feet (30 from 18th level) add it too; the GM adds theirs."`),
    };
  },

  "paladin::Mortal Bulwark": async (rig) => {
    const light = await rig.load("lib/dm/attack-light.ts");
    const { who, checks } = await capstone(rig, "Oath of the Watchers", "Mortal Bulwark", "sub_mortal_bulwark", { action: "bonus", rounds: 10 });
    const truesight = light.characterSenses(rig.world.sheet(who.id)).truesight * 5;
    rig.reset();
    const again = rig.hero("paladin", "Oath of the Watchers", 20);
    const [fiend, human] = await rig.fight(again, { enemies: 2 });
    rig.kit.setEnemy(fiend.id, { stats: { type: "fiend" } });
    rig.kit.place(human.id, 4, 6);
    await rig.spend(again, "Mortal Bulwark");
    const { out: blow, roll: banishSave } = await saveMadeBy(rig, () => rig.kit.swing(again.id, fiend.id, [15, 15, 4, 4, 1, 1]));
    const fiendNow = rig.enemy(fiend.id);
    rig.kit.saveEncounter({ ...rig.world.encounter(), turnBudget: { ...rig.budget(), attacksMade: 0, actionUsed: false } });
    const plain = await rig.kit.swing(again.id, human.id, [15, 4, 4]);
    rig.note("bulwark", [truesight, blow.toHit?.advantage, blow.error, plain.toHit?.advantage, banishSave?.detail ?? null, fiendNow.conditions, fiendNow.status]);
    return {
      ...checks,
      truesight: () => assert.equal(truesight, 120, `the paladin's truesight while it runs reads ${truesight} feet`),
      advantage: () => assert.deepEqual([blow.toHit?.advantage, plain.toHit?.advantage], ["advantage", "none"], "against a fiend, and against a humanoid"),
      banish: () => assert.ok(banishSave || fiendNow.status !== "alive" || fiendNow.conditions.some((name) => /banish/i.test(name)), `the paladin's hit on a fiend asked it for no Charisma save: it stands there with ${brief(fiendNow.conditions)}`),
      "limit-in-the-words": () => assert.match(rig.textOf("paladin::Mortal Bulwark"), /long rest|bonus action/i, "the engine takes a bonus action and one use a long rest; the words on the sheet name neither"),
    };
  },

  "paladin::Channel Divinity: Champion Challenge": async (rig) => {
    const seen = await chosenInReach(rig, "Oath of the Crown", "champion challenge", "champion challenge");
    return {
      choice: () => {
        assert.equal(seen.chosen.ok, true, seen.chosen.error);
        assert.deepEqual(seen.picked, [true, false]);
      },
      "30-feet": () => assert.deepEqual(seen.reach, [true, false]),
    };
  },

  "paladin::Channel Divinity: Turn the Tide": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Crown", 3);
    const a = rig.hero("cleric", "Life Domain", 3);
    const b = rig.hero("cleric", "Life Domain", 3);
    await rig.fight(who);
    rig.kit.place(a.id, 4, 5);
    rig.kit.place(b.id, 6, 5);
    for (const entry of [a, b]) rig.world.patch(entry.id, { currentHp: 20 });
    const out = await rig.channel(who, "turn the tide", { targetCharacterIds: [a.id], targetCharacterId: a.id }, [3, 3, 3]);
    const healed = [rig.hp(a) - 20, rig.hp(b) - 20];
    rig.note("tide", [out.ok, out.error, brief(out.result), healed]);
    return {
      choice: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(healed[0] > 0 && healed[1] === 0, `with one of two hurt allies named, they regained ${healed[0]} and ${healed[1]}: the one left out was healed too`);
      },
    };
  },

  "paladin::Divine Allegiance": async (rig) => {
    const near = await takenForAlly(rig, "Oath of the Crown", 7, "Divine Allegiance", 5);
    const far = await takenForAlly(rig, "Oath of the Crown", 7, "Divine Allegiance", 10);
    rig.note("allegiance", [near.out.ok, near.out.error, near.friend, near.who, far.out.ok, far.out.error]);
    return {
      "ignoring-resistance": () => {
        assert.equal(near.out.ok, true, near.out.error);
        assert.equal(near.who, 94, `a tiefling paladin, who resists fire, took ${100 - near.who} of the 6 fire meant for the ally`);
      },
      "5-feet": () => assert.equal(far.out.ok, false, "a creature 10 feet away was covered"),
    };
  },

  "paladin::Exalted Champion": async (rig) => {
    const { who, checks } = await capstone(rig, "Oath of the Crown", "Exalted Champion", "sub_exalted_champion", { action: "action", rounds: 600 });
    const friend = rig.hero("cleric", "Life Domain", 20);
    rig.reset();
    const again = rig.hero("paladin", "Oath of the Crown", 20);
    const ally = rig.hero("cleric", "Life Domain", 20);
    await rig.fight(again);
    rig.kit.place(ally.id, 8, 5);
    await rig.spend(again, "Exalted Champion");
    const taken = await physicalResistance(rig, again);
    const saves = [rig.d20s((await rig.save(again, "wis")).result), rig.d20s((await rig.save(again, "dex")).result), rig.d20s((await rig.save(ally, "wis")).result)];
    // The paladin dying while it runs: the order comes round to them and the
    // engine throws their death save.
    rig.kit.giveTurn(ally.id);
    rig.world.patch(again.id, { currentHp: 0, conditions: ["unconscious", "prone", "exalted champion"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    const before = new Set(rig.lastRolls(60).map((roll) => roll.id));
    rig.endTurnOf(ally);
    rig.kit.handOnEnemies();
    const death = rig.lastRolls(60).find((roll) => !before.has(roll.id) && /death/i.test(`${roll.kind} ${roll.detail}`)) ?? null;
    const ownDeath = { kind: death?.kind, dice: rig.diceIn(death, 20), saves: rig.world.sheet(again.id).deathSaves, pointer: rig.pointer()?.name };
    rig.note("exalted", [taken, saves, ownDeath, who.id === friend.id]);
    return {
      ...checks,
      weapons: () => assert.deepEqual(taken, { bludgeoning: 5, piercing: 5, slashing: 5, magical: 10, fire: 10 }),
      "wisdom-saves": () => assert.deepEqual(saves.slice(0, 2), [2, 1], "the paladin's Wisdom save, and their Dexterity save"),
      "allies-wisdom": () => assert.equal(saves[2], 2, `an ally 15 feet from the paladin rolled a Wisdom save on ${saves[2]} d20; the counter's guidance: "The server applies both to the paladin."`),
      "death-saves": () => {
        assert.ok(death, `no death save was thrown when the dying paladin's turn came (${JSON.stringify(ownDeath)})`);
        assert.equal(ownDeath.dice, 2, `the paladin's death save was thrown on ${ownDeath.dice} d20`);
      },
      "limit-in-the-words": () => assert.match(rig.textOf("paladin::Exalted Champion"), /long rest|action/i, "the engine takes an action and one use a long rest; the words on the sheet name neither"),
    };
  },

  "paladin::Channel Divinity: Dreadful Aspect": async (rig) => {
    const seen = await chosenInReach(rig, "Oathbreaker", "dreadful aspect", "frightened");
    return {
      choice: () => {
        assert.equal(seen.chosen.ok, true, seen.chosen.error);
        assert.deepEqual(seen.picked, [true, false]);
      },
      "30-feet": () => assert.deepEqual(seen.reach, [true, false]),
      minute: () => assert.equal(seen.meta?.rounds, 10, brief(seen.meta)),
    };
  },

  "paladin::Aura of Hate": async (rig) => {
    const weak = rig.hero("paladin", "Oathbreaker", 7, { abilities: { cha: 8 } });
    const [dummy] = await rig.fight(weak);
    const swing = await rig.kit.swing(weak.id, dummy.id, [18, 4]);
    rig.reset();
    const who = rig.hero("paladin", "Oathbreaker", 7);
    const friend = rig.hero("cleric", "Life Domain", 7);
    const [undead] = await rig.fight(friend, { stats: { type: "undead" } });
    rig.kit.place(who.id, 5, 7);
    rig.foesTurn(undead);
    const hit = await rig.enemyHits(undead, friend, [16, 4]);
    const took = 100 - rig.hp(friend);
    rig.note("hate", [swing.damage?.expression, swing.damage?.total, brief(hit.result, 200), took]);
    return {
      "at-least-1": () => assert.equal(swing.damage?.total, 4 + 3 + 1, `with Charisma 8 the longsword rolled ${swing.damage?.expression} = ${swing.damage?.total}`),
      "fiends-and-undead": () => assert.equal(took, 6 + cha(7), `an undead 5 feet from the oathbreaker hit with its club for ${took}: the paladin's Charisma modifier (+${cha(7)}) is not added; the row's note: "Fiends and undead within 10 feet (30 from 18th level) add it too; the GM adds theirs."`),
    };
  },

  "paladin::Supernatural Resistance": async (rig) => {
    const taken = await physicalResistance(rig, rig.hero("paladin", "Oathbreaker", 15));
    return { resist: () => assert.deepEqual(taken, { bludgeoning: 5, piercing: 5, slashing: 5, magical: 10, fire: 10 }) };
  },

  "paladin::Dread Lord": async (rig) => {
    const { who, foe, checks } = await capstone(rig, "Oathbreaker", "Dread Lord", "sub_dread_lord", { action: "action", rounds: 10 });
    rig.kit.setEnemy(foe.id, { conditions: ["frightened"], conditionMeta: { frightened: { rounds: 10, source: who.id } } });
    rig.world.clearDice();
    rig.world.dice(5, 5, 5, 5);
    rig.endTurnOf(who);
    rig.world.clearDice();
    const burned = 300 - rig.enemy(foe.id).currentHp;
    rig.kit.setEnemy(foe.id, { conditions: [], conditionMeta: {} });
    rig.foesTurn(foe);
    const before = new Set(rig.lastRolls(40).map((roll) => roll.id));
    await rig.enemyHits(foe, who, [16, 16, 4]);
    const attack = rig.lastRolls(40).find((roll) => !before.has(roll.id) && roll.kind === "attack");
    rig.kit.giveTurn(who.id);
    rig.kit.setEnemy(foe.id, { currentHp: 300 });
    const shadows = await rig.kit.swing(who.id, foe.id, [18, 5, 5, 5], { weapon: "Dread Lord's Shadows" });
    const shadowBudget = rig.budget();
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 11);
    const inAura = await rig.kit.swing(who.id, foe.id, [18, 5, 5, 5], { weapon: "Dread Lord's Shadows" });
    rig.note("dread", [burned, attack?.advantage, shadows.ok, shadows.error, shadows.damage?.expression, shadows.damage?.total, shadowBudget, inAura.ok, inAura.error]);
    rig.reset();
    const facts = await rig.counterFacts("paladin", "Oathbreaker", 20, "sub_dread_lord");
    return {
      ...checks,
      "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]),
      "4d10": () => assert.equal(burned, 20, `a creature frightened of the paladin that started its turn 5 feet off took ${burned}: 4d10 (four 5s)`),
      "sight-disadvantage": () => assert.equal(attack?.advantage, "disadvantage", `a goblin's club at the paladin rolled with ${attack?.advantage}`),
      shadows: () => {
        assert.equal(shadows.ok, true, shadows.error);
        assert.equal(shadows.damage?.total, 15 + cha(20), `the shadows rolled ${shadows.damage?.expression} = ${shadows.damage?.total} against a creature 5 feet off`);
        assert.ok(shadowBudget?.bonusUsed === true && shadowBudget?.actionUsed !== true, `they cost ${brief(shadowBudget, 120)}`);
      },
      "in-the-aura": () => assert.equal(inAura.ok, true, `the shadows at a creature 30 feet off, inside the aura: ${inAura.error}`),
    };
  },
};
