import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { afflictionsOf, writeAfflictions } from "@/lib/dm/between-io";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

// Protection from Poison (SRD 5.1): "You touch a creature. If it is
// poisoned, you neutralize the poison. If more than one poison afflicts the
// target, you neutralize one poison that you know is present, or you
// neutralize one at random." cast_buff laid the hour of resistance and
// advantage and left the poisoning on: a hero poisoned for 24 hours by
// Assassin's Blood stayed poisoned under the spell meant to end it. One
// poisoning ends with the cast; a poison's record ends with its condition
// (afflictions.ts inForce).

// Whether the buff a spell lays neutralizes a poison as it is cast.
export function neutralizesPoison(condition: string): boolean {
  return isConditionNamed(condition, "protected from poison");
}

// Ends one poisoning on the character, if they hold one: the name of who was
// cured, or null.
export function neutralizeOnePoison(campaignId: string, sheetId: string, spell: string): string | null {
  const sheet = getSheetById(sheetId);
  const held = sheet?.conditions.find((entry) => isConditionNamed(entry, "poisoned"));
  if (!sheet) {
    return null;
  }
  // A poison still waiting in the body with no poisoning yet (Midnight
  // Tears: "doesn't suffer any effect until the stroke of midnight. If the
  // poison has not been neutralized before then") is the one there is.
  if (!held) {
    const list = afflictionsOf(campaignId, sheet.id);
    const waiting = list.findIndex((entry) => entry.kind === "poison" && !entry.conditions.length && entry.nextAt !== undefined);
    if (waiting < 0) {
      return null;
    }
    writeAfflictions(campaignId, sheet.id, list.filter((_, index) => index !== waiting));
    return sheet.name;
  }
  let taken = false;
  const pickOne = () => (taken ? false : (taken = true));
  const ended = removeConditionInstances(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, held, pickOne);
  // A poisoning written with no instance record is the condition alone.
  const conditions = ended.removed ? ended.conditions : sheet.conditions.filter((entry) => entry !== held);
  const conditionMeta = ended.removed ? ended.meta : (() => {
    const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
    delete meta[held];
    return meta;
  })();
  patchSheetAudited(campaignId, sheet.id, { conditions, conditionMeta }, {
    kind: "clear_condition",
    reason: `${spell} neutralizes a poison`,
    delta: { ended: [held], spell },
  });
  return sheet.name;
}
