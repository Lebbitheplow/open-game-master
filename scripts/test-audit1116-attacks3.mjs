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

await kit.endFight();
world.close();
finish();
