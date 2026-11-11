// Flash of Genius (Artificer 7) on a saving throw that could not wait:
// "When you or another creature you can see within 30 feet of you makes an
// ability check or a saving throw, you can use your reaction to add your
// Intelligence modifier to the roll."
//
// A player's own roll waits on the after-the-roll card, where the artificer
// adds the modifier before the roll lands (after-roll.ts allyChoicesFor,
// spendAfterRoll). A save a creature forces on a seat that cannot wait (an
// agent's, a companion's, a card that timed out) has landed by the time
// anyone can answer it, and until now use_resource took the use and the
// reaction and added nothing. Here the use answers the record of that failed
// save (last-save.ts, the row in src/lib/srd/trigger-table.ts): the modifier
// goes on the roll as it was thrown (the rolls table), and when it reaches the
// DC the save is a success and what its failure alone cost comes back
// (save-turned.ts). With no failed save on record the use is refused and
// nothing is spent (reaction-counters.ts planCounterReaction).
//
// A failed ability check keeps no record of what it cost, so one is answered
// on the card alone. Planned before the use is spent; must not import
// mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { failedSaveRollOf } from "@/lib/dm/ar-ws-deflection";
import { unseenRefusal } from "@/lib/dm/authored-saves";
import { openSaves } from "@/lib/dm/last-save";
import { openTriggersFor, type TriggerAsk } from "@/lib/dm/reaction-triggers";
import { turnFailedSave } from "@/lib/dm/save-turned";
import type { ToolError } from "@/lib/dm/tool-errors";
import { computeSheetDerived } from "@/lib/srd";
import { triggerSpecFor } from "@/lib/srd/trigger-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const FLASH_OF_GENIUS_ID = "art_flash_of_genius";
const NAME = "Flash of Genius";

type Plan = { apply: () => Record<string, unknown> };
type Input = { campaign: Campaign; turnId: string; sheet: CharacterSheet; targetCharacterId?: string; sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> };

export function planFlashOfGenius(input: Input, ask: TriggerAsk): Plan | ToolError {
  const { campaign, sheet } = input;
  const encounter = getActiveEncounter(campaign.id);
  const spec = triggerSpecFor(ask.name, { counterId: ask.counterId });
  const open = spec ? openTriggersFor(ask, spec) : [];
  // The save of the creature the call names, else the latest one open.
  const named = input.targetCharacterId ? (input.sheetsById.get(input.targetCharacterId) ?? input.sheets.find((entry) => entry.id === input.targetCharacterId) ?? null) : null;
  const event = (named ? open.filter((entry) => entry.characterId === named.id) : open).at(-1);
  const roller = event ? getSheetById(event.characterId) : null;
  const save = event ? openSaves(campaign.id).find((record) => record.id === event.id) : undefined;
  const roll = roller && encounter ? failedSaveRollOf(campaign.id, roller.id, encounter) : null;
  if (!event || !roller || !save || !roll || roll.dc === null) {
    return { error: `${NAME} answers a saving throw ${named ? named.name : `${sheet.name} or a creature within 30 feet of them`} has just failed, and the server has no such roll on record this turn. Nothing was spent.`, refused: "rules" };
  }
  // "Another creature you can see".
  const unseen = roller.id === sheet.id ? null : unseenRefusal(encounter?.id, sheet, roller, NAME);
  if (unseen) {
    return unseen;
  }
  const int = computeSheetDerived(sheet).abilityMods.int;
  if (int < 1) {
    return { error: `${NAME} adds ${sheet.name}'s Intelligence modifier, which is ${int}: it would add nothing to the roll. Nothing was spent.`, refused: "rules" };
  }
  const dc = roll.dc;
  return {
    apply: () => {
      const total = roll.total + int;
      const lead = `+${int} on ${roller.id === sheet.id ? "their own" : `${roller.name}'s`} ${save.ability.toUpperCase()} save: ${roll.total} becomes ${total} against DC ${dc}`;
      if (total < dc) {
        return { applied: `${lead}, and the failure stands.`, save: "failure" };
      }
      const turned = turnFailedSave(campaign, input.turnId, save, `${NAME}: the save succeeds`);
      return { applied: `${lead}. ${turned.line}`, save: "success" };
    },
  };
}
