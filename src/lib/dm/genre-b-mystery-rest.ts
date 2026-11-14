// Talking Cure (alienist, 1st level): "During a short rest, one creature you
// counsel regains an extra hit die of HP and ends one fear or charm effect."
// Depth Analysis (11th): "Your Talking Cure works on two creatures per rest
// and also removes one level of exhaustion." (WAVE2 D5: the genre text is the
// rule, played on the SRD 5.1 engine.)
//
// The short rest asks here once as it ends (src/lib/dm/rest-tools.ts). Each
// alienist on their feet counsels the companions who need it most, with no
// call of their own to make: first whoever carries a fear or a charm, then
// whoever is missing the most hit points. The extra hit die is the patient's
// own die with their Constitution modifier, rolled and not spent.
//
// Before this the feature was its sentence in the GM's prompt, and a short
// rest gave the alienist's patients nothing.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { regainHitPoints } from "@/lib/dm/regain";
import { rollCard } from "@/lib/dm/roll-card";
import { computeSheetDerived, findClass } from "@/lib/srd";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const ENDS = ["frightened", "charmed"];

const troubled = (sheet: CharacterSheet) => sheet.conditions.some((entry) => isConditionNamed(entry, ...ENDS));
const missing = (sheet: CharacterSheet) => Math.max(0, sheet.maxHp - sheet.currentHp);

export function talkingCure(campaign: Campaign, turnId: string | null, restedIds: string[]): string[] {
  const rested = restedIds.map((id) => getSheetById(id)).filter((sheet): sheet is CharacterSheet => Boolean(sheet && !sheet.deathSaves?.dead));
  const counselled = new Set<string>();
  const lines: string[] = [];
  for (const alienist of rested) {
    if (alienist.currentHp <= 0 || !holdsGenreFeature(alienist, "alienist", "Talking Cure")) {
      continue;
    }
    const deep = holdsGenreFeature(alienist, "alienist", "Depth Analysis");
    const patients = rested
      .filter((sheet) => sheet.id !== alienist.id && !counselled.has(sheet.id))
      .map((sheet) => getSheetById(sheet.id) ?? sheet)
      .filter((sheet) => troubled(sheet) || missing(sheet) > 0 || (deep && (sheet.exhaustion ?? 0) > 0))
      .sort((a, b) => Number(troubled(b)) - Number(troubled(a)) || missing(b) - missing(a))
      .slice(0, deep ? 2 : 1);
    for (const patient of patients) {
      counselled.add(patient.id);
      const parts: string[] = [];
      if (missing(patient) > 0) {
        const die = findClass(patient.class)?.hitDie ?? 8;
        const con = computeSheetDerived(patient).abilityMods.con;
        const rolled = rollCard(campaign, null, patient.id, "custom", `${patient.name}: Talking Cure (a hit die)`, `1d${die}${con >= 0 ? "+" : ""}${con}`, null).total;
        const gained = regainHitPoints(campaign, turnId, patient, Math.max(0, rolled), `Talking Cure (${alienist.name})`);
        if (gained > 0) {
          parts.push(`regains ${gained} hit points`);
        }
      }
      const fresh = getSheetById(patient.id) ?? patient;
      const held = fresh.conditions.find((entry) => isConditionNamed(entry, ...ENDS));
      const exhausted = deep && (fresh.exhaustion ?? 0) > 0;
      if (held || exhausted) {
        const cleared = held ? removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, [held]) : null;
        const updated = patchSheet(fresh.id, {
          ...(cleared ? { conditions: cleared.conditions, conditionMeta: cleared.meta } : {}),
          ...(exhausted ? { exhaustion: (fresh.exhaustion ?? 0) - 1 } : {}),
        });
        if (updated) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
        }
        if (held) parts.push(`is no longer ${held}`);
        if (exhausted) parts.push("loses a level of exhaustion (Depth Analysis)");
      }
      if (parts.length) {
        lines.push(`Talking Cure: counselled by ${alienist.name}, ${patient.name} ${parts.join(", ")}.`);
      }
    }
  }
  return lines;
}
