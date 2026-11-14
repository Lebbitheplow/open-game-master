// What a steampunk feature leaves on the creature a weapon attack struck
// (WAVE2 D5), called once the blow has landed (src/lib/dm/attack-blow.ts
// landSwingBlow, the stage a server-rolled and a physical-dice attack share).
//
//   Sky Duelist (aeronaut 17)  "Your critical hits with one-handed weapons
//     knock the target prone or disarm it (your choice)."
//
// The engine takes the first by default: the creature falls prone, as a Trip
// Attack leaves it (pc-attack-riders.ts applyRiderCondition), with no save and
// no size the text names. A creature already prone, or one that cannot be
// knocked prone, is disarmed instead: the "disarmed" mark a Disarming Attack
// leaves, for a round ("a disarm is a moment"). The choice is the player's,
// and pc_attack has no field for it (the compact tool budget has no room for
// one), so the line tells the GM how to trade the one for the other.
//
// Before this the feature was its sentence in the GM's prompt: the critical
// hit dealt its dice and the creature stood where it was, armed.
import { getFoe } from "@/lib/dm/sheet-foe";
import { applyRiderCondition } from "@/lib/dm/pc-attack-riders";
import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { DISARMED, skyDuelistCrit } from "@/lib/srd/genre-b-steampunk-attacks";

export function steampunkHitMarks(
  scene: { campaign: Campaign; sheet: CharacterSheet; enemy: EncounterEnemy },
  record: { base?: string; weaponAttack?: boolean },
  crit: boolean,
): string[] {
  const { campaign, sheet, enemy } = scene;
  if (record.weaponAttack === false || !skyDuelistCrit(sheet, record, crit)) {
    return [];
  }
  const fresh = getFoe(enemy.id);
  if (!fresh || fresh.status !== "alive") {
    return [];
  }
  const trade = `The choice is ${sheet.name}'s player's: to trade one for the other, set_condition takes the one off and lays the other (a disarmed creature's weapon falls: handle_item drop with its enemyId).`;
  const felled = fresh.conditions.includes("prone") ? null : applyRiderCondition(campaign, fresh, "prone");
  if (felled?.applied) {
    return [`Sky Duelist: the critical hit knocks ${fresh.displayName} prone. ${trade}`];
  }
  const why = felled && !felled.applied ? felled.reason : `${fresh.displayName} is already prone.`;
  const disarmed = fresh.conditions.includes(DISARMED) ? null : applyRiderCondition(campaign, getFoe(enemy.id) ?? fresh, DISARMED, { rounds: 1 });
  if (disarmed?.applied) {
    return [`Sky Duelist: ${why} The critical hit disarms it instead: what it held falls (handle_item drop with its enemyId).`];
  }
  return [`Sky Duelist: ${why} ${disarmed && !disarmed.applied ? disarmed.reason : `${fresh.displayName} is already disarmed.`} The critical hit leaves neither on it.`];
}
