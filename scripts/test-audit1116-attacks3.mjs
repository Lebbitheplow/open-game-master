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

await kit.endFight();
world.close();
finish();
