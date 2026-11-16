// A character falling incapacitated (stunned, paralyzed, petrified, asleep,
// down at 0 hit points) is answered by features that act "when you are
// reduced to 0 hit points or are incapacitated against your will" (Faithful
// Summons), whichever route lays the condition: damage, a spell's save, an
// attack's rider, set_condition. The rows are written here, below the rules,
// so the rule registers itself (src/lib/dm/faithful-summons.ts) and runs once
// the write's own handler has finished, as flight-watch.ts does for a fall.

import { isIncapacitated } from "@/lib/dm/condition-logic";

type Held = { conditions: string[]; deathSaves?: { dead?: boolean } | null };

// Every rule that answers a fall registers itself (Faithful Summons, a
// bard's Countercharm ending): each is called, in the order registered.
const answers: Array<(campaignId: string, sheetId: string) => void> = [];
// One answer per character per handler, however many rows it wrote.
const due = new Set<string>();

export function onIncapacity(listener: (campaignId: string, sheetId: string) => void) {
  answers.push(listener);
}

export function noteIncapacity(campaignId: string, sheetId: string, before: Held | null, after: Held | null) {
  if (!campaignId || !answers.length || due.has(sheetId) || !after || after.deathSaves?.dead) {
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
    for (const listener of answers) {
      try {
        listener(campaignId, sheetId);
      } catch {
        // Nothing to undo: the rows are written.
      }
    }
  });
}

// The same for a creature's row (patchEnemyConditions). A creature taken out
// of action loses its concentration and lets go of whoever it grapples (SRD
// 5.1, Conditions; Concentration), and only the lay paths that asked for
// that ran it: another creature's hit (a ghoul's claws on a creature the
// party dominates), a feat's or a subclass's stun, a spell's last failed
// save each wrote the condition straight to the row, and the paralyzed
// creature kept its spell and its hold. The rule registers itself
// (src/lib/dm/enemy-incapacitation.ts); answering twice does nothing more.
const creatureAnswers: Array<(enemyId: string) => void> = [];
const creaturesDue = new Set<string>();

export function onCreatureIncapacity(listener: (enemyId: string) => void) {
  creatureAnswers.push(listener);
}

export function noteCreatureIncapacity(
  enemyId: string,
  before: { conditions: string[] } | null,
  after: { conditions: string[]; status: string } | null,
) {
  if (!creatureAnswers.length || creaturesDue.has(enemyId) || !after || after.status !== "alive") {
    return;
  }
  if (!isIncapacitated(after.conditions) || (before && isIncapacitated(before.conditions))) {
    return;
  }
  creaturesDue.add(enemyId);
  queueMicrotask(() => {
    creaturesDue.delete(enemyId);
    for (const listener of creatureAnswers) {
      try {
        listener(enemyId);
      } catch {
        // Nothing to undo: the rows are written.
      }
    }
  });
}
