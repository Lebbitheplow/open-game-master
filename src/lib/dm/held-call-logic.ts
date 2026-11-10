// The pure half of a held call (src/lib/dm/held-call.ts): which roll a run
// already has, and the faces a run draws again.

import type { DecidedRoll } from "@/lib/db/dm-turns";
import type { RollKind } from "@/lib/db/rolls";

// The first roll of this character's, of this kind, the run has not used:
// a call may throw the same character's d20 more than once, and each lands in
// the order the run first asked for it.
export function nextDecided(
  decided: readonly DecidedRoll[],
  used: ReadonlySet<number>,
  characterId: string,
  kind: RollKind,
): number {
  return decided.findIndex((roll, index) => !used.has(index) && roll.characterId === characterId && roll.kind === kind);
}

// A run's faces drawn by chance, read back in order. A die of other sides
// than the tape holds next means the run went another way since (the table
// changed while the player rolled): the tape stops, and the rest is chance.
export class DiceTapeCursor {
  private at = 0;
  private readonly faces: ReadonlyArray<readonly [number, number]>;
  constructor(faces: ReadonlyArray<readonly [number, number]>) {
    this.faces = faces;
  }

  next(sides: number): number | null {
    const entry = this.faces[this.at];
    if (!entry) {
      return null;
    }
    if (entry[0] !== sides || entry[1] < 1 || entry[1] > sides) {
      this.at = this.faces.length;
      return null;
    }
    this.at += 1;
    return entry[1];
  }
}
