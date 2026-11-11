// Probes for the read-only clauses of the artificer's specialists and Soul of
// the Forge in the divine clause ledger (scripts/clauses/divine.json). Keys are
// "ro::<ledger key>"; see scripts/lib/sweep-clauses-divine.mjs for how a scene
// answers its clauses.
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";
import { RO_SMITH } from "./sweep-clauses-divine-ro-C-smith.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);
const intOf = (level) => modOf(castingScore(level));
const lost = (rig, foe, from = 300) => from - rig.enemy(foe.id).currentHp;
const slotsUsed = (rig, who) => Object.values(rig.world.sheet(who.id).spellcasting?.slots ?? {}).reduce((sum, slot) => sum + (slot.used ?? 0), 0);
// The latest attack roll: listRecentRolls reads oldest first, so the first
// attack found was the character's own earlier swing, never the one just made.
const d20sOfLastAttack = (rig) => rig.diceIn(rig.lastRolls(6).filter((roll) => roll.kind === "attack").at(-1), 20);
// The board's areas live in the map's spellZones (src/lib/db/battle-maps.ts):
// a "zones" field it does not have read as no area at all.
const zonesNamed = (rig, pattern) => (rig.kit.map()?.spellZones ?? []).filter((zone) => pattern.test(JSON.stringify(zone)));
const ELIXIR = "art_experimental_elixir";

// A Guardian or Infiltrator armorer, a fight, and the creature beside them.
async function armorer(rig, level, model, extra = {}) {
  const who = rig.hero("artificer", "Armorer", level, { pick: ["Armor Model", model], ...extra });
  const friend = rig.hero("cleric", "Life Domain", level);
  const [foe] = await rig.fight(who);
  rig.kit.place(friend.id, 4, 6);
  return { who, friend, foe };
}

// An Artillerist with the cannon made, in a fight.
async function artillerist(rig, level) {
  const who = rig.hero("artificer", "Artillerist", level, { spells: { cantrips: ["Fire Bolt"] } });
  const friend = rig.hero("cleric", "Life Domain", level);
  const [foe] = await rig.fight(who);
  rig.kit.place(friend.id, 4, 5);
  const made = await rig.spend(who, "Eldritch Cannon");
  rig.kit.freshTurn();
  return { who, friend, foe, made };
}

export const RO_EXTRA = {
  "ro::cleric::Soul of the Forge": async (rig) => {
    // The club at +4 with a 12 on the die: 16, against chain mail's 16 (17 with the +1).
    const blowAt = async (domain, armor) => {
      rig.reset();
      const who = rig.hero("cleric", domain, 6, { acOverride: false, equipment: [{ name: armor, qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }] });
      const [foe] = await rig.fight(who);
      rig.foesTurn(foe);
      await rig.enemyHits(foe, who, [12, 4]);
      return 100 - rig.hp(who);
    };
    const forgeHeavy = await blowAt("Forge Domain", "Chain Mail");
    const lifeHeavy = await blowAt("Life Domain", "Chain Mail");
    const forgeMedium = await blowAt("Forge Domain", "Scale Mail");
    rig.note("soul", { forgeHeavy, lifeHeavy, forgeMedium });
    return {
      "heavy-ac": () => assert.deepEqual({ forgeHeavy, lifeHeavy, forgeMedium }, { forgeHeavy: 0, lifeHeavy: 6, forgeMedium: 6 }, "a 16 to hit against the Forge cleric in chain mail (AC 17 with the +1), a Life cleric in chain mail (16), and the Forge cleric in scale mail, medium armor (16)"),
    };
  },

  "ro::artificer::Experimental Elixir": async (rig) => {
    const who = rig.hero("artificer", "Alchemist", 3);
    const friend = rig.hero("cleric", "Life Domain", 3);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 4, 5);
    const drink = async (variant, faces = [], target = friend) => {
      rig.setUsed(who, ELIXIR, 0);
      rig.kit.giveTurn(who.id);
      return rig.spend(who, "Experimental Elixir", { ...(variant ? { variant } : {}), targetCharacterId: target.id }, faces);
    };
    rig.world.patch(friend.id, { currentHp: 50 });
    const healing = await drink("healing", [2, 2]);
    const healed = rig.hp(friend) - 50;
    const rolled = await drink(null, [1, 2, 2]);
    const d6 = rolled.rolled.some((die) => die.sides === 6);
    // Walking and flying speed as the board's movement reads them.
    const { effectiveSpeed } = await rig.load("lib/dm/condition-logic.ts");
    const { flyingSpeedOf } = await rig.load("lib/battlemap/types.ts");
    const walk = () => effectiveSpeed(rig.conditions(friend), rig.srd.speedFor(rig.world.sheet(friend.id)));
    const flies = () => flyingSpeedOf({ conditions: rig.conditions(friend), features: rig.world.sheet(friend.id).features, walkingFeet: walk() }) ?? 0;
    const speedBefore = walk();
    const swift = await drink("swiftness");
    const swiftness = { speed: walk() - speedBefore, rounds: rig.meta(friend, "elixir of swiftness")?.rounds };
    const resilient = await drink("resilience");
    rig.foesTurn(foe);
    rig.kit.place(foe.id, 4, 6);
    // Read before the blow: the rolled elixir above heals too when its d6
    // lands on healing, so the hit points are not 50 + the first healing.
    const beforeBlow = rig.hp(friend);
    await rig.enemyHits(foe, friend, [8, 4]);
    const resilience = { took: beforeBlow - rig.hp(friend), rounds: rig.meta(friend, "elixir of resilience")?.rounds };
    const bold = await drink("boldness");
    await rig.save(friend, "wis", {}, [10, 2]);
    const boldness = { save: rig.lastRolls(4).find((roll) => roll.kind === "saving_throw")?.expression, rounds: rig.meta(friend, "elixir of boldness")?.rounds };
    const flown = await drink("flight");
    const flight = { fly: flies(), rounds: rig.meta(friend, "flying")?.rounds };
    const shifted = await drink("transformation");
    const transformation = { rounds: rig.meta(friend, "elixir of transformation")?.rounds };
    rig.setUsed(who, ELIXIR, rig.res(who, ELIXIR).max);
    rig.kit.giveTurn(who.id);
    const slotsBefore = slotsUsed(rig, who);
    const brewed = await rig.spend(who, "Experimental Elixir", { variant: "flight", targetCharacterId: who.id });
    const bySlot = { ok: brewed.ok, error: brewed.error, slots: slotsUsed(rig, who) - slotsBefore, budget: rig.budget(), flies: rig.has(who, "flying") };
    const state = { healing: [healing.ok, healing.error, healed], rolled: [rolled.ok, rolled.error, rolled.rolled.map((die) => `${die.face}/d${die.sides}`)], swiftness, resilience, boldness, flight, transformation, oks: [swift.ok, resilient.ok, bold.ok, flown.ok, shifted.ok], bySlot };
    rig.note("elixir", state);
    return {
      healing: () => {
        assert.equal(healing.ok, true, healing.error);
        assert.equal(healed, 2 + 2 + intOf(3), `the healing elixir (2d4 + Intelligence, two 2s) gave ${healed}`);
        assert.ok(d6, `an elixir brewed after a rest rolled no d6 for its effect: ${brief(state.rolled)}`);
      },
      effects: () => assert.deepEqual(
        { swiftness, resilience, boldness: { d4: /1d4/.test(String(boldness.save)), rounds: boldness.rounds }, flight, transformation },
        { swiftness: { speed: 10, rounds: 600 }, resilience: { took: 0, rounds: 100 }, boldness: { d4: true, rounds: 10 }, flight: { fly: 10, rounds: 100 }, transformation: { rounds: 100 } },
        "swiftness +10 feet for an hour, resilience +1 AC for 10 minutes (a 12 to hit against AC 12 misses), boldness a d4 on a save for a minute, flight a 10-foot flying speed for 10 minutes, transformation for 10 minutes",
      ),
      slot: () => {
        assert.equal(bySlot.ok, true, `with no elixir left from the rest, brewing one more for a spell slot: ${bySlot.error}`);
        assert.equal(bySlot.slots, 1, `the brew spent ${bySlot.slots} spell slots`);
        assert.equal(bySlot.budget?.actionUsed, true);
      },
    };
  },

  "ro::artificer::Alchemical Savant": async (rig) => {
    const SUPPLIES = { name: "Alchemist's Supplies", qty: 1, equipped: true };
    const stage = async (equipment) => {
      rig.reset();
      const who = rig.hero("artificer", "Alchemist", 5, { equipment, spells: { cantrips: ["Fire Bolt", "Shocking Grasp"], prepared: ["Cure Wounds"] } });
      const friend = rig.hero("cleric", "Life Domain", 5);
      const [foe] = await rig.fight(who);
      rig.kit.place(friend.id, 4, 5);
      rig.world.patch(friend.id, { currentHp: 50 });
      const fire = await rig.kit.swing(who.id, foe.id, [18, 5, 5, 5], { spell: "Fire Bolt" });
      const fireTook = lost(rig, foe);
      rig.kit.freshTurn();
      const spark = await rig.kit.swing(who.id, foe.id, [18, 5, 5], { spell: "Shocking Grasp" });
      const sparkTook = lost(rig, foe) - fireTook;
      rig.kit.freshTurn();
      const cure = await rig.call("heal", { characterId: friend.id, casterId: who.id, spell: "Cure Wounds", level: 1 }, [4]);
      return { fireTook, sparkTook, healed: rig.hp(friend) - 50, errors: [fire.error, spark.error, cure.error], said: [fire.damage?.expression, fire.rolled, (fire.damage?.breakdown?.terms ?? []).map((term) => `${term.dice?.length ?? ""}d${term.sides ?? ""}:${brief(term.dice ?? term.value, 30)}`), spark.damage?.expression, brief(cure.result, 120)] };
    };
    const focus = await stage([SUPPLIES]);
    const bare = await stage([]);
    rig.note("savant", { focus, bare });
    const int = intOf(5);
    return {
      "int-bonus": () => assert.deepEqual(
        { focus: [focus.fireTook, focus.sparkTook, focus.healed], bare: [bare.fireTook, bare.healed] },
        { focus: [10 + int, 10, 4 + int + int], bare: [10, 4 + int] },
        `through alchemist's supplies Fire Bolt (two 5s) takes ${int} more and Cure Wounds (a 4 + ${int}) heals ${int} more, Shocking Grasp (lightning) nothing more; without the supplies neither`,
      ),
    };
  },

  "ro::artificer::Restorative Reagents": async (rig) => {
    const who = rig.hero("artificer", "Alchemist", 9);
    const friend = rig.hero("cleric", "Life Domain", 9);
    rig.world.patch(friend.id, { currentHp: 50, tempHp: 0 });
    const out = await rig.spend(who, "Experimental Elixir", { variant: "healing", targetCharacterId: friend.id }, [3, 3, 3, 3]);
    const temp = rig.world.sheet(friend.id).tempHp ?? 0;
    rig.note("reagents", [out.ok, out.error, brief(out.result, 300), rig.hp(friend), temp]);
    return {
      "temp-hp": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(temp, 3 + 3 + intOf(9), `the creature that drank the elixir has ${temp} temporary hit points: 2d6 (two 3s) + Intelligence ${intOf(9)}`);
      },
    };
  },

  "ro::artificer::Chemical Mastery": async (rig) => {
    const who = rig.hero("artificer", "Alchemist", 15);
    const friend = rig.hero("cleric", "Life Domain", 15);
    rig.world.patch(friend.id, { currentHp: 30 });
    const before = slotsUsed(rig, who);
    const heal = await rig.call("heal", { characterId: friend.id, casterId: who.id, spell: "Heal", level: 6 });
    const afterHeal = { hp: rig.hp(friend), slots: slotsUsed(rig, who) - before };
    rig.world.patch(friend.id, { currentHp: 30 });
    const again = await rig.call("heal", { characterId: friend.id, casterId: who.id, spell: "Heal", level: 6 });
    const afterAgain = { hp: rig.hp(friend), slots: slotsUsed(rig, who) - before };
    rig.note("mastery", [heal.ok, heal.error, brief(heal.result, 200), afterHeal, again.ok, again.error, afterAgain]);
    return {
      "free-casts": () => {
        assert.equal(heal.ok, true, `Heal, cast once a long rest without a slot: ${heal.error}`);
        assert.deepEqual(afterHeal, { hp: 100, slots: 0 }, "the free Heal restores 70 and spends no slot");
        assert.ok(!again.ok || afterAgain.slots > 0, "a second Heal the same day was free as well");
      },
    };
  },

  "ro::artificer::Tool Proficiency (Armorer)": async (rig) => {
    const got = rig.trained("artificer", "Armorer", 3).proficiencies;
    return { heavy: () => assert.ok(got.armor.includes("heavy"), `armor: ${brief(got.armor)}`) };
  },

  "ro::artificer::Armor Model": async (rig) => {
    let { who, friend, foe } = await armorer(rig, 3, "Guardian");
    const gauntlet = await rig.kit.swing(who.id, foe.id, [10, 4], { weapon: "Thunder Gauntlets" });
    rig.kit.freshTurn();
    rig.kit.setEnemy(foe.id, { currentHp: 300, stats: { immune: "thunder" } });
    await rig.kit.swing(who.id, foe.id, [18, 4], { weapon: "Thunder Gauntlets" });
    const thunderImmune = lost(rig, foe);
    // A plain melee hit stands in when the gauntlets cannot be swung, so the
    // mark is seen either way.
    rig.kit.setEnemy(foe.id, { currentHp: 300, stats: { immune: "" } });
    rig.kit.freshTurn();
    const marked = gauntlet.ok ? gauntlet : await rig.kit.swing(who.id, foe.id, [18, 4]);
    const mark = { conditions: rig.enemy(foe.id).conditions, meta: rig.enemy(foe.id).conditionMeta?.["thunder gauntlets"] ?? null };
    // The Guardian's id: `who` is the Infiltrator once the scene moves on.
    const guardianId = who.id;
    rig.foesTurn(foe);
    await rig.enemyHits(foe, friend, [16, 16, 4]);
    const atFriend = d20sOfLastAttack(rig);
    rig.kit.freshRound();
    await rig.enemyHits(foe, who, [16, 16, 4]);
    const atArmorer = d20sOfLastAttack(rig);
    rig.reset();
    ({ who, foe } = await armorer(rig, 3, "Infiltrator"));
    rig.kit.place(foe.id, 5, 11);
    const launch = await rig.kit.swing(who.id, foe.id, [10, 3, 3], { weapon: "Lightning Launcher" });
    const launchTook = lost(rig, foe);
    rig.kit.saveEncounter({ ...rig.world.encounter(), turnBudget: { ...rig.budget(), actionUsed: false, attacksMade: 0 } });
    const second = await rig.kit.swing(who.id, foe.id, [10, 3, 3], { weapon: "Lightning Launcher" });
    // The walking speed is speedFor's (computeSheetDerived carries no "speed").
    const speed = rig.srd.speedFor(rig.world.sheet(who.id));
    const stealth = await rig.check(who, "stealth");
    const state = {
      gauntlet: [gauntlet.ok, gauntlet.error, gauntlet.toHit?.total, gauntlet.damage?.expression, gauntlet.damage?.total], thunderImmune, marked: [marked.ok, marked.error], mark, atFriend, atArmorer,
      launch: [launch.ok, launch.error, launch.toHit?.total, launch.damage?.expression, launchTook], second: [second.ok, second.error, second.damage?.expression], speed, stealth: rig.d20s(stealth.result),
    };
    rig.note("armor model", state);
    return {
      int: () => {
        assert.equal(gauntlet.ok, true, `the Guardian's thunder gauntlets: ${gauntlet.error}`);
        assert.deepEqual([gauntlet.toHit?.total, gauntlet.damage?.total], [10 + intOf(3) + profOf(3), 4 + intOf(3)], "a 10 and a 4 with Intelligence +5 (Strength +3): to hit 17, damage 9");
      },
      gauntlets: () => {
        assert.equal(gauntlet.ok, true, gauntlet.error);
        assert.equal(rig.diceIn(gauntlet.damage, 8), 1, `the gauntlets rolled ${gauntlet.damage?.expression}: 1d8`);
        assert.equal(thunderImmune, 0, `a creature immune to thunder lost ${thunderImmune} to the gauntlets`);
      },
      "disadvantage-others": () => {
        assert.equal(gauntlet.ok, true, `the creature must be hit by the gauntlets: ${gauntlet.error}`);
        assert.deepEqual([atFriend, atArmorer], [2, 1], "the creature the gauntlets hit attacks the armorer's ally with disadvantage, the armorer without");
        // "Until the start of your next turn" is a mark's untilTurnOf
        // (src/lib/dm/condition-logic.ts ConditionMeta); untilTurnStartOf is
        // no field the engine writes or reads.
        assert.equal(mark.meta?.untilTurnOf, guardianId, `the mark lasts ${brief(mark.meta)}: until the start of the armorer's next turn`);
      },
      infiltrator: () => {
        assert.equal(launch.ok, true, `the Infiltrator's lightning launcher at 30 feet: ${launch.error}`);
        assert.equal(rig.diceIn(launch.damage, 6), 2, `the first hit of the turn rolled ${launch.damage?.expression}: 1d6 and the extra 1d6`);
        assert.equal(rig.diceIn(second.damage, 6), 1, `the second hit of the turn rolled ${second.damage?.expression}`);
        assert.equal(speed, 35, `the Infiltrator's walking speed is ${speed}`);
        assert.equal(state.stealth, 2, "a Stealth check rolled one d20");
      },
    };
  },

  "ro::artificer::Perfected Armor": async (rig) => {
    let { who, friend, foe } = await armorer(rig, 15, "Guardian");
    // The creature ends its turn 5 feet from the armorer, and the pointer moves on.
    const { recordTurnEnd } = await rig.load("lib/dm/last-save.ts");
    rig.foesTurn(foe);
    recordTurnEnd(rig.world.campaignId, rig.world.encounter(), rig.world.encounter().order.find((entry) => entry.enemyId === foe.id), rig.enemy(foe.id).displayName);
    rig.kit.giveTurn(friend.id);
    const pulled = await rig.react(who, "Perfected Armor", { targetEnemyId: foe.id }, [1, 18, 4]);
    const pullTook = lost(rig, foe);
    // From 20 feet off: "pulled up to 25 feet toward you", then the attack.
    rig.reset();
    ({ who, friend, foe } = await armorer(rig, 15, "Guardian"));
    rig.kit.place(foe.id, 5, 9);
    rig.foesTurn(foe);
    recordTurnEnd(rig.world.campaignId, rig.world.encounter(), rig.world.encounter().order.find((entry) => entry.enemyId === foe.id), rig.enemy(foe.id).displayName);
    rig.kit.giveTurn(friend.id);
    const far = await rig.react(who, "Perfected Armor", { targetEnemyId: foe.id }, [1, 18, 4]);
    const farState = { ok: far.ok, error: far.error, at: [rig.kit.token(foe.id).x, rig.kit.token(foe.id).y], took: lost(rig, foe) };
    rig.reset();
    const facts = await rig.counterFacts("artificer", "Armorer", 15, "sub_perfected_armor", { pick: ["Armor Model", "Guardian"] });
    rig.reset();
    ({ who, friend, foe } = await armorer(rig, 15, "Infiltrator"));
    // A ranged attack at a creature 5 feet off is at disadvantage: the
    // launcher fires from 20 feet, and the creature comes back to the armorer.
    rig.kit.place(foe.id, 5, 9);
    const launch = await rig.kit.swing(who.id, foe.id, [15, 3, 3], { weapon: "Lightning Launcher" });
    rig.kit.place(foe.id, 5, 6);
    const glow = { conditions: rig.enemy(foe.id).conditions, meta: rig.enemy(foe.id).conditionMeta?.["lit by perfected armor"] ?? null };
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [16, 16, 4]);
    const atArmorer = d20sOfLastAttack(rig);
    rig.kit.giveTurn(friend.id);
    const before = lost(rig, foe);
    const ally = await rig.kit.swing(friend.id, foe.id, [15, 15, 4, 3]);
    const allyTook = lost(rig, foe) - before;
    rig.kit.saveEncounter({ ...rig.world.encounter(), turnBudget: { ...rig.budget(), actionUsed: false, attacksMade: 0 } });
    const next = await rig.kit.swing(friend.id, foe.id, [15, 15, 4]);
    const state = { pulled: [pulled.ok, pulled.error, brief(pulled.result, 200), pullTook], facts: [facts.max, facts.afterShort, facts.afterLong], launch: [launch.ok, launch.error], glow, atArmorer, ally: [ally.ok, ally.error, ally.toHit?.advantage, ally.damage?.expression, allyTook], next: [next.toHit?.advantage] };
    rig.note("perfected", state);
    return {
      attack: () => {
        assert.equal(pulled.ok, true, pulled.error);
        assert.ok(pullTook > 0, `the creature that failed and ended within 5 feet was not attacked as part of the reaction: it lost ${pullTook}`);
        assert.equal(farState.ok, true, farState.error);
        assert.deepEqual(farState.at, [5, 6], `a creature 20 feet off that failed stands at (${farState.at}): pulled to the square beside the armorer at (5,5)`);
        assert.ok(farState.took > 0, "the creature pulled to within 5 feet was not attacked");
      },
      uses: () => assert.deepEqual([facts.max, facts.afterShort, facts.afterLong], [profOf(15), profOf(15), 0], `the reaction's uses at 15th level (proficiency +5, Intelligence +${intOf(15)}), after a short rest and after a long one`),
      infiltrator: () => {
        assert.equal(launch.ok, true, `the lightning launcher: ${launch.error}`);
        assert.equal(atArmorer, 2, "the glowing creature attacked the armorer with one d20");
        assert.equal(ally.toHit?.advantage, "advantage", `the next attack at the glowing creature rolled with ${ally.toHit?.advantage}`);
        assert.equal(rig.diceIn(ally.damage, 6), 1, `and its damage rolled ${ally.damage?.expression}: the extra 1d6 lightning`);
        assert.notEqual(next.toHit?.advantage, "advantage", "the attack after it still had advantage");
      },
    };
  },

  "ro::artificer::Eldritch Cannon": async (rig) => {
    const { who, friend, foe, made } = await artillerist(rig, 3);
    // The cannon is a creature on the board beside the artificer (its sheet
    // carries the AC and hit points the clause states), and the area named for
    // it marks its square: read both.
    const cannonSheet = rig.world.sheets().find((sheet) => sheet.summon?.casterId === who.id && /eldritch cannon/i.test(sheet.summon?.form ?? "")) ?? null;
    const madeState = { budget: null, zones: zonesNamed(rig, /eldritch cannon/i), meta: rig.meta(who, "eldritch cannon"), cannon: cannonSheet ? { ac: cannonSheet.ac, hp: cannonSheet.maxHp } : null };
    rig.setUsed(who, "sub_eldritch_cannon", 1);
    const slotsBefore = slotsUsed(rig, who);
    const again = await rig.spend(who, "Eldritch Cannon");
    const bySlot = { ok: again.ok, error: again.error, slots: slotsUsed(rig, who) - slotsBefore };
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 12);
    const shot = await rig.kit.swing(who.id, foe.id, [18, 4, 4], { weapon: "Force Ballista" });
    const shotState = { took: lost(rig, foe), at: [rig.kit.token(foe.id).x, rig.kit.token(foe.id).y], budget: rig.budget() };
    rig.kit.freshTurn();
    rig.kit.place(friend.id, 5, 7);
    const guard = await rig.spend(who, "Activate Cannon", { variant: "protector" }, [4]);
    const guarded = { friend: rig.world.sheet(friend.id).tempHp ?? 0, self: rig.world.sheet(who.id).tempHp ?? 0, budget: rig.budget() };
    rig.reset();
    const bare = rig.hero("artificer", "Artillerist", 3);
    await rig.fight(bare);
    const noCannon = await rig.spend(bare, "Activate Cannon", { variant: "protector" });
    rig.note("cannon", { made: [made.ok, made.error, brief(made.result, 200)], madeState, bySlot, shot: [shot.ok, shot.error, shot.damage?.expression], shotState, guard: [guard.ok, guard.error, brief(guard.result, 200)], guarded, noCannon: [noCannon.ok, noCannon.error] });
    return {
      create: () => {
        assert.equal(made.ok, true, made.error);
        assert.equal(madeState.meta?.rounds, 600, `the cannon lasts ${brief(madeState.meta)}: an hour`);
        assert.equal(madeState.zones.length, 1, `no cannon stands on the board: ${brief(rig.kit.map()?.zones)}`);
        assert.ok(/"ac":18|AC 18/i.test(JSON.stringify([madeState.zones, madeState.cannon])) && new RegExp(`"hp":${5 * 3}|${5 * 3} hit points`).test(JSON.stringify([madeState.zones, madeState.cannon])), `the cannon on the board has no AC 18 and ${5 * 3} hit points: ${brief([madeState.zones, madeState.cannon], 300)}`);
      },
      slot: () => {
        assert.equal(bySlot.ok, true, `a second cannon the same day, for a spell slot: ${bySlot.error}`);
        assert.equal(bySlot.slots, 1, `it spent ${bySlot.slots} spell slots`);
      },
      "bonus-60": () => {
        assert.equal(guard.ok, true, guard.error);
        assert.ok(guarded.budget?.bonusUsed === true && guarded.budget?.actionUsed !== true, `activating the cannon cost ${brief(guarded.budget, 160)}`);
        assert.equal(noCannon.ok, false, "a cannon nobody made was activated");
        assert.equal(madeState.zones.length, 1, "there is no cannon on the board for the 60 feet to be measured from");
      },
      "ballista-protector": () => {
        assert.equal(shot.ok, true, shot.error);
        assert.equal(shotState.took, 8, `the Force Ballista (2d8 force, two 4s) took ${shotState.took}`);
        assert.ok(shotState.at[1] >= 13, `the creature struck stands at ${brief(shotState.at)}: pushed 5 feet from (5,12)`);
        assert.equal(guarded.friend, 4 + intOf(3), `the ally within 10 feet of the cannon gained ${guarded.friend} temporary hit points: 1d8 (a 4) + Intelligence ${intOf(3)}`);
      },
    };
  },

  "ro::artificer::Arcane Firearm": async (rig) => {
    const stage = async (equipment) => {
      rig.reset();
      const who = rig.hero("artificer", "Artillerist", 5, { equipment, spells: { cantrips: ["Fire Bolt"] } });
      const [foe] = await rig.fight(who);
      const out = await rig.kit.swing(who.id, foe.id, [18, 5, 5, 5], { spell: "Fire Bolt" });
      return { out, d8: rig.diceIn(out.damage, 8), expression: out.damage?.expression };
    };
    const wand = await stage([{ name: "Wand", qty: 1, equipped: true }]);
    const bare = await stage([]);
    rig.note("firearm", { wand: [wand.out.ok, wand.out.error, wand.expression], bare: [bare.out.ok, bare.expression] });
    return {
      "1d8": () => {
        assert.equal(wand.out.ok, true, wand.out.error);
        assert.deepEqual([wand.d8, bare.d8], [1, 0], `Fire Bolt through a wand rolled ${wand.expression}, without one ${bare.expression}`);
      },
    };
  },

  "ro::artificer::Explosive Cannon": async (rig) => {
    const { who, foe, made } = await artillerist(rig, 9);
    rig.kit.place(foe.id, 5, 9);
    const shot = await rig.kit.swing(who.id, foe.id, [18, 1, 1, 1], { weapon: "Force Ballista" });
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 6);
    const flame = await rig.spend(who, "Activate Cannon", { variant: "flamethrower", targetEnemyIds: [foe.id] }, [1, 1, 1, 1]);
    const flameD8 = flame.rolled.filter((die) => die.sides === 8).length;
    rig.note("explosive", [made.ok, made.error, shot.ok, shot.error, shot.damage?.expression, flame.ok, flame.error, flame.rolled.map((die) => `${die.face}/d${die.sides}`)]);
    return {
      "extra-1d8": () => {
        assert.equal(shot.ok, true, shot.error);
        assert.equal(rig.diceIn(shot.damage, 8), 3, `the 9th-level Force Ballista rolled ${shot.damage?.expression}: 2d8 and the extra 1d8`);
        assert.equal(flameD8, 3, `the 9th-level Flamethrower rolled ${flameD8} d8s (${flame.error || "spent"})`);
      },
    };
  },

  "ro::artificer::Fortified Position": async (rig) => {
    const { friend, foe, made } = await artillerist(rig, 15);
    rig.kit.place(foe.id, 4, 6);
    rig.foesTurn(foe);
    // A 9 + 4 = 13 against the ally's AC 12, 14 with half cover.
    await rig.enemyHits(foe, friend, [9, 4]);
    const took = 100 - rig.hp(friend);
    rig.note("fortified", [made.ok, made.error, took, brief(rig.kit.map()?.zones, 200)]);
    return {
      "half-cover": () => {
        assert.equal(made.ok, true, made.error);
        assert.equal(took, 0, `an ally beside the artificer and the cannon was hit by a 13 against AC 12 (14 with half cover) and took ${took}`);
      },
    };
  },

  "ro::artificer::Battle Ready": async (rig) => {
    const swingWith = async (weapon) => {
      rig.reset();
      const who = rig.hero("artificer", "Battle Smith", 3, { equipment: [{ name: weapon, qty: 1, equipped: true }] });
      const [foe] = await rig.fight(who);
      const out = await rig.kit.swing(who.id, foe.id, [10, 4], { weapon });
      return { ok: out.ok, error: out.error, hit: out.toHit?.total, damage: out.damage?.total };
    };
    const magic = await swingWith("+1 Longsword");
    const plain = await swingWith("Longsword");
    rig.note("battle ready", { magic, plain });
    const int = intOf(3);
    return {
      "int-magic": () => assert.deepEqual(
        { magic: [magic.hit, magic.damage], plain: [plain.hit, plain.damage] },
        { magic: [10 + int + profOf(3) + 1, 4 + int + 1], plain: [10 + 3 + profOf(3), 4 + 3] },
        "a +1 longsword swings on Intelligence (+5), a plain one on Strength (+3)",
      ),
    };
  },
  ...RO_SMITH,
};
