// One look per figure on the board, read the same way by its flat face
// (src/lib/placeholders.ts, from the race and gender the fight view
// carries) and by a 3D board view's model (`sex` in the addon snapshot,
// src/lib/addons/board-bridge.ts), so the two never disagree.
//
// The look is the app's own gender (src/lib/gender.ts), never a display
// name:
//   - a Cast NPC: what the Cast records, read live, so a gender the story
//     records later shows at once; unrecorded stays unrecorded (the neutral
//     plate, no sex), since that is the Cast's to say;
//   - a nameless foe: what start_encounter was told, else a pick made once
//     from its own row id when it arrived and stored with it, so renaming,
//     damage, a new form and a return in a later fight never change it, and
//     two foes of one name are two people;
//   - a figure the GM put on the board by hand that the Cast does not know:
//     the same pick from its token's ref.
// The 3D sex is that gender when it is Female or Male. Nonbinary has none,
// so a view keeps its ordinary model where the flat face is the neutral one.
//
// Pure, so the board, the fight view and their tests read one rule.
import type { Gender } from "@/lib/gender";

export const SEXES = ["Female", "Male"] as const;
export type Sex = (typeof SEXES)[number];

export function storedSex(value: unknown): Sex | undefined {
  return SEXES.includes(value as Sex) ? (value as Sex) : undefined;
}

// A stable Female or Male from a saved id, for a figure nobody told a
// gender: a squad of bandits varies, and each keeps its own.
export function pickedGender(id: string): Sex {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return SEXES[hash % 2];
}

// A foe's look: its Cast NPC's record when it is one (`npc`, read live),
// else its own row's, where a row from before the column has its pick
// from its id.
export function foeLook(
  enemy: { id: string; race?: string; gender?: Gender },
  npc: { race: string; gender: Gender } | null,
): { race: string; gender: Gender } {
  if (npc) {
    return { race: npc.race, gender: npc.gender };
  }
  return { race: enemy.race ?? "", gender: enemy.gender || pickedGender(enemy.id) };
}
