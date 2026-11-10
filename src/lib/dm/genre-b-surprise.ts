// Who of the creatures lying in wait can surprise a character of the mystery
// or post-apocalyptic classes (src/lib/dm/encounter-open.ts decideAmbush asks
// for each opponent, so only the hiders that can surprise them count):
//
//   Anticipate Violence (detective)  "You cannot be surprised while conscious"
//   Scent the Wind (packmaster)      "cannot be surprised by beasts or
//                                    mutants": a mutant is a monstrosity on
//                                    the SRD 5.1 engine (WAVE2 D5)
//
// Pure apart from the creature's type, read from its block.
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const SCENTED = ["beast", "monstrosity"];

export function canSurprise(sheet: CharacterSheet, enemy: Pick<EncounterEnemy, "stats">): boolean {
  if (holdsGenreFeature(sheet, "detective", "Anticipate Violence") && sheet.currentHp > 0) {
    return false;
  }
  if (holdsGenreFeature(sheet, "packmaster", "Scent the Wind") && SCENTED.includes(creatureTypeOf(enemy.stats))) {
    return false;
  }
  return true;
}
