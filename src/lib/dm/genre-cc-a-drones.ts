// Evasive Subroutines (rigger 7): "Your drones take half damage from area
// effects, none on a successful DEX save", wired by the 2026-11-13 creator
// audit's second genre pass: a drone of a rigger who holds the feature takes
// an area as a creature with Evasion does on a DEX save for half, and half of
// any other area's damage it fails to save against
// (src/lib/dm/aoe-characters.ts asks here for each character caught).
import { getSheetById } from "@/lib/db/sheets";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

const DRONES = "Drone Companion";

export function droneEvades(sheet: Pick<CharacterSheet, "summon">): boolean {
  const summon = sheet.summon;
  if (!summon?.casterId || !isNamed(summon.spell, DRONES)) {
    return false;
  }
  const rigger = getSheetById(summon.casterId);
  return Boolean(rigger && holdsGenreFeature(rigger, "rigger", "Evasive Subroutines"));
}

// Beaked Mask (plague doctor 7): "Immune to inhaled poisons and gases": a
// cloud of gas (a zone row's gas) that poisons, burns with poison or leaves a
// creature retching does nothing to the masked doctor, as it is cast
// (src/lib/dm/aoe-characters.ts) and as they meet it on the board
// (src/lib/dm/zone-triggers.ts).
export function maskKeepsOut(sheet: CharacterSheet, gas: boolean, type?: string, condition?: string, retching?: boolean): boolean {
  if (!gas || !holdsGenreFeature(sheet, "plague_doctor", "Beaked Mask")) {
    return false;
  }
  return type === "poison" || condition === "poisoned" || Boolean(retching);
}
