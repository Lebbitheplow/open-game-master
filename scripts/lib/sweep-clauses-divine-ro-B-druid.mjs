// Probes for the druid clauses of the divine ledger that no check had run
// (scripts/clauses/divine.json, read_only): each scene stages one feature
// and answers one check per clause. See scripts/lib/sweep-clauses-divine.mjs
// for how a scene answers its clauses.
import { assert, modOf, castingScore } from "./sweep-clauses-divine.mjs";

const brief = (value, length = 200) => JSON.stringify(value)?.slice(0, length);
const wis = (level) => modOf(castingScore(level));
const ids = (rig) => new Set(rig.world.sheets().map((sheet) => sheet.id));
const newSheets = (rig, before) => rig.world.sheets().filter((sheet) => !before.has(sheet.id));
const at = (rig, who) => {
  const token = rig.kit.token(who.id);
  return token ? [token.x, token.y] : null;
};
// A wider open field (the generated board is 20 squares across): 120 feet
// in a straight line needs 25.
async function widen(rig, width) {
  const { getDatabase } = await rig.load("lib/db/core.ts");
  getDatabase().prepare("UPDATE battle_maps SET width = ? WHERE id = ?").run(width, rig.kit.map().id);
  rig.kit.openField();
}
// The foe's turn begins after the holder's ends, through the door a turn
// change goes through (src/lib/dm/last-hit.ts closeHitsAtTurnEnd), as the
// druid suite's own scenes stage Halo of Spores.
async function foeStartsTurn(rig, who, foe) {
  const { closeHitsAtTurnEnd } = await import(new URL("../../src/lib/dm/last-hit.ts", import.meta.url).href);
  rig.kit.giveTurn(who.id);
  const encounter = rig.world.encounter();
  closeHitsAtTurnEnd(rig.world.campaignId, encounter, encounter.order[encounter.turnIndex]);
  rig.foesTurn(foe);
}

export const RO_DRUID_B = {
  "ro::druid::Circle Forms": async (rig) => {
    const shape = async (level, form, subclass = "Circle of the Moon") => {
      rig.reset();
      const who = rig.hero("druid", subclass, level);
      await rig.fight(who);
      const out = await rig.spend(who, "Wild Shape", { form });
      return out.ok;
    };
    const got = {
      "2 brown bear (CR 1)": await shape(2, "brown bear"),
      "2 giant boar (CR 2)": await shape(2, "giant boar"),
      "5 giant boar (CR 2)": await shape(5, "giant boar"),
      "6 giant boar (CR 2)": await shape(6, "giant boar"),
      "6 giant scorpion (CR 3)": await shape(6, "giant scorpion"),
      "9 giant scorpion (CR 3)": await shape(9, "giant scorpion"),
      "9 elephant (CR 4)": await shape(9, "elephant"),
      "2 Land druid brown bear": await shape(2, "brown bear", "Circle of the Land"),
    };
    rig.note("forms", got);
    return {
      cr: () =>
        assert.deepEqual(got, {
          "2 brown bear (CR 1)": true, "2 giant boar (CR 2)": false, "5 giant boar (CR 2)": false, "6 giant boar (CR 2)": true,
          "6 giant scorpion (CR 3)": false, "9 giant scorpion (CR 3)": true, "9 elephant (CR 4)": false, "2 Land druid brown bear": false,
        }, "CR 1 from 2nd level, a third of the druid level from 6th; a Land druid of 2nd level stays at CR 1/4"),
    };
  },

  "ro::druid::Balm of the Summer Court": async (rig) => {
    const who = rig.hero("druid", "Circle of Dreams", 6);
    const near = rig.hero("cleric", "Life Domain", 6);
    const far = rig.hero("cleric", "Life Domain", 6);
    await rig.fight(who);
    await widen(rig, 30);
    const board = rig.kit.map();
    rig.kit.place(who.id, 0, 5);
    rig.kit.place(near.id, 23, 5);
    rig.kit.place(far.id, 25, 5);
    rig.world.patch(near.id, { currentHp: 50 });
    rig.world.patch(far.id, { currentHp: 50 });
    const out = await rig.spend(who, "Balm of the Summer Court", { amount: 2, targetCharacterIds: [near.id], targetCharacterId: near.id }, [3, 4]);
    const cost = rig.budget();
    const healed = rig.hp(near) - 50;
    const again = await rig.spend(who, "Balm of the Summer Court", { amount: 1, targetCharacterId: near.id }, [5]);
    const afterAgain = rig.hp(near) - 50;
    rig.kit.freshTurn();
    const tooFar = await rig.spend(who, "Balm of the Summer Court", { amount: 1, targetCharacterId: far.id }, [5]);
    const farHealed = rig.hp(far) - 50;
    rig.note("balm", [board?.width, board?.height, at(rig, who), at(rig, near), at(rig, far), out.ok, out.error, cost, healed, again.ok, again.error, afterAgain, tooFar.ok, tooFar.error, farHealed]);
    return {
      bonus: () => {
        assert.equal(out.ok, true, out.error);
        assert.ok(cost?.bonusUsed === true && cost?.actionUsed !== true, `the balm cost ${brief(cost, 120)}`);
        assert.equal(again.ok, false, `a second balm the same turn, with the bonus action spent, was taken (the creature then stood ${afterAgain} above 50)`);
      },
      "120-feet": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(healed, 7, `two dice (a 3 and a 4) healed a creature 115 feet off by ${healed}`);
        assert.equal(tooFar.ok, false, `a creature 125 feet off was healed by ${farHealed}`);
        assert.equal(farHealed, 0);
      },
    };
  },

  "ro::druid::Hearth of Moonlight and Shadow": async (rig) => {
    const who = rig.hero("druid", "Circle of Dreams", 6);
    const ally = rig.hero("cleric", "Life Domain", 6);
    const plain = rig.hero("cleric", "Life Domain", 6);
    await rig.fight(who);
    const inFight = await rig.spend(who, "Hearth of Moonlight and Shadow", { targetCharacterIds: [who.id, ally.id] });
    await rig.kit.endFight();
    const totals = async () => [(await rig.check(ally, "stealth", {}, [10])).result.total, (await rig.check(ally, "perception", {}, [10])).result.total, (await rig.check(ally, "athletics", {}, [10])).result.total];
    const before = await totals();
    const out = await rig.spend(who, "Hearth of Moonlight and Shadow", { targetCharacterIds: [who.id, ally.id] });
    const meta = rig.meta(ally, "hearth of moonlight and shadow");
    const inside = await totals();
    const unnamed = rig.has(plain, "hearth of moonlight and shadow");
    const [stealth, perception, athletics] = [0, 1, 2].map((index) => [inside[index], before[index]]);
    await rig.rest("short");
    const afterRest = rig.has(ally, "hearth of moonlight and shadow");
    rig.note("hearth", [inFight.ok, inFight.error, out.ok, out.error, brief(out.result), meta, rig.conditions(ally), unnamed, stealth, perception, athletics, afterRest]);
    return {
      sphere: () => {
        assert.equal(inFight.ok, false, "the sphere was raised in the middle of a fight, not during a rest");
        assert.equal(out.ok, true, out.error);
        assert.ok(meta, `the ally inside carries ${brief(rig.conditions(ally))}`);
        assert.equal(afterRest, false, "the sphere outlasted the rest it was raised for");
      },
      "plus-5": () => {
        assert.equal(out.ok, true, out.error);
        assert.deepEqual([stealth[0] - stealth[1], perception[0] - perception[1], athletics[0] - athletics[1]], [5, 5, 0], `Stealth ${stealth}, Perception ${perception}, Athletics ${athletics} for an ally inside the sphere and the same ally before it, on a 10`);
      },
    };
  },

  "ro::druid::Spirit Totem": async (rig) => {
    const raise = async (variant, args = {}) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of the Shepherd", 2, { spells: { prepared: ["Cure Wounds"] } });
      const a = rig.hero("cleric", "Life Domain", 2);
      const b = rig.hero("cleric", "Life Domain", 2);
      const [foe] = await rig.fight(who);
      rig.kit.place(a.id, 10, 5);
      rig.kit.place(b.id, 12, 5);
      const out = await rig.spend(who, "Spirit Totem", { variant, targetCharacterIds: [who.id, a.id, b.id], ...args });
      return { who, a, b, foe, out };
    };
    // A point 65 feet off, then one 55 feet off.
    const farPoint = await raise("bear", { x: 18, y: 5 });
    const nearPoint = await raise("bear", { x: 16, y: 5 });
    const nearTemp = [rig.world.sheet(nearPoint.who.id).tempHp, rig.world.sheet(nearPoint.a.id).tempHp, rig.world.sheet(nearPoint.b.id).tempHp];
    // The aura on the druid: one ally 25 feet off, one 35 feet off.
    const bear = await raise("bear");
    const auraTemp = [rig.world.sheet(bear.a.id).tempHp, rig.world.sheet(bear.b.id).tempHp];
    const hawk = await raise("hawk");
    rig.kit.place(hawk.a.id, 6, 5);
    rig.kit.giveTurn(hawk.a.id);
    // The Hand deals the reaction as a card while the hawk stands, and never
    // under another spirit; its call names the creature attacked alone, and
    // the attacker is the hero whose turn it is.
    const { reactionCards } = await rig.load("lib/battlemap/hand-react.ts");
    const { FRESH_TURN } = await rig.load("lib/battlemap/hand.ts");
    const dealt = (who) => reactionCards(rig.world.sheet(who.id), FRESH_TURN, [], rig.world.sheets()).filter((entry) => entry.name === "Spirit Totem (Hawk)").map((entry) => [entry.target, entry.cost, entry.disabled]);
    const hawkCard = dealt(hawk.who);
    const otherCard = dealt(hawk.a);
    const tries = {};
    for (const name of ["Spirit Totem (Hawk)"]) {
      const out = await rig.react(hawk.who, name, { targetEnemyId: hawk.foe.id });
      tries[name] = out.ok ? "ok" : out.error.slice(0, 120);
      if (out.ok) tries.result = brief(out.result, 300);
      if (out.ok) break;
    }
    const reacted = rig.reacted(hawk.who);
    const swing = await rig.kit.swing(hawk.a.id, hawk.foe.id, [10, 15, 4]);
    const hawkDice = rig.diceIn(swing.toHit, 20);
    const unicorn = await raise("unicorn");
    const detect = [rig.d20s((await rig.check(unicorn.who, "perception")).result), rig.d20s((await rig.check(unicorn.a, "perception")).result), rig.d20s((await rig.check(unicorn.a, "investigation")).result), rig.d20s((await rig.check(unicorn.a, "athletics")).result)];
    rig.kit.place(unicorn.a.id, 6, 5);
    rig.kit.place(unicorn.b.id, 4, 5);
    rig.world.patch(unicorn.a.id, { currentHp: 50 });
    rig.world.patch(unicorn.b.id, { currentHp: 50 });
    rig.kit.freshTurn();
    const slot = await rig.call("heal", { characterId: unicorn.a.id, casterId: unicorn.who.id, spell: "Cure Wounds", level: 1 }, [4]);
    const afterSlot = rig.hp(unicorn.b);
    const flat = await rig.call("heal", { characterId: unicorn.a.id, casterId: unicorn.who.id, amount: 5, reason: "a potion" });
    const afterFlat = rig.hp(unicorn.b);
    rig.note("totem", [farPoint.out.ok, farPoint.out.error.slice(0, 120), nearPoint.out.ok, nearTemp, bear.out.ok, auraTemp, tries, reacted, hawkDice, swing.ok, swing.error, detect, slot.ok, slot.error, afterSlot, flat.ok, flat.error, afterFlat]);
    return {
      "60-feet": () => {
        assert.equal(nearPoint.out.ok, true, nearPoint.out.error);
        assert.equal(farPoint.out.ok, false, "the spirit was called to a point 65 feet off");
        assert.deepEqual(nearTemp, [0, 7, 7], `with the spirit 55 feet off at (16,5), the druid at (5,5) and allies at (10,5) and (12,5) hold ${nearTemp} temporary hit points: the aura stands at the point`);
      },
      "30-foot-aura": () => {
        assert.equal(bear.out.ok, true, bear.out.error);
        assert.deepEqual(auraTemp, [7, 0], `allies 25 and 35 feet from the spirit hold ${auraTemp} temporary hit points`);
      },
      "hawk-reaction": () => {
        assert.ok(Object.values(tries).includes("ok"), `the druid's reaction for an ally's attack: ${brief(tries, 400)}`);
        assert.equal(reacted, true);
        assert.equal(hawkDice, 2, `the ally's attack after the hawk's reaction rolled ${hawkDice} d20`);
        assert.deepEqual(hawkCard, [["enemy", "reaction", null]], `the druid's Hand under the hawk: ${JSON.stringify(hawkCard)}`);
        assert.deepEqual(otherCard, [], "an ally with no totem was dealt the hawk's card");
      },
      "unicorn-detect": () => {
        assert.deepEqual(detect, [2, 2, 2, 1], "Perception of the druid and an ally, the ally's Investigation, and the ally's Athletics");
        assert.equal(slot.ok, true, slot.error);
        assert.equal(afterSlot, 52, `a healing spell with a slot left another ally in the aura at ${afterSlot}`);
        assert.equal(afterFlat, afterSlot, `hit points that came from no slot healed the other ally to ${afterFlat}`);
      },
    };
  },

  "ro::druid::Faithful Summons": async (rig) => {
    const fall = async (how) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of the Shepherd", 14);
      const [foe] = await rig.fight(who);
      const before = ids(rig);
      let out;
      if (how === "damage") out = await rig.damage(who, 150, "slashing");
      if (how === "stunned") out = await rig.call("set_condition", { characterId: who.id, condition: "stunned", rounds: 2, sourceEnemyId: foe.id });
      if (how === "own") out = await rig.call("set_condition", { characterId: who.id, condition: "stunned", rounds: 2, sourceCharacterId: who.id });
      const made = newSheets(rig, before);
      const order = rig.world.encounter()?.order ?? [];
      return {
        who, out, made, used: rig.res(who, "sub_faithful_summons")?.used ?? null,
        apart: made.map((sheet) => (rig.kit.token(sheet.id) && rig.kit.token(who.id) ? rig.feetApart(who, sheet) : null)),
        inOrder: made.filter((sheet) => order.some((entry) => entry.characterId === sheet.id)).length,
        concentrating: rig.world.sheet(who.id).concentratingOn ?? null,
        rounds: made.map((sheet) => rig.meta(sheet, "summoned")?.rounds ?? null),
        shape: made[0] ? brief({ ...made[0], features: undefined, spellcasting: undefined, equipment: undefined }, 600) : null,
      };
    };
    const dropped = await fall("damage");
    const stunned = await fall("stunned");
    const own = await fall("own");
    rig.note("faithful", [dropped.out.ok, dropped.made.length, dropped.used, stunned.out.ok, stunned.out.error, stunned.made.length, own.out.ok, own.made.length, dropped.apart, dropped.inOrder, dropped.concentrating, dropped.rounds, dropped.shape]);
    return {
      trigger: () => {
        assert.deepEqual([dropped.made.length, dropped.used], [4, 1], "dropped to 0 hit points: four beasts and the use");
        assert.deepEqual([stunned.made.length, stunned.used], [4, 1], `stunned by the goblin: ${stunned.out.error}`);
        assert.equal(own.made.length, 0, "stunned by the druid's own doing called the beasts");
      },
      beasts: () => {
        assert.equal(dropped.made.length, 4);
        assert.ok(dropped.apart.every((feet) => feet !== null && feet <= 20), `the beasts stand ${dropped.apart} feet from the druid`);
        assert.equal(dropped.inOrder, 4, "the beasts act in the fight");
        assert.equal(dropped.concentrating, null, "the druid concentrates on them");
        assert.ok(dropped.rounds.every((rounds) => rounds === 600), `the beasts stay ${dropped.rounds} rounds: an hour is 600`);
      },
    };
  },

  "ro::druid::Symbiotic Entity": async (rig) => {
    const take = async (level, spent = 0) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of Spores", level);
      await rig.fight(who);
      if (spent) rig.setUsed(who, "wild_shape", spent);
      const out = await rig.spend(who, "Symbiotic Entity");
      return { out, temp: rig.world.sheet(who.id).tempHp, used: rig.res(who, "wild_shape")?.used ?? null, max: rig.res(who, "wild_shape")?.max ?? null };
    };
    const at2 = await take(2);
    const at5 = await take(5);
    const empty = await take(2, 2);
    rig.note("entity", [at2.out.ok, at2.temp, at2.used, at5.temp, at5.used, empty.out.ok, empty.out.error.slice(0, 120), empty.temp, empty.max]);
    return {
      "wild-shape-temp-hp": () => {
        assert.equal(at2.out.ok, true, at2.out.error);
        assert.deepEqual([at2.temp, at2.used, at5.temp, at5.used], [8, 1, 20, 1], "four temporary hit points a druid level, and a Wild Shape use");
        assert.equal(empty.out.ok, false, "with no Wild Shape use left the entity rose all the same");
      },
    };
  },

  "ro::druid::Spreading Spores": async (rig) => {
    const who = rig.hero("druid", "Circle of Spores", 10);
    const [foe] = await rig.fight(who);
    rig.kit.place(foe.id, 5, 7);
    await rig.spend(who, "Symbiotic Entity");
    rig.kit.freshTurn();
    const out = await rig.spend(who, "Spreading Spores", { targetEnemyId: foe.id, x: 5, y: 7 });
    const zones = rig.world.encounter().zones ?? [];
    rig.world.clearDice();
    rig.world.dice(1, 6, 6);
    await foeStartsTurn(rig, who, foe);
    // The goblin's turn starting is what strikes it in the cube: the board's
    // areas act through the turn-start door (src/lib/dm/zone-triggers.ts
    // zoneTurnStart, which condition-tick.ts calls), and moving the pointer
    // alone runs none of them.
    const { zoneTurnStart } = await rig.load("lib/dm/zone-triggers.ts");
    zoneTurnStart(rig.world.campaign(), rig.world.encounter(), [foe.id]);
    rig.world.clearDice();
    const took = 300 - rig.enemy(foe.id).currentHp;
    const halo = await rig.react(who, "Halo of Spores", { targetEnemyId: foe.id }, [3, 1]);
    rig.note("spores", [out.ok, out.error.slice(0, 200), brief(zones, 200), took, halo.ok, halo.error.slice(0, 160)]);
    return {
      "cube-save": () => {
        assert.equal(out.ok, true, `use_resource "Spreading Spores": ${out.error.slice(0, 200)}`);
        assert.ok(took > 0, `a goblin starting its turn in the cube, failing its Constitution save, lost ${took}`);
        assert.equal(halo.ok, false, "Halo of Spores' reaction was taken while the cube lasts");
      },
    };
  },

  "ro::druid::Fungal Body": async (rig) => {
    const crit = async (level) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of Spores", level);
      const [foe] = await rig.fight(who);
      rig.foesTurn(foe);
      await rig.enemyHits(foe, who, [20, 3, 3]);
      const roll = rig.lastRolls(6).find((entry) => entry.kind === "damage");
      return { d6: rig.diceIn(roll, 6), took: 100 - rig.hp(who) };
    };
    const body = await crit(14);
    const plain = await crit(10);
    rig.note("fungal", [body, plain]);
    return { "no-crit": () => assert.deepEqual([body.d6, body.took, plain.d6, plain.took], [1, 5, 2, 8], "a natural 20 on the club (1d6+2, threes): one die on a 14th-level Spores druid, two on a 10th-level one") };
  },

  "ro::druid::Enhanced Bond": async (rig) => {
    const cast = async (spirit) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of Wildfire", 6, { spells: { prepared: ["Cure Wounds"], cantrips: ["Produce Flame"] } });
      const hurt = rig.hero("cleric", "Life Domain", 6);
      const [foe] = await rig.fight(who);
      rig.kit.place(foe.id, 5, 8);
      rig.kit.place(hurt.id, 6, 5);
      const before = ids(rig);
      const summoned = spirit ? await rig.spend(who, "Summon Wildfire Spirit") : null;
      const made = newSheets(rig, before);
      rig.kit.freshTurn();
      const flame = await rig.kit.swing(who.id, foe.id, [18, 3, 3, 3, 3, 3], { spell: "Produce Flame" });
      rig.world.patch(hurt.id, { currentHp: 50 });
      rig.kit.freshTurn();
      const heal = await rig.call("heal", { characterId: hurt.id, casterId: who.id, spell: "Cure Wounds", level: 1 }, [4, 4]);
      const healed = rig.hp(hurt) - 50;
      // "you may cast them from the spirit's position": Cure Wounds, a touch
      // spell, on the cleric 35 feet from the druid and beside the spirit
      // (src/lib/dm/cast-origin.ts castFromElsewhere).
      rig.world.patch(hurt.id, { currentHp: 50 });
      if (made[0]) rig.kit.place(made[0].id, 5, 11);
      rig.kit.place(hurt.id, 5, 12);
      rig.kit.freshTurn();
      const far = await rig.call("heal", { characterId: hurt.id, casterId: who.id, spell: "Cure Wounds", level: 1 }, [4, 4]);
      return { summoned, made: made.length, pets: (rig.world.sheet(who.id).pets ?? []).length, flame: rig.diceIn(flame.damage, 8), healed, heal, far: far.ok, farError: String(far.error ?? "").slice(0, 160) };
    };
    const out = await cast(true);
    const plain = await cast(false);
    rig.note("bond", [out.summoned?.ok, out.summoned?.error, out.made, out.pets, out.flame, out.healed, out.heal.error, plain.flame, plain.healed]);
    return {
      "fire-heal-spirit-place": () => {
        assert.deepEqual([out.flame, plain.flame], [3, 2], "Produce Flame's 2d8 at 6th level, and the bond's 1d8 while the spirit is out");
        assert.deepEqual([out.healed, plain.healed], [4 + wis(6) + 4, 4 + wis(6)], "Cure Wounds' 1d8 + Wisdom, and the bond's 1d8 while the spirit is out");
        assert.ok(out.made > 0 || out.pets > 0, "the wildfire spirit is a condition on the druid, with no place on the board to cast from");
        assert.deepEqual([out.far, plain.far], [true, false], `a touch spell from the spirit's square, and none with no spirit out: ${out.farError}`);
      },
    };
  },

  "ro::druid::Cauterizing Flames": async (rig) => {
    const who = rig.hero("druid", "Circle of Wildfire", 10);
    const [near, far] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(far.id, 5, 13);
    rig.foesTurn(far);
    const early = await rig.spend(who, "Cauterizing Flames", { variant: "burn", targetEnemyId: far.id }, [5, 5]);
    const earlyTook = 300 - rig.enemy(far.id).currentHp;
    rig.kit.setEnemy(near.id, { currentHp: 1 });
    rig.kit.giveTurn(who.id);
    const kill = await rig.kit.swing(who.id, near.id, [18, 4]);
    // The flame is kept with the druid, at the dead creature's square
    // (src/lib/dm/cauterizing-flames.ts).
    const zones = rig.meta(who, "spectral flames")?.flames ?? [];
    const flame = zones.find((entry) => entry.x === 5 && entry.y === 6);
    rig.note("flames", [early.ok, early.error.slice(0, 160), earlyTook, kill.ok, rig.enemy(near.id).status, rig.enemy(near.id).currentHp, brief(zones, 300)]);
    return {
      flame: () => {
        assert.equal(early.ok, false, `with nobody dead the reaction burned a goblin for ${earlyTook}`);
        assert.ok(flame, `a goblin killed 5 feet from the druid left no flame in its space: zones ${brief(zones, 160)}`);
      },
    };
  },

  "ro::druid::Blazing Revival": async (rig) => {
    const drop = async (spirit, twice = false) => {
      rig.reset();
      const who = rig.hero("druid", "Circle of Wildfire", 14);
      await rig.fight(who);
      if (spirit) await rig.spend(who, "Summon Wildfire Spirit");
      await rig.damage(who, 150, "slashing");
      const first = { hp: rig.hp(who), spirit: rig.has(who, "wildfire spirit"), used: rig.res(who, "sub_blazing_revival")?.used ?? null };
      if (!twice) return first;
      rig.world.patch(who.id, { conditions: [...rig.conditions(who), "wildfire spirit"], conditionMeta: { ...(rig.world.sheet(who.id).conditionMeta ?? {}), "wildfire spirit": { rounds: 600 } } });
      await rig.damage(who, 150, "slashing");
      return { first, second: rig.hp(who) };
    };
    const out = await drop(true, true);
    const without = await drop(false);
    rig.note("revival", [out, without]);
    return {
      revive: () => {
        assert.deepEqual([out.first.hp, out.first.spirit, out.first.used], [50, false, 1], "half of 100 hit points, the spirit gone, the use spent");
        assert.equal(out.second, 0, "a second fall the same day was revived");
        assert.equal(without.hp, 0, "with no spirit out the druid was revived");
      },
    };
  },
};
