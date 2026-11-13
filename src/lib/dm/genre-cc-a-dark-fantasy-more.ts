// Two dark fantasy features that answer something done to another character,
// wired by the 2026-11-13 creator audit's second genre pass:
//
//   Grief Made Strength (dirgesinger 3): "When an ally within 30 ft drops to
//     0 HP, your next dirge this minute costs no slot if 2nd level or lower":
//     the slotless mark of src/lib/dm/genre-b-free-cast.ts for ten rounds,
//     read by the damage path as the ally falls (src/lib/dm/pc-damage.ts);
//   Controlled Dosage (plague doctor 9): "Your healing remedies also cure one
//     disease or poison per casting": the doctor's healing spell ends the
//     patient's poisoning, or one disease the GM laid by name, read by the
//     healing spell (src/lib/dm/heal-spell.ts).
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { withinFeet } from "@/lib/dm/authored-saves";
import { getActiveEncounter } from "@/lib/db/encounters";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { GRIEF_MARK } from "@/lib/srd/genre-cc-a-conditions";

const MINUTE = 10;

export function griefMadeStrength(campaign: Campaign, fallen: CharacterSheet): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const lines: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const singer = getSheetById(stale.id) ?? stale;
    if (singer.id === fallen.id || singer.currentHp <= 0 || !holdsGenreFeature(singer, "dirgesinger", "Grief Made Strength")) {
      continue;
    }
    if (encounter && !withinFeet(encounter.id, singer.id, fallen.id, 30)) {
      continue;
    }
    const kept = singer.conditions.filter((entry) => !isConditionNamed(entry, GRIEF_MARK));
    const updated = patchSheet(singer.id, { conditions: [...kept, GRIEF_MARK], conditionMeta: { ...singer.conditionMeta, [GRIEF_MARK]: { rounds: MINUTE } } });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      lines.push(`Grief Made Strength: ${fallen.name} falls, and ${singer.name}'s next dirge of 2nd level or lower this minute costs no slot.`);
    }
  }
  return lines;
}

// What a remedy cures: poisoned first, else a disease the GM laid by name.
const CURED = ["poisoned", "diseased", "disease", "sickened"];

export function controlledDosage(campaign: Campaign, caster: CharacterSheet, target: CharacterSheet): string | null {
  if (!holdsGenreFeature(caster, "plague_doctor", "Controlled Dosage")) {
    return null;
  }
  const patient = getSheetById(target.id) ?? target;
  const cured = CURED.map((name) => patient.conditions.find((entry) => isConditionNamed(entry, name))).find(Boolean);
  if (!cured) {
    return null;
  }
  const left = removeConditions(patient.conditions, patient.conditionMeta as ConditionMetaMap, [cured]);
  const updated = patchSheet(patient.id, { conditions: left.conditions, conditionMeta: left.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `Controlled Dosage: the remedy also cures ${patient.name} of ${cured}`;
}
