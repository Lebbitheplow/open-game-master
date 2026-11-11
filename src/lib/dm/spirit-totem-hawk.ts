// The Hawk spirit's reaction (Circle of the Shepherd, Spirit Totem): "when a
// creature makes an attack roll against a target in the aura, a reaction
// gives it advantage".
//
// The engine has no pause before an attack roll, so the druid's reaction is
// taken as the attack is declared (use_reaction "Spirit Totem", the attacker
// as targetCharacterId and the creature attacked as targetEnemyId): it lays a
// mark on the attacker that their next attack roll against that creature
// reads and spends (authored-hooks.ts, as Entropic Ward's edge is read), gone
// at the end of the attacker's turn if no attack is made. Before this
// use_reaction took the druid's reaction and the attack rolled one d20.
// The druid's Hand deals it as a card while the hawk stands
// (src/lib/battlemap/hand-react.ts), naming the creature attacked: with no
// attacker named it is the hero whose turn it is.

import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { HAWK_EDGE } from "@/lib/dm/reaction-kinds";
import { allyOf, SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { inSpiritAura, spiritOf, TOTEM_SPELL } from "@/lib/dm/spirit-totem";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

const NAME = "Spirit Totem (Hawk)";

// Null unless the call names the totem's reaction and the reactor holds Spirit Totem.
export function hawkReaction(ctx: Ctx): ToolResult | null {
  if (!isNamed(ctx.args.feature, TOTEM_SPELL, "Hawk Spirit", "Spirit Totem: Hawk", NAME) || !holdsFeature(ctx.sheet, TOTEM_SPELL)) {
    return null;
  }
  const { sheet, encounter } = ctx;
  const spirit = spiritOf(getSheetById(sheet.id) ?? sheet);
  if (spirit !== "hawk") {
    return {
      error: spirit
        ? `Only the Hawk spirit gives a reaction, and ${sheet.name}'s totem is the ${spirit}. Nothing was spent.`
        : `${sheet.name} has no Spirit Totem out: use_resource "Spirit Totem" with variant "hawk" calls it. Nothing was spent.`,
      refused: "rules",
    };
  }
  // The attacker the call names, else the hero whose turn it is (the Hand's
  // card names only the creature attacked), else the druid.
  const attacker = allyOf(ctx) ?? ctx.sheets.find((entry) => ownTurnOf(encounter, entry.id)) ?? sheet;
  const target = encounter && ctx.args.targetEnemyId ? resolveTargetFoe(encounter.campaignId, encounter, ctx.args.targetEnemyId) : null;
  if (!encounter || !target || target.status !== "alive") {
    return { error: `${NAME} gives advantage to an attack roll against a creature in the aura: pass that creature as targetEnemyId, and the attacker as targetCharacterId. Nothing was spent.`, retry: true };
  }
  if (!inSpiritAura(ctx.campaign.id, sheet, target.id)) {
    return { error: `${target.displayName} is outside the Hawk spirit's 30-foot aura. Nothing was spent.`, refused: "rules" };
  }
  const now = getSheetById(attacker.id) ?? attacker;
  const kept = now.conditions.filter((entry) => textKey(entry) !== HAWK_EDGE);
  const updated = patchSheet(now.id, {
    conditions: [...kept, HAWK_EDGE],
    conditionMeta: { ...now.conditionMeta, [HAWK_EDGE]: { quarry: target.id, untilTurnEndOf: now.id, source: sheet.id } },
  });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  spendReaction(ctx);
  return {
    ok: true,
    reaction: NAME,
    spent: SPENT(sheet.name),
    applied: `${now.name}'s attack roll against ${target.displayName} has advantage: make the attack now (it is spent by that roll, and gone at the end of ${now.name}'s turn).`,
  };
}
