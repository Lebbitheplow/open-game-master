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
import { advanceClock } from "@/lib/db/clock";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { usesLeft } from "@/lib/dm/bonus-routes";
import { addRowMath } from "@/lib/dm/mutation-math";
import { namedOption } from "@/lib/dm/tool-errors";
import { isConditionNamed, nameChoice } from "@/lib/srd/feature-names";
import { ARTISANS_TOOLS } from "@/lib/srd/tool-choices";

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

// The Right Tool for the Job (artificer 3rd level): "With thieves' tools or
// artisan's tools in hand, you can magically create one set of artisan's
// tools in an unoccupied space within 5 feet of you. This creation requires 1
// hour of uninterrupted work ... the tools are nonmagical, and they vanish
// when you use this feature again." The counter was spent and the rest told:
// now the tools in hand are asked for, the hour passes on the clock (out of a
// fight only), the set made is put in the pack, and the set the last use made
// is taken back out. Which set it was rides on the lasting condition
// "right tool (<set>)".
const RIGHT_TOOL = "right tool";
const RIGHT_TOOL_COUNTER = "art_right_tool";

export function rightToolForTheJob(campaign: Campaign, stale: CharacterSheet, variant: string | undefined): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!holdsFeature(sheet, "The Right Tool for the Job")) {
    return { error: `${sheet.name} does not have The Right Tool for the Job (an artificer's 3rd level feature).`, refused: "rules" };
  }
  if (getActiveEncounter(campaign.id)) {
    return { error: `The Right Tool for the Job is an hour of uninterrupted work, and a fight is on. Nothing was spent.`, refused: "rules" };
  }
  const inHand = sheet.equipment.some((item) => [...ARTISANS_TOOLS, "thieves' tools"].some((tools) => textKey(item.name) === textKey(tools)));
  if (!inHand) {
    return { error: `${sheet.name} needs thieves' tools or a set of artisan's tools in hand to make the tools; their pack holds neither. Nothing was spent.`, refused: "rules" };
  }
  // The Hand's pick names the mark ("right tool (smith's tools)"), a call the set.
  const asked = variant && isConditionNamed(variant, RIGHT_TOOL) ? (nameChoice(variant) ?? variant) : variant;
  const made = namedOption("The Right Tool for the Job", asked, ARTISANS_TOOLS);
  if (typeof made !== "string") {
    return made;
  }
  if ((usesLeft(sheet, RIGHT_TOOL_COUNTER) ?? 0) < 1) {
    return { error: `${sheet.name} has used The Right Tool for the Job since their last rest. Nothing was spent.`, refused: "rules" };
  }
  const hour = advanceClock(campaign.id, 1, "hours");
  if ("error" in hour) {
    return toolError(hour);
  }
  spendFeatureUse(campaign, sheet.id, RIGHT_TOOL_COUNTER, `The Right Tool for the Job: ${made}`);
  const now = getSheetById(sheet.id) ?? sheet;
  // The set the last use made vanishes.
  const before = now.conditions.find((entry) => isConditionNamed(entry, RIGHT_TOOL));
  const gone = before ? nameChoice(before) : null;
  let equipment = now.equipment;
  if (gone) {
    const at = equipment.findIndex((item) => textKey(item.name) === textKey(gone));
    if (at >= 0) equipment = equipment.flatMap((item, index) => (index !== at ? [item] : (item.qty ?? 1) > 1 ? [{ ...item, qty: (item.qty ?? 1) - 1 }] : []));
  }
  const meta = { ...(now.conditionMeta as ConditionMetaMap) };
  if (before) delete meta[before];
  patchSheet(sheet.id, {
    equipment: addRowMath(equipment, { name: made, qty: 1 }),
    conditions: [...now.conditions.filter((entry) => entry !== before), `${RIGHT_TOOL} (${made})`],
    conditionMeta: meta,
  });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: "The Right Tool for the Job",
    applied: `After an hour's work ${sheet.name} has ${made}, nonmagical, in their pack${gone ? `; the ${gone} the feature made before are gone` : ""}. They last until the feature is used again.`,
  };
}
