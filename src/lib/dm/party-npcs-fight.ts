// The NPCs the party travels with take the field beside it when a fight
// opens, and the fight's end writes back what it did to them. The rules
// are src/lib/dm/party-npcs-fight-logic.ts; this file reads the roster and
// writes the rows.

import type { Campaign } from "@/lib/db/campaigns";
import { withSide } from "@/lib/dm/combat-sides-logic";
import { getNpcAway } from "@/lib/db/npc-minds";
import { getCurrentLocation } from "@/lib/db/locations";
import { textKey } from "@/lib/language/text-logic";
import { getNpcById, listNpcs, setNpcState } from "@/lib/db/npcs";
import { insertEnemy, setEncounterSides, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { lastAppearanceOfNpc, latestAppearance } from "@/lib/db/foe-history";
import { groupInitiatives, resolveEnemyRequests, type ResolvedEnemyRequest } from "@/lib/dm/encounter-spawn";
import { arrivalsFor } from "@/lib/dm/foe-return";
import { KNOCKED_OUT } from "@/lib/dm/knockout";
import { partyFollowers } from "@/lib/dm/npc-state-logic";
import { allyField, stateAfterFight } from "@/lib/dm/party-npcs-fight-logic";
import { MAX_COMBATANTS } from "@/lib/dm/party-budget";

// Every tracked NPC following the party, on the board on its side. NPCs the
// fight already has (one named among the foes) are left where the caller put
// them. Rows carry no XP: nobody earns anything for an ally.
export function fieldPartyNpcs(campaign: Campaign, encounter: Encounter, taken: ReadonlySet<string>): EncounterEnemy[] {
  const npcs = listNpcs(campaign.id).filter((npc) => !npc.archived && !npc.companionSheetId);
  const following = new Set(
    partyFollowers(npcs.map((npc) => ({ id: npc.id, name: npc.name, aliases: npc.aliases, state: npc.state, away: Boolean(getNpcAway(npc.id)) }))),
  );
  // Only who is where the fight is: one left behind when the party split
  // does not take the board.
  const here = textKey(getCurrentLocation(campaign.id)?.name ?? "");
  const fielded: Array<{ entry: ResolvedEnemyRequest; field: NonNullable<ReturnType<typeof allyField>> }> = [];
  for (const npc of npcs) {
    const elsewhere = here !== "" && npc.location.trim() !== "" && textKey(npc.location) !== here;
    if (!following.has(npc.id) || elsewhere || taken.has(npc.id) || fielded.length >= MAX_COMBATANTS) {
      continue;
    }
    const field = allyField(npc.state);
    if (!field) {
      continue;
    }
    const own = npc.statBlock ? resolveEnemyRequests(campaign.gameSettings, [{ monster: npc.name }], undefined, campaign.id) : null;
    const outcome = own && "resolved" in own && own.resolved[0]?.npcId === npc.id
      ? own
      : resolveEnemyRequests(campaign.gameSettings, [{ monster: field.block, name: npc.name }]);
    const entry = "resolved" in outcome ? outcome.resolved[0] : undefined;
    if (!entry) {
      continue;
    }
    const last = entry.returning ? null : lastAppearanceOfNpc(campaign.id, npc.id);
    fielded.push({
      entry: { ...entry, name: npc.name, npcId: npc.id, group: undefined, ...(last ? { returning: latestAppearance(last.id)?.id ?? last.id } : {}) },
      field,
    });
  }
  if (!fielded.length) {
    return [];
  }
  const entries = fielded.map((item) => item.entry);
  const arrivals = arrivalsFor(campaign, entries, null);
  const carries = "carries" in arrivals ? arrivals.carries : entries.map(() => null);
  const names = entries.map((entry) => entry.name);
  const initiatives = groupInitiatives(campaign.id, entries, names);
  let sides = encounter.sides;
  const rows = fielded.map(({ entry, field }, index) => {
    const carried = carries[index]?.arrives;
    const conditions = [...new Set([...(carried?.conditions ?? []), ...field.conditions])];
    const conditionMeta = { ...(carried?.conditionMeta ?? {}), ...(field.down ? { unconscious: { source: KNOCKED_OUT } } : {}) };
    const row = insertEnemy({
      encounterId: encounter.id,
      campaignId: campaign.id,
      slug: entry.slug,
      displayName: entry.name,
      initiative: initiatives[index],
      stats: entry.stats,
      npcId: entry.npcId,
      arrives: {
        currentHp: field.down ? 0 : (carried?.currentHp ?? entry.stats.maxHp),
        conditions,
        conditionMeta,
        xp: 0,
        carriedFrom: carried?.carriedFrom ?? "",
      },
    });
    sides = withSide(sides, "enemy", row.id, "party");
    return row;
  });
  encounter.sides = sides;
  setEncounterSides(encounter.id, sides);
  return rows;
}

// The rows of a fight that stood on the party's side for a tracked NPC.
export function partyNpcRows(encounter: Encounter, enemies: readonly EncounterEnemy[]): EncounterEnemy[] {
  return enemies.filter((enemy) => enemy.npcId && encounter.sides[enemy.id] === "party");
}

// The fight is over: an NPC who fell in it beside the party is dead or down
// in their record, so the story cannot walk them on unhurt. Returns the
// names whose record changed.
export function settlePartyNpcs(encounter: Encounter, enemies: readonly EncounterEnemy[]): string[] {
  const changed: string[] = [];
  for (const row of partyNpcRows(encounter, enemies)) {
    const npc = row.npcId ? getNpcById(row.npcId) : null;
    if (!npc) {
      continue;
    }
    const next = stateAfterFight(npc.state, row);
    if (next.condition !== npc.state.condition) {
      setNpcState(npc.id, next);
      changed.push(`${npc.name}: ${next.condition}`);
    }
  }
  return changed;
}
