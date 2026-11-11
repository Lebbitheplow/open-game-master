// Benign Transposition (School of Conjuration 6): "Teleport 30 feet or swap
// places with a willing creature". The counter's teleport (resource-tools.ts,
// fx teleport) left a 30-foot jump waiting for move_token; with a willing
// creature named the use and the action were spent and nobody moved, the
// result telling the GM to move a token the board's teleport then refused
// (both squares are occupied, by each other).
//
// The swap: use_resource with targetCharacterId. The two tokens change
// squares on the live board. The willing creature must stand within the
// feature's own 30 feet: the wizard teleports into its space, and the
// feature moves them no farther than that (the source feature says "a space
// within range that is occupied by a creature"). Planned before the use is
// spent, so a refusal costs nothing; applied in the spend.
//
// Called by resource-tools.ts computeUseResource for a counter whose teleport
// says swap.
//
// "or when you cast a conjuration spell": the use also comes back when its
// holder casts a conjuration spell of 1st level or higher (the counter's
// castRefill, src/lib/srd/authored-resources.json). The counter's guidance
// said so and nothing did it. castRefills is called by cast-guard.ts
// castSpell, the one door every casting passes, once nothing can refuse the
// cast any more. A cantrip refills nothing: the feature it condenses says "a
// conjuration spell of 1st level or higher".

import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { placeTeleported } from "@/lib/dm/teleport-place";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveBoard } from "@/lib/db/encounters";
import { planTeleportFx } from "@/lib/battlemap/fx-plan";
import { TILE_FEET } from "@/lib/battlemap/types";
import { tilesApart } from "@/lib/dm/board-reach";
import { publishFx } from "@/lib/dm/fx";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { RESOURCE_DEFS } from "@/lib/srd/class-resources";

export type SwapPlan = { apply: () => string };

// The swap of `sheet` and `target`, or why it cannot be.
export function planSwap(campaign: Campaign, sheet: CharacterSheet, target: CharacterSheet, feature: string, feet: number): SwapPlan | ToolError {
  if (target.currentHp <= 0 && target.deathSaves) {
    // "A willing creature": one that can agree to it.
    return { error: `${target.name} is down and cannot agree to ${feature}; it swaps places with a willing creature. Nothing was spent.`, refused: "rules" };
  }
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const mine = map ? getTokenByRef(map.id, sheet.id) : null;
  const theirs = map ? getTokenByRef(map.id, target.id) : null;
  if (!map || !mine || !theirs) {
    // No board holds them both: the swap is the story's, and nothing is measured.
    return { apply: () => `${sheet.name} and ${target.name} change places.` };
  }
  const apart = tilesApart(mine, theirs) * TILE_FEET;
  if (apart > feet) {
    return { error: `${target.name} is ${apart} ft away; ${feature} swaps places with a willing creature within ${feet} ft. Nothing was spent.`, refused: "rules" };
  }
  return {
    apply: () => {
      const [from, to] = [{ x: mine.x, y: mine.y }, { x: theirs.x, y: theirs.y }];
      placeTeleported(campaign.id, mine, to);
      placeTeleported(campaign.id, theirs, from);
      publishBattleMapUpdate(campaign.id);
      publishFx(campaign.id, planTeleportFx({ from, to, tokenId: mine.id }));
      publishFx(campaign.id, planTeleportFx({ from: to, to: from, tokenId: theirs.id }));
      return `${sheet.name} and ${target.name} change places: ${sheet.name} stands at (${to.x},${to.y}), ${target.name} at (${from.x},${from.y}). No movement was spent; the board already shows it.`;
    },
  };
}

// The counters a casting of this school and level gives back, as the
// resources they leave and a line for each, or null when it refills none.
export function castRefills(
  resources: CharacterSheet["resources"],
  spell: { school: string | null; level: number },
): { resources: CharacterSheet["resources"]; notes: string[] } | null {
  const school = textKey(spell.school ?? "");
  let next = resources;
  const notes: string[] = [];
  for (const def of RESOURCE_DEFS) {
    const state = next[def.id];
    if (!def.castRefill || !state || state.used <= 0 || spell.level < def.castRefill.minLevel || textKey(def.castRefill.school) !== school) {
      continue;
    }
    next = { ...next, [def.id]: { ...state, used: 0 } };
    notes.push(`${def.displayName} is ready again: a ${def.castRefill.school} spell of level ${def.castRefill.minLevel} or higher was cast.`);
  }
  return notes.length ? { resources: next, notes } : null;
}
