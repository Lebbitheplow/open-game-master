// Healing a character's pet: heal with a petName (the owner's characterId).
// No door healed one before: a ranger's Cure Wounds on their wolf, or a
// potion poured into a familiar, healed the owner, and a companion at 0 hit
// points stayed down until a long rest.
//
// SRD 5.1: Cure Wounds and Healing Word heal "a creature", and "This spell
// has no effect on undead or constructs" (Mass Cure Wounds, Mass Healing
// Word, Prayer of Healing, Heal and Mass Heal say it too, Heal as
// "constructs or undead"). The spell's own text decides it, so a potion or
// Goodberry mends a skeleton and Cure Wounds does not.
//
// The pet stands in its owner's square (ruling D2, pet-place.ts): a healing
// spell's reach is measured to the owner, through the same casting the heal
// tool runs for a character (heal-spell.ts castHealingSpell), and the hit
// points land on the pet, never past its maximum.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { publishPersisted } from "@/lib/events";
import { findSpellByName, spellFactsFor } from "@/lib/content";
import type { OneCasting } from "@/lib/dm/action-parts-logic";
import { castHealingSpell } from "@/lib/dm/heal-spell";
import { petCreatureType } from "@/lib/dm/pet-build";
import { findPet, noPet } from "@/lib/dm/pet-tools";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { regainBlockedBy } from "@/lib/dm/vitals-logic";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Whether a spell's text keeps it off undead and constructs.
export function spellSparesUndead(desc: string): boolean {
  return /no effect on (?:undead or constructs|constructs or undead)/i.test(desc);
}

// The SRD 5.1 healing spells whose own text says it ("This spell has no
// effect on undead or constructs", src/lib/rulebook/srd-5.1.json), read when
// no content pack gives the spell's text: without it Cure Wounds healed a
// skeleton on a server with no pack, as CI and the app's own worlds run.
const SRD_SPARES_UNDEAD = ["cure wounds", "healing word", "mass cure wounds", "mass healing word", "prayer of healing", "heal", "mass heal", "spare the dying"];

function sparesUndead(spell: string, desc: string): boolean {
  return desc ? spellSparesUndead(desc) : SRD_SPARES_UNDEAD.includes(textKey(spell));
}

export function healPet(
  campaign: Campaign,
  turnId: string,
  input: {
    owner: CharacterSheet;
    petName: string;
    caster: CharacterSheet | null;
    spell: string;
    level?: number;
    amount: number;
    temp: boolean;
    reason: string;
    casting?: OneCasting;
  },
  cast: (args: Record<string, unknown>) => ToolResult,
): ToolResult {
  const owner = getSheetById(input.owner.id) ?? input.owner;
  const pet = findPet(owner, input.petName);
  if (!pet) {
    return noPet(owner, input.petName);
  }
  // A pet's record keeps hit points and a maximum, no temporary pool: a
  // number laid there would be read as healing.
  if (input.temp) {
    return { error: `${pet.name} keeps no temporary hit points on its record. Nothing changed; narrate it.`, refused: "rules" };
  }
  // Asked before a slot is spent: Chill Touch, mummy rot (vitals-logic.ts).
  const blocked = regainBlockedBy({ conditions: pet.conditions ?? [], currentHp: pet.hp });
  if (blocked) {
    return { error: `${pet.name} is held by ${blocked} and cannot regain hit points yet. Nothing was spent.`, refused: "rules" };
  }
  const kind = petCreatureType(pet);
  let amount = input.amount;
  let note: string | null = null;
  if (input.spell) {
    const authors = spellAuthorsFor(campaign);
    const facts = spellFactsFor(input.spell, authors);
    const name = facts?.name ?? input.spell;
    if (/undead|construct/i.test(kind) && sparesUndead(facts?.runsAs ?? name, String(findSpellByName(input.spell, authors)?.data.desc ?? ""))) {
      return { error: `${pet.name} is ${kind === "undead" ? "an undead" : `a ${kind}`}, and ${name} has no effect on undead or constructs. Nothing was spent.`, refused: "rules" };
    }
    // A pet makes no death saves (pet-tools.ts hurtPet: it drops or
    // vanishes), so there is no dying for Spare the Dying to stop.
    if (textKey(facts?.runsAs ?? name) === "spare the dying") {
      return { error: `${pet.name} makes no death saves, so Spare the Dying has nothing to stop: heal it with hit points instead. Nothing was spent.`, retry: true };
    }
    // The casting reaches the owner's square, and the pet's own conditions
    // (Beacon of Hope's maximum, Circle of Mortality's 0 hit points) and
    // hit points are what the spell reads of its target.
    const standIn: CharacterSheet = {
      ...owner,
      name: pet.name,
      currentHp: pet.hp,
      maxHp: pet.maxHp,
      tempHp: 0,
      conditions: pet.conditions ?? [],
      conditionMeta: (pet.conditionMeta ?? {}) as CharacterSheet["conditionMeta"],
      deathSaves: null,
      wildShape: null,
    };
    const outcome = castHealingSpell(
      campaign,
      turnId,
      { target: standIn, caster: input.caster ?? owner, spell: input.spell, level: input.level, amount: input.amount, reason: input.reason, casting: input.casting, pet: true },
      cast,
    );
    if (outcome && "error" in outcome) {
      return toolError(outcome);
    }
    if (outcome && "done" in outcome) {
      return outcome.done;
    }
    if (outcome) {
      amount = outcome.amount;
      note = outcome.note;
    }
  }
  if (amount < 1) {
    return { error: "heal needs a positive amount, or a spell name to roll.", retry: true };
  }
  // The record as it stands after the casting (a slot spent, a minute
  // passed), with this pet's hit points raised to no more than its maximum.
  const fresh = getSheetById(owner.id) ?? owner;
  const hp = Math.min(pet.maxHp, pet.hp + Math.min(amount, 300));
  const pets = fresh.pets.map((entry) => (entry.name === pet.name && entry.kind === pet.kind ? { ...entry, hp } : entry));
  const patch = { pets };
  const updated = patchSheet(fresh.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: fresh.id,
    turnId,
    kind: "heal",
    delta: { pet: pet.name, amount, hp },
    reason: input.reason,
    seq: allocateSeq(campaign.id),
    before: fresh,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: fresh.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    ok: true,
    pet: pet.name,
    hp: `${hp}/${pet.maxHp}`,
    healed: hp - pet.hp,
    ...(note ? { spell: note } : {}),
    ...(pet.hp <= 0 ? { up: `${pet.name} is back on its feet.` } : {}),
  };
}
