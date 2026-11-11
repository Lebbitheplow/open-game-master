// An artificer's Magical Tinkering at the table (ODM's class; the feature's
// text is its gloss in src/lib/help/srd-features.json): "You imbue Tiny
// objects with a small magical property: light, a recorded message, a smell,
// or a picture. You can have as many as your Intelligence modifier."
//
// use_resource "Magical Tinkering" (src/lib/dm/srd-feature-spends.ts) imbues
// one more object with the action and counts it on the artificer, as the
// condition "tinkered objects (N)"; past the Intelligence modifier (one at
// least: src/lib/srd/mt-srd-artificer.ts tinkeringLimit) it is refused until
// one is ended, which variant 'end' does for nothing. What each object does
// is the GM's to narrate: the count is the engine's.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/feature-names";
import { tinkeringLimit } from "@/lib/srd/mt-srd-artificer";

const TINKERED = "tinkered objects";
const END = new Set(["end", "end one", "dismiss", "release"]);
const nameFor = (count: number) => `${TINKERED} (${count})`;

// How many objects the artificer has imbued, by the count the condition carries.
function tinkered(sheet: Pick<CharacterSheet, "conditions">, limit: number): { held: string | null; count: number } {
  for (let count = 1; count <= Math.max(limit, 20); count += 1) {
    const held = sheet.conditions.find((entry) => textKey(entry) === textKey(nameFor(count)));
    if (held) {
      return { held, count };
    }
  }
  return { held: null, count: 0 };
}

export function magicalTinkering(campaign: Campaign, stale: CharacterSheet, variant: string | undefined): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!holdsFeature(sheet, "Magical Tinkering")) {
    return { error: `${sheet.name} does not have Magical Tinkering (an artificer's 1st level feature).`, refused: "rules" };
  }
  const limit = tinkeringLimit(computeSheetDerived(sheet).abilityMods.int);
  const now = tinkered(sheet, limit);
  const ending = END.has(textKey(variant ?? ""));
  if (ending && !now.count) {
    return { error: `${sheet.name} has no tinkered object to end. Nothing was spent.`, refused: "rules" };
  }
  if (!ending && now.count >= limit) {
    return {
      error: `${sheet.name} already has ${now.count} tinkered object${now.count === 1 ? "" : "s"}, as many as their Intelligence modifier allows. End one first (use_resource Magical Tinkering, variant 'end'). Nothing was spent.`,
      refused: "rules",
    };
  }
  const price = ending ? null : priceTheAction(sheet, getActiveEncounter(campaign.id), "Magical Tinkering");
  if (price && "error" in price) {
    return toolError(price);
  }
  const count = now.count + (ending ? -1 : 1);
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  if (now.held) {
    delete meta[now.held];
  }
  const conditions = sheet.conditions.filter((entry) => entry !== now.held);
  patchSheet(sheet.id, { conditions: count ? [...conditions, nameFor(count)] : conditions, conditionMeta: meta });
  publishSheet(campaign, sheet.id);
  price?.commit();
  return {
    ok: true,
    resource: "Magical Tinkering",
    ...(ending ? { cost: "no action" } : {}),
    applied: ending
      ? `${sheet.name} ends one tinkered object's property: ${count} of ${limit} left.`
      : `${sheet.name} imbues a Tiny object with a small magical property (light, a recorded message, a smell or a picture): ${count} of ${limit}.`,
  };
}
