// What an ally's aura lends one roll: advantage, or a die added (the genre
// classes' "you and allies within 10 ft have advantage against being
// frightened", "allies within 10 ft add +1d4 to fear saves", "add +1d4 to
// CHA-based checks"). src/lib/dm/genre-a-auras.ts finds the auras that reach
// the roller on the board (it reads the database); this pure half says which
// of them fit the roll, so src/lib/dm/roll-feature-riders.ts, which every
// save and check the engine rolls goes through, can stay pure.
import { keyFits, type KeyedRoll, type RollKey } from "@/lib/srd/roll-keys";

export type LentRoll = RollKey & {
  // Absent: advantage. Present: the die added ("1d4").
  die?: string;
  note: string;
};

export function lentFor(lent: readonly LentRoll[], roll: KeyedRoll): { advantage: string[]; dice: string; notes: string[] } {
  const advantage: string[] = [];
  const notes: string[] = [];
  let dice = "";
  // A die is lent once however many auras lend it (the same rule as Bless).
  const dealt = new Set<string>();
  for (const entry of lent) {
    if (!keyFits(entry, roll)) {
      continue;
    }
    if (!entry.die) {
      advantage.push(entry.note);
    } else if (!dealt.has(entry.die)) {
      dealt.add(entry.die);
      dice += `+${entry.die}`;
      notes.push(entry.note);
    }
  }
  return { advantage, dice, notes };
}
