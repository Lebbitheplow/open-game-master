// The turn mark a wizard spell's damage leaves on its caster's turn, at the
// creature it hurt (written by src/lib/dm/spell-damage-mark.ts, read by Power
// Surge's spend and its Hand card). Pure, so the Hand reads it too.

export const WIZARD_SPELL_DAMAGE = "wizard-spell-damage:";

// The creatures a wizard spell of this turn has hurt, from the turn's marks.
export function spellHurt(marks: readonly string[] | undefined): string[] {
  return (marks ?? []).filter((mark) => mark.startsWith(WIZARD_SPELL_DAMAGE)).map((mark) => mark.slice(WIZARD_SPELL_DAMAGE.length));
}
