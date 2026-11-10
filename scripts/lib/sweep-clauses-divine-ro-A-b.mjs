// Probes for the read-only clauses of the paladin's Oaths of Glory, the
// Watchers and the Crown, and the Oathbreaker (scripts/clauses/divine.json):
// clauses nobody had run a check for. See scripts/lib/sweep-clauses-divine.mjs
// for the rig, and sweep-clauses-divine-ro-A.mjs for the shared staging.
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";
import { saveMods, savedOrNot } from "./sweep-clauses-divine-ro-A.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);
const cha = (level) => modOf(castingScore(level));

const savesCheck = (seen, ability, condition) => () => {
  assert.equal(seen.failed.ok, true, seen.failed.error);
  assert.equal(seen.failed.has, true, `a creature that failed (a 1, +10 to ${ability}) is not ${condition}: ${brief(seen.failed.roll)}`);
  assert.equal(seen.made.has, false, `a creature at +10 to ${ability} that rolled a 6 (16 against DC 15) is still ${condition}: the save was ${brief(seen.made.roll)}`);
};

// A walk of `feet` straight down the board by `walker` on their own turn,
// with the Glory paladin `feetOff` beside them as the turn starts.
async function walkBeside(rig, level, feetOff, feet) {
  rig.reset();
  const who = rig.hero("paladin", "Oath of Glory", level);
  const friend = rig.hero("cleric", "Life Domain", level);
  const [foe] = await rig.fight(friend);
  rig.kit.place(foe.id, 15, 15);
  rig.kit.place(who.id, 5 - feetOff / 5, 5);
  rig.kit.giveTurn(friend.id);
  // giveTurn moves the pointer only; the engine starts a turn with the
  // pointer's turn-start hooks (condition-tick.ts startTurnConditions, as
  // advancePointer calls it), which is where "starts their turn within 5
  // feet" is read. Started here the same way.
  const { startTurnConditions } = await rig.load("lib/dm/condition-tick.ts");
  startTurnConditions(rig.world.campaign(), rig.world.encounter(), [friend.id]);
  // The player's own walk, as the board sends it.
  const route = await rig.world.route("campaigns/[campaignId]/battle-map/move");
  rig.world.signIn({ id: rig.world.sheet(friend.id).userId });
  const response = await route.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 5, y: 5 + feet / 5 }) }), {
    params: Promise.resolve({ campaignId: rig.world.campaignId }),
  });
  const body = await response.json();
  const at = rig.kit.token(friend.id);
  return { ok: response.status === 200 && at.y === 5 + feet / 5, error: response.status === 200 ? "" : JSON.stringify(body).slice(0, 300), at: { x: at.x, y: at.y } };
}

export const RO_PALADIN_B = {
  "ro::paladin::Channel Divinity: Peerless Athlete": async (rig) => {
    const { liftLimits } = await rig.load("lib/dm/load-rules.ts");
    const { buildPlayerMapView } = await rig.load("lib/battlemap/view.ts");
    const who = rig.hero("paladin", "Oath of Glory", 3);
    await rig.fight(who);
    const view = () => buildPlayerMapView(rig.world.campaignId, rig.world.sheet(who.id).userId)?.moves?.jumpFeet ?? null;
    const base = { carry: liftLimits(rig.world.sheet(who.id)).capacityLb, jump: view() };
    const out = await rig.channel(who, "peerless athlete");
    const now = { carry: liftLimits(rig.world.sheet(who.id)).capacityLb, jump: view() };
    const d20s = [];
    for (const skill of ["athletics", "acrobatics", "stealth"]) d20s.push(rig.d20s((await rig.check(who, skill, {}, [10, 10])).result));
    rig.note("athlete", [out.ok, out.error, base, now, d20s]);
    return {
      "adv-carry-jump": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual(d20s, [2, 2, 1], "Athletics and Acrobatics with advantage, Stealth without");
        assert.ok(now.carry > base.carry, `the carrying capacity reads ${now.carry} lb with Peerless Athlete, ${base.carry} lb without`);
        assert.equal(now.jump, (base.jump ?? 0) + 10, `the long jump reads ${now.jump} feet with Peerless Athlete, ${base.jump} without`);
      },
    };
  },

  "ro::paladin::Aura of Alacrity": async (rig) => {
    // The ally's own 30 feet, which the walk must take for the rest to mean anything.
    const own = await walkBeside(rig, 7, 5, 30);
    const near = await walkBeside(rig, 7, 5, 40);
    const apart = await walkBeside(rig, 7, 10, 40);
    const wide = await walkBeside(rig, 18, 10, 40);
    const wideApart = await walkBeside(rig, 18, 15, 40);
    rig.note("alacrity", [own, near, apart, wide, wideApart]);
    return {
      "allies-5-feet": () => {
        assert.equal(own.ok, true, `the ally's own 30 feet: ${own.error}`);
        assert.equal(near.ok, true, `an ally who started their turn 5 feet from the paladin walked 40 feet: ${near.error}`);
        assert.equal(apart.ok, false, "an ally 10 feet off walked 40 feet at 7th level");
      },
      "10-feet-at-18": () => {
        assert.equal(wide.ok, true, `at 18th level an ally 10 feet off walked 40 feet: ${wide.error}`);
        assert.equal(wideApart.ok, false, "at 18th level an ally 15 feet off walked 40 feet");
      },
    };
  },

  "ro::paladin::Glorious Defense": async (rig) => {
    const run = async (feetOff) => {
      rig.reset();
      const who = rig.hero("paladin", "Oath of Glory", 15);
      const friend = rig.hero("cleric", "Life Domain", 15);
      const [foe] = await rig.fight(who);
      const target = feetOff === 0 ? who : friend;
      if (feetOff) {
        rig.kit.place(friend.id, 5, 5 - feetOff / 5);
        rig.kit.place(foe.id, 5, 4 - feetOff / 5);
      }
      rig.foesTurn(foe);
      // A club at +4: a 10 is 14, through AC 12 and short of 12 + Charisma 4.
      await rig.enemyHits(foe, target, [10, 4]);
      const hurt = rig.hp(target);
      const out = await rig.react(who, "Glorious Defense", feetOff ? { targetCharacterId: friend.id } : {}, [15, 4, 4, 4]);
      return { ok: out.ok, error: out.error, hurt, hp: rig.hp(target), attack: out.result?.attack ?? null, foeTook: 300 - rig.enemy(foe.id).currentHp, used: rig.res(who, "sub_glorious_defense")?.used };
    };
    const self = await run(0);
    const ally = await run(10);
    const far = await run(15);
    rig.note("glorious", [self, ally, far]);
    return {
      "ac-and-strike": () => {
        assert.equal(self.ok, true, self.error);
        assert.ok(self.hurt < 100 && self.hp === 100, `the paladin was at ${self.hurt} after the hit and at ${self.hp} after the reaction`);
        assert.ok(self.attack && self.foeTook > 0, `the miss let the paladin strike back: ${brief(self.attack)}, the attacker took ${self.foeTook}`);
        assert.equal(ally.ok, true, ally.error);
        assert.equal(ally.hp, 100, "the ally 10 feet off was not covered");
        assert.deepEqual([far.ok, far.used], [false, 0], "an ally 15 feet off was covered, or the refusal spent a use");
      },
    };
  },

  "ro::paladin::Channel Divinity: Watcher's Will": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Watchers", 3);
    const friend = rig.hero("cleric", "Life Domain", 3);
    await rig.fight(who);
    rig.kit.place(friend.id, 5, 7);
    const out = await rig.channel(who, "watcher's will", { targetCharacterIds: [friend.id] });
    const dice = [];
    for (const [hero, ability] of [[who, "int"], [who, "wis"], [who, "cha"], [who, "dex"], [friend, "wis"], [friend, "str"]]) {
      dice.push(rig.d20s((await rig.save(hero, ability, {}, [10, 10])).result));
    }
    rig.note("watcher", [out.ok, out.error, dice, rig.conditions(friend)]);
    return {
      "int-wis-cha": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual(dice, [2, 2, 2, 1, 2, 1], "the paladin's Intelligence, Wisdom, Charisma and Dexterity saves, then the ally's Wisdom and Strength");
      },
    };
  },

  "ro::paladin::Channel Divinity: Abjure the Extraplanar": async (rig) => {
    const seen = await savedOrNot(rig, "Oath of the Watchers", "abjure the extraplanar", "turned", { stats: { type: "aberration" }, args: (foe) => ({ targetEnemyIds: [foe.id] }) });
    return { "wisdom-save": savesCheck(seen, "Wisdom", "turned") };
  },

  "ro::paladin::Aura of the Sentinel": async (rig) => {
    const run = async (feetOff) => {
      rig.reset();
      const who = rig.hero("paladin", "Oath of the Watchers", 18);
      const friend = rig.hero("cleric", "Life Domain", 18);
      await rig.fight(who);
      rig.kit.place(friend.id, 5, 5 + feetOff / 5);
      // The ally's place in the order taken back, as for a hero who has yet
      // to roll (scripts/lib/enforce-world.mjs beginFight asks them by hand),
      // so their initiative is rolled with the board laid out.
      const encounter = rig.world.encounter();
      rig.kit.saveEncounter({ ...encounter, order: encounter.order.filter((entry) => entry.characterId !== friend.id) });
      const out = await rig.call("request_roll", { characterId: friend.id, kind: "initiative", reason: "a fight" }, [10]);
      return { ok: out.ok, error: out.error, total: out.result?.total ?? null };
    };
    const near = await run(30);
    const far = await run(35);
    rig.note("sentinel 18", [near, far]);
    return {
      "30-feet-at-18": () => {
        assert.equal(near.total, 10 + 2 + profOf(18), `an ally 30 feet from an 18th-level paladin rolled initiative ${near.total} on a 10 (Dexterity +2): ${near.error}`);
        assert.equal(far.total, 12, `an ally 35 feet off rolled ${far.total}`);
      },
    };
  },

  "ro::paladin::Vigilant Rebuke": async (rig) => {
    const run = async (resist) => {
      rig.reset();
      const who = rig.hero("paladin", "Oath of the Watchers", 15);
      const friend = rig.hero("cleric", "Life Domain", 15);
      const [foe, other] = await rig.fight(who, { enemies: 2 });
      rig.kit.place(friend.id, 6, 5);
      rig.kit.place(other.id, 4, 6);
      if (resist) rig.kit.setEnemy(foe.id, { stats: { resist: "force" } });
      rig.foesTurn(foe);
      const forced = await rig.call("cast_at_player", { characterId: friend.id, casterEnemyId: foe.id, saveAbility: "wis", dc: 12, damage: "1d4" }, [19, 1]);
      const out = await rig.react(who, "Vigilant Rebuke", {}, [4, 4]);
      return { forced: [forced.ok, forced.error], out: [out.ok, out.error], took: 300 - rig.enemy(foe.id).currentHp, other: 300 - rig.enemy(other.id).currentHp, reacted: rig.reacted(who) };
    };
    const plain = await run(false);
    const resisted = await run(true);
    rig.note("vigilant", [plain, resisted]);
    return {
      "2d8-cha-force": () => {
        assert.equal(plain.out[0], true, plain.out[1]);
        assert.equal(plain.took, 4 + 4 + cha(15), `the creature that forced the save took ${plain.took}: 2d8 (two 4s) + Charisma ${cha(15)}`);
        assert.equal(plain.other, 0, "another creature was struck");
        assert.equal(resisted.took, Math.floor((8 + cha(15)) / 2), `a creature resisting force took ${resisted.took}`);
        assert.equal(plain.reacted, true, "the reaction is spent");
      },
    };
  },

  "ro::paladin::Channel Divinity: Champion Challenge": async (rig) => {
    const seen = await savedOrNot(rig, "Oath of the Crown", "champion challenge", "champion challenge", { args: (foe) => ({ targetEnemyIds: [foe.id] }) });
    return { "wisdom-save": savesCheck(seen, "Wisdom", "challenged") };
  },

  "ro::paladin::Channel Divinity: Turn the Tide": async (rig) => {
    const who = rig.hero("paladin", "Oath of the Crown", 3);
    const low = rig.hero("cleric", "Life Domain", 3);
    const high = rig.hero("cleric", "Life Domain", 3);
    const away = rig.hero("cleric", "Life Domain", 3);
    await rig.fight(who);
    rig.kit.place(low.id, 4, 5);
    rig.kit.place(high.id, 6, 5);
    rig.kit.place(away.id, 5, 13);
    rig.world.patch(low.id, { currentHp: 20 });
    rig.world.patch(high.id, { currentHp: 60 });
    rig.world.patch(away.id, { currentHp: 20 });
    const out = await rig.channel(who, "turn the tide", {}, [3, 3, 3]);
    const healed = [rig.hp(low) - 20, rig.hp(high) - 60, rig.hp(away) - 20];
    rig.note("tide", [out.ok, out.error, brief(out.result), healed]);
    return {
      "below-half-1d6-cha": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual(healed, [3 + cha(3), 0, 0], "an ally at 20 of 100 beside the paladin, one at 60 beside them, one at 20 40 feet off");
      },
    };
  },

  "ro::paladin::Channel Divinity: Control Undead": async (rig) => {
    const UNDEAD = { type: "undead", cr: 0.25 };
    const stage = async () => {
      rig.reset();
      const who = rig.hero("paladin", "Oathbreaker", 3);
      const [first, second] = await rig.fight(who, { enemies: 2, stats: { ...UNDEAD, saveMods: saveMods() } });
      rig.kit.place(second.id, 6, 6);
      return { who, first, second };
    };
    const control = (who, foe, face) => rig.channel(who, "control undead", { targetEnemyId: foe.id }, [face]);
    const charm = (foe) => rig.enemy(foe.id).conditionMeta?.charmed ?? null;
    let { who, first, second } = await stage();
    const firstPaladin = who.id;
    const fail = await control(who, first, 2);
    const held = charm(first);
    rig.setUsed(who, "channel_divinity", 0);
    rig.kit.freshTurn();
    const next = await control(who, second, 2);
    const released = [charm(first), charm(second)?.source ?? null];
    ({ who, first, second } = await stage());
    rig.kit.setEnemy(first.id, { stats: { ...UNDEAD, saveMods: saveMods({ wis: 10 }) } });
    const made = await control(who, first, 6);
    const madeCharm = charm(first);
    ({ who, first, second } = await stage());
    rig.kit.place(first.id, 5, 12);
    const far = await control(who, first, 2);
    rig.kit.place(first.id, 5, 6);
    rig.kit.setEnemy(first.id, { conditions: ["invisible"] });
    const unseen = await control(who, first, 2);
    const usedRefused = rig.res(who, "channel_divinity")?.used;
    ({ who, first, second } = await stage());
    rig.kit.setEnemy(first.id, { cr: 3, stats: { ...UNDEAD, cr: 3, saveMods: saveMods() } });
    rig.kit.setEnemy(second.id, { cr: 2, stats: { ...UNDEAD, cr: 2, saveMods: saveMods() } });
    const mighty = await control(who, first, 2);
    const usedMighty = rig.res(who, "channel_divinity")?.used;
    const lesser = await control(who, second, 2);
    rig.note("control", [fail.ok, fail.error, held, next.ok, released, made.ok, madeCharm, far.ok, far.error, unseen.ok, unseen.error, usedRefused, mighty.ok, mighty.error, usedMighty, lesser.ok, lesser.error]);
    return {
      "wisdom-obeys": () => {
        assert.equal(fail.ok, true, fail.error);
        assert.ok(held && held.source === firstPaladin && held.rounds === 14_400, `the undead that failed carries ${brief(held)}`);
        assert.deepEqual(released, [null, firstPaladin], "a second use lets the first undead go");
        assert.equal(madeCharm, null, "an undead at +10 to Wisdom that rolled a 6 obeys");
        assert.deepEqual([far.ok, unseen.ok, usedRefused], [false, false, 0], "an undead 35 feet off, or an invisible one, was taken, or a refusal spent the use");
      },
      "cr-immune": () => {
        assert.deepEqual([mighty.ok, usedMighty], [false, 0], `an undead of challenge rating 3 against a 3rd-level paladin: ${mighty.error}`);
        assert.equal(lesser.ok, true, `an undead of challenge rating 2: ${lesser.error}`);
      },
    };
  },

  "ro::paladin::Channel Divinity: Dreadful Aspect": async (rig) => {
    const seen = await savedOrNot(rig, "Oathbreaker", "dreadful aspect", "frightened", { args: (foe) => ({ targetEnemyIds: [foe.id] }) });
    return { "wisdom-save": savesCheck(seen, "Wisdom", "frightened") };
  },

  "ro::paladin::Aura of Hate": async (rig) => {
    const run = async (feetOff) => {
      rig.reset();
      const who = rig.hero("paladin", "Oathbreaker", 18);
      const friend = rig.hero("cleric", "Life Domain", 18);
      const [undead] = await rig.fight(friend, { stats: { type: "undead" } });
      rig.kit.place(who.id, 5, 6 + feetOff / 5);
      rig.foesTurn(undead);
      await rig.enemyHits(undead, friend, [16, 4]);
      return 100 - rig.hp(friend);
    };
    const near = await run(30);
    const far = await run(35);
    rig.note("hate 18", [near, far]);
    return {
      "30-feet-at-18": () => assert.deepEqual([near, far], [6 + cha(18), 6], `an undead 30 feet from an 18th-level oathbreaker hit for ${near}, one 35 feet off for ${far} (a club's 6, Charisma +${cha(18)})`),
    };
  },

  "ro::paladin::Dread Lord": async (rig) => {
    const { getDatabase } = await rig.load("lib/db/core.ts");
    const { ambientAt } = await rig.load("lib/battlemap/scene.ts");
    const { lightsWithZones } = await rig.load("lib/dm/zone-rules.ts");
    // Staging: the light the engine reads on a tile is the map's painted
    // patches and its live areas' (zone-rules.ts lightsWithZones, as
    // attack-light.ts and the board's view read it); the gloom is an area
    // that follows the paladin, so it is not among the painted patches alone.
    const light = (x, y) => {
      const map = rig.kit.map();
      return ambientAt(lightsWithZones(map), x, y, map.ambient);
    };
    const who = rig.hero("paladin", "Oathbreaker", 20);
    const [foe] = await rig.fight(who);
    getDatabase().prepare("UPDATE battle_maps SET ambient = 'bright', zones_json = '[]' WHERE id = ?").run(rig.kit.map().id);
    const before = light(5, 11);
    const opened = await rig.spend(who, "Dread Lord");
    const lit = { at30: light(5, 11), at35: light(5, 12) };
    const shadows = await rig.kit.swing(who.id, foe.id, [18, 5, 5, 5], { weapon: "Dread Lord's Shadows" });
    const cost = rig.budget();
    const second = await rig.kit.swing(who.id, foe.id, [18, 5, 5, 5], { weapon: "Dread Lord's Shadows" });
    // Who takes the 4d10 as their turn starts.
    const burn = async (feetOff, source) => {
      rig.reset();
      const holder = rig.hero("paladin", "Oathbreaker", 20);
      const [enemy] = await rig.fight(holder);
      await rig.spend(holder, "Dread Lord");
      rig.kit.place(enemy.id, 5, 5 + feetOff / 5);
      if (source) rig.kit.setEnemy(enemy.id, { conditions: ["frightened"], conditionMeta: { frightened: { rounds: 10, source: source === "self" ? holder.id : "someone-else" } } });
      rig.world.clearDice();
      rig.world.dice(5, 5, 5, 5);
      rig.endTurnOf(holder);
      rig.world.clearDice();
      return 300 - rig.enemy(enemy.id).currentHp;
    };
    const burns = { at30: await burn(30, "self"), at35: await burn(35, "self"), calm: await burn(5, null), otherFear: await burn(5, "other") };
    rig.note("dread", [before, opened.ok, opened.error, lit, shadows.ok, shadows.error, cost, second.ok, second.error, burns]);
    return {
      "gloom-dims": () => {
        assert.equal(before, "bright");
        assert.deepEqual(lit, { at30: "dim", at35: "bright" }, "the light 30 feet from the oathbreaker, and 35 feet, once the aura is up");
      },
      "frightened-start-in-aura": () => assert.deepEqual(burns, { at30: 20, at35: 0, calm: 0, otherFear: 0 }, "frightened of the paladin 30 feet off, 35 feet off, not frightened, frightened of another"),
      "bonus-action": () => {
        assert.equal(shadows.ok, true, `with the action spent on Dread Lord, the shadows were refused: ${shadows.error}`);
        assert.equal(cost?.bonusUsed, true, `the shadows cost ${brief(cost, 160)}`);
        assert.equal(second.ok, false, "a second shadow attack in the same turn, with the bonus action gone");
      },
    };
  },
};
