// The paladin auras that reach other creatures than the paladin, read where
// the number they change is made:
//
//   Aura of the Sentinel: allies within 10 feet (30 from 18th level) add the
//     paladin's proficiency bonus to initiative (forced-save.ts
//     rollExtrasFor, the door every initiative roll goes through).
//   Aura of Hate: fiends and undead within 10 feet (30 from 18th level) add
//     the oathbreaker's Charisma modifier, at least +1, to their melee weapon
//     blows (enemy-attack.ts, where a creature's blow is built).
//   Aura of Alacrity: an ally who starts their turn within 5 feet (10 from
//     18th level) has 10 more feet of speed until that turn ends
//     (authored-turns.ts authoredTurnStart lays the condition whose row
//     carries it; the move route's budget reads it).
//
// The paladin's own share stays where it was (feature-effects for initiative
// and speed, attack-damage-riders for damage); this module answers only for
// the others. An aura works while its paladin is up: not at 0 hit points,
// not unconscious, not dead (Alacrity also not incapacitated). Distances are
// measured on the board (authored-saves.ts withinFeet); with no fight, or no
// board, the fiction decides and the party stands together, in range.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { sideOf } from "@/lib/dm/combatant";
import { fieldedSheets } from "@/lib/dm/roster";
import { withinFeet } from "@/lib/dm/authored-saves";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { incapacitatedBy, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { computeSheetDerived, proficiencyBonus } from "@/lib/srd";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { auraGranted } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { auraCoversType, auraDamageAmount, auraReachFeet, bestAuraOffer, type AuraOffer } from "@/lib/dm/divine-auras-logic";

// The characters whose auras can reach anyone now: fielded, alive, up.
function upHolders(campaignId: string): CharacterSheet[] {
  const campaign = getCampaignById(campaignId);
  const sheets = listSheets(campaignId).map((stale) => getSheetById(stale.id) ?? stale);
  return (campaign ? fieldedSheets(campaign, sheets) : sheets).filter((sheet) => !sheet.deathSaves?.dead && auraGranted(sheet));
}

function inReach(encounter: Encounter | null, holderId: string, otherId: string, feet: number): boolean {
  return !encounter || withinFeet(encounter.id, holderId, otherId, feet);
}

// The holders on this character's side of the fight running (combatant.ts):
// a paladin who turned on the party helps it no longer. Out of a fight every
// fielded character is an ally.
function alliesOf(campaignId: string, encounter: Encounter | null, sheet: CharacterSheet): CharacterSheet[] {
  const side = encounter ? sideOf(encounter, "sheet", sheet.id, sheet) : null;
  return upHolders(campaignId).filter(
    (holder) => holder.id !== sheet.id && (!encounter || sideOf(encounter, "sheet", holder.id, holder) === side),
  );
}

// Aura of the Sentinel over this character's initiative: the best ally's
// proficiency bonus in reach, less what the character adds of their own (a
// Watchers paladin already adds theirs through feature-effects).
export function allyInitiativeAura(campaignId: string, sheet: CharacterSheet): AuraOffer | null {
  const encounter = getActiveEncounter(campaignId);
  const offers: AuraOffer[] = [];
  for (const holder of alliesOf(campaignId, encounter, sheet)) {
    for (const { effect, held } of activeAuthored(holder, "init_prof")) {
      if (!effect.rangeFt) {
        continue;
      }
      const feet = auraReachFeet(effect.rangeFt, held.level);
      if (!inReach(encounter, holder.id, sheet.id, feet)) {
        continue;
      }
      const bonus = proficiencyBonus(holder.level);
      offers.push({ bonus, note: `${holder.name}'s ${held.feature} (within ${feet} ft): +${bonus} to initiative` });
    }
  }
  const own = activeAuthored(sheet, "init_prof").length ? proficiencyBonus(sheet.level) : 0;
  return bestAuraOffer(offers, own);
}

// Aura of Hate on a creature's melee weapon blow: the oathbreaker's Charisma
// modifier (at least +1) when the creature is of the aura's types and stands
// within its reach. The caller says the blow is a melee weapon attack. One
// paladin's at a time: the largest.
export function hateAuraDamage(campaignId: string, enemy: Pick<EncounterEnemy, "id" | "stats">): AuraOffer | null {
  const type = creatureTypeOf(enemy.stats);
  const encounter = getActiveEncounter(campaignId);
  const offers: AuraOffer[] = [];
  for (const holder of upHolders(campaignId)) {
    for (const { effect, held } of activeAuthored(holder, "damage_ability")) {
      if (!effect.aura || !auraCoversType(effect.aura.types, type)) {
        continue;
      }
      const feet = auraReachFeet(effect.aura.rangeFt, held.level);
      if (!inReach(encounter, holder.id, enemy.id, feet)) {
        continue;
      }
      const bonus = auraDamageAmount(computeSheetDerived(holder).abilityMods[effect.ability]);
      offers.push({ bonus, note: `${holder.name}'s ${held.feature} (within ${feet} ft): +${bonus} damage` });
    }
  }
  return bestAuraOffer(offers, 0);
}

// Aura of Alacrity as this character's turn starts: within reach of an ally
// Glory paladin who is up and not incapacitated, they hold the aura's
// condition (its row carries the 10 feet) until the end of this turn
// (turnBegun: the turn has begun, so its end takes it, turn-end.ts).
export function alacrityTurnStart(campaign: Campaign, encounter: Encounter, sheet: CharacterSheet): string[] {
  for (const holder of alliesOf(campaign.id, encounter, sheet)) {
    if (incapacitatedBy(holder.conditions)) {
      continue;
    }
    for (const { effect, held } of activeAuthored(holder, "speed")) {
      if (!effect.allies) {
        continue;
      }
      const feet = auraReachFeet(effect.allies.rangeFt, held.level);
      if (!withinFeet(encounter.id, holder.id, sheet.id, feet)) {
        continue;
      }
      const now = getSheetById(sheet.id) ?? sheet;
      const name = effect.allies.condition;
      // One instance: two Glory paladins beside the ally give 10 feet once.
      const cleared = removeConditions(now.conditions, now.conditionMeta as ConditionMetaMap, [name]);
      const meta = { ...cleared.meta, [name]: { source: holder.id, untilTurnEndOf: now.id, turnBegun: true } };
      patchSheetAudited(
        campaign.id,
        now.id,
        { conditions: [...cleared.conditions, name], conditionMeta: meta as CharacterSheet["conditionMeta"] },
        { kind: "set_condition", reason: `${held.feature} (${holder.name})`, delta: { added: name } },
      );
      return [`${held.feature}: ${now.name} starts their turn within ${feet} feet of ${holder.name}, and has 10 more feet of speed this turn.`];
    }
  }
  return [];
}
