// The scenes of the clause ledger for the cleric's Forge, Grave, Order, Peace,
// Twilight and Arcana domains (scripts/clauses/divine.json). See
// scripts/lib/sweep-clauses-divine.mjs for how a scene answers its clauses.
import { assert, profOf } from "./sweep-clauses-divine.mjs";
import { divineStrike, potentSpellcasting, wisdomCounter, extraCantrips } from "./sweep-clauses-divine-cleric-a.mjs";

const sorted = (list) => [...(list ?? [])].sort();
const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);

export const CLERIC_B = {
  "cleric::Bonus Proficiencies (Forge)": async (rig) => {
    const got = rig.trained("cleric", "Forge Domain", 1).proficiencies;
    return { training: () => assert.ok(got.armor.includes("heavy") && got.tools.some((tool) => /smith/i.test(tool)), brief(got)) };
  },

  "cleric::Blessing of the Forge": async (rig) => {
    const who = rig.hero("cleric", "Forge Domain", 1, { acOverride: false, equipment: [{ name: "Chain Mail", qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }] });
    const friend = rig.hero("cleric", "Life Domain", 1, { acOverride: false, equipment: [{ name: "Chain Mail", qty: 1, equipped: true }] });
    const acBefore = [rig.world.sheet(who.id).ac, rig.world.sheet(friend.id).ac];
    const armor = await rig.spend(who, "Blessing of the Forge", { variant: "armor", targetCharacterId: friend.id });
    const acBlessed = rig.world.sheet(friend.id).ac;
    const metaArmor = rig.meta(friend, "blessing of the forge");
    const again = await rig.spend(who, "Blessing of the Forge", { variant: "weapon", targetCharacterId: who.id });
    const stillArmored = rig.has(friend, "blessing of the forge");
    const [foe] = await rig.fight(who);
    const inFight = await rig.spend(who, "Blessing of the Forge", { variant: "weapon", targetCharacterId: who.id });
    const swing = await rig.kit.swing(who.id, foe.id, [10, 4]);
    rig.note("forge", [armor.ok, armor.error, armor.result, acBefore, acBlessed, metaArmor, again.ok, again.error, stillArmored, rig.conditions(who), inFight.error, swing.toHit?.expression, swing.damage?.expression]);
    return {
      armor: () => {
        assert.equal(armor.ok, true, armor.error);
        assert.equal(acBlessed, acBefore[1] + 1, `the blessed chain mail's AC went from ${acBefore[1]} to ${acBlessed}`);
      },
      weapon: () => {
        assert.equal(again.ok, true, again.error);
        assert.equal(swing.toHit?.total, 10 + 3 + 2 + 1, `the blessed longsword rolled ${swing.toHit?.expression} to hit (Strength +3, proficiency +2, and the +1)`);
        assert.equal(swing.damage?.total, 4 + 3 + 1, `and ${swing.damage?.expression} for damage`);
      },
      "until-again": () => assert.equal(stillArmored, false, "after the cleric blessed a weapon, the armor blessed before still carries its +1"),
      "after-a-long-rest": () => assert.equal(again.ok, false, `a second blessing the same day was taken (${brief(again.result, 120)}): nothing holds the feature to one object a long rest`),
    };
  },

  "cleric::Divine Strike@Forge Domain": divineStrike("Forge Domain", ["fire"]),
  "cleric::Divine Strike@Order Domain": divineStrike("Order Domain", ["psychic"]),
  "cleric::Divine Strike@Twilight Domain": divineStrike("Twilight Domain", ["radiant"]),
  "cleric::Potent Spellcasting@Grave Domain": potentSpellcasting("Grave Domain"),
  "cleric::Potent Spellcasting@Peace Domain": potentSpellcasting("Peace Domain"),
  "cleric::Potent Spellcasting@Arcana Domain": potentSpellcasting("Arcana Domain"),

  "cleric::Saint of Forge and Fire": async (rig) => {
    const who = rig.hero("cleric", "Forge Domain", 17, { equipment: [{ name: "Plate", qty: 1, equipped: true }] });
    const bare = rig.hero("cleric", "Forge Domain", 17, { equipment: [] });
    const taken = {};
    for (const [label, target, type, args] of [["plate", who, "slashing", {}], ["plate-piercing", who, "piercing", {}], ["plate-bludgeoning", who, "bludgeoning", {}], ["plate-magical", who, "slashing", { magical: true }], ["unarmored", bare, "slashing", {}]]) {
      rig.world.patch(target.id, { currentHp: 100 });
      await rig.damage(target, 10, type, args);
      taken[label] = 100 - rig.hp(target);
    }
    return { "heavy-armor": () => assert.deepEqual(taken, { plate: 5, "plate-piercing": 5, "plate-bludgeoning": 5, "plate-magical": 10, unarmored: 10 }) };
  },

  "cleric::Circle of Mortality": async (rig) => {
    const who = rig.hero("cleric", "Grave Domain", 1, { spells: { cantrips: ["Spare the Dying"] } });
    const fallen = rig.hero("cleric", "Life Domain", 1);
    const [foe] = await rig.fight(who);
    rig.kit.place(fallen.id, 11, 5);
    rig.world.patch(fallen.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    const out = await rig.call("heal", { characterId: fallen.id, casterId: who.id, spell: "Spare the Dying" });
    const state = { saves: rig.world.sheet(fallen.id).deathSaves };
    rig.kit.place(fallen.id, 6, 5);
    const beside = await rig.call("heal", { characterId: fallen.id, casterId: who.id, spell: "Spare the Dying" });
    state.budget = rig.budget();
    rig.note("spare", [out.ok, out.error, out.result, state, beside.ok, beside.error, foe.id]);
    return {
      "spare-30-feet": () => {
        assert.equal(out.ok, true, `Spare the Dying at a creature 30 feet away: ${out.error}`);
        assert.equal(state.saves?.stable, true);
      },
      "spare-bonus": () => {
        assert.equal(beside.ok, true, beside.error);
        assert.ok(state.budget?.bonusUsed === true && state.budget?.actionUsed !== true, `it cost ${state.budget?.actionUsed ? "the action" : "no action"} and ${state.budget?.bonusUsed ? "the bonus action" : "no bonus action"}; the row's note: "Spare the Dying at 30 feet as a bonus action is narrated."`);
      },
    };
  },

  "cleric::Eyes of the Grave": async (rig) => {
    const who = rig.hero("cleric", "Grave Domain", 1);
    await rig.fight(who);
    const out = await rig.spend(who, "Eyes of the Grave");
    const budget = rig.budget();
    rig.reset();
    const counter = await wisdomCounter(rig, "Grave Domain", 1, "sub_eyes_of_the_grave");
    return {
      action: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(budget?.actionUsed, true);
      },
      ...counter,
    };
  },

  "cleric::Channel Divinity: Path to the Grave": async (rig) => {
    const who = rig.hero("cleric", "Grave Domain", 2);
    const [foe] = await rig.fight(who);
    const before = brief([rig.enemy(foe.id).conditions, rig.conditions(who)]);
    const out = await rig.channel(who, "path to the grave", { targetEnemyId: foe.id });
    const state = { budget: rig.budget(), used: rig.res(who, "channel_divinity").used, marks: brief([rig.enemy(foe.id).conditions, rig.conditions(who)]) };
    rig.kit.freshTurn();
    const swing = await rig.kit.swing(who.id, foe.id, [18, 4]);
    const took = 300 - rig.enemy(foe.id).currentHp;
    rig.note("path", [out.ok, out.error, brief(out.result, 160), state, before, swing.result]);
    return {
      action: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(state.budget?.actionUsed, true);
        assert.equal(state.used, 1);
      },
      curse: () => assert.equal(took, 14, `the action and the use were spent, the creature carries ${state.marks} (before: ${before}), and the next hit (a longsword's 4 + 3) took ${took} hit points, not the 14 vulnerability makes it`),
    };
  },

  "cleric::Sentinel at Death's Door": async (rig) => wisdomCounter(rig, "Grave Domain", 6, "sub_sentinel_at_deaths_door"),

  "cleric::Keeper of Souls": async (rig) => {
    const who = rig.hero("cleric", "Grave Domain", 17);
    const friend = rig.hero("cleric", "Life Domain", 17);
    const stage = async ({ cleric = [5, 4], stunned = false } = {}) => {
      const foes = await rig.fight(friend, { enemies: 3, hp: 1 });
      foes.forEach((foe, index) => rig.kit.place(foe.id, 4 + index, 6));
      rig.kit.place(who.id, cleric[0], cleric[1]);
      rig.world.patch(who.id, { currentHp: 40, conditions: stunned ? ["stunned"] : [], conditionMeta: stunned ? { stunned: { rounds: 5 } } : {} });
      rig.world.patch(friend.id, { currentHp: 100 });
      return foes;
    };
    let foes = await stage();
    const first = await rig.kit.swing(friend.id, foes[1].id, [18, 4]);
    const healedOnce = rig.hp(who) - 40;
    rig.kit.saveEncounter({ ...rig.world.encounter(), turnBudget: { ...rig.budget(), actionUsed: false, attacksMade: 0 } });
    const second = await rig.kit.swing(friend.id, foes[0].id, [18, 4]);
    const healedTwice = rig.hp(who) - 40 - healedOnce;
    foes = await stage({ cleric: [19, 6] });
    await rig.kit.swing(friend.id, foes[1].id, [18, 4]);
    const healedFar = rig.hp(who) - 40;
    foes = await stage({ stunned: true });
    await rig.kit.swing(friend.id, foes[1].id, [18, 4]);
    const healedStunned = rig.hp(who) - 40;
    rig.note("keeper", [first.ok, first.error, brief(first.result, 300), healedOnce, second.ok, healedTwice, healedFar, healedStunned, rig.enemy(foes[1].id).stats?.hitDice ?? null]);
    return {
      heals: () => {
        assert.equal(first.result.dead, true, first.error);
        assert.ok(healedOnce > 0, `the hurt cleric regained ${healedOnce} when an enemy died 10 feet away`);
      },
      "60-feet": () => assert.equal(healedFar, 0, `an enemy that died 70 feet from the cleric healed ${healedFar}`),
      incapacitated: () => assert.equal(healedStunned, 0, `a stunned cleric's Keeper of Souls healed ${healedStunned}`),
      "once-a-turn": () => {
        assert.equal(second.result.dead, true, second.error);
        assert.equal(healedTwice, 0, `a second enemy dying in the same turn healed ${healedTwice} more`);
      },
    };
  },

  "cleric::Bonus Proficiencies (Order)": async (rig) => {
    const grant = rig.grantOf("cleric", "Order Domain", 1, "Bonus Proficiencies (Order)");
    return {
      armor: () => assert.ok(grant?.spec.armor.includes("heavy")),
      skill: () => {
        assert.equal(grant?.spec.skills, 1);
        assert.deepEqual(sorted(grant.spec.skillsFrom), ["intimidation", "persuasion"]);
      },
    };
  },

  "cleric::Voice of Authority": async (rig) => {
    const who = rig.hero("cleric", "Order Domain", 1, { spells: { prepared: ["Bless", "Healing Word"] } });
    const friend = rig.hero("cleric", "Life Domain", 1);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 4, 6);
    rig.world.patch(friend.id, { currentHp: 50 });
    const cast = await rig.call("heal", { characterId: friend.id, casterId: who.id, spell: "Healing Word", level: 1 }, [4]);
    const out = await rig.react(friend, "Voice of Authority", { targetEnemyId: foe.id }, [18, 4]);
    const state = { ally: rig.reacted(friend), cleric: rig.reacted(who), took: 300 - rig.enemy(foe.id).currentHp };
    rig.note("voice", [cast.ok, cast.error, out.ok, out.error, brief(out.result), state]);
    return {
      attack: () => {
        assert.equal(cast.ok, true, cast.error);
        assert.equal(out.ok, true, out.error);
        assert.equal(state.took, 7, `the ally's longsword took ${state.took}`);
      },
      "allys-reaction": () => assert.deepEqual([state.ally, state.cleric], [true, false], "the ally's reaction is the one spent"),
    };
  },

  "cleric::Channel Divinity: Order's Demand": async (rig) => {
    const who = rig.hero("cleric", "Order Domain", 2);
    const [near, other, far] = await rig.fight(who, { enemies: 3 });
    rig.kit.place(other.id, 6, 6);
    rig.kit.place(far.id, 12, 5);
    const chosen = await rig.channel(who, "order's demand", { targetEnemyIds: [near.id] }, [1, 1, 1]);
    const state = { budget: rig.budget(), near: rig.enemy(near.id).conditions, other: rig.enemy(other.id).conditions };
    rig.reset();
    const again = rig.hero("cleric", "Order Domain", 2);
    const [deaf, open, distant] = await rig.fight(again, { enemies: 3 });
    rig.kit.place(open.id, 6, 6);
    rig.kit.place(distant.id, 12, 5);
    rig.kit.setEnemy(deaf.id, { conditions: ["blinded", "deafened"], conditionMeta: { blinded: { rounds: 10 }, deafened: { rounds: 10 } } });
    const all = await rig.channel(again, "order's demand", {}, [1, 1, 1]);
    const after = { deaf: rig.enemy(deaf.id).conditions, open: rig.enemy(open.id).conditions, distant: rig.enemy(distant.id).conditions };
    rig.note("demand", [chosen.ok, chosen.error, brief(chosen.result), state, all.ok, all.error, brief(all.result), after]);
    return {
      action: () => {
        assert.equal(chosen.ok, true, chosen.error);
        assert.equal(state.budget?.actionUsed, true);
      },
      choice: () => assert.deepEqual([state.near.includes("charmed"), state.other.includes("charmed")], [true, false], "the creature chosen is charmed, and the one left out is not"),
      "30-feet": () => assert.deepEqual([after.open.includes("charmed"), after.distant.includes("charmed")], [true, false], "the creature 5 feet off is charmed, and one 35 feet off is not"),
      "see-or-hear": () => assert.equal(after.deaf.includes("charmed"), false, "a creature both blinded and deafened, which can neither see nor hear the cleric, was charmed"),
    };
  },

  "cleric::Embodiment of the Law": async (rig) => {
    const who = rig.hero("cleric", "Order Domain", 6, { spells: { prepared: ["Command", "Guiding Bolt"] } });
    const friend = rig.hero("cleric", "Life Domain", 6);
    const [foe] = await rig.fight(who);
    // First on a turn nothing has been done in yet, as the board hands it over.
    const fresh = await rig.spend(who, "Embodiment of the Law");
    const freshBudget = rig.budget();
    // Then on a turn the order came round to: the ally ends theirs.
    rig.kit.giveTurn(friend.id);
    rig.endTurnOf(friend);
    const cameRound = rig.pointer()?.characterId === who.id;
    // And with the turn's budget already written, as after any other act.
    const live = rig.world.encounter();
    rig.kit.saveEncounter({ ...live, turnBudget: { ownerId: who.id, round: live.round, actionUsed: false, bonusUsed: false, reactionUsed: false, attacksMade: 0, attacksAllowed: 1, oncePerTurn: [], dashed: false, disengaged: false } });
    const spent = await rig.spend(who, "Embodiment of the Law");
    rig.note("fresh turn", [fresh.ok, fresh.error, freshBudget, cameRound, rig.budget(), spent.ok, spent.error]);
    const cast = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Command", saveAbility: "wis", level: 1 }, [1]);
    const after = rig.budget();
    rig.kit.freshTurn();
    const spentAgain = await rig.spend(who, "Embodiment of the Law");
    const bolt = await rig.kit.swing(who.id, foe.id, [18, 3, 3, 3, 3], { spell: "Guiding Bolt", level: 1 });
    const boltBudget = rig.budget();
    rig.note("law", [spent.ok, spent.error, brief(spent.result), cast.ok, cast.error, after, spentAgain.ok, bolt.ok, bolt.error, boltBudget]);
    rig.reset();
    const counter = await wisdomCounter(rig, "Order Domain", 6, "sub_embodiment_of_the_law");
    return {
      "first-act": () => assert.equal(fresh.ok, true, `spent as the first thing of the cleric's turn (turn budget ${JSON.stringify(freshBudget)}; the same when the order comes round to them: ${cameRound}): ${fresh.error}`),
      bonus: () => {
        assert.equal(spent.ok && cast.ok, true, spent.error || cast.error);
        assert.ok(after?.bonusUsed === true && after?.actionUsed !== true, `Command, an enchantment, cost ${after?.actionUsed ? "the action" : "no action"} and ${after?.bonusUsed ? "the bonus action" : "no bonus action"}`);
      },
      enchantment: () => {
        assert.equal(bolt.ok, true, bolt.error);
        assert.equal(boltBudget?.actionUsed, true, "Guiding Bolt, an evocation, was cast without the action after the feature was spent");
      },
      ...counter,
    };
  },

  "cleric::Order's Wrath": async (rig) => {
    const who = rig.hero("cleric", "Order Domain", 17);
    const friend = rig.hero("cleric", "Life Domain", 17);
    rig.setUsed(friend, "channel_divinity", rig.res(friend, "channel_divinity").max);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 4, 6);
    const strike = await rig.kit.swing(who.id, foe.id, [18, 4, 5, 5]);
    const marked = rig.enemy(foe.id).conditions;
    rig.kit.giveTurn(friend.id);
    const allied = await rig.kit.swing(friend.id, foe.id, [18, 4, 5, 5, 5, 5]);
    const cleared = rig.enemy(foe.id).conditions;
    rig.note("wrath", [strike.damage?.expression, marked, allied.ok, allied.error, allied.damage?.expression, brief(allied.result, 300), cleared]);
    return {
      mark: () => assert.ok(marked.some((entry) => /order's wrath/i.test(entry)), `after the Divine Strike the creature carries ${brief(marked)}`),
      "ally-2d8": () => {
        assert.equal(allied.ok, true, allied.error);
        assert.match(String(allied.damage?.expression), /2d8/, `the ally's hit rolled ${allied.damage?.expression}`);
        assert.ok(brief(allied.result, 600).includes("psychic"), `no psychic part in ${brief(allied.result, 300)}`);
      },
      "next-time": () => assert.ok(!cleared.some((entry) => /order's wrath/i.test(entry)), "the mark stays after the ally's hit"),
    };
  },

  "cleric::Implement of Peace": async (rig) => {
    const grant = rig.grantOf("cleric", "Peace Domain", 1, "Implement of Peace");
    return {
      skill: () => {
        assert.equal(grant?.spec.skills, 1);
        assert.deepEqual(sorted(grant.spec.skillsFrom), ["insight", "performance", "persuasion"]);
      },
    };
  },

  "cleric::Emboldening Bond": async (rig) => {
    const who = rig.hero("cleric", "Peace Domain", 1);
    const a = rig.hero("cleric", "Life Domain", 1);
    const b = rig.hero("cleric", "Life Domain", 1);
    const c = rig.hero("cleric", "Life Domain", 1);
    await rig.fight(who);
    rig.kit.place(a.id, 6, 5);
    rig.kit.place(b.id, 12, 5);
    rig.kit.place(c.id, 4, 5);
    const tooMany = await rig.spend(who, "Emboldening Bond", { targetCharacterIds: [who.id, a.id, c.id] });
    const bondedAfterMany = [who, a, b, c].filter((entry) => rig.has(entry, "emboldening bond")).length;
    rig.reset();
    const me = rig.hero("cleric", "Peace Domain", 1);
    const near = rig.hero("cleric", "Life Domain", 1);
    const far = rig.hero("cleric", "Life Domain", 1);
    await rig.fight(me);
    rig.kit.place(near.id, 6, 5);
    rig.kit.place(far.id, 12, 5);
    const farOut = await rig.spend(me, "Emboldening Bond", { targetCharacterIds: [far.id, near.id] });
    const farBonded = rig.has(far, "emboldening bond");
    const out = farOut.ok && !farBonded && rig.has(near, "emboldening bond") && rig.has(me, "emboldening bond") ? farOut : await rig.spend(me, "Emboldening Bond", { targetCharacterIds: [me.id, near.id] });
    const state = { budget: rig.budget(), meta: rig.meta(near, "emboldening bond"), self: rig.has(me, "emboldening bond"), near: rig.has(near, "emboldening bond") };
    const expressionOf = (kind) => rig.lastRolls(4).find((roll) => roll.kind === kind && roll.characterId === near.id)?.expression;
    await rig.save(near, "wis", {}, [10, 2]);
    const firstSave = expressionOf("saving_throw");
    await rig.save(near, "wis", {}, [10, 2]);
    const secondSave = expressionOf("saving_throw");
    rig.kit.giveTurn(near.id);
    await rig.check(near, "athletics", {}, [10, 2]);
    const checked = expressionOf("skill_check") ?? expressionOf("ability_check");
    rig.kit.giveTurn(me.id);
    rig.kit.place(near.id, 19, 14);
    await rig.save(near, "wis", {}, [10, 2]);
    const alone = expressionOf("saving_throw");
    rig.note("bond", [tooMany.ok, tooMany.error, brief(tooMany.result), bondedAfterMany, farOut.ok, farOut.error, farBonded, out.ok, out.error, state, firstSave, secondSave, checked, alone]);
    rig.reset();
    const facts = await rig.counterFacts("cleric", "Peace Domain", 1, "sub_emboldening_bond");
    return {
      action: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(state.budget?.actionUsed, true);
      },
      count: () => assert.ok(bondedAfterMany <= profOf(1), `three creatures named at 1st level (proficiency +2), and ${bondedAfterMany} are bonded`),
      "30-feet": () => assert.equal(farBonded, false, "a creature 35 feet away was bonded"),
      self: () => assert.equal(state.self && state.near, true, "the cleric and the ally named are bonded"),
      "10-minutes": () => assert.equal(state.meta?.rounds, 100),
      d4: () => {
        assert.match(String(firstSave), /1d4/, `a bonded creature's saving throw, 5 feet from another bonded creature, rolled ${firstSave} (its ability check ${checked}); the condition's row is a summary only: "(roll it as a bonus die)"`);
        assert.match(String(checked), /1d4/);
        assert.doesNotMatch(String(secondSave), /1d4/, `its second roll of the same turn rolled ${secondSave}`);
        assert.doesNotMatch(String(alone), /1d4/, `more than 30 feet from any other bonded creature it rolled ${alone}`);
      },
      uses: () => assert.equal(facts.max, profOf(1), `${facts.max} uses at 1st level (proficiency +2, Wisdom +5)`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "cleric::Protective Bond": async (rig) => {
    const stage = async (level, feetApart, bonded = true) => {
      rig.reset();
      const who = rig.hero("cleric", "Peace Domain", level);
      const a = rig.hero("cleric", "Life Domain", level);
      const b = rig.hero("cleric", "Life Domain", level);
      const [foe] = await rig.fight(a);
      rig.kit.place(who.id, 4, 5);
      rig.kit.place(b.id, 5 + feetApart / 5, 5);
      if (bonded) {
        for (const entry of [a, b]) rig.world.patch(entry.id, { conditions: ["emboldening bond"], conditionMeta: { "emboldening bond": { rounds: 100, source: who.id } } });
      }
      rig.foesTurn(foe);
      await rig.enemyHits(foe, a, [16, 4]);
      const out = await rig.react(b, "Protective Bond", { targetCharacterId: a.id });
      const at = rig.kit.token(b.id);
      const to = rig.kit.token(a.id);
      return { out, a: rig.hp(a), b: rig.hp(b), apart: Math.max(Math.abs(at.x - to.x), Math.abs(at.y - to.y)) * 5, reacted: rig.reacted(b) };
    };
    const near = await stage(6, 30);
    const far = await stage(6, 35);
    const unbonded = await stage(6, 10, false);
    const wide = await stage(17, 60);
    rig.note("protective", [near.out.ok, near.out.error, brief(near.out.result), near.a, near.b, near.apart, far.out.ok, far.out.error, unbonded.out.ok, unbonded.out.error, wide.out.ok, wide.out.error, wide.a, wide.b]);
    return {
      takes: () => {
        assert.equal(near.out.ok, true, near.out.error);
        assert.deepEqual([near.a, near.b, near.reacted], [100, 94, true], "the bonded creature 30 feet away takes the 6 with its reaction");
      },
      "30-feet": () => assert.equal(far.out.ok, false, "a bonded creature 35 feet away took the damage at 6th level"),
      bonded: () => assert.equal(unbonded.out.ok, false, `two creatures with no Emboldening Bond on them used Protective Bond: ${brief(unbonded.out.result, 160)}`),
      teleport: () => assert.equal(near.apart, 5, `after the reaction the protector stands ${near.apart} feet from the creature it protected`),
      "60-feet": () => assert.equal(wide.out.ok, true, `at 17th level a bonded creature 60 feet away: ${wide.out.error}`),
      resistance: () => assert.deepEqual([wide.a, wide.b], [100, 97], "the protector takes half of the 6 with Expansive Bond"),
    };
  },

  "cleric::Bonus Proficiencies (Twilight)": async (rig) => {
    const got = rig.trained("cleric", "Twilight Domain", 1).proficiencies;
    return { training: () => assert.ok(got.armor.includes("heavy") && got.weapons.includes("martial"), brief(got)) };
  },

  "cleric::Eyes of Night": async (rig) => {
    const light = await rig.load("lib/dm/attack-light.ts");
    const who = rig.hero("cleric", "Twilight Domain", 1);
    const plain = rig.hero("cleric", "Life Domain", 1);
    const feetOf = (hero) => light.characterSenses(rig.world.sheet(hero.id)).darkvision * 5;
    const seen = [feetOf(who), feetOf(plain)];
    rig.note("eyes", seen);
    rig.reset();
    const facts = await rig.counterFacts("cleric", "Twilight Domain", 1, "sub_eyes_of_night");
    return {
      darkvision: () => assert.deepEqual(seen, [300, 0], `darkvision read for the Twilight cleric and a Life cleric: ${brief(seen)}`),
      "once-a-long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]),
    };
  },

  "cleric::Vigilant Blessing": async (rig) => {
    const who = rig.hero("cleric", "Twilight Domain", 1);
    const friend = rig.hero("cleric", "Life Domain", 1);
    const out = await rig.spend(who, "Vigilant Blessing", { targetCharacterId: friend.id });
    const blessed = rig.has(friend, "vigilant blessing");
    const first = await rig.call("request_roll", { characterId: friend.id, kind: "initiative", reason: "a fight" });
    const kept = rig.has(friend, "vigilant blessing");
    const second = await rig.call("request_roll", { characterId: friend.id, kind: "initiative", reason: "another fight" });
    const self = await rig.spend(who, "Vigilant Blessing", { targetCharacterId: who.id });
    rig.note("vigilant", [out.ok, out.error, blessed, rig.d20s(first.result), kept, rig.d20s(second.result), self.ok, self.error]);
    return {
      advantage: () => {
        assert.equal(out.ok && blessed, true, out.error);
        assert.equal(rig.d20s(first.result), 2);
      },
      next: () => assert.deepEqual([kept, rig.d20s(second.result)], [false, 1], "the blessing is spent by the first initiative roll"),
      "a-creature": () => assert.equal(self.ok, true, `the cleric blessing themselves: ${self.error}`),
    };
  },

  "cleric::Channel Divinity: Twilight Sanctuary": async (rig) => {
    const who = rig.hero("cleric", "Twilight Domain", 2);
    await rig.fight(who);
    const out = await rig.channel(who, "twilight sanctuary");
    const state = { meta: rig.meta(who, "twilight sanctuary"), budget: rig.budget() };
    rig.note("sanctuary", [out.ok, out.error, state]);
    return {
      minute: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(state.meta?.rounds, 10);
      },
    };
  },

  "cleric::Steps of Night": async (rig) => {
    const who = rig.hero("cleric", "Twilight Domain", 6);
    await rig.fight(who);
    const out = await rig.spend(who, "Steps of Night");
    const state = { budget: rig.budget(), meta: rig.meta(who, "flying"), speeds: rig.srd.computeSheetDerived(rig.world.sheet(who.id)).speeds ?? null, conditions: rig.conditions(who) };
    rig.note("steps", [out.ok, out.error, brief(out.result), state]);
    rig.reset();
    const facts = await rig.counterFacts("cleric", "Twilight Domain", 6, "sub_steps_of_night");
    return {
      bonus: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(state.budget?.bonusUsed === true && state.budget?.actionUsed !== true);
      },
      minute: () => assert.equal(state.meta?.rounds, 10, `conditions: ${state.conditions}`),
      uses: () => assert.equal(facts.max, profOf(6), `${facts.max} uses at 6th level (proficiency +3, Wisdom +5)`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "cleric::Arcane Initiate": async (rig) => {
    const got = rig.trained("cleric", "Arcana Domain", 1).proficiencies;
    const extra = await extraCantrips(rig, "cleric", "Arcana Domain", 1);
    return {
      arcana: () => assert.ok(got.skills.includes("arcana"), brief(got)),
      cantrips: () => assert.ok(extra.count >= 2, extra.says),
    };
  },

  "cleric::Channel Divinity: Arcane Abjuration": async (rig) => {
    const stage = async (level, { type = "fiend", feetOff = 5, conditions = [] } = {}) => {
      rig.reset();
      const who = rig.hero("cleric", "Arcana Domain", level);
      const [foe] = await rig.fight(who, { stats: { type } });
      rig.kit.place(foe.id, 5, 5 + feetOff / 5);
      if (conditions.length) rig.kit.setEnemy(foe.id, { conditions, conditionMeta: Object.fromEntries(conditions.map((name) => [name, { rounds: 10 }])) });
      const out = await rig.channel(who, "arcane abjuration", { targetEnemyId: foe.id }, [1]);
      const foeNow = rig.enemy(foe.id);
      return { out, conditions: foeNow.conditions, meta: foeNow.conditionMeta, status: foeNow.status, budget: rig.budget(), used: rig.res(who, "channel_divinity").used };
    };
    const turned = await stage(2);
    const humanoid = await stage(2, { type: "humanoid" });
    const far = await stage(2, { feetOff: 35 });
    const senseless = await stage(2, { conditions: ["blinded", "deafened"] });
    const banished = await stage(5);
    rig.note("abjuration", [turned.out.ok, turned.out.error, brief(turned.out.result), turned.conditions, turned.meta, humanoid.out.error, far.out.error, senseless.out.ok, senseless.conditions, banished.conditions, banished.status, brief(banished.out.result, 400)]);
    const isTurned = (entry) => entry.conditions.some((name) => /turned/i.test(name));
    return {
      action: () => {
        assert.equal(turned.out.ok, true, turned.out.error);
        assert.deepEqual([turned.budget?.actionUsed, turned.used], [true, 1]);
      },
      types: () => assert.deepEqual([isTurned(turned), humanoid.out.ok], [true, false], "a fiend is turned, a humanoid refused"),
      "30-feet": () => assert.equal(far.out.ok, false, "a fiend 35 feet away was abjured"),
      "see-or-hear": () => assert.equal(senseless.out.ok && isTurned(senseless), false, "a fiend both blinded and deafened was turned"),
      minute: () => {
        const meta = Object.entries(turned.meta ?? {}).find(([name]) => /turned/i.test(name))?.[1];
        assert.equal(meta?.rounds, 10, brief(turned.meta));
        assert.equal(meta?.endsOnDamage, true, "damage does not end it");
      },
      banished: () => assert.ok(banished.conditions.some((name) => /banish/i.test(name)) || banished.status !== "alive", `at 5th level a CR 1/4 fiend that failed is ${brief(banished.conditions)} (${banished.status}); the result: ${brief(banished.out.result, 300)}`),
    };
  },

  "cleric::Spell Breaker": async (rig) => {
    const who = rig.hero("cleric", "Arcana Domain", 6, { spells: { prepared: ["Cure Wounds"] } });
    const friend = rig.hero("cleric", "Life Domain", 6);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 4, 5);
    rig.world.patch(friend.id, { currentHp: 50 });
    const held = await rig.call("set_condition", { characterId: friend.id, condition: "paralyzed", rounds: 10, magical: true, source: "Hold Person", spell: "Hold Person", level: 2, casterEnemyId: foe.id });
    const before = rig.conditions(friend);
    const heal = await rig.call("heal", { characterId: friend.id, casterId: who.id, spell: "Cure Wounds", level: 2 }, [4, 4]);
    const after = rig.conditions(friend);
    rig.note("breaker", [held.ok, held.error, brief(held.result), before, heal.ok, heal.error, brief(heal.result), after]);
    return {
      ends: () => {
        assert.ok(before.includes("paralyzed"), `the staged Hold Person: ${held.error || brief(held.result)}`);
        assert.equal(heal.ok, true, heal.error);
        assert.ok(!after.includes("paralyzed"), `a 2nd-level Cure Wounds healed the ally and Hold Person (2nd level) still holds them: ${after}; the row is narrated: "Ending a spell on the creature a healing spell touched is an end_condition the GM makes, of a level no higher than the slot."`);
      },
    };
  },

  "cleric::Arcane Mastery": async (rig) => {
    const extra = await extraCantrips(rig, "cleric", "Arcana Domain", 17);
    return { picks: () => assert.ok(extra.anyList >= 4, `${extra.says}; the row is narrated: "The four wizard spells (6th to 9th level) are the cleric's choice; once chosen they are written onto the sheet as always prepared."`) };
  },
};
