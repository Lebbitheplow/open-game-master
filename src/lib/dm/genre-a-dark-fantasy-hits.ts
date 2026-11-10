// What a dark fantasy character's own hit sets off, read once by
// src/lib/dm/authored-hooks.ts authoredOnHit as the hit lands:
// - Rose Thorn Oath: "1/turn, when your pact blade hits, regain HP equal to
//   your CHA modifier": a weapon hit while Deathly Pact Blade's bonded weapon
//   is in hand heals the knight, once a turn (the turn's mark, as the bite of
//   Form of the Beast keeps its own). Before this it was a line of the prompt.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { turnKey, type Encounter } from "@/lib/db/encounters";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import { regainHitPoints } from "@/lib/dm/regain";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const thornKey = (holderId: string) => `rose thorn oath:${holderId}`;

export function darkFantasyOnHit(campaign: Campaign, encounter: Encounter, stale: CharacterSheet, input: { weapon?: boolean }): string[] {
  const sheet = getSheetById(stale.id) ?? stale;
  if (input.weapon === false || !holdsFeature(sheet, "Rose Thorn Oath") || !sheet.conditions.some((entry) => isConditionNamed(entry, "deathly pact blade"))) {
    return [];
  }
  const stamp = `${encounter.id}:${turnKey(encounter)}`;
  const cha = computeSheetDerived(sheet).abilityMods.cha ?? 0;
  if (sheet.currentHp <= 0 || cha <= 0 || fightMarked(encounter.id, thornKey(sheet.id), stamp)) {
    return [];
  }
  // Under the heal tool's rules (regain.ts), audited, so an undo takes it back.
  const gained = regainHitPoints(campaign, null, sheet, cha, "Rose Thorn Oath: the pact blade's thorns");
  markFight(encounter.id, thornKey(sheet.id), stamp);
  return gained > 0 ? [`Rose Thorn Oath: the pact blade's hit heals ${sheet.name} ${gained} hit points.`] : [];
}
