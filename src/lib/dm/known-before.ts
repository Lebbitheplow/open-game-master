import type { Campaign } from "@/lib/db/campaigns";
import { getDatabase, nowIso } from "@/lib/db/core";
import { listNpcs, markNpcMet, standsBehindLiveCompanion } from "@/lib/db/npcs";
import { ensureRelationship, getRelationship, patchRelationship } from "@/lib/db/relationships";
import { listSheets } from "@/lib/db/sheets";
import { livingHero } from "@/lib/characters/fallen-logic";
import { fieldedSheets } from "@/lib/dm/roster";
import { publishCast } from "@/lib/dm/cast";
import { publishRelationshipsUpdated } from "@/lib/dm/relationship-subject";
import { addMemory } from "@/lib/dm/relationship-logic";
import { KNOWN_BEFORE_MEMORY, tiesToOpen } from "@/lib/dm/known-before-logic";
import { textKey } from "@/lib/language/text-logic";

// The people the party already knows when the story begins (issue 731,
// src/lib/dm/known-before-logic.ts) open their ties as the table begins:
// each is met, so no reaction roll greets an old friend and every seat's
// cast knows them, and every hero in play opens a bond with them at the
// grade's standing, its first memory the author's line on how they know
// each other. Called as the table begins (the lobby's Begin), before the
// opening narration reads the bonds, and after a module is brought into a
// table that has begun but not yet heard its first narration.
//
// Never once the story is under way: a hero who joins later meets them as
// anyone met in play (party-bonds.ts openJoinerBonds), and a module brought
// in mid-story does not rewrite what the table has played. A bond already
// on file is never touched, so a second call opens nothing.

// The story has started once the GM (a person or the AI) has narrated.
export function storyUnderway(campaignId: string): boolean {
  return Boolean(
    getDatabase().prepare(`SELECT 1 FROM campaign_messages WHERE campaign_id = ? AND author_type = 'dm' LIMIT 1`).get(campaignId),
  );
}

// Returns how many people it met and how many bonds it opened.
export function openPreStoryTies(campaign: Campaign): { met: number; opened: number } {
  // A table, never a workshop being written or a test fight played in one.
  if (campaign.kind !== "campaign" || storyUnderway(campaign.id)) {
    return { met: 0, opened: 0 };
  }
  const npcs = listNpcs(campaign.id);
  const ties = tiesToOpen(
    npcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      attitude: npc.attitude,
      archived: npc.archived,
      knownBefore: npc.knownBefore,
      behindCompanion: standsBehindLiveCompanion(npc),
    })),
  );
  if (!ties.length) {
    return { met: 0, opened: 0 };
  }
  const bondsOn = campaign.gameSettings.relationships !== "off";
  const heroes = fieldedSheets(campaign, listSheets(campaign.id)).filter(livingHero);
  const at = nowIso();
  let met = 0;
  let opened = 0;
  for (const tie of ties) {
    if (!npcs.find((npc) => npc.id === tie.npcId)?.metAt) {
      markNpcMet(tie.npcId);
      met += 1;
    }
    if (!bondsOn) {
      continue;
    }
    for (const hero of heroes) {
      if (textKey(hero.name) === textKey(tie.name) || getRelationship(campaign.id, hero.id, tie.name)) {
        continue;
      }
      const bond = ensureRelationship({
        campaignId: campaign.id,
        characterId: hero.id,
        characterName: hero.name,
        subjectKind: "npc",
        subjectName: tie.name,
        subjectId: tie.npcId,
      });
      patchRelationship(bond.id, {
        approval: tie.approval,
        memories: addMemory(bond.memories, { kind: KNOWN_BEFORE_MEMORY, text: tie.how, at }),
      });
      opened += 1;
    }
  }
  if (opened) {
    publishRelationshipsUpdated(campaign.id);
  }
  if (met) {
    publishCast(campaign.id);
  }
  return { met, opened };
}
