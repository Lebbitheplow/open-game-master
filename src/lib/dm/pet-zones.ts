// A lasting area striking the pets beside a character: Moonbeam, Cloud of
// Daggers, Spike Growth, Web, Stinking Cloud, Wall of Fire, a cleric
// enemy's Spirit Guardians, caltrops. A pet has no token and stands in its
// owner's square (ruling D2, pet-place.ts), so every moment an area strikes
// the owner at (entering it, every 5 feet moved in it, starting or ending a
// turn there) it strikes the pet too, on the owner's walk and the owner's
// turn, which are the pet's. Before this zone-triggers.ts read only tokens: a
// wolf walked through Spike Growth and stood in Moonbeam untouched.
//
// SRD 5.1: each such spell names "a creature" that enters or starts its turn
// in the area. The pet makes its own save (pet-save-roll.ts), takes the
// damage through its own door (pet-tools.ts hurtPet) and the condition a
// failure lays as a character does (pet-condition-lay.ts). Called from
// zone-triggers.ts, which owns the area, its DC and its dice.

import type { Campaign } from "@/lib/db/campaigns";
import type { RollAttacker } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { rollAgainst } from "@/lib/roll-labels";
import type { SpellZone } from "@/lib/battlemap/zones";
import type { ZoneMoment, ZoneRow, ZoneTrigger } from "@/lib/battlemap/zones-spells";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { petrifiedImmunities } from "@/lib/dm/damage-logic";
import { petCreatureType } from "@/lib/dm/pet-build";
import { layPetCondition } from "@/lib/dm/pet-condition-lay";
import { petDamageShare } from "@/lib/dm/pet-save-logic";
import { rollPetSave } from "@/lib/dm/pet-save-roll";
import { hurtPet } from "@/lib/dm/pet-tools";
import { rollCard } from "@/lib/dm/roll-card";
import { textKey } from "@/lib/language/text-logic";
import type { SheetPet } from "@/lib/schemas/sheet";

// What zone-triggers.ts knows of the area for this strike.
export type PetZoneStrike = {
  zone: SpellZone;
  row: ZoneRow;
  trigger: ZoneTrigger;
  moment: ZoneMoment;
  dc: number;
  // The damage dice for this strike (Spike Growth's squares already in).
  dice: string | null;
  by: RollAttacker;
  why: string;
  // Whether the area's own immunity rule spares a creature of these
  // immunities (Stinking Cloud and poison).
  immune: (immunities: string) => boolean;
  // Whether the area is still on the board (its damage may have ended it).
  stands: () => boolean;
};

const holds = (conditions: readonly string[] | undefined, name: string) => (conditions ?? []).some((entry) => textKey(entry) === textKey(name));

// Whether this area's own casting restrains the pet (Black Tentacles holds
// it: its turn-start crush, no save).
function heldByZone(pet: SheetPet, zone: SpellZone): boolean {
  const meta = (pet.conditionMeta ?? {}) as ConditionMetaMap;
  const spells = [zone.spell, zone.heldBy ?? ""].map(textKey).filter(Boolean);
  return holds(pet.conditions, "restrained") && instancesOf(meta.restrained).some((entry) => entry.source === zone.casterId && spells.includes(textKey(entry.spell ?? "")));
}

// The owner's pets struck by one moment of the area. `once` keys are the
// pet's own (a burning web strikes each creature once).
export function strikePetsInZone(campaign: Campaign, ownerId: string, strike: PetZoneStrike): string[] {
  const owner = getSheetById(ownerId);
  if (!owner) {
    return [];
  }
  const lines: string[] = [];
  for (const pet of owner.pets) {
    if (pet.hp <= 0) {
      continue;
    }
    // "Only creatures of these rules types": the pet's own type.
    if (strike.trigger.types && !strike.trigger.types.some((kind) => textKey(petCreatureType(pet)).includes(kind))) {
      continue;
    }
    const mark = `${ownerId}/${pet.name}`;
    if (strike.trigger.once) {
      if (strike.zone.struck?.[`${mark}:once`]) {
        continue;
      }
      strike.zone.struck = { ...(strike.zone.struck ?? {}), [`${mark}:once`]: "1" };
    }
    lines.push(...strikePet(campaign, ownerId, pet.name, strike));
  }
  return lines;
}

function strikePet(campaign: Campaign, ownerId: string, name: string, strike: PetZoneStrike): string[] {
  const { zone, row, trigger, dc, dice } = strike;
  const now = () => getSheetById(ownerId)?.pets.find((entry) => entry.name === name) ?? null;
  const owner = getSheetById(ownerId);
  const pet = now();
  if (!owner || !pet || pet.hp <= 0) {
    return [];
  }
  // Held by this casting's tentacles as its owner's turn starts: crushed, no
  // save (SRD 5.1, Black Tentacles), as spell-aura.ts crushes a character.
  const crushing = strike.moment === "start" && trigger.condition === "restrained" && Boolean(dice) && heldByZone(pet, zone);
  // Already held by what the area lays and nothing to roll.
  if (!crushing && trigger.condition && holds(pet.conditions, trigger.condition) && !dice) {
    return [];
  }
  const lines: string[] = [];
  const immune = strike.immune([pet.immune ?? "", ...petrifiedImmunities(pet.conditions ?? [])].join(", "));
  const save = !crushing && trigger.save && !immune ? rollPetSave(campaign, null, owner, pet, { ability: trigger.save, dc, magical: !row.mundane, source: zone.spell }) : null;
  const failed = crushing || (trigger.save ? !immune && !save?.success : true);
  if (trigger.save && !crushing) {
    lines.push(`${pet.name} ${failed ? "fails" : "makes"} its ${trigger.save.toUpperCase()} save against ${zone.spell} (DC ${dc}).`);
  }
  if (dice && (failed || (trigger.half && !trigger.damageOnFail))) {
    const rolled = rollCard(campaign, null, null, "damage", rollAgainst(zone.spell, pet.name), dice, strike.by).total;
    const share = trigger.save && !crushing
      ? petDamageShare({ saved: !failed, halfOnSave: Boolean(trigger.half && !trigger.damageOnFail), ability: trigger.save, evasion: save?.evasion ?? false })
      : "full";
    const amount = share === "full" ? rolled : share === "half" ? Math.floor(rolled / 2) : 0;
    const standing = now();
    if (amount > 0 && standing) {
      const hurt = hurtPet(campaign, getSheetById(ownerId) ?? owner, standing, { parts: [{ amount, type: trigger.type }], magical: !row.mundane });
      const dealt = typeof hurt.damage === "number" ? hurt.damage : amount;
      zone.dealt = (zone.dealt ?? 0) + dealt;
      lines.push(`${pet.name} takes ${dealt} ${trigger.type ?? ""} damage from ${strike.why}.`.replace("  ", " "));
    }
  }
  const standing = now();
  if (!failed || crushing || !standing || standing.hp <= 0 || !strike.stands()) {
    return lines;
  }
  // What a failure lays: the area's condition (restrained is the spell's and
  // ends with it; prone is the ground's), and Stinking Cloud's lost action,
  // which lasts to the end of the turn under way, its owner's.
  if (trigger.condition && !holds(standing.conditions, trigger.condition)) {
    const meta = trigger.condition === "prone" ? undefined : { spell: zone.spell, source: zone.casterId, ...(zone.slotLevel ? { slotLevel: zone.slotLevel } : {}) };
    const laid = layPetCondition(campaign, owner, standing, { condition: trigger.condition, meta, magical: !row.mundane, sourceEnemyId: zone.casterKind === "enemy" ? zone.casterId : undefined });
    lines.push("error" in laid ? laid.error : `${pet.name} is ${trigger.condition} by ${zone.spell}.`);
  }
  const after = now();
  if (trigger.losesAction && after && !holds(after.conditions, "retching")) {
    const laid = layPetCondition(campaign, owner, after, { condition: "retching", meta: { spell: zone.spell, source: zone.casterId, untilTurnEndOf: ownerId, turnBegun: true }, magical: !row.mundane });
    if (!("error" in laid)) {
      lines.push(`${pet.name} spends its action this turn retching.`);
    }
  }
  return lines;
}
