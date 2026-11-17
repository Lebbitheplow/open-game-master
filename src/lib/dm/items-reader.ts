// The items reader (docs/specs/ogm-domain-owners.md, slice 3): at a staged
// table, once the turn's narration is final, one model reads the turn and
// names what changed hands; the items owner makes each move or refuses it.
// The master narrates and no longer moves things itself: handle_item "hand"
// and remove_item are refused to it here (masterItemRefusal), so a hand-over
// has one decider and one writer. Making a thing new to the world stays the
// master's grant_item; using one up by the rules stays use_item.
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { listDroppedItems } from "@/lib/db/dropped-items";
import { getCurrentLocation } from "@/lib/db/locations";
import { listAuditForTurn } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { npcThings } from "@/lib/db/cast-sheets";
import { handleItemCall } from "@/lib/dm/gear-tool";
import { requestDmMessage } from "@/lib/dm/model";
import { applyDmMutation } from "@/lib/dm/mutations";
import { egoChoice } from "@/lib/dm/npc-mind";
import { npcStageOn, onStage, sheetOf } from "@/lib/dm/npc-stage";
import { thingNamed } from "@/lib/dm/npc-stage-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { ITEMS_READER_SYSTEM, parseItemMoves, planItemMove, renderItemsReaderPrompt, wholeThingNamed, type ItemMove, type ItemPerson } from "@/lib/dm/items-reader-logic";
import { withoutLeadingStopWords } from "@/lib/language/language";
import { textKey } from "@/lib/language/text-logic";
import { resolveTextTimeoutMs } from "@/lib/model-client";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

// The reader runs where the stage runs: the same tables, the same switch.
export function itemsReaderOn(campaign: Campaign): boolean {
  return npcStageOn(campaign);
}

// A thing moving between holders is the reader's to record, not the
// master's: told by the master, recorded again by the reader, it moved twice.
export function masterItemRefusal(campaign: Campaign, toolName: string, rawArguments: string): ToolResult | null {
  if (!itemsReaderOn(campaign)) {
    return null;
  }
  let action = "";
  try {
    const args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
    action = typeof args.action === "string" ? args.action : "";
  } catch {
    return null;
  }
  if (toolName === "remove_item" || (toolName === "handle_item" && action === "hand")) {
    return {
      error: `At this table a thing that changes hands, is put down or is lost is recorded from your narration when the turn ends: do not call ${toolName === "remove_item" ? "remove_item" : 'handle_item "hand"'}. Narrate it plainly, as it ends (who gives what to whom, what falls, what is eaten or thrown away). A thing new to the world is still grant_item; one used up by the rules is still use_item.`,
      retry: true,
    };
  }
  return null;
}

const ITEM_KINDS = new Set(["grant_item", "remove_item", "use_item", "hand_item", "drop_item", "pick_up_item", "reveal_item"]);

// What this turn already wrote about things, in words the reader reads.
function recordedThisTurn(campaignId: string, turnId: string): string[] {
  return listAuditForTurn(campaignId, turnId)
    .filter((entry) => ITEM_KINDS.has(entry.kind) && !entry.revertedBy)
    .map((entry) => {
      const holder = getSheetById(entry.characterId)?.name ?? "someone";
      const what = String(entry.delta.name ?? entry.delta.item ?? "");
      const side = typeof entry.delta.to === "string" ? ` to ${entry.delta.to}` : typeof entry.delta.from === "string" ? ` from ${entry.delta.from}` : "";
      return `${holder}: ${entry.kind.replace(/_item$/, "")} ${what}${side}`;
    });
}

// The turn already took this thing from this holder (used, removed, handed).
function alreadyGone(campaignId: string, turnId: string, sheet: CharacterSheet, thing: string, keyOf: (word: string) => string): boolean {
  const wanted = keyOf(thing);
  return listAuditForTurn(campaignId, turnId).some((entry) => {
    if (entry.characterId !== sheet.id || entry.revertedBy || !["remove_item", "use_item"].includes(entry.kind)) {
      return false;
    }
    const done = keyOf(String(entry.delta.name ?? entry.delta.item ?? ""));
    return Boolean(done && wanted) && (done.includes(wanted) || wanted.includes(done));
  });
}

export type StoryItems = { applied: string[]; refused: string[] };

// Read the finished turn and make the sheets hold what the story says.
export async function recordStoryItems(
  campaign: Campaign,
  turn: DmTurn,
  heroLines: readonly { name: string; text: string }[],
  narration: string,
): Promise<StoryItems | null> {
  if (!itemsReaderOn(campaign) || !narration.trim()) {
    return null;
  }
  const keyOf = (word: string) => withoutLeadingStopWords(textKey(word), campaign.gameSettings.tableLanguage);
  const heroes = listSheets(campaign.id);
  const cast = onStage(campaign).filter((npc) => !npc.companionSheetId);
  const people: ItemPerson[] = [
    // With how many, so a fish shared out is read piece by piece.
    ...heroes.map((sheet) => ({ name: sheet.name, hero: true, carries: sheet.equipment.map((item) => `${item.name}${(item.qty ?? 1) > 1 ? ` x${item.qty}` : ""}`) })),
    ...cast.map((npc) => ({ name: npc.name, hero: false, carries: npcThings(npc) })),
  ];
  const here = textKey(getCurrentLocation(campaign.id)?.name ?? "");
  const ground = listDroppedItems(campaign.id).filter((item) => !item.heldByEnemy && textKey(item.place) === here).map((item) => item.item.name);
  const stage = turn.conversation
    .filter((message) => message.role === "user" && typeof message.content === "string" && message.content.startsWith("[Table note] After the players, every character on stage"))
    .map((message) => String(message.content).split("\n").filter((line) => /^\d+\. /.test(line)).join("\n"))
    .join("\n");
  const prompt = renderItemsReaderPrompt({ people, ground, heroLines, narration, stage, recorded: recordedThisTurn(campaign.id, turn.id) });
  let moves: ItemMove[] = [];
  try {
    const result = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: ITEMS_READER_SYSTEM },
        { role: "user", content: prompt },
      ],
      { meta: { task: "items_reader" }, timeoutMs: resolveTextTimeoutMs(undefined, "NPC_MIND_TIMEOUT_MS", 120_000), mindChoice: egoChoice() },
    );
    if (result.error) {
      const error: unknown = result.error;
      const why = error instanceof Response ? `HTTP ${error.status} ${(await error.text().catch(() => "")).slice(0, 300)}` : String(error);
      console.warn(`[items-reader] turn ${turn.id}: the reader did not answer: ${why}`);
      return null;
    }
    const parsed = parseItemMoves(stripReasoningArtifacts(String(result.message?.content ?? "")));
    if (!parsed.ok) {
      console.warn(`[items-reader] turn ${turn.id}: unreadable answer (${parsed.error})`);
      return null;
    }
    moves = parsed.moves;
  } catch (caught) {
    console.warn(`[items-reader] turn ${turn.id}: ${caught instanceof Error ? caught.message : String(caught)}`);
    return null;
  }
  const out: StoryItems = { applied: [], refused: [] };
  for (const move of moves) {
    const said = `${move.thing}: ${move.from || "?"} → ${move.to || "gone"}`;
    const done = makeMove(campaign, turn, move, people, keyOf);
    (done.ok ? out.applied : out.refused).push(done.ok ? said : `${said} (${done.why})`);
  }
  if (out.applied.length || out.refused.length) {
    console.info(`[items-reader] turn ${turn.id}: moved ${out.applied.join("; ") || "nothing"}${out.refused.length ? `; refused ${out.refused.join("; ")}` : ""}`);
  }
  return out;
}

function makeMove(campaign: Campaign, turn: DmTurn, move: ItemMove, people: readonly ItemPerson[], keyOf: (word: string) => string): { ok: true } | { ok: false; why: string } {
  const plan = planItemMove(move, people, keyOf);
  if (plan.kind === "refused") {
    return { ok: false, why: plan.why };
  }
  const reason = "Told in the story; recorded at the turn's end.";
  const holderName = plan.kind === "pickup" ? plan.to : plan.from;
  const holder = sheetOf(campaign, holderName);
  if (!holder) {
    return { ok: false, why: `no sheet for ${holderName}` };
  }
  const taker = plan.kind === "hand" ? sheetOf(campaign, plan.to) : null;
  if (plan.kind === "hand" && !taker) {
    return { ok: false, why: `no sheet for ${plan.to}` };
  }
  // A loss is the whole thing gone: its words must name all of it, so a few
  // biscuits eaten never take the sack they came from.
  const line =
    plan.kind === "pickup"
      ? plan.thing
      : plan.kind === "lose"
        ? wholeThingNamed(holder.equipment.map((item) => item.name), plan.thing, keyOf)
        : thingNamed(holder.equipment.map((item) => item.name), plan.thing, keyOf);
  if (!line) {
    return { ok: false, why: `${holder.name} has no ${plan.thing}` };
  }
  const table = listSheets(campaign.id);
  const all = [...table, ...[holder, taker].filter((sheet): sheet is CharacterSheet => Boolean(sheet) && !table.some((entry) => entry.id === sheet!.id))];
  const byId = new Map(all.map((sheet) => [sheet.id, sheet]));
  let result: Record<string, unknown>;
  if (plan.kind === "lose") {
    if (alreadyGone(campaign.id, turn.id, holder, line, keyOf)) {
      return { ok: true };
    }
    result = (applyDmMutation(campaign, turn.id, "remove_item", JSON.stringify({ characterId: holder.id, item: line, qty: 1, reason }), all, byId) as { result: Record<string, unknown> }).result;
  } else {
    const action = plan.kind === "pickup" ? "pick_up" : plan.kind;
    result = handleItemCall(
      campaign,
      JSON.stringify({ characterId: holder.id, action, item: line, qty: 1, reason, ...(taker ? { toCharacterId: taker.id } : {}) }),
      all,
      byId,
      turn,
    ) as Record<string, unknown>;
  }
  return result && "error" in result && result.error ? { ok: false, why: String(result.error) } : { ok: true };
}
