// What an ally's genre aura adds to one save (src/lib/dm/genre-b-auras.ts
// finds the auras; rolls.ts resolveRollExpression asks this with the save's
// `against`). Pure, so the roll resolver may import it.
export type GenreSaveAura = { feature: string; die?: string; advantage?: boolean; against: string[] };

export function saveAuraRiders(auras: readonly GenreSaveAura[] | undefined, against: string | undefined): { dice: string; advantage: boolean; notes: string[] } {
  const out = { dice: "", advantage: false, notes: [] as string[] };
  if (!against) {
    return out;
  }
  for (const aura of auras ?? []) {
    if (!aura.against.includes(against)) {
      continue;
    }
    if (aura.die) {
      out.dice += `+${aura.die}`;
      out.notes.push(`${aura.feature}: an ally's aura adds +${aura.die} to a save against being ${against}`);
    }
    if (aura.advantage) {
      out.advantage = true;
      out.notes.push(`${aura.feature}: an ally's aura gives advantage on a save against being ${against}`);
    }
  }
  return out;
}
