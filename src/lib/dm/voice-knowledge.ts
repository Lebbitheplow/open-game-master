// The DB/model rim of the voice-knowledge check (the pure half and the why
// are in src/lib/dm/voice-knowledge-logic.ts): who may be speaking, the
// scene so far, one utility read, and the leaks it found as the narration
// guard's contradictions.
//
// Asked only when the table keeps both the outcome check and the NPC minds
// on, and only for quoted lines the narrator wrote itself. A read that fails
// finds nothing: a missed leak costs a line of dialogue, a wrong rewrite
// costs the scene.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { listRecentMessages } from "@/lib/db/messages";
import { listNpcMemories } from "@/lib/db/npc-minds";
import { listNpcs } from "@/lib/db/npcs";
import { searchKey } from "@/lib/language/text-logic";
import type { Contradiction } from "@/lib/dm/engine-boundary";
import { requestUtilityMessage } from "@/lib/dm/model";
import {
  knowledgeReading,
  leakContradiction,
  mindSpeeches,
  narratorLines,
  parseLeaks,
  type TranscriptLine,
  type VoicedPerson,
} from "@/lib/dm/voice-knowledge-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

export type LeakReader = (messages: { role: "system" | "user"; content: string }[]) => Promise<string | null>;


// A person is in the reading when a word of their name (or an alias), or
// their role, appears in the narration or the scene: "la sentinella" finds
// "Sentinella del cordone".
function peopleIn(campaign: Campaign, text: string): VoicedPerson[] {
  const haystack = searchKey(text);
  const words = (value: string) => searchKey(value).split(" ").filter((word) => word.length >= 4);
  const out: VoicedPerson[] = [];
  for (const npc of listNpcs(campaign.id)) {
    const names = [npc.name, ...npc.aliases, npc.role];
    if (!names.some((name) => words(name).some((word) => haystack.includes(word)))) {
      continue;
    }
    out.push({
      name: npc.name,
      role: npc.role,
      trait: npc.trait,
      location: npc.location,
      memories: listNpcMemories(campaign.id, npc.id).map((memory) => memory.content),
    });
  }
  return out;
}

function transcriptOf(campaign: Campaign, sheets: readonly CharacterSheet[]): TranscriptLine[] {
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  return listRecentMessages(campaign.id, 12)
    .filter((message) => message.authorType !== "system" && message.content.trim())
    .map((message) => ({
      author: message.authorType === "player" ? ("player" as const) : ("narration" as const),
      who: message.characterId ? (names.get(message.characterId) ?? "") : "",
      text: message.content,
    }));
}

const utilityReader =
  (campaign: Campaign, turn: DmTurn): LeakReader =>
  async (messages) => {
    const { message, error } = await requestUtilityMessage(campaign.settings, messages, {
      meta: { task: "voice_knowledge", turnId: turn.id },
      timeoutMs: arcTextTimeoutMs(),
      thinking: false,
      temperature: 0,
    });
    return error ? null : stripReasoningArtifacts(String(message?.content ?? ""));
  };

export function voiceKnowledgeOn(campaign: Campaign): boolean {
  // The same switch as npc-mind.ts npcMindsOn, read here so the guard does
  // not import the minds' module (and its tools) into its own.
  return Boolean(campaign.gameSettings.narrationGuard) && Boolean(campaign.gameSettings.npcMinds);
}

// The leaks in a narration, as contradictions for the guard.
export async function readVoiceLeaks(
  campaign: Campaign,
  turn: DmTurn,
  sheets: readonly CharacterSheet[],
  narration: string,
  read: LeakReader = utilityReader(campaign, turn),
): Promise<Contradiction[]> {
  if (!voiceKnowledgeOn(campaign)) {
    return [];
  }
  const lines = narratorLines(narration, mindSpeeches(turn.conversation));
  if (!lines.length) {
    return [];
  }
  const transcript = transcriptOf(campaign, sheets);
  const people = peopleIn(campaign, [narration, ...transcript.slice(-4).map((line) => line.text)].join("\n"));
  const reply = await read(knowledgeReading({ narration, lines, transcript, people, heroes: sheets.map((sheet) => sheet.name) }));
  if (reply === null) {
    console.warn(`[voice-knowledge] turn ${turn.id}: the reader call failed; nothing was checked`);
    return [];
  }
  const leaks = parseLeaks(reply, lines);
  if (leaks === null) {
    console.warn(`[voice-knowledge] turn ${turn.id}: the reader's reply was unreadable; nothing was checked`);
    return [];
  }
  if (leaks.length) {
    console.warn(`[voice-knowledge] turn ${turn.id}: ${leaks.length} voiced line(s) say what the speaker cannot know`);
  }
  return leaks.map(leakContradiction);
}
