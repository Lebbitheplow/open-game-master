// A teleport goes on record with the square it left (last-save.ts
// recordTeleport), so what answers one (Magic-User's Nemesis puts the
// creature back) finds it. move_token's teleport and a feature's move wrote
// it; Distant Strike, Benign Transposition and Shadow Walk placed the token
// themselves and wrote nothing. Every one now goes through
// teleport-place.ts placeTeleported.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-teleport-records");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { openTriggers } = await import("../src/lib/dm/last-save.ts");
const { distantStrikeTeleport } = await import("../src/lib/dm/distant-strike.ts");
const { planSwap } = await import("../src/lib/dm/ar-ws-transposition.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

const hero = (classId, subclass) => world.addHero({ user: world.owner, class: classId, subclass, level: 11, maxHp: 80, proficiencies: TRAINED, abilities: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 } });
const ranger = hero("ranger", "Horizon Walker");
const wizard = hero("wizard", "School of Conjuration");
const friend = hero("fighter", "Champion");
const teleports = () => openTriggers(world.campaignId).filter((record) => record.kind === "teleport");

await test("Distant Strike's teleport is on record with the square the ranger left.", async () => {
  await kit.endFight();
  await kit.fight(1);
  kit.place(ranger.id, 5, 5);
  const out = distantStrikeTeleport(world.campaignId, world.encounter().id, ranger.id, { x: 6, y: 6 });
  assert.match(out, /teleports/);
  const [record] = teleports().filter((entry) => entry.forcer.id === ranger.id);
  assert.ok(record, "no teleport on record");
  assert.deepEqual(record.square, { x: 5, y: 5 });
});

await test("Benign Transposition's swap puts both creatures' teleports on record.", async () => {
  await kit.endFight();
  await kit.fight(1);
  kit.place(wizard.id, 5, 5);
  kit.place(friend.id, 7, 5);
  const plan = planSwap(getCampaignById(world.campaignId), world.sheet(wizard.id), world.sheet(friend.id), "Benign Transposition", 30);
  assert.ok(plan.apply, plan.error);
  plan.apply();
  const squares = Object.fromEntries(teleports().map((entry) => [entry.forcer.id, entry.square]));
  assert.deepEqual([squares[wizard.id], squares[friend.id]], [{ x: 5, y: 5 }, { x: 7, y: 5 }]);
});

world.close();
finish();
