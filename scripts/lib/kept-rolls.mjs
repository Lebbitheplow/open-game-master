// A call that parked on its player's after-the-roll card (Lucky, a held
// Bardic die, Chronal Shift: src/lib/dm/character-roll.ts) answers once the
// card is answered. For a probe that only reads what the call did, the player
// keeps the dice as they lie, and the call's own answer is read back off the
// card (src/lib/dm/held-call.ts). Import scripts/lib/enforce-world.mjs first.
export async function keepThrownCards(world, outcome) {
  if (!outcome?.ok || outcome.result?.parked !== true) {
    return outcome;
  }
  const { listOpenPendingRolls, getPendingRoll } = await import("../../src/lib/db/dm-turns.ts");
  const { landPendingRoll } = await import("../../src/lib/dm/pending-roll-land.ts");
  let answer = null;
  for (let guard = 0; guard < 8; guard += 1) {
    const open = listOpenPendingRolls(world.campaignId).filter((pending) => pending.thrown);
    if (!open.length) break;
    for (const pending of open) {
      const roll = landPendingRoll(world.campaign(), pending, pending.thrown.outcome, pending.thrown.landing);
      const told = getPendingRoll(pending.id)?.carry?.answer;
      // A request_roll's own card holds no call: its answer is the roll.
      answer = told ? JSON.parse(told) : roll ? { ok: true, total: roll.total, dice: roll.breakdown.terms, ...(pending.dc !== null ? { dc: pending.dc, success: roll.total >= pending.dc } : {}) } : answer;
    }
  }
  if (!answer) return outcome;
  return typeof answer.error === "string" ? { ok: false, error: answer.error, ...(answer.retry ? { retry: true } : {}), ...(answer.refused ? { refused: answer.refused } : {}) } : { ok: true, result: answer };
}
