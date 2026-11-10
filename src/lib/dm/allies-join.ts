// Allies answering a holder's call (SpendDoes "allies_join"): Call the Hunt
// (Path of the Beast 14), "you can choose a number of other willing creatures
// you can see within 30 feet equal to your Constitution modifier (minimum
// one). You gain 5 temporary hit points for each that accepts, and until the
// rage ends each of them can, once on each of its turns, roll a d6 and add it
// to the damage of an attack that hits."
//
// The one named in targetCharacterId is taken first; the rest are the nearest
// the holder can see, up to the count. Before this the use was spent and the
// guidance returned: no temporary hit points, and no ally carried anything.
// The d6 is the condition's once-a-turn rider (attack-damage-riders.ts).

import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { resolveFormula } from "@/lib/srd/authored-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import { whileRaging } from "@/lib/dm/rage-bound";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

type Join = Extract<SpendDoes, { kind: "allies_join" }>;

export function alliesJoin(ctx: SpendContext, does: Join): ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> } {
  const { sheet, campaign } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  const count = Math.max(1, Number(resolveFormula(does.count, ctx.held.level, ctx.mods)) || 1);
  const seen = (ally: CharacterSheet) => (encounter ? unseenBecause(encounter.id, sheet, ally, { hidden: false }) : null);
  const inReach = (ally: CharacterSheet) => !encounter || withinFeet(encounter.id, sheet.id, ally.id, does.rangeFt);
  const named = ctx.args.targetCharacterId && ctx.args.targetCharacterId !== sheet.id ? getSheetById(ctx.args.targetCharacterId) : null;
  if (ctx.args.targetCharacterId && ctx.args.targetCharacterId !== sheet.id && (!named || named.campaignId !== campaign.id)) {
    return { error: `${ctx.spend.name} goes to creatures at the table: pass targetCharacterId of an ally. Nothing was spent.`, retry: true };
  }
  if (named) {
    const unseen = seen(named);
    if (unseen) return { error: `${sheet.name} cannot see ${named.name} (${unseen}), and ${ctx.spend.name} takes creatures they can see. Nothing was spent.`, refused: "rules" };
    if (!inReach(named)) return { error: `${named.name} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const apart = (ally: CharacterSheet) => (encounter ? (tilesBetween(encounter.id, sheet.id, ally.id) ?? 0) : 0);
  const others = listSheets(campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((ally) => ally.id !== sheet.id && ally.id !== named?.id && !ally.deathSaves?.dead && ally.currentHp > 0)
    .filter((ally) => inReach(ally) && !seen(ally) && !swallowCoverBetween(sheet.id, ally.id))
    .sort((a, b) => apart(a) - apart(b));
  const joined = [...(named ? [named] : []), ...others].slice(0, count);
  if (!joined.length) {
    return { error: `${ctx.spend.name} needs a willing creature ${sheet.name} can see within ${does.rangeFt} feet, and there is none. Nothing was spent.`, refused: "rules" };
  }
  for (const ally of joined) {
    const fresh = getSheetById(ally.id) ?? ally;
    const kept = fresh.conditions.filter((entry) => textKey(entry) !== textKey(does.condition));
    const updated = patchSheet(fresh.id, {
      conditions: [...kept, does.condition],
      conditionMeta: { ...fresh.conditionMeta, [does.condition]: { rounds: does.rounds, ...(does.whileRaging ? whileRaging(sheet.id) : { source: sheet.id }) } },
    });
    if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const tempHp = (does.tempHpEach ?? 0) * joined.length;
  const now = getSheetById(sheet.id) ?? sheet;
  return {
    ...(tempHp > now.tempHp ? { patch: { tempHp } } : {}),
    result: {
      applied: [
        `${joined.map((ally) => ally.name).join(", ")}: ${does.condition}${does.whileRaging ? ` until ${sheet.name}'s rage ends` : ""}.`,
        ...(tempHp ? [tempHp > now.tempHp ? `${sheet.name} gains ${tempHp} temporary hit points.` : `${sheet.name} keeps their ${now.tempHp} temporary hit points.`] : []),
      ],
    },
  };
}
