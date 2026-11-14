// The steampunk features that change what cover is worth (WAVE2 D5: the genre
// text is the rule, played on the SRD 5.1 engine, whose cover is half, +2,
// and three-quarters, +5: src/lib/dm/attack-spatial.ts coverFor):
//
//   Powder Discipline (aeronaut 7, Sky Corsair)  "Your firearm attacks ignore
//                                                 half cover"
//   Precision Engineering (machinist 10)         "Your schematics ignore half
//                                                 cover and treat three-quarters
//                                                 cover as half"
//   Bulwark Advance (steam knight 11, Boilerplate Vanguard)  "Allies behind you
//                                                 have three-quarters cover
//                                                 against ranged attacks"
//
// The first two are read where a character's attack meets the target's cover
// (src/lib/dm/pc-attack-plan.ts, beside Sharpshooter and Spell Sniper) and,
// for a schematic, where a spell's DEX save counts it (cast-at-enemy.ts). The
// third is read for each ranged swing of a creature at a character
// (src/lib/dm/enemy-attack.ts): an ally of a standing knight whose space lies
// on the line from the shooter has three-quarters cover, where the knight's
// body alone gave half.
//
// Before this all three were their sentence in the GM's prompt.
import { listTokens, getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { coversAgainst } from "@/lib/dm/attack-spatial";
import { sideOf } from "@/lib/dm/combatant";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { weaponNamed } from "@/lib/srd/weapons";

type Cover = 0 | 2 | 5;
const HALF = 2;
const THREE_QUARTERS = 5;

// The cover a character's attack meets after their features, with the note
// that says why, or null when nothing changes it.
export function steampunkAttackCover(
  sheet: Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>,
  attack: { spell: boolean; weapon: boolean; base?: string | null },
  cover: Cover,
  targetName: string,
): { cover: Cover; note: string } | null {
  if (!cover) {
    return null;
  }
  if (attack.spell && holdsGenreFeature(sheet, "machinist", "Precision Engineering")) {
    const left: Cover = cover === THREE_QUARTERS ? HALF : 0;
    return { cover: left, note: `Precision Engineering: ${targetName}'s ${cover === HALF ? "half cover does not count" : "three-quarters cover counts as half"}` };
  }
  if (attack.weapon && cover === HALF && weaponNamed(attack.base ?? "")?.category === "firearm" && holdsGenreFeature(sheet, "aeronaut", "Powder Discipline")) {
    return { cover: 0, note: `Powder Discipline: ${targetName}'s half cover does not count against the shot` };
  }
  return null;
}

// A schematic's DEX save: the cover it counts.
export function schematicSaveCover(sheet: Pick<CharacterSheet, "class" | "features"> & Partial<Pick<CharacterSheet, "classes">>, cover: Cover): Cover {
  if (!cover || !holdsGenreFeature(sheet, "machinist", "Precision Engineering")) {
    return cover;
  }
  return cover === THREE_QUARTERS ? HALF : 0;
}

// The AC a ranged swing at this character meets on top of `cover`: what
// raises it to three-quarters when a Bulwark Advance knight stands in the way.
export function bulwarkCoverRaise(encounterId: string, attackerRef: string, targetId: string, cover: number): number {
  if (cover >= THREE_QUARTERS) {
    return 0;
  }
  const map = getBattleMapForEncounter(encounterId);
  const encounter = map ? getActiveEncounter(map.campaignId) : null;
  if (!map || !encounter || encounter.id !== encounterId) {
    return 0;
  }
  const target = getSheetById(targetId);
  if (!target) {
    return 0;
  }
  const side = sideOf(encounter, "sheet", target.id, target);
  for (const token of listTokens(map.id)) {
    if (token.kind !== "pc" || token.refId === targetId) {
      continue;
    }
    const knight = getSheetById(token.refId);
    if (!knight || knight.currentHp <= 0 || knight.deathSaves?.dead || !holdsGenreFeature(knight, "steam_knight", "Bulwark Advance")) {
      continue;
    }
    if (sideOf(encounter, "sheet", knight.id, knight) !== side) {
      continue;
    }
    if (coversAgainst(encounterId, attackerRef, targetId, knight.id)) {
      return THREE_QUARTERS - cover;
    }
  }
  return 0;
}
