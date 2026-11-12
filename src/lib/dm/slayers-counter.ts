// Slayer's Counter (Monster Slayer 15): "A reaction attacks your prey when it
// forces a save on you, and a hit means the save automatically succeeds."
//
// A reaction that changes a roll acts before the outcome lands. When the
// creature under the ranger's Slayer's Prey is about to force a save on them,
// the server stops for the ranger's player before the save is rolled
// (foresight.ts watcherFor, the stop it makes for a watcher; no Watch button
// is asked of them, since the stop comes only for their own save from their
// own prey). On "attack it first" the ranger's one weapon attack is made here,
// before the held call runs: a hit lays the mark that makes that save succeed
// with no roll (slayers-counter-mark.ts), a miss leaves the save to be
// rolled, and either way the reaction is spent.
//
// A seat no stop reaches (an agent's, a companion's, a player away from the
// table) keeps the answer to a save already rolled (authored-reactions.ts
// case attack, turnsSave), since nobody can be asked before it.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { slayersCounterStops } from "@/lib/dm/foresight";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { layCounteredSave } from "@/lib/dm/slayers-counter-mark";
import { markReactionUsed } from "@/lib/dm/turn-budget";

const NAME = "Slayer's Counter";

// The ranger's answer at the stop: the attack, made before the call that
// forces the save runs. The line the model reads, or null when the stop no
// longer holds (the prey died, the reaction went elsewhere).
export function slayersCounterAtStop(campaign: Campaign, turn: DmTurn, rangerId: string, preyId: string | null): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const ranger = getSheetById(rangerId);
  const prey = preyId ? getEnemy(preyId) : null;
  if (!encounter || !ranger || !prey || prey.status !== "alive" || !slayersCounterStops(campaign.id, encounter, ranger, prey.id)) {
    return null;
  }
  const sheets = listSheets(campaign.id);
  const result = handlePcAttack(campaign, turn, JSON.stringify({ characterId: ranger.id, targetEnemyId: prey.id }), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), new Set(), null, { reactionAttack: true });
  if (typeof result.error === "string") {
    return `${ranger.name}'s ${NAME} could not be made (${result.error}) Their reaction is not spent, and the save is rolled.`;
  }
  const live = getActiveEncounter(campaign.id);
  if (live && !live.reactionsUsed.includes(ranger.id)) {
    markReactionUsed(live, ranger.id);
  }
  if (!result.hit) {
    return `${ranger.name} used ${NAME}: the attack on ${prey.displayName} missed, and the save is rolled.`;
  }
  const updated = layCounteredSave(ranger.id, prey.id);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${ranger.name} used ${NAME}: the attack hit ${prey.displayName}, so the save it forces on ${ranger.name} succeeds with no roll.`;
}
