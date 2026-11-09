// cast_at_enemy's damage: the spell's dice with the caster's riders (a
// subclass die, Potent Cantrip), halved or stopped by the save, floored where
// the spell says so, then landed through the enemy damage path; a kill wakes
// the features that answer one. Split from cast-at-enemy.ts, which has
// checked and paid for the cast and rolled the save before calling this.

import { markAffinityCast } from "@/lib/dm/affinity-cast";
import { elementalAdeptApplies, floorDamageDice } from "@/lib/srd/feat-combat";
import type { Campaign } from "@/lib/db/campaigns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollCard } from "@/lib/dm/action-common";
import { rollAgainst } from "@/lib/roll-labels";
import { spellDamageFor, spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { authoredOnKill } from "@/lib/dm/authored-hooks";
import { splitDamageExpression } from "@/lib/dm/aoe-parts";
import { secondTypeShare } from "@/lib/dm/damage-parts";
import { landTypedParts } from "@/lib/dm/enemy-blow";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { darkOnesBlessing } from "@/lib/dm/feature-hooks";
import { flooredDamage, maximizedDamage } from "@/lib/dm/spell-riders";
import { curseBurn } from "@/lib/dm/spell-retort";
import { spellDamageRiders } from "@/lib/srd/spell-damage-riders";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Rolls and lands the damage, writing what happened onto `base`; returns the
// damage dealt and the dice's total. A later creature of one area casting
// takes the casting's one roll (`sharedRoll`) and rolls nothing.
export function landSpellDamage(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  spell: string;
  // The spell's own name, for its damage card.
  spellName: string;
  authors: string[];
  mech: NonNullable<ReturnType<typeof spellMechanicsFor>>["mech"] | null;
  facts: ReturnType<typeof spellFactsFor>;
  scaled: ReturnType<typeof spellDamageFor>;
  damageExpression: string;
  damageType: string | undefined;
  spellLevel: number;
  halfOnSave: boolean;
  saved: boolean;
  base: Record<string, unknown>;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  sharedRoll?: number;
  // How much of that one roll is a two-type spell's second type.
  sharedSecond?: number;
}): { dealt: number; rolled: number | null; rolledSecond: number | null } {
  const { campaign, turn, encounter, sheet, enemy, spell, spellName, authors, mech, facts, scaled, damageExpression, damageType, spellLevel, halfOnSave, saved, base, sheets, sheetsById, sharedRoll } = input;
  const riders = spellDamageRiders(sheet, {
    school: spellSchoolFor(spell, authors),
    damageType,
    level: spellLevel,
    classes: facts?.classes,
  });
  // A spell of a Draconic sorcerer's dragon's type opens Elemental Affinity's
  // resistance (src/lib/dm/affinity-cast.ts).
  markAffinityCast(campaign, sheet, damageType);
  // Blight on a plant: the dice's maximum, rolled as no dice at all.
  // A subclass feature's die rides the roll (Enhanced Bond, Arcane Firearm).
  // Elemental Adept: on a spell of its type every 1 on the dice is a 2
  // and resistance is ignored (src/lib/srd/feat-combat.ts).
  const adept = elementalAdeptApplies(sheet, damageType);
  // A spell of two types (Blazing Chariot's fire and radiant): its last dice
  // deal the second type and meet that type's resistance. Only aoe_damage read
  // this, so at one target the whole sum landed as the first type.
  const secondType = mech?.secondType;
  const [firstDice, secondDice] = splitDamageExpression(damageExpression, secondType) ?? [];
  const secondAdept = secondDice ? elementalAdeptApplies(sheet, secondType) : false;
  const spellDice = firstDice && secondDice
    ? `${adept ? floorDamageDice(firstDice) : firstDice}+${secondAdept ? floorDamageDice(secondDice) : secondDice}`
    : adept ? floorDamageDice(damageExpression) : damageExpression;
  const rolledExpression = [spellDice, ...riders.dice].join("+");
  const maxed = maximizedDamage(mech, enemy, rolledExpression);
  // The card shows the dice as rolled; the save halves or stops what lands.
  // A maximized blow rolls no dice, so it has no card.
  const outcome =
    maxed !== null
      ? { total: maxed }
      : sharedRoll !== undefined
        ? { total: sharedRoll }
        : rollCard(campaign, turn, sheet.id, "damage", rollAgainst(spellName, enemy.displayName), rolledExpression, { kind: "sheet", id: sheet.id, name: sheet.name });
  const total = outcome.total + riders.flat;
  const halves = halfOnSave || riders.potentCantrip;
  // Feeblemind's damage lands whatever the save (spell-mech-types.ts).
  const shareOf = (amount: number) => (saved && !mech?.riders?.damageIgnoresSave ? (halves ? Math.floor(amount / 2) : 0) : amount);
  // The second type's share of the roll: read from its dice, which the riders'
  // own dice follow, or the casting's shared roll for a later creature.
  const secondRolled =
    !secondDice || !damageType || !secondType || maxed !== null
      ? null
      : "terms" in outcome
        ? secondTypeShare(outcome, damageType, { dice: secondDice, type: secondType }, riders.dice.length)
        : input.sharedSecond ?? null;
  // Each type's share is halved on its own, as aoe_damage halves it.
  const typedParts =
    secondRolled !== null && damageType && secondType
      ? [
          { amount: shareOf(total - secondRolled), type: damageType },
          { amount: shareOf(secondRolled), type: secondType },
        ]
      : null;
  let damageDealt = typedParts ? typedParts.reduce((sum, part) => sum + part.amount, 0) : shareOf(total);
  // Harm: never below 1 hit point. The floor is on what gets through the
  // creature's resistances, so those are weighed here and not again.
  const floored = flooredDamage(campaign.id, mech, enemy, damageDealt, damageType, adept ? "Elemental Adept" : null);
  if (floored !== null) {
    damageDealt = floored;
  }
  if (riders.notes.length) {
    base.riders = riders.notes;
  }
  if (saved && riders.potentCantrip && !halfOnSave) {
    base.potentCantrip = "Potent Cantrip: the save still takes half.";
  }
  if (damageDealt > 0) {
    const applied = typedParts && floored === null
      ? landTypedParts({
          campaign,
          turn,
          encounter,
          enemy,
          parts: typedParts,
          sheets,
          sheetsById,
          weapon: { magical: true, ...(adept ? { ignoreResistanceBy: "Elemental Adept" } : {}) },
          ...(secondAdept ? { otherParts: { ignoreResistanceBy: "Elemental Adept" } } : {}),
          spell: true,
        })
      : applyEnemyDamage(campaign, turn, encounter, enemy, damageDealt, sheets, sheetsById, floored === null ? damageType : undefined, {
          magical: true,
          spell: true,
          ...(adept ? { ignoreResistance: true } : {}),
        });
    if (adept) {
      base.elementalAdept = `Elemental Adept: ${damageType} ignores resistance; every 1 on the dice counted as 2.`;
    } else if (secondAdept) {
      base.elementalAdept = `Elemental Adept: ${secondType} ignores resistance; every 1 on its dice counted as 2.`;
    }
    Object.assign(base, {
      damage: damageDealt,
      ...(damageType ? { damageType } : {}),
      ...(typedParts ? { secondType } : {}),
      ...(scaled ? { scaling: scaled.note } : {}),
      ...applied,
    });
    // Bestow Curse's necrotic on its caster's spell (spell-retort.ts).
    Object.assign(base, applied.dead ? {} : { curse: curseBurn(campaign, turn, enemy.id, sheet.id, sheets, sheetsById) ?? undefined });
    // Dark One's Blessing: a kill gives a Fiend warlock temporary hit points.
    const blessing = applied.dead ? darkOnesBlessing(campaign, sheet.id) : null;
    if (blessing) {
      base.darkOnesBlessing = blessing;
    }
    // Touch of Death, Keeper of Souls on the kill (authored-hooks.ts).
    const onKill = applied.dead && encounter ? authoredOnKill(campaign, encounter, enemy, sheet.id, false, { level: spellLevel, school: spellSchoolFor(spell, authors) }) : [];
    if (onKill.length) {
      base.subclassFeatures = onKill;
    }
  } else {
    base.damage = 0;
  }
  return { dealt: damageDealt, rolled: maxed === null ? outcome.total : null, rolledSecond: secondRolled };
}
