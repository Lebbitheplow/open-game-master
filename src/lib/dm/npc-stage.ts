// The stage, run by the server (npc-stage-logic.ts; docs/specs/ogm-npc-ego.md):
// every first-tier mind in the scene takes its turn in order, perceiving what
// the table was told and what the minds before it did; a referee judges each
// action, the server rolls and records what changed. The narrator is handed
// the facts.
import type { Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { listRecentDmTurns } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listDroppedItems } from "@/lib/db/dropped-items";
import { currentScene } from "@/lib/dm/sky";
import { getCurrentLocation } from "@/lib/db/locations";
import { getNpcAway } from "@/lib/db/npc-minds";
import { getPerceptionCursor, lastSceneEventSeq, listPerceivedSince, recordSceneEvent, setPerceptionCursor } from "@/lib/db/scene-events";
import { listNpcs, setNpcState, type Npc } from "@/lib/db/npcs";
import { castSheetFor, npcThings } from "@/lib/db/cast-sheets";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollExpression } from "@/lib/dice";
import { currentTurnId } from "@/lib/dm/job-control";
import { requestDmMessage } from "@/lib/dm/model";
import { handleNpcSpeak, npcMindsOn, tierOfNpc } from "@/lib/dm/npc-mind";
import { recipientsOf } from "@/lib/dm/npc-mind-logic";
import { heroLineVolume, perceivedLine, readEventShape, type SceneEvent } from "@/lib/dm/scene-events-logic";
import { perceive, type Observer, type Perception } from "@/lib/dm/senses-logic";
import { ensureZones, moveTo, senseScene, whereEveryoneIs, zoneOf } from "@/lib/dm/scene-place";
import { CONTACT_VERBS } from "@/lib/dm/zones-logic";
import { bodyForReferee, weatherOnBodies } from "@/lib/dm/body";
import { describeDuration } from "@/lib/dm/calendar";
import {
  STAGE_REFEREE_SYSTEM,
  factLine,
  parseRuling,
  renderRefereePrompt,
  settleRuling,
  stageNote,
  stageOrder,
  stageFrame,
  type HeroLine,
  type StageBranch,
  type StageFact,
  type StagePerson,
  type StageRuling,
} from "@/lib/dm/npc-stage-logic";
import { needsWords, npcSilencedBy, npcStateWords } from "@/lib/dm/npc-state-logic";
import { clipText, textKey } from "@/lib/language/text-logic";
import { resolveTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

export function npcStageOn(campaign: Pick<Campaign, "gameSettings">): boolean {
  return npcMindsOn(campaign) && Boolean(campaign.gameSettings.npcStage);
}

// The first-tier minds standing in the party's scene, able to act.
export function onStage(campaign: Campaign): Npc[] {
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
export function sheetOf(campaign: Campaign, name: string): CharacterSheet | null {
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

// What a present first-tier character has on them, as the referee reads it.
function thingsOf(npc: Npc): string[] {
  const sheet = npc.companionSheetId ? getSheetById(npc.companionSheetId) : null;
  return sheet ? sheet.equipment.map((item) => item.name) : npcThings(npc);
}

// One turn of the stage. Null when nobody on stage is owed a turn (a fight
// owns the floor, or the narrator already asked them all).
// The place and its shape, the hour and the sky, for the referee: a raft
// with no rail, a dark night, a gale are part of what an action takes.
function placeHere(campaign: Campaign): string {
  const place = getCurrentLocation(campaign.id);
  if (!place?.name) {
    return "";
  }
  const scene = currentScene(campaign);
  return [
    `${place.name}${place.layoutDescription ? `: ${clipText(place.layoutDescription, 600)}` : ""}`,
    `Hour ${String(scene.hour).padStart(2, "0")}:00, ${scene.dayPart}${scene.isDark ? ", dark" : ""}${scene.summary ? `; ${scene.summary}` : ""}.`,
    whereEveryoneIs(campaign),
  ]
    .filter(Boolean)
    .join(" ");
}

// What lies loose here, by name and count, for the referee: a thing taken
// from the ground exists.
function groundHere(campaign: Campaign): string[] {
  const here = textKey(getCurrentLocation(campaign.id)?.name ?? "");
  return listDroppedItems(campaign.id)
    .filter((entry) => !entry.heldByEnemy && here && textKey(entry.place) === here)
    .map((entry) => `${entry.item.name}${(entry.item.qty ?? 1) > 1 ? ` x${entry.item.qty}` : ""}`);
}

// One event in the party's place, recorded with who of the minds here took
// it in and by which channel (senses-logic), each left a line of it.
export type WitnessedEvent = Pick<SceneEvent, "actor" | "verb" | "targets" | "object" | "zoneTo" | "volume" | "covert" | "speech" | "outcome"> & { success?: boolean; ownWords?: boolean };

export function witness(campaign: Campaign, input: WitnessedEvent): SceneEvent | null {
  if (!npcMindsOn(campaign)) {
    return null;
  }
  // Where it happened: a move takes the actor to its zone, and a hand laid on
  // someone in another part of the place takes the actor to them first.
  const from = zoneOf(campaign, input.actor);
  let to = input.zoneTo ? moveTo(campaign, input.actor, input.zoneTo) : "";
  const reached = input.targets[0] ? zoneOf(campaign, input.targets[0]) : "";
  if (!to && success(input) && CONTACT_VERBS.has(input.verb) && reached && reached !== from) {
    to = moveTo(campaign, input.actor, reached);
  }
  const observers: Observer[] = onStage(campaign).map((npc) => ({ id: npc.id, name: npc.name, condition: npc.state.condition, zone: zoneOf(campaign, npc.name) }));
  const event: Omit<SceneEvent, "seq"> = {
    ...input,
    zoneTo: to,
    turnId: currentTurnId() ?? "",
    instant: getClock(campaign.id).instant,
    place: getCurrentLocation(campaign.id)?.name ?? "",
    zoneFrom: from,
    stealth: null,
    success: success(input),
  };
  // A move is seen where it left and where it arrived.
  const perceived = mergePerceptions(perceive(event, observers, senseScene(campaign, to || from)), to && from && to !== from ? perceive(event, observers, senseScene(campaign, from)) : []);
  return recordSceneEvent(campaign.id, event, perceived, observers);
}

function success(input: WitnessedEvent): boolean {
  return input.success ?? true;
}

function mergePerceptions(a: readonly Perception[], b: readonly Perception[]): Perception[] {
  const out = new Map(a.map((entry) => [entry.observerId, [...entry.channels]]));
  for (const entry of b) {
    out.set(entry.observerId, [...new Set([...(out.get(entry.observerId) ?? []), ...entry.channels])]);
  }
  return [...out].map(([observerId, channels]) => ({ observerId, channels }));
}

export async function runStage(
  campaign: Campaign,
  calls: ReadonlyArray<{ name: string; args: Record<string, unknown>; result?: Record<string, unknown> | null }>,
  narration: string,
  heroLines: readonly HeroLine[] = [],
): Promise<{ note: string; heroFacts: number } | null> {
  if (!npcStageOn(campaign) || getActiveEncounter(campaign.id)) {
    return null;
  }
  const present = onStage(campaign);
  // The place's zones, made once from its description, and everyone here
  // placed in one (docs/specs/ogm-npc-perception.md §6).
  await ensureZones(campaign, [...listSheets(campaign.id).filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.name), ...present.map((npc) => npc.name)], narration);
  // The weather on every body here since it was last counted (§8).
  weatherOnBodies(campaign, present);
  const touched = new Set(
    calls
      .filter((call) => call.name === "npc_speak" || call.name === "npc_inform")
      .flatMap((call) => recipientsOf(String(call.args.name ?? ""), [], listNpcs(campaign.id)).ids),
  );
  const order = stageOrder(present.filter((npc) => !touched.has(npc.id)), listRecentDmTurns(campaign.id, 200).length);
  if (!order.length) {
    return null;
  }
  const heroSheets = () => listSheets(campaign.id).filter((sheet) => !sheet.isCompanion);
  const heroes = heroSheets().map((sheet) => sheet.name);
  const facts: StageFact[] = [];
  const silent: string[] = [];
  const waiting = new Set(order.map((npc) => npc.id));
  // Every mind reacts to the same moment at once (a local model serves them
  // side by side); only the referee goes in order, so each outcome stands on
  // the ones before it. What the others did reaches a mind next turn.
  // Each mind is handed what its own senses took in since its last turn (the
  // other minds' deeds among them), not the narrator's retelling
  // (docs/specs/ogm-npc-perception.md §12). The frame is not kept as a
  // memory: every event in it already left its own line.
  // The heroes' own lines are events too, taken in by each mind's senses: a
  // whisper to one is not every mind's to answer.
  for (const line of heroLines.filter((entry) => entry.name.trim() && entry.text.trim())) {
    witness(campaign, { actor: line.name, verb: "other", targets: [], object: "", zoneTo: "", volume: heroLineVolume(line.text), covert: false, speech: "", outcome: line.text, ownWords: true });
  }
  const frameNow = getClock(campaign.id).instant;
  const frameSeq = lastSceneEventSeq(campaign.id);
  const frames = order.map((actor) => {
    const cursor = getPerceptionCursor(actor.id);
    const perceived = listPerceivedSince(campaign.id, actor.id, cursor?.seq ?? 0)
      .map((entry) => perceivedLine(entry.event, actor.name, entry.channels))
      .filter(Boolean);
    const elapsed = cursor && frameNow > cursor.instant ? `${describeDuration(frameNow - cursor.instant)} passed` : "";
    setPerceptionCursor(campaign.id, actor.id, { seq: frameSeq, instant: frameNow });
    return stageFrame({ perceived, elapsed, atmosphere: narration }) || "Nothing new.";
  });
  const answers = await Promise.all(
    order.map(async (actor, index) => (await handleNpcSpeak(campaign, JSON.stringify({ name: actor.name, perceives: frames[index] }), { remember: false })) as Record<string, unknown>),
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
        .map((npc) => ({ name: npc.name, state: [npcStateWords({ ...npc.state, carries: [] }), needsWords(npc.state, now), bodyForReferee(campaign, npc)].filter(Boolean).join(", "), carries: thingsOf(npc) })),
    ];
    const ruling = intent ? await referee(campaign, renderRefereePrompt({ actor: actor.name, intent, speech, people, ground: groundHere(campaign), place: placeHere(campaign), scene: narration, facts: lines, heroLines })) : null;
    let fact: StageFact = { actor: actor.name, speech, outcome: intent, roll: "", hero: "" };
    let chosen: StageBranch | null = null;
    let succeeded = true;
    if (ruling) {
      const settled = settleRuling(ruling, ruling.uncertain ? rollExpression("1d20").total : 0);
      chosen = settled.branch;
      succeeded = settled.succeeded;
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
          ...(change.slept ? { sleptAt: now } : {}),
          ...(change.warmed ? { cold: Math.max(0, (target.state.cold ?? 0) - 2), wet: Math.max(0, (target.state.wet ?? 0) - 1) } : {}),
          ...(change.condition && target.state.condition !== "dead" ? { condition: change.condition } : {}),
        });
      }
    }
    facts.push(fact);
    // The event, perceived by everyone here whose senses reach it, each left
    // a memory of it as they took it in. Recorded only after every mind has
    // answered, so each reads it in its frame next turn: the first to act
    // used never to learn what the six after it did (2026-11-17).
    const shape = readEventShape(chosen?.event ?? {}, people.map((person) => person.name), speech);
    witness(campaign, { ...shape, actor: actor.name, success: succeeded, speech, outcome: fact.outcome });
  }
  return { note: stageNote(facts, silent), heroFacts: facts.filter((fact) => fact.hero).length };
}
