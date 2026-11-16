// The attacks audit of 2026-11-16, second follow-up (G22 onward): the
// leftovers of G13, G17, G18, G20 and G21. Each test failed before its fix.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-audit1116-attacks3");

const LEVEL = 5;
const PB = proficiencyBonus(LEVEL);
const world = await openWorld();
const kit = await gearKit(world);
const anchor = world.addHero({ class: "fighter", level: LEVEL });
const hero = world.addHero({ class: "fighter", level: LEVEL });

const { getDatabase } = await import("../src/lib/db/core.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const maps = await import("../src/lib/db/battle-maps.ts");
const campaignsDb = await import("../src/lib/db/campaigns.ts");

// A new fight against a fresh dummy, so no test inherits what the last one
// left on it.
async function freshArena() {
  await kit.endFight();
  await kit.arena({ first: anchor.id });
  kit.stand(hero.id, 1);
  return kit.dummy();
}

function arm({ str = 10, dex = 10, wis = 10, weapons = ["simple", "martial"], armor = [], skills = [], equipment = [], race = "human", ...rest }) {
  return world.patch(hero.id, {
    race,
    abilities: { str, dex, con: 10, int: 10, wis, cha: 10 },
    proficiencies: { ...profs({ weapons, armor }), skills },
    equipment,
    ...rest,
  });
}

// The dummy's block, with what a test adds to it.
function dress(patch) {
  const row = kit.dummy();
  getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify({ ...row.stats, ...patch }), row.id);
}

const place = (refId, x, y) => {
  const map = kit.board();
  maps.placeToken(maps.getTokenByRef(map.id, refId).id, x, y);
};
const line = (name) => world.sheet(hero.id).equipment.find((item) => item.name === name);
const tracking = (on) => campaignsDb.updateGameSettings(world.campaignId, { variantRules: { ...world.campaign().gameSettings.variantRules, ammunition: on } });

// ---- G22: magic ammunition that hits is no longer magical ----

await test("G22: of the +1 arrows spent in a fight, the half recovered comes back magical only for the ones that missed; the ones that hit come back as ordinary arrows", async () => {
  // SRD 5.1, Ammunition, +1, +2, or +3: "Once it hits a target, the
  // ammunition is no longer magical." Every recovered piece came back as the
  // +1 line, the ones that hit too.
  await freshArena();
  tracking(true);
  arm({ str: 10, dex: 16, equipment: [{ name: "Longbow", qty: 1 }, { name: "Arrows", qty: 10 }, { name: "+1 Arrows", qty: 6 }] });
  kit.stand(hero.id, 4);
  // Two hits (15 and the d8 of 4) and two misses (2 + 3 + 3 + 1 under AC 10).
  for (const faces of [[15, 4], [15, 4], [2], [2]]) {
    kit.freshTurn();
    const shot = await kit.swing(hero.id, { weapon: "Longbow", ammo: "+1 Arrows" }, ...faces);
    assert.equal(shot.ok, true, shot.error);
  }
  assert.equal(line("+1 Arrows")?.qty, 2);
  await kit.endFight();
  // Four spent, two recovered: one of the two misses as a +1 arrow, and one
  // as an ordinary arrow for the two that hit.
  assert.equal(line("+1 Arrows")?.qty, 3, `the arrows that hit came back magical: ${JSON.stringify(world.sheet(hero.id).equipment)}`);
  assert.equal(line("Arrows")?.qty, 11, "the arrow that hit came back as nothing");
  // Spent out, with no ordinary line carried: the plain ones come back as a
  // line of their own.
  await freshArena();
  arm({ str: 10, dex: 16, equipment: [{ name: "Longbow", qty: 1 }, { name: "+1 Arrows", qty: 2 }] });
  kit.stand(hero.id, 4);
  for (const faces of [[15, 4], [15, 4]]) {
    kit.freshTurn();
    const shot = await kit.swing(hero.id, { weapon: "Longbow", ammo: "+1 Arrows" }, ...faces);
    assert.equal(shot.ok, true, shot.error);
  }
  await kit.endFight();
  assert.equal(line("+1 Arrows"), undefined, "an arrow that hit came back magical");
  assert.equal(line("Arrows")?.qty, 1);
  tracking(false);
});

// ---- G23: Sword of Wounding's hit points and the Medicine action ----

const SAVES_ZERO = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
const REGENERATION = "Regeneration: The creature regains 10 hit points at the start of its turn.";
const swordWound = () => kit.dummy().conditions.find((entry) => /sword wound/i.test(entry));
const { refillLegendaryForTurn } = await import("../src/lib/dm/legendary-tools.ts");
const { turnStartEffects } = await import("../src/lib/dm/turn-start-effects.ts");

function regenerate() {
  const encounter = world.encounter();
  refillLegendaryForTurn(encounter, kit.dummy());
  encounters.saveEncounter(encounter);
  return kit.dummy().currentHp;
}

function creatureTurnStart(...faces) {
  world.clearDice();
  world.dice(...faces);
  const enemy = kit.dummy();
  turnStartEffects(world.campaign(), world.encounter(), [enemy.id], new Map([[enemy.id, enemy]]), []);
  world.clearDice();
}

await test("G23: hit points lost to a Sword of Wounding, its hit and its bleeding both, are not regained by regeneration; other damage still is", async () => {
  // SRD 5.1, Sword of Wounding: "Hit points lost to this weapon's damage can
  // be regained only through a short or long rest, rather than by
  // regeneration, magic, or any other means." A troll the blade cut
  // regenerated it all back at its next turn.
  await freshArena();
  dress({ saveMods: SAVES_ZERO, traits: [REGENERATION] });
  arm({ str: 16, equipment: [{ name: "Sword of Wounding", qty: 1, attuned: true }] });
  kit.stand(hero.id, 1);
  const full = kit.dummy().maxHp;
  // The longsword's d8 of 4 + 3: 7 slashing, and a wound.
  const swing = await kit.swing(hero.id, { weapon: "Sword of Wounding" }, 15, 4);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(kit.dummy().currentHp, full - 7);
  assert.equal(regenerate(), full - 7, "the creature regenerated what the blade took");
  // Its turn: the wound bleeds 3 necrotic, then a save of 18 closes it. The
  // 3 are the blade's too.
  creatureTurnStart(3, 18);
  assert.equal(swordWound(), undefined, "the made save left the wound open");
  assert.equal(regenerate(), full - 10, "the creature regenerated what the wound bled");
  // Damage from anything else comes back as before.
  const other = await world.invoke("damage_enemy", { enemyId: kit.dummy().id, amount: 5, type: "bludgeoning" });
  assert.equal(other.ok, true, other.error);
  assert.equal(kit.dummy().currentHp, full - 15);
  assert.equal(regenerate(), full - 10, "the club's 5 were not regenerated");
});

await test("G23: a hero within 5 feet closes a creature's sword wounds with an action and a DC 15 Wisdom (Medicine) check (take_action improvise, skill medicine)", async () => {
  // SRD 5.1, Sword of Wounding: "you or any creature within 5 feet of the
  // wounded target can use an action to make a DC 15 Wisdom (Medicine)
  // check, ending the effect of such wounds on it on a success." There was
  // no door for it: the improvised Medicine check rolled a contest and
  // closed nothing.
  await freshArena();
  dress({ saveMods: SAVES_ZERO, traits: [] });
  arm({ str: 16, wis: 14, skills: ["medicine"], equipment: [{ name: "Sword of Wounding", qty: 1, attuned: true }] });
  kit.stand(hero.id, 1);
  const swing = await kit.swing(hero.id, { weapon: "Sword of Wounding" }, 15, 4);
  assert.equal(swing.ok, true, swing.error);
  assert.ok(swordWound(), "the hit left no wound");
  const tend = (...faces) =>
    kit.onTurnOf(hero.id, async () => {
      kit.freshTurn();
      world.clearDice();
      world.dice(...faces);
      const out = await world.invoke("take_action", { characterId: hero.id, action: "improvise", skill: "medicine", targetEnemyId: kit.dummy().id, reason: "presses the wound closed" });
      world.clearDice();
      return out;
    });
  // Out of reach: refused, nothing spent.
  kit.stand(hero.id, 3);
  const far = await tend(20);
  assert.equal(far.ok, false, `a wound was tended from 15 feet: ${JSON.stringify(far.result)}`);
  assert.ok(swordWound());
  kit.stand(hero.id, 1);
  // 2 + 2 + 3 = 7: the wound stays.
  const failed = await tend(2);
  assert.equal(failed.ok, true, failed.error);
  assert.ok(swordWound(), "a failed Medicine check closed the wound");
  // 12 + 2 + 3 = 17: closed.
  const made = await tend(12);
  assert.equal(made.ok, true, made.error);
  assert.equal(swordWound(), undefined, `a made DC 15 Medicine check left the wound open: ${JSON.stringify(made.result)}`);
});

// ---- G24: the Oathbow's oath on the clock ----

const clockDb = await import("../src/lib/db/clock.ts");
const DAY = 24 * 60;
const swornOn = () => {
  const sheet = world.sheet(hero.id);
  const name = sheet.conditions.find((entry) => /sworn enemy/i.test(entry));
  return name ? sheet.conditionMeta[name]?.source : undefined;
};
const OATH_KIT = [{ name: "Oathbow", qty: 1, attuned: true }, { name: "Arrows", qty: 20 }, { name: "Dagger", qty: 1 }];

// A new fight, the hero `tiles` from its goblin; the last one's end is not
// a death.
async function nextFight(tiles) {
  await kit.arena({ first: anchor.id });
  kit.stand(hero.id, tiles);
  return kit.dummy();
}

// The dagger's d20s, for the disadvantage with another weapon.
async function stab() {
  kit.freshTurn();
  kit.stand(hero.id, 1);
  const out = await kit.swing(hero.id, { weapon: "Dagger" }, 15, 2, 3);
  assert.equal(out.ok, true, out.error);
  return out.d20s.length;
}

await test("G24: the Oathbow's oath outlives the fight and a long rest: another creature is not sworn and other weapons keep their disadvantage, until the dawn seven days later", async () => {
  // SRD 5.1, Oathbow: "The target of your attack becomes your sworn enemy
  // until it dies or until dawn seven days later. You can have only one such
  // sworn enemy at a time." The oath ended with the fight it was sworn in:
  // a goblin that fled was forgotten, and the next creature shot was sworn.
  await kit.endFight();
  world.patch(hero.id, { conditions: [], conditionMeta: {} });
  const first = await nextFight(4);
  arm({ str: 10, dex: 16, equipment: OATH_KIT });
  kit.stand(hero.id, 4);
  const swornAt = clockDb.getClock(world.campaignId).instant;
  const shot = await kit.swing(hero.id, { weapon: "Oathbow" }, 2, 15, 4, 3, 3, 3);
  assert.equal(shot.ok, true, shot.error);
  assert.equal(swornOn(), first.id);
  // It flees: the fight ends with it alive.
  const fled = await world.invoke("end_encounter", { outcome: "enemies_fled" });
  assert.equal(fled.ok, true, fled.error);
  const rest = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rest.ok, true, rest.error);
  // Another fight, another goblin: the oath still binds.
  await nextFight(4);
  const other = await kit.swing(hero.id, { weapon: "Oathbow" }, 15, 4);
  assert.equal(other.ok, true, other.error);
  assert.equal(other.d20s.length, 1, `a second creature was sworn while the first lives: ${JSON.stringify(other.result)}`);
  assert.equal(swornOn(), first.id, "the oath moved to another creature");
  assert.equal(await stab(), 2, "the dagger lost its disadvantage while the sworn enemy lives");
  await kit.endFight();
  // Six days on, it still binds.
  clockDb.setClockInstant(world.campaignId, swornAt + 6 * DAY);
  await nextFight(1);
  assert.equal(await stab(), 2, "the oath ended before seven days");
  await kit.endFight();
  // Past the dawn seven days later, it is over: no disadvantage, and the bow
  // swears the creature it is shot at.
  clockDb.setClockInstant(world.campaignId, swornAt + 8 * DAY);
  const third = await nextFight(1);
  assert.equal(await stab(), 1, "the oath outlived the dawn seven days later");
  kit.freshTurn();
  kit.stand(hero.id, 4);
  const fresh = await kit.swing(hero.id, { weapon: "Oathbow" }, 2, 15, 4, 3, 3, 3);
  assert.equal(fresh.ok, true, fresh.error);
  assert.equal(fresh.d20s.length, 2, "the bow could not swear anew once the oath had run out");
  assert.equal(swornOn(), third.id);
  await kit.endFight();
  world.patch(hero.id, { conditions: [], conditionMeta: {} });
});

await test("G24: once the sworn enemy dies, the Oathbow swears no new one before the next dawn", async () => {
  // SRD 5.1, Oathbow: "When your sworn enemy dies, you can choose a new one
  // after the next dawn." The next creature shot was sworn at once.
  await kit.endFight();
  world.patch(hero.id, { conditions: [], conditionMeta: {} });
  // Mid-morning, so the next dawn is a day off.
  const today = Math.floor(clockDb.getClock(world.campaignId).instant / DAY) * DAY;
  clockDb.setClockInstant(world.campaignId, today + 10 * 60);
  const first = await nextFight(4);
  arm({ str: 10, dex: 16, equipment: OATH_KIT });
  kit.stand(hero.id, 4);
  getDatabase().prepare("UPDATE encounter_enemies SET current_hp = 5 WHERE id = ?").run(first.id);
  const kill = await kit.swing(hero.id, { weapon: "Oathbow" }, 2, 15, 4, 3, 3, 3);
  assert.equal(kill.ok, true, kill.error);
  assert.equal(encounters.getEnemy(first.id).status, "dead");
  await kit.endFight();
  // That evening, a new foe: the bow swears nothing, and the dagger is free.
  clockDb.setClockInstant(world.campaignId, today + 20 * 60);
  await nextFight(4);
  const early = await kit.swing(hero.id, { weapon: "Oathbow" }, 15, 4);
  assert.equal(early.ok, true, early.error);
  assert.equal(early.d20s.length, 1, `a new sworn enemy before the next dawn: ${JSON.stringify(early.result)}`);
  assert.notEqual(swornOn(), kit.dummy().id);
  assert.equal(await stab(), 1, "the dagger kept its disadvantage after the sworn enemy died");
  await kit.endFight();
  // After the dawn: the bow swears again.
  clockDb.setClockInstant(world.campaignId, today + DAY + 7 * 60);
  const next = await nextFight(4);
  const sworn = await kit.swing(hero.id, { weapon: "Oathbow" }, 2, 15, 4, 3, 3, 3);
  assert.equal(sworn.ok, true, sworn.error);
  assert.equal(sworn.d20s.length, 2);
  assert.equal(swornOn(), next.id);
  await kit.endFight();
  world.patch(hero.id, { conditions: [], conditionMeta: {} });
});

// ---- G25: a lance on foot on an opportunity attack ----

const { resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const { setMount } = await import("../src/lib/db/mounts.ts");

// A goblin beside the hero walks away east; whatever the hero swings lands
// on it. The ally stays far off with a bow.
async function walkAway(faces) {
  const goblin = await freshArena();
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }] });
  place(anchor.id, 9, 9);
  place(goblin.id, 3, 0);
  place(hero.id, 2, 0);
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const notes = resolvePcOpportunityAttacks(world.campaign(), goblin.id, { x: 3, y: 0 }, { x: 5, y: 0 }, [{ x: 4, y: 0 }, { x: 5, y: 0 }]);
  const log = world.diceLog();
  world.clearDice();
  return { notes, damageDice: log.filter((die) => die.sides !== 20).map((die) => die.sides) };
}

await test("G25: a hero on foot never swings a lance on an opportunity attack beside a shield or with a weapon in the other hand; mounted, the lance swings", async () => {
  // SRD 5.1, Lance: "a lance requires two hands to wield when you aren't
  // mounted." pc_attack refuses a lance on foot beside a shield
  // (attack-rules.ts handsRuling); the reaction's swing took it anyway.
  await freshArena();
  arm({ str: 16, armor: ["shields"], equipment: [{ name: "Lance", qty: 1 }, { name: "Shield", qty: 1 }] });
  const turn = await kit.swing(hero.id, { weapon: "Lance" }, 15, 3, 3);
  assert.equal(turn.ok, false, "the turn's swing took the lance on foot beside a shield");
  let out = await walkAway([15, 15, 6]);
  assert.deepEqual(out.damageDice, [], `the lance swung on foot beside a shield: ${JSON.stringify(out.notes)}`);
  // A longsword in the other hand: the longsword swings, one-handed.
  arm({ str: 16, equipment: [{ name: "Lance", qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }] });
  out = await walkAway([15, 15, 6]);
  assert.deepEqual(out.damageDice, [8], `the lance swung on foot with a longsword in the other hand: ${JSON.stringify(out.notes)}`);
  // Mounted, the lance needs one hand, beside a shield too.
  arm({ str: 16, armor: ["shields"], equipment: [{ name: "Lance", qty: 1 }, { name: "Shield", qty: 1 }] });
  setMount(world.campaignId, hero.id, { ref: "warhorse", name: "Warhorse", speed: 60, controlled: true, size: "Large" });
  try {
    out = await walkAway([15, 15, 6]);
    assert.deepEqual(out.damageDice, [12], `a mounted lance was not swung: ${JSON.stringify(out.notes)}`);
  } finally {
    setMount(world.campaignId, hero.id, null);
  }
});

// ---- G26: damage totals of 0 or less deal 0 ----

await test("G26: damage dice sent to apply_damage or damage_enemy that total 0 or less deal 0, not 1", async () => {
  // SRD 5.1 gives damage no floor: a penalty can leave nothing, as pc_attack,
  // every attack door and the GM's targeted damage roll (G13) leave 0. The
  // damage tools' dice floored the total at 1 (ai-gate.ts).
  const dummy = await freshArena();
  world.patch(hero.id, { currentHp: 20 });
  world.clearDice();
  world.dice(1);
  const onHero = await world.invoke("apply_damage", { characterId: hero.id, dice: "1d4-2", type: "bludgeoning", reason: "a weak cut" });
  world.clearDice();
  assert.equal(onHero.ok, true, onHero.error);
  assert.equal(world.sheet(hero.id).currentHp, 20, `a total under 1 took a hit point: ${JSON.stringify(onHero.result)}`);
  world.dice(1);
  const onFoe = await world.invoke("damage_enemy", { enemyId: dummy.id, dice: "1d4-2", type: "bludgeoning", reason: "a weak cut" });
  world.clearDice();
  assert.equal(onFoe.ok, true, onFoe.error);
  assert.equal(kit.dummy().currentHp, dummy.currentHp, `a total under 1 took a hit point: ${JSON.stringify(onFoe.result)}`);
});

await test("G26: an area's damage that totals 0 or less deals 0, not 1", async () => {
  // The same for aoe_damage's total (aoe-damage.ts), floored at 1.
  const dummy = await freshArena();
  dress({ saveMods: SAVES_ZERO, traits: [] });
  world.clearDice();
  // The d4 of 1, then the dummy's failed save.
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { enemyIds: [dummy.id], damage: "1d4-2", type: "fire", saveAbility: "dex", dc: 20, reason: "a sputtering flame" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.dummy().currentHp, dummy.currentHp, `a total under 1 took a hit point: ${JSON.stringify(out.result)}`);
});

await kit.endFight();
world.close();
finish();
