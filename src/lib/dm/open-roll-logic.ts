// A to-hit roll still with its player when their turn moves on never lands
// (src/lib/dm/attack-record.ts attackTurnOver): the swing was declared on a
// turn that is over. So the turn does not end under it. The player's End
// Turn went through with the after-the-roll card still open at a table of
// one, where no clock keeps the roll (after-roll-timer.ts): the attack was
// lost, the card stayed up through the next turns with a Lucky button that
// could only be refused, and answering it woke the turn it was parked on to
// narrate a swing two turns old (table report, 2026-11-10). The GM's
// end_turn already waited for a thrown roll; a roll whose dice were not yet
// entered was lost the same way through both doors.
//
// Pure: the open rolls in, the one in the way and the words for it out.

export type OpenRoll = {
  characterId: string | null;
  kind: string;
  // A pc_attack's record: only its rolls die with the turn. A check or a
  // save lands whenever it is answered.
  // `round`: the round it was declared in, on a record that names one.
  attack: { attacker: string; weapon: string; round?: number } | null;
  // The dice are thrown and the choice is open; absent, the dice are still
  // the player's to throw.
  thrown: unknown | null;
  createdAt: string;
};

// `fight`: the fight whose turn is being ended. A card left open by a fight
// that is over, or by an earlier round of this one, is already lost: it
// holds no later turn, and answering it lands nothing.
export function toHitRollWithPlayer<T extends OpenRoll>(open: readonly T[], characterId: string, fight?: { createdAt: string; round: number }): T | null {
  return (
    open.find(
      (entry) =>
        entry.characterId === characterId &&
        entry.kind === "attack" &&
        entry.attack !== null &&
        (!fight || (entry.createdAt >= fight.createdAt && (entry.attack.round === undefined || entry.attack.round === fight.round))),
    ) ?? null
  );
}

// The End Turn button's refusal, to the player holding the card.
export function endTurnWaitsLine(roll: OpenRoll): string {
  const what = roll.attack ? `${roll.attack.attacker}'s ${roll.attack.weapon} attack` : "An attack";
  return roll.thrown
    ? `${what} is waiting on your choice. Change the roll or keep it, then end the turn.`
    : `${what} is waiting on your roll. Roll it, then end the turn.`;
}

// The same, to whoever called end_turn.
export function endTurnToolLine(name: string, roll: OpenRoll): string {
  return `${name}'s attack roll waits on their player's ${roll.thrown ? "choice" : "dice"}. End the turn once it lands. Nothing was changed.`;
}

// A roll that landed on nothing, its turn being over, while the story went on
// without it: the turn it was parked on has nothing left to tell. Resumed, it
// narrated the lost swing into a scene several turns on.
export function parkedTurnIsStale(landed: { toHit: boolean; turnOver: boolean; turnId: string }, latestTurnId: string | null): boolean {
  return landed.toHit && landed.turnOver && latestTurnId !== null && latestTurnId !== landed.turnId;
}
