// What a counter asks of the moment before a use is spent, the one rule the
// Hand's card and use_resource both read. Before this the card read only the
// uses and the turn, and the engine its own checks: Rage was open while the
// barbarian raged, Unearthly Recovery above half hit points, Eldritch
// Master's minute-long entreaty in the middle of a fight, and each was
// refused once played.
//
// Every precondition a counter's row states (ResourceDef.requires,
// outOfFight, an effect already running) is answered here. The card shuts on
// the sentence (src/lib/battlemap/hand-spells.ts featureCards) and
// use_resource refuses with it (src/lib/dm/resource-tools.ts
// computeUseResource), so a new precondition goes on the row and here, never
// at one door alone.
//
// Pure.
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import type { ResourceDef, SaveTerms } from "@/lib/srd/class-resources";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import { heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { resourceDef } from "@/lib/srd/class-resources";

type GateSheet = Pick<CharacterSheet, "name" | "currentHp" | "maxHp" | "conditions"> & Partial<Pick<CharacterSheet, "conditionMeta" | "exhaustion" | "wildShape">>;

// `inFight`: a fight is on (true), none is (false), or the caller cannot
// tell (null: an older server's Hand), when the fight-bound rules are left
// to the engine.
export function counterGate(def: ResourceDef, sheet: GateSheet, inFight: boolean | null): string | null {
  if (def.requires === "below_half") {
    const max = effectiveMaxHp(sheet as CharacterSheet);
    if (sheet.currentHp >= max / 2) {
      return `${def.displayName} is used when ${sheet.name} has fewer than half of their hit points left, and they have ${sheet.currentHp}/${max}.`;
    }
  }
  if (def.outOfFight && inFight === true) {
    return `${def.displayName} takes a minute or more of work, so it is used out of a fight, not in the middle of one.`;
  }
  if (def.fightOnly && inFight === false) {
    return `${def.displayName} works on the creatures of a fight; there is none.`;
  }
  // A self effect already running is not entered again (a rage while raging).
  const running = def.effect.kind === "condition" || (def.effect.kind === "buff" && def.effect.target !== "ally" && !def.effect.variants?.length) ? def.effect.condition : null;
  if (running && sheet.conditions.some((entry) => textKey(entry) === textKey(running))) {
    return `${sheet.name} is already ${running}; the feature is already running.`;
  }
  return null;
}

// The DC a counter's save is held to (SaveTerms.dcAbility): the spell save
// DC, or 8 + proficiency + an ability's modifier; `fallback` is the
// modifier the row's kind used before it named one.
export function counterSaveDc(
  ability: SaveTerms["dcAbility"],
  derived: { proficiencyBonus: number; abilityMods: Record<string, number>; spellSaveDc?: number | null },
  fallback: number,
): number {
  if (ability === "spell") {
    return derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int ?? 0, derived.abilityMods.wis ?? 0, derived.abilityMods.cha ?? 0);
  }
  return 8 + derived.proficiencyBonus + (ability ? (derived.abilityMods[ability] ?? 0) : fallback);
}


// What a use costs of the turn: the row's ResourceDef.action, the one field
// the Hand's cost pill and use_resource's charge read (class-resources.ts
// withStatedCost), with the one feature that changes another's cost: Combat
// Wild Shape (Circle of the Moon) makes Wild Shape a bonus action. Its card
// said action and stayed open with the bonus action spent.
export function counterCost(def: ResourceDef, sheet: { features?: ReadonlyArray<{ name: string }>; feats?: readonly string[] }): ResourceDef["action"] {
  if (def.effect.kind === "wild_shape" && holdsFeature(sheet, "Combat Wild Shape")) {
    return "bonus";
  }
  return def.action;
}

// Whether the character holds something that rides a weapon hit of this turn
// on the creature it landed on (Arcane Jolt, Blade Flourish, Psionic Strike,
// Gathered Swarm's push, Fury of the Small): the hit is then marked on the
// turn (src/lib/dm/attack-swing.ts), and each of those reads the mark.
export function ridesWeaponHit(sheet: AuthoredSheet & { resources?: Record<string, unknown> }): boolean {
  const spends = heldAuthored(sheet).flatMap((held) => held.entry.spends ?? []);
  if (spends.some((spend) => spend.afterWeaponHit || (spend.does.kind === "variants" && Object.values(spend.does.options).some((option) => option.afterWeaponHit)))) {
    return true;
  }
  return Object.keys(sheet.resources ?? {}).some((id) => resourceDef(id)?.effect.kind === "hit_damage");
}
