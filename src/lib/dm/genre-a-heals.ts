// What the cyberpunk and dark fantasy healers' counters ask of the creature
// they are spent on, beyond the hit points the counter's own fx restores
// (resource-tools.ts computeUseResource calls this once, before the effect):
//   reach: Stim Injector is a touch (30 ft once fired as a dart, Stim Injector
//     (ranged)); Miracle Worker reaches an ally within 30 ft, and only one at
//     0 hit points; Plague Breaker and Panacea are a touch; Quiet the Voices
//     reaches 30 ft.
//   riders: a stimmed ally stands up (Adrenal Protocol), gains 1d6 temporary
//     hit points (Extraction) and +2 AC until the start of the trauma doc's
//     next turn (Covering Stim); Plague Breaker and Panacea end the conditions
//     they name; Quiet the Voices ends one charm or fear.
// A refusal spends nothing. Before this the stim healed across the board, a
// Miracle Worker on a standing ally went through, and the cures cured nothing.
import { getActiveEncounter } from "@/lib/db/encounters";
import { withinFeet } from "@/lib/dm/authored-saves";
import { rollCard } from "@/lib/dm/roll-card";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

type Terms = {
  feet: (sheet: CharacterSheet) => number;
  atZero?: boolean;
  cures?: string[];
  cureOne?: string[];
  stim?: boolean;
};

const TOUCH = 5;
const TERMS: Record<string, Terms> = {
  cyberpunk_stim_injector: { feet: (sheet) => (holdsFeature(sheet, "Stim Injector (ranged)") ? 30 : TOUCH), stim: true },
  cyberpunk_miracle_worker: { feet: () => 30, atZero: true },
  cyberpunk_plague_breaker: { feet: () => TOUCH, cures: ["diseased", "poisoned", "blinded", "deafened", "paralyzed"].map(textKey) },
  dark_fantasy_panacea: { feet: () => TOUCH, cures: ["poisoned", "diseased", "cursed", "blinded", "deafened", "paralyzed"].map(textKey) },
  horror_quiet_the_voices: { feet: () => 30, cureOne: ["charmed", "frightened"].map(textKey) },
};

export type GenreHeal = { patch: FullPatchSheetInput; notes: string[] };

export function genreCounterHeal(
  campaign: Campaign,
  defId: string,
  displayName: string,
  sheet: CharacterSheet,
  target: CharacterSheet,
): { error: string; refused: "rules" } | GenreHeal | null {
  const terms = TERMS[defId];
  if (!terms) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  const feet = terms.feet(sheet);
  if (target.id !== sheet.id && encounter && !withinFeet(encounter.id, sheet.id, target.id, feet)) {
    return { error: `${displayName} reaches ${feet === TOUCH ? "a creature the healer touches" : `a creature within ${feet} feet`}; ${target.name} is farther. Nothing was spent.`, refused: "rules" };
  }
  if (terms.atZero && target.currentHp > 0) {
    return { error: `${displayName} is for an ally at 0 hit points; ${target.name} stands at ${target.currentHp}. Nothing was spent.`, refused: "rules" };
  }
  // Conditions compared keyed on both sides (textKey).
  const lower = (entry: string) => textKey(entry);
  let conditions = [...target.conditions];
  const meta: Record<string, unknown> = { ...((target.conditionMeta as Record<string, unknown> | undefined) ?? {}) };
  const notes: string[] = [];
  const patch: FullPatchSheetInput = {};
  const drop = (names: string[]) => {
    const gone = conditions.filter((entry) => names.includes(lower(entry)));
    conditions = conditions.filter((entry) => !gone.includes(entry));
    for (const entry of gone) delete meta[entry];
    return gone;
  };
  if (terms.cures) {
    const gone = drop(terms.cures);
    notes.push(gone.length ? `${displayName} ends ${gone.join(", ")} on ${target.name}.` : `${target.name} has none of the conditions ${displayName} ends.`);
  }
  if (terms.cureOne) {
    const first = conditions.find((entry) => terms.cureOne!.includes(lower(entry)));
    if (first) notes.push(`${displayName}: ${target.name} is no longer ${drop([lower(first)]).join(", ")}.`);
  }
  if (terms.stim) {
    if (holdsFeature(sheet, "Adrenal Protocol") && drop(["prone"]).length) {
      notes.push(`Adrenal Protocol: ${target.name} stands up and may move half their speed, free.`);
    }
    if (holdsFeature(sheet, "Covering Stim") && !conditions.some((entry) => lower(entry) === "covering stim")) {
      conditions.push("covering stim");
      meta["covering stim"] = { untilTurnOf: sheet.id, source: sheet.name };
      notes.push(`Covering Stim: +2 AC for ${target.name} until the start of ${sheet.name}'s next turn.`);
    }
  }
  if (conditions.length !== target.conditions.length || conditions.some((entry, index) => entry !== target.conditions[index])) {
    patch.conditions = conditions;
    patch.conditionMeta = meta as FullPatchSheetInput["conditionMeta"];
  }
  return { patch, notes };
}

// Extraction: "allies you ... heal gain 1d6 temp HP", rolled after the heal's
// own dice. Null when the stim carries none; temporary hit points never stack,
// so the caller keeps the higher.
export function genreStimTemp(campaign: Campaign, defId: string, sheet: CharacterSheet): number | null {
  if (!TERMS[defId]?.stim || !holdsFeature(sheet, "Extraction")) {
    return null;
  }
  return rollCard(campaign, null, sheet.id, "custom", "Extraction: temporary hit points", "1d6", null).total;
}
