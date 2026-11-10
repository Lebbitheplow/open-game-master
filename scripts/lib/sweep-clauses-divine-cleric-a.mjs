// The scenes of the clause ledger for the cleric's Knowledge, Light, Nature,
// Tempest, Trickery, War and Death domains (scripts/clauses/divine.json).
// One scene stages a feature once and answers with a check for each clause
// that names it (scripts/lib/sweep-clauses-divine.mjs).
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";

const sorted = (list) => [...(list ?? [])].sort();
const feet = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;

// A Divine Strike of one domain: the longsword's d8 (a 4) and the strike's
// d8 (a 5) against a creature immune to slashing, so only what the strike
// deals in a type of its own goes through.
export function divineStrike(domain, types) {
  return async (rig) => {
    const low = rig.hero("cleric", domain, 8);
    // No Channel Divinity left: a Tempest or Death cleric's hit would wait on
    // its card (Destructive Wrath, Touch of Death) otherwise.
    rig.setUsed(low, "channel_divinity", rig.res(low, "channel_divinity").max);
    const [foe] = await rig.fight(low);
    const first = await rig.kit.swing(low.id, foe.id, [18, 4, 5]);
    rig.kit.saveEncounter({ ...rig.world.encounter(), turnBudget: { ...rig.budget(), actionUsed: false, attacksMade: 0 } });
    const second = await rig.kit.swing(low.id, foe.id, [18, 4, 5]);
    // A new turn against a creature immune to the blade: the strike alone lands.
    rig.kit.freshTurn();
    rig.kit.setEnemy(foe.id, { currentHp: 300, stats: { immune: "slashing" } });
    const typed = await rig.kit.swing(low.id, foe.id, [18, 4, 5]);
    const afterTyped = rig.enemy(foe.id).currentHp;
    rig.kit.freshTurn();
    rig.kit.setEnemy(foe.id, { currentHp: 300, stats: { immune: ["slashing", ...types].join(", ") } });
    await rig.kit.swing(low.id, foe.id, [18, 4, 5]);
    const afterStopped = rig.enemy(foe.id).currentHp;
    rig.reset();
    const high = rig.hero("cleric", domain, 14);
    rig.setUsed(high, "channel_divinity", rig.res(high, "channel_divinity").max);
    const [other] = await rig.fight(high);
    const risen = await rig.kit.swing(high.id, other.id, [18, 4, 5, 5]);
    rig.note("swings", { first: first.damage?.expression, second: second.damage?.expression ?? second.error, typed: 300 - afterTyped, stopped: 300 - afterStopped, risen: risen.damage?.expression, type: first.result.damageType, effects: first.result.conditionEffects });
    return {
      die: () => assert.equal(rig.diceIn(first.damage, 8), 2, `a level 8 hit rolled ${first.damage?.expression ?? first.error}: the longsword's d8 and one more`),
      "once-a-turn": () => {
        assert.equal(second.ok, true, second.error);
        assert.equal(rig.diceIn(second.damage, 8), 1, `the second hit of the turn rolled ${second.damage?.expression}`);
      },
      type: () => {
        if (types.length) {
          assert.equal(300 - afterTyped, 5, `against a creature immune to slashing the hit took ${300 - afterTyped} hit points: the strike's own 5 (${types.join(", ")}) should land alone`);
          assert.equal(300 - afterStopped, 0, `against a creature immune to slashing and ${types.join(", ")} the hit still took ${300 - afterStopped} hit points`);
        } else {
          assert.equal(typed.ok, true, typed.error);
          assert.equal(300 - afterTyped, 0, `the strike deals the weapon's type, and a creature immune to slashing lost ${300 - afterTyped} hit points to a longsword`);
        }
      },
      "level-14": () => assert.equal(rig.diceIn(risen.damage, 8), 3, `a level 14 hit rolled ${risen.damage?.expression ?? risen.error}: the longsword's d8 and two more`),
    };
  };
}

// Potent Spellcasting: Sacred Flame's 2d8 at 8th level (two 5s) on a failed save.
export function potentSpellcasting(domain) {
  return async (rig) => {
    const who = rig.hero("cleric", domain, 8, { spells: { cantrips: ["Sacred Flame"] } });
    const [foe] = await rig.fight(who);
    const cast = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Sacred Flame", saveAbility: "dex" }, [1, 5, 5]);
    const plain = rig.hero("cleric", domain, 7, { spells: { cantrips: ["Sacred Flame"] } });
    const [other] = await rig.fight(plain);
    const before = await rig.call("cast_at_enemy", { characterId: plain.id, targetEnemyId: other.id, spell: "Sacred Flame", saveAbility: "dex" }, [1, 5, 5]);
    return {
      wisdom: () => {
        assert.equal(cast.ok, true, cast.error);
        assert.equal(cast.result.damage, 10 + modOf(castingScore(8)), `Sacred Flame dealt ${cast.result.damage}: two 5s and the Wisdom modifier (+${modOf(castingScore(8))})`);
        assert.equal(before.result.damage, 10, `at 7th level, before the feature, Sacred Flame dealt ${before.result.damage}`);
      },
    };
  };
}

// The cantrips a feature gives on top of the class's own count: every door
// (the builder, the level-up, spell preparation) adds classSpellGrants'
// extraCantrips to the class table's number, and the subclass spell table
// names the ones known outright.
export async function extraCantrips(rig, classId, subclass, level) {
  const { classSpellGrants } = await rig.load("lib/srd/class-spell-grants.ts");
  const features = rig.features.classFeaturesFor ? [] : [];
  const grants = classSpellGrants({ classId, level, subclass, features });
  const table = rig.features.subclassSpellsFor(classId, subclass, level);
  return { count: grants.extraCantrips, anyList: grants.anyList, table, says: `classSpellGrants gives a ${subclass} ${classId} of level ${level} ${grants.extraCantrips} cantrips beyond the class table and ${grants.anyList} off-list picks, and the subclass spell table holds [${table.join(", ")}]` };
}

// A counter sized by the Wisdom modifier that only a long rest gives back.
export async function wisdomCounter(rig, domain, level, id) {
  const facts = await rig.counterFacts("cleric", domain, level, id);
  return {
    uses: () => assert.equal(facts.max, modOf(castingScore(level)), `${id} holds ${facts.max} uses at level ${level} with Wisdom +${modOf(castingScore(level))} (proficiency +${profOf(level)})`),
    "long-rest": () => {
      assert.equal(facts.afterShort, facts.max, `a short rest left ${facts.afterShort} of ${facts.max} spent`);
      assert.equal(facts.afterLong, 0, `a long rest left ${facts.afterLong} spent`);
    },
  };
}

export const CLERIC_A = {
  "cleric::Blessings of Knowledge": async (rig) => {
    const grant = rig.grantOf("cleric", "Knowledge Domain", 1, "Blessings of Knowledge");
    rig.note("grant", grant?.spec);
    return {
      languages: () => assert.equal(grant?.spec.languages, 2),
      skills: () => {
        assert.equal(grant?.spec.skills, 2);
        assert.deepEqual(sorted(grant.spec.skillsFrom), ["arcana", "history", "nature", "religion"]);
      },
      expertise: () => assert.equal(grant?.spec.pickedExpertise, true, "the two skills picked are not doubled"),
    };
  },

  "cleric::Channel Divinity: Knowledge of the Ages": async (rig) => {
    const who = rig.hero("cleric", "Knowledge Domain", 2, { proficiencies: { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] } });
    const before = await rig.check(who, "stealth", {}, [10]);
    const sheetBefore = JSON.stringify([rig.world.sheet(who.id).proficiencies, rig.conditions(who)]);
    const out = await rig.channel(who, "knowledge of the ages", { skill: "stealth" });
    const after = await rig.check(who, "stealth", {}, [10]);
    rig.note("spend", [out.ok, out.error, out.result]);
    return {
      proficiency: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(after.result.total - before.result.total, profOf(2), `a Stealth check rolled ${before.result.total} before the Channel Divinity and ${after.result.total} after it: the proficiency bonus is not added, and the sheet reads ${sheetBefore === JSON.stringify([rig.world.sheet(who.id).proficiencies, rig.conditions(who)]) ? "the same" : "changed"}; the result is ${JSON.stringify(out.result).slice(0, 160)}`);
      },
    };
  },

  "cleric::Channel Divinity: Read Thoughts": async (rig) => {
    const who = rig.hero("cleric", "Knowledge Domain", 6, { spells: { prepared: ["Suggestion"] } });
    const [foe] = await rig.fight(who);
    const out = await rig.channel(who, "read thoughts", { targetEnemyId: foe.id }, [1]);
    rig.kit.freshTurn();
    const used = () => rig.world.sheet(who.id).spellcasting.slots["2"].used;
    const before = used();
    const cast = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Suggestion", saveAbility: "wis", level: 2 }, [1]);
    rig.note("calls", { channel: [out.ok, out.error, out.result], cast: [cast.ok, cast.error, cast.result], foe: rig.enemy(foe.id).conditions });
    return {
      "free-suggestion": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(cast.ok, true, cast.error);
        assert.equal(used() - before, 0, `after Read Thoughts on the creature, Suggestion cast at it spent a 2nd-level slot (${before} used before, ${used()} after); the Channel Divinity result is ${JSON.stringify(out.result).slice(0, 160)}`);
      },
    };
  },

  "cleric::Potent Spellcasting@Knowledge Domain": potentSpellcasting("Knowledge Domain"),
  "cleric::Potent Spellcasting@Light Domain": potentSpellcasting("Light Domain"),

  "cleric::Visions of the Past": async (rig) => {
    const facts = await rig.counterFacts("cleric", "Knowledge Domain", 17, "sub_visions_of_the_past");
    return {
      rest: () => {
        assert.equal(facts.max, 1);
        assert.equal(facts.afterShort, 0, "a short rest gives the use back");
        assert.equal(facts.afterLong, 0);
      },
    };
  },

  "cleric::Bonus Cantrip (Light)": async (rig) => {
    const table = rig.features.subclassSpellsFor("cleric", "Light Domain", 1);
    return { known: () => assert.ok(table.includes("Light"), `the Light Domain's spells at 1st level: ${table}`) };
  },

  "cleric::Warding Flare": async (rig) => {
    const who = rig.hero("cleric", "Light Domain", 1);
    const [foe] = await rig.fight(who);
    rig.foesTurn(foe);
    const hit = await rig.enemyHits(foe, who, [16, 4]);
    const hurt = rig.hp(who);
    const out = await rig.react(who, "Warding Flare", {}, [3]);
    const flared = { reacted: rig.reacted(who), used: rig.res(who, "sub_warding_flare")?.used, hp: rig.hp(who) };
    rig.note("flare", [hit.result, out.ok, out.error, out.result, flared]);
    rig.reset();
    const counter = await wisdomCounter(rig, "Light Domain", 1, "sub_warding_flare");
    return {
      reaction: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(flared.reacted, true, "the reaction was not taken");
        assert.equal(flared.used, 1);
      },
      disadvantage: () => {
        assert.equal(hurt, 94, "the staged club should have hit for 6");
        assert.match(String(out.result.applied), /disadvantage/);
        assert.equal(flared.hp, 100, `the second die (a 3) misses AC 12, and the cleric stands at ${flared.hp}`);
      },
      ...counter,
    };
  },

  "cleric::Channel Divinity: Radiance of the Dawn": async (rig) => {
    const who = rig.hero("cleric", "Light Domain", 2);
    const friend = rig.hero("cleric", "Life Domain", 2);
    const [near, far] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(friend.id, 6, 5);
    rig.kit.place(far.id, 12, 5);
    const out = await rig.channel(who, "radiance of the dawn", {}, [5, 5, 5, 5]);
    rig.note("radiance", [out.ok, out.error, out.result, out.rolled.map((die) => `${die.face}/d${die.sides}`)]);
    return {
      amount: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(300 - rig.enemy(near.id).currentHp, 5 + 5 + 2, `a failed save took ${300 - rig.enemy(near.id).currentHp}: 2d10 (two 5s) + cleric level 2`);
      },
      "30-feet": () => assert.equal(rig.enemy(far.id).currentHp, 300, "a creature 35 feet off was burned"),
      hostile: () => assert.equal(rig.hp(friend), 100, "the ally beside the cleric was burned"),
    };
  },

  "cleric::Improved Flare": async (rig) => {
    const who = rig.hero("cleric", "Light Domain", 6);
    const friend = rig.hero("cleric", "Life Domain", 6);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 6, 6);
    rig.world.patch(friend.id, { conditions: ["invisible"], conditionMeta: { invisible: { rounds: 10 } } });
    rig.foesTurn(foe);
    const hit = await rig.enemyHits(foe, friend, [16, 16, 4]);
    const out = await rig.react(who, "Warding Flare", { targetCharacterId: friend.id }, [3]);
    rig.note("unseen ally", [hit.ok, hit.error, hit.result, out.ok, out.error, out.result]);
    return {
      "ally-seen": () => {
        assert.equal(hit.result.hit, true, `the staged hit on the invisible ally: ${JSON.stringify(hit.result).slice(0, 200)}`);
        assert.equal(out.ok, false, `Warding Flare answered a hit on an ally the cleric cannot see (invisible): ${JSON.stringify(out.result).slice(0, 200)}`);
      },
    };
  },

  "cleric::Corona of Light": async (rig) => {
    const who = rig.hero("cleric", "Light Domain", 17, { spells: { cantrips: ["Sacred Flame", "Poison Spray"] } });
    const [foe] = await rig.fight(who);
    const before = rig.res(who, "channel_divinity").used;
    const out = await rig.spend(who, "Corona of Light");
    const lit = { used: rig.res(who, "channel_divinity").used, meta: rig.meta(who, "corona of light"), budget: rig.budget() };
    const saveOf = async (spell, ability) => {
      rig.kit.freshTurn();
      const cast = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell, saveAbility: ability }, [18, 3, 5, 5, 5, 5]);
      const roll = rig.lastRolls(6).find((entry) => entry.kind === "saving_throw" && entry.detail.includes(spell));
      return { cast, dice: rig.diceIn(roll, 20), advantage: roll?.advantage };
    };
    const radiant = await saveOf("Sacred Flame", "dex");
    const poison = await saveOf("Poison Spray", "con");
    rig.note("corona", [out.ok, out.error, out.result, lit, radiant.cast.error, radiant.dice, poison.cast.error, poison.dice]);
    return {
      minute: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(lit.meta?.rounds, 10);
      },
      "no-cost-stated": () => assert.equal(lit.used - before, 0, `the aura took a use of Channel Divinity (${before} used before, ${lit.used} after); neither the feature's words nor the published feature make it a Channel Divinity option`),
      "radiant-save": () => assert.equal(radiant.dice, 2, `the creature saved against Sacred Flame (radiant) on ${radiant.dice} d20`),
      "other-spells": () => {
        assert.equal(poison.cast.ok, true, poison.cast.error);
        assert.equal(poison.dice, 1, `the creature saved against Poison Spray, neither fire nor radiant, on ${poison.dice} d20 (${poison.advantage})`);
      },
    };
  },

  "cleric::Acolyte of Nature": async (rig) => {
    const grant = rig.grantOf("cleric", "Nature Domain", 1, "Acolyte of Nature");
    const extra = await extraCantrips(rig, "cleric", "Nature Domain", 1);
    return {
      skill: () => {
        assert.equal(grant?.spec.skills, 1);
        assert.deepEqual(sorted(grant.spec.skillsFrom), ["animal_handling", "nature", "survival"]);
      },
      cantrip: () => assert.ok(extra.count >= 1, extra.says),
    };
  },

  "cleric::Bonus Proficiency (heavy armor)": async (rig) => {
    const got = rig.trained("cleric", "Nature Domain", 1).proficiencies;
    return { armor: () => assert.ok(got.armor.includes("heavy"), `armor: ${got.armor}`) };
  },

  "cleric::Channel Divinity: Charm Animals and Plants": async (rig) => {
    const who = rig.hero("cleric", "Nature Domain", 2);
    const [near, far] = await rig.fight(who, { enemies: 2, stats: { type: "beast" } });
    rig.kit.place(far.id, 12, 5);
    const out = await rig.channel(who, "charm animals and plants", {}, [1, 1]);
    const state = { near: rig.enemy(near.id), far: rig.enemy(far.id) };
    rig.note("charm", [out.ok, out.error, out.result, state.near.conditions, state.near.conditionMeta, state.far.conditions]);
    return {
      "30-feet": () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(state.near.conditions.includes("charmed"), "the beast beside the cleric failed and is not charmed");
        assert.ok(!state.far.conditions.includes("charmed"), "a beast 35 feet off was charmed");
      },
      minute: () => assert.equal(state.near.conditionMeta?.charmed?.rounds, 10, `the charm is kept for ${JSON.stringify(state.near.conditionMeta?.charmed)}`),
    };
  },

  "cleric::Dampen Elements": async (rig) => {
    const who = rig.hero("cleric", "Nature Domain", 6);
    const friend = rig.hero("cleric", "Life Domain", 6);
    const [foe] = await rig.fight(friend);
    rig.kit.setEnemy(foe.id, { stats: { attacks: [{ name: "Fire Lash", toHit: 4, damage: "1d6+2", type: "fire" }] } });
    rig.kit.place(who.id, 12, 5);
    rig.foesTurn(foe);
    await rig.enemyHits(foe, friend, [16, 4]);
    const farOut = await rig.react(who, "Dampen Elements", { targetCharacterId: friend.id });
    const farHp = rig.hp(friend);
    rig.kit.place(who.id, 11, 5);
    rig.foesTurn(foe);
    await rig.enemyHits(foe, friend, [16, 4]);
    const hurt = rig.hp(friend);
    const nearOut = await rig.react(who, "Dampen Elements", { targetCharacterId: friend.id });
    const nearHp = rig.hp(friend);
    rig.kit.setEnemy(foe.id, { stats: { attacks: [{ name: "Club", toHit: 4, damage: "1d6+2", type: "bludgeoning" }] } });
    rig.foesTurn(foe);
    await rig.enemyHits(foe, friend, [16, 4]);
    const clubOut = await rig.react(who, "Dampen Elements", { targetCharacterId: friend.id });
    rig.note("dampen", [farOut.ok, farOut.error, farHp, nearOut.ok, nearOut.error, hurt, nearHp, clubOut.ok, clubOut.error]);
    return {
      "30-feet": () => {
        assert.equal(farOut.ok, false, `an ally 35 feet away was covered: ${JSON.stringify(farOut.result).slice(0, 160)}`);
        assert.equal(nearOut.ok, true, `an ally 30 feet away: ${nearOut.error}`);
        assert.equal(nearHp - hurt, 3, "half of the 6 fire comes back");
      },
      types: () => assert.equal(clubOut.ok, false, `a bludgeoning hit was dampened: ${JSON.stringify(clubOut.result).slice(0, 160)}`),
    };
  },

  "cleric::Divine Strike@Nature Domain": divineStrike("Nature Domain", ["cold", "fire", "lightning"]),
  "cleric::Divine Strike@Tempest Domain": divineStrike("Tempest Domain", ["thunder"]),
  "cleric::Divine Strike@Trickery Domain": divineStrike("Trickery Domain", ["poison"]),
  "cleric::Divine Strike@War Domain": divineStrike("War Domain", []),
  "cleric::Divine Strike@Death Domain": divineStrike("Death Domain", ["necrotic"]),

  "cleric::Bonus Proficiencies (Tempest)": async (rig) => {
    const got = rig.trained("cleric", "Tempest Domain", 1).proficiencies;
    return { training: () => assert.ok(got.armor.includes("heavy") && got.weapons.includes("martial"), JSON.stringify(got)) };
  },
  "cleric::Bonus Proficiencies (War)": async (rig) => {
    const got = rig.trained("cleric", "War Domain", 1).proficiencies;
    return { training: () => assert.ok(got.armor.includes("heavy") && got.weapons.includes("martial"), JSON.stringify(got)) };
  },
  "cleric::Bonus Proficiency (martial weapons)": async (rig) => {
    const got = rig.trained("cleric", "Death Domain", 1).proficiencies;
    return { training: () => assert.ok(got.weapons.includes("martial") && !got.armor.includes("heavy"), JSON.stringify(got)) };
  },

  "cleric::Wrath of the Storm": async (rig) => {
    const who = rig.hero("cleric", "Tempest Domain", 1);
    const [foe] = await rig.fight(who);
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [16, 4]);
    const out = await rig.react(who, "Wrath of the Storm", { targetEnemyId: foe.id }, [5, 5, 1]);
    const took = 300 - rig.enemy(foe.id).currentHp;
    const state = { reacted: rig.reacted(who), took };
    rig.note("wrath", [out.ok, out.error, out.result, state]);
    rig.reset();
    const counter = await wisdomCounter(rig, "Tempest Domain", 1, "sub_wrath_of_the_storm");
    return {
      reaction: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(state.reacted, true);
        assert.equal(state.took, 10, `a failed save took ${state.took}: 2d8 (two 5s)`);
      },
      ...counter,
    };
  },

  "cleric::Thunderbolt Strike": async (rig) => {
    const who = rig.hero("cleric", "Tempest Domain", 6);
    const [foe] = await rig.fight(who);
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [16, 4]);
    const before = rig.kit.token(foe.id);
    const out = await rig.react(who, "Wrath of the Storm", { targetEnemyId: foe.id, variant: "lightning" }, [1, 5, 5]);
    const after = rig.kit.token(foe.id);
    rig.note("push", [out.ok, out.error, out.result, [before.x, before.y], [after.x, after.y]]);
    return {
      push: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(300 - rig.enemy(foe.id).currentHp > 0, "the lightning dealt nothing");
        assert.equal(feet(after, rig.kit.token(who.id)), 15, `the creature the lightning struck stands ${feet(after, rig.kit.token(who.id))} feet from the cleric, where it stood (${before.x},${before.y}); the row is narrated: "Pushing a Large or smaller creature 10 feet after lightning damage is a move_token (forced) the GM makes."`);
      },
    };
  },

  "cleric::Stormborn": async (rig) => {
    const who = rig.hero("cleric", "Tempest Domain", 17);
    const derived = rig.srd.computeSheetDerived(rig.world.sheet(who.id));
    const below = rig.srd.computeSheetDerived(rig.world.sheet(rig.hero("cleric", "Tempest Domain", 16).id));
    rig.note("speeds", [derived.speeds, below.speeds]);
    return {
      fly: () => {
        assert.equal(derived.speeds?.fly, 30, `speeds: ${JSON.stringify(derived.speeds)}`);
        assert.equal(below.speeds?.fly ?? 0, 0, "a 16th-level Tempest cleric flies");
      },
    };
  },

  "cleric::Blessing of the Trickster": async (rig) => {
    const who = rig.hero("cleric", "Trickery Domain", 1);
    const friend = rig.hero("cleric", "Life Domain", 1);
    const far = rig.hero("cleric", "Life Domain", 1);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 6, 5);
    rig.kit.place(far.id, 15, 5);
    const self = await rig.spend(who, "Blessing of the Trickster", { targetCharacterId: who.id });
    const reach = await rig.spend(who, "Blessing of the Trickster", { targetCharacterId: far.id });
    const farHas = rig.has(far, "blessing of the trickster");
    rig.kit.freshTurn();
    const out = await rig.spend(who, "Blessing of the Trickster", { targetCharacterId: friend.id });
    const state = { meta: rig.meta(friend, "blessing of the trickster"), budget: rig.budget() };
    const stealth = await rig.check(friend, "stealth");
    const other = await rig.check(friend, "perception");
    rig.note("trickster", [self.ok, self.error, reach.ok, reach.error, farHas, out.ok, out.error, state, foe.id]);
    return {
      touch: () => assert.equal(reach.ok && farHas, false, "a creature 50 feet away was blessed by touch"),
      willing: () => assert.equal(self.ok, true, `the cleric, a willing creature, is refused: ${self.error}`),
      stealth: () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(rig.d20s(stealth.result), 2, "the blessed creature's Stealth check");
        assert.equal(rig.d20s(other.result), 1, "its Perception check");
      },
      hour: () => assert.equal(state.meta?.rounds, 600),
    };
  },

  "cleric::Channel Divinity: Invoke Duplicity": async (rig) => {
    const who = rig.hero("cleric", "Trickery Domain", 2);
    const [foe] = await rig.fight(who);
    const before = JSON.stringify([rig.conditions(who), rig.world.encounter().zones ?? null]);
    const out = await rig.channel(who, "invoke duplicity");
    const after = JSON.stringify([rig.conditions(who), rig.world.encounter().zones ?? null]);
    rig.kit.freshTurn();
    const swing = await rig.kit.swing(who.id, foe.id, [15, 15, 4]);
    rig.note("duplicity", [out.ok, out.error, out.result, before, after, swing.toHit?.advantage, swing.error]);
    return {
      double: () => {
        assert.equal(out.ok, true, out.error);
        assert.notEqual(after, before, `the use is spent and nothing stands on the table for the double: no condition, no zone; the result is ${JSON.stringify(out.result).slice(0, 200)}`);
      },
      advantage: () => assert.equal(swing.toHit?.advantage, "advantage", `with the double invoked and the creature within 5 feet of the cleric, the attack rolled with ${swing.toHit?.advantage ?? swing.error}`),
    };
  },

  "cleric::Channel Divinity: Cloak of Shadows": async (rig) => {
    const who = rig.hero("cleric", "Trickery Domain", 6, { spells: { cantrips: ["Sacred Flame"] } });
    const [foe] = await rig.fight(who);
    const out = await rig.channel(who, "cloak of shadows");
    const cloaked = rig.conditions(who).includes("invisible");
    rig.kit.freshTurn();
    const cast = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Sacred Flame", saveAbility: "dex" }, [1, 5, 5]);
    rig.note("cloak", [out.ok, out.error, cloaked, cast.ok, cast.error, rig.conditions(who)]);
    return {
      cast: () => {
        assert.equal(out.ok && cloaked, true, out.error);
        assert.equal(cast.ok, true, cast.error);
        assert.ok(!rig.conditions(who).includes("invisible"), "the cleric cast Sacred Flame and is still invisible");
      },
    };
  },

  "cleric::War Priest": async (rig) => wisdomCounter(rig, "War Domain", 1, "sub_war_priest"),

  "cleric::Channel Divinity: War God's Blessing": async (rig) => {
    const who = rig.hero("cleric", "War Domain", 6);
    const friend = rig.hero("cleric", "Life Domain", 6);
    const [foe] = await rig.fight(friend);
    rig.kit.setEnemy(foe.id, { ac: 25 });
    // The cleric's player is at the table: a roll does not wait on an absent
    // one (chronal-shift.ts playerAtTable).
    const { subscribe } = await rig.load("lib/events.ts");
    const leave = subscribe(rig.world.campaignId, () => {}, rig.world.sheet(who.id).userId);
    const { listOpenPendingRolls } = await rig.load("lib/db/dm-turns.ts");
    const waiting = () => listOpenPendingRolls(rig.world.campaignId).filter((pending) => (pending.thrown?.options ?? []).some((option) => option.id === "war_gods_blessing")).length;
    rig.kit.place(who.id, 12, 5);
    const far = await rig.kit.swing(friend.id, foe.id, [12, 4]);
    const farWaits = waiting();
    rig.kit.freshTurn();
    rig.kit.place(who.id, 11, 5);
    const near = await rig.kit.swing(friend.id, foe.id, [12, 4]);
    const nearWaits = waiting();
    leave();
    rig.note("blessing", [far.ok, far.error, far.result, farWaits, near.ok, near.error, near.result, nearWaits]);
    return {
      "30-feet": () => {
        assert.equal(farWaits, 0, `an ally's miss 35 feet from the cleric waits on War God's Blessing: ${JSON.stringify(far.result).slice(0, 240)}`);
        assert.equal(nearWaits, 1, `an ally's miss 30 feet from the cleric does not wait on War God's Blessing: ${JSON.stringify(near.result).slice(0, 240)}`);
      },
    };
  },

  "cleric::Avatar of Battle": async (rig) => {
    const who = rig.hero("cleric", "War Domain", 17);
    const taken = {};
    for (const type of ["bludgeoning", "piercing", "slashing"]) {
      rig.world.patch(who.id, { currentHp: 100 });
      await rig.damage(who, 10, type);
      taken[type] = 100 - rig.hp(who);
    }
    rig.world.patch(who.id, { currentHp: 100 });
    await rig.damage(who, 10, "slashing", { magical: true });
    taken.magical = 100 - rig.hp(who);
    rig.world.patch(who.id, { currentHp: 100 });
    await rig.damage(who, 10, "fire");
    taken.fire = 100 - rig.hp(who);
    return {
      resist: () => assert.deepEqual(taken, { bludgeoning: 5, piercing: 5, slashing: 5, magical: 10, fire: 10 }),
    };
  },

  "cleric::Reaper": async (rig) => {
    const who = rig.hero("cleric", "Death Domain", 1, { spells: { cantrips: ["Chill Touch", "Sacred Flame"] } });
    const [first, second] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(first.id, 5, 8);
    rig.kit.place(second.id, 6, 8);
    const twin = await rig.kit.swing(who.id, first.id, [18, 5, 18, 5], { spell: "Chill Touch", secondTargetEnemyId: second.id });
    let hurt = [300 - rig.enemy(first.id).currentHp, 300 - rig.enemy(second.id).currentHp];
    // The other door a cantrip is cast by, for the creature the first left alone.
    rig.kit.freshTurn();
    const byCast = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: first.id, secondTargetEnemyId: second.id, spell: "Chill Touch" }, [18, 5, 18, 5]);
    const castHurt = 300 - rig.enemy(second.id).currentHp - hurt[1];
    rig.note("by cast_at_enemy", [byCast.ok, byCast.error, byCast.result, castHurt]);
    hurt = [300 - rig.enemy(first.id).currentHp, 300 - rig.enemy(second.id).currentHp];
    rig.kit.freshTurn();
    rig.kit.place(second.id, 8, 8);
    const apart = await rig.kit.swing(who.id, first.id, [18, 5, 18, 5], { spell: "Chill Touch", secondTargetEnemyId: second.id });
    const apartHurt = 300 - rig.enemy(second.id).currentHp - hurt[1];
    rig.kit.freshTurn();
    rig.kit.place(second.id, 6, 8);
    const flame = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: first.id, secondTargetEnemyId: second.id, spell: "Sacred Flame", saveAbility: "dex" }, [1, 5, 1, 5]);
    const flameHurt = 300 - rig.enemy(second.id).currentHp - hurt[1] - apartHurt;
    const extra = await extraCantrips(rig, "cleric", "Death Domain", 1);
    rig.note("reaper", [twin.ok, twin.error, twin.result, hurt, apart.ok, apart.error, apartHurt, flame.ok, flame.error, flameHurt, extra.says]);
    return {
      second: () => {
        assert.equal(twin.ok, true, twin.error);
        assert.ok(hurt[0] > 0 && hurt[1] > 0, `Chill Touch, the SRD's one necromancy cantrip that deals damage, took ${hurt[0]} from the first creature and ${hurt[1]} from the one beside it named as the second, by pc_attack and by cast_at_enemy (${byCast.ok ? "accepted" : byCast.error})`);
      },
      learn: () => assert.ok(extra.count >= 1, `${extra.says}; the row's note: "The necromancy cantrip it teaches is picked with the cleric's cantrips."`),
      // The limit only shows where the second strike lands at all.
      "5-feet": () => {
        assert.ok(hurt[1] > 0, "the second creature beside the first is never struck, so the 5-foot limit cannot be seen");
        assert.equal(apart.ok && apartHurt > 0, false, "a second creature 10 feet from the first was struck");
      },
      necromancy: () => assert.equal(flame.ok && flameHurt > 0, false, "Sacred Flame, an evocation cantrip, struck a second creature"),
    };
  },

  "cleric::Inescapable Destruction": async (rig) => {
    const who = rig.hero("cleric", "Death Domain", 8);
    rig.setUsed(who, "channel_divinity", rig.res(who, "channel_divinity").max);
    const [foe] = await rig.fight(who);
    rig.kit.setEnemy(foe.id, { stats: { immune: "slashing", resist: "necrotic" } });
    const swing = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    const took = 300 - rig.enemy(foe.id).currentHp;
    rig.note("strike", [swing.ok, swing.error, swing.result, took]);
    return {
      "weapon-rider": () => assert.equal(took, 5, `Divine Strike's 5 necrotic against a creature that resists necrotic took ${took}`),
    };
  },
};
