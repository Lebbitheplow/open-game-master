// A spell that passes over a creature by its own Intelligence. SRD 5.1,
// Hideous Laughter: "A creature with an Intelligence score of 4 or less isn't
// affected." The spell is cast and spent and does nothing to one, as Hold
// Monster does nothing to an undead. Y04 read it on a hero's cast_at_enemy
// alone, so a creature's Hideous Laughter still laid a polymorphed hero, a
// beast companion or a ranger's wolf low with laughter. Every door a cast at
// a creature takes asks here: cast_at_enemy, a creature's cast_at_player (a
// character, a companion, a pet) and aoe_damage.
// Pure.

// The line the cast answers with, or null when the creature is affected.
export function sparedByIntelligence(spell: string, sparesIntAtMost: number | undefined, target: { name: string; int: number | undefined }): string | null {
  if (sparesIntAtMost === undefined || typeof target.int !== "number" || target.int > sparesIntAtMost) {
    return null;
  }
  return `${spell} has no effect on a creature with an Intelligence of ${sparesIntAtMost} or less, and ${target.name}'s is ${target.int}.`;
}

// A character's Intelligence as it stands. SRD 5.1, Polymorph: "The target's
// game statistics, including mental ability scores, are replaced by the
// statistics of the chosen beast"; Wild Shape keeps the druid's own (its
// form stores Strength, Dexterity and Constitution only).
export function sheetIntelligence(sheet: { abilities?: { int?: number }; wildShape?: { abilities?: { int?: number } } | null }): number | undefined {
  return sheet.wildShape?.abilities?.int ?? sheet.abilities?.int;
}
