// What a healing spell adds to its dice, SRD 5.1 and the authored subclasses:
// the spellcasting modifier (unless the spell heals by its dice alone, Aura
// of Vitality, Regenerate), Disciple of Life's 2 + the slot level, and an
// authored feature's die or modifier (Alchemical Savant, Spiritual Focus,
// Enhanced Bond: authored-effects-more.ts authoredSpellDice).
//
// The heal tool rolls these (heal-spell.ts castHealingSpell) and the Hand's
// healing cards print them (src/lib/battlemap/hand-spells.ts spellCard), so a
// card says what lands: it showed 1d8+3 where an Alchemist healed 1d8+3+3.
// Anything a healing spell's roll adds goes through here.
//
// Pure: the Hand imports it.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { authoredSpellDice } from "@/lib/srd/authored-effects-more";
import { holdsFeature } from "@/lib/srd/feature-names";
import { spellAbilityFor } from "@/lib/srd";
import { runningItemSpell } from "@/lib/srd/item-cast-credit";

// The modifier a healing spell adds: the item's own when it carries one (a
// Ring of Spell Storing keeps its first caster's), else the one its save DC
// implies (the class that carries the spell; an item's DC for a spell cast
// from it), none for a spell whose row says it heals by its dice alone.
export function healModifier(input: { dc: number | null; proficiencyBonus: number; noModifier?: boolean; abilityMod?: number }): number {
  if (input.dc === null || input.noModifier) {
    return 0;
  }
  return input.abilityMod ?? input.dc - 8 - input.proficiencyBonus;
}

// The modifier of the ability a spell is cast with (the class's whose list
// carries it, a species' or a feat's own: spellAbilityFor), for a cast that
// no item made. Reading it back out of the save DC took in what raises the DC
// alone: a Robe of the Archmagi's +2 healed 2 more (SRD 5.1, Cure Wounds
// adds "your spellcasting ability modifier"). Undefined with no casting
// ability, where the DC reading stands.
export function castingAbilityMod(sheet: CharacterSheet, spell: string, mods: Record<string, number>): number | undefined {
  // A spell an item is casting heals with the numbers the item gives.
  if (runningItemSpell(sheet, spell)) {
    return undefined;
  }
  const ability = spellAbilityFor(sheet, spell);
  return ability ? mods[ability] : undefined;
}

// What the caster's features add to a healing spell at this slot level.
export function healAdditions(
  caster: CharacterSheet,
  slotLevel: number,
  mods: Record<string, number>,
): { flat: number; dice: string[]; notes: string[] } {
  let flat = 0;
  const notes: string[] = [];
  if (slotLevel >= 1 && holdsFeature(caster, "disciple of life")) {
    flat += 2 + slotLevel;
    notes.push(`Disciple of Life +${2 + slotLevel}`);
  }
  const bond = authoredSpellDice(caster, { healing: true }, mods);
  notes.push(...bond.notes);
  return { flat, dice: bond.dice, notes };
}
