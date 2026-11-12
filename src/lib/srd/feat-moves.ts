// What a feat changes of movement and of the attacks movement provokes, read
// by the doors that move a character: the move route and the board's reach
// (src/lib/battlemap/passage.ts pcMoveTraits, view-moves.ts), the jump
// (src/lib/dm/jump-move.ts) and the opportunity attacks a walker draws
// (src/lib/dm/opportunity.ts resolvePcOpportunityAttacks). Each rule is one
// function here so a second door cannot answer differently; a door that moves
// a character or resolves an opportunity attack asks here, never the feat's
// name.
//
// Pure.
import { holdsFeat } from "@/lib/srd/feat-effects";
import { RUN_UP_TILES } from "@/lib/srd/jump";

type FeatHolder = { feats?: string[]; features?: Array<{ name: string }> };

// Athlete: "you can make a running jump after moving only 5 feet", where
// anyone else needs 10 (SRD 5.1, Jumping). The squares moved this turn that
// make this character's jump a running one.
export function runUpTiles(sheet: FeatHolder): number {
  return holdsFeat(sheet, "Athlete") ? 1 : RUN_UP_TILES;
}

// Mobile: "difficult terrain costs no extra movement when you Dash". True on
// a turn the holder has Dashed; the board's rough ground and a spell's alike
// then cost a square a square (passage.ts sets MoveTraits.anyGround).
export function dashCrossesDifficultTerrain(sheet: FeatHolder, dashedThisTurn: boolean): boolean {
  return dashedThisTurn && holdsFeat(sheet, "Mobile");
}

// Sentinel: "creatures provoke opportunity attacks from you even if they
// Disengage". A walker that Disengaged still draws this character's swing.
export function strikesTheDisengaged(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Sentinel");
}

// Charger: "If you moved at least 10 feet in a straight line first, the
// attack deals an extra 5 damage or the shove pushes 10 extra feet." The mark
// a turn carries once the holder's own walk ended in a straight run of that
// length (src/lib/dm/ar-wbf-feat-turn.ts writes it from the path walked),
// and what the run adds.
export const CHARGER_RAN = "charger:ran-straight";
export const CHARGER_RUN_TILES = 2;
export const CHARGER_PUSH_TILES = 2;

export function hasCharger(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Charger");
}
