// What the GM and the players are told against what the engine holds, from
// the 2026-11-16 rules audit (the state lens, findings V01..). The GM
// narrates from GAME STATE, tool results and refusals, and players act from
// the sheet and the Hand: a line that says something the engine does not
// hold has the GM narrate the wrong rule while the engine is right. Each test
// builds the state, reads the text, and names the SRD 5.1 rule it holds.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-state");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const sheetState = await import("../src/components/sheet/sheet-state.ts");

// V01. SRD 5.1, Find Familiar: "As an action, you can temporarily dismiss
// your familiar into a pocket dimension." The engine and GAME STATE treat a
// pocketed familiar as gone (U12), but the party panel listed it with its
// hit points like one at the wizard's side.
await test("V01: the party panel says a familiar in its pocket dimension is away, and one at hand is not", async () => {
  await kit.endFight();
  const mage = world.addHero({
    class: "wizard", level: 3, maxHp: 20, abilities: { int: 16 }, gold: 20, proficiencies: { ...TRAINED },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Find Familiar"], known: [], cantrips: [] },
  });
  const called = await world.invoke("summon_pet", { characterId: mage.id, kind: "familiar", form: "owl", name: "Hoot" });
  assert.equal(called.ok, true, called.error);
  const hoot = () => world.sheet(mage.id).pets.find((pet) => pet.name === "Hoot");
  assert.equal(sheetState.petAwayNote?.(hoot()) ?? null, null, "a familiar at hand reads as away");
  const away = await world.invoke("dismiss_pet", { characterId: mage.id, petName: "Hoot" });
  assert.equal(away.ok, true, away.error);
  assert.equal(typeof sheetState.petAwayNote, "function", "the panel has no word for a pocketed familiar");
  assert.match(sheetState.petAwayNote(hoot()) ?? "", /pocket dimension/);
  assert.match(describeSheet(world.sheet(mage.id), "a player", false), /Hoot \(owl familiar\): in its pocket dimension/i);
});

// V02. SRD 5.1, Hit Points: "A creature can't regain more hit points than its
// hit point maximum." The engine capped the healing, but heal's result said
// `healed: 20` for a hero 5 short of their maximum, so the GM narrated twenty
// hit points coming back (and the board floated +20).
await test("V02: heal reports the hit points restored, not the amount asked, when the maximum caps it", async () => {
  await kit.endFight();
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 40, proficiencies: { ...TRAINED } });
  world.patch(hero.id, { currentHp: 35 });
  const healed = await world.invoke("heal", { characterId: hero.id, amount: 20 });
  assert.equal(healed.ok, true, healed.error);
  assert.equal(world.sheet(hero.id).currentHp, 40);
  assert.equal(healed.result.healed, 5, `restored 5, told ${JSON.stringify(healed.result)}`);
  // Uncapped, the whole amount.
  world.patch(hero.id, { currentHp: 10 });
  const whole = await world.invoke("heal", { characterId: hero.id, amount: 7 });
  assert.equal(whole.result.healed, 7);
});

// V03. SRD 5.1, Slow: "A target takes a -2 penalty to AC"; Shield of Faith:
// "+2 bonus to AC"; Shield: "+5 bonus to AC". The attack engine reads an
// enemy's AC through enemyAcWithEffects (ac-effects.ts), but GAME STATE gave
// the GM the bare column, so a slowed goblin read AC 15 while every swing
// was rolled against 13.
await test("V03: GAME STATE gives an enemy the AC the attacks are rolled against, with Slow, Shield of Faith and Shield", async () => {
  await kit.endFight();
  world.addHero({ class: "fighter", level: 3, proficiencies: { ...TRAINED } });
  await kit.fight(1);
  const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
  const { enemyAcWithEffects } = await import("../src/lib/dm/ac-effects.ts");
  const { publicEncounter } = await import("../src/lib/db/encounter-view.ts");
  const [foe] = world.enemies();
  kit.setEnemy(foe.id, { ac: 15 });
  for (const [held, ac] of [["slowed", 13], ["shield of faith", 17], ["shielded", 20]]) {
    kit.setEnemy(foe.id, { conditions: [held], conditionMeta: {} });
    assert.equal(enemyAcWithEffects(world.campaignId, kit.enemy(foe.id)), ac, `the staging: ${held}`);
    const told = buildEncounterState(world.campaignId, world.sheets()).enemies.find((entry) => entry.enemyId === foe.id);
    assert.equal(told.ac, ac, `${held}: GAME STATE says AC ${told.ac}, the attacks roll against ${ac}`);
    // The GM console's encounter panel and the monster Hand read the same.
    const shown = publicEncounter(world.encounter(), world.enemies(), { enemyNumbers: true }).enemies.find((entry) => entry.id === foe.id);
    assert.equal(shown.ac, ac, `${held}: the console says AC ${shown.ac}`);
  }
});

finish();
