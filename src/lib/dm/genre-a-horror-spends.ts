// What the horror classes' counters do when they are spent (WAVE2 D5: the
// genre text is the rule; WAVE1 R11: a counter whose text states a number, a
// condition, a save or a refusal is built). One door: the authored spend kind
// "horror_spend" (src/lib/dm/authored-spend-effects.ts resolveSpendEffect)
// names a play below, so the three genre branches never grow the same switch.
// The rows are in src/lib/srd/authored-effects-genre-a-horror.ts.
//
// A refusal says what is missing and that nothing was spent: the spend engine
// pays the pool only for a play that returns a result.
import { getActiveEncounter, getEnemy, patchEnemyConditions, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { withinFeet } from "@/lib/dm/authored-saves";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { foesOfSheet } from "@/lib/dm/sheet-foe";
import type { ToolError } from "@/lib/dm/tool-errors";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { horrorHolds } from "@/lib/srd/genre-a-horror-holds";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

const refused = (error: string): ToolError => ({ error: `${error} Nothing was spent.`, refused: "rules" });

const RITE = "horror_rite_of_repulsion";
const RITE_TYPES = ["fiend", "undead"];
const BINDING = "binding words";
type AreaDoes = Extract<SpendDoes, { kind: "save_area" }>;

const turnedIds = (foes: EncounterEnemy[]) =>
  new Set(foes.map((enemy) => getEnemy(enemy.id) ?? enemy).filter((enemy) => enemy.conditions.some((entry) => isConditionNamed(entry, "turned"))).map((enemy) => enemy.id));

// Rite of Repulsion (exorcist 1): "fiends, undead, and spirits within 30 ft
// save (WIS) or must move away from you for 1 minute", Turn Undead's turned,
// a save_area row (authored-effects-genre-a-capstones.ts). What the later
// features add to it is laid over that row here, called by the save_area
// case of resolveSpendEffect with the area's own resolver:
//   Binding Words (9): "1/long rest, a spirit or fiend that fails against
//     your Rite of Repulsion is also restrained for 1 minute": the words are
//     readied first (the spend lays their mark for a minute), and the next
//     rite restrains the first creature it takes hold of and clears the mark;
//   Voice of Authority (10): "Your Rite of Repulsion affects creatures immune
//     to being frightened": so until then it does not, and such a creature
//     is left out of the rite (with only such creatures in reach, nothing is
//     spent);
//   Greater Rite (11): "affected creatures take 2d8 radiant when it takes
//     hold": the damage of a failed save, one roll shared.
export function horrorSaveArea(ctx: SpendContext, does: AreaDoes, run: (ctx: SpendContext, does: AreaDoes) => Resolution): Resolution {
  if (ctx.spend.pool?.id !== RITE) {
    return run(ctx, does);
  }
  const { campaign, sheet } = ctx;
  const rite: AreaDoes = horrorHolds(sheet, "Greater Rite") ? { ...does, dice: "2d8", type: "radiant" } : does;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return run(ctx, rite);
  }
  const inReach = foesOfSheet(campaign.id, encounter, sheet.id).filter(
    (enemy) => enemy.status === "alive" && enemy.currentHp > 0 && withinFeet(encounter.id, sheet.id, enemy.id, rite.rangeFt) && RITE_TYPES.includes(creatureTypeOf(enemy.stats)),
  );
  const moved = horrorHolds(sheet, "Voice of Authority") ? inReach : inReach.filter((enemy) => !immuneToCondition(enemy, "frightened"));
  if (inReach.length && !moved.length) {
    return refused(`Every fiend and undead within 30 feet of ${sheet.name} is immune to being frightened, and the rite does not move such a creature before Voice of Authority (exorcist 10).`);
  }
  const before = turnedIds(moved);
  const out =
    moved.length === inReach.length
      ? run(ctx, rite)
      : run({ ...ctx, args: { ...ctx.args, targetEnemyIds: moved.map((enemy) => enemy.id) } }, { ...rite, chosen: true });
  if ("error" in out) {
    return out;
  }
  const extra: Record<string, unknown> = {};
  if (moved.length < inReach.length) {
    extra.unmoved = `${inReach.filter((enemy) => !moved.includes(enemy)).map((enemy) => enemy.displayName).join(", ")}: immune to being frightened, so the rite does not take hold.`;
  }
  let patch = out.patch;
  if (sheet.conditions.some((entry) => isConditionNamed(entry, BINDING))) {
    const after = turnedIds(moved);
    const taken = moved.map((enemy) => getEnemy(enemy.id) ?? enemy).find((enemy) => after.has(enemy.id) && !before.has(enemy.id) && !immuneToCondition(enemy, "restrained"));
    if (taken) {
      layEnemyConditionInstance(campaign, taken, "restrained", { source: sheet.id, rounds: 10 });
      publishEncounter(campaign.id);
      const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, sheet.conditions.filter((entry) => isConditionNamed(entry, BINDING)));
      patch = { ...(patch ?? {}), conditions: cleared.conditions, conditionMeta: cleared.meta };
      extra.bindingWords = `${taken.displayName} is also restrained for a minute (Binding Words).`;
    }
  }
  return { ...out, ...(patch ? { patch } : {}), result: { ...out.result, ...extra } };
}

// Terminal Focus (survivor 18): "1/long rest, take two full turns in the
// first round of combat". The second turn follows the first: spent on the
// survivor's own turn in round 1, it gives the turn's action, bonus action,
// movement and reaction back.
function terminalFocus(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter || encounter.round > 1 || !ctx.marks) {
    return refused(`Terminal Focus is a second turn in the first round of combat, taken on ${ctx.sheet.name}'s own turn.`);
  }
  saveEncounter({ ...encounter, turnBudget: null, reactionsUsed: encounter.reactionsUsed.filter((id) => id !== ctx.sheet.id) });
  publishEncounter(ctx.campaign.id);
  // The mark of the second turn, gone as it ends.
  const mark = "terminal focus";
  return {
    patch: { conditions: [...ctx.sheet.conditions.filter((entry) => !isConditionNamed(entry, mark)), mark], conditionMeta: { ...ctx.sheet.conditionMeta, [mark]: { untilTurnEndOf: ctx.sheet.id } } },
    result: { applied: [`${ctx.sheet.name} takes a second full turn now: their action, bonus action, movement and reaction are fresh.`] },
  };
}

const UNSEEN = ["invisible", "hidden", "ethereal"];

// Observer Effect (parapsychologist 18): "force an invisible, ethereal, or
// shapechanged creature within 60 ft into its true visible form for 1 minute
// (CHA save negates)". A failed save ends its invisibility and leaves it
// observed for the minute (the GM returns a shapechanger to its true form).
function observerEffect(ctx: SpendContext): Resolution {
  const out = resolveSpendEffect(ctx, {
    kind: "save_effect",
    save: "cha",
    dcAbility: "spell",
    rangeFt: 60,
    condition: "observed",
    rounds: 10,
    onFail: "is forced into its true visible form for a minute",
  });
  const enemy = ctx.args.targetEnemyId ? getEnemy(ctx.args.targetEnemyId) : null;
  if ("error" in out || !enemy || !enemy.conditions.some((entry) => isConditionNamed(entry, "observed"))) {
    return out;
  }
  const hiding = enemy.conditions.filter((entry) => UNSEEN.some((name) => isConditionNamed(entry, name)));
  if (hiding.length) {
    const cleared = removeConditions(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, hiding);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta as typeof enemy.conditionMeta);
    publishEncounter(ctx.campaign.id);
  }
  return { ...out, result: { ...out.result, revealed: `${enemy.displayName} is no longer ${hiding.join(" or ") || "hidden from sight"}.` } };
}

const PLAYS: Record<string, (ctx: SpendContext) => Resolution> = {
  terminal_focus: terminalFocus,
  observer_effect: observerEffect,
};

export function horrorSpend(ctx: SpendContext, play: string): Resolution {
  const run = PLAYS[play];
  return run ? run(ctx) : { error: `No horror play called "${play}".`, retry: true };
}
