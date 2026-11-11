// The Channel Divinity options that frighten on a failed Wisdom save: Conquering
// Presence and Dreadful Aspect, the foes of the user's choice within 30 feet,
// and Abjure Enemy, one creature within 60 whose speed drops as well. Before this the use was spent and
// the model was left to roll the saves and lay the conditions by hand, or not at all.
//
// Called from feature-spends.ts, whose spend() checks, charges the turn and spends
// the use around it, so a refusal here costs nothing. Must not import mutations.ts.
import { getActiveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { computeSheetDerived } from "@/lib/srd";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import type { ConditionMeta } from "@/lib/dm/condition-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { chosenTargets } from "@/lib/dm/chosen-targets";
import { conditionImmunity } from "@/lib/dm/set-condition";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import type { ToolError } from "@/lib/dm/tool-errors";
import { containsPhrase } from "@/lib/language/text-logic";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The speed Abjure Enemy leaves: rows in authored-conditions.ts.
export const ABJURED = "abjured still";
export const ABJURED_HALF = "abjured slowed";

type FearOption = {
  name: string;
  rangeFt: number;
  // Aimed at one creature, which the call names.
  single?: boolean;
  // The creatures of the user's choice in reach (Conquering Presence, Dreadful
  // Aspect), named in targetEnemyIds; every one when none is named.
  chosen?: boolean;
  // A save at the end of each of its turns ends it (Conquering Presence).
  repeats?: boolean;
  // A save only at the end of a turn it ends farther than this from the user
  // (Dreadful Aspect: 30 feet).
  farSaveFt?: number;
  // Abjure Enemy: frightened and speed 0, or half speed on a success; either
  // ends when the creature takes damage, and fiends and undead save at a
  // disadvantage.
  abjures?: boolean;
  // Who must see whom, past the line between them: "them", creatures the
  // user can see, not an invisible or hidden one nor any while the user is
  // blinded (Conquering Presence and Abjure Enemy: "that you can see");
  // "user", creatures that can see the user (Dreadful Aspect: "if it can see
  // you"), so not a blinded one, nor any while the user is invisible to it.
  sees: "them" | "user";
};

export const CHANNEL_FEAR: FearOption[] = [
  // "Each creature of your choice that you can see within 30 feet". With
  // Dreadful Aspect, a list naming some of them is the player's choice.
  { name: "Conquering Presence", rangeFt: 30, repeats: true, chosen: true, sees: "them" },
  { name: "Dreadful Aspect", rangeFt: 30, chosen: true, farSaveFt: 30, sees: "user" },
  { name: "Abjure Enemy", rangeFt: 60, single: true, abjures: true, sees: "them" },
];

// A sheet standing in as a foe answers for its own immunities (Aura of Courage),
// which its foe view's stats leave out.
function cannotFear(campaign: Campaign, enemy: EncounterEnemy): boolean {
  if (containsPhrase(String(enemy.stats.conditionImmune ?? ""), "frightened")) return true;
  const sheet = getSheetById(enemy.id);
  return Boolean(sheet && conditionImmunity(campaign, sheet, "frightened", true));
}

export function channelFear(
  campaign: Campaign,
  sheet: CharacterSheet,
  option: FearOption,
  targetEnemyId: string | undefined,
  targetEnemyIds?: string[],
): ToolError | { result: Record<string, unknown> } {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: `${option.name} needs creatures to frighten: start the encounter first. Channel Divinity was not spent.`, retry: true };
  }
  let targets: EncounterEnemy[];
  if (option.single && targetEnemyIds?.length) {
    return { error: `${option.name} is aimed at one creature: pass targetEnemyId, not targetEnemyIds. Channel Divinity was not spent.`, retry: true };
  }
  if (option.single) {
    const named = targetEnemyId ? resolveTargetFoe(campaign.id, encounter, targetEnemyId) : null;
    if (!named || named.status !== "alive" || named.currentHp <= 0 || named.id === sheet.id) {
      return { error: `${option.name} names another living creature in the fight: pass targetEnemyId. Channel Divinity was not spent.`, retry: true };
    }
    if (!withinFeet(encounter.id, sheet.id, named.id, option.rangeFt)) {
      return { error: `${named.displayName} is beyond ${option.rangeFt} feet of ${sheet.name}; ${option.name} reaches ${option.rangeFt} feet. Channel Divinity was not spent.`, refused: "rules" };
    }
    const unseen = option.sees === "them" ? unseenBecause(encounter.id, sheet, named) : null;
    if (unseen) {
      return { error: `${sheet.name} cannot see ${named.displayName} (${unseen}), and ${option.name} takes a creature they can see. Channel Divinity was not spent.`, refused: "rules" };
    }
    targets = [named];
  } else {
    targets = foesOfSheet(campaign.id, encounter, sheet.id).filter((enemy) => enemy.status === "alive" && enemy.currentHp > 0 && withinFeet(encounter.id, sheet.id, enemy.id, option.rangeFt));
  }
  // Nothing behind a wall of the board or across a swallower's (swallow.ts) sees them.
  targets = targets.filter(
    (enemy) => !(option.sees === "them" ? unseenBecause(encounter.id, sheet, enemy) : unseenBecause(encounter.id, enemy, sheet)) && !swallowCoverBetween(sheet.id, enemy.id),
  );
  if (!targets.length) {
    return { error: `Nothing ${option.name} affects is within ${option.rangeFt} feet of ${sheet.name}; Channel Divinity was not spent.`, refused: "rules" };
  }
  if (!option.single) {
    const chosen = chosenTargets(option.name, Boolean(option.chosen), targets, { targetEnemyIds, targetEnemyId }, (ref) => resolveTargetFoe(campaign.id, encounter, ref)?.id ?? null);
    if ("error" in chosen) {
      return chosen;
    }
    targets = chosen;
  }
  const derived = computeSheetDerived(sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.cha;
  const outcomes: string[] = [];
  for (const enemy of targets) {
    if (cannotFear(campaign, enemy)) {
      outcomes.push(`${enemy.displayName} cannot be frightened.`);
      continue;
    }
    const type = String(enemy.stats.type ?? "");
    const save = rollEnemySave(campaign.id, enemy, "wis", dc, {
      magical: true,
      // A Channel Divinity's save (Elder Champion reads it).
      channel: true,
      resist: true,
      against: "frightened",
      disadvantage: Boolean(option.abjures && (containsPhrase(type, "fiend") || containsPhrase(type, "undead"))),
      record: { detail: `${enemy.displayName}: WIS save against ${option.name}` },
    });
    // No spell tag: this is no spell for Dispel Magic to end.
    const lasting: ConditionMeta = { source: sheet.id, rounds: 10, ...(option.abjures ? { endsOnDamage: true } : {}) };
    // Each laid on the creature as it now stands: the save itself can spend a
    // condition it held (Unsettling Words' die), and a second caster's fear stays.
    const lay = (condition: string, meta: ConditionMeta) => {
      const fresh = resolveTargetFoe(campaign.id, encounter, enemy.id);
      if (fresh) layEnemyConditionInstance(campaign, fresh, condition, meta);
    };
    const resisted = save.legendaryResistance ? "with Legendary Resistance" : `(WIS ${save.total} vs DC ${dc})`;
    if (save.success) {
      if (option.abjures) {
        lay(ABJURED_HALF, lasting);
        outcomes.push(`${enemy.displayName} resists ${resisted}, and its speed is halved for a minute or until it takes damage.`);
      } else {
        outcomes.push(`${enemy.displayName} resists ${resisted}.`);
      }
      continue;
    }
    const saveEnds = option.repeats ? { ability: "wis" as const, dc } : option.farSaveFt ? { ability: "wis" as const, dc, beyondFeet: option.farSaveFt } : null;
    lay("frightened", { ...lasting, ...(saveEnds ? { saveEnds } : {}) });
    if (option.abjures) lay(ABJURED, lasting);
    outcomes.push(`${enemy.displayName} is frightened for a minute (WIS ${save.total ?? "failed"} vs DC ${dc})${option.abjures ? ", and its speed is 0 until it takes damage" : option.repeats ? ", saving again at the end of each of its turns" : option.farSaveFt ? `, saving again at the end of a turn it ends more than ${option.farSaveFt} feet away` : ""}.`);
  }
  return { result: { applied: outcomes } };
}
