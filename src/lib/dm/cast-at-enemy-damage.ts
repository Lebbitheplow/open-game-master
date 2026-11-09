// cast_at_enemy's damage: the spell's dice with the caster's riders (a
// subclass die, Potent Cantrip), halved or stopped by the save, floored where
// the spell says so, then landed through the enemy damage path; a kill wakes
// the features that answer one. Split from cast-at-enemy.ts, which has
// checked and paid for the cast and rolled the save before calling this.

import { getSheetById } from "@/lib/db/sheets";
import { markAffinityCast } from "@/lib/dm/affinity-cast";
import { elementalAdeptApplies, floorDamageDice } from "@/lib/srd/feat-combat";
import type { Campaign } from "@/lib/db/campaigns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollCard } from "@/lib/dm/action-common";
import { rollAgainst } from "@/lib/roll-labels";
import { spellDamageFor, spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { authoredOnKill } from "@/lib/dm/authored-hooks";
import { splitDamageExpression, typedRollExpression, typedShares, type SpellDicePart } from "@/lib/dm/aoe-parts";
import { landTypedParts } from "@/lib/dm/enemy-blow";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { darkOnesBlessing } from "@/lib/dm/feature-hooks";
import { flooredDamage, maximizedDamage } from "@/lib/dm/spell-riders";
import { spendWrath, wrathApplies, WRATH_NOTE } from "@/lib/dm/destructive-wrath";
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
  // Overchannel: every die at its maximum, rolled as none.
  atMaximum?: boolean;
}): { dealt: number; rolled: number | null; rolledSecond: number | null } {
  const { campaign, turn, encounter, sheet, enemy, spell, spellName, authors, mech, facts, scaled, damageExpression, damageType, spellLevel, halfOnSave, saved, base, sheets, sheetsById, sharedRoll } = input;
  const riders = spellDamageRiders(sheet, {
    school: spellSchoolFor(spell, authors),
    damageType,
    secondType: mech?.secondType,
    level: spellLevel,
    classes: facts?.classes,
  });
  // A spell of a Draconic sorcerer's dragon's type opens Elemental Affinity's
  // resistance (src/lib/dm/affinity-cast.ts).
  markAffinityCast(campaign, sheet, damageType);
  markAffinityCast(campaign, sheet, mech?.secondType);
  // Blight on a plant: the dice's maximum, rolled as no dice at all.
  // A subclass feature's die rides the roll (Enhanced Bond, Arcane Firearm).
  // Elemental Adept (its own text): "Your spells of that damage type ignore
  // resistance, and any 1 rolled on their damage dice counts as a 2". So a
  // spell that deals the type at all has every die floored, Ice Storm's hail
  // with its cold, while resistance is set aside for the chosen type alone.
  const adept = elementalAdeptApplies(sheet, damageType);
  // A spell of two types (Blazing Chariot's fire and radiant): its last dice
  // deal the second type and meet that type's resistance. Each type is a part
  // of the one roll (aoe-parts.ts), so a part dealt at its maximum keeps its
  // type and a later creature of one area takes the same split.
  const secondType = mech?.secondType;
  const [firstDice, secondDice] = splitDamageExpression(damageExpression, secondType) ?? [];
  const secondAdept = secondDice ? elementalAdeptApplies(sheet, secondType) : false;
  const floored = (dice: string) => (adept || secondAdept ? floorDamageDice(dice) : dice);
  // Destructive Wrath, on the casting's one roll: the creatures after the first
  // take that roll (`sharedRoll`). Only the lightning or thunder part is dealt
  // at its maximum; the other type of a two-type spell is still rolled.
  const holder = getSheetById(sheet.id) ?? sheet;
  const wrathOn = (type: string | undefined) => sharedRoll === undefined && wrathApplies(holder, type);
  // Blight's maximum is this creature's (a plant), so a later creature of the
  // area rolls its own; Overchannel's and Wrath's are the casting's.
  const plantMaximum = maximizedDamage(mech, enemy, damageExpression) !== null;
  const atMaximum = Boolean(input.atMaximum) || plantMaximum;
  const parts: SpellDicePart[] =
    firstDice && secondDice && damageType && secondType
      ? [
          { type: damageType, dice: [floored(firstDice), ...riders.dice].join("+"), atMaximum: atMaximum || wrathOn(damageType) },
          { type: secondType, dice: [floored(secondDice), ...riders.diceSecond].join("+"), atMaximum: atMaximum || wrathOn(secondType) },
        ]
      : [{ type: damageType ?? "", dice: [floored(damageExpression), ...riders.dice, ...riders.diceSecond].join("+"), atMaximum: atMaximum || wrathOn(damageType) }];
  if (parts.some((part) => wrathOn(part.type))) {
    spendWrath(campaign.id, sheet.id);
    base.destructiveWrath = WRATH_NOTE;
  }
  // The card shows the dice as rolled; the save halves or stops what lands.
  // A maximized blow rolls no dice, so it has no card.
  const shared = sharedRoll !== undefined && !plantMaximum ? (parts.length > 1 && input.sharedSecond !== undefined ? [sharedRoll - input.sharedSecond, input.sharedSecond] : [sharedRoll]) : null;
  const outcome = shared || parts.every((part) => part.atMaximum)
    ? null
    : rollCard(campaign, turn, sheet.id, "damage", rollAgainst(spellName, enemy.displayName), typedRollExpression(parts), { kind: "sheet", id: sheet.id, name: sheet.name });
  const shares = shared ?? typedShares(outcome, parts);
  const rolledTotal = shares.reduce((sum, share) => sum + share, 0);
  const total = rolledTotal + riders.flat + riders.flatSecond;
  const halves = halfOnSave || riders.potentCantrip;
  // Feeblemind's damage lands whatever the save (spell-mech-types.ts).
  const shareOf = (amount: number) => (saved && !mech?.riders?.damageIgnoresSave ? (halves ? Math.floor(amount / 2) : 0) : amount);
  // Each type's share is halved on its own, as aoe_damage halves it; the
  // caster's flat bonus joins the type it belongs to (Elemental Affinity).
  const secondRolled = shares.length > 1 ? shares[1] : null;
  const typedParts =
    secondRolled !== null && damageType && secondType
      ? [
          { amount: shareOf(shares[0] + riders.flat), type: damageType },
          { amount: shareOf(secondRolled + riders.flatSecond), type: secondType },
        ]
      : null;
  let damageDealt = typedParts ? typedParts.reduce((sum, part) => sum + part.amount, 0) : shareOf(total);
  // Harm: never below 1 hit point. The floor is on what gets through the
  // creature's resistances, so those are weighed here and not again.
  const harmFloor = flooredDamage(campaign.id, mech, enemy, damageDealt, damageType, adept ? "Elemental Adept" : null);
  if (harmFloor !== null) {
    damageDealt = harmFloor;
  }
  if (riders.notes.length) {
    base.riders = riders.notes;
  }
  if (saved && riders.potentCantrip && !halfOnSave) {
    base.potentCantrip = "Potent Cantrip: the save still takes half.";
  }
  if (damageDealt > 0) {
    const applied = typedParts && harmFloor === null
      ? landTypedParts({
          campaign,
          turn,
          encounter,
          enemy,
          parts: typedParts,
          sheets,
          sheetsById,
          weapon: { magical: true, ...(adept ? { ignoreResistanceBy: "Elemental Adept" } : {}) },
          ...(secondAdept && secondType ? { ignoreTypes: { types: [secondType], by: "Elemental Adept" } } : {}),
          spell: true,
        })
      : applyEnemyDamage(campaign, turn, encounter, enemy, damageDealt, sheets, sheetsById, harmFloor === null ? damageType : undefined, {
          magical: true,
          spell: true,
          ...(adept ? { ignoreResistance: true } : {}),
        });
    if (adept) {
      base.elementalAdept = `Elemental Adept: ${damageType} ignores resistance; every 1 on the dice counted as 2.`;
    } else if (secondAdept) {
      base.elementalAdept = `Elemental Adept: ${secondType} ignores resistance; every 1 on the dice counted as 2.`;
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
  // Blight's maximum is not the casting's roll: a later creature rolls its own.
  return { dealt: damageDealt, rolled: plantMaximum ? null : rolledTotal, rolledSecond: plantMaximum ? null : secondRolled };
}
