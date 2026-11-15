// What a failed save lays on a pet (SRD 5.1, Saving Throws: the effect lands
// on each creature that fails; Find Familiar: the familiar "has the
// statistics of the chosen form", its condition immunities included). Before
// this a pet that failed against Hold Monster, a net or a ghoul's claws took
// the damage and none of the condition, and went on attacking and helping.
//
// The condition is laid as on a character: the instance set_condition builds
// (set-condition.ts incomingConditionMeta) with the effect's own count, its
// repeat save and its source, or a spell's own record (spell-effects.ts
// spellConditionMeta), so the clock that ends a character's ends the pet's
// (pet-conditions.ts). Its block's condition immunities, petrified's poison,
// a spell it carries (Heroism shared to it) and a paladin's aura over its
// owner's square keep a condition off.

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { conditionAuraBeside } from "@/lib/dm/aura";
import { addConditionInstance, durationArgsFor, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { petrifiedRefusal } from "@/lib/dm/damage-logic";
import type { EnemyUse } from "@/lib/dm/enemy-casting";
import { petSaveBlockFor } from "@/lib/dm/pet-save-roll";
import { canonicalCondition, incomingConditionMeta, MAX_CONDITIONS } from "@/lib/dm/set-condition";
import { spellConditionMeta } from "@/lib/dm/spell-effects";
import { namesExhaustion } from "@/lib/dm/vitals-logic";
import { conditionGrantedImmunity } from "@/lib/srd/condition-effect-queries";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

// The record as it stands now: several conditions land in one call.
function petNow(owner: CharacterSheet, pet: SheetPet): { sheet: CharacterSheet; pet: SheetPet | null } {
  const sheet = getSheetById(owner.id) ?? owner;
  return { sheet, pet: sheet.pets.find((entry) => entry.name === pet.name && entry.kind === pet.kind) ?? null };
}

// Why this condition cannot be laid on the pet, or null.
export function petConditionImmunity(campaign: Campaign, owner: CharacterSheet, pet: SheetPet, condition: string, magical: boolean, sourceEnemyId?: string): string | null {
  const wanted = textKey(condition);
  const stone = petrifiedRefusal(pet.conditions, wanted);
  if (stone) {
    return stone;
  }
  // "Condition Immunities poisoned" on an imp's or a quasit's block.
  const immune = (petSaveBlockFor(campaign, owner, pet).conditionImmune ?? "").split(",").map(textKey);
  if (immune.includes(wanted)) {
    return `the ${pet.form}'s stat block makes it immune`;
  }
  const source = sourceEnemyId ? getEnemy(sourceEnemyId) : null;
  const warded = conditionGrantedImmunity(pet.conditions ?? [], wanted, source ? String(source.stats.type ?? "") : undefined, magical);
  if (warded) {
    return `${warded} makes it immune`;
  }
  const aura = conditionAuraBeside(campaign.id, getSheetById(owner.id) ?? owner, wanted);
  return aura ? `${aura} protects it` : null;
}

export type PetLay = { condition: string; meta?: ConditionMeta; magical: boolean; sourceEnemyId?: string };

// One condition on the pet, laid with its instance: a second source keeps its
// own lifetime beside the first (condition-logic.ts addConditionInstance), as
// on a character.
export function layPetCondition(campaign: Campaign, owner: CharacterSheet, pet: SheetPet, lay: PetLay): { ok: true; condition: string } | { error: string; refused: "rules" } {
  const name = canonicalCondition(lay.condition);
  const now = petNow(owner, pet);
  if (!name || !now.pet || now.pet.hp <= 0) {
    return { error: `${pet.name} is down; nothing more lands on it.`, refused: "rules" };
  }
  // A pet keeps no exhaustion track: its record has hit points and an Armor
  // Class, not the six levels (said so the narration does not invent one).
  if (namesExhaustion(name)) {
    return { error: `${pet.name}'s record keeps no exhaustion levels; the GM narrates what it does to the creature.`, refused: "rules" };
  }
  const immune = petConditionImmunity(campaign, now.sheet, now.pet, name, lay.magical, lay.sourceEnemyId);
  if (immune) {
    return { error: `${pet.name} cannot be ${name}: ${immune}.`, refused: "rules" };
  }
  const conditions = now.pet.conditions ?? [];
  if (!conditions.includes(name) && conditions.length >= MAX_CONDITIONS) {
    return { error: `${pet.name} already holds ${MAX_CONDITIONS} conditions, the most a record keeps, so ${name} was not laid.`, refused: "rules" };
  }
  const laid = addConditionInstance(conditions, (now.pet.conditionMeta ?? {}) as ConditionMetaMap, name, lay.meta);
  const target = now.pet;
  const pets = now.sheet.pets.map((entry) => (entry === target ? { ...entry, conditions: laid.conditions, conditionMeta: laid.meta } : entry));
  const updated = patchSheet(now.sheet.id, { pets });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return { ok: true, condition: name };
}

export type PetLaid = { laid: string[]; refused: string[] };

// The instances one failed save of an enemy's use lays, by condition, as
// cast-at-player.ts layEnemyCondition lays them on a character: a spell's
// whole record (Hold Monster ends with the caster's concentration and on a
// save at the end of each turn), a block's own words (a count, a repeat
// save, a long rest, a turn it lasts until), a sleep that wakes when hurt.
// With no use (a hazard) the caller's count or, with none, a save each turn.
function instancesFor(
  campaignId: string,
  owner: CharacterSheet,
  pet: SheetPet,
  use: EnemyUse | null,
  condition: string,
  save: { ability: SaveAbility; dc: number },
  timing: { rounds?: number; saveEnds: boolean },
): Array<[string, ConditionMeta | undefined]> {
  if (use?.spellCondition) {
    const spellEffect = spellConditionMeta(
      { ...use.spellCondition, ...use.spellCondition.variantRules?.[condition] },
      { spell: use.name, casterId: use.enemy.id, slotLevel: use.slotLevel },
      { ability: save.ability, dc: save.dc },
    );
    const also = (use.spellCondition.also ?? []).filter((name) => textKey(name) !== textKey(condition));
    return [condition, ...also].map((name) => [name, spellEffect]);
  }
  const lasting = Boolean(use?.untilLongRest || use?.lasting);
  const laid = [use?.condition, ...(use?.also ?? [])];
  const wakes = condition === "unconscious" || !laid.includes("unconscious");
  if (use?.untilLongRest) {
    return [[condition, { source: use.enemy.id, untilLongRest: true, ...(use.endsOnDamage && wakes ? { endsOnDamage: true } : {}) }]];
  }
  let meta = incomingConditionMeta(
    campaignId,
    condition,
    {
      ...(timing.rounds ? durationArgsFor(timing.rounds) : {}),
      ...(timing.saveEnds || (!timing.rounds && !lasting) ? { saveAbility: save.ability, saveDc: save.dc } : {}),
      ...(use ? { sourceEnemyId: use.enemy.id } : {}),
    },
    { currentHp: pet.hp },
  );
  // "Until the end of the mummy lord's next turn" (turn-tie.ts): the pet's
  // turn is its owner's.
  if (use?.until && meta) {
    const turnOf = use.until.whose === "source" ? use.enemy.id : owner.id;
    const tied: ConditionMeta = use.until.edge === "end" ? { ...meta, untilTurnEndOf: turnOf } : { ...meta, untilTurnOf: turnOf };
    delete tied.rounds;
    delete tied.turnBegun;
    meta = tied;
  }
  if (use?.endsOnDamage && wakes && meta) {
    meta = { ...meta, endsOnDamage: true };
  }
  return [[condition, meta]];
}

// What a failed save lays on the pet: the effect's condition, and from a
// creature's block the conditions listed with it and the one a failure by a
// margin adds (cast-at-player.ts layFailedSaveExtras). `total` is the save
// rolled, null for one failed without a roll.
export function layPetFailedSave(
  campaign: Campaign,
  owner: CharacterSheet,
  pet: SheetPet,
  input: {
    use: EnemyUse | null;
    condition?: string;
    save: { ability: SaveAbility; dc: number; total: number | null };
    timing: { rounds?: number; saveEnds: boolean };
    magical: boolean;
  },
): PetLaid {
  const { use, save } = input;
  const margin = use?.fromBlock && use.failBy && save.total !== null && save.dc - save.total >= use.failBy.margin ? [use.failBy.condition] : [];
  const names = [...(input.condition ? [input.condition] : []), ...(use?.fromBlock ? [...(use.also ?? []), ...margin] : [])].map(canonicalCondition);
  const out: PetLaid = { laid: [], refused: [] };
  for (const name of [...new Set(names)]) {
    for (const [condition, meta] of instancesFor(campaign.id, owner, pet, use, name, save, input.timing)) {
      const laid = layPetCondition(campaign, owner, pet, { condition, meta, magical: input.magical, sourceEnemyId: use?.enemy.id });
      if ("error" in laid) {
        out.refused.push(laid.error);
      } else if (!out.laid.includes(laid.condition)) {
        out.laid.push(laid.condition);
      }
    }
  }
  return out;
}

// What a player's area spell lays on a pet that failed its save (an ally's
// Web catching the ranger's wolf): each of the spell's conditions, recorded
// with the spell and caster as on a character (aoe-characters.ts).
export function layPetSpellConditions(campaign: Campaign, owner: CharacterSheet, pet: SheetPet, conditions: readonly string[], meta: ConditionMeta): PetLaid {
  const out: PetLaid = { laid: [], refused: [] };
  for (const condition of conditions) {
    const laid = layPetCondition(campaign, owner, pet, { condition, meta, magical: true });
    if ("error" in laid) {
      out.refused.push(laid.error);
    } else {
      out.laid.push(laid.condition);
    }
  }
  return out;
}
