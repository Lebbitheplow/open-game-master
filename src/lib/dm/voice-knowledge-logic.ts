// The narrator voices most of the world's people itself: a guard at a
// barrier, a clerk, a passer-by. Only first-tier minds and companions speak
// through their own isolated model (src/lib/dm/npc-mind.ts npc_speak). The
// narrator knows the whole story, so a line it writes for someone can carry
// what only the narrator knows: a sentinel who never saw the wagon told a
// traveller who arrived alone to "go back to your people" and warned about
// "the wagon's problem" (docs/specs/ogm-npc-isolation-design.md, "Voices the
// narrator writes").
//
// This file is the pure half of that check: which quoted lines are the
// narrator's own, the reading a utility model is asked, and the ruling on
// its reply. A leak names one quoted phrase; the narration guard
// (src/lib/dm/narration-guard.ts) asks the narrator to rewrite it, once.

import { QUOTE, quotedText } from "@/lib/dm/speech-prose";
import type { Contradiction } from "@/lib/dm/engine-boundary";

export const MAX_LEAKS = 4;
const TRANSCRIPT_MESSAGES = 12;
const MESSAGE_CHARS = 900;
const PROFILE_PEOPLE = 8;
const PROFILE_MEMORIES = 12;

export type Leak = { speaker: string; quote: string; fact: string };

export type VoicedPerson = {
  name: string;
  role: string;
  trait: string;
  location: string;
  // What their mind holds, when they have one (npc_memories), newest last.
  memories: readonly string[];
};

export type TranscriptLine = { author: "player" | "narration"; who: string; text: string };

const key = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// The quoted lines of a narration, as written.
export function quotedLines(narration: string): string[] {
  return [...narration.matchAll(QUOTE)].map((match) => quotedText(match).trim()).filter(Boolean);
}

// What the minds said this turn: the "says" of every npc_speak result in the
// turn's conversation. Those words came from a model that knows only the
// speaker's own past; they are never the narrator's leak.
export function mindSpeeches(conversation: readonly { role: string; content?: unknown; tool_calls?: unknown }[]): string[] {
  const speakIds = new Set<string>();
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) {
      continue;
    }
    for (const call of message.tool_calls as { id?: string; function?: { name?: string } }[]) {
      if (call?.function?.name === "npc_speak" && call.id) {
        speakIds.add(call.id);
      }
    }
  }
  const out: string[] = [];
  for (const message of conversation as { role: string; content?: unknown; tool_call_id?: string }[]) {
    if (message.role !== "tool" || !message.tool_call_id || !speakIds.has(message.tool_call_id) || typeof message.content !== "string") {
      continue;
    }
    try {
      const parsed = JSON.parse(message.content) as { says?: unknown; result?: { says?: unknown } };
      const says = parsed.says ?? parsed.result?.says;
      if (typeof says === "string" && says.trim()) {
        out.push(says.trim());
      }
    } catch {
      // A tool result that is not JSON said nothing a mind wrote.
    }
  }
  return out;
}

// The quoted lines the narrator wrote itself: every line but those a mind
// said (wholly or in part, since the narrator may split a mind's words).
export function narratorLines(narration: string, minds: readonly string[]): string[] {
  const said = minds.map(key).filter(Boolean);
  return quotedLines(narration).filter((line) => {
    const words = key(line);
    return !said.some((speech) => speech.includes(words) || words.includes(speech));
  });
}

// The minds' lines a rewrite of the narration lost: each one the narration
// held that the rewrite no longer does. A mind's words are its own turn
// (npc_speak); asked to fix the narrator's line beside one, the rewrite
// dropped Nera's whole answer and the table read only the line it fixed.
export function droppedMindLines(before: string, after: string, minds: readonly string[]): string[] {
  const held = key(before);
  const kept = key(after);
  return minds.filter((speech) => {
    const words = key(speech);
    return Boolean(words) && held.includes(words) && !kept.includes(words);
  });
}

const clip = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, chars - 1)}…` : text);

// The reading the utility model is asked. The transcript is the evidence of
// what was said and shown where the speaker stood; the profile is what their
// own life lets them know.
export function knowledgeReading(input: {
  narration: string;
  lines: readonly string[];
  transcript: readonly TranscriptLine[];
  people: readonly VoicedPerson[];
  heroes: readonly string[];
}): { role: "system" | "user"; content: string }[] {
  const transcript = input.transcript
    .slice(-TRANSCRIPT_MESSAGES)
    .map((line) => `[${line.author === "player" ? `Player character ${line.who || ""}`.trim() : "Narration"}] ${clip(line.text, MESSAGE_CHARS)}`)
    .join("\n\n");
  const people = input.people.slice(0, PROFILE_PEOPLE).map((person) => {
    const facts = [person.role && `role: ${person.role}`, person.trait && `trait: ${person.trait}`, person.location && `place: ${person.location}`]
      .filter(Boolean)
      .join("; ");
    const mind = person.memories.slice(-PROFILE_MEMORIES).map((memory) => `  - ${clip(memory, 240)}`);
    return [`- ${person.name}${facts ? ` (${facts})` : ""}`, ...(mind.length ? ["  what they have learned:", ...mind] : [])].join("\n");
  });
  const system = [
    "You check what characters voiced by a game master could know. You never judge the story, the style or the rules.",
    "A non-player character knows only: what any person of their role, place and world would know; what they saw or heard themselves in the scenes they were in; and what someone told them. They do not know what the narration shows out of their sight, what the player characters did elsewhere, who travels with the player characters unless they saw or were told, or anything only the game master knows.",
    "A guess, a question or a warning phrased as a possibility is allowed: flag only what a speaker states or takes for granted as known.",
    "Never flag a player character's own words, nor words a speaker repeats from what was said to them.",
    'Reply with JSON only: {"leaks":[{"speaker":"who says it","quote":"the exact words from their quoted line","fact":"what they could not know, in a few words"}]}. Quote the shortest exact phrase that carries the fact. No leaks: {"leaks":[]}.',
  ].join("\n");
  const user = [
    input.heroes.length ? `Player characters (never flagged): ${input.heroes.join(", ")}` : "",
    people.length ? `People of the world who may be speaking:\n${people.join("\n")}` : "",
    transcript ? `The scene so far, oldest first:\n${transcript}` : "",
    `The narration to check:\n${input.narration}`,
    `The quoted lines to check (the game master wrote these; any other quoted words are not to be flagged):\n${input.lines.map((line) => `- «${line}»`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// The reply, held to the lines it was asked about: a quote that is not part
// of one of them is the reader's invention and counts for nothing. Null when
// the reply cannot be read at all.
export function parseLeaks(reply: string, lines: readonly string[]): Leak[] | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (parsed as { leaks?: unknown })?.leaks;
  if (!Array.isArray(list)) {
    return null;
  }
  const keyed = lines.map(key);
  const out: Leak[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const { speaker, quote, fact } = entry as Record<string, unknown>;
    if (typeof quote !== "string" || typeof fact !== "string") {
      continue;
    }
    const words = key(quote.replace(/^[«“"„»\s]+|[»”"“«\s]+$/g, ""));
    if (words.length < 3 || !keyed.some((line) => line.includes(words)) || seen.has(words)) {
      continue;
    }
    seen.add(words);
    out.push({ speaker: typeof speaker === "string" ? speaker.trim().slice(0, 120) : "", quote: quote.trim().slice(0, 300), fact: fact.trim().slice(0, 300) });
    if (out.length >= MAX_LEAKS) {
      break;
    }
  }
  return out;
}

// A leak as the guard's contradiction: its detail is the narrator's
// correction note.
export function leakContradiction(leak: Leak): Contradiction {
  const who = leak.speaker || "This speaker";
  return {
    kind: "knowledge",
    clause: leak.quote,
    detail: `${who} cannot know ${leak.fact.replace(/\.$/, "")}: they never saw it and nobody told them`,
  };
}

// The rewrite note for leaks, beside the engine's own (engine-boundary.ts
// buildCorrectionPrompt).
export function knowledgeCorrectionPrompt(leaks: readonly Contradiction[]): string {
  const lines = leaks.map((entry) => `- ${entry.detail}. You wrote: "${entry.clause}"`).join("\n");
  return `[System] A character you voiced says something they cannot know: only you, the narrator, know it.
${lines}
Rewrite the whole narration so each of them says only what they saw, heard or were told, or what anyone of their role and place would know; a guess may stay if it is plainly a guess. Keep everything else: the same scene, the same length, the same voice, the same closing beat, and every other character's lines word for word. Do not call any tool, do not mention this correction, and reply with the corrected narration only.`;
}
