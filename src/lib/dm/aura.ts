import { getCampaignById } from "@/lib/db/campaigns";
import { sideOf } from "@/lib/dm/combatant";
import { dominatorOf, type CombatantKind } from "@/lib/dm/combat-sides-logic";
import { getActiveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { listSheets } from "@/lib/db/sheets";
import { computeSheetDerived } from "@/lib/srd";
import { auraGranted, defenseRiders } from "@/lib/srd/feature-effects";
import { classLevelFor } from "@/lib/srd/multiclass";
import { auraConditionImmunities } from "@/lib/srd/trait-rules";
import { chebyshev } from "@/lib/battlemap/types";
import { fieldedSheets } from "@/lib/dm/roster";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A paladin's auras reaching allies: Aura of Protection's bonus to saves,
// and the conditions Aura of Courage and Aura of Devotion keep off. The
// paladin's own saves already carry the bonus (feature-effects save_bonus ->
// computeSheetDerived); this module answers the other half: does someone
// ELSE's aura cover this character right now?
//
// On a battle map the tokens decide it: 10 feet, 30 from paladin 18. Off the
// map (no fight, or a fight with no board) there are no positions to read,
// and the party is taken to be together, as it is at a table, so every
// conscious paladin in play covers every fielded ally. Auras of one kind do
// not stack (the same-effect rule): the best one applies, and a paladin in
// another's aura keeps the larger of the two, never the sum.
//
// "You or a friendly creature" (SRD 5.1): a creature of the fight on the
// party's side (an enemy row moved there, combat-sides.ts) is one too, and
// is measured on the board the same way (allyCreatureSaveAura,
// allyCreatureConditionAura). The party's summons and companions are sheets
// and are covered as characters.

export type AuraSaveBonus = { bonus: number; note: string };

type AuraDonor = Pick<CharacterSheet, "level" | "class"> & {
  classes?: CharacterSheet["classes"];
};

// 10 ft; Aura Improvements at paladin 18 widen it to 30 ft. Paladin levels,
// not the character's: a paladin 6 / fighter 12 has the 10 ft aura.
export function auraRangeFeet(donor: AuraDonor): number {
  const paladinLevel = classLevelFor(
    { class: donor.class, level: donor.level, classes: donor.classes ?? [] },
    "paladin",
  );
  return paladinLevel >= 18 ? 30 : 10;
}

// Who a paladin's aura could reach, and whether this one does. Null when
// there is no board to measure on (off the map everyone is within reach).
function reaches(
  campaignId: string,
  donor: CharacterSheet,
  target: { id: string },
): boolean {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!map) {
    return true;
  }
  const targetToken = getTokenByRef(map.id, target.id);
  const donorToken = getTokenByRef(map.id, donor.id);
  if (!targetToken || !donorToken) {
    // A board is up but one of them is not on it: not beside each other.
    return false;
  }
  const tiles = auraRangeFeet(donor) / 5;
  return chebyshev(targetToken.x, targetToken.y, donorToken.x, donorToken.y) <= tiles;
}

// The paladins who could project an aura onto this target: conscious, alive,
// fielded, not the target itself, and on the target's side of the fight
// running (src/lib/dm/combatant.ts): a paladin who turned on the party
// shields the party no longer, and is not shielded by it.
function donorsFor(campaignId: string, target: { id: string; kind?: CombatantKind }): CharacterSheet[] {
  const campaign = getCampaignById(campaignId);
  const sheets = listSheets(campaignId);
  const fielded = campaign ? fieldedSheets(campaign, sheets) : sheets;
  const encounter = getActiveEncounter(campaignId);
  const side = encounter ? sideOf(encounter, target.kind ?? "sheet", target.id) : null;
  return fielded.filter(
    (donor) =>
      donor.id !== target.id &&
      auraGranted(donor) &&
      !donor.deathSaves?.dead &&
      (!encounter || sideOf(encounter, "sheet", donor.id, donor) === side),
  );
}

// The best Aura of Protection reaching this target from another paladin.
function bestSaveAura(campaignId: string, target: { id: string; kind?: CombatantKind }): (AuraSaveBonus & { raw: number }) | null {
  let best: AuraSaveBonus & { raw: number } | null = null;
  for (const donor of donorsFor(campaignId, target)) {
    const derived = computeSheetDerived(donor);
    const riders = defenseRiders(
      { class: donor.class, level: donor.level, features: donor.features },
      derived.abilityMods,
    );
    if (riders.saveBonus <= 0 || !reaches(campaignId, donor, target)) {
      continue;
    }
    if (!best || riders.saveBonus > best.raw) {
      best = {
        raw: riders.saveBonus,
        bonus: riders.saveBonus,
        note: `${donor.name}'s aura (within ${auraRangeFeet(donor)} ft): +${riders.saveBonus} on saving throws`,
      };
    }
  }
  return best;
}

export function allySaveAura(
  campaignId: string,
  target: Pick<CharacterSheet, "id"> & Partial<CharacterSheet>,
): AuraSaveBonus | null {
  const best = bestSaveAura(campaignId, target);
  if (!best) {
    return null;
  }
  // A paladin already adds their own aura to their saves; another's aura
  // raises that only to the larger of the two. An unconscious paladin adds
  // none of their own (auraGranted), so the ally's counts whole.
  const own =
    target.class && target.features && auraGranted(target)
      ? defenseRiders(
          { class: target.class, level: target.level ?? 1, features: target.features },
          target.abilities ? computeSheetDerived(target as CharacterSheet).abilityMods : undefined,
        ).saveBonus
      : 0;
  const extra = best.raw - own;
  if (extra <= 0) {
    return null;
  }
  return { bonus: extra, note: best.note };
}

// The conditions an ally's aura keeps off this character right now (Aura of
// Courage: frightened; Aura of Devotion: charmed), with whose aura it is.
export function allyConditionAura(
  campaignId: string,
  target: { id: string; kind?: CombatantKind },
  condition: string,
): string | null {
  const wanted = condition.trim().toLowerCase();
  for (const donor of donorsFor(campaignId, target)) {
    const held = auraConditionImmunities(donor).find((entry) => entry.condition === wanted);
    if (held && reaches(campaignId, donor, target)) {
      return `${donor.name}'s ${held.because}`;
    }
  }
  return null;
}

// A creature of the fight the aura counts as friendly: on the party's side
// by its own allegiance. One held there by a domination spell is charmed
// into serving, not friendly, and the aura would help it throw the spell
// off; a character fighting as a foe (sheet-foe.ts) saves as the sheet it is.
function friendlyRow(campaignId: string, enemy: EncounterEnemy): boolean {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || dominatorOf(enemy.conditions, enemy.conditionMeta as Parameters<typeof dominatorOf>[1])) {
    return false;
  }
  return sideOf(encounter, "enemy", enemy.id, enemy) === "party";
}

// Aura of Protection on a creature of the fight fighting for the party
// (forced-save.ts rollEnemySave). Before, its saves took its stat block
// alone beside the paladin.
export function allyCreatureSaveAura(campaignId: string, enemy: EncounterEnemy): AuraSaveBonus | null {
  if (!friendlyRow(campaignId, enemy)) {
    return null;
  }
  const best = bestSaveAura(campaignId, { id: enemy.id, kind: "enemy" });
  return best ? { bonus: best.bonus, note: best.note } : null;
}

// Aura of Courage (or Devotion) keeping a condition off such a creature:
// whose aura, or null. Asked where a condition is laid on an enemy row by
// the GM or by another creature's ability (set_condition, a monster's area
// or hit, aoe_damage).
export function allyCreatureConditionAura(campaignId: string, enemy: EncounterEnemy, condition: string): string | null {
  return friendlyRow(campaignId, enemy) ? allyConditionAura(campaignId, { id: enemy.id, kind: "enemy" }, condition) : null;
}
