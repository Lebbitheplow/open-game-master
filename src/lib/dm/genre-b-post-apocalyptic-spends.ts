// The waste preacher's sermons that reach allies by distance
// (src/lib/classes/post-apocalyptic-features.json; WAVE2 D5), resolved for
// src/lib/dm/authored-spend-effects.ts (kind "wastes"), each refusing before
// anything is paid:
//
//   Flock's Shepherd  "Bonus action: one ally within 30 ft gains temp HP equal to
//                     your level + WIS mod"; Congregation: "Flock's Shepherd can
//                     target two allies at once"
//   Testify           "an audible sermon gives allies within 30 ft advantage on
//                     their next save against fear or despair"
//
// Rulings where the text meets the tools: use_resource names one character, so
// with Congregation the second ally is the one within 30 feet with the fewest
// temporary hit points, the nearer of two alike. Testify's mark waits an hour
// for the save it answers (the text gives it no end), and a deafened ally hears
// no sermon. Despair is no condition a save names
// (src/lib/dm/roll-about.ts SAVE_AGAINST): the advantage is against fear, read
// by src/lib/dm/genre-b-auras.ts genreBSaveAuras and spent by the save.
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { rollCard } from "@/lib/dm/roll-card";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { resolveFormula } from "@/lib/srd/authored-effects";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { SHEPHERDED, TESTIFIED } from "@/lib/srd/genre-b-post-apocalyptic-conditions";

export type WastesCall = "shepherd" | "testify";

type Result = ToolError | { result: Record<string, unknown> };

function lay(ctx: SpendContext, target: CharacterSheet, condition: string, rounds: number, extra: Parameters<typeof patchSheet>[1] = {}) {
  const fresh = getSheetById(target.id) ?? target;
  const kept = fresh.conditions.filter((entry) => !isConditionNamed(entry, condition));
  const updated = patchSheet(fresh.id, { conditions: [...kept, condition], conditionMeta: { ...fresh.conditionMeta, [condition]: { rounds, source: ctx.sheet.id } }, ...extra });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The holder's allies within `feet`, off a board every one of them.
function alliesWithin(ctx: SpendContext, feet: number): CharacterSheet[] {
  const encounter = getActiveEncounter(ctx.campaign.id);
  return listSheets(ctx.campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((entry) => entry.id !== ctx.sheet.id && !entry.deathSaves?.dead)
    .filter((entry) => !encounter || withinFeet(encounter.id, ctx.sheet.id, entry.id, feet));
}

function shepherd(ctx: SpendContext): Result {
  const { sheet, campaign } = ctx;
  const named = ctx.args.targetCharacterId;
  if (!named || named === sheet.id) {
    return { error: `${ctx.spend.name} goes to an ally of ${sheet.name}, never to ${sheet.name}: pass targetCharacterId of an ally. Nothing was spent.`, retry: true };
  }
  const first = getSheetById(named);
  if (!first || first.campaignId !== campaign.id) {
    return { error: `${ctx.spend.name} goes to a creature at the table: pass targetCharacterId. Nothing was spent.`, retry: true };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && !withinFeet(encounter.id, sheet.id, first.id, 30)) {
    return { error: `${first.name} is beyond 30 feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const amount = Math.max(0, Number(rollCard(campaign, ctx.turn, sheet.id, "custom", `${ctx.spend.name}: temporary hit points`, resolveFormula("level+wis", ctx.held.level, ctx.mods), null).total));
  const flock = [first];
  if (holdsGenreFeature(sheet, "waste_preacher", "Congregation")) {
    const second = alliesWithin(ctx, 30)
      .filter((ally) => ally.id !== first.id && ally.currentHp > 0)
      .sort((a, b) => a.tempHp - b.tempHp)[0];
    if (second) {
      flock.push(second);
    }
  }
  const lines: string[] = [];
  for (const ally of flock) {
    const fresh = getSheetById(ally.id) ?? ally;
    lay(ctx, fresh, SHEPHERDED, 600, amount > fresh.tempHp ? { tempHp: amount } : {});
    lines.push(amount > fresh.tempHp ? `${fresh.name} gains ${amount} temporary hit points.` : `${fresh.name} already holds ${fresh.tempHp} temporary hit points, which do not stack: nothing changes for them.`);
  }
  return { result: { applied: lines } };
}

function testify(ctx: SpendContext): Result {
  const heard = alliesWithin(ctx, 30).filter((ally) => ally.currentHp > 0 && !ally.conditions.some((entry) => isConditionNamed(entry, "deafened")));
  if (!heard.length) {
    return { error: `No ally within 30 feet of ${ctx.sheet.name} can hear the sermon. Nothing was spent.`, refused: "rules" };
  }
  for (const ally of heard) {
    lay(ctx, ally, TESTIFIED, 600);
  }
  return { result: { applied: [`${heard.map((ally) => ally.name).join(", ")}: advantage on their next save against being frightened.`] } };
}

export function wastesSpend(ctx: SpendContext, call: WastesCall): Result {
  return call === "shepherd" ? shepherd(ctx) : testify(ctx);
}
