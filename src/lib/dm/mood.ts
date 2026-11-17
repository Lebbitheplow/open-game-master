// The words reader (docs/specs/ogm-npc-perception.md §9.2.3): what was said
// to or about a mind this turn, read by a model into a closed list (an
// insult, a threat, a promise...), and from that the feelings by the fixed
// table. One short call per mind addressed; an unreadable answer is nothing.
import type { Campaign } from "@/lib/db/campaigns";
import { addMoodlets } from "@/lib/db/npc-moods";
import { getNpcById } from "@/lib/db/npcs";
import { wordsHeardInTurn } from "@/lib/db/scene-events";
import { requestDmMessage } from "@/lib/dm/model";
import { appraiseWords, parseWordReading, WORD_KINDS } from "@/lib/dm/mood-logic";
import { egoChoice, npcMindsOn } from "@/lib/dm/npc-mind";
import { replyJsonObject } from "@/lib/reply-json-logic";
import { clipText, textKey } from "@/lib/language/text-logic";
import { resolveTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

export const WORDS_READER_SYSTEM = [
  "You read words said in a scene of a tabletop role-playing game, to or about one character, and say what each line is TO THAT CHARACTER.",
  `For each numbered line give kind, one of: ${WORD_KINDS.join(", ")} (lie_caught: the character can tell the speaker lied to them; nothing: neutral talk, or not about them), and intensity 1 (mild), 2 or 3 (strong).`,
  'Answer with ONE JSON object and nothing else: {"readings": [{"n": 1, "kind": "insult", "intensity": 2}]}.',
].join("\n");

function addressed(name: string, event: { actor: string; targets: string[]; speech: string; outcome: string }): boolean {
  if (!name || textKey(event.actor) === textKey(name)) {
    return false;
  }
  const words = textKey(`${event.speech} ${event.outcome}`);
  const first = textKey(name).split(" ")[0];
  return event.targets.some((target) => textKey(target) === textKey(name)) || (first.length > 2 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(words));
}

export async function readWords(campaign: Campaign, turnId: string): Promise<void> {
  if (!npcMindsOn(campaign) || !turnId) {
    return;
  }
  const byMind = new Map<string, Array<{ speaker: string; words: string; instant: number }>>();
  for (const { npcId, event } of wordsHeardInTurn(campaign.id, turnId)) {
    const npc = getNpcById(npcId);
    if (!npc || !addressed(npc.name, event)) {
      continue;
    }
    const list = byMind.get(npcId) ?? [];
    list.push({ speaker: event.actor, words: clipText(event.speech || event.outcome, 300), instant: event.instant });
    byMind.set(npcId, list);
  }
  await Promise.all(
    [...byMind].map(async ([npcId, lines]) => {
      const npc = getNpcById(npcId);
      if (!npc) {
        return;
      }
      const prompt = [`The character: ${npc.name}.`, ...lines.slice(0, 8).map((line, index) => `${index + 1}. ${line.speaker}: «${line.words}»`)].join("\n");
      try {
        const result = await requestDmMessage(
          campaign.settings,
          [
            { role: "system", content: WORDS_READER_SYSTEM },
            { role: "user", content: prompt },
          ],
          { meta: { task: "npc_words_reader" }, timeoutMs: resolveTextTimeoutMs(undefined, "NPC_MIND_TIMEOUT_MS", 60_000), mindChoice: egoChoice() },
        );
        const parsed = result.error ? null : replyJsonObject(stripReasoningArtifacts(String(result.message?.content ?? "")));
        const readings = parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).readings) ? ((parsed as Record<string, unknown>).readings as unknown[]) : [];
        for (const raw of readings) {
          const index = Number((raw as Record<string, unknown>)?.n) - 1;
          const line = lines[index];
          if (line) {
            addMoodlets(campaign.id, npcId, appraiseWords(parseWordReading(raw), line.speaker, line.words, line.instant));
          }
        }
      } catch (caught) {
        console.warn(`[words-reader] ${npc.name}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }),
  );
}
