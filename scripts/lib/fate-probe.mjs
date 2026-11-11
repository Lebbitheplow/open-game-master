// Convergent Future and Bend Luck on another creature's roll, in the two
// windows the engine answers one before its outcome lands
// (src/lib/dm/fate-turn.ts): a friend's failed save waiting on its card, which
// the holder's player answers from their own screen, and a foe's save a call
// throws, answered by what the holder said at the watch stop before it.
// Import enforce-world.mjs first.
import assert from "node:assert/strict";
import { call as callRoute } from "./enforce-campaign.mjs";

export async function fateProbe(rig, { holder, friend, power, paid }) {
  const { world, kit } = rig;
  const { listOpenPendingRolls, getPendingRoll } = await import("../../src/lib/db/dm-turns.ts");
  const { getRoll } = await import("../../src/lib/db/rolls.ts");
  const { saveEncounter } = await import("../../src/lib/db/encounters.ts");
  const { subscribe } = await import("../../src/lib/events.ts");
  const { runWithShift } = await import("../../src/lib/dm/chronal-shift.ts");
  const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
  const [enemy] = await rig.stage(holder, { others: [friend], first: friend });
  const fresh = () => saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  // The friend's Dexterity save bonus, read off a save nothing answers.
  const bonus = (await rig.roll(friend, { kind: "saving_throw", ability: "dex", dc: 1 }, [10])).total - 10;
  // The holder's player is at the table: a roll does not wait on an absent one.
  const leave = subscribe(world.campaignId, () => {}, world.sheet(holder.id).userId);
  try {
    // A friend's save that fails by one waits on the holder.
    const dc = 6 + bonus;
    world.clearDice();
    world.dice(5);
    await world.invoke("request_roll", { characterId: friend.id, kind: "saving_throw", ability: "dex", dc, reason: "probe" });
    const [pending] = listOpenPendingRolls(world.campaignId).filter((entry) => entry.thrown);
    assert.ok(pending, "a friend's save that fails by one waits on nobody");
    assert.ok(pending.thrown.options.some((option) => option.id === power && option.by === holder.id), `the card offers ${JSON.stringify(pending.thrown.options.map((option) => option.id))}`);
    world.clearDice();
    world.dice(1);
    world.signIn({ id: world.sheet(holder.id).userId });
    const pressed = await callRoute(route, "POST", { use: power, by: holder.id }, { campaignId: world.campaignId, pendingRollId: pending.id });
    world.clearDice();
    assert.equal(pressed.status, 200, JSON.stringify(pressed.json));
    const landed = getPendingRoll(pending.id);
    assert.notEqual(landed.status, "pending", "the save lands once the holder has answered");
    assert.equal(getRoll(landed.rollId).total, dc, "the save is the lowest number that succeeds");
    assert.equal(rig.reacted(holder), true, "the reaction");
    paid("a friend's save");
    // A foe's save that passes by one: the holder said "if it succeeds" at
    // the stop, and the save site asks once it knows.
    rig.refill(holder);
    fresh();
    kit.giveTurn(holder.id);
    kit.freshTurn();
    const now = world.sheet(holder.id);
    world.patch(holder.id, { spellcasting: { ...now.spellcasting, cantrips: [...new Set([...(now.spellcasting.cantrips ?? []), "Poison Spray"])] } });
    const tag = { roller: "enemy", kind: "save", who: rig.foe(enemy).displayName };
    const cast = (faces) => {
      world.clearDice();
      world.dice(...faces);
      return runWithShift(world.campaignId, { wizardId: holder.id, rolls: [{ tag, reverse: "success" }], power }, () => world.invoke("cast_at_enemy", { characterId: holder.id, targetEnemyId: enemy.id, spell: "Poison Spray" }));
    };
    const { saveModFor } = await import("../../src/lib/bestiary/enemy-numbers.ts");
    // The spell lands when the save fails: what the foe lost, and the line
    // the call's answer carries when the holder's word answered the save.
    return {
      enemy,
      saveMod: saveModFor(rig.foe(enemy).stats, "con"),
      cast: async (faces) => {
        const before = rig.foe(enemy).currentHp;
        const done = await cast(faces);
        world.clearDice();
        assert.equal(done.result.ok, true, done.result.error);
        return { shift: done.shift, lost: before - rig.foe(enemy).currentHp };
      },
    };
  } finally {
    leave();
  }
}
