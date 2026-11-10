// Probes for the read-only clauses of the cleric's Knowledge, Light, Tempest,
// Trickery, War and Death domains in the divine clause ledger
// (scripts/clauses/divine.json): clauses nobody had run a check for. Each
// scene stages one feature and answers with a check for each such clause
// (scripts/lib/sweep-clauses-divine.mjs). Keys are "ro::<ledger key>" so they
// never meet the scenes of scripts/lib/sweep-clauses-divine-cleric-a.mjs.
import { assert } from "./sweep-clauses-divine.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);

// One request to a route module, as { status, json } (enforce-campaign.mjs
// call, copied: importing that file changes the storyteller every scene runs
// with).
async function callRoute(mod, method, body, params = {}) {
  const request = new Request("http://test/", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  return { status: response.status, json };
}

// The rolls waiting on a choice after the d20 (src/lib/dm/after-roll.ts), and
// a choice made on one as the sheet's player.
export async function afterRoll(rig) {
  const { listOpenPendingRolls, getPendingRoll } = await rig.load("lib/db/dm-turns.ts");
  const route = await rig.world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
  const open = () => listOpenPendingRolls(rig.world.campaignId);
  const offered = () => open().flatMap((pending) => (pending.thrown?.options ?? []).map((option) => option.id));
  const choose = async (as, body, faces = []) => {
    const [pending] = open();
    if (!pending) return { status: 0, json: { error: "nothing waits" } };
    rig.world.signIn({ id: rig.world.sheet(as.id).userId });
    rig.world.clearDice();
    if (faces.length) rig.world.dice(...faces);
    const out = await callRoute(route, "POST", body, { campaignId: rig.world.campaignId, pendingRollId: pending.id });
    rig.world.clearDice();
    return { ...out, pending: getPendingRoll(pending.id) };
  };
  return { open, offered, choose };
}

const lost = (rig, foe, from = 300) => from - rig.enemy(foe.id).currentHp;

export const RO_CLERIC_A = {
  "ro::cleric::Channel Divinity: Read Thoughts": async (rig) => {
    const who = rig.hero("cleric", "Knowledge Domain", 6);
    const [foe] = await rig.fight(who);
    const out = await rig.channel(who, "read thoughts", { targetEnemyId: foe.id }, [1]);
    const marks = { foe: rig.enemy(foe.id).conditionMeta ?? {}, cleric: rig.world.sheet(who.id).conditionMeta ?? {} };
    const minute = Object.entries({ ...marks.foe, ...marks.cleric }).find(([name, meta]) => /thought/i.test(name) && meta?.rounds === 10);
    rig.note("read", [out.ok, out.error, brief(out.result, 300), marks]);
    return {
      minute: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(minute, `after Read Thoughts on a creature that failed its save, nothing on the table holds the reading for a minute (10 rounds): the creature carries ${brief(marks.foe)}, the cleric ${brief(marks.cleric)}`);
      },
    };
  },

  "ro::cleric::Visions of the Past": async (rig) => {
    const who = rig.hero("cleric", "Knowledge Domain", 17);
    const out = await rig.spend(who, "Visions of the Past", { variant: "surroundings" });
    const used = rig.res(who, "sub_visions_of_the_past")?.used ?? null;
    const again = await rig.spend(who, "Visions of the Past", { variant: "object" });
    const usedAgain = rig.res(who, "sub_visions_of_the_past")?.used ?? null;
    rig.note("visions", [out.ok, out.error, brief(out.result, 200), used, again.ok, again.error, usedAgain]);
    return {
      surroundings: () => {
        assert.equal(out.ok, true, `the reading of the surroundings: ${out.error}`);
        assert.equal(used, 1, `the reading of the surroundings left ${used} of the one use spent`);
        assert.equal(again.ok, false, "a reading of an object was taken after the reading of the surroundings, on the same rest");
        assert.equal(usedAgain, 1);
      },
    };
  },

  "ro::cleric::Channel Divinity: Radiance of the Dawn": async (rig) => {
    // The DC is 8 + 2 + 5 = 15; the save die is a 5 and the 2d10 two 5s.
    const burn = async (saveMods) => {
      rig.reset();
      const who = rig.hero("cleric", "Light Domain", 2);
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: { saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, ...saveMods } } });
      const out = await rig.channel(who, "radiance of the dawn", {}, [5, 5, 5, 5]);
      const save = rig.lastRolls(6).find((roll) => roll.kind === "saving_throw");
      return { out, took: lost(rig, foe), save: save ? { ability: save.ability, detail: save.detail, total: save.total } : null };
    };
    const sturdy = await burn({ con: 10, dex: -5 });
    const nimble = await burn({ con: -5, dex: 10 });
    rig.note("radiance", { sturdy: [sturdy.out.ok, sturdy.out.error, sturdy.took, sturdy.save], nimble: [nimble.out.ok, nimble.took, nimble.save] });
    return {
      "con-save": () => {
        assert.equal(sturdy.out.ok, true, sturdy.out.error);
        assert.equal(sturdy.took, 6, `a creature with Constitution +10 (and Dexterity -5) rolled a 5 against DC 15 and took ${sturdy.took}: half of 12 is 6`);
        assert.equal(nimble.took, 12, `a creature with Constitution -5 (and Dexterity +10) rolled a 5 and took ${nimble.took}: a failed Constitution save takes all 12`);
      },
    };
  },

  "ro::cleric::Improved Flare": async (rig) => {
    // The cleric at (5,5); the ally `apart` squares east, the creature beside the ally.
    const stage = async (apart, attacked = true) => {
      rig.reset();
      const who = rig.hero("cleric", "Light Domain", 6);
      const friend = rig.hero("cleric", "Life Domain", 6);
      const [foe] = await rig.fight(who);
      rig.kit.place(friend.id, 5 + apart, 5);
      rig.kit.place(foe.id, 5 + apart, 6);
      rig.foesTurn(foe);
      if (attacked) await rig.enemyHits(foe, friend, [16, 4]);
      const hurt = rig.hp(friend);
      const out = await rig.react(who, "Warding Flare", { targetCharacterId: friend.id }, [3]);
      return { out, hurt, after: rig.hp(friend), used: rig.res(who, "sub_warding_flare")?.used ?? null };
    };
    const near = await stage(6);
    const far = await stage(7);
    const calm = await stage(6, false);
    rig.note("flare", { near: [near.out.ok, near.out.error, near.hurt, near.after], far: [far.out.ok, far.out.error, far.used], calm: [calm.out.ok, calm.out.error, calm.used] });
    return {
      "30-feet": () => {
        assert.equal(near.out.ok, true, `an ally 30 feet away was hit: ${near.out.error}`);
        assert.deepEqual([near.hurt, near.after], [94, 100], "the flare on the ally 30 feet away turns the hit (the second die, a 3, misses)");
        assert.equal(far.out.ok, false, "a hit on an ally 35 feet away was flared");
        assert.equal(calm.out.ok, false, `an ally nobody attacked was flared: ${brief(calm.out.result, 160)}`);
      },
    };
  },

  "ro::cleric::Wrath of the Storm": async (rig) => {
    // The DC is 8 + 2 + 5 = 15; the creature saves on Dexterity +10.
    const stage = async ({ apart = 1, attack = null, faces = [16, 4] } = {}) => {
      rig.reset();
      const who = rig.hero("cleric", "Tempest Domain", 1);
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: { saveMods: { str: 0, dex: 10, con: -5, int: 0, wis: 0, cha: 0 }, ...(attack ? { attacks: [attack] } : {}) } });
      rig.kit.place(foe.id, 5, 5 + apart);
      rig.foesTurn(foe);
      const hit = await rig.enemyHits(foe, who, faces);
      const hurt = 100 - rig.hp(who);
      const out = await rig.react(who, "Wrath of the Storm", { targetEnemyId: foe.id }, [5, 5, 5]);
      return { out, hurt, took: lost(rig, foe), hit: hit.result?.hit ?? hit.error };
    };
    const melee = await stage();
    const ranged = await stage({ apart: 6, attack: { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" } });
    const missed = await stage({ faces: [2, 4] });
    rig.note("wrath", { melee: [melee.out.ok, melee.out.error, melee.hurt, melee.took], ranged: [ranged.hit, ranged.hurt, ranged.out.ok, ranged.out.error], missed: [missed.hit, missed.out.ok, missed.out.error] });
    return {
      "melee-dex": () => {
        assert.equal(melee.out.ok, true, melee.out.error);
        assert.equal(melee.took, 5, `a creature with Dexterity +10 (Constitution -5) rolled a 5 against DC 15 and took ${melee.took}: half of 2d8 (two 5s)`);
        assert.ok(ranged.hurt > 0, `the staged shot from 30 feet did not hit: ${brief(ranged.hit)}`);
        assert.equal(ranged.out.ok, false, "a ranged hit from 30 feet away was answered");
        assert.equal(missed.out.ok, false, "a miss was answered");
      },
    };
  },

  "ro::cleric::Channel Divinity: Destructive Wrath": async (rig) => {
    const who = rig.hero("cleric", "Tempest Domain", 3, { spells: { prepared: ["Shatter"], cantrips: ["Sacred Flame"] } });
    const [foe] = await rig.fight(who);
    const held = await rig.channel(who, "destructive wrath");
    const flame = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Sacred Flame", saveAbility: "dex" }, [1, 1]);
    const radiant = lost(rig, foe);
    rig.kit.freshTurn();
    const shatter = await rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Shatter", level: 2 }, [1, 1, 1, 1]);
    const thunder = lost(rig, foe) - radiant;
    rig.note("wrath", [held.ok, held.error, brief(held.result, 160), flame.ok, flame.error, radiant, shatter.ok, shatter.error, thunder, rig.res(who, "channel_divinity")]);
    return {
      maximum: () => {
        assert.equal(held.ok, true, held.error);
        assert.equal(shatter.ok, true, shatter.error);
        assert.equal(thunder, 24, `Shatter's 3d8 thunder (three 1s rolled) took ${thunder} with Destructive Wrath held: its maximum is 24`);
        assert.equal(radiant, 1, `Sacred Flame's radiant 1d8 (a 1) took ${radiant}: radiant damage is not lightning or thunder`);
      },
    };
  },

  "ro::cleric::Improved Duplicity": async (rig) => {
    const { summonsOf } = await rig.load("lib/dm/summon-store.ts");
    const who = rig.hero("cleric", "Trickery Domain", 17);
    await rig.fight(who);
    const out = await rig.channel(who, "invoke duplicity");
    const meta = rig.world.sheet(who.id).conditionMeta ?? {};
    const zones = rig.world.encounter()?.zones ?? rig.kit.map()?.zones ?? [];
    const doubles = summonsOf(rig.world.campaignId, who.id).length;
    const counted = Object.values(meta).map((entry) => entry?.count ?? entry?.duplicates ?? 0);
    rig.note("duplicity", [out.ok, out.error, brief(out.result, 300), meta, brief(zones), doubles]);
    return {
      four: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(doubles === 4 || counted.includes(4) || (Array.isArray(zones) && zones.filter((zone) => /duplicat|illusion/i.test(JSON.stringify(zone))).length === 4), `at 17th level Invoke Duplicity leaves no four duplicates on the table: ${doubles} summons, condition meta ${brief(meta)}, zones ${brief(zones, 120)}`);
      },
    };
  },

  "ro::cleric::Channel Divinity: Guided Strike": async (rig) => {
    const pend = await afterRoll(rig);
    const who = rig.hero("cleric", "War Domain", 2);
    const [foe] = await rig.fight(who);
    // AC 25: a 12 + 5 misses, and with +10 hits.
    rig.kit.setEnemy(foe.id, { ac: 25 });
    const swing = await rig.kit.swing(who.id, foe.id, [12]);
    const offered = pend.offered();
    const before = lost(rig, foe);
    const usedBefore = rig.res(who, "channel_divinity").used;
    const chose = await pend.choose(who, { use: "guided_strike" }, [4]);
    rig.note("guided", [swing.ok, swing.error, brief(swing.result, 200), offered, before, usedBefore, chose.status, brief(chose.json, 200), lost(rig, foe)]);
    return {
      "plus-ten": () => {
        assert.ok(offered.includes("guided_strike"), `a miss by 8 was not offered Guided Strike: ${brief(offered)} (${brief(swing.result, 160)})`);
        assert.deepEqual([before, usedBefore], [0, 0], "the roll was judged or the use spent before the choice");
        assert.equal(chose.status, 200, brief(chose.json));
        assert.equal(rig.res(who, "channel_divinity").used, 1);
        assert.equal(lost(rig, foe), 7, `with +10 the 17 became 27 against AC 25, and the hit took ${lost(rig, foe)}: the longsword's 4 + 3`);
      },
    };
  },

  "ro::cleric::Channel Divinity: War God's Blessing": async (rig) => {
    const pend = await afterRoll(rig);
    const who = rig.hero("cleric", "War Domain", 6);
    const friend = rig.hero("cleric", "Life Domain", 6);
    const [foe] = await rig.fight(friend);
    rig.kit.setEnemy(foe.id, { ac: 25 });
    rig.kit.place(who.id, 8, 5);
    const { subscribe } = await rig.load("lib/events.ts");
    const leave = subscribe(rig.world.campaignId, () => {}, rig.world.sheet(who.id).userId);
    // A 12 + 3 + 3 = 18 misses AC 25; with +10 it is 28.
    const swing = await rig.kit.swing(friend.id, foe.id, [12]);
    const offered = pend.offered();
    const blessed = await pend.choose(who, { use: "war_gods_blessing", by: who.id }, [4]);
    const left = pend.open().length ? await pend.choose(friend, { keep: true }, [4]) : null;
    leave();
    const attack = rig.lastRolls(12).find((roll) => roll.kind === "attack" && roll.characterId === friend.id);
    const state = { reacted: rig.reacted(who), friendReacted: rig.reacted(friend), used: rig.res(who, "channel_divinity").used, took: lost(rig, foe), total: attack?.total };
    rig.note("blessing", [swing.ok, swing.error, offered, blessed.status, brief(blessed.json, 200), left?.status, state]);
    return {
      reaction: () => {
        assert.ok(offered.includes("war_gods_blessing"), `the ally's miss did not offer War God's Blessing: ${brief(offered)}`);
        assert.equal(blessed.status, 200, brief(blessed.json));
        assert.deepEqual([state.reacted, state.friendReacted, state.used], [true, false, 1], "the cleric's reaction and a use of Channel Divinity pay for it, not the ally's reaction");
      },
      "plus-ten": () => {
        assert.equal(blessed.status, 200, brief(blessed.json));
        assert.equal(state.took, 7, `the ally's 18 with +10 is 28 against AC 25, and the hit took ${state.took} (attack roll total ${state.total})`);
      },
    };
  },

  "ro::cleric::Channel Divinity: Touch of Death": async (rig) => {
    const pend = await afterRoll(rig);
    const who = rig.hero("cleric", "Death Domain", 2, { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Longbow", qty: 1, equipped: true }, { name: "Arrow", qty: 20 }] });
    const [foe] = await rig.fight(who);
    rig.kit.place(foe.id, 5, 9);
    const shot = await rig.kit.swing(who.id, foe.id, [15, 3], { weapon: "Longbow" });
    const shotOffered = pend.offered();
    if (pend.open().length) await pend.choose(who, { keep: true }, [3]);
    const fromShot = lost(rig, foe);
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 6);
    const swing = await rig.kit.swing(who.id, foe.id, [15], { weapon: "Longsword" });
    const offered = pend.offered();
    const chose = await pend.choose(who, { use: "touch_of_death" }, [4]);
    const fromSwing = lost(rig, foe) - fromShot;
    rig.note("touch", [shot.ok, shot.error, shotOffered, fromShot, swing.ok, swing.error, offered, chose.status, brief(chose.json, 160), fromSwing]);
    return {
      necrotic: () => {
        assert.ok(offered.includes("touch_of_death"), `the melee hit offered ${brief(offered)}`);
        assert.equal(chose.status, 200, brief(chose.json));
        assert.equal(fromSwing, 4 + 3 + 5 + 2 * 2, `the melee hit took ${fromSwing}: the longsword's 4 + 3 and 5 + twice the cleric level (9) necrotic`);
        assert.ok(!shotOffered.includes("touch_of_death"), "a ranged hit offered Touch of Death");
      },
    };
  },

  "ro::cleric::Improved Reaper": async (rig) => {
    // Both creatures beside the cleric at (5,5): (5,6) and (6,6) are 5 feet
    // apart, (4,6) and (6,6) 10. A save spell goes through cast_at_enemy, an
    // attack-roll spell through pc_attack (cast_at_enemy sends it there).
    const stage = async ([x1, x2], cast) => {
      rig.reset();
      const who = rig.hero("cleric", "Death Domain", 17, { spells: { prepared: ["Inflict Wounds", "Blindness/Deafness", "Hold Person"] } });
      rig.setUsed(who, "channel_divinity", rig.res(who, "channel_divinity").max);
      const [first, second] = await rig.fight(who, { enemies: 2 });
      rig.kit.place(first.id, x1, 6);
      rig.kit.place(second.id, x2, 6);
      const out = await cast(who, first, second);
      const marked = (foe) => rig.enemy(foe.id).conditions.filter((name) => /blind|deaf|paralyz/i.test(name)).length > 0;
      return { out, hurt: [lost(rig, first), lost(rig, second)], marked: [marked(first), marked(second)] };
    };
    const saveSpell = (spell, level, ability) => (who, first, second) =>
      rig.call("cast_at_enemy", { characterId: who.id, targetEnemyId: first.id, secondTargetEnemyId: second.id, spell, level, saveAbility: ability }, [1, 1]);
    const blind = await stage([5, 6], saveSpell("Blindness/Deafness", 2, "con"));
    const apart = await stage([4, 6], saveSpell("Blindness/Deafness", 2, "con"));
    const held = await stage([5, 6], saveSpell("Hold Person", 2, "wis"));
    const touch = await stage([5, 6], (who, first, second) => rig.kit.swing(who.id, first.id, [18, 5, 5, 5, 18, 5, 5, 5], { spell: "Inflict Wounds", level: 1, secondTargetEnemyId: second.id }));
    rig.note("reaper", { blind: [blind.out.ok, blind.out.error, blind.marked], apart: [apart.out.ok, apart.out.error, apart.marked], held: [held.out.ok, held.out.error, held.marked], touch: [touch.out.ok, touch.out.error, touch.hurt] });
    return {
      "two-targets": () => {
        assert.equal(blind.out.ok, true, blind.out.error);
        assert.deepEqual(blind.marked, [true, true], "Blindness/Deafness (necromancy, 2nd level) cast at two creatures 5 feet apart, both failing");
        assert.deepEqual(touch.hurt, [15, 15], `Inflict Wounds (necromancy, 1st level, an attack roll) at two creatures 5 feet apart took ${brief(touch.hurt)}: three 5s each`);
        assert.equal(apart.out.ok && apart.marked[1], false, "a second creature 10 feet from the first was struck");
        assert.equal(held.out.ok && held.marked[1], false, "Hold Person, an enchantment, struck a second creature");
      },
    };
  },
};

