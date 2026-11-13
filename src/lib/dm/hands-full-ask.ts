// When an attack is refused because both hands are full, what to let go of is
// the player's call. A storyteller told only that dropping is free and
// putting away is the interaction picked for them: asked to swing a
// quarterstaff, it stowed the sling and spent the turn's interaction on a
// choice the player never made. The refusal now says to ask, and a drop or
// a put-away of that character's gear later in the same storyteller turn is
// refused, so the answer has to come from the player's next message.
//
// Kept in memory for the storyteller turn that saw the refusal: a turn runs
// in one process, and the player's answer starts a new one.

const asked = new Map<string, Set<string>>();
const KEEP = 200;

export function noteHandsFullAsk(turnId: string, sheetId: string): void {
  const held = asked.get(turnId) ?? new Set<string>();
  held.add(sheetId);
  asked.delete(turnId);
  asked.set(turnId, held);
  while (asked.size > KEEP) {
    const oldest = asked.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    asked.delete(oldest);
  }
}

export function handsFullAsked(turnId: string, sheetId: string): boolean {
  return asked.get(turnId)?.has(sheetId) ?? false;
}

// The words added to a hands-full refusal for a character a player runs.
export function askPlayerWords(who: string): string {
  return ` Which to let go of is ${who}'s player's choice: ask them whether to drop one or put one away, and wait for their answer. Do not choose for them; nothing was spent.`;
}
