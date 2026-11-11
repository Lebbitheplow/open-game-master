// What a tool call leaves to be done once everything else in it has resolved.
//
// A rule that fires in the middle of a call and hurts creatures the rest of
// the call is still working on cannot write at once. The cast tools read
// their targets before they ask the cast door for the slot, and land their
// damage on those rows afterwards (cast-at-enemy-damage.ts, pc-attack-damage.ts):
// hit points written in between are overwritten by the spell's own damage, and
// a creature killed in between is struck again as if it stood. Heart of the
// Storm's burst is such a rule: it fires at the cast door, on creatures that
// are often the spell's own targets (src/lib/dm/ar-ws-heart-storm.ts).
//
// So the rule hands its landing here, and it runs at the end of the tool call
// it was raised in: inside the same held call and the same transaction
// (held-call.ts runHeld calls settleAfterCall once its handler has answered),
// so a call that parks for a player's roll takes it back with everything else
// and raises it again when it runs again. What the landing answers joins the
// call's result. Outside a held call (a casting the server completes as a turn
// starts, a suite calling a handler directly) nothing else is in flight, and
// the landing runs at once.
//
// A new rule that must wait for the end of the call it fires in uses this;
// it never keeps a list of its own.

type Landing = () => Record<string, unknown> | null;

// Keyed by the held call's own trial, so a call that is rolled back drops
// what it left with it.
const waiting = new WeakMap<object, Landing[]>();

// Runs `land` at the end of the tool call now running, or at once when none
// is. Answers what it landed when it ran at once, else null.
export function afterThisCall(land: Landing): Record<string, unknown> | null {
  const trial = globalThis.__odmHeldTrial as object | null | undefined;
  if (!trial) {
    return land();
  }
  waiting.set(trial, [...(waiting.get(trial) ?? []), land]);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Called by runHeld with its handler's answer: lands what the call left and
// joins what that answered to the answer.
export function settleAfterCall<T>(trial: object, result: T): T {
  const left = waiting.get(trial);
  if (!left?.length) {
    return result;
  }
  waiting.delete(trial);
  const landAll = (answer: unknown): unknown => {
    const extra: Record<string, unknown> = {};
    for (const land of left) {
      Object.assign(extra, land() ?? {});
    }
    return isRecord(answer) ? { ...answer, ...extra } : answer;
  };
  // An async handler answers later: what it left lands when it has.
  if (isRecord(result) && typeof (result as { then?: unknown }).then === "function") {
    return (result as unknown as Promise<unknown>).then(landAll) as unknown as T;
  }
  return landAll(result) as T;
}
