// Whose rolls the game parks instead of rolling at once. Two reasons put a
// player here, and both produce the same pending-roll card:
//
// - real dice: the player opted in and the campaign's dice policy allows it
//   (the numbers are typed or reported by a Pixels die, so trust is the
//   campaign's call);
// - hold my rolls: the player asked for every roll to wait for them, then
//   rolls it digitally themselves (a shake of the phone, or a tap). The
//   server still draws every number, so no policy gates it.
//
// Pure and alias-import-free so scripts/test-held-rolls.mjs can load it.

// What a player rolling real dice is asked for, said wherever they opt in.
// Every d20 a GM's call throws for a character goes through one door
// (src/lib/dm/character-roll.ts), which holds the call for the card: a
// request_roll and a pc_attack park their own, and every other check, save,
// contest and attack waits the same way, the saves the engine forces and
// concentration included ("A seat on physical dice rolls its own saves,
// including saves the engine forces", maintainer decision R5 of the
// 2026-11-09 gap sweep, after issue #896). A roll made outside any of the
// GM's calls (a death save as the turn passes once the GM has spoken, a
// disease's save at a rest) has no call to hold, and is still thrown.
// The healing dice of a character's own feature, potion, spell or Healer's
// kit, and the temporary hit points a feature or spell gives, go through the
// same door (character-roll.ts rollOwnDice; issue 902: Second Wind was rolled
// for a seat on physical dice). The sentence does not name them; its second
// half is what holds them. One healing spell over several creatures is one
// call, so each creature's roll waits in turn (mutations.ts healList).
// Hit dice at a short rest are the player's own request, with no call to
// hold: the sheet takes the dice where the player asks for them
// (sheet/hit-dice/route.ts), and the GM's spend for a player at the table
// goes through the door (hit-dice.ts).
// Not yet held: a character's other dice inside a call (the damage of a
// spell that makes no attack roll, a reaction's or a rider's dice) are thrown
// where they stand. scripts/test-enforce-sweep-dice-sites.mjs lists them as
// class "D".
export const REAL_DICE_SCOPE =
  "You roll your attacks and their damage, initiative, and every check and save your character makes, the saves a spell, trap or monster forces on you included. Only a roll that comes between the GM's moves, such as a death save as your turn begins, may be rolled for you.";

export type HeldRollMember = {
  userId: string;
  useRealDice: boolean;
  holdRolls: boolean;
};

// Why one roll was parked. It is written on the pending roll when it is
// parked, because the two reasons are answered differently: real dice are
// typed by the player and believed, a held roll is thrown by the server the
// moment the player lets it go.
//
// The third reason is the game's own: the server has thrown the dice and the
// roll waits on what the player does with them (src/lib/dm/after-roll.ts).
//
// The fourth is too: no die is thrown yet, and the player may replace it with
// a number Portent foretold (src/lib/dm/foretold-logic.ts).
//
// The fifth holds no roll of this player's at all: another creature is about
// to roll, and the player watching for Portent may answer (src/lib/dm/foresight.ts).
export type ParkReason = "real_dice" | "held" | "after_roll" | "foretold" | "watch";

type DicePreferences = Pick<HeldRollMember, "useRealDice" | "holdRolls">;

// Real dice win when a player asked for both: at a table that allows them
// the player has dice in hand, and holding the roll is how they get to
// throw them.
export function parkReasonFor(
  dicePolicy: string,
  member: DicePreferences | null | undefined,
): ParkReason | null {
  if (!member) {
    return null;
  }
  if (dicePolicy === "real_allowed" && member.useRealDice) {
    return "real_dice";
  }
  return member.holdRolls ? "held" : null;
}

// Whether faces a player typed are believed for this parked roll. The roll
// must have been parked for real dice, and the table must still allow them
// for this player now: a policy closed while the roll waited closes this too.
// A roll parked before the reason was recorded (null) is judged by what the
// table and the player say today.
export function mayTypeFaces(
  parkedFor: ParkReason | null,
  dicePolicy: string,
  member: DicePreferences | null | undefined,
): boolean {
  if (parkedFor === "held" || parkedFor === "after_roll" || parkedFor === "foretold" || parkedFor === "watch") {
    return false;
  }
  return parkReasonFor(dicePolicy, member) === "real_dice";
}

export function heldRollUserIds(
  dicePolicy: string,
  members: ReadonlyArray<HeldRollMember>,
): Set<string> {
  const realAllowed = dicePolicy === "real_allowed";
  const ids = new Set<string>();
  for (const member of members) {
    if (member.holdRolls || (realAllowed && member.useRealDice)) {
      ids.add(member.userId);
    }
  }
  return ids;
}
