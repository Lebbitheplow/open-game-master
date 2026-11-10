// The utility model's reading of a player's words at a table that does not
// play in English (src/lib/dm/player-word-logic.ts reads English itself):
// do they ask for something the character does, do they keep the character
// where they stand, and do they turn an action down. Read once per set of words and kept, before a
// call that would spend or walk the character's turn (prepareWordFor), so
// the synchronous gates find it.

import { createHash } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { requestUtilityMessage } from "@/lib/dm/model";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import type { WordReading } from "@/lib/dm/player-word-logic";

// `declines` and `ends` are the English reading's turned-down action and end
// of turn in words (player-word-logic.ts englishDeclines, claims-logic.ts
// englishEndsTurn): asked only for acts and holds, a reader read "no vuelvo a
// atacar" as an act or as a question, and the turn ended or the GM was told
// the player only asked (issue 761). `ends` is its own answer because
// gpt-oss-20b, asked for declines, read "Ich greife nicht mehr an, ich beende
// meinen Zug" as no act.
const SYSTEM = `You read what a tabletop RPG player wrote for their own character during a fight, in any language, and answer with exactly one JSON object and nothing else: {"acts":true|false,"holds":true|false,"declines":true|false,"ends":true|false}.
acts: the words ask for something their character does now: an attack, a spell, a move, an action (dodge, dash, hide, help, ready), using an item or a feature, or ending their turn. A question about the scene, a remark, talk with other characters, or only saying what their character will not do is not acting.
holds: the words keep their character where they stand ("hold still", "I stay put", "I don't move", "I wait here", "I stand my ground"). Holding a door or casting Hold Person is not a hold.
declines: the words say their character will not do an action ("I won't attack again", "no more spells").
ends: the words end their turn now ("I end my turn", "that's my turn", "I'm done").`;

const readings = new Map<string, WordReading>();
const MAX_KEPT = 200;

function keyOf(campaign: Campaign, text: string): string {
  const route = campaign.settings;
  return createHash("sha1")
    .update(JSON.stringify([campaign.id, route.utilityProvider, route.utilityModel, route.textProvider, route.customModel, route.localTextModel, text]))
    .digest("hex");
}

export function parseWordReading(reply: string): WordReading | null {
  const found = stripReasoningArtifacts(reply).match(/\{[\s\S]*\}/);
  if (!found) {
    return null;
  }
  try {
    const parsed = JSON.parse(found[0]) as Record<string, unknown>;
    return typeof parsed.acts === "boolean" && typeof parsed.holds === "boolean" ? { acts: parsed.acts, holds: parsed.holds, declines: parsed.declines === true, ends: parsed.ends === true }
      : null;
  } catch {
    return null;
  }
}

// The kept reading of these words, or null when none was made.
export function keptWordReading(campaign: Campaign, text: string): WordReading | null {
  return readings.get(keyOf(campaign, text)) ?? null;
}

// Reads the words once and keeps the reading. A failed or unreadable call
// keeps nothing: the gates then fall back to the line-by-line rules.
export async function readWords(campaign: Campaign, text: string): Promise<WordReading | null> {
  const key = keyOf(campaign, text);
  const kept = readings.get(key);
  if (kept) {
    return kept;
  }
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Player's words:\n${text.slice(0, 2000)}` },
    ],
    { meta: { task: "player_word" }, timeoutMs: arcTextTimeoutMs(), thinking: false, temperature: 0 },
  );
  if (error) {
    console.error("[player-word] the reader call failed; the words are read line by line");
    return null;
  }
  const reading = parseWordReading(String(message?.content ?? ""));
  if (reading) {
    if (readings.size >= MAX_KEPT) {
      readings.delete(readings.keys().next().value as string);
    }
    readings.set(key, reading);
  }
  return reading;
}
