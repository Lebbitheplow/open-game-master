// A creature's Charge, Pounce or Trampling Charge (charge-logic.ts reads the
// trait) played on its hit, on both of an enemy's attack doors: at a
// character (enemy-attack.ts) and at another creature's row
// (enemy-strike.ts). The run is the board's: how many feet nearer the
// target the creature came from the square its turn's movement began on
// (battle-maps.ts squaresStoodIn), measured as a character's own run is
// (mt-fb-charge.ts runFeet), so a run that curls away or goes past earns
// none of it. With no board there are no squares, and the call's word
// stands (enemy_attack's `charged`).
//
// Once a turn: the first hit of the trait's attack after the run. A Pounce's
// bonus attack opens on the creature it struck while that creature lies
// prone (the turn entry's `pouncedOn`, enemy-turn-logic.ts), and enemy_attack
// takes it as the creature's bonus action.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, squaresStoodIn } from "@/lib/db/battle-maps";
import { getActiveEncounter, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { EnemyAttack, OnHitRider } from "@/lib/bestiary/statblock";
import { tilesApart } from "@/lib/dm/board-reach";
import { chargeOnHit, type ChargeTrait } from "@/lib/dm/charge-logic";
import { legacyRiders } from "@/lib/dm/enemy-hit";
import { enemyTurnEntry, recordEnemyTurn } from "@/lib/dm/enemy-turn-logic";
import { pushStraightAway } from "@/lib/dm/ar-ws-storm-fury";
import { OPEN_RUN } from "@/lib/srd/mt-fb-run";

// The feet straight at the target the creature has run this turn.
export function enemyRunFeet(encounterId: string, enemyId: string, targetId: string, claimed: boolean): number {
  const map = getBattleMapForEncounter(encounterId);
  const mover = map ? getTokenByRef(map.id, enemyId) : null;
  const target = map ? getTokenByRef(map.id, targetId) : null;
  if (!map || !mover || !target) {
    return claimed ? OPEN_RUN : 0;
  }
  const start = squaresStoodIn(mover.id)[0];
  return start ? Math.max(0, tilesApart({ ...mover, x: start.x, y: start.y }, target) - tilesApart(mover, target)) * 5 : 0;
}

// The charge this hit rides, once a turn, or null.
export function chargeForHit(encounter: Parameters<typeof enemyTurnEntry>[0], enemy: EncounterEnemy, attack: EnemyAttack, ranFeet: number): ChargeTrait | null {
  if (attack.spellAttack || enemyTurnEntry(encounter, enemy.id).chargeUsed) {
    return null;
  }
  return chargeOnHit(enemy.stats, attack.name, ranFeet);
}

// The blow with the charge's extra dice: of the weapon's own type they fold
// into its dice (doubled on a critical like the rest), another type rides as
// a part of its own, meeting its own resistance.
export function withChargeDice(attack: EnemyAttack, trait: ChargeTrait): EnemyAttack {
  if (!trait.extra) {
    return attack;
  }
  const main = attack.type.split("/")[0]?.trim().toLowerCase();
  const riders = attack.riders?.length ? attack.riders : legacyRiders(attack);
  const type = trait.extra.type;
  const own = !type || type === main;
  return {
    ...attack,
    damage: `${attack.damage}+${trait.extra.dice}`,
    ...(own
      ? riders.length
        ? { riders }
        : {}
      : { type: attack.type.split("/").includes(type) ? attack.type : `${attack.type}/${type}`, riders: [...riders, { dice: trait.extra.dice, type }] }),
  };
}

// The save the charge forces, as the hit's rider (enemy-hit.ts resolveOnHit
// and enemy-hit-rows.ts resolveRowOnHit roll it from the target's own
// numbers), or null for a charge of extra damage only.
export function chargeRider(attack: EnemyAttack, trait: ChargeTrait): EnemyAttack | null {
  if (!trait.save || !trait.prone) {
    return null;
  }
  const rider: OnHitRider = { save: trait.save.ability, dc: trait.save.dc, condition: "prone" };
  return { ...attack, name: `${attack.name} (${trait.name})`, onHit: rider };
}

// What a charge does once its hit has landed, on either door: the save its
// rider forces (`resolve` is the door's own rider resolver), then what
// afterCharge does. The lines for the swing.
export function chargeAfterHit(
  campaign: Campaign,
  enemy: EncounterEnemy,
  attack: EnemyAttack,
  trait: ChargeTrait,
  target: { id: string; name: string },
  resolve: (ridden: EnemyAttack) => Record<string, unknown> | null,
  liesProne: () => boolean,
): string[] {
  const ridden = chargeRider(attack, trait);
  const out = ridden ? resolve(ridden) : null;
  const lines: string[] = [];
  if (out && typeof out.riderSave === "string") {
    lines.push(
      out.riderSaved
        ? `${trait.name}: ${target.name} keeps their feet (${out.riderSave}).`
        : `${trait.name}: ${target.name} fails the save (${out.riderSave}) and is knocked prone.`,
    );
  }
  return [...lines, ...afterCharge(campaign, enemy, trait, { ...target, prone: liesProne() }, out?.riderSaved === false)];
}

// After the charge's save: the push a failure brings, the turn's record (the
// charge spent, a Pounce's bonus attack opened on a prone target), and the
// lines for the table.
export function afterCharge(
  campaign: Campaign,
  enemy: EncounterEnemy,
  trait: ChargeTrait,
  target: { id: string; name: string; prone: boolean },
  failed: boolean,
): string[] {
  const notes: string[] = [];
  if (failed && trait.pushFeet) {
    const encounter = getActiveEncounter(campaign.id);
    if (encounter) {
      notes.push(pushStraightAway(campaign, encounter.id, { id: enemy.id, name: enemy.displayName }, { id: target.id, displayName: target.name }, trait.pushFeet));
    }
  }
  const live = getActiveEncounter(campaign.id);
  const opens = Boolean(trait.bonus?.length) && target.prone;
  if (live) {
    recordEnemyTurn(live, enemy.id, { chargeUsed: true, ...(opens ? { pouncedOn: target.id } : {}) });
    saveEncounter(live);
  }
  if (opens) {
    const names = trait.bonus!.map((name) => `"${name}"`).join(" or ");
    notes.push(`${trait.name}: ${target.name} lies prone, so ${enemy.displayName} may make one ${names} attack at them as its bonus action (enemy_attack attack ${names}).`);
  }
  return notes;
}
