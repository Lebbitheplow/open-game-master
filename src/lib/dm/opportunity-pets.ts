// A pet walks out of a creature's reach with its owner, and provokes as any
// creature does (SRD 5.1, Opportunity Attacks: "You can make an opportunity
// attack when a hostile creature that you can see moves out of your
// reach"). A pet has no token of its own and stands with its owner (ruling
// D2, pet-place.ts), so the owner's walk is the pet's. Before this the walk
// drew a swing at the owner only: a ranger who took the Disengage action
// walked their wolf off three goblins untouched, though the Disengage was
// the ranger's ("your movement doesn't provoke"), not the wolf's.
//
// A creature with its reaction still in hand once the owner's swings are
// taken (the owner Disengaged, attacked it in melee with Mobile, or was
// unseen) strikes the pet whose walk left its reach. What the pet's own
// rules say holds: Flyby (an owl familiar, flying out of reach), and its own
// Disengage (a companion commanded to Disengage, pet-command.ts). The
// damage goes to the pet's own pool as damage_pet's does (pet-tools.ts
// hurtPet), its defences and its end at 0 included.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, saveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { rollAgainst } from "@/lib/roll-labels";
import { canEnemyAct } from "@/lib/dm/can-act";
import { sideOf } from "@/lib/dm/combatant";
import { attackContext, effectiveSpeed, mergeAdvantage } from "@/lib/dm/condition-logic";
import { fearAsRolled } from "@/lib/dm/attack-light";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { blowByType } from "@/lib/dm/enemy-hit";
import { opportunityWeapon } from "@/lib/dm/enemy-profile";
import { goadBarsOpportunity } from "@/lib/dm/goaded";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { leavesReachAt } from "@/lib/dm/opportunity-reach-logic";
import { enemyOpportunityRiders, opportunitySight } from "@/lib/dm/opportunity-strike";
import { hurtPet } from "@/lib/dm/pet-tools";
import { spendEnemyRiders } from "@/lib/dm/spell-retort";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { SheetPet } from "@/lib/schemas/sheet";

type XY = { x: number; y: number };

// Whether the pet's walk with its owner provokes: not while it flies by
// (Flyby, with a flying speed to fly by on) or has Disengaged, and not when
// it never walked: a pet held where it is (paralyzed, restrained, grappled:
// speed 0, SRD 5.1 Conditions) stays behind as its owner goes.
export function petProvokes(pet: SheetPet): boolean {
  const flies = Boolean(pet.fly) || /\bfly \d+ ft\b/i.test(pet.notes ?? "");
  if (flies && /\bflyby\b/i.test(pet.notes ?? "")) {
    return false;
  }
  if (effectiveSpeed(pet.conditions ?? [], Math.max(pet.speed, pet.fly ?? 0, 5), true) === 0) {
    return false;
  }
  return pet.hp > 0 && !(pet.conditions ?? []).some((entry) => isConditionNamed(entry, "disengaging"));
}

// The swings at the owner's pets over the walk; the lines posted.
export function strikePetsOnWalk(campaign: Campaign, ownerId: string, steps: XY[]): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const owner = getSheetById(ownerId);
  if (!encounter || !map || !owner || owner.currentHp <= 0 || !(owner.pets ?? []).some(petProvokes)) {
    return [];
  }
  const ownerSide = sideOf(encounter, "sheet", ownerId);
  const notes: string[] = [];
  for (const enemy of listEnemies(encounter.id)) {
    const live = getSheetById(ownerId) ?? owner;
    const pet = (live.pets ?? []).find(petProvokes);
    if (!pet) {
      break;
    }
    if (sideOf(encounter, "enemy", enemy.id, enemy) === ownerSide || encounter.reactionsUsed.includes(enemy.id)) {
      continue;
    }
    if (!canEnemyAct({ enemy, encounter, kind: "reaction" }).ok || conditionBlocksReactions(enemy.conditions) || enemy.conditions.some((entry) => isConditionNamed(entry, "blinded"))) {
      continue;
    }
    // Panache: no opportunity attack at anyone but the swashbuckler.
    if (goadBarsOpportunity(enemy, `${ownerId}:pet`)) {
      continue;
    }
    const token = getTokenByRef(map.id, enemy.id);
    const weapon = opportunityWeapon(enemy.stats);
    const leftFrom = token && weapon ? leavesReachAt(steps, token, weapon.reachTiles, footprintForSize(enemy.stats.size)) : null;
    if (!weapon || !leftFrom) {
      continue;
    }
    // The light where the two of them were (the pet stands with its owner).
    const sight = opportunitySight({ campaignId: campaign.id, encounterId: encounter.id, enemy, sheet: live, enemyReacts: true, moverAt: leftFrom });
    if (sight && !sight.attackerSees) {
      continue;
    }
    encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
    saveEncounter(encounter);
    const { attack } = weapon;
    const context = attackContext({
      attackerConditions: fearAsRolled(encounter.id, enemy.id, enemy.conditions, enemy.conditionMeta),
      targetConditions: pet.conditions ?? [],
      melee: true,
      adjacent: weapon.reachTiles <= 1,
      requested: "none",
    });
    const own = enemyOpportunityRiders(campaign.id, enemy);
    const effect = effectOutcome(campaign.id, { kind: "enemy", id: enemy.id }, "attack");
    const advantage = mergeAdvantage([...context.sources, ...own.sources, ...(effect.advantage ? ["advantage" as const] : []), ...(effect.disadvantage ? ["disadvantage" as const] : [])]);
    const label = rollAgainst(`${attack.name} (opportunity attack)`, pet.name);
    const toHit = rollExpression(`${d20Expression(attack.toHit + effect.bonus, advantage)}${own.riders.diceSuffix}`, undefined, { purpose: { roller: "enemy", kind: "attack", who: enemy.displayName } });
    spendEnemyRiders(enemy, own.riders);
    const hitRoll = insertRoll({ campaignId: campaign.id, characterId: ownerId, requestedBy: "dm", kind: "attack", detail: label, advantage, result: toHit, attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName } });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: hitRoll, source: "digital" });
    const hit = toHit.crit !== "nat1" && (toHit.crit === "nat20" || toHit.total >= pet.ac);
    if (!hit) {
      notes.push(`${enemy.displayName} takes an opportunity attack as ${pet.name} pulls away with ${live.name} and misses (${toHit.total} vs AC ${pet.ac}).`);
      continue;
    }
    const crit = toHit.crit === "nat20" || context.autoCrit;
    const damage = rollExpression(
      crit ? critDamageExpression(attack.damage, 0, { powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical, multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods }) : attack.damage,
      undefined,
      { purpose: { roller: "enemy", kind: "damage", who: enemy.displayName } },
    );
    const damageRoll = insertRoll({ campaignId: campaign.id, characterId: ownerId, requestedBy: "dm", kind: "damage", detail: label, result: damage, attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName } });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: damageRoll, source: "digital" });
    const blow = blowByType(attack, damage, crit);
    // A blow of two types (a hell hound's piercing and fire) meets the pet's
    // defences part by part, as enemy_attack's at a pet does (pet-strike.ts):
    // landed as one type, an imp took the fire it is immune to.
    const struck = hurtPet(campaign, live, pet, {
      parts: blow.parts ?? [{ amount: Math.max(0, blow.amount), type: blow.type }],
      magical: hasTrait(enemy.stats, "magicWeapons") || attack.magical === true,
    });
    const after = String(struck.vanished ?? struck.down ?? (struck.hp ? `${pet.name} is at ${struck.hp}` : ""));
    notes.push(`${enemy.displayName} takes an opportunity attack as ${pet.name} pulls away with ${live.name}: ${crit ? "a critical hit for " : "hit for "}${String(struck.damage ?? 0)} damage.${after ? ` ${after}` : ""}`);
  }
  for (const content of notes) {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-battle", content });
    publishWithSeq(campaign.id, seq, "message_added", { message });
  }
  return notes;
}
