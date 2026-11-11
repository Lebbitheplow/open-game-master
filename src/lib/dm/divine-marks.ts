// Once-per-turn marks the divine package's features read on the holder's turn
// budget (TurnBudget.oncePerTurn). Pure constants, so the attack path that
// writes one and the spend that reads it share the word.

// A Divine Smite the hit paid for this turn (src/lib/dm/attack-swing.ts
// hitSwing): Inspiring Smite comes right after one.
export const DIVINE_SMITE_LANDED = "divine-smite-landed";
