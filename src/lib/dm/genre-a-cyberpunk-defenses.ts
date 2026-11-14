// The cyberpunk classes' defenses that read a moment, not just the sheet
// (WAVE2 D5): each is a row of src/lib/srd/authored-effects-genre-a-cyberpunk.ts
// and this module is its one reader, called from the door the moment passes
// through, so no other door can read the row differently.
//   fall_resist (Kinetic Buffer, "Resistance to falling damage"): the fall
//     in src/lib/dm/hazard-tools.ts adds the fall's own type to the
//     resistances applyPcDamage weighs, so it never halves twice;
//   concentration_adv (Split Focus, "Advantage on concentration saves"):
//     the concentration save in src/lib/dm/concentration.ts;
//   attacked_disadv with besideDowned (Shield the Fallen, "While adjacent to
//     a downed ally, attacks against you have disadvantage"): the incoming
//     attack in src/lib/dm/authored-hooks.ts authoredIncomingAttack;
//   Field Surgeon ("creatures you stabilize wake with 1 HP after 1 minute"):
//     the stable creature's wait, at src/lib/dm/stabilize.ts, is ten rounds
//     on its unconscious condition, the clock that gives the 1 hit point back
//     (death.ts wakeStable), in place of the SRD's 1d4 hours.
//   Counter-Intrusion ("When you succeed on a save against a spell, deal 2d8
//     psychic damage to the caster"): the made save a creature forced with
//     magic, at the save's one door (src/lib/dm/forced-save.ts), no reaction
//     and no counter: the text names neither. The engine tells a spell's
//     save from another's by `magical` (roll-about.ts saveAgainst), which a
//     creature's magical breath also carries.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { rollCard } from "@/lib/dm/roll-card";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { activeAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { downConditions, STABLE_SOURCE } from "@/lib/dm/vitals-logic";
import { holdsFeature } from "@/lib/srd/feature-names";

// The fall's damage type when a row resists falling, for applyPcDamage's
// `resists`; nothing otherwise.
export function fallResistances(sheet: AuthoredSheet, damageType: string): string[] {
  return activeAuthored(sheet, "fall_resist").length ? [damageType] : [];
}

// The feature that gives advantage on the save to keep concentration.
export function concentrationAdvantage(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "concentration_adv")[0]?.held.feature ?? null;
}

// "Downed": at 0 hit points and not dead, a creature to stand over.
const downed = (sheet: Pick<CharacterSheet, "currentHp" | "deathSaves">) => sheet.currentHp <= 0 && !sheet.deathSaves?.dead;

// An ally of `target` at 0 hit points within 5 feet of them on the board.
export function besideDownedAlly(campaignId: string, encounterId: string, target: Pick<CharacterSheet, "id">): CharacterSheet | null {
  const party = listSheets(campaignId).map((stale) => getSheetById(stale.id) ?? stale);
  return party.find((ally) => ally.id !== target.id && downed(ally) && withinFeet(encounterId, target.id, ally.id, 5)) ?? null;
}

// The minute's wait a Field Surgeon's patient keeps, or null for any other
// healer (the 1d4 hours are rolled then).
export function fieldSurgeonWait(healer: CharacterSheet, patient: Pick<CharacterSheet, "conditions" | "conditionMeta">) {
  if (!holdsFeature(healer, "Field Surgeon")) {
    return null;
  }
  const held = downConditions({ conditions: patient.conditions, conditionMeta: patient.conditionMeta });
  return { minutes: 1, conditions: held.conditions, conditionMeta: { ...held.conditionMeta, unconscious: { rounds: 10, source: STABLE_SOURCE } } };
}

const COUNTER_INTRUSION = "Counter-Intrusion";

// The line for the save's notes, or null for anyone but a holder.
export function counterIntrusion(campaign: Campaign, turn: DmTurn | null, sheet: CharacterSheet, caster: EncounterEnemy): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const live = getEnemy(caster.id) ?? caster;
  if (!encounter || live.status !== "alive" || !holdsFeature(sheet, COUNTER_INTRUSION)) {
    return null;
  }
  const amount = rollCard(campaign, turn, sheet.id, "damage", `${COUNTER_INTRUSION}: ${live.displayName}`, "2d8", null).total;
  return `${COUNTER_INTRUSION}: ${hurtEnemy(campaign, encounter, live, amount, "psychic", COUNTER_INTRUSION)}`;
}
