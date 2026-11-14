// SRD 5.1, Elemental Affinity: "when you cast a spell that deals damage of
// the type associated with your draconic ancestry ... you can spend 1
// sorcery point to gain resistance to that damage type for 1 hour."
//
// The cast tools that deal a spell's damage (cast_at_enemy, aoe_damage, a
// spell attack through pc_attack) mark the sorcerer here when the spell's
// type is their dragon's: "affinity cast (fire)", until the end of their turn
// in a fight, or for the moment of casting outside one. The resistance spend
// (src/lib/dm/draconic-spends.ts) takes the mark, and the Hand deals its card
// only while it is held. Without it the point bought the resistance at any
// time (issue #833 review).
//
// The same three doors wreathe a tiefling with Flames of Phlegethos in fire
// after a fire spell (markFlamesCast), until the end of their next turn.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { AFFINITY_CAST, chosenElementType } from "@/lib/srd/dragon-ancestor";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { FLAMES_OF_PHLEGETHOS, flamesOfPhlegethosApplies } from "@/lib/srd/feat-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { textKey } from "@/lib/language/text-logic";

export { AFFINITY_CAST, affinityCastType } from "@/lib/srd/dragon-ancestor";

// Marks the caster after a spell of `damageType` dealt its damage, when that
// is their dragon's, or the element their workshop subclass's choice names
// (issue #833), and they hold Elemental Affinity.
export function markAffinityCast(campaign: Campaign, stale: CharacterSheet, damageType: string | null | undefined) {
  markFlamesCast(campaign, stale, damageType);
  const type = textKey(damageType ?? "");
  const sheet = getSheetById(stale.id) ?? stale;
  if (!type || !holdsFeature(sheet, "elemental affinity") || chosenElementType(sheet) !== type) {
    return;
  }
  const condition = `${AFFINITY_CAST} (${type})`;
  if (sheet.conditions.includes(condition)) {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  const fighting = Boolean(encounter && (encounter.kind ?? "fight") === "fight");
  const kept = sheet.conditions.filter((entry) => !textKey(entry).startsWith(AFFINITY_CAST));
  const meta = Object.fromEntries(Object.entries((sheet.conditionMeta ?? {}) as ConditionMetaMap).filter(([name]) => !textKey(name).startsWith(AFFINITY_CAST)));
  const updated = patchSheet(sheet.id, {
    conditions: [...kept, condition],
    conditionMeta: {
      ...meta,
      [condition]: fighting ? { source: sheet.id, untilTurnEndOf: sheet.id, turnBegun: true } : { source: sheet.id, rounds: 1 },
    } as CharacterSheet["conditionMeta"],
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Flames of Phlegethos: a spell that deals fire damage wreathes the caster
// until the end of their next turn (in a fight, the turn after the one it is
// cast on: no turnBegun), or for a round outside one. A second fire spell
// starts the flames over. A creature that hits the caster in melee while
// they burn takes 1d4 fire (authored-hooks.ts authoredAfterHit).
export function markFlamesCast(campaign: Campaign, stale: CharacterSheet, damageType: string | null | undefined) {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!flamesOfPhlegethosApplies(sheet, damageType)) {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  const fighting = Boolean(encounter && (encounter.kind ?? "fight") === "fight");
  const kept = sheet.conditions.filter((entry) => textKey(entry) !== FLAMES_OF_PHLEGETHOS);
  const updated = patchSheet(sheet.id, {
    conditions: [...kept, FLAMES_OF_PHLEGETHOS],
    conditionMeta: {
      ...(sheet.conditionMeta ?? {}),
      [FLAMES_OF_PHLEGETHOS]: fighting ? { source: "Flames of Phlegethos", untilTurnEndOf: sheet.id } : { source: "Flames of Phlegethos", rounds: 1 },
    } as CharacterSheet["conditionMeta"],
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}
