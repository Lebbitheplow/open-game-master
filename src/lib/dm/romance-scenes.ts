import type { Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getCurrentLocation } from "@/lib/db/locations";
import { getRelationshipById, listRelationships, patchRelationship, type Relationship } from "@/lib/db/relationships";
import { latestNarrationSeq, narrationsAfter, readPacing, writePacing } from "@/lib/db/romance-pacing";
import { listSheets } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { livingHero } from "@/lib/characters/fallen-logic";
import { isOocAnswer } from "@/lib/dm/ooc-question";
import { presentInScene, romanceSafetyBlock } from "@/lib/dm/advance-logic";
import { addMemory, type RomanceStage } from "@/lib/dm/relationship-logic";
import { publishRelationshipsUpdated, resolveSubject } from "@/lib/dm/relationship-subject";
import { stepWaitLeft, tooSoonError, waitWords } from "@/lib/dm/romance-pace-logic";
import {
  afterLapse,
  afterPlayed,
  pickScene,
  readDue,
  sceneCard,
  sceneMemory,
  sceneNote,
  sceneTaken,
  type DueScene,
  type Pacing,
  type ScenePair,
  type SceneMessage,
} from "@/lib/dm/romance-scene-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import { openToMore } from "@/lib/attraction";
import { personOpen } from "@/lib/dm/romance-exclusive";

// A romance's pace (issue 643), the rim around romance-pace-logic.ts and
// romance-scene-logic.ts. Three jobs:
//
// - Every step up records the clock, and a step asked too soon after the
//   last is refused with when it can come: romance_advance (the AI's and the
//   console's Social > Romance alike, marriage included), an NPC's first
//   move as it is made and as the server rolls for one.
// - After each narration (an AI turn's, src/lib/dm/turn.ts finalize; a
//   person's or an agent program's, the narrate route) the scene that was
//   due is read against it, and the next one is chosen.
// - While a scene is due, the AI is handed a director note for it
//   (romanceSceneNotes, which counts it as handed), and a person running the
//   table reads it on the Bonds tab (romanceSceneCards), where each of their
//   narrations counts as one it was handed for.
//
// No model call anywhere: server state and the narration's own words.

// Whether anything romantic is offered here: romance on, and nothing in the
// table's safety tools that rules it out (a family table, a line or a veil
// naming romance), as for an NPC's first move.
export function romanceScenesAllowed(campaign: Pick<Campaign, "gameSettings">): boolean {
  const settings = campaign.gameSettings;
  return settings.relationships !== "off" && settings.romance !== "off" && !romanceSafetyBlock(settings.safety);
}

// ---- the time between rungs ----

// A step up was taken: the clock and the newest narration are when, and a
// scene the old rung was owed is dropped with it.
export function recordRomanceStep(campaignId: string, relationshipId: string) {
  writePacing(relationshipId, {
    ...readPacing(relationshipId),
    steppedAt: getClock(campaignId).instant,
    steppedSeq: latestNarrationSeq(campaignId),
    due: null,
  });
}

// Whether `target` may come now after this pair's last step.
export function romanceStepDue(campaignId: string, relationshipId: string, target: RomanceStage): boolean {
  return stepWaitLeft(target, readPacing(relationshipId).steppedAt, getClock(campaignId).instant) === 0;
}

// The refusal for a step asked too soon, or null when it may come. A rules
// refusal: nothing was asked of the subject, so no consent roll, no sting
// and no memory, and the step may be asked again once the time has passed.
export function romanceStepTooSoon(
  campaign: Pick<Campaign, "id">,
  relationship: Pick<Relationship, "id" | "romance" | "characterName" | "subjectName">,
  target: RomanceStage,
  turn: Pick<DmTurn, "actor">,
): { error: string; refused: "rules"; nextStepIn: string } | null {
  const steppedAt = readPacing(relationship.id).steppedAt;
  const now = getClock(campaign.id).instant;
  const left = stepWaitLeft(target, steppedAt, now);
  if (!left) {
    return null;
  }
  const elapsed = Math.max(0, now - (steppedAt ?? now));
  return {
    error: tooSoonError(relationship.characterName, relationship.subjectName, relationship.romance, target, elapsed, left, turn.actor === "human_dm"),
    refused: "rules",
    nextStepIn: waitWords(left),
  };
}

// ---- the scenes ----

// Beats that say a character is courting someone.
const ROMANTIC_BEATS = ["flirt", "compliment", "grand_gesture", "intimacy"];

// The character's strongest other romantic interest: another active bond on
// the ladder, or one they have flirted with since the beat counts last
// halved. "" for none.
function rivalOf(rows: readonly Relationship[], pair: Relationship): string {
  let best: Relationship | null = null;
  for (const other of rows) {
    if (other.characterId !== pair.characterId || other.id === pair.id || other.status !== "active") {
      continue;
    }
    const romantic = other.romance !== "none" || ROMANTIC_BEATS.some((beat) => (other.beats[beat] ?? 0) > 0);
    if (romantic && textKey(other.subjectName) !== textKey(pair.subjectName) && (!best || other.approval > best.approval)) {
      best = other;
    }
  }
  return best?.subjectName ?? "";
}

type Candidate = ScenePair & { ids: string[] };

// Every pair on the romance ladder whose two sides are at the table: a
// living hero, and a subject who is a companion in the party or an NPC in
// the scene (`narration`: the reply just told).
function scenePairs(campaign: Campaign, rows: readonly Relationship[], narration: string): Candidate[] {
  const sheets = listSheets(campaign.id);
  const partyLocation = getCurrentLocation(campaign.id)?.name ?? "";
  const pairs: Candidate[] = [];
  for (const row of rows) {
    const hero = sheets.find((sheet) => sheet.id === row.characterId);
    if (row.romance === "none" || row.status !== "active" || !hero || !livingHero(hero)) {
      continue;
    }
    const subject = resolveSubject(campaign, row.subjectName, sheets);
    if ("error" in subject) {
      continue;
    }
    const pacing = readPacing(row.id);
    pairs.push({
      relationshipId: row.id,
      character: hero.name,
      subject: subject.name,
      romance: row.romance,
      approval: row.approval,
      pacing,
      present: subjectPresent(subject, sheets, partyLocation, narration),
      sinceStep: narrationsAfter(campaign.id, pacing.steppedSeq),
      composure: subject.personality?.composure ?? 0,
      // A rival stings nobody when both of them are open to more than one
      // partner (issue 642), as a flirt in front of a partner does not.
      openRelationship: openToMore(hero.attraction) && personOpen(campaign.id, subject.name, sheets),
      rival: rivalOf(rows, row),
      ids: [subject.id, ...(subject.npc ? [subject.npc.id] : [])].filter(Boolean),
    });
  }
  return pairs;
}

function subjectPresent(
  subject: { kind: string; id: string; name: string; npc: { location: string } | null },
  sheets: readonly CharacterSheet[],
  partyLocation: string,
  narration: string,
): boolean {
  if (subject.kind === "companion") {
    const sheet = sheets.find((entry) => entry.id === subject.id);
    return Boolean(sheet?.isCompanion && sheet.companionKind === "party" && !sheet.summon && !sheet.deathSaves?.dead);
  }
  return presentInScene({ name: subject.name, location: subject.npc?.location ?? "" }, partyLocation, narration);
}

// After a narration: the due scene, if any, is read against it (`handedNow`:
// a person's narration, written with the Bonds tab's card in view; an AI
// turn's was counted as its prompt was built), then the next scene is
// chosen. Romance switched off drops what was due; a fight holds it, and
// nothing new comes due during one.
export function readRomanceScene(campaign: Campaign, message: SceneMessage & { seq: number }, options: { handedNow: boolean }) {
  // An out-of-character answer is not a reply in the story: it neither
  // plays a scene by naming the two of them nor counts toward one.
  if (isOocAnswer(message.content)) {
    return;
  }
  const rows = listRelationships(campaign.id);
  if (!romanceScenesAllowed(campaign)) {
    let dropped = false;
    for (const row of rows) {
      const pacing = readPacing(row.id);
      if (pacing.due) {
        writePacing(row.id, { ...pacing, due: null });
        dropped = true;
      }
    }
    if (dropped) {
      publishRelationshipsUpdated(campaign.id);
    }
    return;
  }
  if (getActiveEncounter(campaign.id)) {
    return;
  }
  const pairs = scenePairs(campaign, rows, message.content);
  let changed = false;
  // A scene due to a pair no longer on the ladder together (it ended, they
  // parted, the hero fell) goes with it.
  const onLadder = new Set(pairs.map((pair) => pair.relationshipId));
  for (const row of rows) {
    const pacing = onLadder.has(row.id) ? null : readPacing(row.id);
    if (pacing?.due) {
      writePacing(row.id, { ...pacing, due: null });
      changed = true;
    }
  }
  for (const pair of pairs) {
    const due = pair.pacing.due;
    if (!due) {
      continue;
    }
    changed = true;
    // The rung moved since it came due (a step on, a slip back): it is not
    // that rung's moment any more.
    if (due.stage !== pair.romance) {
      pair.pacing = { ...pair.pacing, due: null };
      writePacing(pair.relationshipId, pair.pacing);
      continue;
    }
    const handed = { ...due, handed: due.handed + (options.handedNow ? 1 : 0) };
    const verdict = readDue(handed, sceneTaken(message, { name: pair.subject, ids: pair.ids }, pair.character));
    if (verdict === "played") {
      pair.pacing = afterPlayed({ ...pair.pacing, due: handed }, message.seq);
      remember(pair, handed);
    } else if (verdict === "lapsed") {
      pair.pacing = afterLapse({ ...pair.pacing, due: handed }, message.seq);
    } else {
      pair.pacing = { ...pair.pacing, due: handed };
    }
    writePacing(pair.relationshipId, pair.pacing);
  }
  // Every pair's last scene, for the table's cooldown.
  const lastEnded = Math.max(0, ...rows.map((row) => readPacing(row.id).endedSeq));
  const next = pickScene(pairs, lastEnded ? narrationsAfter(campaign.id, lastEnded) : null);
  if (next) {
    writePacing(next.relationshipId, { ...next.pacing, due: { ...next.scene, handed: 0 } });
    changed = true;
  }
  if (changed) {
    publishRelationshipsUpdated(campaign.id);
  }
}

// A played scene stays on the bond, where the Bonds tab's history and the
// GAME STATE relationship line read it.
function remember(pair: ScenePair, scene: Pick<DueScene, "kind" | "rival">) {
  const row = getRelationshipById(pair.relationshipId);
  if (!row) {
    return;
  }
  patchRelationship(row.id, {
    memories: addMemory(row.memories, { kind: "scene", text: sceneMemory(pair.subject, pair.character, scene), at: new Date().toISOString() }),
  });
}

// The scene due now, with its pair, or null; none during a fight or where
// nothing romantic is offered.
function dueNow(campaign: Campaign): { row: Relationship; pacing: Pacing } | null {
  if (!romanceScenesAllowed(campaign) || getActiveEncounter(campaign.id)) {
    return null;
  }
  for (const row of listRelationships(campaign.id)) {
    const pacing = readPacing(row.id);
    if (pacing.due && row.status === "active" && pacing.due.stage === row.romance) {
      return { row, pacing };
    }
  }
  return null;
}

// The AI's director note while a scene is due, built into this turn's
// prompt; building it counts the scene as handed for this reply. Called only
// where director notes are (not while the table is in a conversation the
// GM waits out, not for an out-of-character answer), so a scene is never
// spent on a reply that could not have played it.
export function romanceSceneNotes(campaign: Campaign): string[] {
  const found = dueNow(campaign);
  if (!found?.pacing.due) {
    return [];
  }
  const due = found.pacing.due;
  writePacing(found.row.id, { ...found.pacing, due: { ...due, handed: due.handed + 1 } });
  return [sceneNote(found.row.subjectName, found.row.characterName, found.row.romance, due)];
}

// For a person running the table (the Bonds tab), by relationship id. The
// caller has checked the viewer may read it: like an NPC's readiness to make
// a move, the engine's choice is the storyteller's to play.
export function romanceSceneCards(campaign: Campaign): Map<string, string> {
  const found = dueNow(campaign);
  return found?.pacing.due
    ? new Map([[found.row.id, sceneCard(found.row.subjectName, found.row.characterName, found.pacing.due)]])
    : new Map();
}
