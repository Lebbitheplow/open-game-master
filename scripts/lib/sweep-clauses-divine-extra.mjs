// The scenes of the clause ledger for the features of the divine slice the
// other five helpers do not stage: the artificer's specialists and a few
// cleric, paladin and ranger features with a number a run can read
// (scripts/clauses/divine.json). See scripts/lib/sweep-clauses-divine.mjs for
// how a scene answers its clauses.
import { assert, modOf, castingScore } from "./sweep-clauses-divine.mjs";

const brief = (value, length = 200) => JSON.stringify(value)?.slice(0, length);
const intOf = (level) => modOf(castingScore(level));

// The tool or armor training a feature gives, as the creation door reads it.
const training = (subclass, level, field, wanted) => async (rig) => {
  const got = rig.trained("artificer", subclass, level).proficiencies;
  return { training: () => assert.ok(wanted.every((name) => got[field].includes(name)), `${field}: ${brief(got[field])}`) };
};

// Damage of each type taken from 100 hit points, one blow at a time.
async function takes(rig, who, blows) {
  const out = {};
  for (const [label, amount, type, extra] of blows) {
    rig.world.patch(who.id, { currentHp: 100 });
    await rig.damage(who, amount, type, extra ?? {});
    out[label] = 100 - rig.hp(who);
  }
  return out;
}

// Two swings in one Attack action at 5th level: the second is the extra one.
const extraAttack = (subclass) => async (rig) => {
  const who = rig.hero("artificer", subclass, 5);
  const [foe] = await rig.fight(who);
  const one = await rig.kit.swing(who.id, foe.id, [18, 4]);
  const two = await rig.kit.swing(who.id, foe.id, [18, 4]);
  const three = await rig.kit.swing(who.id, foe.id, [18, 4]);
  rig.note("swings", [one.ok, one.error, two.ok, two.error, three.ok, rig.budget()]);
  return {
    twice: () => {
      assert.equal(one.ok && two.ok, true, two.error || one.error);
      assert.equal(three.ok, false, "a third attack was taken in the same Attack action");
    },
  };
};

export const EXTRA = {
  "artificer::Tool Proficiency (Alchemist)": training("Alchemist", 3, "tools", ["alchemist's supplies"]),
  "artificer::Tool Proficiency (Armorer)": training("Armorer", 3, "tools", ["smith's tools"]),
  "artificer::Tool Proficiency (Artillerist)": training("Artillerist", 3, "tools", ["woodcarver's tools"]),
  "artificer::Tool Proficiency (Battle Smith)": training("Battle Smith", 3, "tools", ["smith's tools"]),

  "artificer::Battle Ready": async (rig) => {
    const got = rig.trained("artificer", "Battle Smith", 3).proficiencies;
    return { martial: () => assert.ok(got.weapons.includes("martial"), brief(got.weapons)) };
  },

  "artificer::Extra Attack@Armorer": extraAttack("Armorer"),
  "artificer::Extra Attack@Battle Smith": extraAttack("Battle Smith"),

  "artificer::Experimental Elixir": async (rig) => {
    const sizes = [];
    for (const level of [3, 6, 15]) sizes.push(rig.res(rig.hero("artificer", "Alchemist", level), "art_experimental_elixir")?.max ?? null);
    rig.reset();
    const facts = await rig.counterFacts("artificer", "Alchemist", 3, "art_experimental_elixir");
    return {
      count: () => assert.deepEqual(sizes, [1, 2, 3], "elixirs brewed at 3rd, 6th and 15th level"),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "artificer::Restorative Reagents": async (rig) => {
    const facts = await rig.counterFacts("artificer", "Alchemist", 9, "art_restorative_reagents");
    return {
      uses: () => assert.equal(facts.max, intOf(9), `${facts.max} free castings at 9th level (Intelligence +${intOf(9)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "artificer::Chemical Mastery": async (rig) => {
    const who = rig.hero("artificer", "Alchemist", 15);
    const taken = await takes(rig, who, [["acid", 10, "acid"], ["poison", 10, "poison"], ["fire", 10, "fire"]]);
    const poisoned = await rig.call("set_condition", { characterId: who.id, condition: "poisoned", rounds: 10, reason: "a clause check" });
    const held = rig.conditions(who).includes("poisoned");
    rig.note("mastery", [taken, poisoned.ok, poisoned.error, held]);
    return {
      resist: () => assert.deepEqual(taken, { acid: 5, poison: 5, fire: 10 }),
      immune: () => assert.equal(held, false, `the poisoned condition was laid on the alchemist (${poisoned.ok ? "accepted" : poisoned.error})`),
    };
  },

  "artificer::Eldritch Cannon": async (rig) => {
    const facts = await rig.counterFacts("artificer", "Artillerist", 3, "sub_eldritch_cannon");
    return { "long-rest": () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [1, 1, 0]) };
  },

  "artificer::Arcane Jolt": async (rig) => {
    const facts = await rig.counterFacts("artificer", "Battle Smith", 9, "art_arcane_jolt");
    return {
      uses: () => assert.equal(facts.max, intOf(9), `${facts.max} uses at 9th level (Intelligence +${intOf(9)})`),
      "long-rest": () => assert.deepEqual([facts.afterShort, facts.afterLong], [facts.max, 0]),
    };
  },

  "artificer::Steel Defender": async (rig) => {
    const { summonsOf } = await rig.load("lib/dm/summon-store.ts");
    const defenderOf = async (level) => {
      rig.reset();
      const who = rig.hero("artificer", "Battle Smith", level);
      const out = await rig.spend(who, "Steel Defender");
      // The defender is a summon: a sheet of its own beside the artificer's.
      const pet = summonsOf(rig.world.campaignId, who.id)[0] ?? null;
      return { out, pet };
    };
    const low = await defenderOf(3);
    const high = await defenderOf(15);
    rig.note("defender", [low.out.ok, low.out.error, brief(low.pet, 400), brief(high.pet, 200)]);
    const hpOf = (pet) => pet?.maxHp ?? pet?.hp;
    return {
      "hit-points": () => assert.equal(hpOf(low.pet), 2 + intOf(3) + 5 * 3, `the defender's hit points at 3rd level: ${hpOf(low.pet)} (${low.out.ok ? "summoned" : low.out.error})`),
      ac: () => assert.equal(low.pet?.ac, 15, `the defender's AC: ${low.pet?.ac}`),
      "improved-ac": () => assert.equal(high.pet?.ac, 17, `the defender's AC at 15th level: ${high.pet?.ac}`),
    };
  },

  "cleric::Soul of the Forge": async (rig) => {
    const who = rig.hero("cleric", "Forge Domain", 6);
    const taken = await takes(rig, who, [["fire", 10, "fire"], ["cold", 10, "cold"]]);
    return { fire: () => assert.deepEqual(taken, { fire: 5, cold: 10 }) };
  },

  "paladin::Unyielding Spirit": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Crown", 15);
    const dice = [];
    for (const against of ["paralyzed", "stunned", "poisoned"]) dice.push(rig.d20s((await rig.save(who, "con", { against })).result));
    return { advantage: () => assert.deepEqual(dice, [2, 2, 1], "saves against being paralyzed, stunned and poisoned") };
  },

  "ranger::Iron Mind": async (rig) => {
    const plain = rig.trained("ranger", "Gloom Stalker", 7).proficiencies.saves;
    const grant = rig.grantOf("ranger", "Gloom Stalker", 7, "Iron Mind");
    rig.note("iron mind", [plain, grant]);
    return { wisdom: () => assert.ok(plain.includes("wis"), `saves: ${brief(plain)}`) };
  },
};
