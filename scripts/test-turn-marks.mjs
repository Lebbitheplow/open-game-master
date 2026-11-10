// Once-a-turn marks the database keeps (src/lib/dm/turn-marks.ts, LC-RST-01):
// they were module-level Maps, so a restarted server forgot them. The same
// roll_treasure sent twice in one turn pays once, whether or not the server
// restarted between them, and pays again once the turn that paid is
// reverted; a fight's mark (Grim Harvest's, Keeper of Souls', the bite's)
// holds for its stamp, survives a fresh copy of the module, and goes with the
// turn's revert.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { restarted, revertTurn } from "./lib/sweep-lifecycle.mjs";
import { stage } from "./lib/sweep-lifecycle-stage.mjs";

const { test, finish } = suite("test-turn-marks");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const worldTools = await import("../src/lib/dm/world-tools.ts");
const marks = await import("../src/lib/dm/turn-marks.ts");

await test("the same roll_treasure twice in one turn pays once, across a restart too, and pays again after the turn's revert", async () => {
  const { world, hero } = await stage("calm");
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  const call = (module) =>
    runInTurnScope(turn.id, () => {
      const sheets = world.sheets();
      return module.handleRollTreasure(world.campaign(), turn, JSON.stringify({ cr: 2, characterIds: [hero.id], individual: true }), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
    });
  const gold = world.sheet(hero.id).gold;
  world.dice(50, 3, 3, 3, 3);
  const first = call(worldTools);
  world.clearDice();
  assert.ok(first.ok, first.error);
  const paid = world.sheet(hero.id).gold - gold;
  assert.ok(paid > 0, "the first call paid");
  const again = call(worldTools);
  assert.equal(again.repeat, true);
  const fresh = call(await restarted("lib/dm/world-tools.ts"));
  assert.equal(fresh.repeat, true, "a restarted server still knows the turn paid this hoard");
  assert.equal(world.sheet(hero.id).gold - gold, paid, "paid once");
  const out = await revertTurn(world, turn.id);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(world.sheet(hero.id).gold, gold, "the payout went back");
  assert.equal(marks.turnLedger(world.campaignId, turn.id, "anything"), null);
});

await test("a fight's mark holds for its stamp, survives a fresh module, and goes with the turn's revert", async () => {
  const { world, mage } = await stage("fight");
  const encounterId = world.encounter().id;
  const key = `grim harvest:${mage.id}`;
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => marks.markFight(encounterId, key, "e:1:a"));
  assert.equal(marks.fightMarked(encounterId, key, "e:1:a"), true);
  assert.equal(marks.fightMarked(encounterId, key, "e:1:b"), false, "another turn's stamp is not marked");
  const fresh = await restarted("lib/dm/turn-marks.ts");
  assert.equal(fresh.fightMarked(encounterId, key, "e:1:a"), true, "a restart remembers it");
  const out = await revertTurn(world, turn.id);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(marks.fightMarked(encounterId, key, "e:1:a"), false, "the revert took the mark back");
});

finish();
