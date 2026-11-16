// GM rules audit 2026-11-16, conditions lens (D01 and on): the SRD 5.1
// conditions with all their effects, ended at the right time on every door,
// and dropping to 0 hit points. Each test failed on main before its fix.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { kit as conditionsKit, FIGHTER as SWORD_FIGHTER } from "./lib/enforce-conditions.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-conditions");
const encounters = await import("../src/lib/db/encounters.ts");
void openWorld;

const prone = (conditions) => conditions.some((entry) => entry.trim().toLowerCase() === "prone");

// D01. SRD 5.1, Unconscious: "The creature drops whatever it's holding and
// falls prone." Only the drop to 0 hit points wrote the prone; Sleep, a
// drow's poison or Eyebite wrote the unconscious alone, so a goblin woken by
// a blow stood at once (no half its speed to get up, no advantage for the
// next sword, no disadvantage on its own swing) and a hero shaken awake walked
// off at full speed.
await test("D01: a creature put to sleep falls prone, and stays prone when it wakes", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Sleep"], [], 5)]);
  encounters.patchEnemyHp(foe.id, 6, "alive");
  world.dice(8, 8, 8, 8, 8);
  const cast = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Sleep", level: 1 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(enemyOf(world, foe.id).conditions.includes("unconscious"), JSON.stringify(cast.result));
  assert.ok(prone(enemyOf(world, foe.id).conditions), `the sleeper is not prone: ${enemyOf(world, foe.id).conditions}`);
  const hit = await world.invoke("damage_enemy", { enemyId: foe.id, amount: 1 });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(enemyOf(world, foe.id).conditions.includes("unconscious"), false);
  assert.ok(prone(enemyOf(world, foe.id).conditions), "the woken creature stood up for free");
});

await test("D01: the same through set_condition, on a creature and on a hero", async () => {
  const { world, sheets: [hero], enemies: [foe] } = await table([FIGHTER]);
  const laid = await world.invoke("set_condition", { enemyId: foe.id, condition: "unconscious", reason: "a sleeping draught", rounds: 10 });
  assert.equal(laid.ok, true, laid.error);
  assert.ok(prone(enemyOf(world, foe.id).conditions), `the sleeper is not prone: ${enemyOf(world, foe.id).conditions}`);
  const dart = await world.invoke("set_condition", { characterId: hero.id, condition: "unconscious", reason: "a drow's dart", rounds: 100 });
  assert.equal(dart.ok, true, dart.error);
  assert.ok(prone(world.sheet(hero.id).conditions), `the sleeping hero is not prone: ${world.sheet(hero.id).conditions}`);
  const woken = await world.invoke("clear_condition", { characterId: hero.id, condition: "unconscious", reason: "shaken awake" });
  assert.equal(woken.ok, true, woken.error);
  assert.ok(prone(world.sheet(hero.id).conditions), "the hero shaken awake is on their feet already");
});

// One fight off the board for the rules that read conditions alone.
const arena = await openWorld();
const arenaKit = conditionsKit(arena);
const swordsman = arena.addHero(SWORD_FIGHTER);
await arena.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [swordsman.id]: 20 } });
arenaKit.offBoard();
const [goblin] = arena.enemies();

// D02. SRD 5.1, Dodge: "You lose this benefit if you are incapacitated or if
// your speed drops to 0." The enemies' swings and the opportunity attacks
// dropped a Dodge at speed 0 (opportunity.ts withLiveDodge); a hero's own
// swing and the Dexterity save did not, so a goblin that took the Dodge and
// was then grappled still turned the fighter's sword at disadvantage and
// still saved against Burning Hands with advantage.
await test("D02: a dodger held at speed 0 gets nothing from the Dodge on a hero's swing", async () => {
  arenaKit.reset(swordsman.id);
  arenaKit.resetEnemy(goblin.id, ["dodging", "grappled"], { grappled: { source: swordsman.id } });
  const out = await arenaKit.swing([3, 17, 4, 4, 4], swordsman.id, goblin.id, { weapon: "Longsword" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(arenaKit.d20s(out.dice), 1, `the grappled dodger still turned the sword: ${out.dice.join(" ")}`);
});

await test("D02: ... nor on its Dexterity save", async () => {
  arenaKit.resetEnemy(goblin.id, ["dodging", "restrained"]);
  const out = await arenaKit.withDice([10, 10, 1], "aoe_damage", {
    damage: "1d4", saveAbility: "dex", dc: 25, halfOnSave: false, enemyIds: [goblin.id],
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  // Restrained alone: disadvantage. With the Dodge still counted the two
  // cancelled to one die.
  assert.equal(arenaKit.d20s(out.dice), 2, `the held dodger's DEX save rolled ${out.dice.join(" ")}`);
  arenaKit.resetEnemy(goblin.id);
});

// A board: one dummy (AC 13, 40 hp) and Kara with a longsword.
const field = await openWorld();
const board = await combatKit(field);
const kara = field.addHero({
  name: "Kara", class: "fighter", level: 5, maxHp: 80, proficiencies: TRAINED,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
async function stage(patch = {}) {
  await board.endFight();
  await board.fight(2, { heroFaces: { [kara.id]: 20 } });
  const [foe] = field.enemies();
  board.setEnemy(foe.id, { stats: { ...DUMMY }, maxHp: 40, ...patch });
  board.place(kara.id, 6, 7);
  board.place(foe.id, 5, 7);
  return board.enemy(foe.id);
}
const moveRoute = await field.route("campaigns/[campaignId]/battle-map/move");
const reactedBy = (id) => field.encounter().reactionsUsed.some((key) => key.includes(id));

// D03. SRD 5.1, Charmed: "A charmed creature can't attack the charmer or
// target the charmer with harmful abilities or magical effects." Every
// attack door refused it (pc_attack, enemy_attack, a spell, an area) but an
// opportunity attack, which is an attack too: a hero under a creature's charm
// swung at it as it walked off, and a bandit the bard had charmed struck the
// bard as the bard stepped away.
await test("D03: a hero charmed by a creature makes no opportunity attack at it", async () => {
  const foe = await stage();
  field.patch(kara.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: foe.id } } });
  board.enemyTurn(foe.id);
  board.dice(15, 4);
  const out = await field.invoke("enemy_flees", { enemyId: foe.id, reason: "it slips away" });
  field.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.opportunityAttacks, undefined, JSON.stringify(out.result));
  assert.equal(reactedBy(kara.id), false, "the charmed hero spent a reaction on the charmer");
  field.patch(kara.id, { conditions: [], conditionMeta: {} });
});

await test("D03: a creature charmed by a hero makes no opportunity attack at them", async () => {
  const foe = await stage({ conditions: ["charmed"], conditionMeta: { charmed: { source: kara.id } } });
  board.giveTurn(kara.id);
  board.dice(15, 4);
  // The player's own walk (the board's move route).
  field.signIn(field.owner);
  const response = await moveRoute.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 9, y: 7 }) }),
    { params: Promise.resolve({ campaignId: field.campaignId }) },
  );
  field.clearDice();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(reactedBy(foe.id), false, `the charmed creature struck its charmer: ${await response.text()}`);
});

await test("D03: a second charmer binds the hero as the first does", async () => {
  const foe = await stage();
  // Charmed first by someone else, then by this creature: two instances of
  // one condition (condition-logic.ts addConditionInstance).
  field.patch(kara.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: "someone-else", others: [{ source: foe.id }] } } });
  board.giveTurn(kara.id);
  const out = await board.attack(kara.id, foe.id, { weapon: "Longsword" });
  assert.equal(out.ok, false, "the hero attacked their second charmer");
  field.patch(kara.id, { conditions: [], conditionMeta: {} });
});

// D04. SRD 5.1: a paralyzed creature is incapacitated, and "a creature's
// concentration ends if it is incapacitated"; "the condition [grappled]
// ends if the grappler is incapacitated". Every lay path ran that follow-up
// but one creature's hit on another creature's row (enemy-hit-rows.ts): a
// dominated ghoul's claws paralyzed a goblin that kept its spell and kept
// holding the hero.
const GHOUL = {
  ...DUMMY,
  attacks: [{ name: "Claws", toHit: 4, damage: "2d4+2", type: "slashing", mode: "melee", onHit: { save: "con", dc: 10, condition: "paralyzed" } }],
};
await test("D04: a creature paralyzed by another creature's hit loses its concentration and lets go", async () => {
  await board.endFight();
  await board.fight(3, { heroFaces: { [kara.id]: 20 } });
  const [ghoul, goblin] = field.enemies();
  board.setEnemy(ghoul.id, { stats: GHOUL, maxHp: 200, currentHp: 200 });
  board.setEnemy(goblin.id, { stats: { ...DUMMY }, maxHp: 200, currentHp: 200 });
  encounters.patchEnemyConditions(ghoul.id, ["charmed"], { charmed: { spell: "Dominate Person", source: kara.id } });
  board.place(kara.id, 12, 2);
  board.place(ghoul.id, 10, 2);
  board.place(goblin.id, 11, 2);
  encounters.setEnemyConcentration(goblin.id, "Bless", 10);
  field.patch(kara.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: goblin.id } } });
  // The claws' d20, their 2d4, the concentration save the damage asks
  // (held), then the rider's CON save of 1.
  field.dice(15, 2, 2, 20, 1);
  const claws = await field.invoke("enemy_attack", { enemyId: ghoul.id, targetCharacterId: goblin.id });
  field.clearDice();
  assert.equal(claws.ok, true, claws.error);
  assert.ok(board.enemy(goblin.id).conditions.includes("paralyzed"), JSON.stringify(claws.result));
  assert.equal(board.enemy(goblin.id).concentration, null, "the paralyzed goblin kept its concentration");
  assert.equal(field.sheet(kara.id).conditions.includes("grappled"), false, "the paralyzed goblin still holds the hero");
});

// D05. SRD 5.1, Exhaustion: each failed save is a level, and "6: Death".
// The hourly Constitution saves (a forced march, extreme cold or heat,
// frigid water) read the new level from set_condition's answer, which never
// said it, so the GM was told only "failed" and never the level, and a hero
// the cold took to level 6 was listed as one more level of exhaustion.
await test("D05: each failed hour in the cold reports the level it reached, and a death at level 6", async () => {
  const camp = await openWorld();
  const walker = camp.addHero({ name: "Ilse", abilities: { con: 10 } });
  camp.dice(1);
  const first = await camp.invoke("apply_hazard", { type: "extreme_cold", hours: 1, characterIds: [walker.id] });
  camp.clearDice();
  assert.equal(first.ok, true, first.error);
  const [hour] = first.result.results[0].saves;
  assert.equal(hour.failed, true, JSON.stringify(first.result));
  assert.equal(camp.sheet(walker.id).exhaustion, 1);
  assert.equal(hour.exhaustion, 1, `the failed hour did not say the level: ${JSON.stringify(hour)}`);
  camp.patch(walker.id, { exhaustion: 5 });
  camp.dice(1);
  const last = await camp.invoke("apply_hazard", { type: "extreme_cold", hours: 1, characterIds: [walker.id] });
  camp.clearDice();
  assert.equal(camp.sheet(walker.id).deathSaves?.dead, true);
  const [fatal] = last.result.results[0].saves;
  assert.equal(fatal.exhaustion, 6, JSON.stringify(last.result));
  assert.equal(fatal.dead, true, "the hour that killed them did not say so");
  assert.match(String(last.result.note), /Ilse dies? of exhaustion/, String(last.result.note));
});

// D06. SRD 5.1: "If multiple effects impose the same condition on a
// creature, each instance of the condition has its own duration", and a
// grapple ends on its own grappler's terms ("You can use your action to
// escape a grapple"; it "ends if the grappler is incapacitated"). The grapple
// code read one grappler: the second crab's grip rewrote the first's (its
// source and escape DC), and the second crab falling, or one escape, freed
// the hero from both.
const CRAB = {
  ...DUMMY,
  attacks: [{ name: "Claw", toHit: 3, damage: "1d6+1", type: "bludgeoning", mode: "melee", onHit: { condition: "grappled", escapeDc: 11 } }],
};
const grapplers = (sheet) => {
  const entry = sheet.conditionMeta?.grappled;
  return sheet.conditions.includes("grappled") && entry ? [entry, ...(entry.others ?? [])].map((instance) => instance.source) : [];
};
async function twoCrabs() {
  await board.endFight();
  await board.fight(3, { heroFaces: { [kara.id]: 20 } });
  const [crabA, crabB] = field.enemies();
  for (const crab of [crabA, crabB]) {
    board.setEnemy(crab.id, { stats: CRAB, maxHp: 20, currentHp: 20 });
  }
  board.place(kara.id, 6, 7);
  board.place(crabA.id, 5, 7);
  board.place(crabB.id, 7, 7);
  for (const crab of [crabA, crabB]) {
    board.freshRound();
    field.dice(15, 2);
    const claw = await field.invoke("enemy_attack", { enemyId: crab.id, targetCharacterId: kara.id });
    field.clearDice();
    assert.equal(claw.ok, true, claw.error);
  }
  return [crabA, crabB];
}

await test("D06: a second creature's grapple joins the first, and the second falling leaves the first holding", async () => {
  const [crabA, crabB] = await twoCrabs();
  assert.deepEqual(grapplers(field.sheet(kara.id)).sort(), [crabA.id, crabB.id].sort(), `the grapples: ${JSON.stringify(field.sheet(kara.id).conditionMeta.grappled)}`);
  const slain = await field.invoke("damage_enemy", { enemyId: crabB.id, amount: 50 });
  assert.equal(slain.ok, true, slain.error);
  assert.deepEqual(grapplers(field.sheet(kara.id)), [crabA.id], "the first crab let go when the second died");
});

await test("D06: one escape breaks one grapple", async () => {
  const [crabA, crabB] = await twoCrabs();
  board.giveTurn(kara.id);
  field.dice(20);
  const out = await field.invoke("take_action", { characterId: kara.id, action: "escape" });
  field.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true, JSON.stringify(out.result));
  assert.equal(grapplers(field.sheet(kara.id)).length, 1, `one escape broke ${2 - grapplers(field.sheet(kara.id)).length} grapples`);
  void crabA;
  void crabB;
});

// D07. SRD 5.1, Grappled: "The condition also ends if an effect removes the
// grappled creature from the reach of the grappler or grappling effect,
// such as when a creature is hurled away by the thunderwave spell." Every
// walk asked releaseGrapplesOutOfReach, but no push or pull did (a shove,
// Thunderwave and Repelling Blast's riders, a monk's push): the hero shoved
// the goblin holding them 5 feet back and stayed grappled at speed 0.
await test("D07: shoving the grappler out of reach ends its grapple", async () => {
  await board.endFight();
  await board.fight(1, { heroFaces: { [kara.id]: 20 } });
  const [goblin] = field.enemies();
  board.setEnemy(goblin.id, { stats: { ...DUMMY }, maxHp: 40, currentHp: 40 });
  board.place(kara.id, 6, 7);
  board.place(goblin.id, 5, 7);
  field.patch(kara.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: goblin.id } } });
  board.giveTurn(kara.id);
  // Kara's Athletics, then the goblin's.
  field.dice(20, 1);
  const shove = await field.invoke("take_action", { characterId: kara.id, action: "shove", targetEnemyId: goblin.id, shove: "push" });
  field.clearDice();
  assert.equal(shove.ok, true, shove.error);
  assert.equal(shove.result.success, true, JSON.stringify(shove.result));
  assert.deepEqual([board.token(goblin.id).x, board.token(goblin.id).y], [4, 7], JSON.stringify(shove.result));
  assert.equal(field.sheet(kara.id).conditions.includes("grappled"), false, "the goblin let go from 10 feet away");
});

// D08. SRD 5.1, Exhaustion: "2: Speed halved", "5: Speed reduced to 0". The
// board's walk counted it, but GAME STATE printed the sheet's whole speed
// (a berserker two frenzies in read "Speed 30" while the board gave 15), the
// AI's and the Hand's Dash at level 5 spent the action on a run of 0 feet,
// and time passing stood a prone hero at level 5 up, who has no movement to
// stand with.
await test("D08: GAME STATE gives the speed exhaustion leaves", async () => {
  const { describeSheet } = await import("../src/lib/dm/prompt.ts");
  const tired = field.addHero({ name: "Tamsin", class: "barbarian", level: 3, maxHp: 30, speed: 30 });
  field.patch(tired.id, { exhaustion: 2 });
  assert.match(describeSheet(field.sheet(tired.id), "a player", false), /\| Speed 15 \|/);
  field.patch(tired.id, { exhaustion: 5 });
  assert.match(describeSheet(field.sheet(tired.id), "a player", false), /\| Speed 0 \|/);
});

await test("D08: a Dash at exhaustion 5 is refused and spends nothing", async () => {
  await board.endFight();
  await board.fight(1, { heroFaces: { [kara.id]: 20 } });
  board.giveTurn(kara.id);
  field.patch(kara.id, { exhaustion: 5 });
  const dash = await field.invoke("take_action", { characterId: kara.id, action: "dash" });
  field.patch(kara.id, { exhaustion: 0 });
  assert.equal(dash.ok, false, `the Dash was taken at speed 0: ${JSON.stringify(dash.result)}`);
  assert.equal(field.encounter().turnBudget?.actionUsed ?? false, false, "the action was spent");
});

await test("D08: time passing does not stand a hero up at exhaustion 5", async () => {
  await board.endFight();
  field.patch(kara.id, { exhaustion: 5, conditions: ["prone"], conditionMeta: {} });
  const waited = await field.invoke("pass_time", { amount: 10, unit: "minutes", reason: "waiting" });
  assert.equal(waited.ok, true, waited.error);
  const still = field.sheet(kara.id).conditions.includes("prone");
  field.patch(kara.id, { exhaustion: 0, conditions: [], conditionMeta: {} });
  assert.equal(still, true, "a hero at speed 0 stood up as the minutes passed");
});

closeTables();
finish();
