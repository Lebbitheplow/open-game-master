// The dark fantasy classes' spends whose text no shape of the authored layer
// holds alone (WAVE2 D5): each play composes the layer's own resolvers
// (authored-spend-effects.ts resolveSpendEffect) with what the text adds, so a
// refusal there still spends nothing. The row names its play
// (src/lib/srd/genre-a-dark-fantasy-plays.ts).
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { DarkFantasyPlay } from "@/lib/srd/genre-a-dark-fantasy-plays";
import { BRAND, BRAND_TWIN, SECOND_BRAND } from "@/lib/srd/genre-a-dark-fantasy-conditions";

type Resolution = ReturnType<typeof resolveSpendEffect>;

export function playDarkFantasy(ctx: SpendContext, play: DarkFantasyPlay): Resolution {
  switch (play) {
    case "brand":
      return brand(ctx);
    case "dirge":
      return dirge(ctx);
  }
}

// The creature a brand the holder carries is on, while it still stands.
function brandedFoe(ctx: SpendContext, condition: string): string | null {
  if (!ctx.sheet.conditions.some((entry) => textKey(entry) === textKey(condition))) {
    return null;
  }
  const quarry = (ctx.sheet.conditionMeta as ConditionMetaMap)[condition]?.quarry;
  const foe = quarry ? getEnemy(quarry) : null;
  return foe && foe.status === "alive" && foe.currentHp > 0 ? foe.id : null;
}

// Hunter's Brand: "brand a creature you can see". Twin Brand (11th): "Maintain
// two Hunter's Brands at once; brand damage rises to +1d8": a creature branded
// while the first brand holds another living creature takes the second brand;
// a third moves the second. Before this a second brand moved the first, and an
// invisible creature was branded and the bonus action spent.
function brand(ctx: SpendContext): Resolution {
  const twin = holdsFeature(ctx.sheet, "Twin Brand");
  let condition = twin ? BRAND_TWIN : BRAND;
  const encounter = getActiveEncounter(ctx.campaign.id);
  const target = encounter && ctx.args.targetEnemyId ? resolveTargetFoe(ctx.campaign.id, encounter, ctx.args.targetEnemyId)?.id : null;
  if (twin && target) {
    const first = brandedFoe(ctx, BRAND_TWIN);
    if (first && first !== target) {
      condition = SECOND_BRAND;
    }
  }
  return resolveSpendEffect(ctx, { kind: "buff", condition, rounds: 600, quarry: true, sight: true });
}

// Dirge of Sorrow: "one enemy within 30 ft subtracts 1d4 from its next attack
// roll (WIS save negates)". Dirge of Ruin (13th): "affects up to three enemies
// and the penalty applies to attacks and saves". The Grave Chorus (11th): "your
// dirges affect one additional target" while its voices sing. The enemies are
// the player's to name, as many as the dirge takes and no more; before this
// the dirge was a line of the GM's prompt and no call played it.
function dirge(ctx: SpendContext): Resolution {
  const ruin = holdsFeature(ctx.sheet, "Dirge of Ruin");
  const chorus = ctx.sheet.conditions.some((entry) => isConditionNamed(entry, "the grave chorus"));
  const most = (ruin ? 3 : 1) + (chorus ? 1 : 0);
  const named = ctx.args.targetEnemyIds?.length ? ctx.args.targetEnemyIds : ctx.args.targetEnemyId ? [ctx.args.targetEnemyId] : [];
  if (!named.length) {
    return { error: `${ctx.spend.name} takes ${most === 1 ? "one enemy" : `up to ${most} enemies`} within 30 feet: pass targetEnemyId${most > 1 ? " (or targetEnemyIds)" : ""} from GAME STATE. Nothing was spent.`, retry: true };
  }
  if (named.length > most) {
    return { error: `${ctx.spend.name} takes ${most === 1 ? "one enemy" : `up to ${most} enemies`}, and ${named.length} were named. Nothing was spent.`, refused: "rules" };
  }
  return resolveSpendEffect(ctx, { kind: "save_area", save: "wis", dcAbility: "spell", rangeFt: 30, chosen: true, condition: ruin ? "dirge of ruin" : "dirge of sorrow" });
}
