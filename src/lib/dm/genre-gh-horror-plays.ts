// What the horror counters of the cc1113 genre-c pass do when spent (WAVE2
// D5: the genre text is the rule), plays of the authored spend kind
// "horror_spend" (src/lib/dm/genre-a-horror-spends.ts spreads them into its
// PLAYS). The rows are in src/lib/srd/authored-effects-genre-gh.ts.
//
//   Peer Review (parapsychologist 6): "1/rest, when an ally fails an INT,
//     WIS, or CHA save within 30 ft, let them reroll with your guidance": the
//     ally's last failed save of those abilities is rolled again, and a
//     success lifts what that save would have ended.
//   The Final Chapter (occultist 18): "1/long rest, reroll any one die you or
//     a creature within 60 ft just rolled; the reroll stands": the last save
//     or check of the occultist or an ally in reach is rolled again and the
//     new roll stands, better or worse (an attack roll is the reaction row's,
//     authored-effects-genre-gh.ts).
//   Rite of Severance (exorcist 15): "1/long rest, a 1-minute ritual expels a
//     possessing entity from a host (contested WIS, you have advantage)": the
//     host's possessed condition ends when the exorcist's Wisdom check, with
//     advantage, beats the possessor's.
//   Stitch the Tear (occultist 7): "1/long rest, close a portal, summoning,
//     or breach of CR/level 5 or lower as an action": a summoned creature of
//     CR 5 or lower is sent back; with no creature named, the portal or breach
//     the GM names is closed in the story (a place, not a creature on the board).
//
// A refusal says what is missing and that nothing was spent.
import { getEnemy, patchEnemyHp } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck, rollFeatureSave } from "@/lib/dm/contest-roll";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { ToolError } from "@/lib/dm/tool-errors";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { Ability } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

const refused = (error: string): ToolError => ({ error: `${error} Nothing was spent.`, refused: "rules" });
const ABILITY = /\b(str|dex|con|int|wis|cha)\b/i;

// The ally the call names (targetCharacterId), within `feet` of the holder
// in a fight; off the board any distance is taken at the table's word.
function namedAlly(ctx: SpendContext, feet: number, self: boolean): CharacterSheet | ToolError {
  const id = ctx.args.targetCharacterId ?? (self ? ctx.sheet.id : undefined);
  const ally = id ? getSheetById(id) : null;
  if (!ally || (!self && ally.id === ctx.sheet.id)) {
    return { error: `${ctx.spend.name} answers an ally's roll: pass the ally's targetCharacterId. Nothing was spent.`, retry: true };
  }
  if (ally.id !== ctx.sheet.id && ctx.encounter && !withinFeet(ctx.encounter.id, ctx.sheet.id, ally.id, feet)) {
    return refused(`${ally.name} is beyond ${feet} feet of ${ctx.sheet.name}.`);
  }
  return ally;
}

// The conditions a save that now succeeds would have ended: those whose
// save-ends rule names this ability and DC.
function liftSaveEnds(campaignId: string, sheet: CharacterSheet, ability: string, dc: number): string[] {
  const now = getSheetById(sheet.id) ?? sheet;
  const meta = now.conditionMeta as ConditionMetaMap;
  const lifted = now.conditions.filter((name) => {
    const ends = meta[name]?.saveEnds;
    return ends && ends.ability === ability && ends.dc === dc;
  });
  if (lifted.length) {
    const cleared = removeConditions(now.conditions, now.conditionMeta, lifted);
    const updated = patchSheet(now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return lifted;
}

function rerollSave(ctx: SpendContext, who: CharacterSheet, abilities: readonly string[] | null, stands: boolean): Resolution | null {
  const failed = listRecentRolls(ctx.campaign.id, 60).find(
    (roll) => roll.characterId === who.id && roll.kind === "saving_throw" && roll.dc !== null && (stands || roll.total < roll.dc) && (!abilities || abilities.includes((ABILITY.exec(roll.detail)?.[1] ?? "").toLowerCase())),
  );
  const ability = failed ? ((ABILITY.exec(failed.detail)?.[1] ?? "").toLowerCase() as Ability) : null;
  if (!failed || !ability) {
    return null;
  }
  const dc = failed.dc!;
  const against = /\bvs\.? (.+)$/i.exec(failed.detail)?.[1];
  const save = rollFeatureSave(ctx.campaign, who, ability, dc, `${ctx.spend.name} reroll`, against);
  const before = failed.total >= dc;
  if (!save.success) {
    return { result: { reroll: `${who.name} rolls the ${ability.toUpperCase()} save again: ${save.total ?? "failed"} vs DC ${dc}, a failure${stands && before ? ", and the reroll stands: the GM applies what a failed save brings" : ""}.` } };
  }
  const lifted = liftSaveEnds(ctx.campaign.id, who, ability, dc);
  return { result: { reroll: `${who.name} rolls the ${ability.toUpperCase()} save again: ${save.total} vs DC ${dc}, a success${lifted.length ? `: ${lifted.join(", ")} no longer holds them` : ""}.` } };
}

function peerReview(ctx: SpendContext): Resolution {
  const ally = namedAlly(ctx, 30, false);
  if ("error" in ally) return ally;
  const out = rerollSave(ctx, ally, ["int", "wis", "cha"], false);
  return out ?? refused(`${ally.name} has no failed Intelligence, Wisdom or Charisma save to reroll.`);
}

function finalChapter(ctx: SpendContext): Resolution {
  const who = namedAlly(ctx, 60, true);
  if ("error" in who) return who;
  const save = rerollSave(ctx, who, null, true);
  if (save) return save;
  const check = listRecentRolls(ctx.campaign.id, 60).find((roll) => roll.characterId === who.id && (roll.kind === "skill_check" || roll.kind === "ability_check"));
  if (!check) {
    return refused(`${who.name} has made no save or check this turn to roll again (an attack on them is answered with use_reaction The Final Chapter).`);
  }
  const ability = (ABILITY.exec(check.detail)?.[1] ?? "").toLowerCase() as Ability;
  const again = rollCharacterCheck(ctx.campaign, who, { ...(ability ? { ability } : {}), ...(check.dc !== null ? { dc: check.dc } : {}) }, `${ctx.spend.name} reroll: ${check.detail}`);
  return { result: { reroll: `${who.name}'s ${check.detail} is rolled again: ${again.total}${check.dc !== null ? ` vs DC ${check.dc}, ${again.total >= check.dc ? "a success" : "a failure"}` : ""}. The reroll stands.` } };
}

function riteOfSeverance(ctx: SpendContext): Resolution {
  const host = namedAlly(ctx, 30, false);
  if ("error" in host) return host;
  const held = host.conditions.filter((entry) => isConditionNamed(entry, "possessed"));
  if (!held.length) {
    return refused(`${host.name} is possessed by nothing for the Rite of Severance to expel.`);
  }
  const meta = host.conditionMeta as ConditionMetaMap;
  const sourceId = held.map((entry) => (meta?.[entry] as { source?: string } | undefined)?.source).find(Boolean);
  const possessor = sourceId ? getEnemy(sourceId) : null;
  const mine = rollCharacterCheck(ctx.campaign, ctx.sheet, { ability: "wis", advantage: "advantage" }, "Rite of Severance: Wisdom, with advantage");
  const wis = Math.floor((((possessor?.stats as { wis?: number } | undefined)?.wis ?? 10) - 10) / 2);
  const theirs = rollExpression(`1d20${wis >= 0 ? "+" : ""}${wis}`).total;
  const name = possessor?.displayName ?? "the possessing entity";
  if (mine.total <= theirs) {
    return { result: { contest: `Rite of Severance: ${ctx.sheet.name}'s Wisdom ${mine.total} against ${name}'s ${theirs}; it keeps its hold on ${host.name}.` } };
  }
  const cleared = removeConditions(host.conditions, meta, held);
  const updated = patchSheet(host.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  return { result: { contest: `Rite of Severance: ${ctx.sheet.name}'s Wisdom ${mine.total} against ${name}'s ${theirs}; ${name} is expelled from ${host.name}.` } };
}

function stitchTheTear(ctx: SpendContext): Resolution {
  if (!ctx.args.targetEnemyId) {
    // A portal or a breach is a place, not a creature on the board.
    return { result: { applied: `${ctx.sheet.name} stitches shut the portal or breach the GM names, if its CR or level is 5 or lower (a summoned creature is named with targetEnemyId).` } };
  }
  const enemy = getEnemy(ctx.args.targetEnemyId);
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name}: no living creature ${ctx.args.targetEnemyId} stands in the fight. Nothing was spent.`, retry: true };
  }
  if (!enemy.conditions.some((entry) => isConditionNamed(entry, "summoned"))) {
    return refused(`${enemy.displayName} was not summoned (no "summoned" condition), so there is no tear to stitch.`);
  }
  if ((enemy.cr ?? 0) > 5) {
    return refused(`${enemy.displayName} is CR ${enemy.cr}, and Stitch the Tear closes a summoning of CR 5 or lower.`);
  }
  patchEnemyHp(enemy.id, 0, "dead");
  publishEncounter(ctx.campaign.id);
  return { result: { applied: `${enemy.displayName} is pulled back through the stitched tear and is gone.` } };
}

export const GH_HORROR_PLAYS: Record<string, (ctx: SpendContext) => Resolution> = {
  peer_review: peerReview,
  final_chapter: finalChapter,
  rite_of_severance: riteOfSeverance,
  stitch_the_tear: stitchTheTear,
};
