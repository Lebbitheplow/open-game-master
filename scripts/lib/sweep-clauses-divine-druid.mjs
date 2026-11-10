// The scenes of the clause ledger for the druid's circles of the Moon, Dreams,
// the Shepherd, Spores, Stars and Wildfire (scripts/clauses/divine.json). See
// scripts/lib/sweep-clauses-divine.mjs for how a scene answers its clauses.
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";
import { extraCantrips } from "./sweep-clauses-divine-cleric-a.mjs";

const brief = (value, length = 200) => JSON.stringify(value)?.slice(0, length);
const wis = (level) => modOf(castingScore(level));
const NONMAGICAL = "bludgeoning, piercing, and slashing from nonmagical attacks";
// The sheets a summoning made: every sheet of the table that was not there.
const newSheets = (rig, before) => rig.world.sheets().filter((sheet) => !before.has(sheet.id));
const ids = (rig) => new Set(rig.world.sheets().map((sheet) => sheet.id));
// The foe's turn begins after the holder's ends, through the door a table's
// turn change goes through (src/lib/dm/last-hit.ts closeHitsAtTurnEnd, which
// advancePointer calls): the ending is recorded, and the creature now up is
// the one "starting its turn" a reaction like Halo of Spores answers
// (src/lib/dm/reaction-triggers.ts triggerRecords). Moving the pointer alone
// records nothing, and the engine refuses such a reaction for it.
async function foeStartsTurn(rig, who, foe) {
  const { closeHitsAtTurnEnd } = await import(new URL("../../src/lib/dm/last-hit.ts", import.meta.url).href);
  rig.kit.giveTurn(who.id);
  const encounter = rig.world.encounter();
  closeHitsAtTurnEnd(rig.world.campaignId, encounter, encounter.order[encounter.turnIndex]);
  rig.foesTurn(foe);
}

export const DRUID = {
  "druid::Combat Wild Shape": async (rig) => {
    const who = rig.hero("druid", "Circle of the Moon", 2);
    const land = rig.hero("druid", "Circle of the Land", 2);
    await rig.fight(who);
    const shape = await rig.spend(who, "Wild Shape", { form: "wolf" });
    const cost = rig.budget();
    rig.kit.freshTurn();
    const sheet = () => rig.world.sheet(who.id);
    rig.world.patch(who.id, { wildShape: { ...sheet().wildShape, beastHp: 1 } });
    const heal = await rig.call("use_spell_slot", { characterId: who.id, level: 1, spell: "Combat Wild Shape" }, [4]);
    const healBudget = rig.budget();
    const slot = sheet().spellcasting.slots["1"].used;
    const beastHp = sheet().wildShape?.beastHp;
    await rig.fight(land);
    const plain = await rig.spend(land, "Wild Shape", { form: "wolf" });
    const plainCost = rig.budget();
    rig.note("combat", [shape.ok, shape.error, heal.ok, heal.error, brief(heal.result), healBudget, slot, beastHp, plain.ok, plain.error]);
    return {
      bonus: () => {
        assert.equal(shape.ok, true, shape.error);
        assert.ok(cost?.bonusUsed === true && cost?.actionUsed !== true, `a Moon druid's Wild Shape cost ${brief(cost, 120)}`);
        assert.equal(plainCost?.actionUsed, true, "a Land druid's takes the action");
      },
      heal: () => {
        assert.equal(heal.ok, true, heal.error);
        assert.equal(slot, 1, "a 1st-level slot is spent");
        assert.ok(healBudget?.bonusUsed === true && healBudget?.actionUsed !== true, `the healing cost ${brief(healBudget, 120)}`);
        assert.equal(beastHp, 5, `the wolf at 1 hit point stands at ${beastHp} after 1d8 (a 4)`);
      },
    };
  },

  "druid::Primal Strike": async (rig) => {
    const bite = async (level) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of the Moon", level);
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: { resist: NONMAGICAL } });
      const shape = await rig.spend(who, "Wild Shape", { form: "brown bear" });
      rig.kit.freshTurn();
      const swing = await rig.kit.swing(who.id, foe.id, [18, 4, 4], { weapon: "Bite" });
      return { shape, swing, took: 300 - rig.enemy(foe.id).currentHp };
    };
    const at6 = await bite(6);
    const at5 = await bite(5);
    rig.note("primal", [at6.shape.ok, at6.shape.error, at6.swing.ok, at6.swing.error, at6.swing.damage?.expression, at6.swing.damage?.total, at6.took, at5.took, at5.swing.damage?.total]);
    return {
      magical: () => {
        assert.equal(at6.swing.ok, true, at6.swing.error || at6.shape.error);
        assert.equal(at6.took, at6.swing.damage?.total, `a 6th-level Moon druid's bear bite rolled ${at6.swing.damage?.total} and a creature resisting nonmagical weapons lost ${at6.took}`);
        assert.equal(at5.took, Math.floor(at5.swing.damage.total / 2), `at 5th level it rolled ${at5.swing.damage?.total} and the creature lost ${at5.took}`);
      },
    };
  },

  "druid::Balm of the Summer Court": async (rig) => {
    const who = rig.hero("druid", "Circle of Dreams", 4);
    const friend = rig.hero("cleric", "Life Domain", 4);
    const hidden = rig.hero("cleric", "Life Domain", 4);
    await rig.fight(who);
    rig.kit.place(friend.id, 19, 5);
    rig.kit.place(hidden.id, 6, 5);
    rig.world.patch(friend.id, { currentHp: 50 });
    rig.world.patch(hidden.id, { currentHp: 50, conditions: ["invisible"], conditionMeta: { invisible: { rounds: 10 } } });
    const max = rig.res(who, "sub_balm_of_the_summer_court")?.max;
    const tooMany = await rig.spend(who, "Balm of the Summer Court", { amount: 3, targetCharacterId: friend.id }, [3, 4, 5]);
    const out = tooMany.ok ? tooMany : await rig.spend(who, "Balm of the Summer Court", { amount: 2, targetCharacterId: friend.id }, [3, 4]);
    const state = { hp: rig.hp(friend), temp: rig.world.sheet(friend.id).tempHp, budget: rig.budget(), used: rig.res(who, "sub_balm_of_the_summer_court")?.used };
    rig.kit.freshTurn();
    const unseen = await rig.spend(who, "Balm of the Summer Court", { amount: 1, targetCharacterId: hidden.id }, [3]);
    rig.note("balm", [max, tooMany.ok, tooMany.error, out.ok, out.error, state, unseen.ok, unseen.error]);
    rig.reset();
    const facts = await rig.counterFacts("druid", "Circle of Dreams", 4, "sub_balm_of_the_summer_court");
    return {
      pool: () => assert.deepEqual([max, facts.afterShort, facts.afterLong], [4, 4, 0], "a d6 for each druid level, back on a long rest only"),
      "half-level": () => assert.equal(tooMany.ok, false, "three dice were spent at once at 4th level"),
      heal: () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual([state.hp, state.used], [57, 2], "two dice (a 3 and a 4) heal 7 at 70 feet");
        assert.ok(state.budget?.bonusUsed === true && state.budget?.actionUsed !== true, "a bonus action");
      },
      "temp-hp": () => assert.equal(state.temp, 2, `${state.temp} temporary hit points for two dice`),
      sight: () => assert.equal(unseen.ok, false, `an invisible creature, which the druid cannot see, was healed: ${brief(unseen.result, 120)}`),
    };
  },

  "druid::Hidden Paths": async (rig) => {
    const who = rig.hero("druid", "Circle of Dreams", 10);
    const friend = rig.hero("cleric", "Life Domain", 10);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 6, 5);
    const tooFar = await rig.spend(who, "Hidden Paths", { variant: "self", x: 18, y: 5 });
    const at = () => [rig.kit.token(who.id).x, rig.kit.token(who.id).y];
    const afterFar = at();
    rig.kit.place(who.id, 5, 5);
    // A fresh bonus action: the far try above spent this turn's.
    rig.kit.freshTurn();
    const occupied = await rig.spend(who, "Hidden Paths", { variant: "self", x: 5, y: 6 });
    const afterOccupied = at();
    rig.kit.place(who.id, 5, 5);
    rig.kit.freshTurn();
    const ok = await rig.spend(who, "Hidden Paths", { variant: "self", x: 17, y: 5 });
    const afterOk = at();
    rig.kit.freshTurn();
    rig.kit.place(who.id, 5, 5);
    const touch = await rig.spend(who, "Hidden Paths", { variant: "touch", targetCharacterId: friend.id, x: 13, y: 5 });
    const friendAt = [rig.kit.token(friend.id).x, rig.kit.token(friend.id).y];
    rig.note("paths", [tooFar.ok, tooFar.error, afterFar, occupied.ok, occupied.error, afterOccupied, ok.ok, ok.error, afterOk, touch.ok, touch.error, brief(touch.result), friendAt, foe.id]);
    rig.reset();
    const facts = await rig.counterFacts("druid", "Circle of Dreams", 10, "sub_hidden_paths");
    return {
      "60-feet": () => {
        assert.equal(ok.ok, true, ok.error);
        assert.deepEqual(afterOk, [17, 5], "the druid stands 60 feet away");
        assert.ok(!tooFar.ok || afterFar[0] !== 18, "a teleport of 65 feet was made");
      },
      // A teleport into the goblin's own square is refused, not taken and
      // handed to the GM to place.
      unoccupied: () => assert.equal(occupied.ok, false, `a teleport into the goblin's space was accepted (the druid then stood at ${afterOccupied})`),
      "touch-30-feet": () => {
        assert.equal(touch.ok, true, touch.error);
        assert.ok(Math.max(Math.abs(friendAt[0] - 6), Math.abs(friendAt[1] - 5)) * 5 <= 30 && (friendAt[0] !== 6 || friendAt[1] !== 5), `the touched creature stands at ${friendAt}, from (6,5)`);
      },
      uses: () => assert.equal(facts.max, wis(10), `${facts.max} uses at 10th level (Wisdom +${wis(10)}, proficiency +${profOf(10)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "druid::Walker in Dreams": async (rig) => {
    const facts = await rig.counterFacts("druid", "Circle of Dreams", 14, "sub_walker_in_dreams");
    return { "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]) };
  },

  "druid::Speech of the Woods": async (rig) => {
    const got = rig.trained("druid", "Circle of the Shepherd", 2).proficiencies;
    return { sylvan: () => assert.ok(got.languages.includes("Sylvan"), brief(got.languages)) };
  },

  "druid::Spirit Totem": async (rig) => {
    const raise = async (variant) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of the Shepherd", 2, { spells: { prepared: ["Cure Wounds"] } });
      const a = rig.hero("cleric", "Life Domain", 2);
      const b = rig.hero("cleric", "Life Domain", 2);
      await rig.fight(who);
      rig.kit.place(a.id, 6, 5);
      rig.kit.place(b.id, 4, 5);
      const out = await rig.spend(who, "Spirit Totem", { variant, targetCharacterIds: [who.id, a.id, b.id] });
      return { who, a, b, out, budget: rig.budget(), conditions: rig.conditions(who), meta: rig.meta(who, "spirit totem") };
    };
    const bear = await raise("bear");
    const bearTemp = [rig.world.sheet(bear.who.id).tempHp, rig.world.sheet(bear.a.id).tempHp];
    const bearSaves = [rig.d20s((await rig.save(bear.who, "str")).result), rig.d20s((await rig.save(bear.a, "str")).result), rig.d20s((await rig.check(bear.a, "athletics")).result), rig.d20s((await rig.save(bear.who, "dex")).result)];
    const hawk = await raise("hawk");
    const hawkChecks = [rig.d20s((await rig.check(hawk.who, "perception")).result), rig.d20s((await rig.check(hawk.a, "perception")).result)];
    const unicorn = await raise("unicorn");
    rig.world.patch(unicorn.a.id, { currentHp: 50 });
    rig.world.patch(unicorn.b.id, { currentHp: 50 });
    rig.kit.freshTurn();
    const heal = await rig.call("heal", { characterId: unicorn.a.id, casterId: unicorn.who.id, spell: "Cure Wounds", level: 1 }, [4]);
    const unicornHp = [rig.hp(unicorn.a), rig.hp(unicorn.b)];
    rig.note("totem", [bear.out.ok, bear.out.error, bear.budget, bear.conditions, bear.meta, bearTemp, bearSaves, hawk.out.ok, hawkChecks, unicorn.out.ok, heal.ok, heal.error, unicornHp]);
    rig.reset();
    const facts = await rig.counterFacts("druid", "Circle of the Shepherd", 2, "sub_spirit_totem");
    return {
      bonus: () => {
        assert.equal(bear.out.ok, true, bear.out.error);
        assert.ok(bear.budget?.bonusUsed === true && bear.budget?.actionUsed !== true);
      },
      minute: () => assert.equal(bear.meta?.rounds, 10, brief(bear.conditions)),
      rest: () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 0, 0]),
      "bear-temp-hp": () => assert.deepEqual(bearTemp, [7, 7], `the druid and an ally 5 feet from them hold ${bearTemp} temporary hit points: 5 + druid level 2`),
      "bear-strength": () => assert.deepEqual(bearSaves, [2, 2, 2, 1], "Strength saves of the druid and the ally, the ally's Athletics check, and the druid's Dexterity save"),
      "hawk-perception": () => assert.deepEqual(hawkChecks, [2, 2], "Perception checks of the druid and an ally in the aura"),
      "unicorn-heal": () => {
        assert.equal(heal.ok, true, heal.error);
        assert.equal(unicornHp[1], 52, `the druid's Cure Wounds healed one ally to ${unicornHp[0]}, and another in the aura stands at ${unicornHp[1]}: druid level 2 more was due`);
      },
    };
  },

  "druid::Mighty Summoner": async (rig) => {
    const who = rig.hero("druid", "Circle of the Shepherd", 6, { spells: { prepared: ["Conjure Animals"] } });
    const plain = rig.hero("druid", "Circle of the Land", 6, { spells: { prepared: ["Conjure Animals"] } });
    const [foe] = await rig.fight(who);
    rig.kit.setEnemy(foe.id, { stats: { resist: NONMAGICAL } });
    let before = ids(rig);
    const cast = await rig.call("cast_buff", { characterId: who.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
    const wolves = newSheets(rig, before);
    rig.kit.giveTurn(plain.id);
    before = ids(rig);
    const other = await rig.call("cast_buff", { characterId: plain.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
    const plainWolves = newSheets(rig, before);
    let bite = { ok: false, error: "no wolf was summoned" };
    let took = 0;
    if (wolves[0]) {
      rig.kit.place(wolves[0].id, 4, 6);
      const inOrder = rig.world.encounter().order.some((entry) => entry.characterId === wolves[0].id);
      if (inOrder) rig.kit.giveTurn(wolves[0].id);
      bite = await rig.kit.swing(wolves[0].id, foe.id, [18, 18, 3, 3]);
      took = 300 - rig.enemy(foe.id).currentHp;
    }
    rig.note("summoner", [cast.ok, cast.error, wolves.map((sheet) => sheet.maxHp), other.ok, other.error, plainWolves.map((sheet) => sheet.maxHp), bite.ok, bite.error, bite.damage?.total, took]);
    return {
      "hit-points": () => {
        assert.equal(cast.ok && other.ok, true, cast.error || other.error);
        assert.ok(wolves.length > 0 && wolves.every((sheet) => sheet.maxHp === plainWolves[0].maxHp + 4), `a Shepherd's wolves (2 Hit Dice) have ${wolves.map((sheet) => sheet.maxHp)} hit points, a Land druid's ${plainWolves.map((sheet) => sheet.maxHp)}`);
      },
      magical: () => {
        assert.equal(bite.ok, true, bite.error);
        assert.equal(took, bite.damage?.total, `a summoned wolf's bite rolled ${bite.damage?.total} and a creature resisting nonmagical weapons lost ${took}; the row's note: "Their natural weapons count as magical against resistance; the GM keeps to that."`);
      },
    };
  },

  "druid::Guardian Spirit": async (rig) => {
    const who = rig.hero("druid", "Circle of the Shepherd", 10, { spells: { prepared: ["Conjure Animals"] } });
    await rig.fight(who);
    const before = ids(rig);
    const cast = await rig.call("cast_buff", { characterId: who.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
    const wolves = newSheets(rig, before);
    rig.kit.freshTurn();
    const totem = await rig.spend(who, "Spirit Totem", { variant: "bear" });
    for (const wolf of wolves) {
      rig.world.patch(wolf.id, { currentHp: 1, tempHp: 0 });
      if (rig.kit.token(wolf.id)) rig.kit.place(wolf.id, 6, 5);
    }
    rig.endTurnOf(who);
    const healed = wolves.map((wolf) => rig.hp(wolf) - 1);
    rig.note("guardian", [cast.ok, cast.error, totem.ok, totem.error, healed]);
    return {
      heal: () => {
        assert.ok(cast.ok && totem.ok && wolves.length > 0, cast.error || totem.error || "no wolf was summoned");
        assert.ok(healed.every((amount) => amount === 5), `the druid's turn ended with their summoned wolves 5 feet from them inside the totem's aura, and they regained ${healed}: half of druid level 10 was due; the row is narrated: "a heal the GM makes at the end of the druid's turn."`);
      },
    };
  },

  "druid::Faithful Summons": async (rig) => {
    const facts = await rig.counterFacts("druid", "Circle of the Shepherd", 14, "sub_faithful_summons");
    return { "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]) };
  },

  "druid::Halo of Spores": async (rig) => {
    const dieAt = async (level) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of Spores", level);
      const [foe] = await rig.fight(who);
      await foeStartsTurn(rig, who, foe);
      const before = new Set(rig.lastRolls(40).map((roll) => roll.id));
      const out = await rig.react(who, "Halo of Spores", { targetEnemyId: foe.id }, [3, 1]);
      const rolls = rig.lastRolls(40).filter((roll) => !before.has(roll.id));
      return { out, text: `${brief(out.result, 300)} ${rolls.map((roll) => roll.expression).join(" ")}`, took: 300 - rig.enemy(foe.id).currentHp, who, foe };
    };
    const ladder = [];
    for (const level of [2, 6, 10, 14]) ladder.push((await dieAt(level)).text.match(/1d(4|6|8|10)\b/)?.[0] ?? "none");
    rig.reset();
    const who = rig.hero("druid", "Circle of Spores", 2);
    const [foe] = await rig.fight(who);
    // On the druid's own turn no creature has started one beside them.
    const early = await rig.react(who, "Halo of Spores", { targetEnemyId: foe.id }, [3, 1]);
    rig.kit.place(foe.id, 5, 8);
    await foeStartsTurn(rig, who, foe);
    const far = await rig.react(who, "Halo of Spores", { targetEnemyId: foe.id }, [3, 1]);
    rig.kit.place(foe.id, 5, 7);
    await foeStartsTurn(rig, who, foe);
    const saved = await rig.react(who, "Halo of Spores", { targetEnemyId: foe.id }, [3, 19]);
    const afterSave = 300 - rig.enemy(foe.id).currentHp;
    rig.kit.setEnemy(foe.id, { currentHp: 300, conditions: ["invisible"], conditionMeta: { invisible: { rounds: 10 } } });
    await foeStartsTurn(rig, who, foe);
    const unseen = await rig.react(who, "Halo of Spores", { targetEnemyId: foe.id }, [3, 1]);
    rig.note("halo", [ladder, far.ok, far.error, saved.ok, saved.error, brief(saved.result), afterSave, unseen.ok, unseen.error]);
    return {
      dice: () => assert.deepEqual(ladder, ["1d4", "1d6", "1d8", "1d10"], "the die at levels 2, 6, 10 and 14"),
      "10-feet": () => {
        assert.equal(far.ok, false, "a creature 15 feet away was struck");
        assert.match(far.error, /beyond 10 feet/, "the refusal of a creature 15 feet away is for its distance");
        assert.equal(saved.ok, true, saved.error);
      },
      "turn-start": () => {
        assert.equal(early.ok, false, `struck on the druid's own turn, with no creature starting one near them: ${brief(early.result, 140)}`);
        assert.match(early.error, /starting its turn/, "the refusal names the trigger it waits for");
      },
      save: () => assert.equal(afterSave, 0, `a creature that made its Constitution save lost ${afterSave}`),
      sight: () => {
        assert.equal(unseen.ok, false, `an invisible creature, which the druid cannot see, was struck: ${brief(unseen.result, 140)}`);
        assert.match(unseen.error, /cannot see/, "the refusal of an invisible creature is for sight");
      },
    };
  },

  "druid::Symbiotic Entity": async (rig) => {
    const who = rig.hero("druid", "Circle of Spores", 2);
    const [foe] = await rig.fight(who);
    rig.kit.setEnemy(foe.id, { stats: { immune: "slashing" } });
    const out = await rig.spend(who, "Symbiotic Entity");
    const meta = rig.meta(who, "symbiotic entity");
    rig.kit.freshTurn();
    const swing = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    const took = 300 - rig.enemy(foe.id).currentHp;
    rig.note("entity", [out.ok, out.error, meta, swing.damage?.expression, brief(swing.result.damageByType), took]);
    return {
      "10-minutes": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(meta?.rounds, 100);
      },
      necrotic: () => {
        assert.equal(rig.diceIn(swing.damage, 6), 1, `a melee hit rolled ${swing.damage?.expression}`);
        assert.equal(took, 5, `a creature immune to slashing lost ${took}: the 1d6 necrotic (a 5) alone`);
      },
    };
  },

  "druid::Fungal Infestation": async (rig) => {
    const facts = await rig.counterFacts("druid", "Circle of Spores", 6, "sub_fungal_infestation");
    return {
      uses: () => assert.equal(facts.max, wis(6), `${facts.max} uses at 6th level (Wisdom +${wis(6)}, proficiency +${profOf(6)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "druid::Spreading Spores": async (rig) => {
    const who = rig.hero("druid", "Circle of Spores", 10);
    const [foe] = await rig.fight(who);
    await rig.spend(who, "Symbiotic Entity");
    rig.kit.freshTurn();
    const out = await rig.spend(who, "Spreading Spores", { targetEnemyId: foe.id, x: 5, y: 6 });
    const zones = brief(rig.world.encounter().zones ?? null, 200);
    rig.note("spreading", [out.ok, out.error, brief(out.result), zones]);
    return {
      cube: () => assert.equal(out.ok, true, `use_resource "Spreading Spores" with Symbiotic Entity running: ${out.error.slice(0, 200)}; the row is narrated: "A 10-foot cube of spores is a zone the GM places; a creature entering or starting there takes the Halo of Spores damage on a failed Constitution save."`),
    };
  },

  "druid::Fungal Body": async (rig) => {
    const who = rig.hero("druid", "Circle of Spores", 14);
    const refused = {};
    for (const condition of ["blinded", "deafened", "frightened", "poisoned", "prone"]) {
      const out = await rig.call("set_condition", { characterId: who.id, condition, rounds: 3 });
      refused[condition] = !out.ok || !rig.conditions(who).includes(condition);
    }
    return { immune: () => assert.deepEqual(refused, { blinded: true, deafened: true, frightened: true, poisoned: true, prone: false }) };
  },

  "druid::Star Map": async (rig) => {
    const extra = await extraCantrips(rig, "druid", "Circle of Stars", 2);
    const facts = await rig.counterFacts("druid", "Circle of Stars", 2, "sub_star_map");
    return {
      guidance: () => assert.ok(extra.table.includes("Guidance") || extra.table.includes("Guiding Bolt"), `${extra.says}: neither guidance nor guiding bolt is on a Circle of Stars druid's sheet by the feature`),
      uses: () => assert.equal(facts.max, profOf(2), `${facts.max} uses at 2nd level (proficiency +2, Wisdom +${wis(2)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "druid::Starry Form": async (rig) => {
    const take = async (variant, level = 2) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of Stars", level, { spells: { prepared: ["Cure Wounds"] } });
      const a = rig.hero("cleric", "Life Domain", level);
      const b = rig.hero("cleric", "Life Domain", level);
      const [foe] = await rig.fight(who);
      rig.kit.place(a.id, 6, 5);
      rig.kit.place(b.id, 4, 5);
      const out = await rig.spend(who, "Starry Form", { variant });
      return { who, a, b, foe, out, budget: rig.budget(), meta: rig.meta(who, "starry form"), pools: [rig.res(who, "wild_shape"), rig.res(who, "sub_starry_form")], conditions: rig.conditions(who) };
    };
    const archer = await take("archer");
    rig.kit.place(archer.foe.id, 5, 10);
    rig.kit.freshTurn();
    const arrow = await rig.kit.swing(archer.who.id, archer.foe.id, [18, 5], { weapon: "starry form: archer" });
    const arrowBudget = rig.budget();
    const chalice = await take("chalice");
    rig.world.patch(chalice.a.id, { currentHp: 50 });
    rig.world.patch(chalice.b.id, { currentHp: 50 });
    rig.kit.freshTurn();
    const heal = await rig.call("heal", { characterId: chalice.a.id, casterId: chalice.who.id, spell: "Cure Wounds", level: 1, secondTargetCharacterId: chalice.b.id }, [4, 4]);
    const chaliceHp = [rig.hp(chalice.a), rig.hp(chalice.b), rig.hp(chalice.who)];
    const dragon = await take("dragon");
    const floor = await rig.check(dragon.who, "arcana", {}, [3]);
    const high = await take("archer", 10);
    rig.kit.place(high.foe.id, 5, 10);
    rig.kit.freshTurn();
    const arrow10 = await rig.kit.swing(high.who.id, high.foe.id, [18, 5, 5], { weapon: "starry form: archer" });
    rig.kit.freshTurn();
    const change = await rig.spend(high.who, "Starry Form", { variant: "dragon" });
    const changed = { conditions: rig.conditions(high.who), pools: [rig.res(high.who, "wild_shape"), rig.res(high.who, "sub_starry_form")], speeds: rig.srd.computeSheetDerived(rig.world.sheet(high.who.id)).speeds ?? null };
    rig.note("starry", [archer.out.ok, archer.out.error, archer.budget, archer.meta, archer.pools, archer.conditions, arrow.ok, arrow.error, arrow.damage?.expression, arrowBudget, heal.ok, heal.error, chaliceHp, floor.result.total, arrow10.damage?.expression, change.ok, change.error, changed]);
    return {
      "wild-shape-use": () => {
        assert.equal(archer.out.ok, true, archer.out.error);
        assert.equal(archer.pools[0]?.used, 1, `taking a starry form left Wild Shape at ${brief(archer.pools[0])} and spent a counter of its own, ${brief(archer.pools[1])}: a Stars druid has both pools whole, two forms and two shapes a short rest`);
      },
      "10-minutes": () => assert.equal(archer.meta?.rounds, 100, brief(archer.conditions)),
      archer: () => {
        assert.equal(arrow.ok, true, arrow.error);
        assert.equal(arrow.damage?.total, 5 + wis(2), `the arrow rolled ${arrow.damage?.expression}`);
        assert.ok(arrowBudget?.bonusUsed === true && arrowBudget?.actionUsed !== true, `it cost ${brief(arrowBudget, 100)}`);
      },
      chalice: () => {
        assert.equal(heal.ok, true, heal.error);
        assert.ok(chaliceHp[1] > 50 || chaliceHp[2] > 100, `the druid's Cure Wounds healed one ally to ${chaliceHp[0]} and the other stands at ${chaliceHp[1]}`);
      },
      dragon: () => assert.equal(floor.result.total, 10, `an Arcana check on a 3 (Intelligence +0) totalled ${floor.result.total}`),
      "2d8-at-10": () => assert.equal(rig.diceIn(arrow10.damage, 8), 2, `at 10th level the arrow rolled ${arrow10.damage?.expression ?? arrow10.error}`),
      "dragon-fly-at-10": () => assert.equal(changed.speeds?.fly, 20, `after changing to the Dragon at 10th level the druid's speeds read ${brief(changed.speeds)} (${changed.conditions}): ${change.error}`),
      "change-each-turn": () => assert.ok(change.ok && changed.pools[1]?.used === 1 && changed.conditions.filter((name) => /starry form/.test(name)).length === 1, `changing from the Archer to the Dragon on a later turn: ${change.ok ? `the druid carries ${changed.conditions.join(" and ")} at once, and the form's counter reads ${brief(changed.pools[1])}` : change.error}`),
    };
  },

  "druid::Cosmic Omen": async (rig) => {
    const facts = await rig.counterFacts("druid", "Circle of Stars", 6, "sub_cosmic_omen");
    return {
      uses: () => assert.equal(facts.max, profOf(6), `${facts.max} uses at 6th level (proficiency +3, Wisdom +${wis(6)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "druid::Full of Stars": async (rig) => {
    const who = rig.hero("druid", "Circle of Stars", 14);
    const taken = {};
    await rig.damage(who, 10, "slashing");
    taken.plain = 100 - rig.hp(who);
    const form = await rig.spend(who, "Starry Form", { variant: "archer" });
    const held = rig.authored.activeAuthored(rig.world.sheet(who.id), "resist").map((entry) => entry.held.feature);
    for (const type of ["slashing", "piercing", "bludgeoning", "fire"]) {
      rig.world.patch(who.id, { currentHp: 100 });
      await rig.damage(who, 10, type);
      taken[type] = 100 - rig.hp(who);
    }
    rig.note("stars", [form.ok, form.error, rig.conditions(who), held, taken, rig.world.sheet(who.id).features.map((feature) => feature.name).filter((name) => /star/i.test(name))]);
    return { resist: () => assert.deepEqual(taken, { plain: 10, slashing: 5, piercing: 5, bludgeoning: 5, fire: 10 }, `10 slashing out of the form, then 10 of each type in it (${rig.conditions(who)}) took ${brief(taken)}; the resistances the authored layer reads: [${held}]`) };
  },

  "druid::Summon Wildfire Spirit": async (rig) => {
    const who = rig.hero("druid", "Circle of Wildfire", 2);
    const [foe] = await rig.fight(who);
    const before = ids(rig);
    const tokens = rig.kit.map() ? JSON.stringify(rig.world.sheet(who.id).pets ?? null) : "";
    const out = await rig.spend(who, "Summon Wildfire Spirit");
    const made = newSheets(rig, before);
    const state = { pets: JSON.stringify(rig.world.sheet(who.id).pets ?? null), took: 300 - rig.enemy(foe.id).currentHp, order: rig.world.encounter().order.length };
    rig.note("spirit", [out.ok, out.error, brief(out.result), made.length, tokens, state]);
    return {
      companion: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(made.length > 0 || state.pets !== tokens, `the use is spent and the druid carries the condition "wildfire spirit"; no creature joined the table (new sheets ${made.length}, pets ${state.pets}): nothing acts on the druid's turn, and nothing was burned around its arrival (the goblin 5 feet off lost ${state.took})`);
      },
    };
  },

  "druid::Cauterizing Flames": async (rig) => {
    const who = rig.hero("druid", "Circle of Wildfire", 10);
    const friend = rig.hero("cleric", "Life Domain", 10);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 6, 5);
    rig.world.patch(friend.id, { currentHp: 50 });
    rig.foesTurn(foe);
    const burn = await rig.spend(who, "Cauterizing Flames", { variant: "burn", targetEnemyId: foe.id }, [5, 5]);
    const burned = 300 - rig.enemy(foe.id).currentHp;
    rig.foesTurn(foe);
    const heal = await rig.spend(who, "Cauterizing Flames", { variant: "heal", targetCharacterId: friend.id }, [5, 5]);
    const healed = rig.hp(friend) - 50;
    rig.note("flames", [burn.ok, burn.error, burned, heal.ok, heal.error, healed]);
    rig.reset();
    const facts = await rig.counterFacts("druid", "Circle of Wildfire", 10, "sub_cauterizing_flames");
    return {
      amount: () => assert.deepEqual([burned, healed], [10 + wis(10), 10 + wis(10)], "2d10 (two 5s) + Wisdom, burned and healed"),
      uses: () => assert.equal(facts.max, profOf(10), `${facts.max} uses at 10th level (proficiency +4, Wisdom +${wis(10)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "druid::Blazing Revival": async (rig) => {
    const facts = await rig.counterFacts("druid", "Circle of Wildfire", 14, "sub_blazing_revival");
    return { "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]) };
  },
};
