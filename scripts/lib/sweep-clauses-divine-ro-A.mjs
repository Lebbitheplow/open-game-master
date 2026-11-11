// Probes for the read-only clauses of the paladin's Oaths of the Ancients,
// Vengeance, Conquest and Redemption (scripts/clauses/divine.json): clauses
// nobody had run a check for. Each scene stages the feature and answers with
// one check per clause. See scripts/lib/sweep-clauses-divine.mjs for the rig.
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";
import { call as callRoute } from "./enforce-campaign.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);
const cha = (level) => modOf(castingScore(level));
// Every save of a dummy at +0 but the ones named: a save rolled with the
// wrong ability shows as the other outcome.
export const saveMods = (mods = {}) => ({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, ...mods });

// The save a call made the table roll: the newest one that was not there before.
export async function saveMadeBy(rig, run) {
  const before = new Set(rig.lastRolls(40).map((roll) => roll.id));
  const out = await run();
  const roll = rig.lastRolls(40).find((entry) => !before.has(entry.id) && entry.kind === "saving_throw") ?? null;
  return { out, roll };
}

// A Channel Divinity a creature saves against, thrown twice at one dummy 5
// feet off whose saves are all +0 but `mods`: on a 6 (16 with +10, a
// success against DC 15 at 3rd level) and on a 1 (11, a failure).
export async function savedOrNot(rig, oath, option, condition, { mods = { wis: 10 }, stats = {}, args = (foe) => ({ targetEnemyId: foe.id }) } = {}) {
  const run = async (face) => {
    rig.reset();
    const who = rig.hero("paladin", oath, 3);
    const [foe] = await rig.fight(who);
    rig.kit.setEnemy(foe.id, { stats: { ...stats, saveMods: saveMods(mods) } });
    const { out, roll } = await saveMadeBy(rig, () => rig.channel(who, option, args(foe), [face, face]));
    const now = rig.enemy(foe.id);
    return { ok: out.ok, error: out.error, has: now.conditions.some((name) => name.includes(condition)), roll: roll ? { total: roll.total, detail: roll.detail } : null };
  };
  const made = await run(6);
  const failed = await run(1);
  rig.note(`${option} saves`, [made, failed]);
  return { made, failed };
}

const savesCheck = (seen, ability, condition) => () => {
  assert.equal(seen.failed.ok, true, seen.failed.error);
  assert.equal(seen.failed.has, true, `a creature that failed (a 1, +10 to ${ability}) is not ${condition}: ${brief(seen.failed.roll)}`);
  assert.equal(seen.made.has, false, `a creature at +10 to ${ability} that rolled a 6 (16 against DC 15) is still ${condition}: the save was ${brief(seen.made.roll)}`);
};

export const RO_PALADIN_A = {
  "ro::paladin::Channel Divinity: Nature's Wrath": async (rig) => {
    const str = await savedOrNot(rig, "Oath of the Ancients", "nature's wrath", "restrained", { mods: { str: 10 } });
    const dex = await savedOrNot(rig, "Oath of the Ancients", "nature's wrath", "restrained", { mods: { dex: 10 } });
    const wis = await savedOrNot(rig, "Oath of the Ancients", "nature's wrath", "restrained", { mods: { wis: 10 } });
    return {
      "str-or-dex": () => {
        assert.equal(str.failed.has, true, `a failed save left no restraint: ${brief(str.failed)}`);
        assert.deepEqual([str.made.has, dex.made.has], [false, false], `a creature at +10 to Strength, and one at +10 to Dexterity, rolled a 6: ${brief([str.made.roll, dex.made.roll])}`);
        assert.equal(wis.made.has, true, `a creature at +10 to Wisdom only, on a 6, escaped the vines: ${brief(wis.made.roll)}`);
      },
    };
  },

  "ro::paladin::Undying Sentinel": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Ancients", 15);
    rig.world.patch(who.id, { currentHp: 5 });
    await rig.damage(who, 30, "slashing");
    const held = rig.hp(who);
    rig.world.patch(who.id, { currentHp: 5 });
    await rig.damage(who, 30, "slashing");
    const again = rig.hp(who);
    rig.note("undying", [held, again, rig.res(who, "sub_undying_sentinel")]);
    return { "drop-to-1": () => assert.deepEqual([held, again], [1, 0], "30 slashing at 5 hit points, then again with the use spent") };
  },

  "ro::paladin::Elder Champion": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Ancients", 20, { spells: { prepared: ["Command"] } });
    const [foe] = await rig.fight(who);
    const opened = await rig.spend(who, "Elder Champion");
    const command = () => rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Command", saveAbility: "wis", level: 1 }, [18, 3]);
    const bonusCast = await command();
    const spent = rig.budget();
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 7);
    const { roll: at10 } = await saveMadeBy(rig, command);
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 8);
    const { roll: at15 } = await saveMadeBy(rig, command);
    rig.reset();
    const plain = rig.hero("paladin", "Oath of the Ancients", 20, { spells: { prepared: ["Command"] } });
    const [other] = await rig.fight(plain);
    await rig.kit.swing(plain.id, other.id, [2]);
    await rig.kit.swing(plain.id, other.id, [2]);
    const refused = await rig.call("cast_at_enemy", { characterId: plain.id, targetEnemyId: other.id, spell: "Command", saveAbility: "wis", level: 1 }, [18, 3]);
    rig.note("elder", [opened.ok, opened.error, bonusCast.ok, bonusCast.error, spent, at10?.advantage, at15?.advantage, refused.ok, refused.error]);
    return {
      "bonus-cast-10-feet": () => {
        assert.equal(bonusCast.ok, true, `with the action spent on Elder Champion, Command was refused: ${bonusCast.error}`);
        assert.equal(spent?.bonusUsed, true, `the cast cost ${brief(spent)}`);
        assert.equal(refused.ok, false, "a paladin without Elder Champion cast Command with the action gone");
        assert.deepEqual([at10?.advantage, at15?.advantage], ["disadvantage", "none"], "a creature 10 feet away, and one 15 feet away");
      },
    };
  },

  "ro::paladin::Channel Divinity: Abjure Enemy": async (rig) => {
    const who = rig.hero("paladin", "Oath of Vengeance", 3);
    const [foe] = await rig.fight(who);
    rig.kit.place(foe.id, 5, 18);
    const far = await rig.channel(who, "abjure enemy", { targetEnemyId: foe.id }, [1]);
    const usedFar = rig.res(who, "channel_divinity")?.used;
    rig.kit.place(foe.id, 5, 17);
    const near = await rig.channel(who, "abjure enemy", { targetEnemyId: foe.id }, [1]);
    const scared = rig.enemy(foe.id).conditions.includes("frightened");
    rig.note("abjure", [far.ok, far.error, usedFar, near.ok, near.error, scared]);
    return {
      "60-feet": () => {
        assert.equal(far.ok, false, "a creature 65 feet away was abjured");
        assert.equal(usedFar, 0, "the refusal spent the use");
        assert.equal(near.ok, true, `a creature 60 feet away: ${near.error}`);
        assert.ok(scared, "the creature 60 feet away is not frightened");
      },
    };
  },

  "ro::paladin::Channel Divinity: Vow of Enmity": async (rig) => {
    const who = rig.hero("paladin", "Oath of Vengeance", 3);
    const [foe, other] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(foe.id, 5, 8);
    const far = await rig.channel(who, "vow of enmity", { targetEnemyId: foe.id });
    rig.kit.place(foe.id, 5, 7);
    const near = await rig.channel(who, "vow of enmity", { targetEnemyId: foe.id });
    const cost = rig.budget();
    rig.kit.place(foe.id, 5, 6);
    rig.kit.place(other.id, 6, 6);
    const vowed = await rig.kit.swing(who.id, foe.id, [15, 15, 4]);
    rig.kit.freshTurn();
    const plain = await rig.kit.swing(who.id, other.id, [15, 15, 4]);
    rig.note("vow", [far.ok, far.error, near.ok, near.error, cost, vowed.toHit?.advantage, plain.toHit?.advantage]);
    return {
      "bonus-advantage-10-feet": () => {
        assert.equal(far.ok, false, "a creature 15 feet away was vowed against");
        assert.equal(near.ok, true, `a creature 10 feet away: ${near.error}`);
        assert.ok(cost?.bonusUsed === true && cost?.actionUsed !== true, `the vow cost ${brief(cost)}`);
        assert.deepEqual([vowed.toHit?.advantage, plain.toHit?.advantage], ["advantage", "none"], "the vowed creature, and another");
      },
    };
  },

  "ro::paladin::Relentless Avenger": async (rig) => {
    const run = async (oaFaces) => {
      rig.reset();
      const who = rig.hero("paladin", "Oath of Vengeance", 7);
      const [foe, other] = await rig.fight(who, { enemies: 2 });
      rig.kit.place(other.id, 4, 4);
      rig.foesTurn(foe);
      rig.world.clearDice();
      rig.world.dice(...oaFaces);
      const fled = await rig.world.invoke("move_token", { token: foe.id, x: 5, y: 10 });
      rig.world.clearDice();
      const hitOa = 300 - rig.enemy(foe.id).currentHp;
      const tooFar = await rig.react(who, "Relentless Avenger", { x: 5, y: 9 });
      const before = rig.lastRolls(60).filter((roll) => roll.kind === "attack").length;
      const moved = await rig.react(who, "Relentless Avenger", { x: 5, y: 8 }, [18, 4]);
      const after = rig.lastRolls(60).filter((roll) => roll.kind === "attack").length;
      const at = rig.kit.token(who.id);
      return { fled: [fled.ok, fled.error], hitOa, tooFar: [tooFar.ok, tooFar.error], moved: [moved.ok, moved.error], at: { x: at.x, y: at.y }, provoked: after - before, hp: rig.hp(who) };
    };
    const hit = await run([18, 5, 5]);
    const miss = await run([2, 5, 5]);
    rig.note("relentless", [hit, miss]);
    return {
      "half-speed-no-provoke": () => {
        assert.ok(hit.hitOa > 0, `the opportunity attack did not hit: ${brief(hit)}`);
        assert.equal(hit.tooFar[0], false, "a move of 20 feet, past half of 30, was taken");
        assert.equal(hit.moved[0], true, `a move of 15 feet after the hit: ${hit.moved[1]}`);
        assert.deepEqual(hit.at, { x: 5, y: 8 });
        assert.deepEqual([hit.provoked, hit.hp], [0, 100], "leaving the reach of the creature beside them drew an attack");
        assert.equal(miss.moved[0], false, "a missed opportunity attack let the paladin move");
      },
    };
  },

  "ro::paladin::Soul of Vengeance": async (rig) => {
    const who = rig.hero("paladin", "Oath of Vengeance", 15);
    const [near, other] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(other.id, 6, 6);
    const vow = await rig.channel(who, "vow of enmity", { targetEnemyId: near.id });
    rig.foesTurn(near);
    const early = await rig.react(who, "Soul of Vengeance", { targetEnemyId: near.id }, [15, 3, 4, 4]);
    rig.foesTurn(other);
    await rig.enemyHits(other, who, [16, 4]);
    const wrong = await rig.react(who, "Soul of Vengeance", { targetEnemyId: near.id }, [15, 3, 4, 4]);
    rig.foesTurn(near);
    await rig.enemyHits(near, who, [16, 4]);
    const out = await rig.react(who, "Soul of Vengeance", { targetEnemyId: near.id }, [15, 3, 4, 4]);
    const took = 300 - rig.enemy(near.id).currentHp;
    const reacted = rig.reacted(who);
    rig.note("soul", [vow.ok, vow.error, early.ok, early.error, wrong.ok, wrong.error, out.ok, out.error, brief(out.result?.attack), took, reacted]);
    return {
      "reaction-attack": () => {
        assert.equal(early.ok, false, "it struck before the vowed creature attacked");
        assert.equal(wrong.ok, false, "it answered another creature's attack");
        assert.equal(out.ok, true, out.error);
        assert.ok(took > 0, `the vowed creature took ${took} from the melee attack`);
        assert.equal(reacted, true, "the reaction is spent");
      },
    };
  },

  "ro::paladin::Avenging Angel": async (rig) => {
    const who = rig.hero("paladin", "Oath of Vengeance", 20);
    const [at30, at35] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(at30.id, 5, 11);
    rig.kit.place(at35.id, 5, 12);
    const opened = await rig.spend(who, "Avenging Angel", {}, [1, 1]);
    const reach = [rig.enemy(at30.id).conditions.includes("frightened"), rig.enemy(at35.id).conditions.includes("frightened")];
    rig.reset();
    const again = rig.hero("paladin", "Oath of Vengeance", 20);
    const [late] = await rig.fight(again);
    rig.kit.place(late.id, 15, 5);
    await rig.spend(again, "Avenging Angel", {}, [1]);
    const outside = rig.enemy(late.id).conditions.includes("frightened");
    rig.kit.place(late.id, 5, 8);
    const before = new Set(rig.lastRolls(40).map((roll) => roll.id));
    rig.world.clearDice();
    rig.world.dice(1, 1, 1);
    rig.endTurnOf(again);
    rig.world.clearDice();
    const save = rig.lastRolls(40).find((roll) => !before.has(roll.id) && roll.kind === "saving_throw") ?? null;
    const started = rig.enemy(late.id).conditions;
    rig.note("angel aura", [opened.ok, opened.error, reach, outside, save?.detail, started, rig.pointer()]);
    return {
      "30-foot-aura": () => {
        assert.equal(opened.ok, true, opened.error);
        assert.deepEqual(reach, [true, false], "a creature 30 feet off that failed, and one 35 feet off");
      },
      "starts-its-turn": () => {
        assert.equal(outside, false);
        assert.ok(save && /wis/i.test(save.detail ?? ""), `a creature that started its turn 15 feet from the paladin was asked no Wisdom save (${save?.detail ?? "no save"})`);
        assert.ok(started.includes("frightened"), `on a 1 it carries ${brief(started)}`);
      },
    };
  },

  "ro::paladin::Channel Divinity: Conquering Presence": async (rig) => {
    const who = rig.hero("paladin", "Oath of Conquest", 3);
    const [seen, unseen] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(unseen.id, 6, 6);
    rig.kit.setEnemy(unseen.id, { conditions: ["invisible"] });
    const aimed = await rig.channel(who, "conquering presence", { targetEnemyIds: [unseen.id] }, [1, 1]);
    const usedAimed = rig.res(who, "channel_divinity")?.used;
    const all = await rig.channel(who, "conquering presence", {}, [1, 1]);
    const scared = [rig.enemy(seen.id).conditions.includes("frightened"), rig.enemy(unseen.id).conditions.includes("frightened")];
    rig.note("presence sight", [aimed.ok, aimed.error, usedAimed, all.ok, all.error, scared]);
    const wis = await savedOrNot(rig, "Oath of Conquest", "conquering presence", "frightened", { args: (foe) => ({ targetEnemyIds: [foe.id] }) });
    return {
      "you-can-see": () => {
        assert.equal(aimed.ok, false, "an invisible creature named was frightened");
        assert.equal(usedAimed, 0, "the refusal spent the use");
        assert.deepEqual(scared, [true, false], "with none named: the creature in sight, and the invisible one beside it");
      },
      "wisdom-save": savesCheck(wis, "Wisdom", "frightened"),
    };
  },

  "ro::paladin::Channel Divinity: Guided Strike": async (rig) => {
    const { listOpenPendingRolls, getPendingRoll } = await rig.load("lib/db/dm-turns.ts");
    const { getRoll } = await rig.load("lib/db/rolls.ts");
    const route = await rig.world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
    const who = rig.hero("paladin", "Oath of Conquest", 3);
    const [foe] = await rig.fight(who);
    // +5 to hit (Strength +3, proficiency +2) against AC 13: a 5 is 10, a miss by 3.
    await rig.kit.swing(who.id, foe.id, [5]);
    const offered = (listOpenPendingRolls(rig.world.campaignId)[0]?.thrown?.options ?? []).map((option) => option.id);
    const [pending] = listOpenPendingRolls(rig.world.campaignId);
    let total = null;
    let status = null;
    if (pending) {
      rig.world.signIn({ id: rig.world.sheet(who.id).userId });
      rig.world.dice(4);
      const out = await callRoute(route, "POST", { use: "guided_strike" }, { campaignId: rig.world.campaignId, pendingRollId: pending.id });
      rig.world.clearDice();
      status = out.status;
      total = getRoll(getPendingRoll(pending.id).rollId)?.total ?? null;
    }
    const used = rig.res(who, "channel_divinity")?.used;
    const took = 300 - rig.enemy(foe.id).currentHp;
    rig.kit.freshTurn();
    rig.kit.setEnemy(foe.id, { ac: 30 });
    await rig.kit.swing(who.id, foe.id, [5]);
    const hopeless = listOpenPendingRolls(rig.world.campaignId).length;
    rig.note("guided", [offered, status, total, used, took, hopeless]);
    return {
      "plus-10-after": () => {
        assert.deepEqual(offered, ["guided_strike"], "a miss by 3 offered nothing to choose after the roll");
        assert.equal(total, 20, `the roll of 10 stands at ${total} after Guided Strike`);
        assert.equal(used, 1, "the use of Channel Divinity");
        assert.equal(took, 4 + 3, `the turned miss dealt ${took}`);
        assert.equal(hopeless, 0, "a miss that 10 cannot turn (AC 30) waited for Guided Strike");
      },
    };
  },

  "ro::paladin::Channel Divinity: Emissary of Peace": async (rig) => {
    const who = rig.hero("paladin", "Oath of Redemption", 3);
    const before = (await rig.check(who, "persuasion", {}, [10])).result.total;
    const out = await rig.channel(who, "emissary of peace");
    const after = (await rig.check(who, "persuasion", {}, [10])).result.total;
    const other = (await rig.check(who, "deception", {}, [10])).result.total;
    rig.note("emissary", [before, out.ok, out.error, after, other]);
    return {
      "plus-5-persuasion": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual([after - before, other - before], [5, 0], `Persuasion on a 10 went ${before} to ${after}, Deception reads ${other}`);
      },
    };
  },

  "ro::paladin::Channel Divinity: Rebuke the Violent": async (rig) => {
    const run = async (mods, face) => {
      rig.reset();
      const who = rig.hero("paladin", "Oath of Redemption", 3);
      const friend = rig.hero("cleric", "Life Domain", 3);
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: { saveMods: saveMods(mods) } });
      rig.kit.place(friend.id, 7, 5);
      rig.kit.place(foe.id, 8, 5);
      rig.foesTurn(foe);
      await rig.enemyHits(foe, friend, [18, 4]);
      const dealt = 100 - rig.hp(friend);
      const { out, roll } = await saveMadeBy(rig, () => rig.react(who, "Rebuke the Violent", { targetCharacterId: friend.id }, [face]));
      return { out: [out.ok, out.error], dealt, back: 300 - rig.enemy(foe.id).currentHp, reacted: rig.reacted(who), roll: roll ? { total: roll.total, detail: roll.detail } : null };
    };
    const failed = await run({}, 2);
    const made = await run({ wis: 10 }, 6);
    const other = await run({ con: 10, cha: 10, dex: 10, str: 10, int: 10 }, 6);
    rig.note("rebuke", [failed, made, other]);
    return {
      "same-damage": () => {
        assert.equal(failed.out[0], true, failed.out[1]);
        assert.equal(failed.dealt, 6);
        assert.equal(failed.back, failed.dealt, `the ally took ${failed.dealt} and the attacker ${failed.back}`);
        assert.equal(failed.reacted, true, "the reaction is spent");
      },
      "wisdom-halves": () => {
        assert.equal(made.back, 3, `a creature at +10 to Wisdom that rolled a 6 (16 against DC 15) took ${made.back} of 6: ${brief(made.roll)}`);
        assert.equal(other.back, 6, `a creature at +10 to every save but Wisdom, on a 6, took ${other.back}`);
      },
    };
  },

  "ro::paladin::Protective Spirit": async (rig) => {
    const who = rig.hero("paladin", "Oath of Redemption", 15);
    await rig.fight(who);
    rig.world.patch(who.id, { currentHp: 40 });
    rig.world.clearDice();
    rig.world.dice(4);
    rig.endTurnOf(who);
    rig.world.clearDice();
    const now = rig.hp(who);
    rig.note("spirit", [now]);
    return { "1d6-half-level": () => assert.equal(now, 40 + 4 + Math.floor(15 / 2), `at 40 of 100 hit points the paladin ended a turn, the d6 a 4, and stands at ${now}`) };
  },
};

export { profOf, cha };
