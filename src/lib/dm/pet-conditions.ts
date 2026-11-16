// A pet's conditions as time and turns run: the counts run down, the saves
// that end one are rolled, and what lasted until a turn ends with it. Before
// this a pet's record kept only what its bond lays (the Dodge, a command, a
// shared spell): a familiar that failed against Hold Monster took the damage
// and kept acting, because nothing could ever end a condition laid on it.
//
// The machinery is a character's (condition-logic.ts tickConditions,
// removeConditionInstances, endInstancesBoundTo), read against the record's
// own conditions and metadata (schemas/sheet.ts petSchema). A pet acts on its
// owner's turn (pet-tools.ts pet_attack, pet-command.ts), so its owner's turn
// is its turn: a save "at the end of each of its turns" is rolled as the
// owner's turn ends (condition-tick.ts endTurnSaves), and a count that runs
// on the holder's turn runs on the owner's. The save is the pet's own
// (pet-save-roll.ts). What lays a condition on a pet is pet-condition-lay.ts.
//
// Must not import pet-tools.ts, pet-save.ts or enemy-damage.ts:
// condition-tick.ts calls here on the clock path.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import {
  endInstancesBoundTo,
  instanceIdentity,
  instancesOf,
  likelierSave,
  removeConditionInstances,
  tickConditions,
  type ConditionMeta,
  type ConditionMetaMap,
} from "@/lib/dm/condition-logic";
import { petPlaceOf } from "@/lib/dm/pet-place";
import { petSaveBlockFor, petSenses, rollPetSave } from "@/lib/dm/pet-save-roll";
import { markTurnEnded, saveHoldAtTurnEnd } from "@/lib/dm/unseen-save";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";

// Which instances a tick counts and which owners' pets save in it, as
// condition-tick.ts asks of a character's (HolderTick), keyed by the owner.
// `encounterId`: the fight being ticked, whose board a hold reads (Fear's
// save only out of the caster's sight); the clock path has none.
export type PetTick = {
  encounterId?: string;
  endTurnBound?: boolean;
  counts?: (source: string | undefined) => boolean;
  saves?: (ownerId: string) => boolean;
  only?: Set<string>;
  due?: (ownerId: string, name: string, key: string, dc: number) => boolean;
};

// Writes one owner's pets back, audited as everything the clock and the
// pointer write to a sheet is, so the turn that moved them takes it back
// (issue #622).
export function writePets(campaign: Campaign, owner: CharacterSheet, pets: SheetPet[], reason: string): void {
  patchSheetAudited(campaign.id, owner.id, { pets }, { kind: "condition_clock", reason, delta: { ended: [], added: [] } });
}

// A pet's conditions and metadata with a change applied.
function withConditions(pet: SheetPet, conditions: string[], meta: ConditionMetaMap): SheetPet {
  return { ...pet, conditions, conditionMeta: meta };
}

const metaOf = (pet: SheetPet): ConditionMetaMap => (pet.conditionMeta ?? {}) as ConditionMetaMap;

// One tick of every owner's pets: the counts `by` rounds, and the saves due.
// Lines for the table go on `lines`.
export function tickPetConditions(campaign: Campaign, by: number, lines: string[], options: PetTick = {}): void {
  for (const stale of listSheets(campaign.id)) {
    if (options.only && !options.only.has(stale.id)) {
      continue;
    }
    const owner = getSheetById(stale.id) ?? stale;
    let changed = false;
    const pets = owner.pets.map((pet) => {
      if (!pet.conditions?.length || !Object.keys(metaOf(pet)).length) {
        return pet;
      }
      const next = tickPet(campaign, owner, pet, by, lines, options);
      changed = changed || next !== pet;
      return next;
    });
    if (changed) {
      writePets(campaign, owner, pets, "time counted down on their pet's conditions");
    }
  }
}

function tickPet(campaign: Campaign, owner: CharacterSheet, pet: SheetPet, by: number, lines: string[], options: PetTick): SheetPet {
  const tick = tickConditions(pet.conditions ?? [], metaOf(pet), by, {
    endTurnBound: options.endTurnBound,
    counts: options.counts,
    saves: options.saves ? options.saves(owner.id) : true,
  });
  let conditions = tick.conditions;
  let meta = tick.meta;
  for (const name of tick.expired) {
    lines.push(`${pet.name} is no longer ${name} (the effect ran its course).`);
  }
  // One effect, one save, as a character's (condition-tick.ts
  // tickSheetConditions): what one source laid with the same save ends on
  // one roll.
  const effectSaves = new Map<string, boolean>();
  const block = tick.savesDue.length ? petSaveBlockFor(campaign, owner, pet) : null;
  for (const listed of tick.savesDue) {
    if (!conditions.includes(listed.name) || (options.due && !options.due(owner.id, listed.name, listed.key, listed.dc))) {
      continue;
    }
    const holds = (instance: ConditionMeta) => instanceIdentity(instance) === listed.key && instance.saveEnds?.dc === listed.dc;
    // Fear's save comes only out of the caster's sight, Dreadful Aspect's only
    // far from it (unseen-save.ts), as a creature's and a character's do. The
    // pet has no token: it looks from its owner's square (pet-place.ts), with
    // its own conditions and its block's senses. It saved at every end of its
    // owner's turn, a wolf in plain sight of the caster shaking off Fear as
    // readily as one behind a wall.
    const looker = { id: petPlaceOf(owner), name: pet.name, conditions, ownSenses: petSenses(campaign, pet) };
    const held = options.encounterId ? saveHoldAtTurnEnd(options.encounterId, looker, instancesOf(meta[listed.name]).find(holds)) : null;
    if (held === "first") {
      meta = markTurnEnded(meta, listed.name, holds);
    }
    if (held) {
      continue;
    }
    const effect = listed.key === "|" ? null : `${listed.key}|${listed.ability}|${listed.dc}`;
    const settled = effect ? effectSaves.get(effect) : undefined;
    if (settled !== undefined) {
      if (settled) {
        ({ conditions, meta } = removeConditionInstances(conditions, meta, listed.name, holds));
        lines.push(`${pet.name} is no longer ${listed.name}: the same save ended it.`);
      }
      continue;
    }
    // A hold that lets the creature pick its save (Nature's Wrath).
    const ability = listed.or && block ? likelierSave(conditions, listed.ability, listed.or, listed.dc, (each) => block.saveMods[each]) : listed.ability;
    const holding = instancesOf(meta[listed.name]).find(holds);
    const save = rollPetSave(campaign, null, owner, withConditions(pet, conditions, meta), {
      ability,
      dc: listed.dc,
      // A spell's hold is a save against magic: an imp's Magic Resistance
      // answers it, as it answered the first.
      magical: Boolean(holding?.spell),
      source: listed.name,
      detail: `${pet.name}: ${ability.toUpperCase()} save to end ${listed.name}`,
    });
    if (effect) {
      effectSaves.set(effect, save.success);
    }
    const shown = save.total ?? "an automatic failure";
    if (save.success) {
      const removed = removeConditionInstances(conditions, meta, listed.name, holds);
      ({ conditions, meta } = removed);
      lines.push(
        removed.ended
          ? `${pet.name} shakes off ${listed.name} (${ability.toUpperCase()} save ${shown} vs DC ${listed.dc}).`
          : `${pet.name} throws off one hold of ${listed.name} (${ability.toUpperCase()} save ${shown} vs DC ${listed.dc}); another still holds it.`,
      );
    } else {
      lines.push(`${pet.name} stays ${listed.name} (${ability.toUpperCase()} save ${shown} vs DC ${listed.dc}).`);
    }
  }
  const same = conditions.length === (pet.conditions ?? []).length && JSON.stringify(meta) === JSON.stringify(metaOf(pet));
  return same ? pet : withConditions(pet, conditions, meta);
}

// What lasted "until the start of the next turn" of these combatants ends on
// the pets too (condition-tick.ts endTurnStartHolds).
export function endPetTurnStartHolds(campaign: Campaign, starting: Set<string>): void {
  for (const stale of listSheets(campaign.id)) {
    const owner = getSheetById(stale.id) ?? stale;
    let changed = false;
    const pets = owner.pets.map((pet) => {
      if (!pet.conditions?.length) {
        return pet;
      }
      const ended = endInstancesBoundTo(pet.conditions, metaOf(pet), starting);
      if (!ended.changed) {
        return pet;
      }
      changed = true;
      return withConditions(pet, ended.conditions, ended.meta);
    });
    if (changed) {
      writePets(campaign, owner, pets, "a hold on their pet that lasted until a turn ended");
    }
  }
}
