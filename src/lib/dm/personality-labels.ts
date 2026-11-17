// The stock GM personalities' words in the interface's language.
//
// The stock presets are seeded into the database once with their English
// names (personalities.ts), so the name on the row is the only stable handle
// back to a preset. A render site asks for the message key that name maps to
// and reads it through its own translator, falling back to the row's own
// words for a personality a user wrote. Pure, so both the creator's wizard
// and the table's settings can import it.

const STOCK_BLURBS: Record<string, string> = {
  "The Storyteller": "Warm, generous, sweeping.",
  "The Referee": "By the book, no favours.",
  "The Grim Chronicler": "Hard rulings, dark roads.",
  "The Trickster": "Light on its feet, quick to laugh.",
  "The Courtier": "Every room a negotiation.",
};

// The message key for a stock preset's name or blurb, by the name the
// database keeps; null when the name is not one of the seeds.
export function personalityKey(kind: "name" | "blurb", name: string): string | null {
  const blurb = STOCK_BLURBS[name];
  if (!blurb) return null;
  return kind === "name" ? name : blurb;
}
