// A character falling incapacitated (stunned, paralyzed, petrified, asleep,
// down at 0 hit points) is answered by features that act "when you are
// reduced to 0 hit points or are incapacitated against your will" (Faithful
// Summons), whichever route lays the condition: damage, a spell's save, an
// attack's rider, set_condition. The rows are written here, below the rules,
// so the rule registers itself (src/lib/dm/faithful-summons.ts) and runs once
// the write's own handler has finished, as flight-watch.ts does for a fall.

import { isIncapacitated } from "@/lib/dm/condition-logic";

type Held = { conditions: string[]; deathSaves?: { dead?: boolean } | null };

let answer: ((campaignId: string, sheetId: string) => void) | null = null;
// One answer per character per handler, however many rows it wrote.
const due = new Set<string>();

export function onIncapacity(listener: (campaignId: string, sheetId: string) => void) {
  answer = listener;
}

export function noteIncapacity(campaignId: string, sheetId: string, before: Held | null, after: Held | null) {
  const listener = answer;
  if (!campaignId || !listener || due.has(sheetId) || !after || after.deathSaves?.dead) {
    return;
  }
  if (!isIncapacitated(after.conditions) || (before && isIncapacitated(before.conditions))) {
    return;
  }
  due.add(sheetId);
  queueMicrotask(() => {
    due.delete(sheetId);
    // A script that closed its database the moment it finished must not
    // take the process down.
    try {
      listener(campaignId, sheetId);
    } catch {
      // Nothing to undo: the rows are written.
    }
  });
}
