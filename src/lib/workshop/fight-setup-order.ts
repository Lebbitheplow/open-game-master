import type { Campaign } from "@/lib/db/campaigns";
import { getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { recordInitiativeRoll } from "@/lib/dm/encounter-tools";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { fieldedSheets } from "@/lib/dm/roster";

// A test table's order from its set-up (issue 685). Apart from
// src/lib/workshop/fight-setup.ts because the encounter tools import the
// prepared-fight path that lays a set-up's foes at a live table, and this
// part needs the encounter tools: only a test fight's start calls it.
//
// The deploy already locked an order on fresh rolls, so the order is
// collected again from the set-up's totals through the engine's own lock
// (recordInitiativeRoll), which builds the order, opens round 1 on the first
// who can act, and holds the enemies ahead of them, as any fight's opening
// does. The enemies' totals are on their rows already (layFightSetup). A
// hero the set-up has no total for keeps the one the deploy rolled; one
// whose roll card still waits answers it as before, and the order locks on
// that answer.
export function relockOrder(campaign: Campaign, totals: ReadonlyMap<string, number>) {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) return;
  const rolled = new Map(
    encounter.order.flatMap((entry) => (entry.kind === "pc" && !entry.reflex ? [[entry.characterId, entry.initiative] as const] : [])),
  );
  encounter.order = [];
  encounter.orderReady = false;
  encounter.turnIndex = 0;
  encounter.round = 1;
  encounter.turnBudget = null;
  // What the first lock's opening left behind belongs to that order: the
  // enemies it held due (holdForEnemies adds to them, never replaces), the
  // turns it noted lost.
  encounter.legendary = {
    ...encounter.legendary,
    due: [],
    lost: [],
    walked: [],
    acted: undefined,
    handoff: undefined,
    rest: undefined,
    lairDue: undefined,
    opportunities: undefined,
  };
  saveEncounter(encounter);
  const fresh = getCampaignById(campaign.id) ?? campaign;
  for (const sheet of fieldedSheets(fresh)) {
    const total = totals.get(sheet.id) ?? rolled.get(sheet.id);
    if (total !== undefined && !getSheetById(sheet.id)?.deathSaves?.dead) {
      recordInitiativeRoll(campaign.id, sheet.id, total);
    }
  }
  publishEncounter(campaign.id);
}
