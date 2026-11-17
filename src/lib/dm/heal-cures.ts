// What a healing spell ends besides the hit points it restores (SRD 5.1):
//
//   Heal: "This spell also ends blindness, deafness, and any diseases
//   affecting the target."
//   Mass Heal: "Each creature healed by this spell is also cured of all
//   diseases and any effect making it blinded or deafened."
//
// Their mechanics rows carry it as `cures` with `all` (spell-mech-rows.ts),
// as the restoration spells do; the heal tool only healed, and a blinded,
// plague-sick hero got 70 hit points and stayed blind and sick. A disease
// ends as Lesser Restoration ends one: the conditions it keeps on the sheet
// go, and its record with them (afflictions.ts).
//
// Kept apart from cure-spell.ts, which the heal tool's module (and so
// mutations.ts) must not import.
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { afflictionConditionsFor } from "@/lib/dm/afflictions";
import { removeConditions } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

// Ends on the target every condition the spell's `cures` names that it
// holds ("disease": each disease's conditions). Returns what ended.
export function endHealCures(
  campaign: Campaign,
  turnId: string,
  input: { caster: CharacterSheet; target: CharacterSheet; spell: string; cures: { conditions: string[] } },
): string[] {
  const fresh = getSheetById(input.target.id) ?? input.target;
  const ended = [
    ...new Set(
      input.cures.conditions.flatMap((entry) =>
        entry === "disease" ? afflictionConditionsFor(campaign.id, fresh, "disease") : fresh.conditions.filter((held) => isConditionNamed(held, entry)),
      ),
    ),
  ];
  if (!ended.length) {
    return [];
  }
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, ended);
  const patch = { conditions: cleared.conditions, conditionMeta: cleared.meta };
  const updated = patchSheet(fresh.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: fresh.id,
    turnId,
    kind: "clear_condition",
    delta: { spell: input.spell, ended },
    reason: `${input.spell} cast by ${input.caster.name}`,
    seq: allocateSeq(campaign.id),
    before: fresh,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: fresh.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return ended;
}
