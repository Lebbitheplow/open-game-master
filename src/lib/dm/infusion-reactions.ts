// The reactions an artificer's infused items give whoever wields or wears
// them (src/lib/srd/infusions.ts), each paid with a charge of the item:
//
//   - Radiant Weapon: "As a reaction immediately after being hit by an
//     attack, the wielder can expend 1 charge and cause the attacker to be
//     blinded until the end of the attacker's next turn, unless the attacker
//     succeeds on a Constitution saving throw against your spell save DC."
//     The attacker within 30 feet, the DC the artificer's.
//   - Repulsion Shield: "a reaction immediately after being hit by a melee
//     attack to expend 1 of the shield's charges and push the attacker up to
//     15 feet away."
//   - Armor of Magical Strength: "If the creature would be knocked prone, it
//     can use its reaction to expend 1 charge to avoid being knocked prone":
//     the prone just laid is taken off.
//
// use_reaction reaches these after the SRD feature reactions (reaction-tools.ts);
// a refusal spends nothing.
import { getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { pushStraightAway } from "@/lib/dm/ar-ws-storm-fury";
import { withinFeet } from "@/lib/dm/authored-saves";
import { removeConditions } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { chargedInfusion, spendInfusionCharge } from "@/lib/dm/infusion-charges";
import { attackerFoeId, freshLastHit, writeLastHit, type LastHit } from "@/lib/dm/last-hit";
import { noHit, SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { publishSheet } from "@/lib/dm/combat-features";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { computeSheetDerived } from "@/lib/srd";
import { isNamed } from "@/lib/srd/feature-names";

export function infusionReaction(ctx: Ctx): ToolResult | null {
  if (isNamed(ctx.args.feature, "radiant weapon")) {
    return answerHit(ctx, "Radiant Weapon", false);
  }
  if (isNamed(ctx.args.feature, "repulsion shield")) {
    return answerHit(ctx, "Repulsion Shield", true);
  }
  if (isNamed(ctx.args.feature, "armor of magical strength")) {
    return standFast(ctx);
  }
  return null;
}

const ANSWER_KEY: Record<string, string> = { "Radiant Weapon": "radiant weapon", "Repulsion Shield": "repulsion shield" };

function answerHit(ctx: Ctx, infusion: "Radiant Weapon" | "Repulsion Shield", melee: boolean): ToolResult {
  const { campaign, sheet, encounter } = ctx;
  const key = ANSWER_KEY[infusion];
  const held = chargedInfusion(sheet, infusion);
  if (!held) {
    return { error: `${sheet.name} holds no ${infusion} with a charge left (an artificer's infusion, wielded and attuned). Nothing was spent.`, refused: "rules" };
  }
  const answers = (hit: LastHit) =>
    hit.source === "attack" && attackerFoeId(hit) !== null && Boolean(hit.attacker.id) && !hit.answered.includes(key) && hit.swings.some((swing) => swing.hit && (!melee || !(swing.ranged ?? hit.ranged)));
  const record = freshLastHit(campaign.id, sheet.id, answers);
  if (!record || !answers(record) || !encounter) {
    return noHit(sheet.name, infusion, melee ? "a melee attack that hit them" : "an attack that hit them");
  }
  const enemy = getEnemy(record.attacker.id!);
  if (!enemy || enemy.status !== "alive") {
    return { error: `${record.attacker.name} is no longer standing to answer. Nothing was spent.`, refused: "rules" };
  }
  const out: Record<string, unknown> = {};
  if (infusion === "Radiant Weapon") {
    if (!withinFeet(encounter.id, sheet.id, enemy.id, 30)) {
      return { error: `${enemy.displayName} is beyond 30 feet of ${sheet.name}; the weapon's flash reaches 30 feet. Nothing was spent.`, refused: "rules" };
    }
    // The save is against the artificer's spell save DC, wherever the weapon went.
    const artificer = getSheetById(held.row.infusion!.by) ?? sheet;
    const derived = computeSheetDerived(artificer);
    const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.int;
    const save = rollEnemySave(campaign.id, enemy, "con", dc, { magical: true, resist: true, record: { turn: ctx.turn, detail: `${enemy.displayName}: Constitution save against ${held.row.name}'s flash` } });
    out.save = `${enemy.displayName} rolled ${save.total} against DC ${dc}: ${save.success ? "not blinded" : "blinded until the end of its next turn"}`;
    if (!save.success) {
      const fresh = getEnemy(enemy.id) ?? enemy;
      const kept = fresh.conditions.filter((entry) => textKey(entry) !== "blinded");
      patchEnemyConditions(fresh.id, [...kept, "blinded"], { ...(fresh.conditionMeta ?? {}), blinded: { untilTurnEndOf: fresh.id, source: sheet.id } });
      publishEncounter(campaign.id);
    }
  } else {
    out.pushed = pushStraightAway(campaign, encounter.id, { id: sheet.id, name: sheet.name }, enemy, 15);
  }
  spendInfusionCharge(campaign, sheet.id, held.row, held.left);
  writeLastHit(campaign.id, { ...record, answered: [...record.answered, key] });
  spendReaction(ctx);
  return { ok: true, reaction: infusion, item: held.row.name, chargesLeft: held.left - 1, spent: SPENT(sheet.name), ...out };
}

function standFast(ctx: Ctx): ToolResult {
  const { campaign, sheet } = ctx;
  const held = chargedInfusion(sheet, "Armor of Magical Strength");
  if (!held) {
    return { error: `${sheet.name} wears no Armor of Magical Strength with a charge left (an artificer's infusion, worn and attuned). Nothing was spent.`, refused: "rules" };
  }
  const fresh = getSheetById(sheet.id) ?? sheet;
  if (!fresh.conditions.some((entry) => textKey(entry) === "prone")) {
    return { error: `Armor of Magical Strength keeps ${sheet.name} from being knocked prone, and they are not prone. Nothing was spent.`, refused: "rules" };
  }
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, ["prone"]);
  patchSheet(fresh.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  publishSheet(campaign, fresh.id);
  spendInfusionCharge(campaign, sheet.id, held.row, held.left);
  spendReaction(ctx);
  return { ok: true, reaction: "Armor of Magical Strength", item: held.row.name, chargesLeft: held.left - 1, spent: SPENT(sheet.name), applied: `${sheet.name} keeps their feet: not prone.` };
}
