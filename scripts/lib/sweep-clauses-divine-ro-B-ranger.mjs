// Probes for the ranger clauses of the divine ledger that no check had run
// (scripts/clauses/divine.json, read_only): each scene stages one feature
// and answers one check per clause. See scripts/lib/sweep-clauses-divine.mjs
// for how a scene answers its clauses.
import { assert, profOf } from "./sweep-clauses-divine.mjs";
import { hasPack } from "./enforce-world.mjs";

const brief = (value, length = 200) => JSON.stringify(value)?.slice(0, length);
const petOf = (rig, who) => (rig.world.sheet(who.id).pets ?? [])[0] ?? null;
const again = (rig) => rig.kit.saveEncounter({ ...rig.world.encounter(), turnBudget: { ...rig.budget(), actionUsed: false, attacksMade: 0 } });
const at = (rig, id) => {
  const token = rig.kit.token(id);
  return token ? [token.x, token.y] : null;
};
const attackRoll = (rig) => rig.lastRolls(8).find((entry) => entry.kind === "attack") ?? null;
const darken = async (rig) => {
  const { getDatabase } = await rig.load("lib/db/core.ts");
  getDatabase().prepare("UPDATE battle_maps SET ambient = 'dark', outdoors = 0, lights_json = '[]', zones_json = '[]' WHERE id = ?").run(rig.kit.map().id);
};
const DARKVISION = { senses: { darkvision: 60 } };
const HOLD = { spells: ["Hold Person"] };
const FLAME = { spells: ["Sacred Flame"] };

// A pet summoned, then a fight with it out.
async function withPet(rig, subclass, level, summon) {
  rig.reset();
  const who = rig.hero("ranger", subclass, level);
  const called = await rig.call("summon_pet", { characterId: who.id, ...summon });
  const [foe] = await rig.fight(who);
  const pet = petOf(rig, who);
  const attack = (faces = [18, 4, 4, 4]) => rig.call("pet_attack", { characterId: who.id, targetEnemyId: foe.id, petName: pet?.name }, faces);
  return { who, called, pet, foe, attack };
}

export const RO_RANGER_B = {
  "ro::ranger::Ranger's Companion": async (rig) => {
    const scene = await withPet(rig, "Beast Master", 3, { kind: "beast_companion", form: "wolf", name: "Ash" });
    const order = rig.world.encounter().order;
    const own = await scene.attack();
    rig.kit.freshTurn();
    rig.foesTurn(scene.foe);
    const offTurn = await scene.attack();
    rig.note("companion", [brief(scene.pet, 600), order.length, brief(order.map((entry) => entry.characterId ?? entry.enemyId ?? entry.name)), own.ok, own.error, offTurn.ok, offTurn.error.slice(0, 160)]);
    const pet = scene.pet ?? {};
    return {
      // The wolf's skills are read from its stat block in the content pack; with
      // no pack (CI) the companion is built from the bare form and has none.
      "saves-skills": () => hasPack && assert.equal(pet.skills?.perception ?? pet.skills?.Perception, 3 + profOf(3), `a wolf's Perception +3 and the proficiency bonus: the companion's record holds ${brief(Object.keys(pet))}`),
      initiative: () => {
        assert.equal(own.ok, true, own.error);
        assert.equal(offTurn.ok, false, "the companion attacked on the goblin's turn");
        assert.equal(order.some((entry) => entry.characterId && entry.characterId !== scene.who.id && /ash|wolf/i.test(entry.name ?? "")), false, "the companion holds a place of its own in the order");
      },
    };
  },

  "ro::ranger::Exceptional Training": async (rig) => {
    const command = async (level, attackFirst) => {
      const scene = await withPet(rig, "Beast Master", level, { kind: "beast_companion", form: "wolf", name: "Ash" });
      if (attackFirst) await scene.attack();
      const tries = {};
      let cost = null;
      for (const [name, args] of [["Exceptional Training", { variant: "dash" }], ["Command Companion", { variant: "dash" }], ["Companion Dash", {}]]) {
        const out = await rig.spend(scene.who, name, { petName: "Ash", ...args });
        tries[name] = out.ok ? "ok" : out.error.slice(0, 100);
        if (out.ok) {
          cost = rig.budget();
          break;
        }
      }
      return { tries, cost };
    };
    const at7 = await command(7, false);
    const after = await command(7, true);
    const at6 = await command(6, false);
    rig.note("training", [at7, after, at6]);
    return {
      "bonus-command": () => {
        assert.ok(at7.cost?.bonusUsed === true && at7.cost?.actionUsed !== true, `commanding the companion to Dash at 7th level: ${brief(at7.tries, 300)}`);
        assert.equal(after.cost, null, "after the companion attacked, the bonus command was taken");
        assert.ok(at6.cost?.bonusUsed !== true, "at 6th level the bonus command was taken");
      },
    };
  },

  "ro::ranger::Share Spells": async (rig) => {
    const scene = await withPet(rig, "Beast Master", 15, { kind: "beast_companion", form: "wolf", name: "Ash" });
    rig.world.patch(scene.who.id, { spellcasting: { ...rig.world.sheet(scene.who.id).spellcasting, prepared: ["Longstrider"] } });
    const before = brief(petOf(rig, scene.who), 400);
    const cast = await rig.call("cast_buff", { characterId: scene.who.id, spell: "Longstrider", targetCharacterId: scene.who.id });
    const pet = petOf(rig, scene.who);
    rig.note("share", [cast.ok, cast.error.slice(0, 160), rig.conditions(scene.who), before, brief(pet, 400)]);
    return {
      shared: () => {
        assert.equal(cast.ok, true, cast.error);
        assert.ok(rig.has(scene.who, "longstrider"), brief(rig.conditions(scene.who)));
        assert.ok(pet?.speed === 50 || /longstrider/i.test(JSON.stringify(pet?.conditions ?? [])), `the ranger cast Longstrider on themselves and the companion reads speed ${pet?.speed}, ${brief(Object.keys(pet ?? {}))}`);
      },
    };
  },

  "ro::ranger::Umbral Sight": async (rig) => {
    const swingAt = async (subclass, dark = true, elf = false) => {
      rig.reset();
      const who = rig.hero("ranger", subclass, 3, { race: elf ? "Elf" : "Human" });
      // An elf's own darkvision, as the builder writes it (the ranger suite's Umbral Sight scene).
      if (elf) rig.world.patch(who.id, { features: [...rig.world.sheet(who.id).features, { ...rig.world.sheet(who.id).features[0], name: "Darkvision", description: "You can see in dim light within 60 feet of you as if it were bright light." }] });
      const [foe] = await rig.fight(who);
      rig.kit.setEnemy(foe.id, { stats: DARKVISION });
      if (dark) await darken(rig);
      rig.foesTurn(foe);
      await rig.enemyHits(foe, who, [16, 3, 4]);
      const theirs = attackRoll(rig);
      rig.kit.giveTurn(who.id);
      const mine = await rig.kit.swing(who.id, foe.id, [10, 15, 4]);
      const faces = (roll) => (roll?.breakdown?.terms ?? []).filter((term) => term.sides === 20).flatMap((term) => term.dice.map((die) => `${die.value}${die.kept === false ? "x" : ""}`));
      return { theirs: rig.diceIn(theirs, 20), mine: rig.diceIn(mine.toHit, 20), faces: [faces(theirs), faces(mine.toHit)], total: theirs?.total };
    };
    const stalker = await swingAt("Gloom Stalker");
    const hunter = await swingAt("Hunter", true, true);
    const lit = await swingAt("Gloom Stalker", false);
    rig.note("umbral", [stalker, hunter, lit]);
    return {
      unseen: () =>
        assert.deepEqual([stalker.faces, [hunter.theirs, hunter.mine], [lit.theirs, lit.mine]], [[["16x", "3"], ["10x", "15"]], [1, 1], [1, 1]], `in darkness a goblin with darkvision attacking a Gloom Stalker rolled ${brief(stalker.faces[0])} (x: not kept) and the ranger's attack on it ${brief(stalker.faces[1])}: the goblin sees the ranger by darkvision; against an elf Hunter, who also sees in the dark, ${hunter.theirs} and ${hunter.mine} d20; the Gloom Stalker in light, ${lit.theirs} and ${lit.mine}`),
    };
  },

  "ro::ranger::Shadowy Dodge": async (rig) => {
    const dodge = async (advantage) => {
      rig.reset();
      const who = rig.hero("ranger", "Gloom Stalker", 15);
      const [foe] = await rig.fight(who);
      rig.foesTurn(foe);
      await rig.enemyHits(foe, who, advantage ? [16, 15, 4] : [16, 4], advantage ? { advantage: "advantage", advantageSource: "other", advantageReason: "a clause check" } : {});
      const hit = rig.hp(who);
      const out = await rig.react(who, "Shadowy Dodge", {}, [2]);
      return { hit, out, hp: rig.hp(who), reacted: rig.reacted(who) };
    };
    const plain = await dodge(false);
    const favoured = await dodge(true);
    rig.note("dodge", [plain.hit, plain.out.ok, plain.out.error, plain.hp, plain.reacted, favoured.hit, favoured.out.ok, favoured.out.error.slice(0, 160), favoured.hp, favoured.reacted]);
    return {
      disadvantage: () => {
        assert.equal(plain.out.ok, true, plain.out.error);
        assert.deepEqual([plain.hit, plain.hp, plain.reacted], [94, 100, true], "a 20 that hit, rolled again at disadvantage as a 2, misses: the 6 comes back");
        assert.equal(favoured.out.ok, false, "against an attack with advantage the dodge was taken");
        assert.deepEqual([favoured.hp, favoured.reacted], [favoured.hit, false]);
      },
    };
  },

  "ro::ranger::Spectral Defense": async (rig) => {
    const who = rig.hero("ranger", "Horizon Walker", 15);
    const [foe] = await rig.fight(who);
    const early = await rig.react(who, "Spectral Defense");
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [16, 4]);
    const out = await rig.react(who, "Spectral Defense");
    const after = rig.hp(who);
    await rig.enemyHits(foe, who, [16, 4]);
    const second = await rig.react(who, "Spectral Defense");
    const afterSecond = rig.hp(who);
    rig.note("spectral", [early.ok, early.error.slice(0, 120), out.ok, out.error, after, second.ok, second.error.slice(0, 120), afterSecond]);
    return {
      half: () => {
        assert.equal(early.ok, false, "with no hit to answer the reaction was taken");
        assert.equal(out.ok, true, out.error);
        assert.equal(after, 97, "half of a 6 comes back");
        assert.deepEqual([second.ok, afterSecond], [false, 91], "a second hit the same round, the reaction spent");
      },
    };
  },

  "ro::ranger::Supernatural Defense": async (rig) => {
    const who = rig.hero("ranger", "Monster Slayer", 7);
    const [prey, other] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(other.id, 4, 6);
    rig.kit.setEnemy(prey.id, { stats: HOLD });
    rig.kit.setEnemy(other.id, { stats: HOLD });
    const marked = await rig.spend(who, "Slayer's Prey", { targetEnemyId: prey.id });
    const saveFrom = async (enemy) => {
      rig.foesTurn(enemy);
      rig.kit.freshRound();
      const before = new Set(rig.lastRolls(20).map((roll) => roll.id));
      const cast = await rig.call("cast_at_player", { characterId: who.id, spell: "Hold Person", saveAbility: "wis", dc: 15, condition: "paralyzed", casterEnemyId: enemy.id }, [10, 3]);
      const roll = rig.lastRolls(20).find((entry) => entry.kind === "saving_throw" && !before.has(entry.id));
      rig.world.patch(who.id, { conditions: ["slayer's prey"].filter((name) => rig.conditions(who).includes(name)), conditionMeta: rig.world.sheet(who.id).conditionMeta });
      return roll ? rig.diceIn(roll, 6) : `no save: ${cast.error.slice(0, 100)}`;
    };
    const fromPrey = await saveFrom(prey);
    const fromOther = await saveFrom(other);
    rig.foesTurn(prey);
    rig.world.patch(who.id, { conditions: ["grappled"], conditionMeta: { grappled: { rounds: 10, sourceEnemyId: prey.id, source: prey.id } } });
    rig.kit.giveTurn(who.id);
    const escape = await rig.check(who, "athletics", { against: "grappled", reason: "escape the prey's grapple" }, [10, 3]);
    rig.note("supernatural", [marked.ok, marked.error, fromPrey, fromOther, escape.ok, escape.error, rig.diceIn(escape.result, 6), brief(escape.result?.dice, 200)]);
    const escapeD6 = (escape.result?.dice ?? []).filter((term) => term.sides === 6).reduce((sum, term) => sum + term.dice.length, 0);
    return {
      d6: () => {
        assert.equal(marked.ok, true, marked.error);
        assert.deepEqual([fromPrey, fromOther], [1, 0], "a save against the prey's Hold Person, and against another creature's");
        assert.equal(escapeD6, 1, `a check to escape the prey's grapple rolled ${brief(escape.result?.dice, 160)}`);
      },
    };
  },

  "ro::ranger::Slayer's Counter": async (rig) => {
    const who = rig.hero("ranger", "Monster Slayer", 15);
    const [prey] = await rig.fight(who);
    rig.kit.setEnemy(prey.id, { stats: FLAME });
    await rig.spend(who, "Slayer's Prey", { targetEnemyId: prey.id });
    rig.foesTurn(prey);
    // Sacred Flame: a failed save that leaves the ranger able to react, and
    // no damage at all on a success.
    const cast = await rig.call("cast_at_player", { characterId: who.id, spell: "Sacred Flame", saveAbility: "dex", dc: 15, damage: "1d8", damageType: "radiant", casterEnemyId: prey.id }, [2, 6, 6]);
    const held = 100 - rig.hp(who);
    const out = await rig.react(who, "Slayer's Counter", { targetEnemyId: prey.id }, [18, 4, 4]);
    const after = 100 - rig.hp(who);
    // A save that paralyzes: "You make this attack immediately before making
    // the saving throw", so the ranger answers as they stood before it, and a
    // hit ends what the failure laid; a miss leaves them held.
    const held2 = async (faces) => {
      rig.kit.freshRound();
      rig.foesTurn(prey);
      rig.world.patch(who.id, { conditions: [], conditionMeta: {} });
      rig.kit.setEnemy(prey.id, { stats: HOLD });
      const hold = await rig.call("cast_at_player", { characterId: who.id, spell: "Hold Person", saveAbility: "wis", dc: 25, condition: "paralyzed", casterEnemyId: prey.id }, [2, 6]);
      const bound = rig.conditions(who).includes("paralyzed");
      const answer = await rig.react(who, "Slayer's Counter", { targetEnemyId: prey.id }, faces);
      return [hold.ok || hold.error.slice(0, 200), bound, answer.ok, answer.error.slice(0, 120), rig.conditions(who).includes("paralyzed")];
    };
    const freed = await held2([18, 4, 4]);
    const stillHeld = await held2([1, 1]);
    rig.note("counter", [cast.ok, cast.error.slice(0, 160), held, out.ok, out.error.slice(0, 160), brief(out.result, 300), after, rig.conditions(who), freed, stillHeld]);
    return {
      "auto-success": () => {
        assert.equal(cast.ok, true, cast.error);
        assert.ok(held > 0, "the failed save cost the ranger nothing");
        assert.equal(out.ok, true, out.error);
        assert.equal(after, 0, `the counter hit, and the ranger still lost ${after} of the ${held} the failed save cost (Sacred Flame does nothing on a success)`);
        assert.deepEqual(freed, [true, true, true, "", false], `a failed save against the prey's Hold Person, then a counter that hit: [cast ok, paralyzed, reaction ok, its error, still paralyzed] ${brief(freed, 300)}`);
        assert.deepEqual([stillHeld[1], stillHeld[2], stillHeld[4]], [true, true, true], `a counter that missed leaves the ranger paralyzed: [paralyzed, reaction ok, still paralyzed] ${brief(stillHeld, 300)}`);
      },
    };
  },

  "ro::ranger::Gathered Swarm": async (rig) => {
    const who = rig.hero("ranger", "Swarmkeeper", 3);
    const [foe] = await rig.fight(who);
    const first = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    again(rig);
    const second = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    // Each try on a turn of its own, so the once a turn of one is not the next's.
    const turn = async (hit, x, y) => {
      rig.kit.freshTurn();
      rig.kit.place(who.id, 5, 5);
      rig.kit.place(foe.id, 5, 6);
      if (hit) await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
      const out = await rig.spend(who, "Gathered Swarm", { variant: "move", x, y });
      return { ok: out.ok, error: out.error.slice(0, 140), at: at(rig, who.id), foeAt: at(rig, foe.id), hp: rig.hp(who), foeReacted: rig.world.encounter().reactionsUsed.includes(foe.id) };
    };
    const noHit = await turn(false, 5, 4);
    const tooFar = await turn(true, 5, 3);
    const step = await turn(true, 5, 4);
    // Beyond the clause: does a refused try spend the once a turn?
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 6);
    await rig.spend(who, "Gathered Swarm", { variant: "push", targetEnemyId: foe.id }, [1]);
    await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    const afterRefusal = await rig.spend(who, "Gathered Swarm", { variant: "push", targetEnemyId: foe.id }, [1]);
    rig.note("swarm", [first.damage?.expression, second.damage?.expression, noHit, tooFar, step, afterRefusal.ok, afterRefusal.error.slice(0, 140)]);
    return {
      "1d6-once": () => {
        assert.equal(rig.diceIn(first.damage, 6), 1, `the first hit rolled ${first.damage?.expression}`);
        assert.equal(rig.diceIn(second.damage, 6), 0, `a second hit the same turn rolled ${second.damage?.expression}`);
      },
      "move-5": () => {
        assert.equal(step.ok, true, step.error);
        assert.deepEqual([step.at, step.foeAt, step.hp, step.foeReacted], [[5, 4], [5, 6], 100, false], "the swarm moves the ranger 5 feet from the goblin, which stays put, and no opportunity attack");
        assert.ok(!tooFar.ok && tooFar.at[1] !== 3, `the swarm moved the ranger 10 feet: ${brief(tooFar)}`);
        assert.ok(!noHit.ok && noHit.at[1] !== 4, "the swarm moved the ranger with no hit that turn");
      },
    };
  },

  "ro::ranger::Mighty Swarm": async (rig) => {
    const who = rig.hero("ranger", "Swarmkeeper", 11);
    const [foe] = await rig.fight(who);
    const hit = await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    const push = await rig.spend(who, "Gathered Swarm", { variant: "push", targetEnemyId: foe.id }, [1]);
    const pushed = { at: at(rig, foe.id), conditions: rig.enemy(foe.id).conditions };
    rig.kit.freshTurn();
    rig.kit.place(foe.id, 5, 6);
    rig.kit.setEnemy(foe.id, { conditions: [], conditionMeta: {} });
    await rig.kit.swing(who.id, foe.id, [18, 4, 5]);
    const move = await rig.spend(who, "Gathered Swarm", { variant: "move", x: 4, y: 5 });
    const moved = { who: at(rig, who.id), foe: at(rig, foe.id) };
    rig.kit.place(foe.id, 4, 6);
    const derived = rig.srd.computeSheetDerived(rig.world.sheet(who.id));
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [9, 4]);
    const hp = rig.hp(who);
    rig.note("mighty", [hit.damage?.expression, push.ok, push.error.slice(0, 160), pushed, move.ok, move.error.slice(0, 160), moved, rig.conditions(who), derived.ac, hp]);
    return {
      "d8-prone-cover": () => {
        assert.equal(rig.diceIn(hit.damage, 8), 2, `a hit rolled ${hit.damage?.expression}: the longsword's d8 and the swarm's`);
        assert.equal(push.ok, true, push.error);
        assert.ok(pushed.conditions.includes("prone"), `a goblin that failed its save against the push stands at ${pushed.at} with ${brief(pushed.conditions)}`);
        assert.equal(hp, 100, `moved by the swarm, the ranger (AC 12, half cover +2) was hit by a 13 and stands at ${hp}, carrying ${brief(rig.conditions(who))}`);
      },
    };
  },

  "ro::ranger::Drake Companion": async (rig) => {
    rig.reset();
    const who = rig.hero("ranger", "Drakewarden", 3);
    const [foe] = await rig.fight(who);
    const summon = await rig.call("summon_pet", { characterId: who.id, kind: "drake", form: "drake", essence: "fire", name: "Ember" });
    const cost = rig.budget();
    const pet = petOf(rig, who);
    const tokens = (await rig.load("lib/db/battle-maps.ts")).listTokens(rig.kit.map().id).map((entry) => `${entry.refId}@${entry.x},${entry.y}`);
    const fire = await rig.call("damage_pet", { characterId: who.id, petName: "Ember", amount: 10, type: "fire" });
    const afterFire = petOf(rig, who)?.hp;
    const cold = await rig.call("damage_pet", { characterId: who.id, petName: "Ember", amount: 10, type: "cold" });
    const afterCold = petOf(rig, who)?.hp;
    const dead = await rig.call("damage_pet", { characterId: who.id, petName: "Ember", amount: 30, type: "cold" });
    const gone = (rig.world.sheet(who.id).pets ?? []).length;
    // Each summoning is the ranger's action (the clause's own "As an action"),
    // so each comes on a turn of its own.
    rig.setUsed(who, "sub_drake_companion", 0);
    rig.kit.freshTurn();
    await rig.call("summon_pet", { characterId: who.id, kind: "drake", form: "drake", essence: "cold", name: "Ember" });
    rig.setUsed(who, "sub_drake_companion", 0);
    rig.kit.freshTurn();
    const again2 = await rig.call("summon_pet", { characterId: who.id, kind: "drake", form: "drake", essence: "acid", name: "Rime" });
    const drakes = (rig.world.sheet(who.id).pets ?? []).filter((entry) => entry.kind === "drake").length;
    const order = rig.world.encounter().order;
    rig.kit.freshTurn();
    rig.foesTurn(foe);
    const offTurn = await rig.call("pet_attack", { characterId: who.id, targetEnemyId: foe.id }, [18, 4]);
    rig.note("drake", [summon.ok, summon.error, cost, brief(pet, 400), tokens, fire.ok, fire.error, afterFire, cold.ok, afterCold, dead.ok, gone, again2.ok, again2.error, drakes, order.length, offTurn.ok, offTurn.error.slice(0, 120)]);
    return {
      summon: () => {
        assert.equal(summon.ok, true, summon.error);
        assert.equal(cost?.actionUsed, true, `summoning the drake in a fight cost ${brief(cost, 120)}`);
        // Maintainer ruling D2 (gap study wave 2): "A pet has no token: it
        // stands with its owner, so a range between a pet and its owner always
        // holds and a range from the pet is measured from the owner's place."
        // The check asked for a token of the drake's own; the ruling is that
        // it has none.
        assert.ok(!tokens.some((entry) => /drake|ember|pet/i.test(entry)), `D2: the drake stands with its ranger, no token of its own: tokens ${tokens}`);
        assert.equal(gone, 0, "the drake at 0 hit points is still out");
        assert.equal(drakes, 1, "a second summoning left two drakes");
      },
      immune: () => {
        assert.equal(fire.ok, true, fire.error);
        assert.deepEqual([afterFire, afterCold], [20, 10], "10 fire on a fire drake, then 10 cold");
      },
      "initiative-dodge": () => {
        assert.equal(offTurn.ok, false, "the drake attacked on the goblin's turn");
        assert.ok(/dodg/i.test(JSON.stringify(petOf(rig, who)?.conditions ?? [])), "nothing marks the uncommanded drake as taking the Dodge action: an attack on it is never at disadvantage");
      },
    };
  },

  "ro::ranger::Bond of Fang and Scale": async (rig) => {
    const scene = await withPet(rig, "Drakewarden", 7, { kind: "drake", form: "drake", essence: "fire", name: "Ember" });
    const pet = scene.pet ?? {};
    const mount = await rig.call("mount_up", { characterId: scene.who.id, mount: "Ember" });
    rig.kit.freshTurn();
    const bite = await scene.attack([18, 4, 4]);
    const rolls = rig.lastRolls(6).filter((entry) => entry.kind === "damage");
    const fireDice = rolls.reduce((sum, roll) => sum + (roll.breakdown?.terms ?? []).filter((term) => term.sides === 6).reduce((n, term) => n + term.dice.length, 0), 0);
    rig.world.patch(scene.who.id, { currentHp: 100 });
    await rig.damage(scene.who, 10, "fire");
    const fireTaken = 100 - rig.hp(scene.who);
    rig.world.patch(scene.who.id, { currentHp: 100 });
    await rig.damage(scene.who, 10, "cold");
    const coldTaken = 100 - rig.hp(scene.who);
    rig.note("fang", [brief(pet, 500), mount.ok, mount.error.slice(0, 160), bite.ok, bite.error, rolls.map((roll) => roll.expression), fireDice, fireTaken, coldTaken]);
    return {
      "medium-wings-mount": () => {
        assert.equal(pet.size ?? null, "Medium", `the drake's record: ${brief(Object.keys(pet))}`);
        assert.equal(pet.fly ?? pet.speeds?.fly ?? null, pet.speed, "a flying speed equal to its walking speed");
        assert.equal(mount.ok, true, `riding the drake: ${mount.error.slice(0, 160)}`);
      },
      "bite-resist": () => {
        assert.equal(bite.ok, true, bite.error);
        assert.equal(fireDice, 2, `the bite rolled ${rolls.map((roll) => roll.expression)}: 1d6 piercing and 1d6 fire`);
        assert.deepEqual([fireTaken, coldTaken], [5, 10], "10 fire and 10 cold on the ranger, the drake's essence fire");
      },
    };
  },

  "ro::ranger::Drake's Breath": async (rig) => {
    const who = rig.hero("ranger", "Drakewarden", 11);
    const [near, far] = await rig.fight(who, { enemies: 2 });
    rig.kit.place(near.id, 5, 11);
    rig.kit.place(far.id, 5, 12);
    rig.kit.setEnemy(near.id, { stats: { immune: "cold" } });
    const tooFar = await rig.spend(who, "Drake's Breath", { variant: "fire", targetEnemyIds: [far.id] }, Array(9).fill(3));
    const farTook = 300 - rig.enemy(far.id).currentHp;
    rig.kit.freshTurn();
    const out = await rig.spend(who, "Drake's Breath", { variant: "fire", targetEnemyIds: [near.id] }, Array(9).fill(3));
    const cost = rig.budget();
    const nearTook = 300 - rig.enemy(near.id).currentHp;
    // A cone opens one way: a creature 30 feet south and one 25 feet north
    // cannot both be in it.
    rig.reset();
    const again11 = rig.hero("ranger", "Drakewarden", 11);
    const [south, north] = await rig.fight(again11, { enemies: 2 });
    rig.kit.place(south.id, 5, 11);
    rig.kit.place(north.id, 5, 0);
    const both = await rig.spend(again11, "Drake's Breath", { variant: "fire", targetEnemyIds: [south.id, north.id] }, Array(10).fill(3));
    const bothTook = [300 - rig.enemy(south.id).currentHp, 300 - rig.enemy(north.id).currentHp];
    rig.note("breath", [both.ok, both.error.slice(0, 120), bothTook, tooFar.ok, tooFar.error.slice(0, 160), farTook, out.ok, out.error.slice(0, 160), brief(out.result, 300), cost, nearTook]);
    return {
      "action-cone-type": () => {
        assert.equal(out.ok, true, out.error);
        assert.equal(cost?.actionUsed, true, `the breath cost ${brief(cost, 120)}`);
        assert.equal(nearTook, 24, `a creature immune to cold, 30 feet off, failing its save against fire, lost ${nearTook} to 8d6 of threes`);
        assert.ok(!tooFar.ok && farTook === 0, `a creature 35 feet off, beyond the 30-foot cone, lost ${farTook}`);
        assert.ok(!both.ok || bothTook.includes(0), `one breath caught a creature 30 feet south and one 25 feet north, which no cone holds: they lost ${bothTook}`);
      },
    };
  },

  "ro::ranger::Perfected Bond": async (rig) => {
    const scene = await withPet(rig, "Drakewarden", 15, { kind: "drake", form: "drake", essence: "fire", name: "Ember" });
    rig.foesTurn(scene.foe);
    await rig.enemyHits(scene.foe, scene.who, [16, 4]);
    const own = await rig.react(scene.who, "Reflexive Resistance");
    const ownHp = rig.hp(scene.who);
    const used = rig.res(scene.who, "sub_reflexive_resistance")?.used ?? null;
    rig.kit.freshRound();
    rig.foesTurn(scene.foe);
    const hurt = await rig.call("damage_pet", { characterId: scene.who.id, petName: "Ember", amount: 10, type: "cold" });
    const petHurt = petOf(rig, scene.who)?.hp;
    const pet = await rig.react(scene.who, "Reflexive Resistance", { petName: "Ember" });
    const petHp = petOf(rig, scene.who)?.hp;
    rig.note("reflexive", [own.ok, own.error, ownHp, used, hurt.ok, hurt.error, petHurt, pet.ok, pet.error, petHp, scene.pet?.maxHp]);
    return {
      reflexive: () => {
        assert.equal(own.ok, true, own.error);
        assert.deepEqual([ownHp, used], [97, 1], "half of the 6 on the ranger comes back, for a use");
        assert.equal(pet.ok, true, pet.error);
        assert.equal(petHp - petHurt, 5, "half of 10 cold on the drake comes back");
      },
    };
  },
};
