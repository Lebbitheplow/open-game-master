import { z } from "zod";
import { npcThings } from "@/lib/db/cast-sheets";
import { dominantDrive, needsWords, npcSeenStateWords, npcSilencedBy } from "@/lib/dm/npc-state-logic";
import type { Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { describeInstant } from "@/lib/dm/calendar";
import { getNpcById, listNpcs, patchNpcAgency, setNpcPlace, type Npc } from "@/lib/db/npcs";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { listSheets, getSheetById } from "@/lib/db/sheets";
import { listRelationships } from "@/lib/db/relationships";
import { listDroppedItems } from "@/lib/db/dropped-items";
import { recordSceneEvent, speechHeardInTurn } from "@/lib/db/scene-events";
import { perceive, type Observer } from "@/lib/dm/senses-logic";
import { senseScene, whereEveryoneIs, zoneOf } from "@/lib/dm/scene-place";
import { bodyFrame } from "@/lib/dm/body";
import { listBonds } from "@/lib/db/npc-bonds";
import { bondWords } from "@/lib/dm/bonds-logic";
import { currentScene } from "@/lib/dm/sky";
import { getCurrentLocation, listLocations } from "@/lib/db/locations";
import { recordExtractedFacts } from "@/lib/db/facts";
import {
  addNpcMemories,
  getNpcInspiration,
  lastOffscreenInstants,
  listNpcMemories,
  getNpcAway,
  getNpcMindModel,
  getNpcTier,
  listNpcProposals,
  npcsActedInTurn,
  npcsOnStageRecently,
  recordNpcProposal,
  setNpcAway,
  setNpcInspiration,
  setNpcTier,
  npcVoicedLines,
} from "@/lib/db/npc-minds";
import { requestDmMessage, requestUtilityMessage } from "@/lib/dm/model";
import { sideOf } from "@/lib/dm/combatant";
import { seatForMind } from "@/lib/db/mind-seats";
import { askSeatHolder } from "@/lib/dm/mind-seat-relay";
import { resolveTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { withLanguage } from "@/lib/dm/table-language-logic";
import { currentTurnId } from "@/lib/dm/job-control";
import { resolveMonster } from "@/lib/bestiary";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { advanceSessionGoal, agencyFragment } from "@/lib/dm/npc-logic";
import { rollExpression } from "@/lib/dice";
import { badArguments, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { clipText, textKey } from "@/lib/language/text-logic";
import { describeSheet } from "@/lib/dm/prompt";
import { aiPlaysSheet } from "@/lib/dm/companion-command";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { listRecentDmTurns } from "@/lib/db/dm-turns";
import { getBattleMapForEncounter, listTokens } from "@/lib/db/battle-maps";
import { chebyshev } from "@/lib/battlemap/types";
import { acBreakdownFor } from "@/lib/srd";
import { mindCallChoice } from "@/lib/dm/npc-mind-model";
import { weaponOf } from "@/lib/dm/attack-logic";
import {
  MIND_SYSTEM,
  attemptOutcome,
  awayRosterNote,
  backgroundOpen,
  catchUpSteps,
  knowsName,
  memoriesFor,
  mindsOwedTurn,
  mentalScoresOf,
  offscreenCandidates,
  parseProposal,
  parseReading,
  MIND_READER_SYSTEM,
  renderReaderPrompt,
  driveWords,
  presentPeople,
  knowsOfThing,
  repeatsDeed,
  type MindGround,
  quotedLines,
  echoesHeard,
  recipientsOf,
  renderMindPrompt,
  unlearnedNames,
  overheard,
  rosterNote,
  tierOf,
  TIME_SKIP_TOOLS,
  turnActorOf,
  healthWord,
  renderFightView,
  type FightHands,
  type FightSeen,
  type NpcAway,
  type NpcTier,
  type MindPerson,
  type NpcMemory,
  type NpcProposal,
  firstTierLimit,
  MAX_FIRST_TIER_NPCS,
  ON_STAGE_SOURCE,
  wornWords,
} from "@/lib/dm/npc-mind-logic";

// The NPC minds (docs/specs/ogm-npc-isolation-design.md): each named NPC and
// companion answers from its own register, through a model call that never
// sees the GM's prompt, the world's facts or another mind. The narrator
// asks (npc_speak), voices the answer, and the engine still decides what
// happens. On for the campaigns created with them (gameSettings.npcMinds).
//
// A mind that fails (a timeout, a reply that is not an answer) is reported
// and leaves nothing behind: no words are written for it and nothing it
// "would have" said is remembered. What it perceived before asking stays,
// since that happened.

export function npcMindsOn(campaign: Pick<Campaign, "gameSettings">): boolean {
  return Boolean(campaign.gameSettings.npcMinds);
}

// First tier: a party companion, or an NPC the adventure's maker named so.
export function tierOfNpc(npc: Npc): NpcTier {
  const sheet = npc.companionSheetId ? getSheetById(npc.companionSheetId) : null;
  return tierOf({ tier: getNpcTier(npc.id), companionKind: sheet?.companionKind ?? null });
}

// The first-tier NPCs whose own minds pursue their goals off screen: the
// generic goal dice skip them (src/lib/dm/world-tick.ts).
export function offscreenMindIds(campaign: Campaign): Set<string> {
  if (!npcMindsOn(campaign)) {
    return new Set();
  }
  return new Set(listNpcs(campaign.id).filter((npc) => !npc.archived && !npc.companionSheetId && tierOfNpc(npc) === "primary").map((npc) => npc.id));
}

// The first-tier minds owed a turn in DM turn `turnId` and not yet given one:
// on stage because they acted in the previous turn, and named by no
// npc_speak or npc_inform among `calls` (npc-mind-logic.ts mindsOwedTurn).
export function mindsAwaitingTurn(
  campaign: Campaign,
  turnId: string,
  calls: ReadonlyArray<{ name: string; args: Record<string, unknown> }>,
): Npc[] {
  if (!npcMindsOn(campaign) || !turnId) {
    return [];
  }
  const earlier = listRecentDmTurns(campaign.id, 6)
    .filter((turn) => turn.id !== turnId && !turn.revertedAt)
    .map((turn) => turn.id)
    .reverse();
  const acted = npcsActedInTurn(campaign.id, earlier[0] ?? "");
  // A rest, a wait or a journey this turn: whoever was on stage in the last
  // few turns lives that stretch too, not only who acted in the last one.
  const timeSkipped = calls.some((call) => TIME_SKIP_TOOLS.has(call.name));
  const recent = timeSkipped ? npcsOnStageRecently(campaign.id, earlier.slice(0, 4)) : new Set<string>();
  if (!acted.size && !recent.size) {
    return [];
  }
  const cast = listNpcs(campaign.id);
  const touched = new Set(
    calls
      .filter((call) => call.name === "npc_speak" || call.name === "npc_inform")
      .flatMap((call) => recipientsOf(String(call.args.name ?? ""), [], cast).ids),
  );
  const inFight = Boolean(getActiveEncounter(campaign.id));
  const owed = mindsOwedTurn(
    cast.map((npc) => ({
      id: npc.id,
      name: npc.name,
      tier: tierOfNpc(npc),
      archived: Boolean(npc.archived),
      away: Boolean(getNpcAway(npc.id)),
      companionInFight: inFight && Boolean(npc.companionSheetId),
      actedLastTurn: acted.has(npc.id),
      onStageRecently: recent.has(npc.id),
      silenced: Boolean(npcSilencedBy(npc.state)),
    })),
    touched,
    timeSkipped,
  );
  return owed.flatMap((entry) => cast.filter((npc) => npc.id === entry.id));
}

// What the narrator's roster says of each tracked NPC, by name.
export function mindRosterNotes(campaign: Campaign): Map<string, string> {
  const heroes = listSheets(campaign.id).filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.name);
  const now = nowInstant(campaign.id);
  const notes = new Map<string, string>();
  const npcs = listNpcs(campaign.id);
  const apart = npcs.flatMap((npc) => {
    const away = getNpcAway(npc.id);
    return away ? [{ name: npc.name, away }] : [];
  });
  for (const npc of npcs) {
    const memories = memoriesFor(npc.id, listNpcMemories(campaign.id, npc.id), now);
    const lines = [rosterNote(tierOfNpc(npc), memories, heroes)];
    const own = apart.find((entry) => entry.name === npc.name);
    if (own) {
      lines.push(awayRosterNote(own.away));
    }
    // Someone from where a companion was left: the story touching them is
    // the story touching the companion.
    for (const entry of apart) {
      if (entry.name !== npc.name && npc.location && textKey(npc.location) === textKey(entry.away.place)) {
        lines.push(`${entry.name} was left at ${entry.away.place}: before voicing ${npc.name} about it, call npc_speak for ${entry.name} with away: true`);
      }
    }
    notes.set(npc.name, lines.join("; "));
  }
  return notes;
}

// The companions who stay behind when the party splits (src/lib/dm/
// party-split.ts): each mind is apart from now, where the party left it.
export function markLeftBehind(campaign: Campaign, staying: readonly CharacterSheet[], place: string): string[] {
  if (!npcMindsOn(campaign) || !place) {
    return [];
  }
  const now = nowInstant(campaign.id);
  const npcs = listNpcs(campaign.id);
  const marked: string[] = [];
  for (const sheet of staying) {
    const npc = npcs.find((entry) => entry.companionSheetId === sheet.id);
    if (npc && tierOfNpc(npc) === "primary") {
      setNpcAway(npc.id, { place, since: now });
      marked.push(npc.name);
    }
  }
  return marked;
}

// The party arriving where companions were left: the narrator is told to
// bring them back through their own minds, which catch up first.
export function awayArrivalNote(campaign: Campaign, place: string): string {
  if (!npcMindsOn(campaign) || !place) {
    return "";
  }
  const here = listNpcs(campaign.id).filter((npc) => textKey(getNpcAway(npc.id)?.place ?? "") === textKey(place));
  if (!here.length) {
    return "";
  }
  return `${here.map((npc) => npc.name).join(", ")} stayed behind here. Before narrating them, call npc_speak for each without away: they catch up on what they did meanwhile and rejoin the party.`;
}

const MIND_TIMEOUT_MS = () => resolveTextTimeoutMs(undefined, "NPC_MIND_TIMEOUT_MS", 120_000);

// The Ego's own model and effort on the table's agent program: sorting a
// reply and mending its spelling needs no story model. Unset, it runs as the
// table's story model.
export function egoChoice(): { model: string; effort: string } | null {
  const model = (process.env.OGM_EGO_MODEL ?? "").trim();
  const effort = (process.env.OGM_EGO_EFFORT ?? "").trim();
  return model || effort ? { model, effort } : null;
}

function nowInstant(campaignId: string): number {
  return getClock(campaignId).instant;
}

// The heroes at the table, as a stranger sees them.
function heroesOf(campaignId: string): Array<MindPerson & { companion: boolean }> {
  return listSheets(campaignId).map((sheet) => ({
    name: sheet.name,
    description: [sheet.race, sheet.class].filter(Boolean).join(" ") || "an adventurer",
    companion: Boolean(sheet.isCompanion),
  }));
}

// What a mind is before play touches it: an author's tie to the party
// (known_before) and, for a companion, the company it travels with. Written
// once, the first time the mind is asked, and never again: a past laid
// later would be invented to suit the story.
function seedBackground(campaign: Campaign, npc: Npc, memories: NpcMemory[]): NpcMemory[] {
  if (memories.length || listNpcProposals(campaign.id, npc.id).length) {
    return memories;
  }
  const heroes = heroesOf(campaign.id).filter((hero) => textKey(hero.name) !== textKey(npc.name));
  const lines: string[] = [];
  if (npc.knownBefore) {
    lines.push(`You already know these people: ${heroes.map((hero) => hero.name).join(", ")}. How: ${npc.knownBefore.how}`);
  }
  if (npc.companionSheetId && heroes.length) {
    lines.push(`You travel with this company: ${heroes.map((hero) => `${hero.name} (${hero.description})`).join(", ")}.`);
  }
  for (const line of lines) {
    addNpcMemories(campaign.id, [npc.id], { kind: "knowledge", sourceKind: "background", sourceName: "", content: line, learnedAt: 0 });
  }
  return lines.length ? listNpcMemories(campaign.id, npc.id) : memories;
}

function scoresFor(campaign: Campaign, npc: Npc) {
  const sheet = npc.companionSheetId ? getSheetById(npc.companionSheetId) : null;
  if (sheet) {
    return mentalScoresOf(sheet.abilities);
  }
  if (npc.statBlock) {
    try {
      const monster = resolveMonster(npc.statBlock, campaign.gameSettings, { userIds: spellAuthorsFor(campaign) });
      return mentalScoresOf(monster?.stats);
    } catch {
      return {};
    }
  }
  return {};
}

// Who they are, as the narrator's own records say: no facts about the
// world, only the person.
function identityOf(campaign: Campaign, npc: Npc): string[] {
  const sheet = npc.companionSheetId ? getSheetById(npc.companionSheetId) : null;
  return [
    [npc.race, npc.role].filter(Boolean).length ? `You are ${[npc.race, npc.role].filter(Boolean).join(", ")}.` : "",
    sheet ? `You are a ${sheet.race} ${sheet.class}. ${clipText(sheet.personality ?? "", 300)}` : "",
    npc.trait ? `What people notice about you: ${clipText(npc.trait, 200)}` : "",
    agencyFragment(npc.agency) ? `Your temperament and aims: ${agencyFragment(npc.agency)}` : "",
    npc.agency.goals.scene ? `What you want right now: ${npc.agency.goals.scene}` : "",
    npc.location ? `You are usually found at ${npc.location}.` : "",
    // Its own things, which only the sheet held: two days on the raft the
    // minds forgot who had the key and the bread (2026-11-16).
    npcThings(npc).length ? `What you have on you now (yours, and nobody else's): ${npcThings(npc).join("; ")}.` : "You carry nothing that matters beyond your clothes.",
    whereYouStand(campaign, npc),
    lyingHere(campaign, npc),
    needsWords(npc.state, nowInstant(campaign.id)) ? `Your body right now: ${needsWords(npc.state, nowInstant(campaign.id))}. You feel it in everything you do, and it grows until you drink or eat.` : "",
    bodyFrame(campaign, npc, listNpcs(campaign.id).filter((other) => (other.id === npc.id || other.state.withParty) && !other.archived)),
    (dominantDrive(npc.state, nowInstant(campaign.id))?.urgency ?? 0) >= 60 ? "This need cannot wait any longer: this turn you act to satisfy it, by whatever means are yours (ask, bargain, take, threaten, strike). A gesture or a fine phrase is not enough." : "",
    `Your attitude toward the heroes in general: ${npc.attitude}.`,
    // A companion knows all of itself, as a player reads their own sheet.
    sheet
      ? `Your character sheet, as the rules hold it now (only you and the rules know these numbers):\n${describeSheet(sheet, "you", false, { encumbrance: campaign.gameSettings.variantRules?.encumbrance, compact: true })}`
      : "",
  ];
}

// The party's place, when this character stands in it.
function placeOf(campaign: Campaign, npc: Npc) {
  const place = getCurrentLocation(campaign.id);
  if (!place?.name || (npc.location && textKey(npc.location) !== textKey(place.name) && !npc.state.withParty)) {
    return null;
  }
  return place;
}

// Where it stands and what it sees around it: the place, its shape, the hour
// and the sky. On the observer Zattera the minds were told only the turn's
// narration, so seven castaways spoke of "the sea" while knowing neither the
// raft's shape, nor the hour, nor the storm on them (2026-11-17).
function whereYouStand(campaign: Campaign, npc: Npc): string {
  const place = placeOf(campaign, npc);
  if (!place) {
    return "";
  }
  const scene = currentScene(campaign);
  const hour = `${String(scene.hour).padStart(2, "0")}:00, ${scene.dayPart}${scene.isDark ? ", dark" : ""}`;
  return [
    `Where you are now: ${place.name}.`,
    place.layoutDescription ? `What it looks like around you: ${clipText(place.layoutDescription, 600)}` : "",
    `The hour: ${hour}.${scene.summary ? ` The sky: ${scene.summary}.` : ""}`,
    whereEveryoneIs(campaign, npc.name),
  ]
    .filter(Boolean)
    .join(" ");
}

// What lies loose where this character stands, free to whoever takes it: on
// the observer Zattera the biscuits and the water sat on the deck for hours
// while a starving Kaku begged a catatonic hero for food (2026-11-17).
function lyingHere(campaign: Campaign, npc: Npc): string {
  const here = placeOf(campaign, npc)?.name ?? "";
  if (!here) {
    return "";
  }
  const things = listDroppedItems(campaign.id)
    .filter((entry) => !entry.heldByEnemy && textKey(entry.place) === textKey(here))
    .map((entry) => `${entry.item.name}${(entry.item.qty ?? 1) > 1 ? ` x${entry.item.qty}` : ""}`);
  return things.length ? `Lying here where you stand, belonging to nobody, for anyone to take: ${things.join("; ")}.` : "";
}

// What it feels toward each person whose deeds it took in (docs/specs/
// ogm-npc-perception.md §10), strongest first, with why.
function feltBonds(campaign: Campaign, npc: Npc): string[] {
  return listBonds(campaign.id, npc.id)
    .sort((a, b) => Math.abs(b.trust) + Math.abs(b.affection) + b.fear - (Math.abs(a.trust) + Math.abs(a.affection) + a.fear))
    .map(bondWords)
    .filter(Boolean)
    .slice(0, 8);
}

// The relationship meter with each hero, and what it remembers of them:
// how a betrayal it lived changes it, traced from the table's own records.
function bondsOf(campaign: Campaign, npc: Npc, memories: NpcMemory[]): string[] {
  return listRelationships(campaign.id)
    .filter((relationship) => textKey(relationship.subjectName) === textKey(npc.name) && relationship.status !== "ended")
    .filter((relationship) => memories.some((memory) => memory.sourceKind !== "self" && textKey(memory.content).includes(textKey(relationship.characterName))))
    .map((relationship) => {
      const recent = relationship.memories.slice(-2).map((memory) => memory.text).join("; ");
      return `${relationship.characterName}: standing ${relationship.approval} (from -100 hatred to 100 devotion)${recent ? `; you remember: ${clipText(recent, 200)}` : ""}`;
    });
}

// The words this mind has worn out in its own lines, named so it says
// something new (wornWords).
function wornLine(memories: readonly NpcMemory[]): string {
  const said = memories.filter((memory) => memory.sourceKind === "self" && (memory.kind === "said" || memory.kind === "lie")).map((memory) => memory.content);
  const worn = wornWords(said, textKey);
  return worn.length ? `Words you have already used too often: ${worn.join(", ")}. Do not use them again now; talk about what is in front of you, or what you want.` : "";
}

type AskOutcome =
  | { ok: true; proposal: NpcProposal; memories: NpcMemory[]; latencyMs: number; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; latencyMs: number };

async function askMind(
  campaign: Campaign,
  npc: Npc,
  perceives: string,
  present: MindPerson[],
  offscreen: boolean,
): Promise<AskOutcome> {
  const memories = memoriesFor(npc.id, listNpcMemories(campaign.id, npc.id), nowInstant(campaign.id));
  const prompt = renderMindPrompt({
    name: npc.name,
    identity: [...identityOf(campaign, npc), wornLine(memories)],
    inspiration: getNpcInspiration(npc.id),
    scores: scoresFor(campaign, npc),
    memories,
    present,
    bonds: [...bondsOf(campaign, npc, memories), ...feltBonds(campaign, npc)],
    perceives,
    offscreen,
  });
  const instructions = withLanguage(MIND_SYSTEM, campaign.gameSettings.tableLanguage);
  const started = Date.now();
  // Someone playing this mind from a mind seat answers the same isolated
  // question, under the same checks; silence or a reply that says nothing
  // falls to the server's mind, for this answer only. Lives off screen stay
  // the server's: they advance between turns, where no one waits.
  const seat = offscreen ? null : seatForMind(campaign.id, npc.id);
  if (seat) {
    const answer = await askSeatHolder({ userId: seat.userId, campaignId: campaign.id, seatId: seat.id, character: npc.name, instructions, prompt });
    const parsed = answer ? parseProposal(JSON.stringify(answer)) : null;
    if (parsed?.ok) {
      return { ok: true, proposal: parsed.proposal, memories, latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0 };
    }
  }
  let result;
  try {
    result = await requestUtilityMessage(
      campaign.settings,
      [
        { role: "system", content: instructions },
        { role: "user", content: prompt },
      ],
      { meta: { task: offscreen ? "npc_mind_offscreen" : "npc_mind" }, timeoutMs: MIND_TIMEOUT_MS(), mindChoice: mindCallChoice(campaign.settings, getNpcMindModel(npc.id)) },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "the model call failed", latencyMs: Date.now() - started };
  }
  if (result.error) {
    return { ok: false, error: `the model did not answer (${result.error.status})`, latencyMs: Date.now() - started };
  }
  const reply = stripReasoningArtifacts(String(result.message?.content ?? "")).trim();
  if (!reply) {
    return { ok: false, error: "the reply was empty", latencyMs: Date.now() - started };
  }
  const read = await readReply(campaign, npc.name, reply, offscreen ? undefined : groundOf(campaign, npc, memories, perceives, present));
  const latencyMs = Date.now() - started;
  if (!read.ok) {
    return { ok: false, error: read.error, latencyMs };
  }
  // Words that only say again what it heard, or what it already said
  // itself, are not new: the action stays.
  const heard = [
    ...quotedLines(perceives),
    ...memories.filter((memory) => memory.sourceKind !== "self").flatMap((memory) => quotedLines(memory.content)),
    ...memories.filter((memory) => memory.kind === "said" || memory.kind === "lie").map((memory) => memory.content),
  ];
  const proposal = echoesHeard(read.proposal.speech, heard) ? { ...read.proposal, speech: "", lie: false } : read.proposal;
  return {
    ok: true,
    proposal,
    memories,
    latencyMs,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };
}

// The character's model plays in free text; the narrator's model reads the
// reply into speech, action, thought and lie (MIND_READER_SYSTEM). A reply
// already in the engine's JSON (a model that still writes it) stands as it is.
// What the Ego stands on (MindGround): the character's nature, its drive,
// its things, others' things as far as it has seen or heard of them, who is
// here, and its last deeds.
function groundOf(campaign: Campaign, npc: Npc, memories: NpcMemory[], perceives: string, present: MindPerson[]): MindGround {
  const lived = `${perceives}\n${memories.map((memory) => memory.content).join("\n")}`;
  const here = new Set(present.map((person) => textKey(person.name)));
  // Those it was told are here, and anyone else standing in the same place.
  const place = getCurrentLocation(campaign.id)?.name ?? "";
  const others = listNpcs(campaign.id)
    .filter((entry) => entry.id !== npc.id && !entry.archived && (here.has(textKey(entry.name)) || (place && entry.location === place && npc.location === place && !getNpcAway(entry.id))))
    .flatMap((entry) => npcThings(entry).filter((thing) => knowsOfThing(thing, lived)).map((thing) => `${entry.name}: ${thing}`));
  return {
    nature: [npc.role, npc.trait, agencyFragment(npc.agency)].filter(Boolean).map((line) => clipText(line, 300)),
    drive: driveWords(dominantDrive(npc.state, nowInstant(campaign.id)), npc.agency.goals.scene ?? ""),
    own: npcThings(npc),
    others,
    people: presentPeople(present, memories),
    recent: memories.filter((memory) => memory.kind === "did" && memory.sourceKind === "self").slice(-4).map((memory) => memory.content),
  };
}

// One more asking when the Ego only did a recent deed again.
const REPEAT_NOTE = (intent: string) => `\n\nREFUSED: "${intent}" only repeats a recent deed. Choose a different, concrete step toward the drive.`;

async function readReply(campaign: Campaign, name: string, reply: string, ground?: MindGround): Promise<{ ok: true; proposal: NpcProposal } | { ok: false; error: string }> {
  const own = parseProposal(reply);
  if (own.ok) {
    return own;
  }
  let error = "the reader did not answer";
  let refused = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await requestDmMessage(
        campaign.settings,
        [
          { role: "system", content: MIND_READER_SYSTEM },
          { role: "user", content: `${renderReaderPrompt(name, reply, ground)}${refused}` },
        ],
        { meta: { task: "npc_mind_reader" }, timeoutMs: MIND_TIMEOUT_MS(), mindChoice: egoChoice() },
      );
      if (result.error) {
        break;
      }
      const reading = parseReading(stripReasoningArtifacts(String(result.message?.content ?? "")));
      if (!reading.ok) {
        error = reading.error;
        break;
      }
      if (attempt === 0 && ground && repeatsDeed(reading.proposal.intent, ground.recent)) {
        refused = REPEAT_NOTE(reading.proposal.intent);
        continue;
      }
      return reading;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : error;
      break;
    }
  }
  return { ok: false, error };
}

// Every name the world holds that a mind could use without having learned
// it: people, heroes, places.
function worldNames(campaignId: string): string[] {
  return [
    ...listNpcs(campaignId).map((npc) => npc.name),
    ...listSheets(campaignId).map((sheet) => sheet.name),
    ...listLocations(campaignId).map((location) => location.name),
  ];
}

// The companion whose own fight turn its mind chooses: minds on, the
// initiative resting on it, nobody at the table commanding it, standing,
// and with the party. A commanded companion's turn is its commander's.
function mindsFightTurn(campaign: Campaign, sheetId: string | null | undefined): { sheet: CharacterSheet; npc: Npc } | null {
  if (!npcMindsOn(campaign) || !sheetId || !ownTurnOf(getActiveEncounter(campaign.id), sheetId)) {
    return null;
  }
  const sheet = getSheetById(sheetId);
  if (!sheet?.isCompanion || sheet.currentHp <= 0 || !aiPlaysSheet(campaign, sheet)) {
    return null;
  }
  const npc = listNpcs(campaign.id).find((entry) => entry.companionSheetId === sheet.id && !entry.archived);
  return npc && tierOfNpc(npc) === "primary" && !getNpcAway(npc.id) ? { sheet, npc } : null;
}

// A first-tier NPC on the party's side of the board (src/lib/dm/party-npcs-fight.ts):
// whether and whom it strikes is its mind's to choose, as a companion's is.
function mindsAllyRow(campaign: Campaign, enemyId: string | null): { npc: Npc } | null {
  const encounter = npcMindsOn(campaign) && enemyId ? getActiveEncounter(campaign.id) : null;
  const row = encounter ? listEnemies(encounter.id).find((entry) => entry.id === enemyId) : undefined;
  if (!encounter || !row?.npcId || row.status !== "alive" || sideOf(encounter, "enemy", row.id, row) !== "party") {
    return null;
  }
  const npc = getNpcById(row.npcId);
  return npc && !npc.archived && tierOfNpc(npc) === "primary" && !getNpcAway(npc.id) ? { npc } : null;
}

// Whether the companion whose fight turn it is still waits on its own mind:
// its mind chooses this turn (mindsFightTurn) and gave no choice in the DM
// turn `turnId`. The fight's backstop then wakes the narrator to ask it
// rather than play the companion's basic turn (encounter-tools.ts).
export function mindTurnUnplayed(campaign: Campaign, sheetId: string, turnId: string): boolean {
  const turn = mindsFightTurn(campaign, sheetId);
  if (!turn) {
    return false;
  }
  return !listNpcProposals(campaign.id, turn.npc.id).some((proposal) => proposal.status === "committed" && proposal.turnId === turnId);
}

// The fight as the companion sees it from its square: foes by how hurt they
// look and where, never their hit points or stat blocks; hidden ones not at all.
function fightView(campaign: Campaign, sheet: CharacterSheet): string {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return "";
  }
  const map = getBattleMapForEncounter(encounter.id);
  const tokens = map ? listTokens(map.id) : [];
  const tokenOf = (ref: string) => tokens.find((token) => token.refId === ref);
  const own = tokenOf(sheet.id);
  const feet = (ref: string) => {
    const token = tokenOf(ref);
    return own && token ? chebyshev(own.x, own.y, token.x, token.y) * 5 : null;
  };
  const foes: FightSeen[] = listEnemies(encounter.id)
    .filter((enemy) => enemy.status === "alive" && !tokenOf(enemy.id)?.hidden)
    .map((enemy) => ({ name: enemy.displayName, health: healthWord(enemy.currentHp, enemy.maxHp), conditions: enemy.conditions, feet: feet(enemy.id) }));
  const allies: FightSeen[] = encounter.order.flatMap((entry) => {
    const ally = entry.kind === "pc" && entry.characterId !== sheet.id ? getSheetById(entry.characterId) : null;
    return ally ? [{ name: ally.name, health: healthWord(ally.currentHp, ally.maxHp), conditions: ally.conditions, feet: feet(ally.id) }] : [];
  });
  return renderFightView({
    round: encounter.round,
    foes,
    allies,
    hands: fightHands(sheet),
    self: { hp: sheet.currentHp, maxHp: sheet.maxHp, conditions: sheet.conditions },
  });
}

// The shield on the companion's arm and the carried two-handed weapons it
// rules out, as the server's own hands rule reads the sheet (attack-logic.ts).
function fightHands(sheet: CharacterSheet): FightHands {
  const shield = acBreakdownFor(sheet).shieldName;
  if (!shield) {
    return { shield: null, blocked: [] };
  }
  const blocked = (sheet.equipment ?? []).filter((item) => (weaponOf(item)?.properties ?? []).includes("two-handed")).map((item) => item.name);
  return { shield, blocked: [...new Set(blocked)] };
}

const FIGHT_TURN_NOTE =
  "This is their own turn in the fight and this is their choice: carry it out with the combat tools (move_token, pc_attack, the cast tools, take_action, use_item), then end_turn. Keep their target and their means. If a tool refuses part of it, call npc_speak for them again with the reason, so they choose again; never choose for them.";

// A call that spends a mind-chosen companion's fight turn before its mind
// chose it this turn: refused, with the way through.
export function mindTurnRefusal(campaign: Campaign, name: string, rawArguments: string): ToolError | null {
  let args: unknown;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const actor = args && typeof args === "object" && !Array.isArray(args) ? turnActorOf(name, args as Record<string, unknown>) : null;
  const enemyId = name === "enemy_attack" && args && typeof args === "object" ? (args as Record<string, unknown>).enemyId : null;
  const turn = mindsFightTurn(campaign, actor) ?? mindsAllyRow(campaign, typeof enemyId === "string" ? enemyId : null);
  if (!turn) {
    return null;
  }
  const turnId = currentTurnId() ?? "";
  if (listNpcProposals(campaign.id, turn.npc.id).some((proposal) => proposal.status === "committed" && proposal.turnId === turnId)) {
    return null;
  }
  return {
    error: `It is ${turn.npc.name}'s own turn, and their own mind chooses it: call npc_speak for ${turn.npc.name} first (say what they perceive; the server adds their sheet and the fight as they see it), then carry out the intent it returns.`,
    retry: true,
  };
}

const speakSchema = z.object({
  name: z.string().trim().min(1).max(120),
  perceives: z.string().trim().min(1).max(2000),
  alsoPresent: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  away: z.boolean().optional(),
  place: z.string().trim().max(120).optional(),
});

// npc_speak: the moment goes to everyone present, then the addressed mind
// answers from what it knows.
// options.remember false: the stage's own call, whose frame is made of
// events every perceiver already keeps a line of, and whose words become an
// event heard by the senses (docs/specs/ogm-npc-perception.md): neither the
// frame nor an overheard copy of the words is stored again.
export async function handleNpcSpeak(campaign: Campaign, rawArguments: string, options: { remember?: boolean } = {}): Promise<ToolResult> {
  const remember = options.remember !== false;
  let args: z.infer<typeof speakSchema>;
  try {
    args = speakSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: npc_speak needs the NPC's name and what they perceive.", error, rawArguments);
  }
  const cast = listNpcs(campaign.id);
  const { ids, unknown } = recipientsOf(args.name, args.alsoPresent ?? [], cast);
  // The addressed name comes first: unresolved, ids[0] would be a bystander.
  const addressedFound = !unknown.some((name) => textKey(name) === textKey(args.name));
  const npc = addressedFound ? cast.find((entry) => entry.id === ids[0]) : undefined;
  if (!npc) {
    return { error: `No tracked NPC is called "${args.name}". Register them with set_npc first.`, retry: true };
  }
  // The body comes first (npc_state): the senseless and the dead say nothing.
  const silenced = npcSilencedBy(npc.state);
  if (silenced) {
    return {
      error: `${npc.name} is ${silenced} on the record and cannot speak or answer. Narrate them as they are; if the story has changed that, record it with npc_state first.`,
      refused: "rules",
    };
  }
  // A second-tier NPC has no mind of their own: the narrator voices them.
  if (tierOfNpc(npc) !== "primary") {
    return {
      error: `${npc.name} is a second-tier NPC: voice them yourself from their personality and what the roster says they learned. Record what they learn with npc_inform.`,
      refused: "rules",
    };
  }
  const turnId = currentTurnId() ?? "";
  const now = nowInstant(campaign.id);
  seedBackground(campaign, npc, listNpcMemories(campaign.id, npc.id));
  // Apart from the party (left behind, or a cut to them): first the time
  // since they were last played, then this moment where they are. Called
  // without away, a mind that was apart is back with the party.
  const apart = Boolean(args.away);
  let away = getNpcAway(npc.id);
  if (apart && !away) {
    away = { place: args.place || npc.location || "", since: now };
    setNpcAway(npc.id, away);
  }
  let whileApart: string[] = [];
  if (away) {
    const done = await catchUp(campaign, npc, away, turnId);
    if (!done.ok) {
      return {
        error: `${npc.name}'s own mind did not answer while catching up on their time apart (${done.error}). Do not write what they did or say: say only that there is no news of them yet. The table can retry the turn.`,
        refused: "limit",
      };
    }
    whileApart = done.lines;
    setNpcAway(npc.id, apart ? { place: args.place || away.place, since: now } : null);
  }
  if (!apart) {
    bringToScene(campaign, npc);
  }
  const actor = getNpcById(npc.id) ?? npc;
  // Only those really with them hear it: a mind apart from the scene is not
  // a listener in it.
  const others = cast.filter((entry) => ids.includes(entry.id) && entry.id !== npc.id && (apart || !getNpcAway(entry.id)));
  if (remember) {
    addNpcMemories(campaign.id, [npc.id, ...others.map((entry) => entry.id)], { kind: "knowledge", sourceKind: "perceived", sourceName: ON_STAGE_SOURCE, content: args.perceives, learnedAt: now }, turnId);
  }
  // What the mind sees of the others' bodies (docs/specs/ogm-npc-state.md):
  // the listeners, and anyone else here whose state shows (tied, down,
  // dead), never what they carry, and a keeper by name only if it knows it.
  const ownMemories = listNpcMemories(campaign.id, npc.id);
  const looks = (entry: Npc) => npcSeenStateWords(entry.state, knowsName(entry.state.heldBy, ownMemories) || textKey(entry.state.heldBy) === textKey(npc.name));
  const here = apart ? "" : (getCurrentLocation(campaign.id)?.name ?? "");
  const visible = here
    ? cast.filter((entry) => entry.id !== npc.id && !others.includes(entry) && !entry.archived && entry.location === here && !getNpcAway(entry.id) && looks(entry))
    : [];
  const described = (entry: Npc) => {
    const seen = looks(entry);
    return { name: entry.name, description: clipText(`${entry.role || entry.trait || "a person"}${seen ? `; now ${seen}` : ""}`, 140) };
  };
  const present: MindPerson[] = [
    ...(apart ? [] : heroesOf(campaign.id).filter((hero) => textKey(hero.name) !== textKey(npc.name))),
    ...others.map(described),
    ...visible.map(described),
  ];
  const own = npcSeenStateWords(actor.state, knowsName(actor.state.heldBy, ownMemories));
  // The clock, so a moment told as a stretch ("Brakk lies down; eight hours
  // pass") is answered from its end: Mara, told of a whole night's rest,
  // bade the waking man "sleep while you can".
  const clock = getClock(campaign.id);
  const when = `It is now ${describeInstant(clock.calendar, clock.instant)}. You speak and act at this moment, after everything below has already happened.\n`;
  const where = `${when}${apart ? `You are at ${args.place || away?.place || "a place of your own"}, apart from the party.\n` : ""}${own ? `You yourself are ${own}.\n` : ""}`;
  // Its own turn in a fight: the mind chooses it, seeing the fight as it does.
  const fightTurn = apart ? null : mindsFightTurn(campaign, npc.companionSheetId);
  const ownTurn = fightTurn?.npc.id === npc.id ? fightTurn : null;
  const fight = ownTurn ? `\n\n${fightView(campaign, ownTurn.sheet)}` : "";
  const outcome = await askMind(campaign, actor, `${where}${args.perceives}${fight}`, present, false);
  if (!outcome.ok) {
    recordNpcProposal(campaign.id, { npcId: npc.id, turnId, mode: "scene", status: "failed", speech: "", intent: "", error: outcome.error, flags: [], latencyMs: outcome.latencyMs, inputTokens: 0, outputTokens: 0 });
    return {
      error: `${npc.name}'s own mind did not answer (${outcome.error}). Do not write words or a decision for them: say only that they do not answer yet. The table can retry the turn.`,
      refused: "limit",
    };
  }
  const { proposal } = outcome;
  const flags = proposal.speech ? unlearnedNames(proposal.speech, npc.name, worldNames(campaign.id), outcome.memories) : [];
  if (proposal.speech) {
    addNpcMemories(campaign.id, [npc.id], { kind: proposal.lie ? "lie" : "said", sourceKind: "self", sourceName: "", content: proposal.speech, learnedAt: now }, turnId);
    for (const other of remember ? others : []) {
      addNpcMemories(campaign.id, [other.id], { ...overheard(npc.name, proposal.speech, listNpcMemories(campaign.id, other.id)), learnedAt: now }, turnId);
    }
  }
  if (proposal.conclusion) {
    addNpcMemories(campaign.id, [npc.id], { kind: "hypothesis", sourceKind: "self", sourceName: "", content: proposal.conclusion, learnedAt: now }, turnId);
  }
  // What it set out to do, so the next turn knows it already did it.
  if (proposal.intent) {
    addNpcMemories(campaign.id, [npc.id], { kind: "did", sourceKind: "self", sourceName: "", content: proposal.intent, learnedAt: now }, turnId);
  }
  recordNpcProposal(campaign.id, {
    npcId: npc.id,
    turnId,
    mode: "scene",
    status: "committed",
    speech: proposal.speech,
    intent: proposal.intent,
    error: "",
    flags,
    latencyMs: outcome.latencyMs,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
  });
  return {
    ok: true,
    npc: npc.name,
    says: proposal.speech,
    intends: proposal.intent,
    ...(whileApart.length ? { whileApart, apartNote: APART_NOTE } : {}),
    ...(apart ? { apartAt: args.place || away?.place || "" } : away ? { rejoined: true } : {}),
    ...(ownTurn ? { fightTurn: FIGHT_TURN_NOTE } : {}),
    ...(unknown.length ? { notTracked: unknown } : {}),
    ...(flags.length
      ? { unlearned: flags, flagNote: `${npc.name} named ${flags.join(", ")} without having learned it: treat it as their guess or lie, never as a fact of the world.` }
      : {}),
    narrate:
      "Voice their words as given and show their intent. The intent is only an attempt, but it is made now: never write it as about to happen or left hanging. Resolve it through the engine's tools when it needs a roll or changes anything, and say how it ends. When they drink or eat, record it with npc_state (drank, ate); when a thing changes hands, with handle_item action \"hand\" (giver and taker by name), grant_item or remove_item. Add nothing they know beyond their words.",
  };
}

// Someone who speaks in the scene, or hears it from close by, is in it: a
// record that still puts them somewhere else is brought to where the party
// is (docs/specs/ogm-npc-state.md, rule 3). A mind apart is left where it is,
// and so is a prisoner: only who holds them moves them (the party's move,
// npc_state). Live play: Aldren, locked in his cell, answered as Brakk walked
// off and stood in the courtyard, hearing the lieutenant there.
function bringToScene(campaign: Campaign, npc: Npc) {
  const here = getCurrentLocation(campaign.id)?.name ?? "";
  if (here && npc.location !== here && !getNpcAway(npc.id) && npc.state.custody !== "captive") {
    setNpcPlace(npc.id, { location: here });
  }
}

// Everyone in the scene hears what was said aloud in it (turn.ts, at the
// end of every DM turn), as a speech event each mind's senses take in
// (docs/specs/ogm-npc-perception.md): each first-tier mind here with the
// party, not apart, keeps the words as it heard them, save its own. Words
// already heard as events this turn (the stage's, the heroes' own lines on a
// staged table) are not heard again from the narrator's retelling.
export function everyoneHears(campaign: Campaign, turnId: string, lines: readonly { speaker: string; words: string }[]) {
  if (!npcMindsOn(campaign) || !turnId || !lines.length) {
    return;
  }
  const here = textKey(getCurrentLocation(campaign.id)?.name ?? "");
  const now = nowInstant(campaign.id);
  const place = getCurrentLocation(campaign.id)?.name ?? "";
  const listeners: Observer[] = [];
  for (const npc of listNpcs(campaign.id)) {
    // Where the NPC is, not whether it travels with the party: one left in
    // the courtyard while some of the party went on hears nothing said there.
    const present = here === "" || !npc.location.trim() ? npc.state.withParty : textKey(npc.location) === here;
    // Left behind where the scene now is (a prisoner in the cells the party
    // came back to), the mind is in the scene again: only being apart
    // somewhere else keeps it from hearing.
    const away = getNpcAway(npc.id);
    const elsewhere = Boolean(away) && textKey(away?.place ?? "") !== here;
    if (tierOfNpc(npc) !== "primary" || npc.archived || !present || elsewhere || npcSilencedBy(npc.state)) {
      continue;
    }
    seedBackground(campaign, npc, listNpcMemories(campaign.id, npc.id));
    listeners.push({ id: npc.id, name: npc.name, condition: npc.state.condition, zone: zoneOf(campaign, npc.name) });
  }
  if (!listeners.length) {
    return;
  }
  const staged = Boolean(campaign.gameSettings.npcStage);
  const heroes = new Set(heroesOf(campaign.id).map((hero) => textKey(hero.name)));
  const heard = speechHeardInTurn(campaign.id, turnId).map(textKey);
  const already = (words: string) => heard.some((speech) => speech.includes(textKey(words)) || textKey(words).includes(speech));
  for (const line of lines.slice(0, 24)) {
    if ((staged && heroes.has(textKey(line.speaker))) || already(line.words)) {
      continue;
    }
    const event = { turnId, instant: now, place, actor: line.speaker, verb: "speak" as const, targets: [], object: "", zoneFrom: "", zoneTo: "", volume: "normal" as const, covert: false, stealth: null, success: true, speech: line.words.slice(0, 1200), outcome: "" };
    recordSceneEvent(campaign.id, { ...event, zoneFrom: zoneOf(campaign, line.speaker) }, perceive(event, listeners, senseScene(campaign, zoneOf(campaign, line.speaker))), listeners);
  }
}
const informSchema = z.object({
  name: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(120),
  news: z.string().trim().min(1).max(1000),
  witnessed: z.boolean().optional(),
});

// npc_inform: news reaching a mind that was not there, from a named source,
// as of now. What it is told is a belief: the source may be wrong or lying.
export async function handleNpcInform(campaign: Campaign, rawArguments: string): Promise<ToolResult> {
  let args: z.infer<typeof informSchema>;
  try {
    args = informSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: npc_inform needs the NPC's name, the source and the news.", error, rawArguments);
  }
  const cast = listNpcs(campaign.id);
  const { ids } = recipientsOf(args.name, [], cast);
  const npc = cast.find((entry) => entry.id === ids[0]);
  if (!npc) {
    return { error: `No tracked NPC is called "${args.name}". Register them with set_npc first.`, retry: true };
  }
  // Someone from where a companion was left: the companion's time apart is
  // played first, so what they did there is already so when this news lands.
  const turnId = currentTurnId() ?? "";
  const touched: Array<{ name: string; did: string[] }> = [];
  for (const companion of npc.location ? cast : []) {
    const away = companion.id === npc.id ? null : getNpcAway(companion.id);
    if (!away || textKey(away.place) !== textKey(npc.location)) {
      continue;
    }
    seedBackground(campaign, companion, listNpcMemories(campaign.id, companion.id));
    const done = await catchUp(campaign, companion, away, turnId);
    if (!done.ok) {
      return {
        error: `${companion.name}, apart at ${away.place}, did not answer while catching up (${done.error}). Record nothing about them yet; the table can retry the turn.`,
        refused: "limit",
      };
    }
    if (done.lines.length) {
      touched.push({ name: companion.name, did: done.lines });
    }
  }
  seedBackground(campaign, npc, listNpcMemories(campaign.id, npc.id));
  addNpcMemories(
    campaign.id,
    [npc.id],
    args.witnessed
      ? { kind: "knowledge", sourceKind: "perceived", sourceName: "", content: args.news, learnedAt: nowInstant(campaign.id) }
      : { kind: "belief", sourceKind: "told", sourceName: args.source, content: args.news, learnedAt: nowInstant(campaign.id) },
    turnId,
  );
  return {
    ok: true,
    npc: npc.name,
    learned: args.witnessed ? "seen first hand" : `told by ${args.source}, as of now`,
    ...(touched.length ? { whileApart: touched, apartNote: APART_NOTE } : {}),
  };
}

const pastSchema = z.object({
  name: z.string().trim().min(1).max(120),
  inspiration: z.string().trim().max(200).optional(),
  past: z.array(z.string().trim().min(1).max(400)).max(8).optional(),
  firstTier: z.boolean().optional(),
});


export { MAX_FIRST_TIER_NPCS };

// How many of their own voiced lines a character promoted mid-story keeps.
const PROMOTION_LINES = 12;

// npc_past: who someone was before play, laid down before they first act.
// Refused once they have lived anything, so a companion cannot suddenly
// have written letters to a victim the party is investigating.
export function handleNpcPast(campaign: Campaign, rawArguments: string): ToolResult {
  let args: z.infer<typeof pastSchema>;
  try {
    args = pastSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch (error) {
    return badArguments("Invalid arguments: npc_past needs the NPC's name and their past or inspiration.", error, rawArguments);
  }
  const cast = listNpcs(campaign.id);
  const { ids } = recipientsOf(args.name, [], cast);
  const npc = cast.find((entry) => entry.id === ids[0]);
  if (!npc) {
    return { error: `No tracked NPC is called "${args.name}". Register them with set_npc first.`, retry: true };
  }
  const memories = listNpcMemories(campaign.id, npc.id);
  if (args.past?.length && !backgroundOpen(memories, listNpcProposals(campaign.id, npc.id).length)) {
    return {
      error: `${npc.name} has already lived part of the story: their past can no longer be added to. Only what is already established can come out now.`,
      refused: "rules",
    };
  }
  if (args.firstTier !== undefined && !npc.companionSheetId) {
    const others = cast.filter((entry) => entry.id !== npc.id && !entry.archived && !entry.companionSheetId && tierOfNpc(entry) === "primary");
    const limit = firstTierLimit(campaign);
    if (args.firstTier && others.length >= limit) {
      return {
        error: `${others.map((entry) => entry.name).join(", ")} already have their own minds (${limit} at most at this table). Keep ${npc.name} second tier, or give one of them back to the narrator with firstTier: false first.`,
        refused: "limit",
      };
    }
    const promoted = args.firstTier && tierOfNpc(npc) !== "primary";
    setNpcTier(npc.id, args.firstTier ? "primary" : "secondary");
    // Promoted in the middle of the story: the mind remembers what the
    // narrator had them say, in their own words, as it remembers what they
    // saw and were told. Without it a captain promoted after a long road at
    // the hero's side would not know a word she had spoken.
    if (promoted) {
      const known = new Set(memories.map((memory) => textKey(memory.content)));
      const now = nowInstant(campaign.id);
      for (const line of npcVoicedLines(campaign.id, npc.id, PROMOTION_LINES)) {
        if (!known.has(textKey(line))) {
          known.add(textKey(line));
          addNpcMemories(campaign.id, [npc.id], { kind: "said", sourceKind: "self", sourceName: "", content: line, learnedAt: now }, currentTurnId() ?? "");
        }
      }
    }
  }
  if (args.inspiration !== undefined) {
    setNpcInspiration(npc.id, args.inspiration);
  }
  for (const line of args.past ?? []) {
    addNpcMemories(campaign.id, [npc.id], { kind: "knowledge", sourceKind: "background", sourceName: "", content: line, learnedAt: 0 }, currentTurnId() ?? "");
  }
  return { ok: true, npc: npc.name, past: args.past?.length ?? 0, inspiration: args.inspiration ?? getNpcInspiration(npc.id), tier: tierOfNpc(npc) };
}

// How many minds act off-screen each time the world's time moves on.
export const OFFSCREEN_BUDGET = 2;

// The mind only proposes; the engine rolls how far its goal gets, on the
// dice every goal advances on (src/lib/dm/npc-agency.ts). A goal reached is
// a GM-only fact.
function pursueGoal(npc: Npc, d20: number): Array<{ category: "npc"; subject: string; fact: string }> {
  const goal = npc.agency.goals.session;
  if (!goal) {
    return [];
  }
  const result = advanceSessionGoal(goal, npc.agency.personality, d20);
  patchNpcAgency(npc.id, { goals: { ...npc.agency.goals, session: result.completed ? undefined : result.goal } });
  return result.completed
    ? [{ category: "npc", subject: npc.name, fact: `Off-screen, ${npc.name} achieved what they were working toward: ${goal.text}.` }]
    : [];
}

type CatchUp = { ok: true; lines: string[] } | { ok: false; error: string };

// A mind apart from the party lives the time since it was last played, in a
// few steps (npc-mind-logic.ts catchUpSteps), when the story touches it
// again: its own mind proposes each step from what it knows where it is,
// the engine's d20 says how it went, and the mind remembers it. Each step is
// kept as it is played, so a failure resumes after the last one kept.
async function catchUp(campaign: Campaign, npc: Npc, away: NpcAway, turnId: string): Promise<CatchUp> {
  const lines: string[] = [];
  let current = npc;
  let from = away.since;
  for (const until of catchUpSteps(away.since, nowInstant(campaign.id))) {
    const hours = Math.max(1, Math.round((until - from) / 60));
    const goal = current.agency.goals.session?.text ?? current.agency.goals.ambition ?? current.agency.goals.scene ?? "";
    const place = away.place || "where the party left you";
    const outcome = await askMind(campaign, current, `You are at ${place}, apart from your companions. About ${hours} hours pass.${goal ? ` You are pursuing: ${goal}.` : ""}`, [], true);
    if (!outcome.ok || !outcome.proposal.intent) {
      const error = outcome.ok ? "no intent" : outcome.error;
      recordNpcProposal(campaign.id, { npcId: npc.id, turnId, mode: "offscreen", status: "failed", speech: "", intent: "", error, flags: [], latencyMs: outcome.latencyMs, inputTokens: 0, outputTokens: 0 });
      return { ok: false, error };
    }
    const intent = clipText(outcome.proposal.intent, 200);
    const d20 = rollExpression("1d20").total;
    const result = attemptOutcome(d20);
    addNpcMemories(campaign.id, [npc.id], { kind: "did", sourceKind: "self", sourceName: "", content: `${intent} (it ${result})`, learnedAt: until }, turnId);
    recordExtractedFacts(
      campaign.id,
      [{ category: "npc", subject: npc.name, fact: `While apart at ${place}, ${npc.name} tried to ${intent}; it ${result}.` }, ...pursueGoal(current, d20)],
      "simulation",
      { knownBy: "dm" },
    );
    recordNpcProposal(campaign.id, { npcId: npc.id, turnId, mode: "offscreen", status: "committed", speech: outcome.proposal.speech, intent: outcome.proposal.intent, error: "", flags: [], latencyMs: outcome.latencyMs, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens });
    setNpcAway(npc.id, { place: away.place, since: until });
    lines.push(`${intent} (d20 ${d20}: it ${result})`);
    from = until;
    current = getNpcById(npc.id) ?? current;
  }
  return { ok: true, lines };
}

const APART_NOTE =
  "What they did while apart, played on the engine's dice before this moment: apply any consequence for others (someone hurt, something taken) with your usual tools before narrating; anyone who saw it knows only what they saw.";

// Time passed away from the scene: the NPCs with something to pursue each
// decide their next step from what they know. The step becomes a GM-only
// world fact the narrator may surface as a rumour, and a memory of the mind;
// how far it gets is still the goal engine's dice (npc-agency.ts). A mind
// that fails is recorded and skipped; nothing else waits on it.
export async function runOffscreenMinds(campaign: Campaign, budget = OFFSCREEN_BUDGET): Promise<number> {
  if (!npcMindsOn(campaign)) {
    return 0;
  }
  const here = getCurrentLocation(campaign.id)?.name ?? "";
  const last = lastOffscreenInstants(campaign.id);
  // Only the first tier thinks off-screen; a companion travels with the party.
  const npcs = listNpcs(campaign.id).filter((npc) => !npc.archived && !npc.companionSheetId && tierOfNpc(npc) === "primary");
  const picked = offscreenCandidates(
    npcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      location: npc.location,
      goal: npc.agency.goals.session?.text ?? npc.agency.goals.ambition ?? npc.agency.goals.scene ?? "",
      lastActedAt: last.get(npc.id) ?? -1,
    })),
    here,
    budget,
  );
  let acted = 0;
  for (const choice of picked) {
    const npc = npcs.find((entry) => entry.id === choice.id);
    if (!npc) {
      continue;
    }
    seedBackground(campaign, npc, listNpcMemories(campaign.id, npc.id));
    const outcome = await askMind(campaign, npc, `Some time has passed. You are pursuing: ${choice.goal}.`, [], true);
    const now = nowInstant(campaign.id);
    if (!outcome.ok || !outcome.proposal.intent) {
      recordNpcProposal(campaign.id, { npcId: npc.id, turnId: "", mode: "offscreen", status: "failed", speech: "", intent: "", error: outcome.ok ? "no intent" : outcome.error, flags: [], latencyMs: outcome.latencyMs, inputTokens: 0, outputTokens: 0 });
      continue;
    }
    addNpcMemories(campaign.id, [npc.id], { kind: "did", sourceKind: "self", sourceName: "", content: outcome.proposal.intent, learnedAt: now });
    const facts = [
      { category: "npc" as const, subject: npc.name, fact: `Off-screen, ${npc.name} sets out to ${clipText(outcome.proposal.intent, 200)}` },
      ...pursueGoal(npc, rollExpression("1d20").total),
    ];
    recordExtractedFacts(campaign.id, facts, "simulation", { knownBy: "dm" });
    recordNpcProposal(campaign.id, { npcId: npc.id, turnId: "", mode: "offscreen", status: "committed", speech: outcome.proposal.speech, intent: outcome.proposal.intent, error: "", flags: [], latencyMs: outcome.latencyMs, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens });
    acted += 1;
  }
  return acted;
}
