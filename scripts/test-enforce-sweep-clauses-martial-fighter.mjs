// The clause ledger's fighter probes: the sentences of the authored fighter
// subclass features (src/lib/srd/subclasses.json) that no existing suite ran,
// each run through the engine. scripts/clauses/martial.json names every probe
// here by its id; scripts/lib/sweep-clauses-martial-known-fighter.mjs holds
// the ones the engine fails today.
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-fighter.mjs";

const { probe, test, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const NONMAGICAL = { stats: { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } };
const CASTER = { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Burning Hands"], cantrips: ["Fire Bolt"] };
const BOW = { equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] };
const d20sOf = (log) => log.filter((die) => die.sides === 20).map((die) => die.face);

// ---- Battle Master ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, sheet, lastRoll } = r;
  const options = await import("../src/lib/srd/options.ts");

  await probe("maneuvers-known", () => {
    assert.deepEqual([3, 6, 7, 10, 14, 15, 20].map((level) => options.optionSlotsFor("fighter", "Battle Master", level, "maneuver")), [3, 3, 5, 7, 7, 9, 9]);
  });

  await probe("maneuver-dc-dexterity", async () => {
    const duelist = hero("fighter", "Battle Master", 3, { abilities: { str: 8, dex: 18 }, equipment: [{ name: "Rapier", qty: 1, equipped: true }] });
    world.patch(duelist.id, { features: [...sheet(duelist).features, { name: options.optionFeatureName("maneuver", "Trip Attack"), source: "class" }] });
    const [enemy] = await stage(duelist);
    const out = await swing(duelist, enemy, [15, 4, 5, 2], { maneuver: "Trip Attack" });
    assert.equal(out.ok, true, out.error);
    assert.equal(lastRoll("saving_throw")?.dc, 8 + prof(3) + 4, "the DC reads the better of Strength 8 and Dexterity 18");
    assert.ok(kit.enemy(enemy.id).conditions.includes("prone"));
  });
}

// ---- Eldritch Knight ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, foeHas, forced, untilTurnOf, endTurn, show } = r;
  const third = await import("../src/lib/srd/third-caster.ts");
  const burn = (caster, enemy) =>
    forced([5, 5, 5, 18, 2, 9], () => world.invoke("aoe_damage", { casterCharacterId: caster.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id], saveAbility: "dex", dc: 14 }));

  await probe("eldritch-knight-casting", () => {
    const profile = third.thirdCasterProfileForFeature("Spellcasting (Eldritch Knight)");
    assert.equal(third.thirdCasterAbility(profile), "int");
    assert.equal(third.thirdCasterList(profile), "wizard");
    assert.deepEqual([...third.thirdCasterSchools(profile)].sort(), ["abjuration", "evocation"]);
    assert.deepEqual(third.thirdCasterSlots(3), { 1: 2 });
    assert.deepEqual(third.thirdCasterSlots(7), { 1: 4, 2: 2 });
    assert.equal(third.isThirdCaster("fighter", "Eldritch Knight"), true);
  });

  const knight = hero("fighter", "Eldritch Knight", 10, { spellcasting: CASTER });
  const wizard = hero("wizard", "School of Evocation", 5, { spellcasting: CASTER });

  await probe("eldritch-strike-next-save", async () => {
    const [enemy] = await stage(knight);
    const hit = await swing(knight, enemy);
    assert.equal(hit.result.hit, true, hit.error);
    assert.ok(foeHas(enemy, "eldritch strike"), "the hit laid no mark");
    kit.freshTurn();
    world.diceLog();
    const first = await burn(knight, enemy);
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(d20sOf(world.diceLog()), [18, 2], "the marked creature rolls its save twice");
    assert.equal(first.result.results[0].success, false, "and keeps the lower");
    kit.freshTurn();
    world.diceLog();
    await burn(knight, enemy);
    assert.equal(d20sOf(world.diceLog()).length, 1, "only its next save: the one after is straight");
  });

  await probe("eldritch-strike-spell-of-yours", async () => {
    const [enemy] = await stage(knight, { cast: [[wizard, 5, 6]] });
    await swing(knight, enemy);
    kit.giveTurn(wizard.id);
    world.diceLog();
    const out = await burn(wizard, enemy);
    assert.equal(out.ok, true, out.error);
    assert.equal(d20sOf(world.diceLog()).length, 1, "another caster's spell is saved against straight");
    assert.ok(foeHas(enemy, "eldritch strike"), "and leaves the knight's mark for the knight's spell");
  });

  await probe("eldritch-strike-until-end-of-next-turn", async () => {
    const [enemy] = await stage(knight);
    await swing(knight, enemy);
    untilTurnOf(knight);
    assert.ok(foeHas(enemy, "eldritch strike"), "the mark is gone before the knight's next turn is over");
    endTurn();
    assert.ok(!foeHas(enemy, "eldritch strike"), "the mark outlives the end of the knight's next turn");
  });

  await probe("arcane-charge-teleport", async () => {
    const charger = hero("fighter", "Eldritch Knight", 15);
    await stage(charger);
    const out = await spend(charger, "Action Surge");
    assert.equal(out.ok, true, out.error);
    assert.match(JSON.stringify(out.result), /teleport/i, `Action Surge for an Eldritch Knight of 15th level offers no teleport: ${show(out)}`);
  });

  await probe("improved-war-magic", async () => {
    const seventh = hero("fighter", "Eldritch Knight", 7, { spellcasting: CASTER });
    const master = hero("fighter", "Eldritch Knight", 18, { spellcasting: CASTER });
    for (const [who, allowed] of [[seventh, false], [master, true]]) {
      const [enemy] = await stage(who);
      const cast = await burn(who, enemy);
      assert.equal(cast.ok, true, cast.error);
      const out = await swing(who, enemy, [15, 4], { bonusAttack: "feature" });
      assert.equal(out.ok, allowed, `level ${sheet(who).level} after a 1st-level spell: ${out.error ?? "the bonus attack was made"}`);
    }
  });
}

// ---- Arcane Archer ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, used, show } = r;
  const options = await import("../src/lib/srd/options.ts");
  const features = await import("../src/lib/srd/features.ts");
  const archer = hero("fighter", "Arcane Archer", 7, BOW);
  const blade = hero("fighter", "Arcane Archer", 7);
  const champion = hero("fighter", "Champion", 7);

  // Arcane Shot (XGtE): the options a sheet knows are its picks ("Arcane
  // Shot: Bursting Arrow"), as the builder writes them.
  const ALL_SHOTS = ["Banishing", "Beguiling", "Bursting", "Enfeebling", "Grasping", "Piercing", "Seeking", "Shadow"];
  const knows = (who, names) =>
    world.patch(who.id, { features: [...sheet(who).features.filter((feature) => !feature.name.startsWith("Arcane Shot: ")), ...names.map((name) => ({ ...sheet(who).features[0], name: `Arcane Shot: ${name} Arrow` }))] });
  const srd = await import("../src/lib/srd/index.ts");
  // One option on a fresh turn: an arrow that hits, then the option on it.
  // Returns the hit points the option took and what the engine said.
  async function loose(who, option, faces) {
    const [enemy] = await stage(who);
    // Out of melee, where a bow shoots with no disadvantage.
    kit.place(enemy.id, 8, 5);
    const noRoll = option === "piercing" || option === "seeking";
    if (!noRoll) {
      const shot = await swing(who, enemy, [15, 4], { weapon: "Longbow" });
      assert.equal(shot.ok, true, shot.error);
    }
    const before = foe(enemy).currentHp;
    const out = await spend(who, "Arcane Shot", { variant: option, targetEnemyId: enemy.id }, faces);
    assert.equal(out.ok, true, `${option}: ${out.error}`);
    return { enemy, took: before - foe(enemy).currentHp, out };
  }

  // ---- what the options do after the arrow has landed (mt-fb-arrow-riders.ts) ----
  const enemyTurn = () => {
    const encounter = world.encounter();
    kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => !entry.characterId), turnBudget: null });
  };
  // "Its speed is reduced by 10 feet, and it takes 2d6 slashing damage the
  // first time on each turn it moves 1 foot or more."
  await test("Grasping Arrow takes 10 feet of speed and tears 2d6 on the first move of a turn", async () => {
    knows(archer, ["Grasping", "Shadow"]);
    const { enemy } = await loose(archer, "grasping", [3, 4]);
    const { enemySpeedTiles } = await import("../src/lib/dm/enemy-speed.ts");
    assert.equal(enemySpeedTiles({ ...foe(enemy), conditions: [] }) - enemySpeedTiles(foe(enemy)), 2, "the brambles took no speed");
    enemyTurn();
    const before = foe(enemy).currentHp;
    const first = await r.forced([3, 4], () => world.invoke("move_token", { token: enemy.id, x: 9, y: 5 }));
    assert.equal(first.ok, true, first.error);
    assert.equal(before - foe(enemy).currentHp, 7, `2d6 slashing (3 + 4) as it moves: ${show(first)}`);
    const again = await r.forced([3, 4], () => world.invoke("move_token", { token: enemy.id, x: 10, y: 5 }));
    assert.equal(again.ok, true, again.error);
    assert.equal(before - foe(enemy).currentHp, 7, "a second move on the same turn tore it again");
  });

  // "It can't see anything farther than 5 feet away."
  await test("Shadow Arrow leaves a creature 5 feet of sight", async () => {
    knows(archer, ["Grasping", "Shadow"]);
    const light = await import("../src/lib/dm/attack-light.ts");
    const sees = (enemy) =>
      light.attackSight({
        campaignId: world.campaignId,
        encounterId: world.encounter().id,
        attacker: { refId: enemy.id, senses: light.enemySenses(foe(enemy)) },
        target: { refId: archer.id, senses: light.characterSenses(sheet(archer)) },
      });
    const { enemy, out } = await loose(archer, "shadow", 2);
    assert.ok(r.foeHas(enemy, "shadow arrow"), show(out));
    assert.deepEqual(sees(enemy), { attackerSees: false, targetSees: true }, "15 feet off, it still sees the archer");
    kit.place(enemy.id, 6, 5);
    assert.equal(sees(enemy).attackerSees, true, "within 5 feet it sees");
  });

  // "Ends early if the chosen ally attacks the charmed target, deals damage
  // to it, or forces it to make a saving throw."
  await test("Beguiling Arrow's charm ends when the ally it names attacks the creature", async () => {
    knows(archer, ["Beguiling", "Shadow"]);
    const [enemy] = await stage(archer, { cast: [[champion, 7, 6]] });
    kit.place(enemy.id, 8, 5);
    assert.equal((await swing(archer, enemy, [15, 4], { weapon: "Longbow" })).ok, true);
    const out = await spend(archer, "Arcane Shot", { variant: "beguiling", targetEnemyId: enemy.id, targetCharacterId: champion.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.ok(r.foeHas(enemy, "charmed"), show(out));
    kit.freshTurn();
    assert.equal((await swing(archer, enemy, [15, 4], { weapon: "Longbow" })).ok, true);
    assert.ok(r.foeHas(enemy, "charmed"), "the archer's own arrow ended the charm");
    kit.giveTurn(champion.id);
    assert.equal((await swing(champion, enemy, [15, 4])).ok, true);
    assert.ok(!r.foeHas(enemy, "charmed"), "the ally struck it and it is still charmed by them");
  });

  // Piercing and Seeking are arrows too: one leaves the quiver, and with none
  // there is nothing to loose.
  await test("Piercing Arrow takes an arrow from the quiver", async () => {
    knows(archer, ["Piercing", "Seeking"]);
    const arrows = () => sheet(archer).equipment.find((item) => item.name === "Arrows")?.qty ?? 0;
    world.patch(archer.id, { equipment: BOW.equipment });
    const { out } = await loose(archer, "piercing", 2);
    assert.equal(arrows(), 19, `no arrow left the quiver: ${show(out)}`);
    world.patch(archer.id, { equipment: BOW.equipment.filter((item) => item.name !== "Arrows") });
    const [enemy] = await stage(archer);
    kit.place(enemy.id, 8, 5);
    const none = await spend(archer, "Arcane Shot", { variant: "seeking", targetEnemyId: enemy.id }, 2);
    assert.equal(none.ok, false, `loosed with an empty quiver: ${show(none)}`);
    assert.equal(used(archer, "sub_arcane_shot"), 0, "the refusal spent a use");
    world.patch(archer.id, { equipment: BOW.equipment });
  });

  await probe("arcane-shot-once-per-turn", async () => {
    knows(archer, ["Bursting", "Shadow"]);
    const [enemy] = await stage(archer);
    kit.place(enemy.id, 8, 5);
    const shot = await swing(archer, enemy, [15, 4], { weapon: "Longbow" });
    assert.equal(shot.ok, true, shot.error);
    const first = await spend(archer, "Arcane Shot", { variant: "bursting", targetEnemyId: enemy.id }, [3, 4]);
    assert.equal(first.ok, true, first.error);
    const second = await spend(archer, "Arcane Shot", { variant: "shadow", targetEnemyId: enemy.id }, [3, 4, 1]);
    assert.equal(second.ok, false, `a second Arcane Shot in one turn was taken (${used(archer, "sub_arcane_shot")} of 2 spent)`);
    assert.equal(used(archer, "sub_arcane_shot"), 1, "the refused one spent nothing");
  });

  // "when you fire an arrow from a shortbow or longbow as part of the Attack
  // action ... deciding when the arrow hits unless the option makes no attack roll".
  await probe("arcane-shot-on-the-arrow", async () => {
    knows(archer, ["Bursting", "Seeking"]);
    const [enemy] = await stage(archer);
    const early = await spend(archer, "Arcane Shot", { variant: "bursting", targetEnemyId: enemy.id }, [3, 4]);
    assert.equal(early.ok, false, "an option was applied with no arrow in the creature");
    assert.equal(used(archer, "sub_arcane_shot"), 0, "and the refusal spent nothing");
    // A sword's hit is no arrow.
    knows(blade, ["Bursting", "Seeking"]);
    const [other] = await stage(blade);
    assert.equal((await swing(blade, other, [15, 4])).ok, true);
    assert.equal((await spend(blade, "Arcane Shot", { variant: "bursting", targetEnemyId: other.id }, [3, 4])).ok, false, "a longsword's hit carried an Arcane Shot");
    assert.equal((await spend(blade, "Arcane Shot", { variant: "seeking", targetEnemyId: other.id }, [5, 4, 1])).ok, false, "a Seeking Arrow was loosed with no bow");
    // The option with no attack roll takes one attack of the Attack action.
    const [third] = await stage(archer);
    const before = r.budget(archer)?.attacksMade ?? 0;
    const sought = await spend(archer, "Arcane Shot", { variant: "seeking", targetEnemyId: third.id }, [5, 4, 1]);
    assert.equal(sought.ok, true, sought.error);
    assert.equal((r.budget(archer)?.attacksMade ?? 0) - before, 1, "a Seeking Arrow took no attack of the Attack action");
  });

  await probe("arcane-shot-options", async () => {
    assert.notDeepEqual(options.optionLabelsOpenedBy("fighter", "Arcane Shot"), [], "Arcane Shot opens no pick of its options");
    assert.equal(options.optionsOfKind("arcane_shot").length, 8, "the eight options");
    for (const [level, count] of [[3, 2], [6, 2], [7, 3], [10, 4], [15, 5], [18, 6]]) {
      assert.equal(options.optionSlotsFor("fighter", "Arcane Archer", level, "arcane_shot"), count, `options known at level ${level}`);
    }
    assert.equal(options.optionSlotsFor("fighter", "Champion", 7, "arcane_shot"), 0, "a Champion knows none");
    // An option not among the picks is refused.
    knows(archer, ["Bursting", "Shadow"]);
    const [enemy] = await stage(archer);
    kit.place(enemy.id, 8, 5);
    assert.equal((await swing(archer, enemy, [15, 4], { weapon: "Longbow" })).ok, true);
    const out = await spend(archer, "Arcane Shot", { variant: "banishing", targetEnemyId: enemy.id }, [1]);
    assert.equal(out.ok, false, "an option the archer never chose was used");
    assert.equal(used(archer, "sub_arcane_shot"), 0, "and the refusal spent nothing");
  });

  // "the save DC is 8 + your proficiency bonus + your Intelligence modifier"
  await probe("arcane-shot-save-dc", async () => {
    const sage = hero("fighter", "Arcane Archer", 7, { ...BOW, abilities: { int: 18 } });
    knows(sage, ["Shadow", "Banishing"]);
    const derived = srd.computeSheetDerived(sheet(sage));
    const dc = 8 + derived.proficiencyBonus + derived.abilityMods.int;
    assert.equal(dc, 8 + 3 + 4);
    // The dummy saves at +0: a die one under the DC fails, the DC itself holds.
    const failed = await loose(sage, "shadow", [3, 4, dc - 1]);
    assert.equal(r.foeHas(failed.enemy, "shadow arrow"), true, `a ${dc - 1} against DC ${dc} saved: ${show(failed.out)}`);
    const held = await loose(sage, "shadow", [3, 4, dc]);
    assert.equal(r.foeHas(held.enemy, "shadow arrow"), false, `a ${dc} against DC ${dc} failed: ${show(held.out)}`);
    const sent = await loose(sage, "banishing", [1]);
    assert.equal(r.foeHas(sent.enemy, "banished"), true, `a failed Charisma save left the creature here: ${show(sent.out)}`);
  });

  // "Beguiling, Bursting, Enfeebling, Grasping and Shadow deal 2d6 damage,
  // Piercing and Seeking 1d6 and Banishing none"
  await probe("arcane-shot-damage", async () => {
    knows(archer, ALL_SHOTS);
    const dex = srd.computeSheetDerived(sheet(archer)).abilityMods.dex;
    for (const option of ["beguiling", "bursting", "enfeebling", "grasping", "shadow"]) {
      assert.equal((await loose(archer, option, [3, 4, 20])).took, 7, `${option}: 2d6`);
    }
    assert.equal((await loose(archer, "banishing", [20])).took, 0, "banishing deals none below 18th level");
    for (const option of ["piercing", "seeking"]) {
      // The arrow's own 1d8 + Dexterity, and 1d6 more, on a failed save; half each on a success.
      assert.equal((await loose(archer, option, [5, 4, 1])).took, 5 + dex + 4, `${option}: the arrow and 1d6`);
      assert.equal((await loose(archer, option, [5, 4, 20])).took, Math.floor((5 + dex) / 2) + 2, `${option}: half on a success`);
    }
    // The riders the engine holds: half damage from its weapon attacks.
    const weak = await loose(archer, "enfeebling", [3, 4, 1]);
    assert.equal(r.foeHas(weak.enemy, "enfeebling arrow"), true, show(weak.out));
    const hpBefore = sheet(archer).currentHp;
    kit.place(weak.enemy.id, 6, 5);
    await r.enemyHits(weak.enemy, archer, [16, 4]);
    assert.equal(hpBefore - sheet(archer).currentHp, 3, "the dummy's club deals 4 + 2, halved by the Enfeebling Arrow");
  });

  // "at 18th level these become 4d6, 2d6 and 2d6 force"
  await probe("arcane-shot-18th", async () => {
    const master = hero("fighter", "Arcane Archer", 18, BOW);
    knows(master, ALL_SHOTS);
    const dex = srd.computeSheetDerived(sheet(master)).abilityMods.dex;
    assert.equal((await loose(master, "bursting", [1, 2, 3, 4])).took, 10, "4d6");
    assert.equal((await loose(master, "banishing", [3, 4, 20])).took, 7, "banishing: 2d6 force");
    assert.equal((await loose(master, "seeking", [5, 3, 4, 1])).took, 5 + dex + 7, "seeking: the arrow and 2d6");
  });

  // "The prestidigitation or druidcraft cantrip": chosen, then cast.
  await probe("arcane-archer-lore-cantrip", async () => {
    const lore = hero("fighter", "Arcane Archer", 3, BOW);
    await kit.endFight();
    const early = await world.invoke("use_spell_slot", { characterId: lore.id, spell: "Prestidigitation" });
    assert.equal(early.ok, false, "before the cantrip is chosen");
    const wrong = await spend(lore, "Arcane Archer Lore", { variant: "fire bolt" });
    assert.equal(wrong.ok, false, `a cantrip the feature does not offer: ${show(wrong)}`);
    const chosen = await spend(lore, "Arcane Archer Lore", { variant: "prestidigitation" });
    assert.equal(chosen.ok, true, `no pick gives the cantrip: ${show(chosen)}`);
    assert.ok(sheet(lore).features.some((feature) => feature.name === "Arcane Archer Lore (Prestidigitation)"));
    const cast = await world.invoke("use_spell_slot", { characterId: lore.id, spell: "Prestidigitation" });
    assert.equal(cast.ok, true, `the cantrip chosen cannot be cast: ${cast.error}`);
    assert.equal((await world.invoke("use_spell_slot", { characterId: lore.id, spell: "Druidcraft" })).ok, false, "the one not chosen");
    assert.ok(features.subclassSpellsFor, "the subclass tables are still read");
  });

  await probe("magic-arrow-magical", async () => {
    const [enemy] = await stage(archer);
    kit.setEnemy(enemy.id, NONMAGICAL);
    kit.place(enemy.id, 10, 5);
    const shot = await swing(archer, enemy, [15, 4], { weapon: "Longbow" });
    assert.equal(shot.result.hit, true, shot.error);
    assert.equal(300 - foe(enemy).currentHp, 4 + MOD, "the arrow's damage is not halved");
  });

  await probe("magic-arrow-arrows-only", async () => {
    const lost = {};
    for (const [name, who] of [["archer", blade], ["champion", champion]]) {
      const [enemy] = await stage(who);
      kit.setEnemy(enemy.id, NONMAGICAL);
      const cut = await swing(who, enemy, [15, 4]);
      assert.equal(cut.result.hit, true, cut.error);
      lost[name] = 300 - foe(enemy).currentHp;
    }
    assert.equal(lost.archer, lost.champion, `an Arcane Archer's longsword deals ${lost.archer} through resistance to nonmagical weapons, a Champion's ${lost.champion}`);
  });

  await probe("curving-shot-60-feet", async () => {
    const [first, second] = await stage(archer, { enemies: 2 });
    kit.setEnemy(first.id, { ac: 30 });
    kit.place(archer.id, 0, 5);
    kit.place(first.id, 2, 5);
    kit.place(second.id, 19, 5);
    const miss = await swing(archer, first, [2], { weapon: "Longbow" });
    assert.equal(miss.result.hit, false, miss.error);
    const curved = await swing(archer, second, [15, 4], { weapon: "Longbow", bonusAttack: "feature" });
    assert.equal(curved.ok, false, "the arrow curved to a creature 85 feet from the one it missed");
  });
}

// ---- Cavalier ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, roll, sheet, foe, foeHas, d20s, rollBy, moveTiles, untilTurnOf, endTurn, show } = r;
  const cavalier = hero("fighter", "Cavalier", 15);
  const ally = hero("fighter", "Champion", 5, { ac: 5 });
  const bowman = hero("fighter", "Cavalier", 3, BOW);

  await probe("born-to-the-saddle-saves", async () => {
    await kit.endFight();
    assert.equal(d20s(await roll(cavalier, { kind: "saving_throw", ability: "dex", dc: 10, against: "dismount" })), 2);
    assert.equal(d20s(await roll(cavalier, { kind: "saving_throw", ability: "dex", dc: 10 })), 1);
  });

  await probe("born-to-the-saddle-mounting", async () => {
    await stage(cavalier);
    const before = moveTiles(cavalier);
    const out = await world.invoke("mount_up", { characterId: cavalier.id, mount: "warhorse" });
    assert.equal(out.ok, true, out.error);
    assert.match(JSON.stringify(out.result), /Mounting cost[^.]*\(5 ft\)/, `mounting cost a Cavalier more than 5 feet (${before} squares before): ${show(out)}`);
  });

  // "If you fall off your mount and descend no more than 10 feet, you can
  // land on your feet if you're not incapacitated": the warhorse goes down
  // with the rider's reaction already spent, and a thrown rider fails the
  // Dexterity save; the Cavalier stands both times, a Champion falls prone.
  await probe("born-to-the-saddle-fall", async () => {
    const champion = hero("fighter", "Champion", 5);
    const prone = (who) => sheet(who).conditions.includes("prone");
    const fall = async (who, cause) => {
      await stage(who);
      world.patch(who.id, { conditions: sheet(who).conditions.filter((entry) => entry !== "prone") });
      assert.equal((await world.invoke("mount_up", { characterId: who.id, mount: "warhorse" })).ok, true);
      kit.saveEncounter({ ...world.encounter(), reactionsUsed: [...world.encounter().reactionsUsed, who.id] });
      world.clearDice();
      world.dice(1, 1);
      const out = await world.invoke("dismount", { characterId: who.id, cause });
      world.clearDice();
      assert.equal(out.ok, true, out.error);
      return prone(who);
    };
    assert.deepEqual([await fall(cavalier, "mount-prone"), await fall(champion, "mount-prone")], [false, true], "the mount goes down with no reaction left");
    assert.deepEqual([await fall(cavalier, "forced-move"), await fall(champion, "forced-move")], [false, true], "thrown, the save failed");
  });

  await probe("unwavering-mark-melee-hit", async () => {
    const [enemy] = await stage(cavalier, { cast: [[ally, 7, 5]] });
    await swing(cavalier, enemy);
    assert.ok(foeHas(enemy, "unwavering mark"));
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "disadvantage", "a marked creature beside the cavalier attacks an ally straight");
    world.patch(cavalier.id, { ac: 5, acOverride: true });
    await enemyHits(enemy, cavalier, [15, 4]);
    assert.equal(rollBy("attack", cavalier.id, enemy).advantage, "none", "and the cavalier at no disadvantage");
    const [other] = await stage(bowman);
    kit.place(other.id, 10, 5);
    const shot = await swing(bowman, other, [15, 4], { weapon: "Longbow" });
    assert.equal(shot.result.hit, true, shot.error);
    assert.ok(!foeHas(other, "unwavering mark"), "an arrow marks nothing: the mark rides a melee weapon attack");
  });

  await probe("unwavering-mark-until-end-of-next-turn", async () => {
    const [enemy] = await stage(cavalier, { cast: [[ally, 7, 5]] });
    await swing(cavalier, enemy);
    untilTurnOf(cavalier);
    assert.ok(foeHas(enemy, "unwavering mark"), "the mark is gone as the cavalier's next turn starts, not when it ends");
  });

  await probe("unwavering-mark-within-5-feet", async () => {
    const [enemy] = await stage(cavalier, { cast: [[ally, 9, 5]] });
    await swing(cavalier, enemy);
    kit.place(enemy.id, 8, 5);
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "none", "a marked creature 15 feet from the cavalier still attacks an ally at disadvantage");
  });

  const warder = hero("fighter", "Cavalier", 7);
  const struck = async (ac) => {
    const [enemy] = await stage(ally, { cast: [[warder, 5, 6]] });
    world.patch(ally.id, { ac, acOverride: true });
    await enemyHits(enemy, ally, [16, 4]);
    return enemy;
  };
  await probe("warding-maneuver-ac", async () => {
    await struck(13);
    const hurt = sheet(ally).currentHp;
    const out = await react(warder, "Warding Maneuver", { targetCharacterId: ally.id }, [8]);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(ally).currentHp, hurt + 6, "a 20 against AC 13 + 8 is a miss: the 6 comes back");
  });
  await probe("warding-maneuver-resistance", async () => {
    await struck(13);
    const hurt = sheet(ally).currentHp;
    const out = await react(warder, "Warding Maneuver", { targetCharacterId: ally.id }, [1]);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(ally).currentHp, hurt + 3, "a 20 against AC 13 + 1 still hits, for half of 6");
  });

  // On the creature's own turn it sidesteps 5 feet, from beside the fighter to
  // beside the fighter: no reach is left, and Hold the Line strikes all the same.
  const line = hero("fighter", "Cavalier", 10);
  const sidestep = async (who) => {
    const [enemy] = await stage(who);
    const encounter = world.encounter();
    kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => !entry.characterId), turnBudget: null });
    const moved = await r.forced([15, 4, 4], () => world.invoke("move_token", { token: enemy.id, x: 6, y: 4 }));
    assert.equal(moved.ok, true, moved.error);
    return enemy;
  };
  const onEnemyTurn = () => sidestep(line);
  await probe("hold-the-line-moves-within-reach", async () => {
    const enemy = await sidestep(line);
    assert.ok(300 - foe(enemy).currentHp > 0, "a creature that moved 5 feet within the cavalier's reach was not struck");
    assert.ok(world.encounter().reactionsUsed.includes(line.id), "it is the cavalier's reaction");
    const other = await sidestep(ally);
    assert.equal(300 - foe(other).currentHp, 0, "a Champion strikes only a creature leaving their reach");
    const none = await react(line, "Hold the Line", { targetEnemyId: enemy.id }, [15, 4, 4]);
    assert.equal(none.ok, false, "no reaction is taken on the call's word: the engine strikes when the creature moves");
  });
  await probe("hold-the-line-speed-0", async () => {
    const enemy = await onEnemyTurn();
    assert.ok(foeHas(enemy, "held in place"), "the opportunity attack's hit left the creature free to move");
    const at = kit.token(enemy.id);
    const moved = await world.invoke("move_token", { token: enemy.id, x: at.x + 3, y: at.y });
    assert.ok(moved.ok === false || kit.token(enemy.id).x === at.x, `a creature held in place walked on: ${show(moved)}`);
  });
  await probe("hold-the-line-until-turn-ends", async () => {
    const enemy = await onEnemyTurn();
    endTurn();
    assert.ok(!foeHas(enemy, "held in place"), "the creature is still held after the turn it was hit in");
  });

  // "when you move at least 10 feet in a straight line right before attacking
  // a creature and hit it": the cavalier runs two squares at the dummy, on the
  // board's own move, and hits it.
  const charge = async (who, from = 3) => {
    const [enemy] = await stage(who);
    kit.place(who.id, from, 5);
    if (from !== 5) assert.equal(await r.walk(who, 5, 5), 200, "the staged run was refused");
    const hit = await swing(who, enemy);
    assert.equal(hit.result.hit, true, hit.error);
    return enemy;
  };
  await probe("ferocious-charger-save", async () => {
    const dc = 8 + prof(15) + MOD;
    const stood = await charge(cavalier);
    const made = await spend(cavalier, "Ferocious Charger", { targetEnemyId: stood.id }, [dc - 1]);
    assert.equal(made.ok, true, made.error);
    assert.deepEqual([made.result.dc, made.result.saved], [dc, true], "the dummy saves at +1");
    assert.ok(!foeHas(stood, "prone"));
    const enemy = await charge(cavalier);
    const failed = await spend(cavalier, "Ferocious Charger", { targetEnemyId: enemy.id }, [dc - 2]);
    assert.equal(failed.result.saved, false);
    assert.ok(foeHas(enemy, "prone"));
    const again = await spend(cavalier, "Ferocious Charger", { targetEnemyId: enemy.id }, [2]);
    assert.equal(again.ok, false, "once on each of their turns");
  });

  await probe("ferocious-charger-needs-a-charge", async () => {
    const [enemy] = await stage(cavalier);
    const idle = await spend(cavalier, "Ferocious Charger", { targetEnemyId: enemy.id }, [2]);
    assert.equal(idle.ok, false, "a cavalier who has not moved and has hit nothing knocked the creature prone");
    const stood = await charge(cavalier, 5);
    const unrun = await spend(cavalier, "Ferocious Charger", { targetEnemyId: stood.id }, [2]);
    assert.equal(unrun.ok, false, `a hit with no run before it: ${show(unrun)}`);
    assert.ok(!foeHas(stood, "prone"));
    // One square is 5 feet: not the 10 the charge asks.
    const short = await charge(cavalier, 4);
    assert.equal((await spend(cavalier, "Ferocious Charger", { targetEnemyId: short.id }, [2])).ok, false, "a run of 5 feet");
    // A run that ends in a miss charges nothing.
    const [missed] = await stage(cavalier);
    kit.place(cavalier.id, 3, 5);
    assert.equal(await r.walk(cavalier, 5, 5), 200);
    kit.setEnemy(missed.id, { ac: 30 });
    await swing(cavalier, missed, [2]);
    assert.equal((await spend(cavalier, "Ferocious Charger", { targetEnemyId: missed.id }, [2])).ok, false, "a run and a miss");
  });
}

// ---- Samurai ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, sheet, budget, has, untilTurnOf } = r;

  await probe("fighting-spirit-advantage-this-turn", async () => {
    const samurai = hero("fighter", "Samurai", 3);
    const [enemy] = await stage(samurai);
    const out = await spend(samurai, "Fighting Spirit");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "it takes the bonus action");
    assert.equal((await swing(samurai, enemy, [15, 15, 4])).toHit.advantage, "advantage");
    untilTurnOf(samurai);
    assert.equal((await swing(samurai, enemy, [15, 15, 4])).toHit.advantage, "none", "the advantage lasts into the next turn");
  });

  await probe("fighting-spirit-temporary-hit-points", async () => {
    for (const [level, temp] of [[3, 5], [9, 5], [10, 10], [14, 10], [15, 15], [20, 15]]) {
      const samurai = hero("fighter", "Samurai", level);
      await stage(samurai);
      await spend(samurai, "Fighting Spirit");
      assert.equal(sheet(samurai).tempHp, temp, `level ${level}`);
    }
  });

  const courtier = hero("fighter", "Samurai", 7, { abilities: { wis: 14, cha: 10 } });
  const plain = hero("fighter", "Champion", 7, { abilities: { wis: 14, cha: 10 } });
  await probe("elegant-courtier-persuasion", async () => {
    await kit.endFight();
    const mine = (await roll(courtier, { kind: "skill_check", skill: "persuasion", dc: 10 })).total;
    const theirs = (await roll(plain, { kind: "skill_check", skill: "persuasion", dc: 10 })).total;
    assert.equal(mine - theirs, 2, `Wisdom 14 adds nothing to the samurai's Persuasion (${mine} against a Champion's ${theirs})`);
  });
  await probe("elegant-courtier-wisdom-save", async () => {
    await kit.endFight();
    const mine = (await roll(courtier, { kind: "saving_throw", ability: "wis", dc: 10 })).total;
    const theirs = (await roll(plain, { kind: "saving_throw", ability: "wis", dc: 10 })).total;
    assert.equal(mine - theirs, prof(7), `a samurai of 7th level saves on Wisdom with no proficiency (${mine} against a Champion's ${theirs})`);
  });

  await probe("rapid-strike-same-target", async () => {
    const samurai = hero("fighter", "Samurai", 15);
    const [first, second] = await stage(samurai, { enemies: 2 });
    kit.place(second.id, 5, 6);
    await spend(samurai, "Fighting Spirit");
    const traded = await swing(samurai, first, [15, 15, 4], { rapidStrike: true });
    assert.equal(traded.ok, true, traded.error);
    const others = [];
    for (let count = 0; count < 3; count += 1) others.push((await swing(samurai, second, [15, 15, 4])).ok);
    assert.deepEqual(others, [true, true, false], "the fighter's own two attacks go where they like; the one Rapid Strike bought is owed to the creature it was traded on");
    assert.equal((await swing(samurai, first, [15, 15, 4])).ok, true, "and is made against that creature");
    // Paid at once: the very next attack at the same creature is the one owed.
    const [again, other] = await stage(samurai, { enemies: 2 });
    kit.place(other.id, 5, 6);
    await spend(samurai, "Fighting Spirit");
    await swing(samurai, again, [15, 15, 4], { rapidStrike: true });
    await swing(samurai, again, [15, 15, 4]);
    const free = [];
    for (let count = 0; count < 2; count += 1) free.push((await swing(samurai, other, [15, 15, 4])).ok);
    assert.deepEqual(free, [true, true], "with the owed attack made, the rest go to anybody");
  });

  await probe("strength-before-death-failures", async () => {
    const samurai = hero("fighter", "Samurai", 18, { ac: 5 });
    const other = hero("fighter", "Champion", 5);
    const [enemy] = await stage(other, { cast: [[samurai, 6, 6]] });
    world.patch(samurai.id, { currentHp: 3 });
    await r.enemyHits(enemy, samurai, [16, 4]);
    assert.equal(sheet(samurai).currentHp, 0);
    const out = await spend(samurai, "Strength before Death");
    assert.equal(out.ok, true, out.error);
    assert.ok(has(samurai, "strength before death") && !has(samurai, "unconscious"));
    const hurt = await world.invoke("apply_damage", { characterId: samurai.id, amount: 4, type: "slashing" });
    assert.equal(hurt.ok, true, hurt.error);
    assert.equal(sheet(samurai).deathSaves?.failures, 1, "damage at 0 during the extra turn is a death save failure");
  });
}

// ---- Echo Knight ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, budget, show } = r;
  const echo = hero("fighter", "Echo Knight", 18);

  await probe("manifest-echo-no-door", async () => {
    await stage(echo);
    const tokens = () => JSON.stringify(kit.map()).length;
    const out = await spend(echo, "Manifest Echo");
    assert.equal(out.ok, true, `an Echo Knight has no way to manifest the echo: ${show(out)}`);
    assert.equal(budget().bonusUsed, true);
    assert.ok(tokens());
  });

  await probe("reclaim-potential-temporary-hit-points", async () => {
    await stage(echo);
    // "When an echo of yours is destroyed by taking damage": the counter answers
    // that record (trigger-table.ts own_echo_destroyed), put on it here as
    // authored-reactions.ts does when the echo falls. This probe is the temporary
    // hit points; the spends sweep stages the echo's fall through its own door.
    const { recordTrigger } = await import("../src/lib/dm/last-save.ts");
    const [foe] = world.enemies();
    const unbroken = await spend(echo, "Reclaim Potential", {}, 2);
    assert.equal(unbroken.ok, false, `with no echo destroyed on record: ${show(unbroken)}`);
    recordTrigger(world.campaignId, { kind: "echo_destroyed", characterId: echo.id, forcer: { id: foe.id, name: foe.displayName } });
    const out = await spend(echo, "Reclaim Potential", {}, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(echo).tempHp, 2 + 2 + MOD, "2d6 (two 2s) + Constitution");
  });

  // "Make one extra melee attack from your echo's space when you take the
  // Attack action": the Attack action, once begun, holds one more attack, once
  // an action, and only while the echo is out (turn-budget.ts grantActionAttack).
  await probe("unleash-incarnation-extra-attack", async () => {
    const [enemy] = await stage(echo);
    const unmanifested = await spend(echo, "Unleash Incarnation");
    assert.equal(unmanifested.ok, false, `with no echo out: ${show(unmanifested)}`);
    assert.equal((await spend(echo, "Manifest Echo")).ok, true);
    const early = await spend(echo, "Unleash Incarnation");
    assert.equal(early.ok, false, `before the Attack action: ${show(early)}`);
    await kit.swing(echo.id, enemy.id, [15, 4, 4, 4]);
    const allowed = budget().attacksAllowed;
    const out = await spend(echo, "Unleash Incarnation");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().attacksAllowed, allowed + 1, "one more attack in the action");
    const twice = await spend(echo, "Unleash Incarnation");
    assert.equal(twice.ok, false, `a second in the same action: ${show(twice)}`);
  });

  // ---- the echo on the board (src/lib/dm/mt-fb-echo.ts) ----
  const third = hero("fighter", "Echo Knight", 3);
  const { getTokenByRef } = await import("../src/lib/db/battle-maps.ts");
  const echoOf = (who, ref = "echo") => getTokenByRef(kit.map().id, `${ref}:${who.id}`);
  const echoName = (who) => `${sheet(who).name}'s echo`;
  const feet = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
  const at = (token) => (token ? [token.x, token.y] : null);
  const manifested = async (who) => {
    const out = await spend(who, "Manifest Echo");
    assert.equal(out.ok, true, `Manifest Echo was refused: ${show(out)}`);
    assert.ok(echoOf(who) || echoOf(who, "echo2"), `no echo stands on the board: ${show(out)}`);
    return echoOf(who);
  };
  const moveEcho = (who, x, y) => world.invoke("move_token", { token: echoName(who), x, y });
  const aside = (enemy) => kit.place(enemy.id, kit.map().width - 2, kit.map().height - 1);

  // "It has AC 14 + your proficiency bonus, 1 hit point": the dummy's +4
  // misses AC 16 on an 11 and destroys the echo on a 12. "Destroyed if it ends
  // your turn more than 30 feet from you", and gone when the knight is
  // incapacitated.
  await probe("manifest-echo-one-hit-point-and-leash", async () => {
    const [enemy] = await stage(third);
    const token = await manifested(third);
    assert.ok(feet(token, kit.token(third.id)) <= 15, "the echo was manifested more than 15 feet away");
    assert.equal(token.kind, "prop", "a token no condition or targeted effect can land on");
    const strike = async (face) => {
      kit.freshRound();
      return r.forced([face, 4], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: echoName(third) }));
    };
    const miss = await strike(11);
    assert.deepEqual([miss.ok, miss.result?.hit, Boolean(echoOf(third))], [true, false, true], `a 15 against AC 16: ${show(miss)}`);
    const hit = await strike(12);
    assert.deepEqual([hit.ok, hit.result?.hit, echoOf(third)], [true, true, null], `a 16 against AC 16, 1 hit point: ${show(hit)}`);
    assert.ok(!r.has(third, "echo manifested"), "the mark outlived the echo");
    // The leash: 30 feet at the turn's end holds it, 35 does not.
    const [other] = await stage(third);
    aside(other);
    assert.deepEqual(at(await manifested(third)), [4, 4]);
    assert.equal((await moveEcho(third, 10, 4)).ok, true);
    assert.equal(await r.walk(third, 4, 5), 200);
    r.endTurn();
    assert.ok(echoOf(third), "an echo 30 feet off as the turn ended was destroyed");
    r.untilTurnOf(third);
    assert.equal(await r.walk(third, 3, 5), 200);
    r.endTurn();
    assert.equal(echoOf(third), null, "an echo 35 feet off as the turn ended still stands");
    assert.ok(!r.has(third, "echo manifested"));
    // Incapacitated: the echo goes at the next settle point.
    const [last] = await stage(third);
    aside(last);
    await manifested(third);
    r.give(third, "stunned");
    r.endTurn();
    assert.equal(echoOf(third), null, "a stunned knight's echo still stands");
  });

  // "Command it to move up to 30 feet without an action, swap places with it
  // as a bonus action for 15 feet of your movement, and make any attack of
  // the Attack action from its space."
  await probe("manifest-echo-move-swap-attack", async () => {
    const [enemy] = await stage(third);
    kit.place(enemy.id, 11, 5);
    await manifested(third);
    const early = await swing(third, enemy, [15, 4]);
    assert.equal(early.ok, false, "a creature 30 feet from the knight and farther from the echo was struck");
    assert.equal((await moveEcho(third, 11, 4)).ok, false, "35 feet in one turn");
    const moved = await moveEcho(third, 10, 4);
    assert.equal(moved.ok, true, show(moved));
    assert.equal((await moveEcho(third, 10, 5)).ok, false, "5 feet more after the 30");
    const hit = await swing(third, enemy, [15, 4]);
    assert.equal(hit.ok, true, `the attack was not made from the echo's space: ${String(hit.error).slice(0, 160)}`);
    kit.freshTurn();
    const before = r.moveTiles(third);
    const swapped = await spend(third, "Manifest Echo", { variant: "swap" });
    assert.equal(swapped.ok, true, show(swapped));
    assert.deepEqual([at(kit.token(third.id)), at(echoOf(third))], [[10, 4], [5, 5]], "the two traded places");
    assert.equal(before - r.moveTiles(third), 3, "15 feet of the knight's movement");
    assert.equal(budget().bonusUsed, true, "a bonus action");
  });

  // "When a creature you can see within 5 feet of it moves at least 5 feet
  // away from it, a reaction makes an opportunity attack as if you stood
  // there": the creature walks off from beside the echo, 25 feet from the knight.
  await probe("manifest-echo-opportunity-attack", async () => {
    const [enemy] = await stage(third);
    kit.place(enemy.id, 11, 5);
    await manifested(third);
    assert.equal((await moveEcho(third, 10, 4)).ok, true);
    const encounter = world.encounter();
    kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => !entry.characterId), turnBudget: null });
    const moved = await r.forced([15, 4, 4], () => world.invoke("move_token", { token: enemy.id, x: 13, y: 5 }));
    assert.equal(moved.ok, true, moved.error);
    assert.ok(300 - r.foe(enemy).currentHp > 0, `a creature leaving the echo's side was not struck: ${show(moved)}`);
    assert.ok(world.encounter().reactionsUsed.includes(third.id), "it is the knight's reaction");
  });

  // "Manifest two echoes at once" at 18th level; before it, another replaces
  // the one out.
  await probe("legion-of-one-two-echoes", async () => {
    await stage(third);
    await manifested(third);
    kit.freshTurn();
    await manifested(third);
    assert.equal(echoOf(third, "echo2"), null, "a 3rd-level knight has two echoes out");
    await stage(echo);
    await manifested(echo);
    kit.freshTurn();
    await manifested(echo);
    const pair = [echoOf(echo), echoOf(echo, "echo2")];
    assert.ok(pair[0] && pair[1], "an 18th-level knight's second echo took the first's place");
    assert.notDeepEqual(at(pair[0]), at(pair[1]), "two echoes in one square");
    kit.freshTurn();
    await manifested(echo);
    assert.ok(echoOf(echo) && echoOf(echo, "echo2"), "a third leaves two standing");
  });

  // "When you roll initiative with no Unleash Incarnation uses left, you
  // regain one": nothing with a use left, one with none.
  await probe("legion-of-one-regains-on-initiative", async () => {
    await kit.endFight();
    const top = r.max(echo, "sub_unleash_incarnation");
    r.setUsed(echo, "sub_unleash_incarnation", 1);
    await r.roll(echo, { kind: "initiative" });
    assert.equal(r.used(echo, "sub_unleash_incarnation"), 1, "with a use left, initiative gave one back");
    await kit.endFight();
    r.setUsed(echo, "sub_unleash_incarnation", top);
    await r.roll(echo, { kind: "initiative" });
    assert.equal(r.used(echo, "sub_unleash_incarnation"), top - 1, "with none left, initiative gave none back");
  });
}

// ---- Psi Warrior ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, sheet, foe, foeHas, used, max, budget, has, give, show } = r;
  const DIE = { 3: 6, 5: 8, 11: 10, 17: 12 };
  const allies = [1, 2, 3, 4].map(() => hero("fighter", "Champion", 5, { ac: 5 }));

  await probe("psionic-dice-count-and-size", async () => {
    for (const [level, sides] of Object.entries(DIE)) {
      const psi = hero("fighter", "Psi Warrior", Number(level));
      assert.equal(max(psi, "sub_psionic_energy"), 2 * prof(Number(level)), `level ${level}: twice the proficiency bonus`);
      const [enemy] = await stage(psi);
      await swing(psi, enemy);
      const struck = foe(enemy).currentHp;
      const out = await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id }, 20);
      assert.equal(out.ok, true, out.error);
      assert.equal(struck - foe(enemy).currentHp, sides + MOD, `level ${level}: a d${sides} at its most, plus Intelligence`);
      assert.equal(out.result.damageType, "force");
    }
  });

  const psi = hero("fighter", "Psi Warrior", 15);
  await probe("psionic-strike-once-a-turn", async () => {
    const [enemy] = await stage(psi);
    await swing(psi, enemy);
    assert.equal((await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id })).ok, true);
    assert.equal((await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id })).ok, false, "a second strike in one turn");
    assert.equal(used(psi, "sub_psionic_energy"), 1);
  });
  await probe("psionic-strike-needs-a-hit", async () => {
    const [enemy] = await stage(psi);
    const out = await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id });
    assert.equal(out.ok, false, `with no attack made this turn the die dealt ${300 - foe(enemy).currentHp} force damage`);
  });

  await probe("protective-field", async () => {
    const [enemy] = await stage(allies[0], { cast: [[psi, 12, 5]] });
    await enemyHits(enemy, allies[0], [16, 4]);
    const far = await react(psi, "Protective Field", { targetCharacterId: allies[0].id }, 4);
    assert.equal(far.ok, false, "an ally 35 feet away is beyond its 30 feet");
    assert.equal(used(psi, "sub_psionic_energy"), 0);
    kit.place(psi.id, 11, 5);
    const hurt = sheet(allies[0]).currentHp;
    const near = await react(psi, "Protective Field", { targetCharacterId: allies[0].id }, 2);
    assert.equal(near.ok, true, near.error);
    assert.equal(sheet(allies[0]).currentHp, hurt + 2 + MOD, "the die (a 2) plus Intelligence comes off the 6");
    assert.equal(used(psi, "sub_psionic_energy"), 1);
    assert.ok(world.encounter().reactionsUsed.includes(psi.id), "it takes the reaction");
    const [again] = await stage(psi);
    world.patch(psi.id, { ac: 5, acOverride: true });
    await enemyHits(again, psi, [16, 4]);
    const own = sheet(psi).currentHp;
    assert.equal((await react(psi, "Protective Field", {}, 2)).ok, true, "on the psi warrior's own hit");
    assert.equal(sheet(psi).currentHp, own + 2 + MOD);
  });

  await probe("telekinetic-movement-free-use", async () => {
    await stage(psi);
    const out = await spend(psi, "sub_psionic_energy", { variant: "telekinetic movement" });
    assert.equal(out.ok, true, out.error);
    assert.equal(used(psi, "sub_psionic_energy"), 0, "the first Telekinetic Movement after a rest cost a Psionic Energy die");
    assert.equal(budget().actionUsed, true, "it takes the action");
    // "Or by spending a die": the second use before a rest takes one.
    kit.freshTurn();
    const second = await spend(psi, "Telekinetic Movement");
    assert.equal(second.ok, true, second.error);
    assert.deepEqual([used(psi, "sub_telekinetic_movement"), used(psi, "sub_psionic_energy")], [1, 1], "the free use, then a die");
    // "Once per short rest": the rest gives the free use back, not the die.
    await kit.endFight();
    assert.equal((await world.invoke("take_rest", { kind: "short" })).ok, true);
    assert.deepEqual([used(psi, "sub_telekinetic_movement"), used(psi, "sub_psionic_energy")], [0, 1]);
  });
  // "As a bonus action you can regain one spent die."
  await probe("psionic-recovery", async () => {
    await stage(psi);
    const full = await spend(psi, "Psionic Recovery");
    assert.equal(full.ok, false, `with every die unspent: ${show(full)}`);
    assert.equal(used(psi, "sub_psionic_recovery"), 0, "a refusal spends nothing");
    r.setUsed(psi, "sub_psionic_energy", 3);
    const out = await spend(psi, "Psionic Recovery");
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([used(psi, "sub_psionic_energy"), used(psi, "sub_psionic_recovery")], [2, 1], "one die back, the use spent");
    assert.equal(budget().bonusUsed, true, "a bonus action");
    kit.freshTurn();
    assert.equal((await spend(psi, "Psionic Recovery")).ok, false, "once per short or long rest");
  });

  await probe("telekinetic-adept-leap-and-thrust", async () => {
    const [enemy] = await stage(psi);
    await swing(psi, enemy);
    await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id });
    const thrust = await spend(psi, "Telekinetic Adept", { variant: "thrust", targetEnemyId: enemy.id }, 2);
    assert.equal(thrust.ok, true, thrust.error);
    assert.ok(foeHas(enemy, "prone"));
    const leap = await spend(psi, "Telekinetic Adept", { variant: "leap" });
    assert.equal(leap.ok, true, leap.error);
    assert.ok(has(psi, "flying"));
    assert.equal(budget().bonusUsed, true);
  });
  await probe("telekinetic-thrust-needs-a-strike", async () => {
    const [enemy] = await stage(psi);
    const out = await spend(psi, "Telekinetic Adept", { variant: "thrust", targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, false, "with no Psionic Strike made, Thrust knocked the creature prone");
  });
  // The text now states the save the engine rolls: "to make a Strength save
  // (DC 8 + your proficiency bonus + your Intelligence modifier) or be knocked
  // prone or pushed 10 feet".
  const struck = async () => {
    const [enemy] = await stage(psi);
    await swing(psi, enemy);
    await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id });
    return enemy;
  };
  await probe("telekinetic-thrust-save", async () => {
    const text = (await import("../src/lib/srd/subclasses.json", { with: { type: "json" } })).default.classes.fighter.flatMap((sub) => Object.values(sub.levels).flat()).find((feature) => feature.n === "Telekinetic Adept").d;
    assert.match(text, /Strength save \(DC 8 \+ your proficiency bonus \+ your Intelligence modifier\)/, "the stored text states the save");
    const made = await struck();
    const kept = await spend(psi, "Telekinetic Adept", { variant: "thrust", targetEnemyId: made.id }, 20);
    assert.deepEqual([kept.result.dc, kept.result.saved], [8 + prof(15) + MOD, true], show(kept));
    assert.ok(!foeHas(made, "prone"), "a save made: it stands");
    const failed = await struck();
    assert.equal((await spend(psi, "Telekinetic Adept", { variant: "thrust", targetEnemyId: failed.id }, 2)).result.saved, false);
    assert.ok(foeHas(failed, "prone"));
  });
  await probe("telekinetic-thrust-push", async () => {
    const enemy = await struck();
    const at = kit.token(enemy.id);
    const out = await spend(psi, "Telekinetic Adept", { variant: "push", targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([kit.token(enemy.id).x, kit.token(enemy.id).y], [at.x + 2, at.y], `a failed save pushes it 10 feet straight away: ${show(out)}`);
    assert.ok(!foeHas(enemy, "prone"), "pushed, not prone");
    const stood = await struck();
    const where = kit.token(stood.id);
    await spend(psi, "Telekinetic Adept", { variant: "push", targetEnemyId: stood.id }, 20);
    assert.deepEqual([kit.token(stood.id).x, kit.token(stood.id).y], [where.x, where.y], "a save made: it stays");
    const idle = await stage(psi);
    assert.equal((await spend(psi, "Telekinetic Adept", { variant: "push", targetEnemyId: idle[0].id }, 2)).ok, false, "with no Psionic Strike made");
  });

  await probe("guarded-mind-resistance", async () => {
    await kit.endFight();
    world.patch(psi.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: psi.id, amount: 10, type: "psychic" });
    assert.equal(sheet(psi).currentHp, 55);
  });
  await probe("guarded-mind-ends-a-condition", async () => {
    await stage(psi);
    give(psi, "frightened", { rounds: 5 });
    const out = await spend(psi, "sub_psionic_energy", { variant: "guarded mind" });
    assert.ok(out.ok && !has(psi, "frightened"), `a die was ${out.ok ? "spent" : "refused"} and the fighter is still frightened`);
    assert.equal(used(psi, "sub_psionic_energy"), 1, "by spending a die");
    assert.equal(budget().reactionUsed ?? false, false, "reaction-free");
    give(psi, "charmed", { rounds: 5 });
    assert.equal((await spend(psi, "Guarded Mind")).ok, true, "charmed, by the feature's own name");
    assert.ok(!has(psi, "charmed"));
    const calm = await spend(psi, "Guarded Mind");
    assert.equal(calm.ok, false, "neither charmed nor frightened: nothing to end");
    assert.equal(used(psi, "sub_psionic_energy"), 2, "and nothing spent");
  });

  await probe("bulwark-of-force", async () => {
    const [enemy] = await stage(psi, { cast: [[allies[0], 5, 6], [allies[1], 4, 5], [allies[2], 4, 6], [allies[3], 4, 4]] });
    const out = await spend(psi, "Bulwark of Force");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
    assert.equal(allies.filter((ally) => has(ally, "bulwark of force")).length, MOD, "the Intelligence modifier in allies");
    assert.ok(has(psi, "bulwark of force"), "and the psi warrior");
    assert.equal(sheet(psi).conditionMeta["bulwark of force"].rounds, 10, "a minute");
    const covered = allies.find((ally) => has(ally, "bulwark of force"));
    world.patch(covered.id, { ac: 12, acOverride: true });
    const hurt = sheet(covered).currentHp;
    await enemyHits(enemy, covered, [9, 4]);
    assert.equal(sheet(covered).currentHp, hurt, "13 to hit against AC 12 behind half cover is a miss");
    kit.freshTurn();
    assert.equal((await spend(psi, "Bulwark of Force")).ok, true, "a second use, for a die");
    assert.deepEqual([used(psi, "sub_bulwark_of_force"), used(psi, "sub_psionic_energy")], [1, 1]);
  });
  // The text now states the reach the engine keeps: "allies within 30 feet".
  await probe("bulwark-of-force-30-feet", async () => {
    await stage(psi, { cast: [[allies[0], 12, 5]] });
    await spend(psi, "Bulwark of Force");
    assert.ok(!has(allies[0], "bulwark of force"), "an ally 35 feet away was covered");
    await stage(psi, { cast: [[allies[0], 11, 5]] });
    await spend(psi, "Bulwark of Force");
    assert.ok(has(allies[0], "bulwark of force"), "an ally 30 feet away was left out");
  });

  // "Cast telekinesis for free once per long rest": the spell's own tool
  // casts it with no slot and spends the use; a bare spend is refused.
  await probe("telekinetic-master-free-cast", async () => {
    const master = hero("fighter", "Psi Warrior", 18);
    await stage(master);
    const bare = await spend(master, "Telekinetic Master");
    assert.equal(bare.ok, false, `a bare spend: ${show(bare)}`);
    assert.equal(used(master, "sub_telekinetic_master"), 0);
    const cast = await world.invoke("use_spell_slot", { characterId: master.id, spell: "Telekinesis", level: 5 });
    assert.equal(cast.ok, true, cast.error);
    assert.deepEqual([used(master, "sub_telekinetic_master"), sheet(master).concentratingOn], [1, "Telekinesis"], "the use spent, the spell held");
    kit.freshTurn();
    assert.equal((await world.invoke("use_spell_slot", { characterId: master.id, spell: "Telekinesis", level: 5 })).ok, false, "once per long rest");
  });
  await probe("telekinetic-master-bonus-attack", async () => {
    const master = hero("fighter", "Psi Warrior", 18);
    const [enemy] = await stage(master);
    for (let count = 0; count < 3; count += 1) await swing(master, enemy);
    assert.equal((await swing(master, enemy, [15, 4], { feature: "Telekinetic Master" })).ok, false, "not while concentrating on telekinesis");
    world.patch(master.id, { concentratingOn: "Telekinesis" });
    const out = await swing(master, enemy, [15, 4], { feature: "Telekinetic Master" });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
  });
}

// ---- Rune Knight ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, sheet, budget, has, d20s, show } = r;
  const options = await import("../src/lib/srd/options.ts");

  await probe("runes-known", () => {
    assert.deepEqual([3, 7, 10, 15].map((level) => options.optionSlotsFor("fighter", "Rune Knight", level, "rune")), [2, 3, 4, 5]);
  });

  await probe("rune-carver-runes-do-nothing", async () => {
    const carver = hero("fighter", "Rune Knight", 7);
    world.patch(carver.id, { currentHp: 80, features: [...sheet(carver).features, ...["Stone Rune", "Hill Rune"].map((name) => ({ name: options.optionFeatureName("rune", name), source: "class" }))] });
    await kit.endFight();
    const insight = d20s(await roll(carver, { kind: "skill_check", skill: "insight", dc: 10 }));
    const poison = d20s(await roll(carver, { kind: "saving_throw", ability: "con", dc: 10, against: "poisoned" }));
    const before = sheet(carver).currentHp;
    await world.invoke("apply_damage", { characterId: carver.id, amount: 10, type: "poison" });
    const lost = before - sheet(carver).currentHp;
    // Invoked: the Hill Rune's bonus action, once a short rest at 7th level,
    // twice at 15th (Master of Runes).
    const [enemy] = await stage(carver);
    const invoked = await spend(carver, "Hill Rune");
    kit.freshTurn();
    const again = await spend(carver, "Hill Rune");
    const master = hero("fighter", "Rune Knight", 15);
    world.patch(master.id, { features: [...sheet(master).features, { name: options.optionFeatureName("rune", "Hill Rune"), source: "class" }] });
    const got = { insight, poison, lost, invoked: invoked.ok, resisting: sheet(carver).conditions.includes("hill rune"), again: again.ok, uses: [sheet(carver).resources.sub_hill_rune?.max, sheet(master).resources.sub_hill_rune?.max], foe: Boolean(enemy) };
    assert.deepEqual(
      got,
      { insight: 2, poison: 2, lost: 5, invoked: true, resisting: true, again: false, uses: [1, 2], foe: true },
      `${JSON.stringify(got)}: Stone Rune (advantage on Insight) and Hill Rune (advantage on saves against poison, resistance to poison damage, invoked for resistance to blows) on a knight who carries both`,
    );
  });

  // The other runes' invocations and passives: Frost's +2 to Strength saves,
  // Hill's resistance to slashing once invoked, Fire's tools doubled and its
  // shackles' fire landing whatever the save.
  await probe("runes-invoked", async () => {
    const { toolProficiencyBonus } = await import("../src/lib/dm/roll-riders.ts");
    const knight = hero("fighter", "Rune Knight", 7);
    world.patch(knight.id, { features: [...sheet(knight).features, ...["Frost Rune", "Hill Rune", "Fire Rune"].map((name) => ({ name: options.optionFeatureName("rune", name), source: "class" }))] });
    const [enemy] = await stage(knight);
    const strBefore = (await roll(knight, { kind: "saving_throw", ability: "str", dc: 10 })).total;
    assert.equal((await spend(knight, "Frost Rune")).ok, true, "Frost Rune is a bonus action");
    kit.freshTurn();
    const strAfter = (await roll(knight, { kind: "saving_throw", ability: "str", dc: 10 })).total;
    assert.equal(strAfter - strBefore, 2, "Frost Rune: +2 to Strength saves");
    const hill = await spend(knight, "Hill Rune");
    assert.equal(hill.ok, true, hill.error);
    const before = sheet(knight).currentHp;
    await world.invoke("apply_damage", { characterId: knight.id, amount: 10, type: "slashing" });
    assert.equal(before - sheet(knight).currentHp, 5, "Hill Rune invoked: resistance to slashing");
    const tools = toolProficiencyBonus({ ...sheet(knight), proficiencies: { ...sheet(knight).proficiencies, tools: ["Smith's tools"] } }, "smith's tools", 3);
    assert.equal(tools?.bonus, 6, "Fire Rune: proficiency doubled on tool checks");
    const hp = kit.enemy(enemy.id).currentHp;
    await swing(knight, enemy, [15, 4, 4]);
    const afterHit = kit.enemy(enemy.id).currentHp;
    const fire = await spend(knight, "Fire Rune", { targetEnemyId: enemy.id }, 20);
    assert.equal(fire.ok, true, fire.error);
    assert.ok(afterHit - kit.enemy(enemy.id).currentHp >= 2, `Fire Rune's 2d6 fire lands even when the save is made (${hp} -> ${afterHit} -> ${kit.enemy(enemy.id).currentHp})`);
  });

  // ---- the runes that answer a moment off the knight's turn (mt-fb-runes.ts):
  // a table of their own, so the order holds only the knight, an ally and the foes.
  {
    const t = await openRig();
    const { call } = await import("./lib/enforce-campaign.mjs");
    const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
    const { subscribe } = await import("../src/lib/events.ts");
    const { enemySpeedTiles } = await import("../src/lib/dm/enemy-speed.ts");
    const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
    const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
    const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
    const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
    const afterRoll = await t.world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
    const watch = await t.world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch");
    const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
    const { settleQueue } = await import("./lib/enforce-narrator.mjs");
    const rune = (name) => ({ name: options.optionFeatureName("rune", name), source: "class" });
    const knight = t.hero("fighter", "Rune Knight", 7);
    const ally = t.hero("fighter", "Champion", 7);
    t.world.patch(knight.id, { features: [...t.sheet(knight).features, ...["Stone Rune", "Cloud Rune", "Storm Rune"].map(rune)] });
    // The Hand's reaction strip as the knight's page deals it.
    const strip = (who) => {
      const sheet = t.world.sheet(who.id);
      const encounter = activePublicEncounter(t.world.campaignId);
      const view = buildPlayerMapView(t.world.campaignId, sheet.userId);
      return reactionCards(sheet, turnFromEncounter(encounter, sheet, { myTurn: false }), encounter?.lastHits ?? [], t.world.sheets(), "you", view?.feet, encounter?.lastSaves);
    };
    const named = (cards, name) => cards.filter((card) => card.name === name);

    // "When a creature you can see ends its turn within 30 feet of you": a
    // Wisdom save or charmed for a minute, incapacitated at speed 0, saving at
    // the end of each of its turns. Nothing to answer on the knight's own turn.
    await probe("rune-stone-charm", async () => {
      const [enemy] = await t.stage(knight, { cast: [[ally, 3, 3]] });
      const early = await t.react(knight, "Stone Rune");
      assert.equal(early.ok, false, `no turn has ended near the knight: ${t.show(early)}`);
      assert.equal(t.used(knight, "sub_stone_rune"), 0, "nothing spent");
      // The foes' turns come while nobody's is on the floor (enemies due);
      // the hand-on ends the goblin's, the last turn to end.
      const foesUp = () => {
        for (let step = 0; step < 6 && t.turns.pointer().id !== null; step += 1) t.endTurn();
        assert.equal(t.turns.pointer().id, null, "the foes' turns are due");
      };
      foesUp();
      t.endTurn();
      assert.equal(named(strip(knight), "Stone Rune").length, 1, "its card comes up as the foe's turn ends within 30 feet");
      const out = await t.react(knight, "Stone Rune", {}, 2);
      assert.equal(out.ok, true, out.error);
      const held = ["charmed", "incapacitated", "dreamy stupor"].map((name) => t.foeHas(enemy, name));
      assert.deepEqual(held, [true, true, true], `charmed, incapacitated, speed 0: ${t.show(out)}`);
      assert.equal(t.used(knight, "sub_stone_rune"), 1, "the rune's use spent");
      assert.equal(enemySpeedTiles(t.foe(enemy)), 0, "speed 0");
      assert.equal(t.foe(enemy).conditionMeta.charmed.saveEnds?.ability, "wis");
      // Its next turn ends (an incapacitated foe's is walked past): one Wisdom
      // save, made, ends all three together.
      for (let step = 0; step < 6 && t.foeHas(enemy, "charmed"); step += 1) {
        t.world.clearDice();
        t.world.dice(...new Array(8).fill(20));
        t.turns.skipTurn();
        t.world.clearDice();
      }
      assert.deepEqual(["charmed", "incapacitated", "dreamy stupor"].map((name) => t.foeHas(enemy, name)), [false, false, false], "one save ends the charm whole");
    });

    // "When you or a creature you can see within 30 feet of you is hit by an
    // attack roll": a different creature within 30 feet, not the attacker,
    // becomes the target, using the same roll. A reaction that redirects an
    // effect acts before the outcome lands: the hit stops for the knight's
    // player before its damage is rolled (cloud-rune.ts), and the first
    // target's hit points never drop, not even to be given back after.
    await probe("rune-cloud-turns-hit", async () => {
      const [first, second] = await t.stage(knight, { enemies: 2, cast: [[ally, 5, 6]] });
      const before = t.sheet(ally).currentHp;
      const foeHp = t.foe(second).currentHp;
      const rollsBefore = new Set(listRecentRolls(t.world.campaignId, 500).map((roll) => roll.id));
      // Every hit-point figure the table is shown for the ally: a blow dealt
      // and then given back shows here as a dip, whatever the end state.
      const shown = [];
      const hear = (chunk) => {
        const type = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        const sheet = type === "sheet_updated" && data ? JSON.parse(data).sheet : null;
        if (sheet?.id === ally.id && typeof sheet.currentHp === "number") shown.push(sheet.currentHp);
      };
      // The knight's player is at the table: a stop reaches them.
      const offs = [subscribe(t.world.campaignId, hear, t.sheet(knight).userId), subscribe(t.world.campaignId, hear, t.sheet(ally).userId)];
      try {
        t.kit.freshRound();
        const out = await t.forced([16, 4], () => t.world.invoke("enemy_attack", { enemyId: first.id, targetCharacterId: ally.id }));
        assert.equal(out.ok, true, out.error);
        const [stop] = listOpenPendingRolls(t.world.campaignId).filter((pending) => pending.parkedFor === "watch");
        assert.equal(stop?.watch?.power, "cloud_rune", `the hit stops for the knight before its damage: ${t.show(out)}`);
        assert.equal(t.sheet(ally).currentHp, before, "the club landed before the knight was asked");
        const names = stop.watch.choices.map((choice) => choice.name);
        assert.ok(!stop.watch.choices.some((choice) => choice.ref === first.id || choice.ref === ally.id), `the attacker and the one it hit are no choices: ${names}`);
        const onto = stop.watch.choices.findIndex((choice) => choice.ref === second.id);
        assert.ok(onto >= 0, `the other foe within 30 feet is a choice: ${names}`);
        // The same roll: its d20 comes again off the stop's tape. Then the
        // club's damage, for the other foe: 4 + 2.
        t.world.signIn({ id: t.sheet(knight).userId });
        t.world.dice(4);
        const answered = await call(watch, "POST", { shift: true, choice: onto }, { campaignId: t.world.campaignId, pendingRollId: stop.id });
        assert.equal(answered.status, 200, JSON.stringify(answered.json));
        await settleQueue(t.world.campaignId);
        t.world.clearDice();
      } finally {
        for (const off of offs) off();
      }
      assert.equal(foeHp - t.foe(second).currentHp, 6, "the same blow lands on the other foe");
      assert.equal(t.sheet(ally).currentHp, before, "the ally keeps every hit point");
      assert.ok(shown.every((hp) => hp >= before), `the ally's hit points dropped and came back: ${shown.join(", ")}`);
      const dealt = listRecentRolls(t.world.campaignId, 500).filter((roll) => !rollsBefore.has(roll.id) && roll.kind === "damage" && roll.characterId === ally.id);
      assert.equal(dealt.length, 0, "damage was rolled against the ally");
      assert.equal(t.used(knight, "sub_cloud_rune"), 1);
      assert.ok(t.world.encounter().reactionsUsed.includes(knight.id), "the knight's reaction spent");
      // Nothing answers the hit once its damage is dealt: a seat no stop
      // reaches (the player away) sees the attack land as rolled.
      const [foe] = await t.stage(knight, { cast: [[ally, 5, 6]] });
      await t.enemyHits(foe, ally, [16, 4]);
      assert.equal(t.sheet(ally).currentHp, before - 6, "the club lands on the ally");
      assert.equal(listOpenPendingRolls(t.world.campaignId).filter((pending) => pending.parkedFor === "watch").length, 0, "an absent player's knight was stopped for");
      assert.equal(named(strip(knight), "Cloud Rune").length, 0, "a card offers the rune after the damage");
      const late = await t.react(knight, "Cloud Rune", { targetCharacterId: ally.id, targetEnemyId: foe.id });
      assert.equal(late.ok, false, "the rune gave back a hit already dealt");
      assert.equal(t.used(knight, "sub_cloud_rune"), 0);
    });

    // The prophetic state answers the attacks, saves and checks of a creature
    // the knight can see within 60 feet, not only attacks on the knight: an
    // ally's hit by a foe is rolled again at disadvantage, and an ally's own
    // d20 waits on the knight's card for advantage before it lands.
    await probe("rune-storm-prophetic-allies", async () => {
      const [enemy] = await t.stage(knight, { cast: [[ally, 5, 6]] });
      t.give(knight, "prophetic state");
      const before = t.sheet(ally).currentHp;
      await t.enemyHits(enemy, ally, [16, 4]);
      const out = await t.react(knight, "Prophetic State", { targetCharacterId: ally.id }, 1);
      assert.equal(out.ok, true, out.error);
      assert.equal(t.sheet(ally).currentHp, before, `rolled again at disadvantage, the hit misses: ${t.show(out)}`);
      const [foe] = await t.stage(ally, { cast: [[knight, 5, 6]] });
      t.give(knight, "prophetic state");
      const here = subscribe(t.world.campaignId, () => {}, t.sheet(knight).userId);
      try {
        await t.swing(ally, foe, [2]);
        const [pending] = listOpenPendingRolls(t.world.campaignId);
        const offered = (pending?.thrown?.options ?? []).filter((option) => option.id === "prophetic_state");
        assert.deepEqual(offered.map((option) => option.by), [knight.id], "the knight's card on the ally's missed swing");
        t.world.signIn({ id: t.sheet(knight).userId });
        t.world.dice(19);
        const pressed = await call(afterRoll, "POST", { use: "prophetic_state", by: knight.id }, { campaignId: t.world.campaignId, pendingRollId: pending.id });
        t.world.clearDice();
        assert.equal(pressed.status, 200, JSON.stringify(pressed.json));
        assert.ok(t.world.encounter().reactionsUsed.includes(knight.id), "the knight's reaction spent");
        assert.ok(t.foe(foe).currentHp < 300, "the higher d20 kept: the swing hits");
      } finally {
        here();
      }
    });
  }

  const mighty = async (level) => {
    const knight = hero("fighter", "Rune Knight", level);
    const [enemy] = await stage(knight);
    const out = await spend(knight, "Giant's Might");
    assert.equal(out.ok, true, out.error);
    return { knight, enemy };
  };
  const sides = (hit) => (hit.damage?.breakdown?.terms ?? []).filter((term) => term.kind === "dice").map((term) => term.sides);

  await probe("giants-might", async () => {
    const { knight, enemy } = await mighty(3);
    assert.equal(budget().bonusUsed, true, "a bonus action");
    assert.equal(sheet(knight).conditionMeta["giant's might"].rounds, 10, "a minute");
    assert.deepEqual(sides(await swing(knight, enemy, [15, 4, 4])), [8, 6], "1d6 on the damage roll");
    assert.equal(d20s(await roll(knight, { kind: "saving_throw", ability: "str", dc: 10 })), 2, "Strength saves");
    assert.equal(d20s(await roll(knight, { kind: "ability_check", ability: "str", dc: 10 })), 2, "Strength checks");
    assert.equal(d20s(await roll(knight, { kind: "saving_throw", ability: "dex", dc: 10 })), 1);
  });
  await probe("giants-might-die-grows", async () => {
    for (const [level, die] of [[9, 6], [10, 8], [17, 8], [18, 10]]) {
      const { knight, enemy } = await mighty(level);
      assert.deepEqual(sides(await swing(knight, enemy, [15, 4, 4])), [8, die], `level ${level}`);
    }
  });
  await probe("giants-might-one-roll-a-turn", async () => {
    for (const level of [5, 10]) {
      const { knight, enemy } = await mighty(level);
      await swing(knight, enemy, [15, 4, 4]);
      const second = await swing(knight, enemy, [15, 4, 4]);
      assert.equal(second.result.hit, true, second.error);
      assert.deepEqual(sides(second), [8], `level ${level}: the second hit of the turn carries the die again`);
    }
  });
  await probe("runic-juggernaut-reach", async () => {
    const { knight, enemy } = await mighty(18);
    kit.place(enemy.id, 7, 5);
    const out = await swing(knight, enemy, [15, 4, 4]);
    assert.equal(out.ok, true, `under Giant's Might at 18th level a creature 10 feet away is out of reach: ${String(out.error).slice(0, 90)}`);
  });
}

// ---- Banneret ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, roll, sheet, forced } = r;
  const training = await import("../src/lib/srd/subclass-training.ts");
  const banneret = hero("fighter", "Banneret", 10);
  const first = hero("fighter", "Champion", 5);
  const second = hero("fighter", "Champion", 5);
  const archer = hero("fighter", "Champion", 5, BOW);

  await probe("rallying-cry-heals-allies", async () => {
    await stage(banneret, { cast: [[first, 4, 5]] });
    world.patch(banneret.id, { currentHp: 40 });
    world.patch(first.id, { currentHp: 40 });
    const out = await spend(banneret, "Second Wind", {}, 5);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(banneret).currentHp, 40 + 5 + 10);
    assert.equal(sheet(first).currentHp, 40 + 10, "a wounded ally 5 feet away gained nothing from the Banneret's Second Wind");
  });

  await probe("royal-envoy-expertise", async () => {
    const spec = training.subclassGrants([{ id: "fighter", level: 7, subclass: "Banneret" }]).find((grant) => grant.name === "Royal Envoy")?.spec;
    assert.deepEqual([spec?.fixedSkills, spec?.fixedExpertise], [["persuasion"], ["persuasion"]]);
    const envoy = hero("fighter", "Banneret", 7, { proficiencies: { saves: [], skills: ["persuasion"], expertise: ["persuasion"], languages: ["Common"], tools: [], armor: [], weapons: ["simple", "martial"] } });
    await kit.endFight();
    assert.equal((await roll(envoy, { kind: "skill_check", skill: "persuasion", dc: 10 })).total, 10 + 3 + 2 * prof(7));
  });
  // The grant as it falls on a fighter already proficient in Persuasion
  // (grantsForHeldTraining, which the builder and the level-up both read): a
  // pick of one of the four in its place.
  await probe("royal-envoy-already-proficient", () => {
    const grants = training.subclassGrants([{ id: "fighter", level: 7, subclass: "Banneret" }]);
    const fresh = training.grantsForHeldTraining(grants, { skills: [] }).find((grant) => grant.name === "Royal Envoy").spec;
    assert.deepEqual([fresh.fixedSkills, fresh.skills], [["persuasion"], 0], "with no Persuasion yet: Persuasion, no pick");
    const held = training.grantsForHeldTraining(grants, { skills: ["persuasion"] }).find((grant) => grant.name === "Royal Envoy").spec;
    assert.deepEqual([held.fixedSkills, held.skills, [...held.skillsFrom].sort()], [[], 1, ["animal_handling", "insight", "intimidation", "performance"]], "Royal Envoy's training lists no skill to take in place of a Persuasion already held");
  });

  await probe("inspiring-surge-60-feet", async () => {
    const [enemy] = await stage(banneret, { cast: [[first, 19, 5]] });
    kit.place(enemy.id, 18, 5);
    const out = await react(first, "Inspiring Surge", { targetEnemyId: enemy.id }, [15, 4]);
    assert.equal(out.ok, false, "an ally 70 feet from the Banneret took the attack");
  });
  // "Action Surge also lets an ally": with no surge, there is nothing to answer.
  await probe("inspiring-surge-answers-a-surge", async () => {
    const [enemy] = await stage(banneret, { cast: [[first, 6, 4]] });
    const early = await react(first, "Inspiring Surge", { targetEnemyId: enemy.id }, [15, 4]);
    assert.equal(early.ok, false, "an ally took the attack with no Action Surge used");
    await spend(banneret, "Action Surge");
    const out = await react(first, "Inspiring Surge", { targetEnemyId: enemy.id }, [15, 4]);
    assert.equal(out.ok, true, out.error);
    assert.ok(world.encounter().reactionsUsed.includes(first.id), "the ally's reaction");
  });
  await probe("inspiring-surge-one-ally", async () => {
    const [enemy] = await stage(banneret, { cast: [[first, 6, 4], [second, 6, 6]] });
    await spend(banneret, "Action Surge");
    const answers = [];
    for (const ally of [first, second]) answers.push((await react(ally, "Inspiring Surge", { targetEnemyId: enemy.id }, [15, 4])).ok);
    assert.deepEqual(answers, [true, false], "at 10th level one ally answers the surge");
    assert.ok(!world.encounter().reactionsUsed.includes(second.id), "the ally refused keeps their reaction");
    const marshal = hero("fighter", "Banneret", 18);
    const [foe2] = await stage(marshal, { cast: [[first, 6, 4], [second, 6, 6], [archer, 4, 5]] });
    await spend(marshal, "Action Surge");
    const later = [];
    for (const ally of [first, second, archer]) later.push((await react(ally, "Inspiring Surge", { targetEnemyId: foe2.id }, [15, 4])).ok);
    assert.deepEqual(later, [true, true, false], `two allies from 18th level: ${JSON.stringify(world.encounter().turnBudget?.oncePerTurn)}`);
  });
  await probe("inspiring-surge-any-weapon", async () => {
    const [enemy] = await stage(banneret, { cast: [[archer, 4, 5]] });
    kit.place(enemy.id, 10, 5);
    await spend(banneret, "Action Surge");
    const out = await react(archer, "Inspiring Surge", { targetEnemyId: enemy.id, weapon: "Longbow" }, [15, 4]);
    assert.equal(out.ok, true, `an ally with a longbow, 30 feet from the creature: ${String(out.error).slice(0, 110)}`);
  });

  // "choose one ally within 60 feet of you that also failed its saving throw
  // against the same effect ... it can reroll its saving throw": a DC 15
  // Wisdom save against fear failed by the marshal and two allies, one 20
  // feet off and one 70; Indomitable's reroll brings the near one's with it.
  await probe("bulwark-indomitable-ally", async () => {
    const marshal = hero("fighter", "Banneret", 18, { abilities: { wis: 10 } });
    await stage(marshal, { cast: [[first, 9, 5], [second, 19, 5]] });
    const scare = (who) => forced([2], () => world.invoke("cast_at_player", { characterId: who.id, saveAbility: "wis", dc: 15, condition: "frightened", source: "a dread wail" }));
    for (const who of [marshal, first, second]) assert.equal((await scare(who)).ok, true);
    assert.ok([marshal, first, second].every((who) => sheet(who).conditions.includes("frightened")), "all three failed");
    const out = await spend(marshal, "Indomitable", {}, [19, 19, 19]);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([marshal, first, second].map((who) => sheet(who).conditions.includes("frightened")), [false, false, true], `the marshal and the ally within 60 feet shake it off: ${JSON.stringify(out.result).slice(0, 240)}`);
  });
}

finish();
