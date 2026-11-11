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
import { spellsOn } from "@/lib/srd/mt-srd-spells-on";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import type { ResourceDef, SaveTerms } from "@/lib/srd/class-resources";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";
import { heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { resourceDef } from "@/lib/srd/class-resources";
import { ARTISANS_TOOLS } from "@/lib/srd/tool-choices";
import { INFUSE_COUNTER, infusionPicks } from "@/lib/srd/infusion-picks";

type GateSheet = Pick<CharacterSheet, "name" | "currentHp" | "maxHp" | "conditions"> & Partial<Pick<CharacterSheet, "conditionMeta" | "exhaustion" | "wildShape" | "concentratingOn" | "equipment">>;

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
  // The Right Tool for the Job: thieves' tools or artisan's tools in hand
  // (src/lib/dm/mt-srd-artificer.ts asks the same at the door).
  if (def.requires === "tools_in_hand" && sheet.equipment && !sheet.equipment.some((item) => [...ARTISANS_TOOLS, "thieves' tools"].some((tools) => textKey(item.name) === textKey(tools)))) {
    return `${def.displayName} needs thieves' tools or a set of artisan's tools in hand, and ${sheet.name}'s pack holds neither.`;
  }
  // Infuse Item: an infusion the artificer knows and an item of theirs that
  // can take it (src/lib/srd/infusion-picks.ts; the door asks the same).
  if (def.id === INFUSE_COUNTER && "features" in sheet && !infusionPicks(sheet as unknown as Parameters<typeof infusionPicks>[0]).length) {
    return `${def.displayName} lays an infusion ${sheet.name} knows in a nonmagical item they carry, and they know none that an item of theirs can take.`;
  }
  if (def.outOfFight && inFight === true) {
    return `${def.displayName} takes a minute or more of work, so it is used out of a fight, not in the middle of one.`;
  }
  if (def.fightOnly && inFight === false) {
    return `${def.displayName} works on the creatures of a fight; there is none.`;
  }
  // Cleansing Touch ends a spell, and needs one to end. The card is the
  // paladin's own (use_resource names an ally in targetCharacterId, and the
  // engine reads that ally's spells: dm/mt-srd-paladin.ts).
  if (def.id === "cleansing_touch" && !spellsOn(sheet).size) {
    return `No spell lies on ${sheet.name} for Cleansing Touch to end.`;
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
//
// And the one use that costs something else: a druid already in a shape is
// asking to leave it, and "You can revert to your normal form earlier by
// using a bonus action on your turn" (SRD 5.1, Wild Shape).
export function counterCost(def: ResourceDef, sheet: { features?: ReadonlyArray<{ name: string }>; feats?: readonly string[]; wildShape?: unknown }): ResourceDef["action"] {
  if (def.effect.kind === "wild_shape" && (sheet.wildShape || holdsFeature(sheet, "Combat Wild Shape"))) {
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

// What pays for a use when the counter has none left: the pool its row
// names (Breath of the Dragon's 2 ki, five sorcery points)
// or the lowest unspent spell slot of the row's level or higher ("or by
// expending a spell slot of 3rd level or higher"); null
// when neither can. use_resource pays it (src/lib/dm/resource-tools.ts
// payForUse) and the Hand's card stays open on it (hand-spells.ts), so a
// new price goes on the row and is read here, never at one door.
export type OtherPrice = { pool: { id: string; amount: number } } | { slot: number };

export function otherPrice(
  def: Pick<ResourceDef, "fallbackPool" | "slotFallback">,
  sheet: { resources?: Record<string, { max: number; used: number }>; spellcasting?: { slots?: Record<string, { max: number; used: number }> } | null },
): OtherPrice | null {
  const pool = def.fallbackPool;
  const state = pool ? sheet.resources?.[pool.id] : undefined;
  if (pool && state && state.max - state.used >= pool.amount) {
    return { pool };
  }
  if (def.slotFallback) {
    const open = Object.entries(sheet.spellcasting?.slots ?? {})
      .map(([level, slot]) => ({ level: Number(level), slot }))
      .filter(({ level, slot }) => level >= def.slotFallback! && slot.used < slot.max)
      .sort((one, two) => one.level - two.level);
    if (open.length) {
      return { slot: open[0].level };
    }
  }
  return null;
}
