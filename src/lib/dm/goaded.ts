// A creature goaded by a character: a Battle Master's Goading Attack ("the
// target has disadvantage on all attack rolls against targets other than
// you") and a Swashbuckler's Panache on a hostile creature ("it has
// disadvantage on attack rolls against targets other than you and can't make
// opportunity attacks against targets other than you"). Both lay the
// condition GOADED with the character as its source. The goad was laid and
// nothing read it, so a goaded ogre swung at the wizard as freely as at the
// fighter. Every door a creature's attack roll or opportunity attack goes
// through asks here.

import { isConditionNamed } from "@/lib/srd/feature-names";

export const GOADED = "goaded";

type Goadable = { conditions: string[]; conditionMeta?: unknown };

// The character the creature is goaded by when that is not `targetId`, else
// null: an attack at anyone else is made at disadvantage.
export function goadedAway(attacker: Goadable, targetId: string): string | null {
  const meta = (attacker.conditionMeta ?? {}) as Record<string, { source?: string } | undefined>;
  for (const name of attacker.conditions) {
    if (!isConditionNamed(name, GOADED)) continue;
    const source = meta[name]?.source;
    if (source && source !== targetId) return source;
  }
  return null;
}

// Panache's goad bars an opportunity attack at anyone but the goader; a
// Goading Attack's goad does not.
export function goadBarsOpportunity(attacker: Goadable, targetId: string): boolean {
  const meta = (attacker.conditionMeta ?? {}) as Record<string, { source?: string; panache?: boolean } | undefined>;
  return attacker.conditions.some((name) => isConditionNamed(name, GOADED) && meta[name]?.panache === true && Boolean(meta[name]?.source) && meta[name]?.source !== targetId);
}
