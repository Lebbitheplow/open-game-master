// A wizard spell that dealt damage to a creature on its caster's turn, kept on
// that turn at the creature it hurt, as a weapon's hit is (attack-swing.ts
// WEAPON_HIT). Power Surge (War Magic 6) reads it: "Once per turn when you
// deal damage to a creature or object with a wizard spell, you can spend one
// to deal extra force damage" (authored-spends.ts afterSpellDamage). Before
// this the surge was a counter with guidance: the use went and the force
// damage was the GM's to add by hand.
//
// Every path that deals a character's spell damage to a creature marks here:
// cast_at_enemy (cast-at-enemy-damage.ts landSpellDamage), aoe_damage with a
// caster (aoe-damage.ts) and a spell attack through pc_attack
// (pc-attack-damage.ts applyHitDamage). A new spell damage path calls it too.
//
// Off the caster's own turn (a readied spell) there is no turn to keep the
// mark on, so the surge waits for the wizard's turn, as a weapon hit's riders do.

import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { budgetApplies } from "@/lib/dm/action-budget";
import { storeBudget } from "@/lib/dm/turn-budget";
import { spellFactsFor } from "@/lib/content";
import { WIZARD_SPELL_DAMAGE } from "@/lib/dm/spell-damage-logic";

export { WIZARD_SPELL_DAMAGE, spellHurt } from "@/lib/dm/spell-damage-logic";

// A spell no list names (homebrew, an unlisted pack spell) is taken as the
// wizard's, as Empowered Evocation reads it (spell-damage-riders.ts).
export function isWizardSpell(spell: string | null | undefined, classes?: readonly string[] | null): boolean {
  const lists = classes ?? (spell ? spellFactsFor(spell)?.classes : undefined) ?? [];
  return !lists.length || lists.includes("wizard");
}

export function markSpellDamage(campaignId: string, casterId: string, enemyId: string, spell: string | null | undefined, classes?: readonly string[] | null): void {
  if (!isWizardSpell(spell, classes)) {
    return;
  }
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  if (!encounter || !budgetApplies(budget, casterId, encounter.round)) {
    return;
  }
  const key = `${WIZARD_SPELL_DAMAGE}${enemyId}`;
  if (!budget.oncePerTurn.includes(key)) {
    storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, key] });
  }
}

// "You gain one whenever you end a spell with dispel magic or counterspell"
// (Power Surge), up to the counter's maximum. Called by Counterspell
// (reaction-spells.ts finishCounterspell) and Dispel Magic (dispel.ts) once a
// spell has ended. The line for the result, or null when nothing came back.
export function gainPowerSurge(campaignId: string, casterId: string): string | null {
  const sheet = getSheetById(casterId);
  const state = sheet?.resources?.[POWER_SURGE];
  if (!sheet || !state || state.used <= 0) {
    return null;
  }
  const updated = patchSheet(sheet.id, { resources: { ...sheet.resources, [POWER_SURGE]: { max: state.max, used: state.used - 1 } } });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return `Power Surge: ${sheet.name} gains a surge for ending a spell (${state.max - state.used + 1}/${state.max}).`;
}

const POWER_SURGE = "sub_power_surge";
