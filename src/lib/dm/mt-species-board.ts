// Aggressive on a character (an orc of src/lib/srd/races.json): "bonus
// action: move up to your speed toward a hostile creature you can see". The
// bonus-action Dash it buys (src/lib/dm/bonus-routes.ts) is counted like any
// other, and marks the turn (AGGRESSIVE_DASH, src/lib/dm/action-price.ts);
// the player's walk then asks here, as an enemy orc's asks
// src/lib/dm/enemy-aggressive.ts: the character's own movement is spent
// first and goes anywhere, and from there each step must not end farther
// from the nearest hostile creature they can see (enemy-turn-logic.ts
// towardSteps). With nobody in sight, no step of that speed is toward
// anyone.
import { listHiddenRefIds, listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { listEnemies, type Encounter } from "@/lib/db/encounters";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { walkPathWithBudget } from "@/lib/battlemap/movement";
import { chebyshev, type BattleToken, type MoveTraits } from "@/lib/battlemap/types";
import { towardSteps } from "@/lib/dm/enemy-turn-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const AGGRESSIVE_DASH = "aggressive:dash";

type XY = { x: number; y: number };

// Why this walk is refused, or null: the turn holds no Aggressive Dash, the
// walk fits in the character's own movement, or every step the Dash pays for
// closes on a hostile creature in sight.
export function aggressiveRefusal(input: {
  encounter: Encounter;
  map: BattleMap;
  sheet: { name: string; conditions: string[] };
  token: BattleToken;
  path: XY[];
  // Tiles left this turn, the Aggressive Dash's among them, and the tiles
  // one Dash is worth.
  budgetTiles: number;
  speedTiles: number;
  marks: readonly string[];
  traits: MoveTraits;
}): string | null {
  const { map, token, path } = input;
  if (!input.marks.includes(AGGRESSIVE_DASH) || !path.length) {
    return null;
  }
  const own = Math.max(0, input.budgetTiles - input.speedTiles);
  const ownWalk = walkPathWithBudget(map.terrain, map.width, path, own, input.traits, token);
  if (ownWalk.reachedEnd && ownWalk.at) {
    return null;
  }
  const paidFrom = ownWalk.at ? path.findIndex((step) => step.x === ownWalk.at?.x && step.y === ownWalk.at?.y) + 1 : 0;
  const blind = input.sheet.conditions.some((entry) => isConditionNamed(entry, "blinded"));
  const hidden = new Set(listHiddenRefIds(map.id));
  const standing = new Set(listEnemies(input.encounter.id).filter((enemy) => enemy.status === "alive").map((enemy) => enemy.id));
  const seen = blind
    ? []
    : listTokens(map.id)
        .filter((other) => standing.has(other.refId) && !hidden.has(other.refId))
        .filter((other) => hasLineOfSight(map.terrain, map.width, token.x, token.y, other.x, other.y));
  const nearest = (at: XY) => (seen.length ? Math.min(...seen.map((foe) => chebyshev(at.x, at.y, foe.x, foe.y))) : Number.POSITIVE_INFINITY);
  const allowed = seen.length ? towardSteps(token, path, paidFrom, nearest) : path.slice(0, paidFrom);
  if (allowed.length >= path.length) {
    return null;
  }
  return seen.length
    ? `Aggressive carries ${input.sheet.name} only toward a hostile creature they can see: past their own ${own * 5} feet of movement, every step must close on one. Move toward a foe, or stop within your own movement.`
    : `Aggressive carries ${input.sheet.name} only toward a hostile creature they can see, and they see none: only their own ${own * 5} feet of movement is left to walk.`;
}
