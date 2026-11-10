// One switch from an adjudication name to the handler that performs it.
//
// Every arm calls exactly what turn.ts calls for the same tool. That is the
// point: there is one rules engine, and swapping the AI DM for a person
// swaps the caller, not the game.
import { maybeProposeItemChange } from "@/lib/dm/proposal-intercept";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import { AGENT_MARK } from "@/lib/dm/agent-mark";
import { enqueueDmJob } from "@/lib/dm/queue";
import { handleCompleteBeat } from "@/lib/dm/arc";
import { handleCastBuff } from "@/lib/dm/cast-tools";
import { handleCheckNotice, handleGroupCheck } from "@/lib/dm/check-tools";
import { handleAddCompanion } from "@/lib/dm/companion-tools";
import { dismissCompanion } from "@/lib/dm/companion-dismissal";
import { applyEncounterCall, ENCOUNTER_TOOL_NAMES } from "@/lib/dm/encounter-tools";
import { playLegendaryAction, playsWhole } from "@/lib/dm/legendary-play";
import { handleApplyHazard } from "@/lib/dm/hazard-tools";
import { handleSearchLore } from "@/lib/dm/lore-search";
import { handleReadCard } from "@/lib/dm/prep-card-tool";
import { applyDmMutation, MUTATION_TOOL_NAMES } from "@/lib/dm/mutations";
import { handleWriteCampaignNote } from "@/lib/dm/note-tools";
import {
  handleDamagePet,
  handleDismissPet,
  handlePetAttack,
  handleSummonPet,
} from "@/lib/dm/pet-tools";
import { handleRecallStory } from "@/lib/dm/recall";
import { handleRelationshipScheme } from "@/lib/dm/scheme-tools";
import {
  handleRelationshipBeat,
  handleRelationshipEnd,
  handleRomanceAdvance,
} from "@/lib/dm/relationship-tools";
import { handleTakeRest } from "@/lib/dm/rest-tools";
import { handleNpcReaction, handleSetNpc, handleSocialCheck } from "@/lib/dm/social-tools";
import { handlePartyStash } from "@/lib/dm/party-tools";
import { handleClearEffect, handleSetEffect } from "@/lib/dm/effect-tools";
import { handleEndScene, handleSceneCheck, handleStartScene } from "@/lib/dm/scene-tools";
import { handlePlaySting, handleSetAmbience } from "@/lib/dm/ambience-tools";
import { handleDismount, handleMountUp } from "@/lib/dm/mount-tools";
import { handleItemCall } from "@/lib/dm/gear-tool";
import {
  handleDamageObject,
  handlePassTime,
  handleRollTreasure,
  handleSetWeather,
  handleShowTitle,
  handleTravel,
} from "@/lib/dm/world-tools";
import { handleSendWhisper } from "@/lib/dm/whispers";
import {
  handleDismissHandout,
  handleSetQuest,
  handleShowHandout,
  handleTickObjective,
} from "@/lib/dm/binder-tools";
import { handleAdjustReputation, handleFactionNote } from "@/lib/dm/faction-tools";
import { handleBuyItem, handleHaggle, handleOpenShop, handleSellItem } from "@/lib/dm/shop-tools";
import { handleGenerateSettlement } from "@/lib/dm/settlement-tools";
import {
  handleLocationCall,
  handleRecordEvent,
  handleRequestPlayerInput,
  modelCallArguments,
} from "@/lib/dm/turn";
import { imagesAvailable } from "@/lib/capabilities";
import { imageProducerReady } from "@/lib/image-generate";
import { handleGenerateImage } from "@/lib/dm/images";
import { handleRequestRoll } from "@/lib/dm/invoke-roll";
import { handleSplitDamage } from "@/lib/dm/split-damage";
import { strictBooleanArgs } from "@/lib/dm/arg-coerce";
import { listedCalls, listRefusal, oneCasting, PART_LISTS, partsResult, type OneCasting } from "@/lib/dm/action-parts-logic";
import { awayCall, gateAiCall } from "@/lib/dm/ai-gate";
import { conductGate } from "@/lib/dm/party-conduct";
import { characterCallUnasked, prepareWordFor } from "@/lib/dm/player-word";
import { EXPLORE_TOOL_NAMES, handleExploreCall } from "@/lib/dm/explore-tools";
import { watchRungs } from "@/lib/dm/romance-stage-lines";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { registerHeldRunner, runHeld } from "@/lib/dm/held-call";
import { deedRefusal } from "@/lib/dm/deed-guard";
import { heldRollUserIds } from "@/lib/dice/held-rolls";
import { listMembers } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";

const MUTATIONS = new Set<string>(MUTATION_TOOL_NAMES);
const ENCOUNTERS = new Set<string>(ENCOUNTER_TOOL_NAMES);

export type DispatchContext = {
  campaign: Campaign;
  turn: DmTurn;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  realDiceUserIds: Set<string>;
  // A call the server built itself from a stat block, inside a legendary
  // option it plays whole (src/lib/dm/legendary-play.ts): no number or
  // condition in it is the model's, so the AI's gate (ai-gate.ts), there to
  // keep the model's own numbers out, has nothing to hold back.
  serverBuilt?: boolean;
  // The model's tool call this answers, for a roll that holds it: the
  // resumed turn answers that call (turn.ts).
  toolCallId?: string | null;
};

export async function dispatchAdjudication(
  name: string,
  sentArguments: string,
  context: DispatchContext,
): Promise<ToolResult> {
  // A romance rung the call moves, up or down, is told to the table here,
  // at the one door the AI's turn and a person's console share (issue 640).
  return watchRungs(context.campaign, name, () => dispatchCall(name, sentArguments, context));
}

async function dispatchCall(
  name: string,
  sentArguments: string,
  context: DispatchContext,
  // One entry of a heal list: the casting its entries share.
  casting?: OneCasting,
): Promise<ToolResult> {
  const { campaign, turn, sheets, sheetsById } = context;
  // The arguments as every gate and handler reads them, as the model's turn
  // loop reads them (turn.ts modelCallArguments).
  const door = modelCallArguments(campaign, name, sentArguments, sheets);
  if ("refusal" in door) {
    return door.refusal;
  }
  sentArguments = door.rawArguments;
  // A chest's items, a shopping list, the creatures a healing spell
  // reaches: each entry the one-entry call it always was
  // (src/lib/dm/action-parts-logic.ts listedCalls), for a connected agent
  // program and the console as for the model's turn loop (turn.ts).
  const each = listedCalls(name, sentArguments);
  if (each) {
    const refused = listRefusal(name, each) ?? awayCall(name, JSON.parse(sentArguments), context);
    if (refused) {
      return refused;
    }
    const shared = oneCasting(name, each);
    const outcomes: Record<string, unknown>[] = [];
    for (const one of each) {
      outcomes.push(await dispatchCall(name, JSON.stringify(one), context, shared));
    }
    return partsResult(outcomes, PART_LISTS[name].key);
  }
  // "false" sent as a string is false (src/lib/dm/arg-coerce.ts).
  const coerced = strictBooleanArgs(sentArguments);
  // A connected agent program is held to its player's words as the AI is
  // (src/lib/dm/player-word.ts); at a table in another language they are
  // read once first.
  await prepareWordFor(campaign, turn ?? null, coerced);
  // The model's damage, healing and binding conditions are the server's to
  // roll (src/lib/dm/ai-gate.ts); the console keeps its free hand.
  const gated = context.serverBuilt ? { args: coerced } : gateAiCall(name, coerced, { campaign, turn, sheetsById });
  if ("result" in gated) {
    return gated.result;
  }
  const rawArguments = gated.args;
  // A deed out of a fight by a character who cannot act (deed-guard.ts).
  const unable = deedRefusal(campaign.id, name, rawArguments, context.sheets, sheetsById);
  if (unable) {
    return unable;
  }
  // Held so a roll inside it may wait on its player (src/lib/dm/held-call.ts).
  return runHeld(campaign, turn, { name, rawArguments, toolCallId: context.toolCallId ?? null }, () => engineCall(name, rawArguments, context, casting));
}

// The handler a call names, past the gates: the part of the call a held roll
// runs again (held-call.ts registerHeldRunner, below).
function engineCall(
  name: string,
  rawArguments: string,
  context: DispatchContext,
  casting?: OneCasting,
): ToolResult | Promise<ToolResult> {
  const { campaign, turn, sheets, sheetsById } = context;
  if (MUTATIONS.has(name)) {
    // inventoryApprovals holds for whoever runs the table: an item or gold
    // change to a player character is an offer they answer, from the console
    // as from the AI's turn (turn.ts).
    return (
      maybeProposeItemChange(campaign, turn.id, name, rawArguments, sheetsById) ??
      applyDmMutation(campaign, turn.id, name, rawArguments, sheets, sheetsById, turn, casting).result
    );
  }
  // A legendary action named with what it buys needs (the GM's card, the
  // console's form filled in): the spend and its follow-up as one step,
  // the action given back if the engine refuses the follow-up
  // (src/lib/dm/legendary-play.ts, issue 685 audit).
  if (name === "legendary_action" && playsWhole(rawArguments)) {
    return playLegendaryAction(campaign, turn, rawArguments, (tool, args) => dispatchCall(tool, JSON.stringify(args), { ...context, serverBuilt: true }));
  }
  if (ENCOUNTERS.has(name)) {
    return applyEncounterCall(campaign, turn, name, rawArguments, sheets, sheetsById, {
      realDiceUserIds: context.realDiceUserIds,
      toolCallId: context.toolCallId ?? null,
    }).result;
  }

  // Lifting, lifestyles, downtime and afflictions (src/lib/dm/explore-tools.ts).
  if ((EXPLORE_TOOL_NAMES as readonly string[]).includes(name)) {
    return handleExploreCall(campaign, turn, name, rawArguments, sheets, sheetsById);
  }

  switch (name) {
    case "request_roll":
      return handleRequestRoll(
        campaign,
        turn,
        rawArguments,
        sheets,
        sheetsById,
        context.realDiceUserIds,
      );
    case "cast_buff": {
      const unasked = characterCallUnasked(campaign.id, turn, rawArguments, "characterId");
      return unasked ?? conductGate(campaign, name, rawArguments) ?? handleCastBuff(campaign, turn, rawArguments, sheets, sheetsById);
    }
    case "take_rest":
      return handleTakeRest(campaign, turn.id, rawArguments, sheets, sheetsById);
    case "group_check":
      return handleGroupCheck(campaign, turn, rawArguments, sheets, sheetsById);
    case "check_notice":
      return handleCheckNotice(campaign, turn, rawArguments, sheets, sheetsById);
    case "split_damage":
      return handleSplitDamage(campaign, turn, rawArguments, sheets, sheetsById);
    case "apply_hazard":
      return handleApplyHazard(campaign, turn, rawArguments, sheets, sheetsById);
    case "summon_pet":
      return handleSummonPet(campaign, rawArguments, sheets, sheetsById);
    case "pet_attack": {
      const unasked = characterCallUnasked(campaign.id, turn, rawArguments, "characterId");
      return unasked ? unasked : handlePetAttack(campaign, turn, rawArguments, sheets, sheetsById);
    }
    case "damage_pet":
      return handleDamagePet(campaign, rawArguments, sheets, sheetsById);
    case "dismiss_pet":
      return handleDismissPet(campaign, rawArguments, sheets, sheetsById);
    case "set_npc":
      return handleSetNpc(campaign, rawArguments);
    case "npc_reaction":
      return handleNpcReaction(campaign, turn, rawArguments);
    case "social_check":
      return handleSocialCheck(campaign, turn, rawArguments, sheets, sheetsById);
    case "relationship_beat":
      return handleRelationshipBeat(campaign, turn, rawArguments, sheets, sheetsById);
    case "romance_advance":
      return handleRomanceAdvance(campaign, turn, rawArguments, sheets, sheetsById);
    case "relationship_end":
      return handleRelationshipEnd(campaign, rawArguments, sheets, sheetsById);
    case "relationship_scheme":
      return handleRelationshipScheme(campaign, rawArguments, sheets, sheetsById);
    case "roll_treasure":
      return handleRollTreasure(campaign, turn, rawArguments, sheets, sheetsById);
    case "travel":
      return handleTravel(campaign, turn, rawArguments, sheets, sheetsById);
    case "pass_time":
      return handlePassTime(campaign, rawArguments);
    case "set_weather":
      return handleSetWeather(campaign, rawArguments);
    case "show_title":
      return handleShowTitle(campaign, rawArguments);
    case "show_handout":
      return handleShowHandout(campaign, turn, rawArguments);
    case "dismiss_handout":
      return handleDismissHandout(campaign, rawArguments);
    case "set_quest":
      return handleSetQuest(campaign, rawArguments);
    case "tick_objective":
      return handleTickObjective(campaign, rawArguments);
    case "adjust_reputation":
      return handleAdjustReputation(campaign, rawArguments);
    case "open_shop":
      return handleOpenShop(campaign, rawArguments);
    case "generate_settlement":
      return handleGenerateSettlement(campaign, rawArguments);
    case "buy_item":
      return handleBuyItem(campaign, rawArguments);
    case "sell_item":
      return handleSellItem(campaign, rawArguments);
    case "haggle":
      return handleHaggle(campaign, rawArguments);
    case "faction_note":
      return handleFactionNote(campaign, rawArguments);
    case "party_stash":
      return handlePartyStash(campaign, rawArguments, sheets, sheetsById);
    case "set_effect":
      return handleSetEffect(campaign, rawArguments, sheets, sheetsById);
    case "clear_effect":
      return handleClearEffect(campaign, rawArguments, sheets, sheetsById);
    case "start_scene":
      return handleStartScene(campaign, rawArguments, sheets, sheetsById);
    case "scene_check":
      return handleSceneCheck(campaign, rawArguments, sheets, sheetsById);
    case "end_scene":
      return handleEndScene(campaign, rawArguments);
    case "set_ambience":
      return handleSetAmbience(campaign, rawArguments);
    case "play_sting":
      return handlePlaySting(campaign, rawArguments);
    case "mount_up":
      return handleMountUp(campaign, rawArguments, sheets, sheetsById, turn);
    case "dismount":
      return handleDismount(campaign, rawArguments, sheets, sheetsById, turn);
    case "handle_item":
      return handleItemCall(campaign, rawArguments, sheets, sheetsById, turn);
    case "damage_object":
      return handleDamageObject(rawArguments, campaign, turn);
    case "add_companion":
      return handleAddCompanion(campaign, rawArguments, sheets);
    case "dismiss_companion":
      return dismissCompanion(campaign, rawArguments, sheets, turn.actor === "ai" ? "ai" : "person");
    case "move_party":
    case "update_location":
      return (async () => {
        const pictures =
          campaign.gameSettings.mapsEnabled &&
          imageProducerReady(campaign.settings) &&
          (await imagesAvailable(campaign.settings));
        const result = handleLocationCall(campaign, name, rawArguments, pictures);
        // Bookkeeping the model's turn uses to link its narration to a map;
        // a person's narration is a separate message, so it goes no further.
        delete result.movedToNewLocation;
        delete result._locationId;
        delete result._mapAvailable;
        return result;
      })();
    case "request_player_input":
      return handleRequestPlayerInput(campaign, rawArguments, sheets, sheetsById);
    case "generate_image":
      return handleGenerateImage(campaign, rawArguments);
    case "record_event":
      return handleRecordEvent(campaign, rawArguments, sheets, sheetsById);
    case "complete_beat": {
      const outcome = handleCompleteBeat(campaign.id, rawArguments, false);
      // A person's "Beat achieved" counts toward the chapter the way the AI's
      // does at the end of its turn (turn.ts): the console used to drop the
      // flags, so a human table's chapters only closed at the message cap.
      // A connected agent program's turn is an AI turn with no end of the
      // loop to count it there, so its beat counts here too.
      if ((turn.actor !== "ai" || turn.conversation[0]?.content === AGENT_MARK) && (outcome.completed || outcome.gated)) {
        enqueueDmJob(campaign.id, () =>
          maybeCloseChapter(campaign.id, {
            beatCompleted: outcome.completed,
            beatGated: outcome.completed && outcome.gated,
            beatClaimed: !outcome.completed && outcome.gated,
          }),
        );
      }
      return outcome.result;
    }
    case "write_campaign_note":
      return handleWriteCampaignNote(campaign, rawArguments);
    case "send_whisper":
      return handleSendWhisper(campaign, turn.id, rawArguments, sheets, sheetsById);
    case "recall_story":
      return handleRecallStory(campaign, rawArguments);
    case "search_lore":
      return handleSearchLore(campaign.id, rawArguments);
    case "read_card":
      return handleReadCard(campaign, rawArguments);
    default:
      return { error: `The engine has no action called "${name}".`, retry: true };
  }
}

// A held roll landed: its call runs again by the same handler, past the gates
// it already passed (src/lib/dm/held-call.ts). A call whose handler waits on
// something else (a picture's backend) holds no roll, so it never comes back.
registerHeldRunner((campaign, turn, call) => {
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const realDiceUserIds = heldRollUserIds(campaign.gameSettings.dicePolicy, listMembers(campaign.id));
  const result = engineCall(call.name, call.rawArguments, { campaign, turn, sheets, sheetsById, realDiceUserIds, toolCallId: call.toolCallId, serverBuilt: true });
  if (result instanceof Promise) {
    void result.catch(() => {});
    return { error: `${call.name} cannot be run again once a roll lands.`, retry: true };
  }
  return result;
});
