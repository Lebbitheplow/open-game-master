// Three bard subclass rules a casting reads, each at the one door every cast
// already passes (scripts/clauses/arcane.json, the bard's clauses):
//
//   - College of Swords, Bonus Proficiencies: "your weapon can serve as a
//     spellcasting focus". A weapon the bard wields answers a costless
//     material as an instrument would (cast-materials.ts focusProblem), and
//     the hand that holds it is the hand for that material (cast-rules.ts
//     componentProblem), as a wizard's staff is.
//   - College of Spirits, Spiritual Focus: "A candle, a deck, a talking board
//     or the like serves as your spellcasting focus". One of those carried
//     answers the material too.
//   - College of Spirits, Guiding Whispers: "You know guidance and can cast it
//     at 60 feet". The reach of that one cantrip for that bard
//     (cast-reach.ts spellReachProblem).
//   - College of Glamour, Mantle of Majesty: "a creature charmed by you
//     automatically fails its save against it" (the command cast while the
//     mantle holds; cast-at-enemy.ts).
//
// Pure: no database, so the Hand's spell cards read the same answers.

import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";
import { matchWeapon } from "@/lib/srd/weapons";

type Holder = Pick<CharacterSheet, "equipment"> & { features?: CharacterSheet["features"]; feats?: CharacterSheet["feats"] };

const SWORDS_FOCUS = "Bonus Proficiencies (Swords)";
const SPIRITUAL_FOCUS = "Spiritual Focus";
const GUIDING_WHISPERS = "Guiding Whispers";
const MANTLE = "mantle of majesty";
export const GUIDING_WHISPERS_FEET = 60;

// What the text lists, and the two things a table most often writes for "a
// deck" and "a talking board".
const SPIRIT_FOCI = /\b(candles?|deck|cards|talking board|spirit board)\b/i;

// The weapon a Swords bard wields, which is their focus: its name, or null.
export function wieldedWeaponFocus(sheet: Holder): string | null {
  if (!holdsFeature(sheet, SWORDS_FOCUS)) {
    return null;
  }
  return sheet.equipment.find((item) => item.equipped === true && matchWeapon(item) !== null)?.name ?? null;
}

// The item a bard's subclass makes a spellcasting focus, or null: a Swords
// bard's wielded weapon, a Spirits bard's candle, deck or talking board.
export function subclassFocus(sheet: Holder): string | null {
  const weapon = wieldedWeaponFocus(sheet);
  if (weapon) {
    return weapon;
  }
  if (!holdsFeature(sheet, SPIRITUAL_FOCUS)) {
    return null;
  }
  return sheet.equipment.find((item) => SPIRIT_FOCI.test(item.name))?.name ?? null;
}

// The reach, in feet, a feature gives this caster's casting of this spell
// over the spell's own, or null.
export function featureSpellReachFeet(sheet: { features?: CharacterSheet["features"]; feats?: CharacterSheet["feats"] } | null | undefined, spell: { name: string; runsAs?: string | null }): number | null {
  if (!sheet || textKey(spell.runsAs ?? spell.name) !== "guidance") {
    return null;
  }
  return holdsFeature(sheet, GUIDING_WHISPERS) ? GUIDING_WHISPERS_FEET : null;
}

// Whether the target fails this spell's save with no die rolled: Command from
// a bard in the Mantle of Majesty at a creature that bard charmed. `charmed`
// is the caller's reading of the target (enemy-profile.ts charmedBy).
export function majestyFailsSave(sheet: Pick<CharacterSheet, "conditions">, spell: string, charmed: boolean): string | null {
  if (!charmed || textKey(spell) !== "command" || !sheet.conditions.some((entry) => textKey(entry) === MANTLE)) {
    return null;
  }
  return "Mantle of Majesty: a creature charmed by the bard fails its save against this command automatically";
}
