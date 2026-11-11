// Lunar Boons (Lunar Sorcery 6): "When you use Metamagic on a spell of your
// current phase's schools (Full Moon: abjuration and divination; New Moon:
// enchantment and necromancy; Crescent Moon: illusion and transmutation), it
// costs 1 sorcery point less (minimum 0), a proficiency-bonus number of times
// per long rest." The counter (sub_lunar_boons) was guidance: a spend of it
// moved the counter and nothing else, and no Metamagic spend read it.
//
// Ruling, forced by the tools' shape. A Metamagic option is paid through
// use_resource (Sorcery Points, the option as the variant), which names no
// spell, and the spell goes through its own cast tool. So the two halves meet
// here, in either order:
// - Metamagic first (the order Quickened Spell already asks for): the spend
//   leaves the mark "lunar boon" on the sorcerer, and the next spell they cast
//   takes it. A spell of the phase's schools gives 1 sorcery point back and
//   spends a boon; any other spell ends the mark with nothing back, since the
//   Metamagic rode that spell.
// - The spell first, in a fight: a spell of the phase's schools marks the turn
//   (turn-marks.ts), and a Metamagic option paid later that same turn costs 1
//   point less there and then.
// Every option costs at least 1 point, so 1 less is never below 0. With no
// boon left, no phase chosen, or a spell of another school, the full price
// stands. A bare spend of the counter is refused (the counter is passive).
//
// Who calls it: resource-tools.ts computeUseResource for a Metamagic option
// (metamagicPaid), and cast-guard.ts castSpell, the one door every casting
// passes, once nothing can refuse the cast (boonAtCast).

import { getActiveEncounter, turnKey } from "@/lib/db/encounters";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { heldAuthored } from "@/lib/srd/authored-effects";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const LUNAR_BOONS = "sub_lunar_boons";
// The mark a paid Metamagic option leaves until the next spell is cast.
export const BOON_PENDING = "lunar boon";
const POINTS = "sorcery_points";

const PHASE_SCHOOLS: Record<string, string[]> = {
  "full moon": ["abjuration", "divination"],
  "new moon": ["enchantment", "necromancy"],
  "crescent moon": ["illusion", "transmutation"],
};

type Resources = CharacterSheet["resources"];

// The schools of the phase chosen for Lunar Embodiment, or none.
export function phaseSchools(sheet: CharacterSheet): { phase: string; schools: string[] } | null {
  const phase = heldAuthored(sheet).find((entry) => textKey(entry.feature) === "lunar embodiment")?.choice ?? null;
  const schools = phase ? PHASE_SCHOOLS[textKey(phase)] : undefined;
  return phase && schools ? { phase, schools } : null;
}

function boonsLeft(resources: Resources): number {
  const state = resources[LUNAR_BOONS];
  return state ? state.max - state.used : 0;
}

// One boon spent and one sorcery point back.
function discounted(resources: Resources): Resources {
  const [boons, points] = [resources[LUNAR_BOONS], resources[POINTS]];
  return {
    ...resources,
    [LUNAR_BOONS]: { ...boons, used: boons.used + 1 },
    ...(points ? { [POINTS]: { ...points, used: Math.max(0, points.used - 1) } } : {}),
  };
}

const castKey = (sheetId: string) => `lunar-boon-cast:${sheetId}`;

function turnStamp(campaignId: string): { encounterId: string; stamp: string } | null {
  const encounter = getActiveEncounter(campaignId);
  return encounter ? { encounterId: encounter.id, stamp: `${encounter.id}:${turnKey(encounter)}` } : null;
}

const boonLine = (sheet: CharacterSheet, resources: Resources, why: string) =>
  `Lunar Boons: ${why}, so the Metamagic costs 1 sorcery point less. ${sheet.name} has ${boonsLeft(resources)}/${resources[LUNAR_BOONS]?.max ?? 0} boons left.`;

// A Metamagic option was just paid for (`outcome` is the spend as it will be
// written): a phase spell already cast this turn takes the boon now, and
// otherwise the mark waits for the next spell.
export function metamagicPaid<T extends { patch: FullPatchSheetInput; result: Record<string, unknown> }>(campaignId: string, sheet: CharacterSheet, outcome: T): T {
  const lunar = phaseSchools(sheet);
  const resources = (outcome.patch.resources ?? sheet.resources) as Resources;
  if (!lunar || boonsLeft(resources) < 1) {
    return outcome;
  }
  const turn = turnStamp(campaignId);
  if (turn && fightMarked(turn.encounterId, castKey(sheet.id), turn.stamp)) {
    markFight(turn.encounterId, castKey(sheet.id), "");
    const next = discounted(resources);
    outcome.patch.resources = next;
    const points = next[POINTS];
    if (typeof outcome.result.spent === "number") {
      outcome.result.spent = Math.max(0, outcome.result.spent - 1);
    }
    if (points) {
      outcome.result.left = `${points.max - points.used}/${points.max}`;
    }
    outcome.result.lunarBoons = boonLine(sheet, next, `the spell just cast is of the ${lunar.phase} phase's schools`);
    return outcome;
  }
  const conditions = (outcome.patch.conditions ?? sheet.conditions).filter((entry) => !isConditionNamed(entry, BOON_PENDING));
  outcome.patch.conditions = [...conditions, BOON_PENDING];
  outcome.patch.conditionMeta = { ...((outcome.patch.conditionMeta ?? sheet.conditionMeta) as ConditionMetaMap), [BOON_PENDING]: { rounds: 1 } };
  outcome.result.lunarBoons = `Lunar Boons: if the next spell ${sheet.name} casts is of the ${lunar.phase} phase's schools (${lunar.schools.join(" or ")}), 1 sorcery point comes back and a boon is spent.`;
  return outcome;
}

// A spell is being cast (nothing can refuse it any more): what the boon adds
// to the cast's own patch, and the line for its result.
export function boonAtCast(campaignId: string, sheet: CharacterSheet, patch: FullPatchSheetInput, school: string | null | undefined): { patch: FullPatchSheetInput; note: string | null } | null {
  const conditions = patch.conditions ?? sheet.conditions;
  const pending = conditions.some((entry) => isConditionNamed(entry, BOON_PENDING));
  const lunar = phaseSchools(sheet);
  const resources = (patch.resources ?? sheet.resources) as Resources;
  const fits = Boolean(lunar && boonsLeft(resources) >= 1 && lunar.schools.includes(textKey(school ?? "")));
  const turn = lunar ? turnStamp(campaignId) : null;
  if (!pending) {
    // The spell first: a Metamagic option paid later this turn reads the mark.
    if (turn) {
      markFight(turn.encounterId, castKey(sheet.id), fits ? turn.stamp : "");
    }
    return null;
  }
  const meta = { ...((patch.conditionMeta ?? sheet.conditionMeta) as ConditionMetaMap) };
  delete meta[BOON_PENDING];
  const cleared: FullPatchSheetInput = { conditions: conditions.filter((entry) => !isConditionNamed(entry, BOON_PENDING)), conditionMeta: meta };
  if (!fits || !lunar) {
    return { patch: cleared, note: null };
  }
  const next = discounted(resources);
  return { patch: { ...cleared, resources: next }, note: boonLine(sheet, next, `a spell of the ${lunar.phase} phase's schools`) };
}
