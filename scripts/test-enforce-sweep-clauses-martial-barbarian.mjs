// The clause ledger's barbarian probes (scripts/clauses/martial.json names
// each by its id; scripts/lib/sweep-clauses-martial-known-barbarian.mjs holds
// the ones the engine fails today).
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-barbarian.mjs";

const { probe, test, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const NONMAGICAL = { stats: { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } };
const AXE = { equipment: [{ name: "Greataxe", qty: 1, equipped: true }] };
const BOW = { equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] };
const d20sOf = (log) => log.filter((die) => die.sides === 20).length;
const expr = (hit) => hit.damage?.breakdown?.expression ?? `no damage (${hit.error ?? "a miss"})`;
const rageBonus = (level) => (level >= 16 ? 4 : level >= 9 ? 3 : 2);

// ---- Path of the Totem Warrior ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, enemyHits, roll, sheet, foe, foeHas, budget, rage, choose, d20s, rollBy, walk, show } = r;
  const { speedFor } = await import("../src/lib/srd/index.ts");
  const { authoredSpeeds } = await import("../src/lib/srd/authored-effects.ts");
  const { liftLimits } = await import("../src/lib/dm/load-rules.ts");
  const training = await import("../src/lib/srd/subclass-training.ts");
  const totem = async (level, spirit, aspect, attunement) => {
    const who = hero("barbarian", "Path of the Totem Warrior", level, AXE);
    if (spirit) await choose(who, "Totem Spirit", spirit);
    if (aspect) await choose(who, "Aspect of the Beast", aspect);
    if (attunement) await choose(who, "Totemic Attunement", attunement);
    return who;
  };
  const ally = hero("fighter", "Champion", 5, { ac: 5 });
  const archer = hero("fighter", "Champion", 5, BOW);

  await probe("totem-spirit-while-raging", async () => {
    const bear = await totem(3, "bear");
    await kit.endFight();
    world.patch(bear.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: bear.id, amount: 10, type: "fire" });
    assert.equal(sheet(bear).currentHp, 50, "the bear's resistance holds without the rage");
  });

  await probe("totem-spirit-eagle-opportunity-attacks", async () => {
    const eagle = await totem(3, "eagle");
    const plain = await totem(3, "bear");
    const rolled = {};
    for (const [name, who] of [["eagle", eagle], ["bear", plain]]) {
      await stage(who);
      rage(who);
      world.diceLog();
      assert.equal(await walk(who, 2, 5), 200);
      rolled[name] = d20sOf(world.diceLog());
    }
    assert.deepEqual(rolled, { eagle: 2, bear: 1 }, "the opportunity attack as each pulls away");
  });

  await probe("totem-spirit-elk-speed", async () => {
    const elk = await totem(3, "elk");
    const calm = speedFor(sheet(elk));
    rage(elk);
    assert.equal(speedFor(sheet(elk)) - calm, 15);
  });

  // "Tiger adds 10 feet to your long jump and 3 feet to your high jump",
  // through the board's own move route. Strength 16: a standing long jump of
  // 8 feet is one square, and the Tiger's 10 make it three while raging.
  await probe("totem-spirit-tiger-jump", async () => {
    const moveRoute = await import("../src/app/api/campaigns/[campaignId]/battle-map/move/route.ts");
    const jump = async (who, x, y) => {
      r.world.signIn({ id: r.sheet(who).userId });
      const response = await moveRoute.POST(
        new Request(`http://odm.test/api/campaigns/${r.world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x, y, jump: true }) }),
        { params: Promise.resolve({ campaignId: r.world.campaignId }) },
      );
      return { status: response.status, body: JSON.stringify(await response.json()) };
    };
    const tiger = await totem(3, "tiger");
    await stage(tiger);
    assert.notEqual((await jump(tiger, 5, 8)).status, 200, "three squares from a standing start with no rage");
    rage(tiger);
    const leapt = await jump(tiger, 5, 8);
    assert.equal(leapt.status, 200, `a raging Tiger's standing long jump of 15 feet: ${leapt.body}`);
    assert.match(leapt.body, /"highJumpFeet":6\b/, `a standing high jump of 3 feet and the Tiger's 3: ${leapt.body}`);
    const bear = await totem(3, "bear");
    await stage(bear);
    rage(bear);
    assert.notEqual((await jump(bear, 5, 8)).status, 200, "a Bear jumps no farther for raging");
  });

  await probe("totem-spirit-wolf-allies", async () => {
    const wolf = await totem(3, "wolf");
    const [enemy] = await stage(ally, { cast: [[wolf, 6, 4], [archer, 12, 5]] });
    rage(wolf);
    assert.equal((await swing(ally, enemy, [15, 15, 4])).toHit.advantage, "advantage", "an ally's melee attack");
    kit.giveTurn(archer.id);
    assert.equal((await swing(archer, enemy, [15, 15, 4], { weapon: "Longbow" })).toHit.advantage, "none", "an ally's arrow");
    kit.place(wolf.id, 6, 2);
    kit.giveTurn(ally.id);
    assert.equal((await swing(ally, enemy, [15, 15, 4])).toHit.advantage, "none", "the creature is 15 feet from the barbarian");
  });

  await probe("aspect-of-the-beast-bear-strength", async () => {
    const bear = await totem(6, "bear", "bear");
    await kit.endFight();
    assert.equal(d20s(await roll(bear, { kind: "ability_check", ability: "str", dc: 10, about: "push_pull_lift_break" })), 2);
    assert.equal(d20s(await roll(bear, { kind: "ability_check", ability: "str", dc: 10 })), 1);
  });

  await probe("aspect-of-the-beast-bear-carrying", async () => {
    const bear = await totem(6, "bear", "bear");
    const other = await totem(6, "bear", "wolf");
    assert.equal(liftLimits(sheet(bear)).capacityLb, 2 * liftLimits(sheet(other)).capacityLb, `a Bear carries ${liftLimits(sheet(bear)).capacityLb} lb, the same as any barbarian of their Strength`);
  });

  // Elk: "the travel pace of you and up to ten companions within 60 feet of
  // you is doubled". Two hours on the road at a normal pace: 6 miles, 12 with
  // the Elk (no sky is rolled under four hours).
  await probe("aspect-of-the-beast-elk-travel", async () => {
    const elk = await totem(6, "bear", "elk");
    const plain = await totem(6, "bear", "wolf");
    await kit.endFight();
    const went = async (who) => {
      const out = await world.invoke("travel", { hours: 2, pace: "normal", characterIds: [who.id, ally.id] });
      assert.equal(out.ok, true, out.error);
      return JSON.stringify(out.result).match(/"miles":\s*([\d.]+)/)?.[1];
    };
    assert.deepEqual([await went(plain), await went(elk)], ["6", "12"], "the Elk doubles the party's pace");
  });

  // Eagle: "dim light doesn't impose disadvantage on your Wisdom (Perception)
  // checks". A passive Perception in dim light is 5 lower for anyone else.
  await probe("aspect-of-the-beast-eagle-dim-light", async () => {
    const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
    const eagle = await totem(6, "bear", "eagle");
    const plain = await totem(6, "bear", "wolf");
    await kit.endFight();
    // A clear sky: fog's own disadvantage is not the dim light's.
    await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
    const notices = async (who) => {
      const score = computeSheetDerived(sheet(who)).passivePerception;
      const out = await world.invoke("check_notice", { sense: "perception", dc: score, characterIds: [who.id], light: "dim" });
      assert.equal(out.ok, true, out.error);
      return out.result.anyNoticed;
    };
    assert.deepEqual([await notices(plain), await notices(eagle)], [false, true], "dim light costs the Eagle's Perception nothing");
  });

  // Wolf: "you can track other creatures while traveling at a fast pace, and
  // you can move stealthily while traveling at a normal pace". After a normal
  // pace march, a Stealth check is refused to the rest and open to the Wolf;
  // a tracking (Survival) check at a fast pace is open.
  await probe("aspect-of-the-beast-wolf-pace", async () => {
    const wolf = await totem(6, "bear", "wolf");
    const plain = await totem(6, "bear", "eagle");
    await kit.endFight();
    const sneaks = async (who) => {
      assert.equal((await world.invoke("travel", { hours: 1, pace: "normal", characterIds: [who.id] })).ok, true);
      return (await world.invoke("request_roll", { characterId: who.id, kind: "skill_check", skill: "stealth", dc: 10 })).ok;
    };
    assert.deepEqual([await sneaks(plain), await sneaks(wolf)], [false, true], "the Wolf moves stealthily at a normal pace");
    assert.equal((await world.invoke("travel", { hours: 1, pace: "fast", characterIds: [wolf.id] })).ok, true);
    assert.equal((await world.invoke("request_roll", { characterId: wolf.id, kind: "skill_check", skill: "survival", dc: 10 })).ok, true, "tracking at a fast pace");
  });

  await probe("aspect-of-the-beast-tiger-skills", async () => {
    const tiger = await totem(6, "tiger", "tiger");
    const grants = training.subclassGrants([{ id: "barbarian", level: 6, subclass: "Path of the Totem Warrior" }], undefined, sheet(tiger).features).filter((grant) => grant.subclass);
    assert.ok(grants.some((grant) => /aspect of the beast/i.test(grant.name)), `the Tiger's two skills have no pick: the subclass's training at 6th level is [${grants.map((grant) => grant.name).join(", ")}]`);
  });

  // "Ritual casting of beast sense and speak with animals" (3rd level) and
  // "Cast commune with nature as a ritual" (10th): as rituals, and no other way.
  await probe("spirit-seeker-rituals", async () => {
    const seeker = await totem(3, "bear");
    await kit.endFight();
    for (const spell of ["Beast Sense", "Speak with Animals"]) {
      const plain = await world.invoke("use_spell_slot", { characterId: seeker.id, spell });
      assert.equal(plain.ok, false, `${spell} cast outright, with no slot to pay for it`);
      const ritual = await world.invoke("use_spell_slot", { characterId: seeker.id, spell, ritual: true });
      assert.equal(ritual.ok, true, `${spell} as a ritual: ${ritual.error}`);
    }
    assert.equal((await world.invoke("use_spell_slot", { characterId: seeker.id, spell: "Commune with Nature", ritual: true })).ok, false, "Spirit Walker's ritual at 3rd level");
    assert.equal((await world.invoke("use_spell_slot", { characterId: seeker.id, spell: "Detect Magic", ritual: true })).ok, false, "a ritual the feature does not name");
  });
  await probe("spirit-walker-ritual", async () => {
    const walker = await totem(10, "bear", "bear");
    await kit.endFight();
    const ritual = await world.invoke("use_spell_slot", { characterId: walker.id, spell: "Commune with Nature", ritual: true });
    assert.equal(ritual.ok, true, ritual.error);
    assert.equal((await world.invoke("use_spell_slot", { characterId: walker.id, spell: "Commune with Nature" })).ok, false, "not outright");
  });
  await probe("totemic-attunement-bear", async () => {
    const bear = await totem(14, "bear", "bear", "bear");
    const [enemy] = await stage(ally, { cast: [[bear, 6, 4]] });
    rage(bear);
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "disadvantage", "a foe within 5 feet of the raging bear attacks an ally");
    world.patch(bear.id, { ac: 5, acOverride: true });
    await enemyHits(enemy, bear, [15, 4]);
    assert.equal(rollBy("attack", bear.id, enemy).advantage, "none", "and the bear");
    kit.place(bear.id, 6, 2);
    const far = await enemyHits(enemy, ally, [15, 4]);
    // The roll log keeps the millisecond, so the record of this attack and of
    // the first can tie: the swing itself says which die it kept (15 + 4).
    assert.equal(far.swings[0].rolled, 19, `and an ally with the bear 15 feet off: ${JSON.stringify(far).slice(0, 300)}`);
  });

  await probe("totemic-attunement-eagle-flight", async () => {
    const eagle = await totem(14, "eagle", "eagle", "eagle");
    const walking = speedFor(sheet(eagle));
    assert.equal(authoredSpeeds(sheet(eagle), walking).fly, undefined, "no flight without the rage");
    rage(eagle);
    assert.equal(authoredSpeeds(sheet(eagle), walking).fly, walking);
  });

  const elk = await totem(14, "elk", "elk", "elk");
  await probe("totemic-attunement-elk-trample", async () => {
    const [enemy] = await stage(elk);
    assert.equal((await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, 2)).ok, false, "not while calm");
    rage(elk);
    const dc = 8 + prof(14) + MOD;
    const out = await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([out.result.dc, out.result.saved, out.result.damage, out.result.damageType], [dc, false, 2 + MOD, "bludgeoning"], "1d12 (a 2) + Strength");
    assert.ok(foeHas(enemy, "prone"));
    assert.equal(budget().bonusUsed, true);
    kit.freshTurn();
    kit.setEnemy(enemy.id, { conditions: [] });
    const made = await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, [dc - 1, 2]);
    assert.equal(made.result.saved, true);
    assert.ok(!foeHas(enemy, "prone"));
    assert.equal(made.result.damage ?? 0, 0, "a save made: no damage");
  });
  await probe("totemic-attunement-elk-size", async () => {
    const [enemy] = await stage(elk);
    kit.setEnemy(enemy.id, { stats: { size: "Huge" } });
    rage(elk);
    const out = await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, false, "a Huge creature was trampled prone");
  });

  // "Wolf lets you knock a Large or smaller creature prone as a bonus action
  // when you hit it with a melee weapon attack."
  await probe("totemic-attunement-wolf-takedown", async () => {
    const wolf = await totem(14, "wolf", "wolf", "wolf");
    const [enemy, other] = await stage(wolf, { enemies: 2 });
    kit.place(other.id, 5, 6);
    assert.equal((await spend(wolf, "Wolf Takedown", { targetEnemyId: enemy.id })).ok, false, "not while calm");
    rage(wolf);
    const early = await spend(wolf, "Wolf Takedown", { targetEnemyId: enemy.id });
    assert.equal(early.ok, false, `with no hit landed: ${show(early)}`);
    await swing(wolf, enemy, [15, 4]);
    const elsewhere = await spend(wolf, "Wolf Takedown", { targetEnemyId: other.id });
    assert.equal(elsewhere.ok, false, `at a creature the hit did not land on: ${show(elsewhere)}`);
    const out = await spend(wolf, "Wolf Takedown", { targetEnemyId: enemy.id });
    assert.equal(out.ok, true, out.error);
    assert.ok(foeHas(enemy, "prone"), "no save: the creature is prone");
    assert.equal(budget().bonusUsed, true, "the bonus action");
    const [huge] = await stage(wolf);
    rage(wolf);
    kit.setEnemy(huge.id, { stats: { size: "Huge" } });
    await swing(wolf, huge, [15, 4]);
    assert.equal((await spend(wolf, "Wolf Takedown", { targetEnemyId: huge.id })).ok, false, "a Huge creature");
    assert.ok(!foeHas(huge, "prone"));
  });

  // "This benefit works only in short bursts; you fall if you end your turn
  // in the air and nothing else is holding you aloft": aloft on the eagle's
  // flight alone the barbarian comes down prone as the turn ends; under a Fly
  // spell they stay up.
  await probe("totemic-attunement-eagle-falls", async () => {
    const { setTokenMovement } = await import("../src/lib/db/battle-maps.ts");
    const aloft = async (extra) => {
      const eagle = await totem(14, "eagle", "eagle", "eagle");
      await stage(eagle);
      rage(eagle);
      if (extra) world.patch(eagle.id, { conditions: [...sheet(eagle).conditions, extra] });
      setTokenMovement(kit.token(eagle.id).id, "fly");
      r.endTurn();
      return [sheet(eagle).conditions.includes("prone"), kit.token(eagle.id).movement];
    };
    assert.deepEqual(await aloft(null), [true, "walk"], "on the burst alone they fall");
    assert.deepEqual(await aloft("flying"), [false, "fly"], "a Fly spell holds them up");
  });

  await probe("totemic-attunement-tiger-needs-a-run", async () => {
    const tiger = await totem(14, "tiger", "tiger", "tiger");
    const [enemy] = await stage(tiger);
    rage(tiger);
    await swing(tiger, enemy, [15, 4]);
    const out = await swing(tiger, enemy, [15, 4], { feature: "Totemic Attunement" });
    assert.equal(out.ok, false, "a Tiger who has not moved a foot made the bonus-action attack");
  });
  // The run is the board's own move: four squares straight at the dummy.
  await probe("totemic-attunement-tiger-bonus-attack", async () => {
    const tiger = await totem(14, "tiger", "tiger", "tiger");
    const [enemy] = await stage(tiger);
    rage(tiger);
    kit.place(tiger.id, 1, 5);
    assert.equal(await walk(tiger, 5, 5), 200, "the staged run was refused");
    await swing(tiger, enemy, [15, 4]);
    const out = await swing(tiger, enemy, [15, 4], { feature: "Totemic Attunement" });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "it takes the bonus action");
    assert.equal((await swing(tiger, enemy, [15, 4], { feature: "Totemic Attunement" })).ok, false, "one, as a bonus action");
    // Three squares is 15 feet.
    const [near] = await stage(tiger);
    rage(tiger);
    kit.place(tiger.id, 2, 5);
    assert.equal(await walk(tiger, 5, 5), 200);
    await swing(tiger, near, [15, 4]);
    assert.equal((await swing(tiger, near, [15, 4], { feature: "Totemic Attunement" })).ok, false, "a run of 15 feet");
    // A Huge creature is no target for it.
    const [huge] = await stage(tiger);
    rage(tiger);
    kit.setEnemy(huge.id, { stats: { size: "Huge" } });
    kit.place(tiger.id, 1, 5);
    assert.equal(await walk(tiger, 5, 5), 200);
    await swing(tiger, huge, [15, 4]);
    assert.equal((await swing(tiger, huge, [15, 4], { feature: "Totemic Attunement" })).ok, false, "a Huge creature");
  });
}

// ---- Path of the Ancestral Guardian ----
{
  const r = await openRig();
  const { world, kit, hero, stage, react, swing, enemyHits, sheet, foeHas, rage, rollBy, untilTurnOf } = r;
  const guardian = hero("barbarian", "Path of the Ancestral Guardian", 6, AXE);
  const ally = hero("fighter", "Champion", 5, { ac: 5 });

  await probe("ancestral-protectors-first-creature", async () => {
    const [first, second] = await stage(guardian, { enemies: 2 });
    kit.place(second.id, 5, 6);
    await swing(guardian, first, [15, 4]);
    assert.ok(!foeHas(first, "ancestral protectors"), "a calm barbarian's hit marks nobody");
    kit.freshTurn();
    rage(guardian);
    await swing(guardian, first, [15, 4]);
    await swing(guardian, second, [15, 4]);
    assert.ok(foeHas(first, "ancestral protectors"));
    assert.ok(!foeHas(second, "ancestral protectors"), "the second creature hit in the turn is marked too");
  });

  await probe("ancestral-protectors-resistance", async () => {
    const [enemy] = await stage(guardian, { cast: [[ally, 7, 5]] });
    rage(guardian);
    await swing(guardian, enemy, [15, 4]);
    const before = sheet(ally).currentHp;
    await enemyHits(enemy, ally, [15, 15, 4]);
    assert.equal(before - sheet(ally).currentHp, 3, "half of the club's 6");
  });

  await probe("ancestral-protectors-until-next-turn", async () => {
    const [enemy] = await stage(guardian, { cast: [[ally, 7, 5]] });
    rage(guardian);
    await swing(guardian, enemy, [15, 4]);
    r.endTurn();
    assert.ok(foeHas(enemy, "ancestral protectors"), "the mark is gone before the barbarian's next turn");
    untilTurnOf(guardian);
    assert.ok(!foeHas(enemy, "ancestral protectors"), "the mark outlives the start of the barbarian's next turn");
  });

  await probe("ancestral-protectors-rage-ends", async () => {
    const [enemy] = await stage(guardian, { cast: [[ally, 7, 5]] });
    rage(guardian);
    await swing(guardian, enemy, [15, 4]);
    const ended = await world.invoke("clear_condition", { characterId: guardian.id, condition: "raging" });
    assert.equal(ended.ok, true, ended.error);
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "none", "the rage is over and the marked creature still attacks an ally at disadvantage");
  });

  await probe("spirit-shield-who-and-where", async () => {
    const [enemy] = await stage(ally, { cast: [[guardian, 12, 5]] });
    await enemyHits(enemy, ally, [16, 4]);
    kit.place(guardian.id, 9, 5);
    assert.equal((await react(guardian, "Spirit Shield", { targetCharacterId: ally.id }, 3)).ok, false, "not while calm");
    rage(guardian);
    kit.place(guardian.id, 12, 5);
    assert.equal((await react(guardian, "Spirit Shield", { targetCharacterId: ally.id }, 3)).ok, false, "an ally 35 feet away");
    const [again] = await stage(guardian);
    rage(guardian);
    world.patch(guardian.id, { ac: 5, acOverride: true });
    await enemyHits(again, guardian, [16, 4]);
    assert.equal((await react(guardian, "Spirit Shield", {}, 3)).ok, false, "the barbarian's own hit");
  });

  await probe("spirit-shield-sight", async () => {
    const [enemy] = await stage(ally, { cast: [[guardian, 7, 5]] });
    rage(guardian);
    await enemyHits(enemy, ally, [16, 4]);
    r.give(guardian, "blinded");
    const hurt = sheet(ally).currentHp;
    const out = await react(guardian, "Spirit Shield", { targetCharacterId: ally.id }, 3);
    assert.equal(out.ok, false, `a blinded barbarian shielded an ally they cannot see (${sheet(ally).currentHp - hurt} damage taken back)`);
  });

  // "Cast augury or clairvoyance once per short or long rest, using Wisdom,
  // without a slot or components."
  await probe("consult-the-spirits-cast", async () => {
    const seer = hero("barbarian", "Path of the Ancestral Guardian", 10, AXE);
    await kit.endFight();
    const cast = await world.invoke("use_spell_slot", { characterId: seer.id, spell: "Augury" });
    assert.equal(cast.ok, true, cast.error);
    assert.equal(cast.result.slotLevel, null, "no slot");
    assert.equal(r.used(seer, "sub_consult_the_spirits"), 1);
    assert.equal((await world.invoke("use_spell_slot", { characterId: seer.id, spell: "Clairvoyance" })).ok, false, "one use between the two");
    assert.equal((await world.invoke("use_spell_slot", { characterId: seer.id, spell: "Bless" })).ok, false, "no other spell");
    await world.invoke("take_rest", { kind: "short" });
    assert.equal((await world.invoke("use_spell_slot", { characterId: seer.id, spell: "Clairvoyance" })).ok, true, "clairvoyance, with no focus worth 100 gp carried");
  });
  await probe("consult-the-spirits-wisdom", async () => {
    const { grantedCastsOf } = await import("../src/lib/srd/granted-casts.ts");
    const seer = hero("barbarian", "Path of the Ancestral Guardian", 10, AXE);
    const grants = grantedCastsOf(sheet(seer)).filter((grant) => grant.source === "Consult the Spirits");
    assert.deepEqual(grants.map((grant) => [grant.spell, grant.ability, grant.slot, grant.noMaterial]), [["Augury", "wis", "free", true], ["Clairvoyance", "wis", "free", true]]);
  });
  await probe("spirit-shield-dice", async () => {
    for (const [level, dice] of [[6, 2], [9, 2], [10, 3], [13, 3], [14, 4]]) {
      const shield = hero("barbarian", "Path of the Ancestral Guardian", level, AXE);
      const [enemy] = await stage(ally, { cast: [[shield, 7, 5]] });
      rage(shield);
      await enemyHits(enemy, ally, [16, 4]);
      world.diceLog();
      const out = await react(shield, "Spirit Shield", { targetCharacterId: ally.id }, 1);
      assert.equal(out.ok, true, out.error);
      assert.equal(world.diceLog().filter((die) => die.sides === 6).length, dice, `level ${level}`);
    }
  });
}

// ---- Path of the Storm Herald ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, sheet, foe, foeHas, budget, has, rage, choose } = r;
  const { authoredSpeeds } = await import("../src/lib/srd/authored-effects.ts");
  const herald = async (level, environment) => {
    const who = hero("barbarian", "Path of the Storm Herald", level, AXE);
    await choose(who, "Storm Environment", environment);
    return who;
  };
  const ally = hero("fighter", "Champion", 5);
  const hurt = async (who, type) => {
    world.patch(who.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: who.id, amount: 10, type });
    return 60 - sheet(who).currentHp;
  };

  await probe("storm-environment-choice", async () => {
    const who = await herald(3, "tundra");
    assert.ok(sheet(who).features.some((feature) => feature.name === "Storm Aura (Tundra)"));
  });

  // "chosen at 3rd level and changed when you gain a barbarian level": a
  // change in play is refused, and the level-up's change lands.
  await probe("storm-environment-changes-at-level-up", async () => {
    const who = await herald(4, "desert");
    await kit.endFight();
    const early = await spend(who, "Storm Environment", { variant: "sea" });
    assert.equal(early.ok, false, "the environment changed with no level gained");
    world.patch(who.id, { xp: 6500 });
    const route = await world.route("campaigns/[campaignId]/sheet");
    world.signIn({ id: sheet(who).userId });
    const res = await route.PATCH(
      new Request(`http://test/api/campaigns/${world.campaignId}/sheet`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: who.id, level: 5, levelUpChanges: [{ from: "Storm Aura (Desert)", to: "Storm Aura (Sea)" }] }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body).slice(0, 300));
    assert.deepEqual(sheet(who).features.filter((feature) => feature.name.startsWith("Storm Aura")).map((feature) => feature.name), ["Storm Aura (Sea)"]);
  });

  await probe("storm-aura-wakes-with-rage", async () => {
    const desert = await herald(20, "desert");
    const [enemy] = await stage(desert);
    const out = await spend(desert, "Rage");
    assert.equal(out.ok, true, out.error);
    assert.equal(300 - foe(enemy).currentHp, 6, `entering the rage woke no aura (the creature beside them lost ${300 - foe(enemy).currentHp}), and the bonus action it would take is spent`);
  });

  await probe("storm-aura-desert", async () => {
    for (const [level, fire] of [[3, 2], [5, 3], [10, 4], [15, 5], [20, 6]]) {
      const desert = await herald(level, "desert");
      const [near, far] = await stage(desert, { enemies: 2 });
      kit.place(near.id, 7, 5);
      kit.place(far.id, 8, 5);
      assert.equal((await spend(desert, "Storm Aura")).ok, false, "not while calm");
      rage(desert);
      const out = await spend(desert, "Storm Aura");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.deepEqual([300 - foe(near).currentHp, 300 - foe(far).currentHp], [fire, 0], `level ${level}: 10 feet and 15 feet`);
    }
  });
  await probe("storm-aura-desert-each-other-creature", async () => {
    // Below 10th level nothing shelters an ally: the aura's fire is theirs too.
    const desert = await herald(5, "desert");
    await stage(desert, { cast: [[ally, 5, 6]] });
    rage(desert);
    await spend(desert, "Storm Aura");
    assert.equal(80 - sheet(ally).currentHp, 3, "an ally standing in the aura took no fire damage");
    assert.equal(80 - sheet(desert).currentHp, 0, "each OTHER creature: not the barbarian");
    // From 10th level Shielding Storm gives the allies in the aura the
    // barbarian's own resistance to it: half of the 6 a 20th-level aura deals.
    const elder = await herald(20, "desert");
    await stage(elder, { cast: [[ally, 5, 6]] });
    rage(elder);
    await spend(elder, "Storm Aura");
    assert.equal(80 - sheet(ally).currentHp, 3, "an ally sheltered by Shielding Storm takes half");
  });

  await probe("storm-aura-sea", async () => {
    for (const [level, dice] of [[3, 1], [10, 2], [15, 3], [20, 4]]) {
      const sea = await herald(level, "sea");
      const [chosen, spared] = await stage(sea, { enemies: 2 });
      kit.place(spared.id, 5, 6);
      rage(sea);
      const failed = await spend(sea, "Storm Aura", { targetEnemyId: chosen.id }, 2);
      assert.equal(failed.ok, true, failed.error);
      assert.deepEqual([failed.result.dc, failed.result.saved, failed.result.damage, failed.result.damageType], [8 + prof(level) + MOD, false, 2 * dice, "lightning"], `level ${level}`);
      assert.equal(foe(spared).currentHp, 300, "one creature, the one chosen");
      kit.freshTurn();
      const made = await spend(sea, "Storm Aura", { targetEnemyId: chosen.id }, 20);
      assert.deepEqual([made.result.saved, made.result.damage], [true, 3 * dice], `level ${level}: half of ${dice}d6 at their most`);
    }
  });

  await probe("storm-aura-tundra", async () => {
    for (const [level, temp] of [[3, 2], [10, 4], [20, 6]]) {
      const tundra = await herald(level, "tundra");
      await stage(tundra, { cast: [[ally, 5, 6]] });
      rage(tundra);
      const out = await spend(tundra, "Storm Aura");
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(ally).tempHp, temp, `level ${level}`);
    }
  });

  await probe("storm-soul", async () => {
    await kit.endFight();
    const desert = await herald(6, "desert");
    const sea = await herald(6, "sea");
    const tundra = await herald(6, "tundra");
    assert.deepEqual([await hurt(desert, "fire"), await hurt(desert, "cold")], [5, 10]);
    assert.deepEqual([await hurt(sea, "lightning"), await hurt(sea, "fire")], [5, 10]);
    assert.deepEqual([await hurt(tundra, "cold"), await hurt(tundra, "lightning")], [5, 10]);
    assert.equal(authoredSpeeds(sheet(sea), 30).swim, 30);
    assert.equal(authoredSpeeds(sheet(desert), 30).swim, undefined);
  });

  await probe("shielding-storm", async () => {
    const desert = await herald(10, "desert");
    await stage(desert, { cast: [[ally, 5, 6]] });
    assert.equal(await hurt(ally, "fire"), 10, "no aura, no shelter");
    rage(desert);
    await spend(desert, "Storm Aura");
    assert.equal(await hurt(ally, "fire"), 5, "an ally in the aura");
    assert.equal(await hurt(ally, "cold"), 10, "the desert's own type only");
    kit.place(ally.id, 5, 9);
    assert.equal(await hurt(ally, "fire"), 10, "an ally 20 feet off");
  });

  await probe("raging-storm-desert", async () => {
    const desert = await herald(14, "desert");
    const [enemy] = await stage(desert);
    rage(desert);
    await spend(desert, "Storm Aura");
    world.patch(desert.id, { ac: 5, acOverride: true });
    await enemyHits(enemy, desert, [16, 4]);
    const before = foe(enemy).currentHp;
    const out = await react(desert, "Raging Storm", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(enemy).currentHp, 7, "half the barbarian level in fire");
    assert.match(out.result.save, new RegExp(`vs DC ${8 + prof(14) + MOD}$`));
  });
  await probe("raging-storm-sea", async () => {
    const sea = await herald(14, "sea");
    const [enemy] = await stage(sea);
    rage(sea);
    await spend(sea, "Storm Aura", { targetEnemyId: enemy.id }, 2);
    await swing(sea, enemy, [15, 4]);
    const out = await react(sea, "Raging Storm", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.ok(foeHas(enemy, "prone"));
  });
  await probe("raging-storm-tundra", async () => {
    for (const [level, held] of [[10, false], [14, true]]) {
      const tundra = await herald(level, "tundra");
      const [enemy] = await stage(tundra);
      rage(tundra);
      const out = await spend(tundra, "Storm Aura", { targetEnemyId: enemy.id }, 2);
      assert.equal(out.ok, true, out.error);
      assert.equal(foeHas(enemy, "raging storm"), held, `level ${level}`);
      if (held) assert.equal(foe(enemy).conditionMeta["raging storm (tundra)"]?.rounds, 1);
    }
  });
}

// ---- Path of the Zealot ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, sheet, foe, has, rage, forced } = r;

  // "If a spell, such as raise dead, has the sole effect of restoring you to
  // life (but not undeath), the caster doesn't need material components to
  // cast that spell on you": a priest with no diamond raises the dead zealot
  // with Revivify, and cannot raise a dead fighter the same way.
  await probe("warrior-of-the-gods-no-diamond", async () => {
    await kit.endFight();
    const priest = hero("cleric", "Life Domain", 5, { equipment: [], gold: 0, spellcasting: { ability: "wis", slots: { 3: { max: 2, used: 0 } }, prepared: ["Revivify"], known: [], cantrips: [] } });
    const dead = (who) => world.patch(who.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
    const zealot = hero("barbarian", "Path of the Zealot", 3, AXE);
    const fighter = hero("fighter", "Champion", 3);
    dead(zealot);
    dead(fighter);
    const other = await world.invoke("heal", { characterId: fighter.id, casterId: priest.id, spell: "Revivify", level: 3 });
    assert.equal(other.ok, false, "a fighter's Revivify still asks for the diamond");
    const out = await world.invoke("heal", { characterId: zealot.id, casterId: priest.id, spell: "Revivify", level: 3 });
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(zealot).deathSaves?.dead ?? false, false, "the zealot is back");
    assert.equal(sheet(priest).spellcasting.slots[3].used, 1, "the slot is still paid");
  });

  await probe("divine-fury", async () => {
    for (const level of [5, 14]) {
      const zealot = hero("barbarian", "Path of the Zealot", level, AXE);
      const fury = `+1d6+${Math.floor(level / 2)}`;
      const [enemy] = await stage(zealot);
      assert.ok(!expr(await swing(zealot, enemy, [15, 4, 4])).includes("1d6"), "not while calm");
      kit.freshTurn();
      rage(zealot);
      assert.ok(expr(await swing(zealot, enemy, [15, 4, 4])).endsWith(fury), `level ${level}: the first hit of the turn`);
      assert.ok(!expr(await swing(zealot, enemy, [15, 4, 4])).includes("1d6"), "the second hit of the turn");
      kit.freshTurn();
      kit.setEnemy(enemy.id, { stats: { immune: "radiant, necrotic" } });
      const before = foe(enemy).currentHp;
      await swing(zealot, enemy, [15, 4, 4]);
      assert.equal(before - foe(enemy).currentHp, 4 + MOD + rageBonus(level), "a creature immune to both types takes the axe alone");
    }
  });

  const presence = hero("barbarian", "Path of the Zealot", 10, AXE);
  const near = hero("fighter", "Champion", 5);
  const far = hero("fighter", "Champion", 5);
  await probe("zealous-presence", async () => {
    await stage(presence);
    const out = await r.spend(presence, "Zealous Presence");
    assert.equal(out.ok, true, out.error);
    assert.equal(r.budget().bonusUsed, true, "the bonus action");
  });
  await probe("zealous-presence-advantage", async () => {
    const [enemy] = await stage(presence, { cast: [[near, 5, 9], [far, 19, 14]] });
    kit.place(enemy.id, 5, 10);
    await r.spend(presence, "Zealous Presence");
    kit.giveTurn(near.id);
    const swung = await swing(near, enemy, [15, 15, 4]);
    const saved = await r.roll(near, { kind: "saving_throw", ability: "dex", dc: 10 }, [10, 10]);
    const farSave = await r.roll(far, { kind: "saving_throw", ability: "dex", dc: 10 }, [10, 10]);
    assert.deepEqual(
      [swung.toHit?.advantage, r.d20s(saved), r.d20s(farSave)],
      ["advantage", 2, 1],
      `an ally 20 feet off attacks and saves with [${swung.toHit?.advantage}, ${r.d20s(saved)} d20s]; one 70 feet off saves with ${r.d20s(farSave)}`,
    );
  });

  await probe("rage-beyond-death-stays-up", async () => {
    const zealot = hero("barbarian", "Path of the Zealot", 14, { ...AXE, ac: 5 });
    const [enemy] = await stage(zealot);
    rage(zealot);
    world.patch(zealot.id, { currentHp: 3 });
    // The club's 16 to hit and 4 + 2, then Relentless Rage's save on a 1.
    await forced([16, 4, 1, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: zealot.id }));
    assert.equal(sheet(zealot).currentHp, 0, "setup: the blow dropped them");
    assert.ok(has(zealot, "raging") && !has(zealot, "unconscious"), `at 0 hit points the raging zealot is ${sheet(zealot).conditions.join(", ")}`);
  });
  // The zealot dropped by a blow while raging, as the engine leaves them.
  const dropped = async (level = 14) => {
    const zealot = hero("barbarian", "Path of the Zealot", level, { ...AXE, ac: 5 });
    const [enemy] = await stage(zealot);
    rage(zealot);
    world.patch(zealot.id, { currentHp: 3 });
    await forced([16, 4, 1, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: zealot.id }));
    assert.equal(sheet(zealot).currentHp, 0, "setup: the blow dropped them");
    return { zealot, enemy };
  };
  const hurt = (who) => world.invoke("apply_damage", { characterId: who.id, amount: 3, type: "slashing" });
  await probe("rage-beyond-death-death-saves", async () => {
    const { zealot, enemy } = await dropped();
    assert.deepEqual([sheet(zealot).deathSaves?.failures, sheet(zealot).deathSaves?.dead], [0, false], "dying, with a track");
    await hurt(zealot);
    assert.equal(sheet(zealot).deathSaves?.failures, 1, "damage at 0 hit points is a death save failure");
    // Up, they act: an attack of their own at 0 hit points.
    kit.giveTurn(zealot.id);
    const struck = await swing(zealot, enemy, [15, 4]);
    assert.equal(struck.ok, true, `a zealot raging at 0 hit points cannot attack: ${struck.error}`);
    // And the server still rolls their death saves.
    const { rollDeathSave } = await import("../src/lib/dm/death.ts");
    const line = await forced([5], () => rollDeathSave(world.campaign(), zealot.id));
    assert.match(String(line), /failure/, `their death save: ${line}`);
    assert.equal(sheet(zealot).deathSaves?.failures, 2);
    // Below 14th level the same blow knocks a raging zealot out.
    const young = await dropped(10);
    assert.ok(has(young.zealot, "unconscious") && !has(young.zealot, "raging"), `a 10th-level zealot at 0 is ${sheet(young.zealot).conditions.join(", ")}`);
  });
  await probe("rage-beyond-death-no-death", async () => {
    const zealot = hero("barbarian", "Path of the Zealot", 14, AXE);
    await stage(zealot);
    world.patch(zealot.id, { currentHp: 0, conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } }, deathSaves: { successes: 0, failures: 2, stable: false, dead: false } });
    const out = await world.invoke("apply_damage", { characterId: zealot.id, amount: 3, type: "slashing" });
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(zealot).deathSaves?.dead, false, "a third death save failure while raging killed the zealot");
    assert.equal(sheet(zealot).deathSaves?.failures, 3, "the failure is still counted");
    // "You don't die until your rage ends": it ends, and they do.
    const first = await dropped();
    for (let blow = 0; blow < 3; blow += 1) await hurt(first.zealot);
    assert.deepEqual([sheet(first.zealot).deathSaves?.failures, sheet(first.zealot).deathSaves?.dead], [3, false], "three failures, held off");
    await world.invoke("clear_condition", { characterId: first.zealot.id, condition: "raging" });
    r.endTurn();
    assert.equal(sheet(first.zealot).deathSaves?.dead, true, "the rage ended at 0 hit points with three failures, and the zealot lives");
    // "And then only if you still have 0 hit points": healed first, they live.
    const second = await dropped();
    for (let blow = 0; blow < 3; blow += 1) await hurt(second.zealot);
    await world.invoke("heal", { characterId: second.zealot.id, amount: 5 });
    await world.invoke("clear_condition", { characterId: second.zealot.id, condition: "raging" });
    r.endTurn();
    assert.equal(Boolean(sheet(second.zealot).deathSaves?.dead), false, "healed above 0 before the rage ended, the zealot died all the same");
    // The rage over at 0 with fewer than three failures: they fall, dying.
    const third = await dropped();
    await world.invoke("clear_condition", { characterId: third.zealot.id, condition: "raging" });
    r.endTurn();
    assert.ok(has(third.zealot, "unconscious") && !sheet(third.zealot).deathSaves?.dead, `once the rage ends at 0 hit points they are ${sheet(third.zealot).conditions.join(", ") || "standing"}`);
  });
}

// ---- Path of the Beast ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, sheet, foe, rage, show } = r;
  const beast = hero("barbarian", "Path of the Beast", 14);
  const ally = hero("fighter", "Champion", 5);

  await probe("form-of-the-beast-while-raging", async () => {
    const [enemy] = await stage(beast);
    assert.equal((await swing(beast, enemy, [15, 4], { weapon: "Claws" })).ok, false, "no claws while calm");
  });
  await probe("form-of-the-beast-one-weapon", async () => {
    const [enemy] = await stage(beast);
    rage(beast);
    const claws = await swing(beast, enemy, [15, 4], { weapon: "Claws" });
    const bite = await swing(beast, enemy, [15, 4], { weapon: "Bite" });
    assert.deepEqual([claws.ok, bite.ok], [true, false], "in one rage the barbarian clawed and then bit");
    assert.equal((await swing(beast, enemy, [15, 4], { weapon: "Claws" })).ok, true, "the weapon grown is theirs for the rage");
    // The rage over, the next one grows anew.
    await world.invoke("clear_condition", { characterId: beast.id, condition: "raging" });
    r.endTurn();
    const [again] = await stage(beast);
    rage(beast);
    assert.equal((await swing(beast, again, [15, 4], { weapon: "Bite" })).ok, true, "a new rage, a new weapon");
  });
  await probe("form-of-the-beast-tail-reaction", async () => {
    const [enemy] = await stage(beast);
    rage(beast);
    world.patch(beast.id, { ac: 13, acOverride: true });
    await enemyHits(enemy, beast, [16, 4]);
    const before = sheet(beast).currentHp;
    const out = await react(beast, "Form of the Beast", {}, [8]);
    assert.ok(out.ok && sheet(beast).currentHp > before, `the tail's 1d8 (an 8) on AC 13 against a 20 turned nothing: ${show(out)}`);
    // The tail is the weapon this rage grew: the claws are not.
    kit.giveTurn(beast.id);
    assert.equal((await swing(beast, enemy, [15, 4], { weapon: "Claws" })).ok, false, "claws in the rage that grew the tail");
    // A 1 on the die: 20 against AC 14 still hits.
    const [other] = await stage(beast);
    rage(beast);
    world.patch(beast.id, { ac: 13, acOverride: true });
    await enemyHits(other, beast, [16, 4]);
    const hurt = sheet(beast).currentHp;
    await react(beast, "Form of the Beast", {}, [1]);
    assert.equal(sheet(beast).currentHp, hurt, "a 1 on the d8 turns nothing");
    // Beyond 10 feet, and while calm, there is no tail to raise.
    const [far] = await stage(beast);
    world.patch(beast.id, { ac: 13, acOverride: true });
    await enemyHits(far, beast, [16, 4]);
    assert.equal((await react(beast, "Form of the Beast", {}, [8])).ok, false, "not while calm");
  });

  const lostTo = async (weapon) => {
    const [enemy] = await stage(beast);
    rage(beast);
    kit.setEnemy(enemy.id, NONMAGICAL);
    const hit = await swing(beast, enemy, [15, 4], { weapon });
    assert.equal(hit.result.hit, true, hit.error);
    return 300 - foe(enemy).currentHp;
  };
  await probe("bestial-soul-magical", async () => {
    assert.equal(await lostTo("Claws"), 4 + MOD + rageBonus(14), "claws through resistance to nonmagical weapons");
  });
  await probe("bestial-soul-natural-weapons-only", async () => {
    const lost = await lostTo("Longsword");
    assert.equal(lost, Math.floor((4 + MOD + rageBonus(14)) / 2), `a longsword in the same hands deals ${lost} through resistance to nonmagical weapons`);
  });
  // "A natural-weapon hit forces a Wisdom save: the target either attacks a
  // creature of your choice or takes 2d12 psychic damage."
  await probe("infectious-fury", async () => {
    const fury = (enemy, variant, faces) => spend(beast, "Infectious Fury", { targetEnemyId: enemy.id, variant }, faces);
    const [enemy] = await stage(beast);
    rage(beast);
    const idle = await fury(enemy, "damage", 2);
    assert.equal(idle.ok, false, `with no hit landed: ${show(idle)}`);
    await swing(beast, enemy, [15, 4], { weapon: "Longsword" });
    const sword = await fury(enemy, "damage", 2);
    assert.equal(sword.ok, false, `after a sword's hit: ${show(sword)}`);
    assert.equal(r.used(beast, "sub_infectious_fury"), 0, "a refusal spends nothing");
    kit.freshTurn();
    await swing(beast, enemy, [15, 4], { weapon: "Claws" });
    const before = foe(enemy).currentHp;
    const failed = await fury(enemy, "damage", 2);
    assert.equal(failed.ok, true, failed.error);
    assert.deepEqual([failed.result.dc, failed.result.saved, before - foe(enemy).currentHp], [8 + prof(14) + MOD, false, 4], "2d12 psychic at 2 each on a failed Wisdom save");
    assert.equal(r.used(beast, "sub_infectious_fury"), 1);
    kit.freshTurn();
    await swing(beast, enemy, [15, 4], { weapon: "Claws" });
    const held = foe(enemy).currentHp;
    const made = await fury(enemy, "damage", 20);
    assert.deepEqual([made.result.saved, held - foe(enemy).currentHp], [true, 0], "a save made: nothing");
    // "Or it must use its reaction to make a melee attack against another
    // creature of your choice": the creature named, struck by the one that
    // failed, with its reaction and not its action.
    const [cursed, other] = await stage(beast, { enemies: 2 });
    kit.place(other.id, 7, 5);
    rage(beast);
    await swing(beast, cursed, [15, 4], { weapon: "Claws" });
    // With no creature named the call is refused before the save, nothing
    // spent: the Hand's card takes that creature as its second pick
    // (hand-subclass.ts forcedVictim), so no attack is left to a GM's line.
    const usedBefore = r.used(beast, "sub_infectious_fury");
    const unnamed = await fury(cursed, "attack", 2);
    assert.equal(unnamed.ok, false, `with no creature named: ${show(unnamed)}`);
    assert.match(String(unnamed.error), /targetEnemyIds/, show(unnamed));
    assert.equal(r.used(beast, "sub_infectious_fury"), usedBefore, "a refusal spends nothing");
    assert.ok(!world.encounter().reactionsUsed.includes(cursed.id), "no attack was made, and its reaction is kept");
    kit.freshTurn();
    await swing(beast, cursed, [15, 4], { weapon: "Claws" });
    const spentBefore = r.used(beast, "sub_infectious_fury");
    const struck = foe(other).currentHp;
    const turned = await r.forced([2, 18, 4, 4], () => world.invoke("use_resource", { characterId: beast.id, resource: "Infectious Fury", variant: "attack", targetEnemyId: cursed.id, targetEnemyIds: [other.id] }));
    assert.equal(turned.ok, true, turned.error);
    assert.equal(turned.result.saved, false, show(turned));
    assert.ok(struck - foe(other).currentHp > 0, `the creature that failed struck nobody: ${JSON.stringify(turned.result.forcedAttack).slice(0, 300)}`);
    assert.ok(world.encounter().reactionsUsed.includes(cursed.id), "the attack took its reaction");
    assert.equal(r.used(beast, "sub_infectious_fury"), spentBefore + 1);
    kit.freshTurn();
    await swing(beast, cursed, [15, 4], { weapon: "Claws" });
    const again = await spend(beast, "Infectious Fury", { variant: "attack", targetEnemyId: cursed.id, targetEnemyIds: [other.id] }, 2);
    assert.equal(again.ok, false, `a creature with no reaction left was made to attack again: ${show(again)}`);
  });
  await probe("bestial-soul-adapt", async () => {
    await kit.endFight();
    const out = await spend(beast, "Bestial Soul", { variant: "swim" });
    assert.equal(out.ok, true, `no way to take the swim, climb or jump option: ${show(out)}`);
    const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
    // "A swimming speed equal to your walking speed": the speed the barbarian
    // walks at, Fast Movement in it, not the species' 30 on the sheet (this
    // once read sheet.speed, which src/lib/srd/index.ts otherSpeeds did too).
    const { speedFor: walks } = await import("../src/lib/srd/index.ts");
    const walking = walks(sheet(beast));
    assert.equal(walking, sheet(beast).speed + 10, "Fast Movement is in the walking speed");
    assert.equal(computeSheetDerived(sheet(beast)).speeds?.swim, walking, "a swimming speed equal to the walking speed");
    assert.equal((await spend(beast, "Bestial Soul", { variant: "climb" })).ok, true, "changed after a rest");
    assert.deepEqual([computeSheetDerived(sheet(beast)).speeds?.swim, computeSheetDerived(sheet(beast)).speeds?.climb], [undefined, walking], "climb in its place");
    assert.equal((await spend(beast, "Bestial Soul", { variant: "jump" })).ok, true);
    await stage(beast);
    assert.equal((await spend(beast, "Bestial Soul", { variant: "swim" })).ok, false, "not in the middle of a fight");
  });

  await probe("call-the-hunt-allies", async () => {
    const far = hero("fighter", "Champion", 5);
    await stage(beast, { cast: [[ally, 5, 6], [far, 5, 13]] });
    // Raging with no rage entered this turn: nothing on record to answer.
    rage(beast);
    const early = await spend(beast, "Call the Hunt");
    assert.equal(early.ok, false, `Call the Hunt answered a rage entered on no turn: ${show(early)}`);
    world.patch(beast.id, { conditions: [], conditionMeta: {} });
    const raged = await spend(beast, "Rage");
    assert.equal(raged.ok, true, raged.error);
    const out = await spend(beast, "Call the Hunt");
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(beast).tempHp, 5, `one ally within 30 feet accepted: ${sheet(beast).tempHp} temporary hit points`);
    assert.ok(sheet(ally).conditions.includes("call the hunt"), `the ally carries [${sheet(ally).conditions.join(", ")}]`);
    assert.ok(!sheet(far).conditions.includes("call the hunt"), "the fighter 40 feet off was called too");
    // On the ally's turn the d6 rides one hit, not the second.
    const [enemy] = world.enemies();
    kit.giveTurn(ally.id);
    kit.freshRound();
    const first = await swing(ally, kit.enemy(enemy.id), [15, 4, 4, 4]);
    assert.match(expr(first), /1d6/, `the ally's first hit: ${expr(first)}`);
    const second = await swing(ally, kit.enemy(enemy.id), [15, 4, 4, 4]);
    assert.doesNotMatch(expr(second), /1d6/, `the second hit of the turn: ${expr(second)}`);
    // The rage ends: so does the call.
    world.patch(beast.id, { conditions: [], conditionMeta: {} });
    kit.freshRound();
    const after = await swing(ally, kit.enemy(enemy.id), [15, 4, 4, 4]);
    assert.doesNotMatch(expr(after), /1d6/, `after the rage ended: ${expr(after)}`);
    assert.ok(!sheet(ally).conditions.includes("call the hunt"), "the call outlived the rage");
  });
}

// ---- Path of Wild Magic ----
{
  const r = await openRig();
  const { world, hero, stage, spend, react } = r;
  const wild = hero("barbarian", "Path of Wild Magic", 14);

  // "you know the location of any spell or magic item within 60 feet of you
  // that isn't behind total cover. When you sense a spell, you learn which
  // school of magic it belongs to": a friend 20 feet off holding Bless and a
  // Cloak of Protection is sensed, with the spell's school; a friend 80 feet
  // off with the same is not.
  await probe("magic-awareness-senses", async () => {
    const near = hero("cleric", "Life Domain", 5, { equipment: [{ name: "Cloak of Protection", qty: 1, equipped: true }] });
    const far = hero("cleric", "Life Domain", 5, { equipment: [{ name: "Cloak of Protection", qty: 1, equipped: true }] });
    await stage(wild, { cast: [[near, 9, 5], [far, 21, 5]] });
    world.patch(near.id, { name: "Near Priest", concentratingOn: "Bless" });
    world.patch(far.id, { name: "Far Priest", concentratingOn: "Bless" });
    r.kit.place(wild.id, 5, 5);
    const out = await spend(wild, "Magic Awareness");
    assert.equal(out.ok, true, out.error);
    const told = JSON.stringify(out.result);
    assert.match(told, /enchantment on Near Priest/, `the spell and its school: ${told.slice(0, 300)}`);
    assert.match(told, /magic item carried by Near Priest/);
    assert.doesNotMatch(told, /Far Priest/, "80 feet off is beyond the 60");
  });

  const surged = (who, n) => r.has(who, `wild surge (${n})`);
  // "When you enter your rage, roll a d8 for a magical effect that lasts the rage."
  await probe("wild-surge-rolls", async () => {
    const young = hero("barbarian", "Path of Wild Magic", 3);
    await stage(young);
    world.diceLog();
    const out = await spend(young, "Rage", {}, [4]);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.diceLog().filter((die) => die.sides === 8).length, 1, "entering the rage rolled no d8");
    assert.ok(surged(young, 4) && /^4:/.test(String(out.result.surge)), `the effect rolled is in force: ${r.show(out)}`);
    await world.invoke("clear_condition", { characterId: young.id, condition: "raging" });
    r.endTurn();
    assert.ok(!surged(young, 4), "the surge outlived the rage");
  });
  // The table, effect by effect, with the d8 forced: DC 8 + 2 + 3 at 3rd level.
  await probe("wild-surge-table", async () => {
    const { featureTeleportFeet } = await import("../src/lib/dm/feature-teleport.ts");
    const young = hero("barbarian", "Path of Wild Magic", 3, { ...AXE, ac: 5 });
    const near = hero("fighter", "Champion", 5, { ac: 12 });
    const far = hero("fighter", "Champion", 5);
    const enter = async (faces, cast = []) => {
      const [enemy] = await stage(young, { cast });
      const out = await spend(young, "Rage", {}, faces);
      assert.equal(out.ok, true, out.error);
      return { enemy, out };
    };
    const lost = (enemy) => 300 - r.foe(enemy).currentHp;
    // 1: the d12 (5), the creature's save (a 2), the temporary hit points (7).
    const one = await enter([1, 5, 2, 7]);
    assert.deepEqual([lost(one.enemy), r.sheet(young).tempHp], [5, 7], `1: ${r.show(one.out)}`);
    const saved = await enter([1, 5, 20, 7]);
    assert.equal(lost(saved.enemy), 0, "1: a Constitution save made");
    // 2: the teleport, credited for move_token.
    await enter([2]);
    assert.equal(featureTeleportFeet(young.id, "Wild Surge"), 30, "2: no 30-foot teleport credited");
    r.kit.freshTurn();
    assert.equal((await spend(young, "Wild Surge Teleport")).ok, true, "2: again as a bonus action");
    assert.equal(r.budget().bonusUsed, true);
    assert.equal((await spend(young, "Wild Surge Bolt")).ok, false, "8's repeat is not 2's");
    // 3: the spirit's d6 (4) and the Dexterity save (a 2).
    const three = await enter([3, 4, 2]);
    assert.equal(lost(three.enemy), 4, `3: ${r.show(three.out)}`);
    r.kit.freshTurn();
    assert.equal((await spend(young, "Wild Surge Spirit", { targetEnemyId: three.enemy.id }, [4, 2])).ok, true);
    assert.equal(lost(three.enemy), 8, "3: again as a bonus action");
    // 4: the weapon in hand deals force.
    const four = await enter([4]);
    const hit = await r.swing(young, four.enemy, [15, 4]);
    assert.equal(hit.result.damageType, "force", `4: the greataxe deals ${hit.result.damageType}`);
    // 5: a creature that hits the barbarian takes 1d6 force (a 3).
    const five = await enter([5]);
    await r.forced([16, 4, 3], () => world.invoke("enemy_attack", { enemyId: five.enemy.id, targetCharacterId: young.id }));
    assert.equal(lost(five.enemy), 3, "5: nothing came back at the creature that hit");
    // 6: +1 AC for the barbarian and the ally within 10 feet, not the one 40 feet off.
    const six = await enter([6], [[near, 5, 7], [far, 5, 13]]);
    assert.deepEqual([r.has(young, "wild surge ward"), r.has(near, "wild surge ward"), r.has(far, "wild surge ward")], [true, true, false], "6");
    r.kit.place(six.enemy.id, 6, 7);
    const hp = r.sheet(near).currentHp;
    await r.enemyHits(six.enemy, near, [8, 4]);
    assert.equal(r.sheet(near).currentHp, hp, "6: a 12 to hit against AC 12 + 1 is a miss");
    // 7: the ground around them, on the board.
    await enter([7]);
    assert.ok((r.kit.map().spellZones ?? []).some((zone) => zone.spell === "Wild Surge" && zone.casterId === young.id), "7: no difficult ground on the board");
    // 8: the bolt's d6 (3), and blindness on a failed Constitution save.
    const eight = await enter([8, 3, 2]);
    assert.equal(lost(eight.enemy), 3, `8: ${r.show(eight.out)}`);
    assert.ok(r.foeHas(eight.enemy, "blinded"), "8: a failed save and no blindness");
    const sighted = await enter([8, 3, 20]);
    assert.deepEqual([lost(sighted.enemy), r.foeHas(sighted.enemy, "blinded")], [3, false], "8: the damage lands, the save spares the eyes");
  });
  // "Whenever you roll on the wild magic table, roll twice and choose either
  // effect; if both dice show the same number, choose any effect on the table."
  await probe("controlled-surge", async () => {
    await stage(wild);
    world.diceLog();
    const out = await spend(wild, "Rage", {}, [3, 7]);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.diceLog().filter((die) => die.sides === 8).length, 2, "two d8s");
    assert.ok(r.has(wild, "wild surge pending") && !surged(wild, 3) && !surged(wild, 7), `the two rolls wait on the choice: ${r.show(out)}`);
    assert.equal((await spend(wild, "Controlled Surge", { variant: "5" })).ok, false, "a number neither die shows");
    const chosen = await spend(wild, "Controlled Surge", { variant: "7" });
    assert.equal(chosen.ok, true, chosen.error);
    assert.ok(surged(wild, 7) && !r.has(wild, "wild surge pending"));
    assert.equal(r.budget().actionUsed ?? false, false, "the choice costs nothing of the turn");
    await stage(wild);
    await spend(wild, "Rage", {}, [4, 4]);
    assert.equal((await spend(wild, "Controlled Surge", { variant: "6" })).ok, true, "both dice the same: any effect of the table");
    assert.ok(surged(wild, 6));
  });
  await probe("bolstering-magic-d3", async () => {
    const bolster = hero("barbarian", "Path of Wild Magic", 6);
    const friend = hero("fighter", "Champion", 5);
    const [enemy] = await stage(bolster, { cast: [[friend, 5, 6]] });
    const out = await spend(bolster, "Bolstering Magic", { targetCharacterId: friend.id, variant: "bolster" });
    assert.equal(out.ok, true, out.error);
    assert.equal(r.budget().actionUsed, true, "an action");
    assert.equal(r.sheet(friend).conditionMeta["bolstering magic (d3)"]?.rounds, 100, "10 minutes");
    r.kit.giveTurn(friend.id);
    r.kit.place(enemy.id, 6, 6);
    const swung = await r.swing(friend, enemy, [15, 2, 4]);
    // The roll record's own expression: a record's ids are hex and can hold
    // "d3" by chance.
    const expression = String(swung.toHit?.breakdown?.expression ?? swung.toHit?.expression ?? "");
    assert.match(expression, /\bd3\b|\dd3\b/, `the touched ally's attack adds no d3: ${expression.slice(0, 200)}; the spend said ${r.show(out)}`);
    // "And ability checks", every one of the 10 minutes, not one.
    for (const turn of [1, 2]) {
      const check = await r.roll(friend, { kind: "ability_check", ability: "str", dc: 10 }, [10, 2]);
      assert.equal(check.dice?.some((term) => term.sides === 3), true, `ability check ${turn} adds no d3: ${JSON.stringify(check.dice).slice(0, 200)}`);
    }
    const save = await r.roll(friend, { kind: "saving_throw", ability: "str", dc: 10 }, [10, 2]);
    assert.equal(save.dice?.some((term) => term.sides === 3), false, "not saving throws");
  });
  // "Or it rolls a d3 and regains one expended spell slot of that level or
  // lower (a creature can take the slot only once per long rest)."
  await probe("bolstering-magic-slot", async () => {
    const bolster = hero("barbarian", "Path of Wild Magic", 6);
    const mage = hero("wizard", "School of Evocation", 5, { spellcasting: { ability: "int", slots: { 1: { max: 4, used: 2 }, 2: { max: 3, used: 2 }, 3: { max: 2, used: 2 } }, prepared: [], known: [], cantrips: [] } });
    await stage(bolster, { cast: [[mage, 5, 6]] });
    const slots = () => Object.values(r.sheet(mage).spellcasting.slots).map((slot) => slot.used);
    const out = await spend(bolster, "Bolstering Magic", { targetCharacterId: mage.id, variant: "slot" }, 2);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(slots(), [2, 1, 2], `a 2 on the d3: one 2nd-level slot back (${r.show(out)})`);
    r.kit.freshTurn();
    const again = await spend(bolster, "Bolstering Magic", { targetCharacterId: mage.id, variant: "slot" }, 2);
    assert.equal(again.ok, false, "the same creature takes the slot only once per long rest");
    assert.deepEqual(slots(), [2, 1, 2]);
    assert.equal(r.used(bolster, "sub_bolstering_magic"), 1, "the refusal spends nothing");
    await r.kit.endFight();
    assert.equal((await world.invoke("take_rest", { kind: "long" })).ok, true);
    assert.ok(!r.has(mage, "bolstered slot"), "a long rest, and the creature may take one again");
  });

  // "When you take damage or fail a save while raging, a reaction rerolls
  // your Wild Surge effect."
  await probe("unstable-backlash", async () => {
    const tenth = hero("barbarian", "Path of Wild Magic", 10, { ac: 5 });
    const [enemy] = await stage(tenth);
    assert.equal((await spend(tenth, "Rage", {}, [4])).ok, true);
    const idle = await react(tenth, "Unstable Backlash", {}, [6]);
    assert.equal(idle.ok, false, `with no damage taken and no save failed: ${r.show(idle)}`);
    assert.ok(surged(tenth, 4), "a refusal rerolls nothing");
    await r.enemyHits(enemy, tenth, [16, 4]);
    world.diceLog();
    const out = await react(tenth, "Unstable Backlash", {}, [6]);
    assert.equal(out.ok, true, out.error);
    assert.ok(world.diceLog().some((die) => die.sides === 8), "no d8 rolled");
    assert.ok(surged(tenth, 6) && !surged(tenth, 4), `the new effect replaces the old: ${r.show(out)}`);
    assert.ok(world.encounter().reactionsUsed.includes(tenth.id), "the reaction");
    const [calm] = await stage(tenth);
    await r.enemyHits(calm, tenth, [16, 4]);
    assert.equal((await react(tenth, "Unstable Backlash", {}, [6])).ok, false, "not while calm");
  });
}

// ---- Path of the Giant ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, foeHas, budget, rage, choose, show } = r;
  const giant = async (level, element, gear = AXE) => {
    const who = hero("barbarian", "Path of the Giant", level, gear);
    if (element) await choose(who, "Elemental Cleaver", element);
    return who;
  };

  await probe("giants-power-cantrip-choice", async () => {
    const who = await giant(3);
    await choose(who, "Giant's Power", "thaumaturgy");
    assert.ok(sheet(who).features.some((feature) => feature.name === "Giant's Power (Thaumaturgy)"));
  });

  // "Your choice of the druidcraft or thaumaturgy cantrip, cast with Wisdom."
  await probe("giants-power-cast-with-wisdom", async () => {
    const { grantedCastsOf } = await import("../src/lib/srd/granted-casts.ts");
    const who = await giant(3);
    await kit.endFight();
    assert.equal((await world.invoke("use_spell_slot", { characterId: who.id, spell: "Thaumaturgy" })).ok, false, "before the cantrip is chosen");
    await choose(who, "Giant's Power", "thaumaturgy");
    const cast = await world.invoke("use_spell_slot", { characterId: who.id, spell: "Thaumaturgy" });
    assert.equal(cast.ok, true, `the cantrip chosen cannot be cast: ${cast.error}`);
    assert.deepEqual(grantedCastsOf(sheet(who)).filter((grant) => grant.source === "Giant's Power").map((grant) => [grant.spell, grant.ability]), [["Thaumaturgy", "wis"]]);
    assert.equal((await world.invoke("use_spell_slot", { characterId: who.id, spell: "Druidcraft" })).ok, false, "the one not chosen");
  });
  await probe("giants-havoc-reach", async () => {
    const who = await giant(3);
    const [enemy] = await stage(who);
    kit.place(enemy.id, 7, 5);
    assert.equal((await swing(who, enemy, [15, 4])).ok, false, "10 feet while calm");
    rage(who);
    assert.equal((await swing(who, enemy, [15, 4])).ok, true, "10 feet while raging");
    kit.freshTurn();
    kit.place(enemy.id, 8, 5);
    assert.equal((await swing(who, enemy, [15, 4])).ok, false, "15 feet while raging");
  });
  await probe("giants-havoc-crushing-throw", async () => {
    const who = await giant(3, null, { equipment: [{ name: "Handaxe", qty: 2, equipped: true }] });
    const [enemy] = await stage(who);
    kit.place(enemy.id, 9, 5);
    rage(who);
    const thrown = await swing(who, enemy, [15, 4], { weapon: "Handaxe" });
    assert.equal(expr(thrown), `1d6+${MOD}+${rageBonus(3)}`, "a handaxe thrown 20 feet with Strength");
  });

  await probe("elemental-cleaver-extra-damage", async () => {
    for (const [level, dice] of [[6, "1d6"], [13, "1d6"], [14, "2d6"]]) {
      const who = await giant(level, "fire");
      const [enemy] = await stage(who);
      assert.ok(!expr(await swing(who, enemy, [15, 4, 4, 4])).includes("d6"), "not while calm");
      kit.freshTurn();
      rage(who);
      const hit = await swing(who, enemy, [15, 4, 4, 4]);
      assert.ok(expr(hit).endsWith(`+${dice}`), `level ${level}: ${expr(hit)}`);
      assert.match(JSON.stringify(hit.result), /fire/);
    }
  });
  const sixth = await giant(6, "fire");
  await probe("elemental-cleaver-damage-type", async () => {
    const [enemy] = await stage(sixth);
    rage(sixth);
    kit.setEnemy(enemy.id, { stats: { immune: "fire" } });
    await swing(sixth, enemy, [15, 4, 4]);
    assert.equal(300 - foe(enemy).currentHp, 0, `a fire-infused greataxe dealt ${300 - foe(enemy).currentHp} to a creature immune to fire: the axe's own damage is still slashing`);
  });
  // "Its benefits do not work for anyone else": the infusion is the raging
  // barbarian's own, so an ally swinging an axe of the same name beside them
  // deals the axe's plain damage with no die of the element.
  await probe("elemental-cleaver-nobody-else", async () => {
    const friend = hero("fighter", "Champion", 6, AXE);
    const [enemy] = await stage(sixth, { cast: [[friend, 6, 4]] });
    rage(sixth);
    kit.setEnemy(enemy.id, { stats: { immune: "fire" } });
    kit.giveTurn(friend.id);
    const hit = await swing(friend, enemy, [15, 4, 4]);
    assert.equal(hit.ok, true, hit.error);
    assert.ok(!expr(hit).includes("d6"), `an ally's swing carried the cleaver's die: ${expr(hit)}`);
    assert.ok(300 - foe(enemy).currentHp > 0, "an ally's axe was turned to fire against a creature immune to it");
  });
  await probe("elemental-cleaver-thrown", async () => {
    const [enemy] = await stage(sixth);
    rage(sixth);
    kit.place(enemy.id, 9, 5);
    const out = await swing(sixth, enemy, [15, 4, 4]);
    assert.equal(out.ok, true, `the infused greataxe cannot be thrown 20 feet: ${String(out.error).slice(0, 80)}`);
    assert.ok(sheet(sixth).equipment.some((item) => item.name === "Greataxe" && item.qty === 1), "returning to the hand: the axe thrown is still theirs");
    kit.freshTurn();
    kit.place(enemy.id, 18, 5);
    assert.equal((await swing(sixth, enemy, [15, 4, 4])).ok, false, "65 feet is past its long range of 60");
    // Calm, the axe is an axe: no throw.
    const [calm] = await stage(sixth);
    kit.place(calm.id, 9, 5);
    assert.equal((await swing(sixth, calm, [15, 4, 4])).ok, false, "not while calm");
  });
  await probe("elemental-cleaver-change-costs-a-bonus-action", async () => {
    await stage(sixth);
    rage(sixth);
    const out = await spend(sixth, "Elemental Cleaver", { variant: "cold" });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the element changed in a fight for no bonus action");
  });

  const tenth = await giant(10);
  await probe("mighty-impel-save", async () => {
    const [enemy] = await stage(tenth);
    assert.equal((await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, 2)).ok, false, "not while calm");
    rage(tenth);
    kit.place(enemy.id, 8, 5);
    assert.equal((await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, 2)).ok, false, "15 feet is beyond a reach of 10");
    kit.place(enemy.id, 7, 5);
    const dc = 8 + prof(10) + MOD;
    const made = await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, [dc - 1]);
    assert.equal(made.ok, true, made.error);
    assert.deepEqual([made.result.dc, made.result.saved], [dc, true]);
    assert.equal(budget().bonusUsed, true);
    kit.freshTurn();
    assert.equal((await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, [dc - 2])).result.saved, false);
  });
  await probe("mighty-impel-size", async () => {
    const taken = [];
    for (const [who, size] of [[tenth, "Large"], [await giant(14), "Huge"]]) {
      const [enemy] = await stage(who);
      rage(who);
      kit.setEnemy(enemy.id, { stats: { size } });
      const out = await spend(who, "Mighty Impel", { targetEnemyId: enemy.id }, 2);
      if (out.ok) taken.push(`${size} at level ${sheet(who).level}`);
    }
    assert.deepEqual(taken, [], "thrown all the same");
  });
  // "A creature left in the air falls and lands prone": thrown straight up
  // the 30 feet, it falls them (SRD 5.1, Falling: 1d6 for every 10 feet).
  await probe("mighty-impel-fall", async () => {
    const [enemy] = await stage(tenth);
    rage(tenth);
    const at = kit.token(enemy.id);
    const out = await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id, variant: "up" }, 2);
    assert.equal(out.result?.saved, false, show(out));
    assert.equal(300 - foe(enemy).currentHp, 6, "3d6 at 2 each");
    assert.ok(foeHas(enemy, "prone"), "and it lands prone");
    assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [at.x, at.y], "where it stood");
  });
  // "Mighty Impel can move Large or smaller creatures" from 14th level.
  await probe("mighty-impel-large-at-14th", async () => {
    const who = await giant(14);
    const [enemy] = await stage(who);
    rage(who);
    kit.setEnemy(enemy.id, { stats: { size: "Large" } });
    const before = kit.token(enemy.id);
    const out = await spend(who, "Mighty Impel", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.notDeepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [before.x, before.y], "a Large creature is thrown at 14th level");
  });
  await probe("mighty-impel-moves-nothing", async () => {
    const [enemy] = await stage(tenth);
    rage(tenth);
    const before = kit.token(enemy.id);
    const out = await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id, x: 10, y: 5 }, 2);
    assert.equal(out.result?.saved, false, show(out));
    const after = kit.token(enemy.id);
    assert.notDeepEqual([after.x, after.y], [before.x, before.y], "the creature failed its save and stands where it stood");
    const me = kit.token(tenth.id);
    assert.ok(Math.max(Math.abs(after.x - me.x), Math.abs(after.y - me.y)) <= 6, "within 30 feet of the barbarian");
    // A save made: nothing is thrown.
    kit.freshTurn();
    const held = kit.token(enemy.id);
    kit.place(enemy.id, 6, 5);
    const made = await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, 20);
    assert.equal(made.result?.saved, true, show(made));
    assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [6, 5], `a creature that saved was moved from where it stood (it was at ${held.x},${held.y})`);
  });

  await probe("demiurgic-colossus-reach", async () => {
    const who = await giant(14);
    const [enemy] = await stage(who);
    rage(who);
    kit.place(enemy.id, 8, 5);
    const out = await swing(who, enemy, [15, 4]);
    assert.equal(out.ok, true, `at 14th level a raging giant's reach is the 10 feet it was at 3rd: ${String(out.error).slice(0, 70)}`);
  });
}

// ---- defects found on the way, each with its own case ----
{
  const r = await openRig();
  const { world, kit, hero, stage, walk, give, sheet } = r;

  // A gate on a condition holds for the condition with a bracket note and for
  // a "Family: Choice" name, and for nothing that only starts the same.
  await test("a condition gate reads a bracket note and a family's choice", async () => {
    const { hasCondition } = await import("../src/lib/srd/authored-effects.ts");
    assert.equal(hasCondition({ conditions: ["Spirit Totem (bear)"] }, "spirit totem"), true, "a bracket note");
    assert.equal(hasCondition({ conditions: ["starry form: archer"] }, "starry form"), true, "a family's choice");
    assert.equal(hasCondition({ conditions: ["raging"] }, "raging"), true, "the whole name");
    assert.equal(hasCondition({ conditions: ["raging storm"] }, "raging"), false, "another condition that starts the same");
  });

  // The jump ruler shows what the jump move allows: SRD 5.1 Champion,
  // Remarkable Athlete ("increases by a number of feet equal to your Strength
  // modifier", a running long jump), and the Jump spell's tripled distance.
  await test("the jump ruler counts Remarkable Athlete and the Jump spell", async () => {
    const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
    const champion = hero("fighter", "Champion", 7);
    const plain = hero("fighter", "Battle Master", 7);
    const ruler = (who) => buildPlayerMapView(world.campaignId, sheet(who).userId)?.moves;
    const feet = {};
    for (const [name, who] of [["champion", champion], ["plain", plain]]) {
      await stage(who);
      kit.place(world.enemies()[0].id, 12, 12);
      assert.equal(await walk(who, 5, 7), 200, "a 10-foot run");
      feet[name] = [ruler(who)?.jumpFeet, ruler(who)?.highJumpFeet];
      if (name === "champion") {
        give(who, "jumping");
        feet.spell = [ruler(who)?.jumpFeet, ruler(who)?.highJumpFeet];
      }
    }
    // Strength 16: a running long jump of 16 feet and a high jump of 3 + 3.
    assert.deepEqual(feet.plain, [16, 6], "no feature, no spell");
    assert.deepEqual(feet.champion, [19, 6], "Remarkable Athlete's 3 feet on the running long jump");
    assert.deepEqual(feet.spell, [57, 18], "the Jump spell triples both");
  });
}

finish();
