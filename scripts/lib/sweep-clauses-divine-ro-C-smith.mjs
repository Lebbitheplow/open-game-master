// Probes for the read-only clauses of the Battle Smith's steel defender,
// Arcane Jolt and Improved Defender in the divine clause ledger
// (scripts/clauses/divine.json), run in the extra suite with the rest of
// scripts/lib/sweep-clauses-divine-ro-C-extra.mjs. Keys are "ro::<ledger key>".
import { assert, modOf, castingScore, profOf } from "./sweep-clauses-divine.mjs";

const brief = (value, length = 220) => JSON.stringify(value)?.slice(0, length);
const intOf = (level) => modOf(castingScore(level));
const lost = (rig, foe, from = 300) => from - rig.enemy(foe.id).currentHp;
// The latest attack roll: listRecentRolls reads oldest first.
const d20sOfLastAttack = (rig) => rig.diceIn(rig.lastRolls(6).filter((roll) => roll.kind === "attack").at(-1), 20);

// A Battle Smith with the defender built before the fight, the defender
// beside them at (6,5), and the turn after the artificer's read off the order.
async function defenderFight(rig, summonsOf, level, equipment = undefined) {
  const who = rig.hero("artificer", "Battle Smith", level, equipment ? { equipment } : {});
  const made = await rig.spend(who, "Steel Defender");
  const [foe] = await rig.fight(who);
  const pet = rig.world.sheet(summonsOf(rig.world.campaignId, who.id)[0]?.id ?? made.result?.summoned?.characterId ?? "");
  const order = rig.world.encounter().order;
  const at = order.findIndex((entry) => entry.characterId === who.id);
  const next = order[(at + 1) % order.length]?.characterId ?? order[(at + 1) % order.length]?.enemyId ?? null;
  if (pet && rig.kit.token(pet.id)) rig.kit.place(pet.id, 6, 5);
  return { who, pet, foe, made, next };
}

export const RO_SMITH = {
  "ro::artificer::Steel Defender": async (rig) => {
    const { summonsOf } = await rig.load("lib/dm/summon-store.ts");
    const stage = await defenderFight(rig, summonsOf, 3);
    const { who, pet, foe } = stage;
    rig.foesTurn(foe);
    await rig.enemyHits(foe, pet, [16, 16, 4]);
    const atDefender = d20sOfLastAttack(rig);
    rig.kit.giveTurn(pet.id);
    const rend = await rig.kit.swing(pet.id, foe.id, [10, 4]);
    rig.kit.freshTurn();
    rig.kit.setEnemy(foe.id, { currentHp: 300, stats: { immune: "force" } });
    await rig.kit.swing(pet.id, foe.id, [18, 4]);
    const forceImmune = lost(rig, foe);
    rig.kit.setEnemy(foe.id, { currentHp: 300, stats: { immune: "" } });
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [16, 4]);
    const hurt = rig.hp(who);
    const deflect = await rig.react(pet, "Deflect Attack", { targetCharacterId: who.id }, [3]);
    const state = { next: stage.next, atDefender, rend: [rend.ok, rend.error, rend.toHit?.total, rend.damage?.expression, rend.damage?.total], forceImmune, deflect: [deflect.ok, deflect.error, brief(deflect.result, 200), hurt, rig.hp(who)] };
    rig.note("defender", state);
    return {
      "initiative-dodge": () => {
        assert.equal(stage.next, pet.id, `the turn after the artificer's belongs to ${stage.next}, not the defender`);
        assert.equal(atDefender, 2, "an attack at the defender, uncommanded, rolled one d20: it is not taking the Dodge action");
      },
      "rend-deflect": () => {
        assert.equal(rend.ok, true, rend.error);
        assert.deepEqual([rend.toHit?.total, rend.damage?.total], [10 + intOf(3) + profOf(3), 4 + profOf(3)], "Force-Empowered Rend: a 10 at the spell attack (+7), a 4 + the proficiency bonus");
        assert.equal(forceImmune, 0, `a creature immune to force lost ${forceImmune} to the rend`);
        assert.equal(deflect.ok, true, `Deflect Attack for the artificer beside the defender: ${deflect.error}`);
        assert.equal(rig.hp(who), 100, "the deflected attack (the second die a 3) still hit");
      },
    };
  },

  "ro::artificer::Arcane Jolt": async (rig) => {
    const who = rig.hero("artificer", "Battle Smith", 9, { equipment: [{ name: "+1 Longsword", qty: 1, equipped: true }] });
    const friend = rig.hero("cleric", "Life Domain", 9);
    const [foe] = await rig.fight(who);
    rig.kit.place(friend.id, 5, 12);
    rig.world.patch(friend.id, { currentHp: 50 });
    const jolt = (args, faces = [3, 3, 3, 3]) => rig.spend(who, "Arcane Jolt", args, faces);
    const unhit = await jolt({ variant: "burn", targetEnemyId: foe.id });
    await rig.kit.swing(who.id, foe.id, [18, 4]);
    const before = lost(rig, foe);
    const burn = await jolt({ variant: "burn", targetEnemyId: foe.id });
    const burned = lost(rig, foe) - before;
    const twice = await jolt({ variant: "heal", targetCharacterId: friend.id });
    rig.kit.freshTurn();
    await rig.kit.swing(who.id, foe.id, [18, 4]);
    const heal = await jolt({ variant: "heal", targetCharacterId: friend.id });
    const healed = rig.hp(friend) - 50;
    rig.kit.freshTurn();
    rig.kit.place(friend.id, 5, 13);
    await rig.kit.swing(who.id, foe.id, [18, 4]);
    const far = await jolt({ variant: "heal", targetCharacterId: friend.id });
    rig.note("jolt", { unhit: [unhit.ok, unhit.error], burn: [burn.ok, burn.error, burned], twice: [twice.ok, twice.error], heal: [heal.ok, heal.error, healed], far: [far.ok, far.error] });
    return {
      jolt: () => {
        assert.equal(unhit.ok, false, "Arcane Jolt was spent with no hit to ride");
        assert.equal(burn.ok, true, burn.error);
        assert.equal(burned, 6, `the jolt (2d6 force, two 3s) took ${burned}`);
        assert.equal(twice.ok, false, "a second jolt on the same turn was taken");
        assert.equal(heal.ok, true, heal.error);
        assert.equal(healed, 6, `the ally 30 feet from the creature hit regained ${healed}: 2d6 (two 3s)`);
        assert.equal(far.ok, false, "an ally 35 feet from the creature hit was healed");
      },
    };
  },

  "ro::artificer::Improved Defender": async (rig) => {
    const { summonsOf } = await rig.load("lib/dm/summon-store.ts");
    const { who, pet, foe } = await defenderFight(rig, summonsOf, 15, [{ name: "+1 Longsword", qty: 1, equipped: true }]);
    await rig.kit.swing(who.id, foe.id, [18, 4]);
    const jolt = await rig.spend(who, "Arcane Jolt", { variant: "burn", targetEnemyId: foe.id }, [1, 1, 1, 1]);
    const d6 = jolt.rolled.filter((die) => die.sides === 6).length;
    rig.kit.setEnemy(foe.id, { currentHp: 300 });
    rig.foesTurn(foe);
    await rig.enemyHits(foe, who, [16, 4]);
    const deflect = await rig.react(pet, "Deflect Attack", { targetCharacterId: who.id }, [3, 2]);
    const struck = lost(rig, foe);
    rig.note("improved", { jolt: [jolt.ok, jolt.error, jolt.rolled.map((die) => `${die.face}/d${die.sides}`)], deflect: [deflect.ok, deflect.error, brief(deflect.result, 200), struck] });
    return {
      "4d6": () => {
        assert.equal(jolt.ok, true, jolt.error);
        assert.equal(d6, 4, `the 15th-level jolt rolled ${d6} d6s`);
      },
      "deflect-force": () => {
        assert.equal(deflect.ok, true, `Deflect Attack: ${deflect.error}`);
        assert.ok(struck > 0, `the attacker the defender deflected took ${struck} force damage`);
      },
    };
  },
};
