// What a cyberpunk class's hit does beyond its damage (WAVE2 D5), called
// from the hit's one door (src/lib/dm/attack-blow.ts, beside Repelling
// Blast), so the card and every route that lands a hit carry it alike.
//   spell_push (Kinetic Buffer, "1/turn, shove a target 10 ft with a psionic
//     hit"): an esper's psionic is a spell, so a spell attack that hits
//     pushes the creature 10 feet straight away, once on each of the
//     holder's turns, as far as the ground behind it lets it go;
//   kill_attack (Apex Predator, "1/turn, dropping a foe to 0 HP grants one
//     extra weapon attack immediately"): a weapon hit that drops the creature
//     adds one attack to the turn's Attack action, once a turn.
import { getActiveEncounter, turnKey } from "@/lib/db/encounters";
import type { AttackRecord } from "@/lib/dm/attack-record";
import { attackTurn, type SwingScene } from "@/lib/dm/attack-swing";
import { storeBudget } from "@/lib/dm/turn-budget";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import { activeAuthored } from "@/lib/srd/authored-effects";

const shoveKey = (holderId: string) => `spell_push:${holderId}`;

export function kineticShove(scene: SwingScene, record: AttackRecord): string | null {
  const { campaign, sheet, enemy } = scene;
  const row = activeAuthored(sheet, "spell_push")[0];
  const encounter = getActiveEncounter(campaign.id);
  if (!row || !encounter || record.kind !== "spell") {
    return null;
  }
  const stamp = `${encounter.id}:${turnKey(encounter)}`;
  if (row.effect.oncePerTurn && fightMarked(encounter.id, shoveKey(sheet.id), stamp)) {
    return null;
  }
  let feet = 0;
  let stopped = "";
  for (let step = 0; step < row.effect.feet / 5; step += 1) {
    const pushed = pushTokenAway(campaign, encounter.id, sheet.id, enemy.id);
    if (!pushed.moved) {
      stopped = pushed.reason;
      break;
    }
    feet += 5;
  }
  if (row.effect.oncePerTurn) {
    markFight(encounter.id, shoveKey(sheet.id), stamp);
  }
  return feet
    ? `${row.held.feature}: ${enemy.displayName} is shoved ${feet} feet away${stopped ? ` (${stopped})` : ""}`
    : `${row.held.feature}: ${enemy.displayName} could not be shoved (${stopped})`;
}

const APEX = "kill_attack";

export function apexAttack(scene: SwingScene, record: AttackRecord, dead: boolean): string | null {
  const row = activeAuthored(scene.sheet, "kill_attack")[0];
  if (!row || !dead || record.weaponAttack !== true) {
    return null;
  }
  const turn = attackTurn(scene.campaign.id, record);
  if (!turn || turn.budget.oncePerTurn.includes(APEX)) {
    return null;
  }
  storeBudget(turn.encounter, { ...turn.budget, attacksAllowed: turn.budget.attacksAllowed + 1, oncePerTurn: [...turn.budget.oncePerTurn, APEX] });
  return `${row.held.feature}: the kill grants one more weapon attack this turn`;
}
