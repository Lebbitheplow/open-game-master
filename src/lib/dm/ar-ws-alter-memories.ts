// Alter Memories (School of Enchantment 14): "A charmed creature forgets it
// was charmed, and you can strip up to your Charisma modifier plus one hour
// of memory on a failed save." The row was narrated ("the GM rolls its save
// and narrates what it loses"): an Intelligence save against the wizard's
// spell save DC, and a number of hours, with nothing rolling the one or
// holding the other.
//
// use_resource "Alter Memories" as an action. In a fight the creature named
// must be charmed (by this wizard, where the charm says whose it is); it
// rolls an Intelligence save against the spell save DC, and on a failure
// carries "memory stripped (N hours)", N the hours asked for in `amount`, at
// most the Charisma modifier plus one and at least one. A creature this
// wizard already stripped is refused: the feature it condenses allows it once
// before the charm ends. Out of a fight no creature has a block to roll, so
// the spend answers with the DC and the hours for the GM's roll.
//
// Called by authored-spend-effects.ts resolveSpendEffect (kind strip_memory).

import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";

type Does = Extract<SpendDoes, { kind: "strip_memory" }>;
type Resolution = ToolError | { result: Record<string, unknown> };

// The hours the call strips: what it asks for, up to the ability modifier
// plus one (at least one).
function hoursAsked(ctx: SpendContext, does: Does): number | ToolError {
  const most = Math.max(1, (ctx.mods[does.hoursAbility] ?? 0) + 1);
  const asked = ctx.args.amount === undefined ? most : Math.floor(ctx.args.amount);
  if (asked < 1 || asked > most) {
    return { error: `${ctx.spend.name} strips up to ${most} hour${most === 1 ? "" : "s"} of memory (${does.hoursAbility.toUpperCase()} modifier plus one): pass amount from 1 to ${most}, or none for all ${most}. Nothing was spent.`, retry: true };
  }
  return asked;
}

// The conditions of this name a creature holds, with whatever follows the
// name ("memory stripped (5 hours)").
const named = (conditions: string[], name: string) => conditions.filter((entry) => isConditionNamed(entry, name));

// Out of a fight: the numbers, for the GM's roll of a creature with no block.
export function memoryOffBoard(ctx: SpendContext, does: Does, dc: number): Resolution {
  const hours = hoursAsked(ctx, does);
  if (typeof hours !== "number") {
    return hours;
  }
  return {
    result: {
      dc,
      hours,
      applied: `${ctx.sheet.name} reaches into a charmed creature's memory: it makes an ${does.save.toUpperCase()} save against DC ${dc} (the GM rolls it; no creature of a fight is named). On a failure it loses up to ${hours} hour${hours === 1 ? "" : "s"} of what it remembers of the time it was charmed.`,
    },
  };
}

export function stripMemory(ctx: SpendContext, does: Does, stale: EncounterEnemy, dc: number): Resolution {
  const enemy = getEnemy(stale.id) ?? stale;
  const hours = hoursAsked(ctx, does);
  if (typeof hours !== "number") {
    return hours;
  }
  const marks = enemy.conditionMeta as ConditionMetaMap;
  const charms = named(enemy.conditions, "charmed").flatMap((entry) => instancesOf(marks[entry]));
  const charmed = named(enemy.conditions, "charmed").length > 0;
  const sourced = charms.filter((entry) => entry.source);
  if (!charmed || (sourced.length > 0 && !sourced.some((entry) => entry.source === ctx.sheet.id))) {
    return { error: `${enemy.displayName} is not charmed by ${ctx.sheet.name}; ${ctx.spend.name} reaches the memory of a creature they have charmed. Nothing was spent.`, refused: "rules" };
  }
  if (named(enemy.conditions, does.condition).some((entry) => instancesOf(marks[entry]).some((instance) => instance.source === ctx.sheet.id))) {
    return { error: `${ctx.sheet.name} has already reached into ${enemy.displayName}'s memory under this charm. Nothing was spent.`, refused: "rules" };
  }
  const save = rollEnemySave(ctx.campaign.id, enemy, does.save, dc, {
    magical: true,
    origin: { ref: ctx.sheet.id },
    record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${does.save.toUpperCase()} save against ${ctx.spend.name}` },
  });
  const result: Record<string, unknown> = { target: enemy.displayName, save: save.total, dc, saved: save.success };
  if (save.success) {
    result.applied = `${enemy.displayName} keeps its memory (${does.save.toUpperCase()} ${save.total} vs DC ${dc}).`;
    return { result };
  }
  layEnemyConditionInstance(ctx.campaign, getEnemy(enemy.id) ?? enemy, `${does.condition} (${hours} hour${hours === 1 ? "" : "s"})`, { source: ctx.sheet.id });
  result.hours = hours;
  result.applied = `${enemy.displayName} fails (${does.save.toUpperCase()} ${save.total} vs DC ${dc}) and loses ${hours} hour${hours === 1 ? "" : "s"} of what it remembers of the time it was charmed.`;
  return { result };
}
