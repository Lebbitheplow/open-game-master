// Scenes the other side of a romance starts (issue 643), the pure half: the
// moment each rung opens, when the engine says one is due, how a narration
// is read for whether it was played, and the words the GM is handed. No DB
// access and no "@/" imports, so scripts/test-romance-scenes.mjs loads it
// directly; the rim is src/lib/dm/romance-scenes.ts.
//
// In both romance playtests every step came from the player: the companion
// never wanted anything. Now each rung opens one scene the companion (or the
// NPC) starts: a private talk, a request for help with something of their
// own, and so on up the ladder, with a jealous moment where their nature and
// a rival say so. The engine decides when it is due, one at a time at the
// whole table, never in a fight and with a cooldown after each; the GM plays
// it; the narration it is played in records it.
//
// It follows the way an NPC's first move is cued (advance-logic.ts): the
// server picks the moment, the GM is told in a director note (or, at a table
// a person runs, on the Bonds tab), and the player's character answers in
// play. Unlike a first move it needs no tool call: the scene is the
// companion's words, and the words are what the server reads.

import type { RomanceStage } from "./relationship-logic.ts";
import { ROMANCE_LABEL, romanceIndex } from "./relationship-logic.ts";
import { names } from "./conscience-voice-logic.ts";
import { compareNames, textKey } from "../language/text-logic.ts";

// ---- the scenes ----

export const SCENE_KINDS = ["private_talk", "asks_help", "future", "family", "home", "jealous"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

// The scene each rung opens. "interested" is a feeling not yet said, so its
// scene is the companion seeking time alone; each rung after asks more of
// the character, as the bond can bear more.
export const STAGE_SCENE: Record<Exclude<RomanceStage, "none">, SceneKind> = {
  interested: "private_talk",
  courting: "asks_help",
  together: "future",
  betrothed: "family",
  married: "home",
};

// ---- tunables, in narrations (the GM's replies, AI or a person's) ----

// Replies after a step before its scene can come due: the step's own reply
// and the next one belong to the step, so the scene is not on its heels.
export const SCENE_AFTER_STEP = 2;
// Replies after one scene is played or let go before any other comes due at
// the table, so two romances at one table do not crowd every scene.
export const SCENE_COOLDOWN = 8;
// Replies a due scene is handed to the GM for before it passes unplayed.
export const SCENE_WINDOW = 3;
// Times a scene passes unplayed before it is let go for this rung, so a GM
// who does not take it up is not asked forever.
export const SCENE_LAPSES = 2;

// ---- what a pair keeps (relationships.pacing_json) ----

export type DueScene = {
  kind: SceneKind;
  // The rung it was due at; a step on or a slip back drops it.
  stage: RomanceStage;
  // Who the jealousy is about; "" for every other scene.
  rival: string;
  // Replies it has been handed to the GM for.
  handed: number;
};

export type Pacing = {
  // The clock (minutes) when the last step up was taken; null before any
  // step was recorded, which holds no next step back.
  steppedAt: number | null;
  // The newest narration's seq when that step was taken.
  steppedSeq: number;
  // sceneKey of every scene played or let go.
  played: string[];
  // Times each scene passed unplayed, by sceneKey.
  lapses: Record<string, number>;
  due: DueScene | null;
  // The narration's seq when this pair's last scene was played or let go;
  // 0 for none.
  endedSeq: number;
};

export const NO_PACING: Pacing = { steppedAt: null, steppedSeq: 0, played: [], lapses: {}, due: null, endedSeq: 0 };

export function sceneKey(stage: RomanceStage, kind: SceneKind): string {
  return `${stage}:${kind}`;
}

function isKind(raw: unknown): raw is SceneKind {
  return (SCENE_KINDS as readonly string[]).includes(String(raw));
}

const STAGES: readonly string[] = ["none", "interested", "courting", "together", "betrothed", "married"];

function count(raw: unknown): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export function parsePacing(raw: string): Pacing {
  if (!raw) {
    return NO_PACING;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const due = parsed.due as Record<string, unknown> | null | undefined;
    const lapses: Record<string, number> = {};
    for (const [key, value] of Object.entries((parsed.lapses as Record<string, unknown>) ?? {})) {
      if (count(value) > 0) {
        lapses[key.slice(0, 40)] = Math.min(count(value), 9);
      }
    }
    return {
      steppedAt: typeof parsed.steppedAt === "number" && Number.isFinite(parsed.steppedAt) ? Math.max(0, Math.round(parsed.steppedAt)) : null,
      steppedSeq: count(parsed.steppedSeq),
      played: Array.isArray(parsed.played) ? [...new Set(parsed.played.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.slice(0, 40)))].slice(-24) : [],
      lapses,
      due:
        due && isKind(due.kind) && STAGES.includes(String(due.stage))
          ? { kind: due.kind, stage: due.stage as RomanceStage, rival: typeof due.rival === "string" ? due.rival.slice(0, 80) : "", handed: count(due.handed) }
          : null,
      endedSeq: count(parsed.endedSeq),
    };
  } catch {
    return NO_PACING;
  }
}

// ---- jealousy ----

// Whether jealousy shows in this person. On main their nature is the six
// personality axes (npc-logic.ts): composure below zero is someone who lets
// a hurt show rather than keep it in. `openRelationship` is the seam for the
// trait issue 642 adds (open to an open relationship, beside "drawn to"):
// until it lands every romance is exclusive and the caller passes false.
export function jealousyShows(composure: number, openRelationship: boolean): boolean {
  return !openRelationship && composure < 0;
}

// ---- which scene a pair is owed ----

export type ScenePair = {
  relationshipId: string;
  character: string;
  subject: string;
  romance: RomanceStage;
  approval: number;
  pacing: Pacing;
  // In the scene with the character: a companion in the party, an NPC where
  // the party is or named in the reply just told.
  present: boolean;
  // Narrations since this pair's last step.
  sinceStep: number;
  composure: number;
  openRelationship: boolean;
  // The character's strongest other romantic interest, "" for none.
  rival: string;
};

export type OwedScene = { kind: SceneKind; stage: RomanceStage; rival: string };

// The scene this pair is owed at its rung, or null. A jealous moment comes
// first while there is a rival to feel it about (from courting up: before
// that nothing was said that a rival could threaten); then the rung's own
// scene; each once per rung.
export function sceneOwed(pair: Pick<ScenePair, "romance" | "pacing" | "composure" | "openRelationship" | "rival">): OwedScene | null {
  if (pair.romance === "none") {
    return null;
  }
  const done = new Set(pair.pacing.played);
  if (
    pair.rival &&
    romanceIndex(pair.romance) >= romanceIndex("courting") &&
    jealousyShows(pair.composure, pair.openRelationship) &&
    !done.has(sceneKey(pair.romance, "jealous"))
  ) {
    return { kind: "jealous", stage: pair.romance, rival: pair.rival };
  }
  const kind = STAGE_SCENE[pair.romance];
  return done.has(sceneKey(pair.romance, kind)) ? null : { kind, stage: pair.romance, rival: "" };
}

// The scene that comes due now, or null: none while another is due (one at
// a time), none until the cooldown after the last has run
// (`sinceLastScene` null: no scene yet at this table), and of the pairs in
// the scene whose step has had its replies, the one who feels most, then by
// name so a table always picks the same one.
export function pickScene(pairs: readonly ScenePair[], sinceLastScene: number | null): (ScenePair & { scene: OwedScene }) | null {
  if (pairs.some((pair) => pair.pacing.due)) {
    return null;
  }
  if (sinceLastScene !== null && sinceLastScene < SCENE_COOLDOWN) {
    return null;
  }
  let best: (ScenePair & { scene: OwedScene }) | null = null;
  for (const pair of pairs) {
    const scene = pair.present && pair.sinceStep >= SCENE_AFTER_STEP ? sceneOwed(pair) : null;
    if (!scene) {
      continue;
    }
    if (!best || pair.approval > best.approval || (pair.approval === best.approval && compareNames(pair.subject, best.subject) < 0)) {
      best = { ...pair, scene };
    }
  }
  return best;
}

// ---- reading a narration ----

export type SceneSpeaker = { kind?: string; id?: string; name: string };
export type SceneMessage = {
  content: string;
  speech?: ReadonlyArray<{ speaker: SceneSpeaker }> | null;
  speaker?: SceneSpeaker | null;
};

// Whether a narration played the scene: the subject speaks in it (a line of
// theirs, or the whole passage spoken as them; `ids` are their sheet and the
// row behind it), or one paragraph names both of them. A scene they start is
// them coming to the character, so either is how it reads on the page.
export function sceneTaken(message: SceneMessage, subject: { name: string; ids: readonly string[] }, character: string): boolean {
  const theirs = (speaker: SceneSpeaker | null | undefined) =>
    Boolean(speaker && ((speaker.id && subject.ids.includes(speaker.id)) || textKey(speaker.name) === textKey(subject.name)));
  if (theirs(message.speaker) || (message.speech ?? []).some((entry) => theirs(entry.speaker))) {
    return true;
  }
  return message.content.split(/\n+/).some((paragraph) => names(paragraph, subject.name) && names(paragraph, character));
}

export type DueVerdict = "played" | "lapsed" | "waiting";

// What a narration did to a due scene. Before it has been handed to the GM
// nothing counts; once handed, a narration that took it plays it, and one
// that let the window run out lets it pass.
export function readDue(due: DueScene, taken: boolean): DueVerdict {
  if (due.handed <= 0) {
    return "waiting";
  }
  if (taken) {
    return "played";
  }
  return due.handed >= SCENE_WINDOW ? "lapsed" : "waiting";
}

// The pair after its scene was played (`seq`: the narration it was played in).
export function afterPlayed(pacing: Pacing, seq: number): Pacing {
  if (!pacing.due) {
    return pacing;
  }
  const key = sceneKey(pacing.due.stage, pacing.due.kind);
  return { ...pacing, played: [...new Set([...pacing.played, key])], due: null, endedSeq: seq };
}

// The pair after its scene passed unplayed: counted, and let go for this
// rung once it has passed SCENE_LAPSES times. Either way the table's
// cooldown starts, so the next due scene is not the next reply.
export function afterLapse(pacing: Pacing, seq: number): Pacing {
  if (!pacing.due) {
    return pacing;
  }
  const key = sceneKey(pacing.due.stage, pacing.due.kind);
  const lapses = { ...pacing.lapses, [key]: (pacing.lapses[key] ?? 0) + 1 };
  const letGo = lapses[key] >= SCENE_LAPSES;
  return { ...pacing, lapses, played: letGo ? [...new Set([...pacing.played, key])] : pacing.played, due: null, endedSeq: seq };
}

// ---- what the GM is told, and what the bond remembers ----

function sceneWords(kind: SceneKind, character: string, rival: string): string {
  switch (kind) {
    case "private_talk":
      return `seeks ${character} out alone, to talk about something they keep from the others`;
    case "asks_help":
      return `asks ${character} for help with something of their own (an old debt, a letter home, a grave, a rival), small and personal`;
    case "future":
      return `talks with ${character} about what they want when this is over, and whether ${character} is in it`;
    case "family":
      return `wants ${character} to meet someone, or see somewhere, that matters to them before they wed`;
    case "home":
      return `talks with ${character} about the home they could make together`;
    case "jealous":
      return `is stung to see ${character} so close with ${rival || "someone else"}, and lets it show`;
  }
}

// The director note while it is due, at an AI table: short, and only while
// the scene allows it.
export function sceneNote(subject: string, character: string, stage: RomanceStage, scene: Pick<DueScene, "kind" | "rival">): string {
  return `${subject} starts a moment of their own with ${character} (${ROMANCE_LABEL[stage]}): ${subject} ${sceneWords(scene.kind, character, scene.rival)}. If the scene allows it, play it this reply in ${subject}'s own voice and let ${character}'s player answer; never decide how ${character} feels.`;
}

// The line on the Bonds tab for a person running the table.
export function sceneCard(subject: string, character: string, scene: Pick<DueScene, "kind" | "rival">): string {
  return `${subject} ${sceneWords(scene.kind, character, scene.rival)}. Play it when the scene allows: once ${subject} speaks in your narration, it is recorded.`;
}

// What the bond remembers once it was played (the Bonds tab's history, and
// the GAME STATE line's).
export function sceneMemory(subject: string, character: string, scene: Pick<DueScene, "kind" | "rival">): string {
  switch (scene.kind) {
    case "private_talk":
      return `${subject} sought ${character} out for a private talk`;
    case "asks_help":
      return `${subject} asked ${character} for help with something of their own`;
    case "future":
      return `${subject} talked with ${character} about what comes after`;
    case "family":
      return `${subject} wanted ${character} to meet someone who matters to them`;
    case "home":
      return `${subject} talked with ${character} about a home together`;
    case "jealous":
      return `${subject} was stung to see ${character} close with ${scene.rival || "someone else"}`;
  }
}
