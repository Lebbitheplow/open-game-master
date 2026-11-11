// Whom an authored buff lands on, and the target it cannot use.
//
// Adjust Density (Graviturgy Magic 2): "Halve or double a creature's or
// object's weight for a minute". A creature of either side: before this the
// row took an ally only, and a targetEnemyId it could not use fell back to the
// holder, so a wizard who meant to slow a foe slowed themselves and spent the
// action. A buff whose row says "creature" takes the enemy named in
// targetEnemyId, else the ally named in targetCharacterId, else the holder.
// (An object's weight is the GM's to narrate: no object stands on the board.)
//
// And for every buff: a target the buff cannot use is refused before anything
// is spent, never dropped for the holder. A creature of the other side named
// for a buff that reads none (no enemy target, no quarry, no mark, no burst),
// or an ally named for a buff that is the holder's own, is a mistake in the
// call, and the answer says where the buff does go.
//
// Pure. Called by authored-spend-effects.ts resolveSpendEffect (kind buff).

import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import type { ToolError } from "@/lib/dm/tool-errors";

type Buff = Extract<SpendDoes, { kind: "buff" }>;
type Aimed = { targetCharacterId?: string; targetEnemyId?: string };

// The side this call's buff goes to: the row's own, or for a buff that takes
// a creature of either side, the side the call names.
export function buffAim(does: Buff, args: Aimed): "self" | "ally" | "enemy" | "allies" {
  if (does.target === "creature") {
    return args.targetEnemyId ? "enemy" : "ally";
  }
  return does.target ?? "self";
}

// The other outcomes of a buff whose variants are alternatives ("halve or
// double"): laying one on a creature takes the others off it, so a creature
// made lighter and then heavier is heavier, not both at once.
export function otherOutcomes(does: Buff, condition: string): string[] {
  return [...new Set(Object.values(does.variants ?? {}))].filter((outcome) => outcome !== condition);
}

// Why this call's target is one the buff cannot use, or null.
export function strayBuffTarget(name: string, holder: { id: string; name: string }, does: Buff, args: Aimed): ToolError | null {
  const aim = buffAim(does, args);
  if (does.target === "creature" && args.targetEnemyId && args.targetCharacterId) {
    return { error: `${name} goes to one creature: pass targetEnemyId or targetCharacterId, not both. Nothing was spent.`, retry: true };
  }
  const readsEnemy = aim === "enemy" || Boolean(does.quarry) || Boolean(does.mark) || Boolean(does.burst);
  if (args.targetEnemyId && !readsEnemy) {
    const goes = aim === "ally" ? `${holder.name} or the ally named in targetCharacterId` : aim === "allies" ? `${holder.name} and their allies in reach` : `${holder.name} alone`;
    return { error: `${name} is not laid on a creature of the other side: it goes to ${goes}. Leave targetEnemyId out. Nothing was spent.`, retry: true };
  }
  if (args.targetCharacterId && args.targetCharacterId !== holder.id && aim === "self") {
    return { error: `${name} is ${holder.name}'s own: it goes to nobody else. Leave targetCharacterId out. Nothing was spent.`, retry: true };
  }
  return null;
}
