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
import type { TypedRider } from "@/lib/dm/damage-parts";
import { attackWrathDice } from "@/lib/dm/destructive-wrath-logic";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import type { EncounterEnemy } from "@/lib/db/encounters";

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

// Final Verdict: "1/long rest, for 1 minute all your attacks against fiends,
// undead, and cursed creatures deal maximum weapon dice". The weapon's own
// dice (a critical's doubled ones too) are dealt at their maximum; a rider's
// dice still roll. The maximizing is Destructive Wrath's own-dice reading
// (destructive-wrath-logic.ts), with every rider kept out of it. A cursed
// creature is one holding a curse the engine lays (Bestow Curse, a "cursed"
// condition). Read by src/lib/dm/attack-swing.ts as the damage roll is asked.
const CURSES = ["cursed", "bestow curse"];
export function finalVerdictDice(
  sheet: Pick<CharacterSheet, "conditions">,
  enemy: Pick<EncounterEnemy, "stats" | "conditions">,
  record: { weaponAttack?: boolean; critExtraDice?: number },
  expression: string,
  riders: TypedRider[],
  crit: boolean,
): { expression: string; note: string } | null {
  if (!record.weaponAttack || !sheet.conditions.some((entry) => isConditionNamed(entry, "final verdict"))) {
    return null;
  }
  const type = creatureTypeOf(enemy.stats);
  if (type !== "fiend" && type !== "undead" && !enemy.conditions.some((entry) => isConditionNamed(entry, ...CURSES))) {
    return null;
  }
  const kept = riders.map((rider) => ({ ...rider, type: "kept" }));
  const maxed = attackWrathDice(expression, "thunder", kept, { crit, trailingTerms: crit ? (record.critExtraDice ?? 0) : 0 });
  return maxed ? { expression: maxed.expression, note: "Final Verdict: the weapon's dice are dealt at their maximum" } : null;
}
