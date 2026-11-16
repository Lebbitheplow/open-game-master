// The stage, run by the server (npc-stage-logic.ts; docs/specs/ogm-npc-ego.md):
// every first-tier mind in the scene takes its turn in order, perceiving what
// the table was told and what the minds before it did; a referee judges each
// action, the server rolls and records what changed. The narrator is handed
// the facts.
import type { Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { listRecentDmTurns } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getCurrentLocation } from "@/lib/db/locations";
import { addNpcMemories, getNpcAway } from "@/lib/db/npc-minds";
import { listNpcs, setNpcState, type Npc } from "@/lib/db/npcs";
import { castSheetFor, npcThings } from "@/lib/db/cast-sheets";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { withCastSheets } from "@/lib/dm/cast-sheet-refs";
import { handleItemCall } from "@/lib/dm/gear-tool";
import { rollExpression } from "@/lib/dice";
import { currentTurnId } from "@/lib/dm/job-control";
import { requestDmMessage } from "@/lib/dm/model";
import { applyDmMutation } from "@/lib/dm/mutations";
import { handleNpcSpeak, npcMindsOn, tierOfNpc } from "@/lib/dm/npc-mind";
import { ON_STAGE_SOURCE, recipientsOf } from "@/lib/dm/npc-mind-logic";
import {
  STAGE_REFEREE_SYSTEM,
  factLine,
  parseRuling,
  planMove,
  renderRefereePrompt,
  settleRuling,
  stageNote,
  stageOrder,
  stageSenses,
  thingNamed,
  type HeroLine,
  type StageMove,
  type StageFact,
  type StagePerson,
  type StageRuling,
} from "@/lib/dm/npc-stage-logic";
import { needsWords, npcSilencedBy, npcStateWords } from "@/lib/dm/npc-state-logic";
import { withoutLeadingStopWords } from "@/lib/language/language";
import { textKey } from "@/lib/language/text-logic";
import { resolveTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

export function npcStageOn(campaign: Pick<Campaign, "gameSettings">): boolean {
  return npcMindsOn(campaign) && Boolean(campaign.gameSettings.npcStage);
}

// The first-tier minds standing in the party's scene, able to act.
function onStage(campaign: Campaign): Npc[] {
  const here = getCurrentLocation(campaign.id)?.name ?? "";
  return listNpcs(campaign.id).filter(
    (npc) =>
      tierOfNpc(npc) === "primary" &&
      !npc.archived &&
      !getNpcAway(npc.id) &&
      !npcSilencedBy(npc.state) &&
      (Boolean(npc.companionSheetId) || npc.state.withParty || (Boolean(here) && npc.location === here)),
  );
}

async function referee(campaign: Campaign, prompt: string): Promise<StageRuling | null> {
  try {
    const result = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: STAGE_REFEREE_SYSTEM },
        { role: "user", content: prompt },
      ],
      { meta: { task: "npc_stage_referee" }, timeoutMs: resolveTextTimeoutMs(undefined, "NPC_MIND_TIMEOUT_MS", 120_000) },
    );
    if (result.error) {
      return null;
    }
    const parsed = parseRuling(stripReasoningArtifacts(String(result.message?.content ?? "")));
    return parsed.ok ? parsed.ruling : null;
  } catch {
    return null;
  }
}

// The sheet a person on stage keeps their things on: a hero's or a
// companion's own, a first-tier character's cast sheet (made now if new).
function sheetOf(campaign: Campaign, name: string): CharacterSheet | null {
  const own = listSheets(campaign.id).find((sheet) => textKey(sheet.name) === textKey(name));
  if (own) {
    return own;
  }
  const npc = listNpcs(campaign.id).find((entry) => !entry.archived && [entry.name, ...entry.aliases].some((alias) => textKey(alias) === textKey(name)));
  if (!npc) {
    return null;
  }
  return npc.companionSheetId ? getSheetById(npc.companionSheetId) : castSheetFor(npc);
}

// One thing the referee moved, done by the server through the same item
// tools the master calls (handle_item hand, grant_item, remove_item): one
// ledger for every thing. The error when it could not be done; the giver
// keeps what the server refused to move.
function moveThing(
  campaign: Campaign,
  turnId: string,
  move: StageMove,
  actor: string,
  people: readonly StagePerson[],
  offered: readonly HeroLine[],
  keyOf: (thing: string) => string,
): { done: StageMove } | { error: string } {
  const plan = planMove(move, actor, people, offered, keyOf);
  if (plan.kind === "refused") {
    return { error: `${move.thing}: ${plan.why}` };
  }
  const reason = `${actor}, on the stage.`;
  let name: string;
  let args: Record<string, unknown>;
  if (plan.kind === "grant") {
    const to = sheetOf(campaign, plan.to);
    if (!to) {
      return { error: `${move.thing}: no sheet for ${plan.to}` };
    }
    name = "grant_item";
    args = { characterId: to.id, item: plan.thing, qty: 1, reason };
  } else {
    const from = sheetOf(campaign, plan.from);
    const line = from ? thingNamed(from.equipment.map((item) => item.name), plan.thing, keyOf) : null;
    if (!from || !line) {
      return { error: `${plan.from} has no ${move.thing}` };
    }
    if (plan.kind === "remove") {
      name = "remove_item";
      args = { characterId: from.id, item: line, qty: 1, reason };
    } else {
      const to = sheetOf(campaign, plan.to);
      if (!to) {
        return { error: `${move.thing}: no sheet for ${plan.to}` };
      }
      name = "handle_item";
      args = { characterId: from.id, action: "hand", item: line, qty: 1, toCharacterId: to.id, reason };
    }
  }
  const raw = JSON.stringify(args);
  const table = listSheets(campaign.id);
  const context = withCastSheets({ campaign, sheets: table, sheetsById: new Map(table.map((sheet) => [sheet.id, sheet])) }, name, raw);
  const result =
    name === "handle_item"
      ? handleItemCall(campaign, raw, context.sheets, context.sheetsById, null)
      : (applyDmMutation(campaign, turnId, name, raw, context.sheets, context.sheetsById) as { result: Record<string, unknown> }).result;
  if (result && typeof result === "object" && "error" in result && result.error) {
    console.warn(`[npc-stage] ${actor}: "${move.thing}" ${move.from || "found"} → ${move.to || "lost"} refused: ${String(result.error)}`);
    return { error: `${move.thing}: ${String(result.error)}` };
  }
  return { done: { thing: plan.kind === "grant" ? plan.thing : (args.item as string), from: plan.kind === "grant" ? "" : plan.from, to: plan.kind === "remove" ? "" : plan.to } };
}

// What a present first-tier character has on them, as the referee reads it.
function thingsOf(npc: Npc): string[] {
  const sheet = npc.companionSheetId ? getSheetById(npc.companionSheetId) : null;
  return sheet ? sheet.equipment.map((item) => item.name) : npcThings(npc);
}

// One turn of the stage. Null when nobody on stage is owed a turn (a fight
// owns the floor, or the narrator already asked them all).
export async function runStage(
  campaign: Campaign,
  calls: ReadonlyArray<{ name: string; args: Record<string, unknown> }>,
  narration: string,
  heroLines: readonly HeroLine[] = [],
): Promise<{ note: string; heroFacts: number } | null> {
  if (!npcStageOn(campaign) || getActiveEncounter(campaign.id)) {
    return null;
  }
  const present = onStage(campaign);
  const touched = new Set(
    calls
      .filter((call) => call.name === "npc_speak" || call.name === "npc_inform")
      .flatMap((call) => recipientsOf(String(call.args.name ?? ""), [], listNpcs(campaign.id)).ids),
  );
  const order = stageOrder(present.filter((npc) => !touched.has(npc.id)), listRecentDmTurns(campaign.id, 200).length);
  if (!order.length) {
    return null;
  }
  const turnId = currentTurnId() ?? "";
  const heroSheets = () => listSheets(campaign.id).filter((sheet) => !sheet.isCompanion);
  const heroes = heroSheets().map((sheet) => sheet.name);
  const facts: StageFact[] = [];
  const silent: string[] = [];
  const handed: StageMove[] = [];
  const thingKey = (thing: string) => withoutLeadingStopWords(textKey(thing), campaign.gameSettings.tableLanguage);
  const waiting = new Set(order.map((npc) => npc.id));
  // Every mind reacts to the same moment at once (a local model serves them
  // side by side); only the referee goes in order, so each outcome stands on
  // the ones before it. What the others did reaches a mind next turn.
  const answers = await Promise.all(
    order.map(async (actor) => (await handleNpcSpeak(campaign, JSON.stringify({ name: actor.name, perceives: stageSenses(narration, [], heroLines) || "Nothing new." }))) as Record<string, unknown>),
  );
  for (const [index, actor] of order.entries()) {
    waiting.delete(actor.id);
    const lines = facts.map(factLine);
    const said = answers[index];
    if (said.ok !== true) {
      silent.push(actor.name);
      continue;
    }
    const speech = String(said.says ?? "");
    const intent = String(said.intends ?? "");
    const now = getClock(campaign.id).instant;
    const cast = listNpcs(campaign.id);
    const people: StagePerson[] = [
      ...heroSheets().map((sheet) => ({ name: sheet.name, state: "", carries: sheet.equipment.map((item) => item.name), hero: true })),
      ...cast
        .filter((npc) => present.some((entry) => entry.id === npc.id))
        .map((npc) => ({ name: npc.name, state: [npcStateWords({ ...npc.state, carries: [] }), needsWords(npc.state, now)].filter(Boolean).join(", "), carries: thingsOf(npc) })),
    ];
    const ruling = intent ? await referee(campaign, renderRefereePrompt({ actor: actor.name, intent, speech, people, scene: narration, facts: lines, heroLines })) : null;
    let fact: StageFact = { actor: actor.name, speech, outcome: intent, roll: "", hero: "" };
    if (ruling) {
      const settled = settleRuling(ruling, ruling.uncertain ? rollExpression("1d20").total : 0);
      fact = { actor: actor.name, speech, outcome: settled.branch.outcome, roll: settled.roll, hero: heroes.find((name) => textKey(name) === textKey(ruling.hero)) ?? "" };
      for (const change of settled.branch.changes) {
        const target = cast.find((npc) => textKey(npc.name) === textKey(change.name) && present.some((entry) => entry.id === npc.id));
        if (!target) {
          continue;
        }
        setNpcState(target.id, {
          ...target.state,
          ...(change.drank ? { drankAt: now } : {}),
          ...(change.ate ? { ateAt: now } : {}),
          ...(change.condition && target.state.condition !== "dead" ? { condition: change.condition } : {}),
        });
      }
      // Every thing that moved, moved by the server on the sheets: a move it
      // refuses did not happen, and the narrator is told so.
      const undone: string[] = [];
      for (const move of settled.branch.moves) {
        const moved = moveThing(campaign, turnId, move, actor.name, people, heroLines, thingKey);
        if ("done" in moved) {
          handed.push(moved.done);
        } else {
          undone.push(moved.error);
        }
      }
      if (undone.length) {
        fact = { ...fact, undone };
      }
    }
    facts.push(fact);
    // Everyone who already had their turn learns how it ended; those still
    // to act read it in what they perceive.
    const told = present.filter((npc) => !waiting.has(npc.id)).map((npc) => npc.id);
    addNpcMemories(campaign.id, told, { kind: "knowledge", sourceKind: "perceived", sourceName: ON_STAGE_SOURCE, content: factLine(fact), learnedAt: now }, turnId);
  }
  return { note: stageNote(facts, silent, handed), heroFacts: facts.filter((fact) => fact.hero).length };
}
