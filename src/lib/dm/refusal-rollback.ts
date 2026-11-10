import { getDatabase } from "@/lib/db/core";

// A refusal is the game saying no (src/lib/dm/tool-errors.ts), and a no
// leaves the table as it found it. A synchronous step that has to write
// before it knows whether it refuses (it opens the ledger its own rules then
// read) runs here: in one transaction, rolled back when the step answers with
// an error. Before, romance_advance refused "They barely know them" after it
// had stamped the NPC as met and opened two bonds (LC-REV-10).
//
// What must go through it: a synchronous tool step whose refusal can follow a
// write. An async step cannot (a transaction does not outlive an await): it
// checks before it writes.
class Refused<T> {
  readonly out: T;
  constructor(out: T) {
    this.out = out;
  }
}

export function refusedLeavesNothing<T extends object>(step: () => T): T {
  try {
    return getDatabase().transaction(() => {
      const out = step();
      if ("error" in out) {
        throw new Refused(out);
      }
      return out;
    })();
  } catch (thrown) {
    if (thrown instanceof Refused) {
      return thrown.out as T;
    }
    throw thrown;
  }
}
