// The scenes of the clause ledger for the ranger's archetypes (Beast Master,
// Gloom Stalker, Horizon Walker, Monster Slayer, Fey Wanderer, Swarmkeeper,
// Drakewarden) (scripts/clauses/divine.json). See
// scripts/lib/sweep-clauses-divine.mjs for how a scene answers its clauses.
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";

const brief = (value, length = 200) => JSON.stringify(value)?.slice(0, length);
const wis = (level) => modOf(castingScore(level));
const NONMAGICAL = "bludgeoning, piercing, and slashing from nonmagical attacks";
const again = (rig) => rig.kit.saveEncounter({ ...rig.world.encounter(), turnBudget: { ...rig.budget(), actionUsed: false, attacksMade: 0 } });
const petOf = (rig, who) => (rig.world.sheet(who.id).pets ?? [])[0] ?? null;

// A companion summoned and sent at a creature that resists nonmagical weapons.
async function companion(rig, subclass, level, summon) {
  rig.reset();
  const who = rig.hero("ranger", subclass, level);
  const called = await rig.call("summon_pet", { characterId: who.id, ...summon });
  const pet = petOf(rig, who);
  const [foe] = await rig.fight(who);
  rig.kit.setEnemy(foe.id, { stats: { resist: NONMAGICAL } });
  const attack = (faces = [18, 4, 4, 4]) => rig.call("pet_attack", { characterId: who.id, targetEnemyId: foe.id, petName: pet?.name, name: pet?.name }, faces);
  return { who, called, pet, foe, attack };
}

export const RANGER = {
  "ranger::Ranger's Companion": async (rig) => {
    const wolf = await companion(rig, "Beast Master", 3, { kind: "beast_companion", form: "wolf", name: "Ash" });
    const bite = await wolf.attack();
    const roll = rig.lastRolls(6).filter((entry) => entry.kind === "attack" || entry.kind === "damage").map((entry) => entry.expression);
    const cost = rig.budget();
    const second = await wolf.attack();
    const bear = await companion(rig, "Beast Master", 3, { kind: "beast_companion", form: "brown bear", name: "Bruin" });
    const big = await companion(rig, "Beast Master", 5, { kind: "beast_companion", form: "wolf", name: "Ash" });
    rig.note("companion", [wolf.called.ok, wolf.called.error, brief(wolf.pet, 400), bite.ok, bite.error, roll, cost, second.ok, second.error, bear.called.ok, bear.called.error, big.pet?.maxHp ?? big.pet?.hp]);
    const hpOf = (pet) => pet?.maxHp ?? pet?.hp?.max ?? pet?.hp;
    return {
      "cr-and-size": () => {
        assert.equal(wolf.called.ok, true, wolf.called.error);
        assert.equal(bear.called.ok, false, "a brown bear, Large and challenge rating 1, was taken as a companion");
      },
      "hit-points": () => assert.deepEqual([hpOf(wolf.pet), hpOf(big.pet)], [12, 20], "a wolf's 11 or four times the ranger level: 12 at 3rd level, 20 at 5th"),
      ac: () => assert.equal(wolf.pet?.ac, 13 + profOf(3), `a wolf's AC 13 and the proficiency bonus: ${wolf.pet?.ac}`),
      attack: () => {
        assert.equal(bite.ok, true, bite.error);
        // The damage expression may carry the bonus as two terms (2d4+2+2).
        const flat = (expression) => (String(expression).match(/[+-]\d+(?!d)/g) ?? []).reduce((sum, term) => sum + Number(term), 0);
        assert.ok(roll.some((expression) => /^1d20/.test(expression) && flat(expression) === 6) && roll.some((expression) => /^2d4/.test(expression) && flat(expression) === 4), `the wolf's bite (+4, 2d4+2) with the proficiency bonus rolled ${roll}`);
      },
      action: () => {
        assert.equal(cost?.actionUsed, true, `commanding the attack cost ${brief(cost, 120)}`);
        assert.equal(second.ok, false, "a second attack was commanded in the same turn at 3rd level");
      },
    };
  },

  "ranger::Exceptional Training": async (rig) => {
    const run = async (level) => {
      const scene = await companion(rig, "Beast Master", level, { kind: "beast_companion", form: "wolf", name: "Ash" });
      const bite = await scene.attack();
      const rolled = rig.lastRolls(4).find((entry) => entry.kind === "damage")?.total;
      return { bite, rolled, took: 300 - rig.enemy(scene.foe.id).currentHp };
    };
    const at7 = await run(7);
    const at6 = await run(6);
    rig.note("training", [at7.bite.ok, at7.bite.error, at7.rolled, at7.took, at6.rolled, at6.took]);
    return {
      magical: () => {
        assert.equal(at7.bite.ok, true, at7.bite.error);
        assert.deepEqual([at7.took, at6.took], [at7.rolled, Math.floor(at6.rolled / 2)], `against a creature resisting nonmagical weapons the bite rolled ${at7.rolled} and took ${at7.took} at 7th level, rolled ${at6.rolled} and took ${at6.took} at 6th`);
      },
    };
  },

  "ranger::Bestial Fury": async (rig) => {
    const scene = await companion(rig, "Beast Master", 11, { kind: "beast_companion", form: "wolf", name: "Ash" });
    const first = await scene.attack();
    const second = await scene.attack();
    rig.note("fury", [first.ok, first.error, brief(first.result, 240), second.ok, second.error]);
    return {
      "two-attacks": () => {
        assert.equal(first.ok, true, first.error);
        assert.ok(second.ok || /two|second|2 attacks/i.test(brief(first.result, 600)), `at 11th level one command gave one bite, and the second is refused: ${second.error.slice(0, 200)}; the row is narrated: "the GM gives it two attacks when commanded to attack."`);
      },
    };
  },

  "ranger::Dread Ambusher": async (rig) => {
    const who = rig.hero("ranger", "Gloom Stalker", 3);
    const rolled = await rig.call("request_roll", { characterId: who.id, kind: "initiative", reason: "a fight" }, [10]);
    const [foe] = await rig.fight(who);
    const speed = rig.srd.speedFor(rig.world.sheet(who.id));
    const first = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    const budget = rig.budget();
    const second = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    rig.note("ambusher", [rolled.result.total, speed, first.damage?.expression, budget, second.ok, second.error, second.damage?.expression]);
    return {
      initiative: () => assert.equal(rolled.result.total, 10 + 2 + wis(3), `initiative on a 10 with Dexterity +2 and Wisdom +${wis(3)}: ${rolled.result.total}`),
      "extra-attack": () => {
        assert.equal(second.ok, true, `on the first turn of the fight a 3rd-level Gloom Stalker's second attack: ${second.error.slice(0, 160)}`);
        assert.equal(rig.diceIn(second.damage, 8), 2, `it rolled ${second.damage?.expression}: the longsword's d8 and 1d8 more`);
      },
      speed: () => assert.equal(budget?.speedBonus ?? speed, 40, `on the first turn the ranger's speed reads ${speed} (budget ${brief(budget, 160)})`),
    };
  },

  "ranger::Umbral Sight": async (rig) => {
    const light = await rig.load("lib/dm/attack-light.ts");
    // An elf's own darkvision is the species trait the builder writes onto
    // the sheet as a feature named Darkvision (60 feet).
    const elf = (made) => {
      const sheet = rig.world.sheet(made.id);
      rig.world.patch(made.id, { features: [...sheet.features, { ...sheet.features[0], name: "Darkvision", description: "You can see in dim light within 60 feet of you as if it were bright light." }] });
      return made;
    };
    const feetOf = (made) => light.characterSenses(rig.world.sheet(made.id)).darkvision * 5;
    const seen = [feetOf(rig.hero("ranger", "Gloom Stalker", 3, { race: "Human" })), feetOf(elf(rig.hero("ranger", "Gloom Stalker", 3, { race: "Elf" })))];
    const plain = feetOf(elf(rig.hero("ranger", "Hunter", 3, { race: "Elf" })));
    rig.note("darkvision", [...seen, plain]);
    return { darkvision: () => assert.deepEqual([...seen, plain], [60, 90, 60], "a human Gloom Stalker, an elf Gloom Stalker, an elf Hunter") };
  },

  "ranger::Stalker's Flurry": async (rig) => {
    const who = rig.hero("ranger", "Gloom Stalker", 11);
    const [foe] = await rig.fight(who);
    rig.kit.setEnemy(foe.id, { ac: 15 });
    // Past the first turn, where Dread Ambusher's attack would muddy the count.
    rig.kit.saveEncounter({ ...rig.world.encounter(), round: 2 });
    const one = await rig.kit.swing(who.id, foe.id, [2, 4]);
    const two = await rig.kit.swing(who.id, foe.id, [18, 4]);
    const three = await rig.kit.swing(who.id, foe.id, [18, 4]);
    rig.note("flurry", [one.result.hit, two.ok, two.error, three.ok, three.error, rig.budget()]);
    return {
      another: () => {
        assert.equal(one.result.hit, false);
        assert.equal(two.ok, true, two.error);
        assert.equal(three.ok, true, `after a miss and a hit with Extra Attack's two attacks, the one more the miss allows: ${three.error.slice(0, 200)}; the row is narrated: "the GM calls pc_attack again for it."`);
      },
    };
  },

  "ranger::Detect Portal": async (rig) => {
    const facts = await rig.counterFacts("ranger", "Horizon Walker", 3, "sub_detect_portal");
    return { rest: () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 0, 0]) };
  },

  "ranger::Planar Warrior": async (rig) => {
    const strike = async (level, faces) => {
      rig.reset();
      const who = rig.hero("ranger", "Horizon Walker", level);
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: { immune: "slashing" } });
      const out = await rig.spend(who, "Planar Warrior", { targetEnemyId: foe.id });
      const budget = rig.budget();
      const swing = await rig.kit.swing(who.id, foe.id, faces);
      const took = 300 - rig.enemy(foe.id).currentHp;
      const next = await (async () => {
        again(rig);
        return rig.kit.swing(who.id, foe.id, faces);
      })();
      return { out, budget, swing, took, next };
    };
    const low = await strike(3, [18, 4, 5]);
    const high = await strike(11, [18, 4, 5, 5]);
    rig.note("planar", [low.out.ok, low.out.error, low.budget, low.swing.damage?.expression, brief(low.swing.result.damageByType), low.took, low.next.damage?.expression, high.swing.damage?.expression]);
    return {
      bonus: () => {
        assert.equal(low.out.ok, true, low.out.error);
        assert.ok(low.budget?.bonusUsed === true && low.budget?.actionUsed !== true);
      },
      d8: () => assert.equal(rig.diceIn(low.swing.damage, 8), 2, `the marked hit rolled ${low.swing.damage?.expression}`),
      "all-force": () => assert.equal(low.took, 4 + 3 + 5, `a creature immune to slashing lost ${low.took} to the marked longsword hit (${brief(low.swing.result.damageByType)}): the weapon's 7 and the 5 more are all force`),
      "next-hit": () => assert.equal(rig.diceIn(low.next.damage, 8), 1, `a second hit the same turn rolled ${low.next.damage?.expression ?? low.next.error}`),
      "2d8-at-11": () => assert.equal(rig.diceIn(high.swing.damage, 8), 3, `at 11th level the marked hit rolled ${high.swing.damage?.expression}`),
    };
  },

  "ranger::Ethereal Step": async (rig) => {
    const who = rig.hero("ranger", "Horizon Walker", 7);
    await rig.fight(who);
    const before = brief(rig.conditions(who));
    const out = await rig.spend(who, "Ethereal Step");
    const state = { budget: rig.budget(), conditions: rig.conditions(who) };
    rig.note("step", [out.ok, out.error, brief(out.result), state]);
    rig.reset();
    const facts = await rig.counterFacts("ranger", "Horizon Walker", 7, "sub_ethereal_step");
    return {
      bonus: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(state.budget?.bonusUsed === true && state.budget?.actionUsed !== true);
      },
      ethereal: () => assert.ok(state.conditions.some((name) => /ethereal/i.test(name)), `the use and the bonus action are spent and the ranger carries ${brief(state.conditions)} (before: ${before}): nothing marks them ethereal for the turn`),
      rest: () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 0, 0]),
    };
  },

  "ranger::Distant Strike": async (rig) => {
    const who = rig.hero("ranger", "Horizon Walker", 11);
    const [a, b, c] = await rig.fight(who, { enemies: 3 });
    rig.kit.place(b.id, 4, 6);
    rig.kit.place(c.id, 6, 6);
    const one = await rig.kit.swing(who.id, a.id, [18, 4]);
    const two = await rig.kit.swing(who.id, b.id, [18, 4]);
    const three = await rig.kit.swing(who.id, c.id, [18, 4]);
    rig.kit.freshTurn();
    rig.kit.place(a.id, 5, 8);
    const far = await rig.kit.swing(who.id, a.id, [18, 4]);
    rig.note("distant", [one.ok, two.ok, two.error, three.ok, three.error, far.ok, far.error]);
    return {
      third: () => {
        assert.equal(one.ok && two.ok, true, one.error || two.error);
        assert.equal(three.ok, true, `after striking two different creatures, the attack at a third: ${three.error.slice(0, 200)}; the row is narrated: "the GM allows them."`);
      },
      teleport: () => assert.equal(far.ok, true, `a longsword at a creature 15 feet off, 10 feet of teleport away: ${far.error.slice(0, 160)}`),
    };
  },

  "ranger::Hunter's Sense": async (rig) => {
    const who = rig.hero("ranger", "Monster Slayer", 3);
    await rig.fight(who);
    const out = await rig.spend(who, "Hunter's Sense");
    const budget = rig.budget();
    rig.reset();
    const facts = await rig.counterFacts("ranger", "Monster Slayer", 3, "sub_hunters_sense");
    return {
      action: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(budget?.actionUsed, true);
      },
      uses: () => assert.equal(facts.max, wis(3), `${facts.max} uses at 3rd level (Wisdom +${wis(3)}, proficiency +2)`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "ranger::Slayer's Prey": async (rig) => {
    const who = rig.hero("ranger", "Monster Slayer", 5);
    const [prey, other] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(other.id, 4, 6);
    const out = await rig.spend(who, "Slayer's Prey", { targetEnemyId: prey.id });
    const budget = rig.budget();
    const first = await rig.kit.swing(who.id, prey.id, [18, 4, 5]);
    const second = await rig.kit.swing(who.id, prey.id, [18, 4, 5]);
    rig.kit.freshTurn();
    const stray = await rig.kit.swing(who.id, other.id, [18, 4, 5]);
    rig.note("prey", [out.ok, out.error, budget, first.damage?.expression, second.damage?.expression, stray.damage?.expression, rig.enemy(prey.id).conditions]);
    return {
      bonus: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(budget?.bonusUsed === true && budget?.actionUsed !== true);
      },
      d6: () => assert.equal(rig.diceIn(first.damage, 6), 1, `the first hit on the prey rolled ${first.damage?.expression}`),
      "first-each-turn": () => assert.equal(rig.diceIn(second.damage, 6), 0, `the second hit the same turn rolled ${second.damage?.expression}`),
      "against-it": () => assert.equal(rig.diceIn(stray.damage, 6), 0, `a hit on a creature that is not the prey rolled ${stray.damage?.expression}`),
    };
  },

  "ranger::Magic-User's Nemesis": async (rig) => {
    const facts = await rig.counterFacts("ranger", "Monster Slayer", 11, "sub_magic_users_nemesis");
    return { rest: () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 0, 0]) };
  },

  "ranger::Dreadful Strikes": async (rig) => {
    const strike = async (level) => {
      rig.reset();
      const who = rig.hero("ranger", "Fey Wanderer", level);
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: { immune: "slashing" } });
      const first = await rig.kit.swing(who.id, foe.id, [18, 4, 3]);
      const took = 300 - rig.enemy(foe.id).currentHp;
      again(rig);
      const second = await rig.kit.swing(who.id, foe.id, [18, 4, 3]);
      return { first, second, took };
    };
    const low = await strike(3);
    const high = await strike(11);
    rig.note("dreadful", [low.first.damage?.expression, brief(low.first.result.damageByType), low.took, low.second.damage?.expression, high.first.damage?.expression]);
    return {
      d4: () => {
        assert.equal(rig.diceIn(low.first.damage, 4), 1, `a hit rolled ${low.first.damage?.expression}`);
        assert.equal(low.took, 3, `a creature immune to slashing lost ${low.took}: the 1d4 psychic (a 3) alone`);
      },
      "once-a-turn": () => assert.equal(rig.diceIn(low.second.damage, 4), 0, `the second hit rolled ${low.second.damage?.expression}`),
      "d6-at-11": () => assert.equal(rig.diceIn(high.first.damage, 6), 1, `at 11th level a hit rolled ${high.first.damage?.expression}`),
    };
  },

  "ranger::Otherworldly Glamour": async (rig) => {
    const who = rig.hero("ranger", "Fey Wanderer", 3);
    const plain = rig.hero("ranger", "Hunter", 3);
    const totals = [(await rig.check(who, "persuasion", {}, [10])).result.total, (await rig.check(plain, "persuasion", {}, [10])).result.total];
    const grant = rig.grantOf("ranger", "Fey Wanderer", 3, "Otherworldly Glamour");
    return {
      wisdom: () => assert.equal(totals[0] - totals[1], wis(3), `a Persuasion check on a 10 totals ${totals[0]} for the Fey Wanderer and ${totals[1]} for a Hunter with the same scores: the Wisdom modifier (+${wis(3)}) is not added`),
      skill: () => {
        assert.equal(grant?.spec.skills, 1);
        assert.deepEqual([...grant.spec.skillsFrom].sort(), ["deception", "performance", "persuasion"]);
      },
    };
  },

  "ranger::Fey Wanderer Magic": async (rig) => {
    const table = rig.features.subclassSpellsFor("ranger", "Fey Wanderer", 3);
    return { spells: () => assert.ok(table.includes("Charm Person"), `the table at 3rd level: ${table}`) };
  },

  "ranger::Beguiling Twist": async (rig) => {
    const who = rig.hero("ranger", "Fey Wanderer", 7);
    const dice = [rig.d20s((await rig.save(who, "wis", { against: "charmed" })).result), rig.d20s((await rig.save(who, "wis", { against: "frightened" })).result), rig.d20s((await rig.save(who, "wis", { against: "poisoned" })).result)];
    const [foe] = await rig.fight(who);
    rig.foesTurn(foe);
    const out = await rig.react(who, "Beguiling Twist", { targetEnemyId: foe.id });
    rig.note("twist", [dice, out.ok, out.error]);
    return {
      advantage: () => assert.deepEqual(dice, [2, 2, 1], "saves against being charmed, frightened and poisoned"),
      redirect: () => assert.equal(out.ok, true, `use_reaction "Beguiling Twist": ${out.error.slice(0, 200)}; the row's note: "Redirecting the charm is narrated."`),
    };
  },

  "ranger::Fey Reinforcements": async (rig) => {
    const table = rig.features.subclassSpellsFor("ranger", "Fey Wanderer", 11);
    const facts = await rig.counterFacts("ranger", "Fey Wanderer", 11, "sub_fey_reinforcements");
    return {
      learn: () => assert.ok(table.includes("Summon Fey"), `the table at 11th level: ${table}`),
      "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]),
    };
  },

  "ranger::Misty Wanderer": async (rig) => {
    const who = rig.hero("ranger", "Fey Wanderer", 15);
    const friend = rig.hero("cleric", "Life Domain", 15);
    await rig.fight(who);
    rig.kit.place(friend.id, 6, 5);
    const slotsBefore = brief(rig.world.sheet(who.id).spellcasting.slots);
    const out = await rig.spend(who, "Misty Wanderer", { x: 11, y: 5, targetCharacterId: friend.id });
    const state = { budget: rig.budget(), who: [rig.kit.token(who.id).x, rig.kit.token(who.id).y], friend: [rig.kit.token(friend.id).x, rig.kit.token(friend.id).y], slots: brief(rig.world.sheet(who.id).spellcasting.slots) === slotsBefore };
    rig.note("misty", [out.ok, out.error, brief(out.result), state]);
    rig.reset();
    const facts = await rig.counterFacts("ranger", "Fey Wanderer", 15, "sub_misty_wanderer");
    return {
      "no-slot": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(state.slots, true, "a spell slot was spent");
      },
      teleport: () => assert.deepEqual(state.who, [11, 5], `the ranger stands at ${state.who}, from (5,5): the use is spent and the step is handed back (${brief(out.result, 160)})`),
      "bonus-action": () => assert.ok(state.budget?.bonusUsed === true, `misty step is a bonus action, and the use cost ${brief(state.budget, 120)}`),
      along: () => assert.ok(Math.max(Math.abs(state.friend[0] - 11), Math.abs(state.friend[1] - 5)) <= 1, `the willing creature beside the ranger stands at ${state.friend}`),
      uses: () => assert.equal(facts.max, wis(15), `${facts.max} uses at 15th level (Wisdom +${wis(15)}, proficiency +5)`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "ranger::Gathered Swarm": async (rig) => {
    const who = rig.hero("ranger", "Swarmkeeper", 11);
    const [foe] = await rig.fight(who);
    const hit = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    const move = await rig.spend(who, "Gathered Swarm", { variant: "move", x: 4, y: 5 });
    rig.note("swarm", [hit.damage?.expression, move.ok, move.error.slice(0, 200), [rig.kit.token(who.id).x, rig.kit.token(who.id).y]]);
    return {
      "d8-at-11": () => assert.match(String(hit.damage?.expression), /1d8\+3\+1d8/, `at 11th level a hit rolled ${hit.damage?.expression}`),
    };
  },

  "ranger::Swarmkeeper Magic": async (rig) => {
    const table = rig.features.subclassSpellsFor("ranger", "Swarmkeeper", 3);
    return { spells: () => assert.ok(table.includes("Mage Hand") && table.includes("Faerie Fire"), `the table at 3rd level: ${table}`) };
  },

  "ranger::Writhing Tide": async (rig) => {
    const who = rig.hero("ranger", "Swarmkeeper", 7);
    await rig.fight(who);
    const out = await rig.spend(who, "Writhing Tide");
    const state = { budget: rig.budget(), meta: rig.meta(who, "flying"), speeds: rig.srd.computeSheetDerived(rig.world.sheet(who.id)).speeds ?? null };
    rig.note("tide", [out.ok, out.error, brief(out.result), state]);
    rig.reset();
    const facts = await rig.counterFacts("ranger", "Swarmkeeper", 7, "sub_writhing_tide");
    return {
      bonus: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(state.budget?.bonusUsed === true && state.budget?.actionUsed !== true);
      },
      minute: () => assert.equal(state.meta?.rounds, 10),
      "10-feet": () => assert.equal(state.speeds?.fly, 10, `the ranger's speeds read ${brief(state.speeds)} while it runs; the result: ${brief(out.result, 200)}`),
      uses: () => assert.equal(facts.max, profOf(7), `${facts.max} uses at 7th level (proficiency +3, Wisdom +${wis(7)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "ranger::Swarming Dispersal": async (rig) => {
    const who = rig.hero("ranger", "Swarmkeeper", 15);
    const [foe] = await rig.fight(who);
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [16, 4]);
    const out = await rig.react(who, "Swarming Dispersal", { x: 11, y: 5 });
    const state = { hp: rig.hp(who), at: [rig.kit.token(who.id).x, rig.kit.token(who.id).y], reacted: rig.reacted(who) };
    rig.note("dispersal", [out.ok, out.error, brief(out.result), state]);
    rig.reset();
    const facts = await rig.counterFacts("ranger", "Swarmkeeper", 15, "sub_swarming_dispersal");
    return {
      resistance: () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual([state.hp, state.reacted], [97, true], "half of the 6 comes back, for the reaction");
      },
      teleport: () => assert.deepEqual(state.at, [11, 5], `the ranger stands at ${state.at}, from (5,5), after naming a space 30 feet off: ${brief(out.result, 200)}`),
      uses: () => assert.equal(facts.max, profOf(15), `${facts.max} uses at 15th level (proficiency +5, Wisdom +${wis(15)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "ranger::Draconic Gift": async (rig) => {
    const table = rig.features.subclassSpellsFor("ranger", "Drakewarden", 3);
    const got = rig.trained("ranger", "Drakewarden", 3).proficiencies;
    return {
      thaumaturgy: () => assert.ok(table.includes("Thaumaturgy"), `the table at 3rd level: ${table}`),
      draconic: () => assert.ok(got.languages.includes("Draconic"), brief(got.languages)),
    };
  },

  "ranger::Drake Companion": async (rig) => {
    const scene = await companion(rig, "Drakewarden", 3, { kind: "drake", form: "drake", essence: "fire", name: "Ember" });
    const counter = rig.res(scene.who, "sub_drake_companion");
    const bite = await scene.attack([18, 4, 4]);
    const rolls = rig.lastRolls(6).filter((entry) => entry.kind === "attack" || entry.kind === "damage").map((entry) => entry.expression);
    const cost = rig.budget();
    const infused = await rig.react(scene.who, "Infused Strikes", { targetEnemyId: scene.foe.id });
    await rig.kit.endFight();
    const second = await rig.call("summon_pet", { characterId: scene.who.id, kind: "drake", form: "drake", essence: "cold", name: "Rime" });
    const afterSecond = rig.res(scene.who, "sub_drake_companion");
    rig.note("drake", [scene.called.ok, scene.called.error, brief(scene.pet, 420), counter, bite.ok, bite.error, rolls, cost, infused.ok, infused.error.slice(0, 160), second.ok, second.error, afterSecond]);
    const hpOf = (pet) => pet?.maxHp ?? pet?.hp?.max ?? pet?.hp;
    return {
      "hit-points": () => {
        assert.equal(scene.called.ok, true, scene.called.error);
        assert.equal(hpOf(scene.pet), 5 + 5 * 3, `the drake's hit points: ${hpOf(scene.pet)}`);
      },
      bite: () => {
        assert.equal(bite.ok, true, bite.error);
        assert.ok(rolls.some((expression) => /1d6\+2\b/.test(expression)), `the bite rolled ${rolls}: 1d6 + the proficiency bonus`);
      },
      "bonus-command": () => assert.ok(cost?.bonusUsed === true && cost?.actionUsed !== true, `commanding the drake cost ${brief(cost, 120)}`),
      "once-a-long-rest": () => assert.ok(counter?.used === 1 && (!second.ok || afterSecond?.used > 1), `summoning the drake left the feature's counter at ${brief(counter)}, and a second summoning the same day was ${second.ok ? "taken" : "refused"} (${brief(afterSecond)}): nothing holds it to once a long rest or a spell slot`),
      "infused-strikes": () => assert.equal(infused.ok, true, `use_reaction "Infused Strikes": ${infused.error.slice(0, 200)}`),
    };
  },

  "ranger::Drake's Breath": async (rig) => {
    const facts = await rig.counterFacts("ranger", "Drakewarden", 11, "sub_drakes_breath");
    const who = rig.hero("ranger", "Drakewarden", 15);
    await rig.fight(who);
    rig.setUsed(who, "sub_drakes_breath", 1);
    const bought = await rig.spend(who, "Drake's Breath", { level: 3 });
    const slot = rig.world.sheet(who.id).spellcasting.slots["3"].used;
    rig.note("breath", [facts, bought.ok, bought.error.slice(0, 200), slot]);
    return {
      "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]),
      slot: () => assert.ok(bought.ok && slot === 1, `with the one use spent, Drake's Breath named with a 3rd-level slot: ${bought.ok ? "taken" : bought.error.slice(0, 200)} (3rd-level slots used: ${slot})`),
    };
  },

  "ranger::Perfected Bond": async (rig) => {
    const scene = await companion(rig, "Drakewarden", 15, { kind: "drake", form: "drake", essence: "fire", name: "Ember" });
    rig.kit.setEnemy(scene.foe.id, { stats: { resist: "" } });
    const bite = await scene.attack([18, 4, 4, 4, 4]);
    const rolls = rig.lastRolls(6).filter((entry) => entry.kind === "damage").map((entry) => entry.expression);
    rig.note("bond", [bite.ok, bite.error, rolls, brief(bite.result, 300)]);
    rig.reset();
    const facts = await rig.counterFacts("ranger", "Drakewarden", 15, "sub_reflexive_resistance");
    return {
      "2d6": () => {
        assert.equal(bite.ok, true, bite.error);
        assert.ok(rolls.some((expression) => /2d6/.test(expression)) || /2d6/.test(brief(bite.result, 600)), `at 15th level the drake's bite rolled ${rolls} (${brief(bite.result, 200)})`);
      },
      uses: () => assert.equal(facts.max, profOf(15), `${facts.max} uses at 15th level (proficiency +5, Wisdom +${wis(15)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },
};
