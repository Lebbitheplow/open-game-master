// What the monk and rogue clause suites share beyond the martial table
// (scripts/lib/sweep-clauses-martial.mjs): the card a thrown d20 waits on,
// as a player meets it (the after-roll route), for the subclass choices made
// after the roll (src/lib/dm/mt-mr-offers-logic.ts).
import assert from "node:assert/strict";
import { call } from "./enforce-campaign.mjs";

export async function afterRollKit(world) {
  const { getPendingRoll, listOpenPendingRolls } = await import("../../src/lib/db/dm-turns.ts");
  const { getRoll } = await import("../../src/lib/db/rolls.ts");
  const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
  const open = () => listOpenPendingRolls(world.campaignId);
  // The ids of what the waiting roll offers; none when no roll waits.
  const offered = () => (open()[0]?.thrown?.options ?? []).map((option) => option.id);
  // The roller's own press on the card, the dice it throws forced.
  async function choose(who, use, ...faces) {
    const [pending] = open();
    assert.ok(pending, "no roll is waiting on a choice");
    world.signIn({ id: world.sheet(who.id).userId });
    world.clearDice();
    world.dice(...faces);
    const out = await call(route, "POST", use === "keep" ? { keep: true } : { use }, { campaignId: world.campaignId, pendingRollId: pending.id });
    world.clearDice();
    assert.equal(out.status, 200, JSON.stringify(out.json));
    const landed = getPendingRoll(pending.id);
    return { pending: landed, roll: landed.rollId ? getRoll(landed.rollId) : null, note: landed.combatNote ?? "" };
  }
  // Lets every waiting roll stand, so the next probe starts with none.
  async function keepAll(who) {
    for (let guard = 0; guard < 6 && open().length; guard += 1) await choose(who, "keep");
  }
  return { open, offered, choose, keepAll };
}
