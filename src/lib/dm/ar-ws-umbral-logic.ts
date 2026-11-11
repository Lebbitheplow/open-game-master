// Umbral Form (Shadow Magic 18): "Spend 6 sorcery points to become shadow for
// a minute: resistance to all but force and radiant damage, and the ability to
// move through creatures and objects." The spend laid the condition and its
// resistances; the move door never read it, so a sorcerer in shadow form was
// stopped by a hostile creature's space and by every object on the board, as
// anyone is.
//
// Under the condition the sorcerer's walk passes through every creature's
// space, friend or foe and whatever its size, and through every object the
// board holds as a piece (a prop: a statue, a cart, a brazier). The board's
// own passage rule does the rest (src/lib/battlemap/passage.ts and
// movement.ts): a space passed through costs double, as difficult terrain,
// and no move ends inside one.
//
// Ruling: the walls and the shut doors of a board are its terrain, the
// building itself, which is no object ("an object is a discrete, inanimate
// item ... not a building", SRD 5.1, Objects), so they stop the shadow as they
// stop anyone.
//
// Read by pcMoveTraits (src/lib/battlemap/passage.ts), the one helper every
// walk of a character asks: the move route, move_token's walk, the board's
// reachable squares and the Hand's.
//
// Pure: no database.

import { isConditionNamed } from "@/lib/srd/feature-names";

export const UMBRAL_FORM = "umbral form";
// An Undead warlock's Spirit Projection passes "through creatures and objects
// as difficult terrain" by the same board rule (src/lib/dm/spirit-projection.ts
// deals the 1d10 force to a turn that ends inside one anyway).
const SPIRIT_PROJECTION = "spirit projection";

// Whether these conditions let their holder move through creatures and objects.
export function movesThroughEverything(conditions: readonly string[] | null | undefined): boolean {
  return (conditions ?? []).some((entry) => isConditionNamed(entry, UMBRAL_FORM) || isConditionNamed(entry, SPIRIT_PROJECTION));
}
