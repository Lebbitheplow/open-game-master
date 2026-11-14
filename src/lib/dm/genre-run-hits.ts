// What a run at a creature adds to the melee hit it ends in, beyond the
// damage riders (genre-a-strikes.ts afterRunFt) and the saves (hit-save.ts
// afterRunFt): Ram Speed's shove, "when you move 20+ ft straight toward a
// target and hit with a melee attack, deal +2d6 and shove it 10 ft". Read
// from the authored "run_push" effect, on the turn's record of the run
// (src/lib/dm/mt-fb-charge.ts), called by attack-blow.ts after the blow.
//
// Before this Ram Speed was a sentence in the GM's prompt: no dice, no shove.
import { getActiveEncounter } from "@/lib/db/encounters";
import type { AttackRecord } from "@/lib/dm/attack-record";
import type { SwingScene } from "@/lib/dm/attack-swing";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { chargedFeet } from "@/lib/srd/mt-fb-run";

export function runPush(scene: SwingScene, record: AttackRecord): string | null {
  const { campaign, sheet, enemy } = scene;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !record.melee) {
    return null;
  }
  const marks = encounter.turnBudget?.ownerId === sheet.id ? encounter.turnBudget.oncePerTurn : [];
  const row = activeAuthored(sheet, "run_push").find(({ effect }) => chargedFeet(marks, enemy.id) >= effect.afterRunFt);
  if (!row) {
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
  return feet
    ? `${row.held.feature}: ${enemy.displayName} is shoved ${feet} feet away${stopped ? ` (${stopped})` : ""}.`
    : `${row.held.feature}: ${enemy.displayName} is not shoved${stopped ? ` (${stopped})` : ""}.`;
}
