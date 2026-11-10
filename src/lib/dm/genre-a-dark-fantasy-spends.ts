// The dark fantasy classes' spends whose text no shape of the authored layer
// holds alone (WAVE2 D5): each play composes the layer's own resolvers
// (authored-spend-effects.ts resolveSpendEffect) with what the text adds, so a
// refusal there still spends nothing. The row names its play
// (src/lib/srd/genre-a-dark-fantasy-plays.ts).
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { DarkFantasyPlay } from "@/lib/srd/genre-a-dark-fantasy-plays";
import { BRAND, BRAND_TWIN, SECOND_BRAND } from "@/lib/srd/genre-a-dark-fantasy-conditions";

type Resolution = ReturnType<typeof resolveSpendEffect>;

export function playDarkFantasy(ctx: SpendContext, play: DarkFantasyPlay): Resolution {
  switch (play) {
    case "brand":
      return brand(ctx);
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
