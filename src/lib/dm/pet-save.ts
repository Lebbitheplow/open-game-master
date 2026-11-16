// A pet's saving throw on the doors that force one on a character. SRD 5.1,
// Saving Throws: each creature an effect forces to save makes its own, from
// its own statistics. No door rolled one for a pet: an area or a spell that
// caught a familiar or a companion was apply_damage with petName and a
// number the GM chose.
//
//   areaOnPets: an area that catches a character catches their pets, which
//     stand with them (ruling D2, pet-place.ts): aoe_damage, for a player's
//     area spell, a monster's breath or area, a trap or a falling ceiling
//     (src/lib/dm/aoe-characters.ts).
//   castAtPet: a save forced on the pet alone, by an enemy's spell or
//     ability or by a hazard: cast_at_player with petName
//     (src/lib/dm/cast-at-player.ts).
//
// The save is the pet's own (pet-save-roll.ts): its block's bonus, its
// state, Magic Resistance, and a paladin's Aura of Protection over its
// owner's square. What it leaves lands through apply_damage's own pet path
// (pet-tools.ts hurtPet): resistances, immunities, a familiar's vanishing. A
// failed save's condition is laid on the pet as on a character
// (pet-condition-lay.ts) and ends on the pet's clock (pet-conditions.ts).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { RollAttacker } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { isValidExpression } from "@/lib/dice";
import { rollAgainst } from "@/lib/roll-labels";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { spellFactsFor, spellMechanicsFor } from "@/lib/content";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { partsTaken, partsTotal, splitDamageExpression, type DamagePart } from "@/lib/dm/aoe-parts";
import { castToNoEffect, spellWardOn } from "@/lib/dm/cast-reach";
import type { ConditionMeta } from "@/lib/dm/condition-logic";
import { secondTypeShare } from "@/lib/dm/damage-parts";
import { prepareEnemyUse, type EnemyUse } from "@/lib/dm/enemy-casting";
import { petCreatureType } from "@/lib/dm/pet-build";
import { layPetFailedSave, layPetSpellConditions, type PetLaid } from "@/lib/dm/pet-condition-lay";
import { petDamageShare } from "@/lib/dm/pet-save-logic";
import { rollPetSave, type PetSave } from "@/lib/dm/pet-save-roll";
import { findPet, hurtPet, noPet } from "@/lib/dm/pet-tools";
import { rollCard } from "@/lib/dm/roll-card";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { ToolResult } from "@/lib/dm/tool-errors";

export { petSaveBlockFor, rollPetSave, type PetSave } from "@/lib/dm/pet-save-roll";

// The row a pet's save and damage leave on a result.
function petRow(pet: SheetPet, save: PetSave, hurt: Record<string, unknown> | null, laid: PetLaid | null): Record<string, unknown> {
  const { ok: _ok, pet: _name, ...landed } = hurt ?? {};
  void _ok;
  void _name;
  return {
    pet: pet.name,
    ...(save.autoFailed ? { autoFailed: save.notes.join("; ") } : { save: save.total }),
    success: save.success,
    ...(save.notes.length && !save.autoFailed ? { saveNotes: save.notes } : {}),
    ...(save.evasion ? { evasion: save.success ? "no damage" : "half damage" } : {}),
    ...(hurt ? landed : { damage: 0 }),
    ...(laid?.laid.length ? { conditionApplied: laid.laid.join(", ") } : {}),
    ...(laid?.refused.length ? { conditionRefused: laid.refused.join(" ") } : {}),
  };
}

// What an area lays on a creature that fails its save, as aoe_damage lays it
// on a character (aoe-damage.ts): a player's spell's conditions with its
// record, an enemy's use by its block's words, or the condition the caller
// named for a hazard, timed by `rounds` or ended by a save each turn.
export type AreaLays = {
  spell?: { conditions: readonly string[]; meta: ConditionMeta } | null;
  use?: EnemyUse | null;
  named?: { condition: string; rounds?: number } | null;
};

const laysAny = (lays: AreaLays | undefined) => Boolean(lays?.spell?.conditions.length || lays?.use?.condition || lays?.use?.failBy || lays?.named);

// An area that caught this character caught their pets beside them (ruling
// D2): each makes the area's save, takes what it leaves and, on a failure,
// what it lays. Null when the owner has no pet standing or the area neither
// hurts nor lays anything.
export function areaOnPets(input: {
  campaign: Campaign;
  turn: DmTurn;
  owner: CharacterSheet;
  ability: SaveAbility;
  dc: number;
  halfOnSave: boolean;
  blast: DamagePart[];
  magical: boolean;
  source: string;
  lays?: AreaLays;
}): Array<Record<string, unknown>> | null {
  // A net, a web or a dragon's paralyzing breath deals nothing and binds:
  // before, a pet caught in one rolled no save and stayed free.
  if (partsTotal(input.blast) <= 0 && !laysAny(input.lays)) {
    return null;
  }
  const owner = getSheetById(input.owner.id) ?? input.owner;
  // A familiar in its pocket dimension is not in the area (pet-pocket.ts).
  const standing = owner.pets.filter((pet) => pet.hp > 0 && !pet.pocketed);
  if (!standing.length) {
    return null;
  }
  return standing.map((pet) => {
    const save = rollPetSave(input.campaign, input.turn, owner, pet, { ability: input.ability, dc: input.dc, magical: input.magical, source: input.source });
    const share = petDamageShare({ saved: save.success, halfOnSave: input.halfOnSave, ability: input.ability, evasion: save.evasion });
    const parts = partsTaken(input.blast, share).filter((part) => part.amount > 0);
    const hurt = parts.length ? hurtPet(input.campaign, owner, pet, { parts, magical: input.magical }) : null;
    const laid = save.success ? null : areaLaysOnPet(input, owner, pet, save);
    return petRow(pet, save, hurt, laid);
  });
}

function areaLaysOnPet(input: Parameters<typeof areaOnPets>[0], owner: CharacterSheet, pet: SheetPet, save: PetSave): PetLaid | null {
  const lays = input.lays;
  const failed = { ability: input.ability, dc: input.dc, total: save.total };
  if (lays?.spell?.conditions.length) {
    return layPetSpellConditions(input.campaign, owner, pet, lays.spell.conditions, lays.spell.meta);
  }
  if (lays?.use && (lays.use.condition || lays.use.failBy)) {
    return layPetFailedSave(input.campaign, owner, pet, { use: lays.use, condition: lays.use.condition, save: failed, timing: { rounds: lays.use.rounds, saveEnds: Boolean(lays.use.saveEnds) }, magical: lays.use.magical });
  }
  if (lays?.named) {
    return layPetFailedSave(input.campaign, owner, pet, { use: null, condition: lays.named.condition, save: failed, timing: { rounds: lays.named.rounds, saveEnds: !lays.named.rounds }, magical: input.magical });
  }
  return null;
}

export type CastAtPetArgs = {
  petName: string;
  source?: string;
  saveAbility?: SaveAbility;
  dc?: number;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  rounds?: number;
  casterEnemyId?: string;
  enemyAbility?: string;
  spell?: string;
};

// cast_at_player at a character's pet: an enemy's spell or ability (its
// action, its block's numbers, as at a character: enemy-casting.ts), or a
// hazard with the caller's numbers, forcing a save on the pet alone.
export function castAtPet(campaign: Campaign, turn: DmTurn, args: CastAtPetArgs, owner: CharacterSheet): ToolResult {
  const pet = findPet(owner, args.petName);
  if (!pet) {
    return noPet(owner, args.petName);
  }
  if (pet.hp <= 0) {
    return { error: `${pet.name} is at 0 hit points; the effect has nothing left to do to it. Nothing was spent.`, retry: true };
  }
  const authors = spellAuthorsFor(campaign);
  // A spell for some creature types only (Hold Person: a humanoid) passes
  // over a pet of another type: a familiar is a celestial, fey or fiend.
  const kinds = args.spell ? spellMechanicsFor({ spell: args.spell, userIds: authors })?.mech.targetTypes : undefined;
  const kind = petCreatureType(pet).toLowerCase();
  if (kinds?.length && !kinds.some((type) => kind.includes(type))) {
    return { error: `${args.spell} affects only ${kinds.join(" or ")} creatures, and ${pet.name} is ${kind}. Nothing was spent; the enemy may target someone else or take another action.`, retry: true };
  }
  let use: EnemyUse | null = null;
  let ward: string | null = null;
  if (args.casterEnemyId) {
    // The charmer rule names a creature the caster may not harm; the pet is
    // not its charmer, so no target is named for it.
    const prepared = prepareEnemyUse(campaign, {
      casterEnemyId: args.casterEnemyId,
      enemyAbility: args.enemyAbility,
      spell: args.spell,
      source: args.source,
      targetIds: [],
      sent: { save: args.saveAbility, dc: args.dc, damage: args.damage },
    });
    if ("error" in prepared) {
      return prepared;
    }
    // A Globe of Invulnerability or an Antimagic Field around the owner's
    // square holds the pet beside them too (zone-rules.ts).
    ward = spellWardOn({ encounterId: prepared.enemy.encounterId, casterId: prepared.enemy.id, targetId: owner.id, targetName: pet.name, facts: args.spell ? spellFactsFor(args.spell, authors) : null });
    use = prepared;
  }
  const castName = use?.name || args.spell;
  if (use?.hitPointPool) {
    return { error: `${castName} counts hit points across the creatures it reaches, with no save to make; resolve it with aoe_damage. Nothing was spent.`, retry: true };
  }
  const unsaved = castName && !use?.save && !args.saveAbility ? spellMechanicsFor({ spell: castName, userIds: authors }) : null;
  if (castName && unsaved?.mech.resolution === "auto") {
    return { error: `${castName} hits without a save; at a pet it is apply_damage with petName and its dice. Nothing was spent.`, retry: true };
  }
  const byBlock = Boolean(use?.fromBlock);
  const ability = (use?.save ?? args.saveAbility) as SaveAbility | undefined;
  const dc = use?.dc ?? args.dc;
  if (!ability || !dc) {
    return {
      error: "cast_at_player needs saveAbility and dc for a hazard with no creature behind it; an enemy's ability or spell (casterEnemyId with enemyAbility or spell) brings its own.",
      retry: true,
    };
  }
  const damage = byBlock ? use?.damage : args.damage;
  const damageType = (byBlock ? use?.damageType : undefined) ?? args.damageType;
  const halfOnSave = byBlock ? Boolean(use?.halfOnSave) : Boolean(args.halfOnSave);
  const conditionName = byBlock ? use?.condition : args.condition;
  if (!damage && !conditionName) {
    return {
      error: use?.fromBlock
        ? `${use.name} forces no save with damage or a condition on ${use.enemy.displayName}'s block; narrate what it does, or use its attacks.`
        : "cast_at_player needs damage and/or condition; otherwise nothing happens.",
      retry: true,
    };
  }
  if (damage && !isValidExpression(damage)) {
    return { error: `Invalid damage expression "${damage}".`, retry: true };
  }
  use?.commit();
  const source = (args.source ?? (use ? `${use.enemy.displayName}'s ${use.name}` : "the effect")).trim() || "the effect";
  const target = `${pet.name} (${owner.name}'s ${pet.kind === "beast_companion" ? "companion" : pet.kind === "other" ? "pet" : pet.kind})`;
  if (ward) {
    return { ok: true, target, source, ...castToNoEffect(ward) };
  }
  const magical = Boolean(use?.magical) || Boolean(args.spell);
  const save = rollPetSave(campaign, turn, owner, pet, { ability, dc, magical, source });
  const base: Record<string, unknown> = {
    ok: true,
    target,
    source,
    saveAbility: ability,
    dc,
    ...(save.total === null ? { autoFailed: true } : { save: save.total }),
    saved: save.success,
    ...(save.notes.length ? { conditionEffects: save.notes } : {}),
    ...(use?.corrections.length ? { corrected: use.corrections } : {}),
  };
  if (damage) {
    const caster: RollAttacker | null = use ? { kind: "enemy", id: use.enemy.id, name: use.enemy.displayName } : null;
    const outcome = rollCard(campaign, turn, null, "damage", rollAgainst(castName || args.source || "Effect", pet.name), damage, caster);
    // A creature's effect of two types: each share meets the pet's defenses
    // on its own (src/lib/dm/cast-at-player.ts does the same for a character).
    const secondType = byBlock ? use?.secondType : undefined;
    const [, secondDice] = splitDamageExpression(damage, secondType) ?? [];
    const second = secondDice && damageType && secondType ? secondTypeShare(outcome, damageType, { dice: secondDice, type: secondType }) : null;
    const rolled: DamagePart[] = second !== null && secondType
      ? [{ amount: outcome.total - second, type: damageType }, { amount: second, type: secondType }]
      : [{ amount: outcome.total, type: damageType }];
    const share = petDamageShare({ saved: save.success, halfOnSave, ability, evasion: save.evasion });
    const parts = partsTaken(rolled, share).filter((part) => part.amount > 0);
    if (save.evasion) {
      base.evasion = save.success ? "no damage" : "half damage";
    }
    if (parts.length) {
      const { ok: _ok, pet: _name, ...landed } = hurtPet(campaign, owner, pet, { parts, magical });
      void _ok;
      void _name;
      Object.assign(base, landed);
    } else {
      base.damage = 0;
    }
  }
  // What the failure lays, timed as on a character (cast-at-player.ts): the
  // block's count and repeat save, or the hazard's rounds, else a save at the
  // end of each of its owner's turns.
  const standing = findPet(getSheetById(owner.id) ?? owner, pet.name);
  if (!save.success && standing && standing.hp > 0 && (conditionName || (byBlock && use?.failBy))) {
    const laid = layPetFailedSave(campaign, owner, standing, {
      use,
      condition: conditionName,
      save: { ability, dc, total: save.total },
      timing: { rounds: byBlock ? use?.rounds : args.rounds, saveEnds: byBlock ? Boolean(use?.saveEnds) : !args.rounds },
      magical,
    });
    if (laid.laid.length) {
      base.conditionApplied = laid.laid.join(", ");
    }
    if (laid.refused.length) {
      base.conditionRefused = laid.refused.join(" ");
    }
  } else if (conditionName && save.success) {
    base.note = `${pet.name} shakes it off: no ${conditionName}.`;
  }
  if (use?.followUp) {
    base.next = `${use.name} also forces a second save on the creatures its text names: resolve it with cast_at_player or aoe_damage, casterEnemyId ${use.enemy.id} and enemyAbility "${use.followUp}".`;
  }
  // The enemy's concentration is tracked by cast_at_player, which called
  // this (cast-at-player.ts trackEnemyConcentration).
  return base;
}
