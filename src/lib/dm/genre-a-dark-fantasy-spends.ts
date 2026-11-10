// The dark fantasy classes' spends whose text no shape of the authored layer
// holds alone (WAVE2 D5): each play composes the layer's own resolvers
// (authored-spend-effects.ts resolveSpendEffect) with what the text adds, so a
// refusal there still spends nothing. The row names its play
// (src/lib/srd/genre-a-dark-fantasy-plays.ts).
import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { DarkFantasyPlay } from "@/lib/srd/genre-a-dark-fantasy-plays";
import { BRAND, BRAND_CONDITIONS, BRAND_TWIN, JUDGMENT_SHOT, LANCED, PURGING_FLAME, SECOND_BRAND } from "@/lib/srd/genre-a-dark-fantasy-conditions";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import { withinFeet } from "@/lib/dm/authored-saves";
import { foesOfSheet } from "@/lib/dm/sheet-foe";
import { publishEncounter } from "@/lib/dm/enemy-damage";

type Resolution = ReturnType<typeof resolveSpendEffect>;

export function playDarkFantasy(ctx: SpendContext, play: DarkFantasyPlay): Resolution {
  switch (play) {
    case "brand":
      return brand(ctx);
    case "dirge":
      return dirge(ctx);
    case "purging_flame":
      return onBrand(ctx, PURGING_FLAME, { rounds: 10 });
    case "judgment_shot":
      return onBrand(ctx, JUDGMENT_SHOT, { rounds: 1, untilNextTurnEnds: true });
    case "lance":
      return lance(ctx);
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

// The living creatures the holder's brands are on: the one named first when
// it is branded, else the first brand's.
function brandQuarry(ctx: SpendContext): string | null {
  const held = BRAND_CONDITIONS.map((name) => brandedFoe(ctx, name)).filter((id): id is string => Boolean(id));
  const encounter = getActiveEncounter(ctx.campaign.id);
  const named = encounter && ctx.args.targetEnemyId ? resolveTargetFoe(ctx.campaign.id, encounter, ctx.args.targetEnemyId)?.id : null;
  return named && held.includes(named) ? named : (held[0] ?? null);
}

// Purging Flame ("your Hunter's Brand target takes 2d10 radiant when you hit
// it (declared before the roll)") and Judgment Shot ("a ranged attack against
// your brand becomes an automatic critical if it hits"): a mark on the
// branded creature the next hit or ranged attack on it spends. With no living
// brand it is refused and nothing is spent; before this each spent its use for
// a line of guidance.
function onBrand(ctx: SpendContext, condition: string, lasts: { rounds: number; untilNextTurnEnds?: boolean }): Resolution {
  const quarry = brandQuarry(ctx);
  if (!quarry) {
    return { error: `${ctx.spend.name} rides the Hunter's Brand, and ${ctx.sheet.name} has no brand on a living creature: brand one first (use_resource "Hunter's Brand"). Nothing was spent.`, refused: "rules" };
  }
  return resolveSpendEffect({ ...ctx, args: { ...ctx.args, targetEnemyId: quarry } }, { kind: "buff", condition, quarry: true, ...lasts });
}

// Lance the Wound: "a melee hit also deals 2d8 necrotic and the target cannot
// regain HP until your next turn". Virulent Strain (11th): "damage rises to
// 4d8 and spreads: one creature adjacent to the target takes half" (the second
// creature of targetEnemyIds, else the first foe beside the target). The hit
// is this turn's weapon hit on the creature named, in reach of a melee blow.
function lance(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const ref = ctx.args.targetEnemyIds?.[0] ?? ctx.args.targetEnemyId;
  const target = encounter && ref ? resolveTargetFoe(ctx.campaign.id, encounter, ref) : null;
  if (!encounter || !target || target.status !== "alive") {
    return { error: `${ctx.spend.name} lands on the creature the melee hit struck: pass targetEnemyId from GAME STATE. Nothing was spent.`, retry: true };
  }
  if (ctx.marks && !ctx.marks.includes(`${WEAPON_HIT}${target.id}`)) {
    return { error: `${ctx.spend.name} rides a melee hit, and ${ctx.sheet.name} has not hit ${target.displayName} this turn. Nothing was spent.`, refused: "rules" };
  }
  if (!withinFeet(encounter.id, ctx.sheet.id, target.id, 10)) {
    return { error: `${ctx.spend.name} rides a melee hit, and ${target.displayName} is beyond a melee weapon's reach. Nothing was spent.`, refused: "rules" };
  }
  const virulent = holdsFeature(ctx.sheet, "Virulent Strain");
  // The creature the strain spreads to, asked before anything lands.
  const besideRef = virulent ? ctx.args.targetEnemyIds?.[1] : undefined;
  const beside = !virulent
    ? null
    : besideRef
      ? resolveTargetFoe(ctx.campaign.id, encounter, besideRef)
      : (foesOfSheet(ctx.campaign.id, encounter, ctx.sheet.id).find((foe) => foe.id !== target.id && foe.status === "alive" && foe.currentHp > 0 && withinFeet(encounter.id, target.id, foe.id, 5)) ?? null);
  if (beside && (beside.id === target.id || !withinFeet(encounter.id, target.id, beside.id, 5))) {
    return { error: `${beside.displayName} is not beside ${target.displayName}; Virulent Strain spreads only to a creature adjacent to it. Nothing was spent.`, retry: true };
  }
  const struck = resolveSpendEffect({ ...ctx, args: { ...ctx.args, targetEnemyId: target.id } }, { kind: "die_damage", dice: virulent ? "4d8" : "2d8", type: "necrotic" });
  if ("error" in struck) {
    return struck;
  }
  const lines: string[] = [];
  const now = getEnemy(target.id);
  if (now && now.status === "alive") {
    const kept = now.conditions.filter((entry) => textKey(entry) !== LANCED);
    patchEnemyConditions(now.id, [...kept, LANCED], { ...(now.conditionMeta as ConditionMetaMap), [LANCED]: { source: ctx.sheet.id, untilTurnOf: ctx.sheet.id } } as typeof now.conditionMeta);
    publishEncounter(ctx.campaign.id);
    lines.push(`${now.displayName} cannot regain hit points until ${ctx.sheet.name}'s next turn.`);
  }
  const half = Math.floor(Number(struck.result.damage ?? 0) / 2);
  if (beside && half > 0) {
    const spread = resolveSpendEffect({ ...ctx, args: { ...ctx.args, targetEnemyId: beside.id } }, { kind: "die_damage", dice: String(half), type: "necrotic" });
    if (!("error" in spread)) {
      lines.push(`Virulent Strain: ${beside.displayName} beside it takes ${half} necrotic.`);
    }
  }
  return { ...struck, result: { ...struck.result, applied: lines } };
}
