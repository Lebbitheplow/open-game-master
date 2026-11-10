// Pure: the reach and the numbers of the paladin auras that work on other
// creatures than the paladin (Aura of the Sentinel, Aura of Hate, Aura of
// Alacrity). src/lib/dm/divine-auras.ts reads the sheets and the board.

export type AuraLadder = number | ReadonlyArray<readonly [number, number]>;

export type AuraOffer = { bonus: number; note: string };

// The aura's reach in feet at this class level: the last step of the ladder
// the level has reached ([[7, 10], [18, 30]] is 10 feet from 7th level and
// 30 from 18th). Below every step the first one stands, as the feature's own
// level gate keeps a lower paladin from holding it at all.
export function auraReachFeet(range: AuraLadder, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 0;
  for (const [atLevel, value] of range) {
    if (level >= atLevel) {
      feet = value;
    }
  }
  return feet;
}

// The one aura of a kind that counts: the same feature from two paladins
// does not stack (a creature benefits from one paladin's at a time), so the
// largest offer stands, less what the creature already adds of its own (a
// Watchers paladin in another's aura keeps the larger bonus, never the sum).
export function bestAuraOffer(offers: readonly AuraOffer[], own: number): AuraOffer | null {
  let best: AuraOffer | null = null;
  for (const offer of offers) {
    if (!best || offer.bonus > best.bonus) {
      best = offer;
    }
  }
  if (!best || best.bonus - own <= 0) {
    return null;
  }
  return { bonus: best.bonus - own, note: best.note };
}

// Aura of Hate's creatures: a stat block's type among the aura's types. Both
// are the bestiary's type words (src/lib/bestiary/creature-type.ts
// creatureTypeOf normalizes the block's), so they compare as they are.
export function auraCoversType(types: readonly string[], type: string): boolean {
  return types.includes(type);
}

// An ability modifier an aura adds to damage: at least +1.
export function auraDamageAmount(modifier: number | undefined): number {
  return Math.max(1, modifier ?? 0);
}
