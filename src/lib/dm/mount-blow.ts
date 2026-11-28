// What a creature's hit does to a plain mount (a riding horse, a warhorse),
// as pet-strike.ts lands one on a pet (U04, U05): each damage type of the
// blow meets the mount's own stat block (its resistances, immunities and
// vulnerabilities) and the water it stands in (SRD 5.1, Underwater Combat:
// "Creatures and objects that are fully immersed in water have resistance
// to fire damage"), and what the hit carries is rolled against the mount:
// the save from its block, the rider's damage by type, and a knock prone,
// which throws its rider (SRD 5.1, Mounted Combat: "If your mount is
// knocked prone, you can use your reaction to dismount it as it falls and
// land on your feet. Otherwise, you are dismounted and fall prone").
//
// The swing at the mount took its dice whole and untyped, and carried
// nothing: a wolf's bite that knocks a creature prone left the rider in the
// saddle. The mount record keeps Armor Class and hit points only
// (srd/mounts.ts MountState), so a condition other than prone (poisoned,
// grappled) is named for the GM instead of laid.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { isValidExpression, rollExpression, type RollResult } from "@/lib/dice";
import { riderSpares, type OnHitRider } from "@/lib/bestiary/attack-text";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { damageAdjust } from "@/lib/dm/damage-logic";
import { blowByType } from "@/lib/dm/enemy-hit";
import { petResistLine } from "@/lib/dm/pet-underwater";
import { recordRoll } from "@/lib/dm/roll-record";
import { actionParts, keptTarget, saveParts } from "@/lib/roll-parts";
import { proficiencyForCr } from "@/lib/srd/creature-drain-logic";
import type { MountState } from "@/lib/srd/mounts";
import { findSummonForm, type SummonForm } from "@/lib/srd/summon-forms";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The mount's SRD stat block, by the name it was taken under.
export function mountForm(mount: Pick<MountState, "name" | "ref">): SummonForm | null {
  return findSummonForm(mount.name) ?? findSummonForm(mount.ref);
}

function adjusted(campaignId: string, riderId: string, form: SummonForm | null, parts: Array<{ amount: number; type?: string }>, magical: boolean): { dealt: number; notes: string[] } {
  const resist = petResistLine(campaignId, riderId, { resist: form?.resist ?? "" });
  const each = parts.map((part) => damageAdjust(part.amount, part.type, resist, form?.immune ?? "", form?.vulnerable ?? "", { magical }));
  return { dealt: each.reduce((sum, entry) => sum + entry.amount, 0), notes: each.map((entry) => entry.note).filter((note): note is string => Boolean(note)) };
}

// The hit's own damage on the mount, by type.
export function mountBlow(campaignId: string, riderId: string, mount: MountState, attack: EnemyAttack, damage: RollResult, crit: boolean, magical: boolean): { dealt: number; defenses?: string } {
  const blow = blowByType(attack, damage, crit);
  const { dealt, notes } = adjusted(campaignId, riderId, mountForm(mount), blow.parts ?? [{ amount: blow.amount, type: blow.type }], magical);
  return { dealt, ...(notes.length ? { defenses: `${mount.name} is ${notes.join("; ")}` } : {}) };
}

// What the hit carries onto the mount: the save, the rider's damage (dealt,
// to come off its hit points), whether it goes prone, and the lines.
export function mountRider(
  campaign: Campaign,
  turn: DmTurn,
  rider: CharacterSheet,
  enemy: EncounterEnemy,
  attack: EnemyAttack,
  onHit: OnHitRider,
  mount: MountState,
): { dealt: number; prone: boolean; lines: Record<string, unknown> } {
  const form = mountForm(mount);
  const spared = riderSpares(onHit, [form?.type ?? "beast"]);
  if (spared) {
    return { dealt: 0, prone: false, lines: { rider: `${mount.name} is ${spared}: the ${attack.name}'s rider passes it by.` } };
  }
  if (onHit.maxSize && sizeRank(mount.size) > sizeRank(onHit.maxSize)) {
    return { dealt: 0, prone: false, lines: { rider: `${mount.name} is too large for the ${attack.name}'s rider (${onHit.maxSize} or smaller).` } };
  }
  const lines: Record<string, unknown> = {};
  let saved = false;
  if (onHit.save && onHit.dc) {
    const score = form?.abilities[onHit.save] ?? 10;
    const bonus = Math.floor((score - 10) / 2) + (form?.saves?.includes(onHit.save) ? proficiencyForCr(form.cr) : 0);
    const rolled = rollExpression(`1d20${bonus >= 0 ? "+" : ""}${bonus}`, undefined, { purpose: { roller: "enemy", kind: "save", who: mount.name } });
    // Thrown here on the server's dice (landing null): the rider's own
    // decided save, filed under the same character, is not this roll.
    recordRoll({ campaignId: campaign.id, characterId: rider.id, requestedBy: "dm", kind: "saving_throw", detail: `${mount.name}: ${onHit.save.toUpperCase()} save against ${enemy.displayName}'s ${attack.name}`, parts: saveParts(onHit.save), dc: onHit.dc, result: rolled, turn, landing: null });
    saved = rolled.total >= onHit.dc;
    lines.riderSave = `${rolled.total} vs DC ${onHit.dc}`;
    lines.riderSaved = saved;
  }
  let dealt = 0;
  if (onHit.damage && isValidExpression(onHit.damage) && !(saved && !onHit.halfOnSave)) {
    const rolled = rollExpression(onHit.damage, undefined, { purpose: { roller: "enemy", kind: "damage", who: enemy.displayName } });
    recordRoll({ campaignId: campaign.id, characterId: rider.id, requestedBy: "dm", kind: "damage", parts: actionParts(attack, keptTarget("mount", mount), "rider"), result: rolled, attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName }, turn, landing: null });
    const amount = saved ? Math.floor(rolled.total / 2) : rolled.total;
    const landed = adjusted(campaign.id, rider.id, form, [{ amount, type: onHit.damageType }], Boolean(attack.magical));
    dealt = landed.dealt;
    lines.riderDamage = dealt;
  }
  let prone = false;
  if (onHit.condition && !saved) {
    const conditions = [onHit.condition, ...(onHit.alsoCondition ? [onHit.alsoCondition] : [])];
    const immune = (form?.conditionImmune ?? "").toLowerCase();
    const held = conditions.filter((condition) => !immune.includes(condition.toLowerCase()));
    prone = held.some((condition) => isConditionNamed(condition, "prone"));
    const others = held.filter((condition) => !isConditionNamed(condition, "prone"));
    if (prone) {
      lines.riderCondition = [`${mount.name} is knocked prone`];
    }
    if (others.length) {
      lines.riderForGm = `On ${mount.name}, the GM resolves ${others.join(" and ")} (a mount's record keeps no conditions).`;
    }
  }
  return { dealt, prone, lines };
}
