// The clause ledger's rogue probes: the sentences of the authored rogue
// subclass features (src/lib/srd/subclasses.json) that no existing suite ran,
// each run through the engine. scripts/clauses/martial.json names every probe
// here by its id; scripts/lib/sweep-clauses-martial-known-rogue.mjs holds the
// ones the engine fails today.
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-rogue.mjs";
import { afterRollKit } from "./lib/sweep-clauses-mt-mr.mjs";

const { probe, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const RAPIER = { equipment: [{ name: "Rapier", qty: 1, equipped: true }] };
const CASTER = { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Burning Hands"], cantrips: ["Mage Hand"] };
const expr = (hit) => String(hit?.damage?.breakdown?.expression ?? "");
const sneakDice = (level) => Math.ceil(level / 2);

// ---- Assassin ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, sheet, foe, forced, give } = r;
  await probe("death-strike-double", async () => {
    const assassin = hero("rogue", "Assassin", 17, RAPIER);
    const [enemy] = await stage(assassin);
    kit.saveEncounter({ ...world.encounter(), surprisedIds: [enemy.id] });
    const hit = await swing(assassin, enemy, [15, 15, ...new Array(30).fill(2)]);
    assert.equal(hit.result.crit, true, "the staging: Assassinate's critical hit on a surprised creature");
    assert.equal(hit.result.hit, true, hit.error);
    const dealt = 300 - foe(enemy).currentHp;
    // A critical hit (Assassinate) doubles the dice: 2 x (1d8 + 9d6) of 2s,
    // plus Dexterity; Death Strike doubles all of it on a failed save.
    const crit = 2 * 2 * (1 + sneakDice(17)) + MOD;
    assert.equal(dealt, 2 * crit, `a surprised creature that failed (every die a 2) its Constitution save took ${dealt}, the hit alone being ${crit}`);
  });
}

// ---- Arcane Trickster ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, budget, give, forced, show } = r;
  const third = await import("../src/lib/srd/third-caster.ts");
  await probe("arcane-trickster-casting", () => {
    const profile = third.thirdCasterProfileForFeature("Spellcasting (Arcane Trickster)");
    assert.equal(third.thirdCasterAbility(profile), "int");
    assert.equal(third.thirdCasterList(profile), "wizard");
    assert.deepEqual([...third.thirdCasterSchools(profile)].sort(), ["enchantment", "illusion"]);
    assert.equal(third.isThirdCaster("rogue", "Arcane Trickster"), true);
  });

  const trickster = hero("rogue", "Arcane Trickster", 13, { ...RAPIER, spellcasting: CASTER });
  await probe("magical-ambush", async () => {
    const [enemy] = await stage(trickster);
    give(trickster, "hidden");
    world.diceLog();
    const out = await forced([18, 2, 5, 5, 5], () => world.invoke("aoe_damage", { casterCharacterId: trickster.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id], saveAbility: "dex", dc: 14 }));
    assert.equal(out.ok, true, out.error);
    assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 2, "the creature the trickster is hidden from saves with one d20");
  });

  // Spell Thief at 17th level: the caster saves against the rogue's spell save
  // DC; failed, the spell's damage comes back and the 1st-level spell is the
  // rogue's for 8 hours, the caster's no more (spell-thief.ts).
  await probe("spell-thief-steals", async () => {
    const thief = hero("rogue", "Arcane Trickster", 17, { ...RAPIER, spellcasting: { ...CASTER, slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 1, used: 0 } } } });
    const [enemy] = await stage(thief);
    const none = await spend(thief, "Spell Thief");
    assert.equal(none.ok, false, `with no spell cast at the rogue: ${show(none)}`);
    kit.setEnemy(enemy.id, { stats: { spells: ["Burning Hands"], abilities: { str: 10, dex: 10, con: 10, int: 14, wis: 10, cha: 10 } } });
    // The foe's turn: the order's first creature entry (as the hand sweep stages it).
    const fight = world.encounter();
    kit.saveEncounter({ ...fight, turnIndex: Math.max(0, fight.order.findIndex((entry) => entry.kind !== "pc")), turnBudget: null });
    const before = sheet(thief).currentHp;
    const cast = await forced([1, 4, 4, 4], () => world.invoke("cast_at_player", { characterId: thief.id, casterEnemyId: enemy.id, spell: "Burning Hands", level: 1, saveAbility: "dex", dc: 15, damage: "3d6", damageType: "fire" }));
    assert.equal(cast.ok, true, cast.error);
    assert.ok(sheet(thief).currentHp < before, "the staging: the spell burned the rogue");
    const out = await spend(thief, "Spell Thief", {}, 1);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(thief).currentHp, before, `the spell had no effect on the rogue: ${show(out)}`);
    assert.ok(sheet(thief).conditions.some((entry) => /stolen spell \(burning hands\)/i.test(entry)), `the rogue knows the spell: ${sheet(thief).conditions.join(", ")}`);
  });

  await probe("versatile-trickster", async () => {
    const [enemy] = await stage(trickster);
    const out = await spend(trickster, "Versatile Trickster", { targetEnemyId: enemy.id });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal((await swing(trickster, enemy, [15, 15, 4])).toHit.advantage, "advantage");
  });
}

// ---- Mastermind ----
{
  const r = await openRig();
  const { world, kit, hero, stage, react, enemyHits, sheet, budget, act, show } = r;
  const mastermind = hero("rogue", "Mastermind", 13, { ...RAPIER, ac: 5 });
  const ally = hero("fighter", "Champion", 5);
  await probe("master-of-tactics-help", async () => {
    const [enemy] = await stage(mastermind, { cast: [[ally, 6, 6]] });
    const out = await act(mastermind, "help", { bonus: true, targetCharacterId: ally.id, targetEnemyId: enemy.id });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal(budget().actionUsed ?? false, false, "and not the action");
  });
  // "At up to 30 feet": the foe named for the ally's attack, 30 feet from the
  // mastermind, and not 35.
  await probe("master-of-tactics-30-feet", async () => {
    const [enemy] = await stage(mastermind, { cast: [[ally, 12, 5]] });
    kit.place(enemy.id, 11, 5);
    const out = await act(mastermind, "help", { bonus: true, targetCharacterId: ally.id, targetEnemyId: enemy.id });
    assert.equal(out.ok, true, `Help on an attack against a creature 30 feet off: ${show(out)}`);
    const [far] = await stage(mastermind, { cast: [[ally, 13, 5]] });
    kit.place(far.id, 12, 5);
    assert.equal((await act(mastermind, "help", { bonus: true, targetCharacterId: ally.id, targetEnemyId: far.id })).ok, false, "35 feet off");
    const [near] = await stage(ally, { cast: [[mastermind, 4, 5]] });
    kit.place(near.id, 11, 5);
    assert.equal((await act(ally, "help", { targetCharacterId: mastermind.id, targetEnemyId: near.id })).ok, false, "the staging: a fighter's Help reaches 5 feet");
  });
  await probe("misdirection-within-5-feet", async () => {
    const [enemy] = await stage(mastermind, { cast: [[ally, 5, 9]] });
    await enemyHits(enemy, mastermind, [16, 4]);
    const out = await react(mastermind, "Misdirection", { targetCharacterId: ally.id }, [16, 4]);
    assert.equal(out.ok, false, `the attack was turned onto an ally 20 feet away, no cover between: ${show(out)}`);
  });
}

// ---- Swashbuckler ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, budget, d20s, show } = r;
  const swash = hero("rogue", "Swashbuckler", 13, RAPIER);
  await probe("fancy-footwork", async () => {
    const [enemy] = await stage(swash);
    await swing(swash, enemy, [15, 4]);
    world.diceLog();
    assert.equal(await r.walk(swash, 2, 5), 200);
    assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 0, "the creature the swashbuckler attacked made an opportunity attack as they left");
  });
  await probe("elegant-maneuver", async () => {
    await stage(swash);
    const out = await spend(swash, "Elegant Maneuver");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal(d20s(await roll(swash, { kind: "skill_check", skill: "acrobatics", dc: 10 })), 2, "the next Acrobatics check");
    assert.equal(d20s(await roll(swash, { kind: "skill_check", skill: "acrobatics", dc: 10 })), 1, "only the next");
  });
  // "If you succeed on the check and the creature is hostile to you, it has
  // disadvantage on attack rolls against targets other than you and can't
  // make opportunity attacks against targets other than you": Persuasion 18
  // against the creature's Insight 2; its swing at the friend then rolls two
  // d20s, its swing at the swashbuckler one, and the friend walks away from
  // it with no opportunity attack.
  await probe("panache-goads", async () => {
    const friend = hero("fighter", "Champion", 5);
    const [enemy] = await stage(swash, { cast: [[friend, 7, 4]] });
    const lost = await spend(swash, "Panache", { targetEnemyId: enemy.id }, [2, 18]);
    assert.equal(lost.ok, true, lost.error);
    assert.ok(!kit.enemy(enemy.id).conditions.includes("goaded"), "a lost contest holds nothing");
    kit.freshTurn();
    const out = await spend(swash, "Panache", { targetEnemyId: enemy.id }, [18, 2]);
    assert.equal(out.ok, true, out.error);
    assert.ok(kit.enemy(enemy.id).conditions.includes("goaded"), `the creature is goaded: ${show(out).slice(0, 200)}`);
    const d20sAt = async (target) => {
      world.diceLog();
      await r.enemyHits(enemy, target, [16, 15, 4, 4]);
      return world.diceLog().filter((die) => die.sides === 20).length;
    };
    assert.deepEqual([await d20sAt(friend), await d20sAt(swash)], [2, 1], "disadvantage at the friend, a straight roll at the swashbuckler");
    kit.giveTurn(friend.id);
    kit.freshTurn();
    world.diceLog();
    await r.walk(friend, 7, 8);
    assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 0, "no opportunity attack at the friend");
  });
}

// ---- Inquisitive ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, budget, act, d20s, walk, show } = r;
  const SKILLED = { skills: ["insight", "perception", "investigation"], saves: [], expertise: [], languages: ["Common"], tools: [], armor: ["light"], weapons: ["simple", "martial"] };
  const inquisitive = hero("rogue", "Inquisitive", 9, { ...RAPIER, proficiencies: SKILLED });
  // "you sense the presence of illusions, shapechangers not in their original
  // form, and other magic designed to deceive the senses within 30 feet of
  // you, provided you aren't blinded or deafened": an invisible friend 15 feet
  // off is sensed and nothing of them told; one 50 feet off is not; blinded,
  // the action is refused.
  await probe("unerring-eye-senses", async () => {
    const eye = hero("rogue", "Inquisitive", 13, { ...RAPIER, proficiencies: SKILLED });
    const near = hero("wizard", "School of Illusion", 5);
    const far = hero("wizard", "School of Illusion", 5);
    await stage(eye, { cast: [[near, 8, 5], [far, 15, 5]] });
    world.patch(near.id, { name: "Hidden Near", conditions: ["invisible"] });
    world.patch(far.id, { name: "Hidden Far", conditions: ["invisible"] });
    kit.place(eye.id, 5, 5);
    const out = await spend(eye, "Unerring Eye");
    assert.equal(out.ok, true, out.error);
    const told = JSON.stringify(out.result);
    assert.match(told, /deceiving the senses about Hidden Near/, told.slice(0, 300));
    assert.doesNotMatch(told, /Hidden Far/, "50 feet off is beyond the 30");
    kit.freshTurn();
    world.patch(eye.id, { conditions: ["blinded"] });
    assert.equal((await spend(eye, "Unerring Eye")).ok, false, "not while blinded");
  });
  await probe("ear-for-deceit-floor", async () => {
    await kit.endFight();
    const out = await roll(inquisitive, { kind: "skill_check", skill: "insight", dc: 15, about: "lies", reason: "is the merchant lying about the price?" }, [3]);
    assert.equal(out.total, 8 + MOD + prof(9), `a 3 on an Insight check for a lie totals ${out.total}`);
  });
  await probe("ear-for-deceit-lies-only", async () => {
    await kit.endFight();
    const out = await roll(inquisitive, { kind: "skill_check", skill: "insight", dc: 15, reason: "reading the mood of the crowd" }, [3]);
    assert.equal(out.total, 3 + MOD + prof(9), `a 3 on an Insight check about no lie is floored to 8 (${out.total})`);
    // A model's Insight check for an Inquisitive is asked whether it is about
    // a lie, so the floor is neither lost to an omission nor given to another
    // check (the ask is src/lib/srd/roll-keys.ts unnamedRollKeys).
    const { heldRollKeys } = await import("../src/lib/dm/roll-feature-riders.ts");
    const { unnamedRollKeys } = await import("../src/lib/srd/roll-keys.ts");
    const keys = heldRollKeys(world.sheet(inquisitive.id));
    assert.deepEqual(unnamedRollKeys({ roll: "check", skill: "insight" }, keys), [{ field: "about", values: ["lies"] }], "an Insight check that names no circumstance");
    assert.deepEqual(unnamedRollKeys({ roll: "check", skill: "insight", about: "lies" }, keys), []);
    assert.deepEqual(unnamedRollKeys({ roll: "check", skill: "stealth" }, keys), [], "a Stealth check is not asked");
  });
  await probe("eye-for-detail", async () => {
    await stage(inquisitive);
    const out = await act(inquisitive, "search", { bonus: true });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal(budget().actionUsed ?? false, false);
  });
  await probe("insightful-fighting-sneak", async () => {
    const [enemy] = await stage(inquisitive);
    const out = await spend(inquisitive, "Insightful Fighting", { targetEnemyId: enemy.id }, [20, 1]);
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
    kit.freshTurn();
    const hit = await swing(inquisitive, enemy, [15, 4, 4, 4, 4, 4, 4]);
    assert.match(expr(hit), new RegExp(`${sneakDice(9)}d6`), `alone, no advantage, the hit after Insightful Fighting: ${expr(hit)}`);
  });
  // "For a minute": ten rounds of the mark.
  await probe("insightful-fighting-minute", async () => {
    const [enemy] = await stage(inquisitive);
    assert.equal((await spend(inquisitive, "Insightful Fighting", { targetEnemyId: enemy.id }, [20, 1])).ok, true);
    const marked = () => r.foeHas(enemy, "insightful fighting");
    assert.ok(marked(), "the staging: the creature is read");
    for (let round = 0; round < 9; round += 1) r.untilTurnOf(inquisitive);
    assert.ok(marked(), "nine rounds on the mark holds");
    r.untilTurnOf(inquisitive);
    r.untilTurnOf(inquisitive);
    assert.ok(!marked(), "eleven rounds on it still holds");
  });
  await probe("steady-eye-advantage", async () => {
    await stage(inquisitive);
    assert.equal(d20s(await roll(inquisitive, { kind: "skill_check", skill: "perception", dc: 10 })), 2, "Perception, not having moved");
    assert.equal(d20s(await roll(inquisitive, { kind: "skill_check", skill: "investigation", dc: 10 })), 2, "Investigation, not having moved");
  });
  await probe("steady-eye-half-speed", async () => {
    await stage(inquisitive);
    assert.equal(await walk(inquisitive, 11, 5), 200, "the staging: a 30-foot walk");
    assert.equal(d20s(await roll(inquisitive, { kind: "skill_check", skill: "perception", dc: 10 })), 1, "after moving its whole speed the rogue still searches with advantage");
  });
}

// ---- Scout ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, roll, sheet, foeHas, untilTurnOf, show } = r;
  const scout = hero("rogue", "Scout", 17, RAPIER);
  const ally = hero("fighter", "Champion", 5);
  await probe("ambush-master-mark", async () => {
    const [enemy] = await stage(scout, { cast: [[ally, 6, 6]] });
    const hit = await swing(scout, enemy, [15, 4]);
    assert.equal(hit.result.hit, true, hit.error);
    kit.giveTurn(ally.id);
    assert.equal((await swing(ally, enemy, [15, 15, 4])).toHit.advantage, "advantage", "an ally attacks the creature the scout hit first");
  });
  await probe("sudden-strike-bonus-attack", async () => {
    const [enemy] = await stage(scout);
    await swing(scout, enemy, [15, 4]);
    const out = await swing(scout, enemy, [15, 4], { bonusAttack: "feature" });
    assert.equal(out.ok, true, `the bonus-action attack after the Attack action: ${String(out.error).slice(0, 100)}`);
    assert.equal(r.budget().bonusUsed, true);
  });
  await probe("sudden-strike-second-sneak", async () => {
    const [first, second] = await stage(scout, { enemies: 2, cast: [[ally, 6, 4]] });
    kit.place(second.id, 5, 6);
    kit.place(ally.id, 6, 6);
    const one = await swing(scout, first, [15, ...new Array(12).fill(1)]);
    const two = await swing(scout, second, [15, ...new Array(12).fill(1)], { bonusAttack: "feature" });
    assert.match(expr(one), /d6/, `the first hit: ${expr(one)}`);
    assert.match(expr(two), new RegExp(`${sneakDice(17)}d6`), `a second Sneak Attack against another creature in the turn: ${expr(two)}`);
  });
}

// ---- Phantom ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, sheet, foe, give, d20s, show } = r;
  const phantom = hero("rogue", "Phantom", 9, RAPIER);
  // "Whenever you finish a short or long rest, you can gain one skill or tool
  // proficiency of your choice ... You lose this proficiency when you use
  // this feature to choose a different proficiency that you lack": Arcana
  // chosen out of a fight adds the proficiency bonus (+4 at 9th level) to
  // the Arcana skill; a second choice waits for a rest, and History after
  // the short rest takes Arcana's place.
  await probe("whispers-of-the-dead", async () => {
    const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
    const scholar = hero("rogue", "Phantom", 9, RAPIER);
    await kit.endFight();
    const skill = (id) => computeSheetDerived(sheet(scholar)).skills[id];
    const base = { arcana: skill("arcana"), history: skill("history") };
    const out = await spend(scholar, "Whispers of the Dead", { variant: "arcana" });
    assert.equal(out.ok, true, out.error);
    assert.equal(skill("arcana") - base.arcana, 4, "Arcana takes the proficiency bonus");
    assert.equal((await spend(scholar, "Whispers of the Dead", { variant: "history" })).ok, false, "one choice until the next rest");
    assert.equal((await world.invoke("take_rest", { kind: "short" })).ok, true);
    assert.equal((await spend(scholar, "Whispers of the Dead", { variant: "history" })).ok, true);
    assert.deepEqual([skill("arcana") - base.arcana, skill("history") - base.history], [0, 4], "History in Arcana's place");
  });
  await probe("wails-from-the-grave", async () => {
    const [first, second] = await stage(phantom, { enemies: 2, cast: [] });
    kit.setEnemy(first.id, { conditions: ["prone"] });
    const hit = await swing(phantom, first, [15, 15, ...new Array(12).fill(2)]);
    assert.equal(hit.result.hit, true, hit.error);
    const before = foe(second).currentHp;
    const out = await spend(phantom, "Wails from the Grave", { targetEnemyId: second.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(second).currentHp, 2 * Math.ceil(sneakDice(9) / 2), `half the sneak attack dice (3d6 of 2s) in necrotic to a second creature 15 feet off: ${show(out)}`);
  });
  // The defect found at integration: the spend answered any weapon hit, had
  // no 30-foot limit and took the first creature as the second.
  await probe("wails-needs-a-sneak-attack", async () => {
    const [first, second] = await stage(phantom, { enemies: 2, cast: [] });
    const plain = await swing(phantom, first, [15, 4]);
    assert.equal(plain.result.hit, true, plain.error);
    assert.doesNotMatch(expr(plain), /d6/, `the staging: a hit with no Sneak Attack (${expr(plain)})`);
    const unanswered = await spend(phantom, "Wails from the Grave", { targetEnemyId: second.id }, 2);
    assert.equal(unanswered.ok, false, `a hit without Sneak Attack let the wail out: ${show(unanswered)}`);
    assert.equal(r.used(phantom, "sub_wails_from_the_grave"), 0, "and the refusal spent nothing");
    const [one, two] = await stage(phantom, { enemies: 2, cast: [] });
    kit.setEnemy(one.id, { conditions: ["prone"] });
    const sneak = await swing(phantom, one, [15, 15, ...new Array(12).fill(2)]);
    assert.equal(sneak.result.hit, true, sneak.error);
    assert.equal((await spend(phantom, "Wails from the Grave", { targetEnemyId: one.id }, 2)).ok, false, "the first creature is not the second");
    kit.place(two.id, 13, 5);
    assert.equal((await spend(phantom, "Wails from the Grave", { targetEnemyId: two.id }, 2)).ok, false, "a creature 35 feet from the first is beyond 30 feet");
    assert.equal(r.used(phantom, "sub_wails_from_the_grave"), 0, "neither refusal spent a use");
    kit.place(two.id, 12, 5);
    const near = await spend(phantom, "Wails from the Grave", { targetEnemyId: two.id }, 2);
    assert.equal(near.ok, true, `a creature 30 feet from the first: ${show(near)}`);
    assert.equal(foe(one).currentHp, 300 - (2 + 2 * sneakDice(9) + MOD), "and the first creature takes no wail");
  });
  await probe("deaths-friend-first-too", async () => {
    const friend = hero("rogue", "Phantom", 17, RAPIER);
    const [one, two] = await stage(friend, { enemies: 2, cast: [] });
    kit.setEnemy(one.id, { conditions: ["prone"] });
    const sneak = await swing(friend, one, [15, 15, ...new Array(20).fill(2)]);
    assert.equal(sneak.result.hit, true, sneak.error);
    const struck = foe(one).currentHp;
    const out = await spend(friend, "Wails from the Grave", { targetEnemyId: two.id }, 2);
    assert.equal(out.ok, true, out.error);
    const wail = 2 * Math.ceil(sneakDice(17) / 2);
    assert.deepEqual([300 - foe(two).currentHp, struck - foe(one).currentHp], [wail, wail], `the wail lands on both creatures: ${show(out)}`);
  });
  await probe("deaths-friend-trinket-at-rest", async () => {
    const friend = hero("rogue", "Phantom", 17, RAPIER);
    await kit.endFight();
    const out = await world.invoke("take_rest", { kind: "long" });
    assert.equal(out.ok, true, out.error);
    assert.ok(sheet(friend).conditions.includes("soul trinket"), "a long rest's end with no trinket carried leaves none in the rogue's hand");
  });
  // "You can hold up to your proficiency bonus of them": 4 at 9th level.
  await probe("soul-trinkets-count", async () => {
    const dies = async (held) => {
      // Two creatures, so the fight goes on once one has died.
      const [enemy] = await stage(phantom, { enemies: 2 });
      if (held) give(phantom, held, { rounds: 14400 });
      kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 1 });
      await swing(phantom, enemy, [15, 4]);
      return r.react(phantom, "Tokens of the Departed");
    };
    const first = await dies(null);
    assert.equal(first.ok, true, first.error);
    assert.ok(sheet(phantom).conditions.includes("soul trinket"), `one trinket: ${sheet(phantom).conditions.join(", ")}`);
    assert.equal((await dies("soul trinket (3)")).ok, true, "a fourth");
    assert.ok(sheet(phantom).conditions.includes("soul trinket (4)"), `four trinkets: ${sheet(phantom).conditions.join(", ")}`);
    const fifth = await dies("soul trinket (4)");
    assert.equal(fifth.ok, false, `a fifth trinket at proficiency bonus 4: ${show(fifth)}`);
  });
  // "Destroy one to use Wails from the Grave without spending a use, and as
  // an action you can destroy one to ask its spirit a question."
  await probe("soul-trinket-spent", async () => {
    const [first, second] = await stage(phantom, { enemies: 2, cast: [] });
    give(phantom, "soul trinket (2)", { rounds: 14400 });
    r.setUsed(phantom, "sub_wails_from_the_grave", r.max(phantom, "sub_wails_from_the_grave"));
    kit.setEnemy(first.id, { conditions: ["prone"] });
    await swing(phantom, first, [15, 15, ...new Array(12).fill(2)]);
    const before = foe(second).currentHp;
    const wail = await spend(phantom, "Wails from the Grave", { targetEnemyId: second.id }, 2);
    assert.equal(wail.ok, true, wail.error);
    assert.ok(before > foe(second).currentHp, "the wail landed");
    assert.ok(sheet(phantom).conditions.includes("soul trinket"), `one trinket of two destroyed: ${sheet(phantom).conditions.join(", ")}`);
    kit.freshTurn();
    const asked = await spend(phantom, "Question a Spirit");
    assert.equal(asked.ok, true, asked.error);
    assert.equal(r.budget().actionUsed, true, "the action");
    assert.ok(!r.has(phantom, "soul trinket"), "the trinket asked is destroyed");
    kit.freshTurn();
    assert.equal((await spend(phantom, "Question a Spirit")).ok, false, "with no trinket left");
  });
  // Ghost Walk: "free once per long rest, otherwise costs a soul trinket".
  await probe("ghost-walk-trinket", async () => {
    const ghost = hero("rogue", "Phantom", 13, RAPIER);
    await stage(ghost);
    assert.equal((await spend(ghost, "Ghost Walk")).ok, true, "the free use");
    kit.freshTurn();
    const none = await spend(ghost, "Ghost Walk");
    assert.equal(none.ok, false, `a second walk with no trinket: ${show(none)}`);
    give(ghost, "soul trinket", { rounds: 14400 });
    const paid = await spend(ghost, "Ghost Walk");
    assert.equal(paid.ok, true, paid.error);
    assert.ok(!r.has(ghost, "soul trinket"), "the trinket paid for it");
    assert.equal(r.used(ghost, "sub_ghost_walk"), 1, "and no use beyond the one");
  });
  // Ghost Walk: a 10-foot flying speed, and every creature's space and every
  // prop's is one the rogue may pass through, as the move route and the
  // board's lit squares both ask (passage.ts pcMoveTraits).
  await probe("ghost-walk-spectral", async () => {
    const { pcMoveTraits } = await import("../src/lib/battlemap/passage.ts");
    const { flyingSpeedOf } = await import("../src/lib/battlemap/types.ts");
    const maps = await import("../src/lib/db/battle-maps.ts");
    const ghost = hero("rogue", "Phantom", 13, RAPIER);
    const [enemy] = await stage(ghost);
    const board = kit.map();
    const through = () =>
      pcMoveTraits({ width: board.width, tokens: maps.listTokens(board.id), mover: kit.token(ghost.id), sheet: r.sheet(ghost), footprintOf: () => 1, enemySize: () => "medium" }).passable;
    const at = kit.token(enemy.id).y * board.width + kit.token(enemy.id).x;
    const fly = () => flyingSpeedOf({ conditions: r.sheet(ghost).conditions, features: r.sheet(ghost).features, walkingFeet: r.sheet(ghost).speed });
    assert.equal(through().has(at), false, "the staging: a hostile creature of the rogue's size blocks its space");
    assert.equal(fly(), null, "the staging: no flying speed");
    const out = await spend(ghost, "Ghost Walk");
    assert.equal(out.ok, true, out.error);
    assert.equal(through().has(at), true, "spectral, the rogue passes through the creature's space");
    assert.equal(fly(), 10, "a 10-foot flying speed");
    assert.equal(r.sheet(ghost).conditionMeta["ghost walk"]?.rounds, 100, "for 10 minutes");
    // "Through creatures and objects": a locked door (the terrain the engine
    // runs walls it) and a window (a low wall) are crossed as difficult
    // terrain and never stopped in; a wall, the building, still stops the
    // rogue. Neither was crossed before (passage.ts objectTiles).
    const { reachableTiles } = await import("../src/lib/battlemap/movement.ts");
    const drawn = "....." + "#+#|#" + ".....";
    const run = "....." + "###|#" + ".....";
    const mover = { ...kit.token(ghost.id), x: 2, y: 0 };
    const reach = (sheet) => reachableTiles(run, 5, 3, new Set(), mover, 6, 1, false, pcMoveTraits({ width: 5, drawnTerrain: drawn, tokens: [mover], mover, sheet, footprintOf: () => 1, enemySize: () => "medium" }));
    const spectral = reach(r.sheet(ghost));
    assert.deepEqual([spectral.has(2 * 5 + 1), spectral.has(2 * 5 + 3), spectral.has(5 + 1), spectral.has(5 + 2)], [true, true, false, false], "[past the door, past the window, stopped in the door, through the wall]");
    const calm = reach({ ...r.sheet(ghost), conditions: [] });
    assert.deepEqual([calm.has(2 * 5 + 1), calm.has(2 * 5 + 3)], [false, false], "with no Ghost Walk the door and the window stop the rogue");
  });

  await probe("tokens-save-advantage", async () => {
    await kit.endFight();
    give(phantom, "soul trinket", { rounds: 14400 });
    assert.equal(d20s(await roll(phantom, { kind: "saving_throw", ability: "con", dc: 10 })), 2, "a Constitution save while carrying a trinket");
  });
}

// ---- Soulknife ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, has, budget, foe, show } = r;
  const knife = hero("rogue", "Soulknife", 13, RAPIER);
  await probe("psychic-veil", async () => {
    await stage(knife);
    const out = await spend(knife, "Psychic Veil");
    assert.equal(out.ok, true, out.error);
    assert.ok(has(knife, "invisible"), "invisible");
    assert.equal(budget().actionUsed, true, "the action");
    assert.equal(sheet(knife).conditionMeta.invisible?.rounds, 600, "an hour");
  });
  // "Free once per long rest and otherwise for a die."
  await probe("psychic-veil-die", async () => {
    await stage(knife);
    r.setUsed(knife, "sub_psychic_veil", 1);
    const out = await spend(knife, "Psychic Veil");
    assert.equal(out.ok, true, out.error);
    assert.ok(has(knife, "invisible"), "invisible");
    assert.deepEqual([r.used(knife, "sub_psychic_veil"), r.used(knife, "sub_psionic_energy")], [1, 1], "one Psionic Energy die in the use's place");
    await stage(knife);
    r.setUsed(knife, "sub_psychic_veil", 1);
    r.setUsed(knife, "sub_psionic_energy", r.max(knife, "sub_psionic_energy"));
    assert.equal((await spend(knife, "Psychic Veil")).ok, false, "with no die left either");
  });
  // The Psionic Energy die where one is rolled: Psychic Teleportation's
  // distance, ten times the roll, a d8 at 9th level and a d12 at 17th.
  await probe("psionic-energy-die", async () => {
    for (const [level, sides] of [[9, 8], [11, 10], [17, 12]]) {
      const blade = hero("rogue", "Soulknife", level, RAPIER);
      await stage(blade);
      world.diceLog();
      const out = await spend(blade, "Psychic Teleportation", {}, [sides]);
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(world.diceLog().map((die) => die.sides), [sides], `a d${sides} at level ${level}`);
      assert.match(JSON.stringify(out.result), new RegExp(`${sides * 10} feet`), `ten times the roll: ${show(out)}`);
      assert.equal(budget().bonusUsed, true, "the bonus action");
      assert.equal(r.used(blade, "sub_psionic_energy"), 1, "one die");
    }
  });
  // "The blades keep these dice at every level."
  await probe("psychic-blades-dice-at-17", async () => {
    const master = hero("rogue", "Soulknife", 17, { equipment: [] });
    const [enemy] = await stage(master);
    const hit = await swing(master, enemy, [15, ...new Array(12).fill(2)], { weapon: "psychic blade" });
    assert.equal(hit.ok, true, hit.error);
    assert.match(expr(hit), /^1d6/, `the blade at 17th level: ${expr(hit)}`);
    const second = await swing(master, enemy, [15, ...new Array(12).fill(2)], { weapon: "psychic blade", feature: "two-weapon fighting" });
    assert.equal(second.ok, true, second.error);
    assert.match(expr(second), /^1d4/, `the second blade at 17th level: ${expr(second)}`);
  });
  // Homing Strikes (Soul Blades, 9th level): a missed psychic blade waits on
  // the rogue, a Psionic Energy die is added, and the die is spent only if it
  // turns the miss.
  await probe("homing-strikes", async () => {
    const card = await afterRollKit(world);
    const blade = hero("rogue", "Soulknife", 9, { equipment: [{ name: "Rapier", qty: 1, equipped: false }] });
    const [enemy] = await stage(blade);
    // +7 with the blade (Dexterity and proficiency): a 3 is 10 against AC 13.
    await swing(blade, enemy, [3], { weapon: "psychic blade" });
    assert.deepEqual(card.offered(), ["homing_strikes"], "a missed psychic blade the d8 could turn");
    assert.equal(r.used(blade, "sub_psionic_energy"), 0, "nothing is spent until they choose");
    const turned = await card.choose(blade, "homing_strikes", 5, 2, 2, 2, 2, 2, 2, 2);
    assert.match(turned.note, /HIT/, `10 + 5 against AC 13: ${turned.note}`);
    assert.equal(r.used(blade, "sub_psionic_energy"), 1, "the die turned the miss and is spent");
    const [second] = await stage(blade);
    await swing(blade, second, [3], { weapon: "psychic blade" });
    const short = await card.choose(blade, "homing_strikes", 1);
    assert.match(short.note, /MISS/, `10 + 1 against AC 13: ${short.note}`);
    assert.equal(r.used(blade, "sub_psionic_energy"), 0, "a die that leaves the attack short is not spent");
    const [third] = await stage(blade);
    world.patch(blade.id, { equipment: [{ name: "Rapier", qty: 1, equipped: true }] });
    await swing(blade, third, [3], { weapon: "Rapier" });
    assert.deepEqual(card.offered(), [], "a rapier is no psychic blade");
    await card.keepAll(blade);
    const [fourth] = await stage(knife);
    kit.setEnemy(fourth.id, { ac: 30 });
    await swing(knife, fourth, [3], { weapon: "psychic blade" });
    assert.deepEqual(card.offered(), [], "a miss no die could turn is not offered it");
    await card.keepAll(knife);
  });

  // Psi-Bolstered Knack: a failed check with a proficient skill or tool
  // waits on the rogue; the die is spent only if it closes the gap.
  await probe("psi-bolstered-knack", async () => {
    const card = await afterRollKit(world);
    const SKILLED = { skills: ["stealth"], saves: [], expertise: [], languages: ["Common"], tools: ["thieves' tools"], armor: ["light"], weapons: ["simple", "martial"] };
    const adept = hero("rogue", "Soulknife", 9, { ...RAPIER, proficiencies: SKILLED });
    const ask = async (args, face) => {
      await kit.endFight();
      world.clearDice();
      world.dice(face);
      const out = await world.invoke("request_roll", { characterId: adept.id, dc: 16, reason: "a clause probe", ...args });
      world.clearDice();
      assert.equal(out.ok, true, out.error);
    };
    const used = () => r.used(adept, "sub_psionic_energy");
    const before = used();
    // 5 + Dexterity + proficiency is 12 against DC 16: a d8 can close it.
    await ask({ kind: "skill_check", skill: "stealth" }, 5);
    assert.deepEqual(card.offered(), ["psi_knack"], "a failed Stealth check, a skill the rogue is proficient in");
    const made = await card.choose(adept, "psi_knack", 6);
    assert.equal(made.roll.total, 5 + MOD + prof(9) + 6, "the die is added");
    assert.equal(used(), before + 1, "it closed the gap and is spent");
    await ask({ kind: "skill_check", skill: "stealth" }, 5);
    const short = await card.choose(adept, "psi_knack", 1);
    assert.equal(short.roll.total, 5 + MOD + prof(9) + 1);
    assert.equal(used(), before + 1, "a die that leaves the check short is not spent");
    await ask({ kind: "ability_check", ability: "dex", tool: "thieves' tools" }, 5);
    assert.deepEqual(card.offered(), ["psi_knack"], "a failed check with a tool the rogue is proficient with");
    await card.keepAll(adept);
    await ask({ kind: "skill_check", skill: "athletics" }, 9);
    assert.deepEqual(card.offered(), [], "Athletics, which the rogue is not proficient in, is not offered it");
    await card.keepAll(adept);
  });

  // Rend Mind: a Sneak Attack with a psychic blade, a Wisdom save or stunned
  // for a minute; free once, then three Psionic Energy dice.
  await probe("rend-mind", async () => {
    const master = hero("rogue", "Soulknife", 17, { equipment: [] });
    const [enemy] = await stage(master);
    const cold = await spend(master, "Rend Mind", { targetEnemyId: enemy.id }, 2);
    assert.equal(cold.ok, false, `with no Sneak Attack landed: ${show(cold)}`);
    assert.equal(r.used(master, "sub_rend_mind"), 0, "and the refusal spent nothing");
    kit.setEnemy(enemy.id, { conditions: ["prone"] });
    const hit = await swing(master, enemy, [15, 15, ...new Array(12).fill(2)], { weapon: "psychic blade" });
    assert.match(expr(hit), /9d6/, `the staging: a Sneak Attack with the blade (${expr(hit)})`);
    const out = await spend(master, "Rend Mind", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.ok(r.foeHas(enemy, "stunned"), `a failed Wisdom save (a 2): ${show(out)}`);
    assert.equal(foe(enemy).conditionMeta.stunned?.rounds, 10, "for a minute");
    assert.equal(r.used(master, "sub_rend_mind"), 1, "the free use");
  });
  await probe("rend-mind-three-dice", async () => {
    const master = hero("rogue", "Soulknife", 17, { equipment: [] });
    const [enemy] = await stage(master);
    r.setUsed(master, "sub_rend_mind", 1);
    kit.setEnemy(enemy.id, { conditions: ["prone"] });
    await swing(master, enemy, [15, 15, ...new Array(12).fill(2)], { weapon: "psychic blade" });
    const out = await spend(master, "Rend Mind", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(r.used(master, "sub_psionic_energy"), 3, "three Psionic Energy dice in the use's place");
    assert.ok(r.foeHas(enemy, "stunned"), "and the creature is stunned");
  });
  await probe("psychic-veil-ends-on-damage", async () => {
    const [enemy] = await stage(knife);
    await spend(knife, "Psychic Veil");
    kit.freshTurn();
    const hit = await swing(knife, enemy, [15, 15, 4, 4, 4, 4, 4, 4, 4, 4]);
    assert.equal(hit.result.hit, true, hit.error);
    assert.ok(!has(knife, "invisible"), "the soulknife dealt damage and is still invisible");
  });
}

finish();
