// What a druid's healing spell does beyond the creature it heals, called by
// the heal tool once the spell's own healing has landed (src/lib/dm/mutations.ts
// case "heal"):
//
//   Starry Form's Chalice: "heals a second creature whenever you cast a
//   healing spell": 1d8 + Wisdom (2d8 from 10th level, Twinkling
//   Constellations) to the druid or another creature within 30 feet, the one
//   most hurt by default.
//   Spirit Totem's Unicorn: a spell cast with a slot heals each ally in the
//   aura the druid level (src/lib/dm/spirit-totem.ts unicornHealing).
//
// Before this both were summaries the GM was to apply: the second creature
// stood where it was.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { spellFactsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { withinFeet } from "@/lib/dm/authored-saves";
import { canRegain, regainHitPoints } from "@/lib/dm/regain";
import { diceFor, rollOwnDice } from "@/lib/dm/character-roll";
import { unicornHealing } from "@/lib/dm/spirit-totem";
import { computeSheetDerived } from "@/lib/srd";
import { hasCondition } from "@/lib/srd/authored-effects";
import { classLevelOf } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const CHALICE = "starry form: chalice";

function chaliceHealing(campaign: Campaign, turnId: string, caster: CharacterSheet, healed: CharacterSheet): string[] {
  if (!hasCondition(caster, CHALICE)) {
    return [];
  }
  const encounter = getActiveEncounter(campaign.id);
  const hurt = (sheet: CharacterSheet) => (sheet.maxHp > 0 ? sheet.currentHp / sheet.maxHp : 1);
  const second = listSheets(campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => sheet.id !== healed.id && !sheet.deathSaves?.dead && canRegain(sheet) && sheet.currentHp < sheet.maxHp)
    .filter((sheet) => sheet.id === caster.id || !encounter || withinFeet(encounter.id, caster.id, sheet.id, 30))
    .sort((a, b) => hurt(a) - hurt(b))[0];
  if (!second) {
    return [];
  }
  const wis = computeSheetDerived(caster).abilityMods.wis ?? 0;
  const dice = `${(classLevelOf(caster, "druid") || caster.level) >= 10 ? "2d8" : "1d8"}+${wis}`;
  // The druid's own dice (character-roll.ts rollOwnDice): on physical dice
  // their player rolls them, as the spell's own healing.
  const rolled = Math.max(0, Number(rollOwnDice(campaign, caster, diceFor("Starry Form (Chalice): healing", caster, second), dice).total));
  const gained = regainHitPoints(campaign, turnId, second, rolled, `Starry Form: Chalice (${caster.name})`);
  return gained > 0 ? [`${second.name} regains ${gained} hit points from the chalice (${dice}).`] : [];
}

export function afterHealingSpell(campaign: Campaign, turnId: string, caster: CharacterSheet, healed: CharacterSheet, spell: string, level?: number): string[] {
  const facts = spellFactsFor(spell, spellAuthorsFor(campaign));
  if (!facts) {
    return [];
  }
  const druid = getSheetById(caster.id) ?? caster;
  const lines = chaliceHealing(campaign, turnId, druid, getSheetById(healed.id) ?? healed);
  // "When you cast a spell with a slot": a cantrip spends none.
  const slotLevel = Math.max(facts.level, level ?? facts.level);
  if (slotLevel >= 1) {
    lines.push(...unicornHealing(campaign, turnId, druid));
  }
  return lines;
}
