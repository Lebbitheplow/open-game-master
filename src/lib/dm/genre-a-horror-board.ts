// The horror features that read where the party stands (WAVE2 D5):
//   Alone in the Dark (survivor 3): "While no ally is within 10 ft, +1 AC and
//     advantage on Stealth";
//   Seen Worse (survivor 14): "Immune to being frightened while any ally can
//     see you";
//   Apostasy Complete (apostate 18): "Immune to charm and possession by
//     fiends and aberrations" (possession is the charm a fiend's or an
//     aberration's power lays: the SRD's dominate and charm effects all write
//     charmed).
// The ruling for a party off the board: it stands together (the same ruling
// as the auras, src/lib/dm/genre-a-auras.ts), so out of a fight the survivor
// is never alone and an ally who is awake and not blinded sees them. A
// survivor who scouts ahead off the board is the GM's to give advantage
// (request_roll's advantage).
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { unseenBecause, unseenByConditions } from "@/lib/dm/authored-saves";
import { tilesApart } from "@/lib/dm/board-reach";
import { sideOf } from "@/lib/dm/combatant";
import { normalizeCreatureType } from "@/lib/bestiary/creature-type";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { horrorHolds } from "@/lib/srd/genre-a-horror-holds";
import type { LentRoll } from "@/lib/srd/genre-a-lent";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The other characters on the holder's side, as they stand now. The dead are
// no allies; one at 0 hit points still is.
function alliesOf(campaignId: string, sheet: CharacterSheet): CharacterSheet[] {
  const encounter = getActiveEncounter(campaignId);
  const side = encounter ? sideOf(encounter, "sheet", sheet.id, sheet) : null;
  return listSheets(campaignId)
    .filter((entry) => entry.id !== sheet.id)
    .map((entry) => getSheetById(entry.id) ?? entry)
    .filter((entry) => !entry.deathSaves?.dead && (!encounter || sideOf(encounter, "sheet", entry.id, entry) === side));
}

// No ally stands within 10 feet of the holder on the fight's board. Without a
// board, or with the holder off it, nothing is measured and nobody is alone.
export function standsAlone(campaignId: string, sheet: CharacterSheet): boolean {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const own = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !own) {
    return false;
  }
  return !alliesOf(campaignId, sheet).some((ally) => {
    const token = getTokenByRef(map.id, ally.id);
    return Boolean(token && tilesApart(own, token) <= 2);
  });
}

const aloneInTheDark = (campaignId: string, sheet: CharacterSheet) => horrorHolds(sheet, "Alone in the Dark") && standsAlone(campaignId, sheet);

// Alone in the Dark's +1 to the armor class an attack meets, read by
// src/lib/dm/ac-effects.ts acWithEffects (every attack on a character).
export function horrorAcBonus(campaignId: string, sheet: CharacterSheet): number {
  return aloneInTheDark(campaignId, sheet) ? 1 : 0;
}

// Alone in the Dark's advantage on Stealth, lent to the holder's own check
// through the auras' door (src/lib/dm/genre-a-auras.ts lentRolls).
export function horrorLentRolls(campaignId: string, roller: CharacterSheet): LentRoll[] {
  return aloneInTheDark(campaignId, roller)
    ? [{ roll: "check", skills: ["stealth"], note: "Alone in the Dark (no ally within 10 ft): advantage" }]
    : [];
}

const awake = (sheet: CharacterSheet) => sheet.currentHp > 0 && !sheet.conditions.some((entry) => isConditionNamed(entry, "unconscious"));

// An ally who is awake sees the holder: on the board by the conditions and
// the line of sight, off it by the conditions alone.
function seenByAnAlly(campaignId: string, sheet: CharacterSheet): boolean {
  const encounter = getActiveEncounter(campaignId);
  return alliesOf(campaignId, sheet)
    .filter(awake)
    .some((ally) => (encounter ? unseenBecause(encounter.id, ally, sheet) : unseenByConditions(null, ally, sheet, {})) === null);
}

// Why a horror feature keeps the condition off the holder, or null, read by
// src/lib/dm/set-condition.ts conditionImmunity (every condition laid on a
// character) with the creature laying it when one is known.
export function horrorConditionImmunity(
  campaignId: string,
  sheet: CharacterSheet,
  condition: string,
  source: Pick<EncounterEnemy, "stats"> | null,
): string | null {
  if (condition === "frightened" && horrorHolds(sheet, "Seen Worse") && seenByAnAlly(campaignId, sheet)) {
    return "Seen Worse (an ally can see them)";
  }
  const kind = source?.stats?.type ? normalizeCreatureType(String(source.stats.type)) : null;
  if (condition === "charmed" && (kind === "fiend" || kind === "aberration") && horrorHolds(sheet, "Apostasy Complete")) {
    return "Apostasy Complete";
  }
  return null;
}
