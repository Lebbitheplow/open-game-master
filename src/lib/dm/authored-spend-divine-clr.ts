// The cleric spends the divine clause ledger's second wave built
// (src/lib/srd/authored-effects-w2-divine-clr.ts rows), resolved from
// src/lib/dm/authored-spend-effects.ts resolveSpendEffect like every authored
// spend: a refusal returns before anything is paid.
import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { swallowCoverBetween, swallowCoverError } from "@/lib/dm/swallow";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature, isConditionNamed, isNamed, nameChoice } from "@/lib/srd/feature-names";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { withinFeet } from "@/lib/dm/authored-saves";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { READING_THOUGHTS, READ_THOUGHTS } from "@/lib/dm/read-thoughts";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };
type ClericDoes = Extract<SpendDoes, { kind: "read_thoughts" | "duplicity" | "forge_item" | "sense_undead" }>;

// Every kind this module resolves comes through here, so the shared resolver
// carries one case per kind and no rules of its own.
export function clericSpend(ctx: SpendContext, does: ClericDoes): Resolution {
  switch (does.kind) {
    case "read_thoughts":
      return readThoughts(ctx, does.rangeFt);
    case "duplicity":
      return duplicity(ctx, does);
    case "forge_item":
      return forgeItem(ctx);
    case "sense_undead":
      return senseUndead(ctx, does.rangeFt);
  }
}

function withCondition(ctx: SpendContext, name: string, meta: Record<string, unknown>): FullPatchSheetInput {
  const { sheet } = ctx;
  const kept = sheet.conditions.filter((entry) => !isConditionNamed(entry, name));
  return {
    conditions: [...kept, name],
    conditionMeta: { ...sheet.conditionMeta, [name]: meta } as FullPatchSheetInput["conditionMeta"],
  };
}

// Read Thoughts: "Read a creature's surface thoughts for a minute and cast
// suggestion on it without a slot." A creature within 60 feet makes a Wisdom
// save against the spell save DC; one that fails is read for a minute
// (src/lib/dm/read-thoughts.ts). Before this the use was spent and the
// generic guidance returned: nothing was read, and Suggestion cost a slot.
function readThoughts(ctx: SpendContext, rangeFt: number): Resolution {
  const { campaign, sheet } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { result: { applied: `${ctx.spend.name}: the creature the story names makes a Wisdom save against DC ${computeSheetDerived(sheet).spellSaveDc ?? "the spell save DC"}; there is no fight, so the GM rolls it.` } };
  }
  const ref = ctx.args.targetEnemyId?.trim();
  const enemy = ref ? resolveTargetFoe(campaign.id, encounter, ref) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} reads one creature: pass targetEnemyId of a living creature from GAME STATE. Nothing was spent.`, retry: true };
  }
  const walled = swallowCoverError(sheet.id, enemy.id);
  if (walled) {
    return walled;
  }
  if (!withinFeet(encounter.id, sheet.id, enemy.id, rangeFt)) {
    return { error: `${enemy.displayName} is beyond ${rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const derived = computeSheetDerived(sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.wis;
  const save = rollEnemySave(campaign.id, enemy, "wis", dc, {
    magical: true,
    record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: WIS save against ${ctx.spend.name}` },
  });
  if (save.success) {
    return { result: { target: enemy.displayName, save: save.total, dc, saved: true, applied: `${enemy.displayName}'s thoughts stay closed to ${sheet.name}.` } };
  }
  const fresh = getEnemy(enemy.id) ?? enemy;
  const kept = fresh.conditions.filter((entry) => !isConditionNamed(entry, READ_THOUGHTS));
  patchEnemyConditions(fresh.id, [...kept, READ_THOUGHTS], {
    ...(fresh.conditionMeta as ConditionMetaMap),
    [READ_THOUGHTS]: { rounds: 10, source: sheet.id },
  } as typeof fresh.conditionMeta);
  publishEncounter(campaign.id);
  return {
    patch: withCondition(ctx, READING_THOUGHTS, { rounds: 10, quarry: enemy.id }),
    result: {
      target: enemy.displayName,
      save: save.total,
      dc,
      saved: false,
      applied: `${sheet.name} reads ${enemy.displayName}'s surface thoughts for a minute. Their next Suggestion at it (cast_at_enemy) costs no slot, and it fails the save.`,
    },
  };
}

// Invoke Duplicity: "Create an illusory double for a minute that you can
// move, cast spells through, and use to gain attack advantage". The double
// stands on the cleric's condition (its meta's count: four with Improved
// Duplicity, 17th level); the advantage is read by authored-hooks.ts.
function duplicity(ctx: SpendContext, does: Extract<SpendDoes, { kind: "duplicity" }>): Resolution {
  const count = holdsFeature(ctx.sheet, "Improved Duplicity") ? 4 : 1;
  return {
    patch: withCondition(ctx, does.condition, { rounds: does.rounds, count }),
    result: {
      applied: `${count === 1 ? "An illusory double" : `${count} illusory duplicates`} of ${ctx.sheet.name} for a minute: each moves 30 feet as a bonus action, spells can be cast as though from its space, and attacks on a creature beside it have advantage.`,
    },
  };
}

// Artisan's Blessing: "An hour of ritual smithing creates a simple metal item
// worth up to 100 gp". The item is the one the call names: the choice in the
// variant ("Channel Divinity: Artisan's Blessing" with variant "a shield"),
// else the reason. Before this the use was spent and nothing was made.
function forgeItem(ctx: SpendContext): Resolution {
  const variant = ctx.args.variant?.trim() ?? "";
  const named = variant && !isNamed(variant, ctx.spend.name) && !isNamed(nameChoice(variant) ?? "", ctx.spend.name) ? variant : ctx.reason.trim();
  // As the player named it: no English article is cut off a table's words.
  const bare = named.trim().slice(0, 80);
  // Unnamed, the item is made all the same and named for what it is; the
  // player renames it on the sheet.
  const item = bare ? bare[0].toUpperCase() + bare.slice(1) : "Simple metal item (up to 100 gp)";
  return {
    patch: { equipment: [...(ctx.sheet.equipment ?? []), { name: item, qty: 1 }] as FullPatchSheetInput["equipment"] },
    result: { made: `${item}, after an hour of ritual smithing, joins ${ctx.sheet.name}'s gear. It is simple, of metal, and worth no more than 100 gp.` },
  };
}

// Eyes of the Grave: "Detect undead within 60 feet". Each undead in reach and
// not behind total cover is found: its hiding from the party ends. Before this
// the use was spent and an undead hidden 50 feet away stayed hidden.
function senseUndead(ctx: SpendContext, rangeFt: number): Resolution {
  const { campaign, sheet } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return {
      patch: withCondition(ctx, "eyes of the grave", { rounds: 1 }),
      result: { applied: `${sheet.name} knows where every undead within ${rangeFt} feet is, but not what it is; there is no fight on the board, so the GM names them.` },
    };
  }
  const found: string[] = [];
  for (const enemy of foesOfSheet(campaign.id, encounter, sheet.id)) {
    const covered = (tilesBetween(encounter.id, sheet.id, enemy.id) ?? 0) > 1 && wallBetween(encounter.id, sheet.id, enemy.id);
    if (enemy.status !== "alive" || creatureTypeOf(enemy.stats) !== "undead" || !withinFeet(encounter.id, sheet.id, enemy.id, rangeFt) || covered || swallowCoverBetween(sheet.id, enemy.id)) {
      continue;
    }
    const hidden = enemy.conditions.filter((entry) => isConditionNamed(entry, "hidden"));
    if (hidden.length) {
      const cleared = removeConditions(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, hidden);
      patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta as typeof enemy.conditionMeta);
    }
    found.push(`${enemy.displayName}${hidden.length ? " (no longer hidden)" : ""}`);
  }
  if (found.length) {
    publishEncounter(campaign.id);
  }
  // The sense lasts "until the end of your next turn" (the published
  // feature): the cleric carries it that long.
  return {
    patch: withCondition(ctx, "eyes of the grave", { untilTurnEndOf: sheet.id }),
    result: { undead: found.length ? found : `no undead within ${rangeFt} feet of ${sheet.name}` },
  };
}
