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
  // A call held on the roll (held-call.ts): the fight turn it was made on,
  // when that was the roller's own.
  carry?: { call?: { ownTurn?: string } } | null;
};

// The fight whose turn is being ended (encounters.ts fightNow).
export type FightNow = { createdAt: string; round: number; turnKey?: string };

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

// The attack's d20, or the damage dice of its hit, still with the player.
// A hit's damage is part of the attack (SRD 5.1, Making an Attack: "roll
// damage" is its last step): with the damage card open, the player's End
// Turn went through and the goblin the blow would have killed took its turn
// before the damage landed. The lead's skip still asks only for the d20
// (pending-roll-land.ts keepRollsLeftBehind): a hit's damage lands whenever
// it is entered.
//
// And a call held on its player's d20 on their own turn (held-call.ts): a
// grapple or shove contest, a check the action makes. With that d20 in the
// player's hand End Turn went through, the call ran again on a turn that was
// no longer theirs and was refused, and the grapple never happened.
export function attackRollWithPlayer<T extends OpenRoll>(open: readonly T[], characterId: string, fight?: FightNow): T | null {
  const damage = open.find(
    (entry) =>
      entry.characterId === characterId &&
      entry.kind === "damage" &&
      entry.attack !== null &&
      (!fight || (entry.createdAt >= fight.createdAt && (entry.attack.round === undefined || entry.attack.round === fight.round))),
  );
  const held = fight?.turnKey
    ? open.find((entry) => entry.characterId === characterId && entry.carry?.call?.ownTurn === fight.turnKey)
    : undefined;
  return toHitRollWithPlayer(open, characterId, fight) ?? damage ?? held ?? null;
}

const attackWords = (roll: OpenRoll) =>
  roll.attack
    ? `${roll.attack.attacker}'s ${roll.attack.weapon} ${roll.kind === "damage" ? "damage" : "attack"}`
    : roll.kind === "damage"
      ? "A hit's damage"
      : "An attack";

// A held call's own roll is the player's whatever it is (a contest, a check):
// the words say so rather than calling it an attack.
const heldWaits = (roll: OpenRoll) => !roll.attack && Boolean(roll.carry?.call);

// The End Turn button's refusal, to the player holding the card.
export function endTurnWaitsLine(roll: OpenRoll): string {
  if (heldWaits(roll)) {
    return roll.thrown ? "The roll you were asked for is waiting on your choice. Change it or keep it, then end the turn." : "The roll you were asked for is waiting on you. Roll it, then end the turn.";
  }
  const what = attackWords(roll);
  return roll.thrown
    ? `${what} is waiting on your choice. Change the roll or keep it, then end the turn.`
    : `${what} is waiting on your roll. Roll it, then end the turn.`;
}

// An attack card played while the turn's last swing still waits on its
// player (issue 931): the card went through, pc_attack was refused for the
// attack the roll had already spent, and the GM told the swing as "resolved
// in the opening exchange" while its d20 was still in the player's hand. The
// Hand answers first, in the End Turn button's words.
export function attackCardWaitsLine(roll: OpenRoll): string {
  if (heldWaits(roll)) {
    return roll.thrown ? "The roll you were asked for is waiting on your choice. Change it or keep it first." : "The roll you were asked for is waiting on you. Roll it first.";
  }
  const what = attackWords(roll);
  return roll.thrown
    ? `${what} is waiting on your choice. Change the roll or keep it first.`
    : `${what} is waiting on your roll. Roll it first.`;
}

// The same, to whoever called pc_attack: the swing is not lost and not
// landed, and a second call for it would be refused by the attack it spent.
export function attackWaitsToolLine(name: string, roll: OpenRoll): string {
  const weapon = roll.attack?.weapon ? `${roll.attack.weapon} ` : "";
  if (heldWaits(roll)) {
    return `${name}'s ${roll.kind.replace(/_/g, " ")} for what they are doing is still waiting on their player's ${roll.thrown ? "choice" : "dice"}; it has not landed. Nothing was spent. Do not attack or narrate it resolved yet: the turn resumes once it lands.`;
  }
  if (roll.kind === "damage") {
    return `${name}'s ${weapon}hit is still waiting on its player's damage dice; the damage has not landed. Nothing was spent. Do not narrate the damage or call pc_attack again yet: the turn resumes once it lands, and any further attack is made after that.`;
  }
  return `${name}'s ${weapon}attack is still waiting on its player's ${roll.thrown ? "choice" : "dice"}; it has not landed. Nothing was spent. Do not call pc_attack for it again or narrate it resolved: the turn resumes once it lands, and any further attack is made after that.`;
}

// The same, to whoever called end_turn.
export function endTurnToolLine(name: string, roll: OpenRoll): string {
  return `${name}'s ${roll.kind === "damage" ? "damage roll" : roll.attack ? "attack roll" : "roll"} waits on their player's ${roll.thrown ? "choice" : "dice"}. End the turn once it lands. Nothing was changed.`;
}

// A roll that landed on nothing, its turn being over, while the story went on
// without it: the turn it was parked on has nothing left to tell. Resumed, it
// narrated the lost swing into a scene several turns on.
export function parkedTurnIsStale(landed: { toHit: boolean; turnOver: boolean; turnId: string }, latestTurnId: string | null): boolean {
  return landed.toHit && landed.turnOver && latestTurnId !== null && latestTurnId !== landed.turnId;
}
