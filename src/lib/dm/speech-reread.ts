// Lines already in the transcript that went to nobody, read again from their
// words once the table knows more people (issue 1027). Who speaks a line is
// decided when its message is written (src/lib/dm/speech-lines.ts), against the
// people the table knew then, and never re-read: a named NPC the narrator
// brought on without registering kept a plain line after they were
// registered, and every message written before a better reading kept the
// older one. Two runs read them again:
//
// - once a server start, the first time a campaign's table is opened, the
//   whole transcript (scheduleSpeakerBackfill);
// - when a name joins the cast (src/lib/dm/cast.ts), the messages that hold
//   that name (rereadSpeakers with names).
//
// Only a line nobody speaks is read, by the structural reading alone (no model
// call), and a line it gives nobody stays as it was. A line already stored
// keeps its speaker: a person or a reader chose it. A party character is never
// given a line here, as the structural reading never gives one a model's line,
// and a passage spoken as one person holds nobody else's.

import { getCampaignById } from "@/lib/db/campaigns";
import { getCampaignMessage, listAllMessages, setMessageSpeech, type CampaignMessage } from "@/lib/db/messages";
import { publishPersisted } from "@/lib/events";
import { mergeLines } from "@/lib/dm/speech";
import { QUOTE, quotedText } from "@/lib/dm/speech-prose";
import { readLines, seated, structuralReading, type StructuralReading } from "@/lib/dm/speech-lines";
import { textKey } from "@/lib/language/text-logic";

// Messages read between yields to the event loop: a long transcript is read
// without holding up a turn.
const BATCH = 25;

// Whether a message holds a quoted line nobody speaks.
function hasUnspokenLine(message: CampaignMessage): boolean {
  const spoken = new Set((message.speech ?? []).map((entry) => entry.line));
  return [...message.content.matchAll(QUOTE)].some((match) => !spoken.has(quotedText(match)));
}

// One message read again, written and sent to the open seats when a line
// found its speaker. Read and written in one synchronous step, so nothing
// written between them is lost.
function rereadMessage(campaign: NonNullable<ReturnType<typeof getCampaignById>>, messageId: string, reading: StructuralReading): boolean {
  const message = getCampaignMessage(messageId);
  if (!message || message.authorType !== "dm" || message.speaker || !hasUnspokenLine(message)) {
    return false;
  }
  const stored = message.speech ?? [];
  const known = new Set(stored.map((entry) => entry.line));
  const fresh = readLines(campaign, message.content, reading).filter((entry) => entry.speaker.kind !== "pc" && !known.has(entry.line));
  if (!fresh.length) {
    return false;
  }
  const updated = setMessageSpeech(message.id, message.content, mergeLines(stored, seated(campaign, fresh)));
  if (!updated) {
    return false;
  }
  publishPersisted(campaign.id, "message_updated", { message: updated });
  return true;
}

// The campaign's GM messages read again, or only those that hold one of
// `names`. Resolves to how many messages gained a speaker.
export async function rereadSpeakers(campaignId: string, names: readonly string[] | null = null): Promise<number> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return 0;
  }
  const keys = names?.map(textKey).filter(Boolean) ?? null;
  if (keys && !keys.length) {
    return 0;
  }
  const ids = listAllMessages(campaignId)
    .filter((message) => message.authorType === "dm" && !message.speaker && hasUnspokenLine(message))
    .filter((message) => !keys || keys.some((key) => textKey(message.content).includes(key)))
    .map((message) => message.id);
  if (!ids.length) {
    return 0;
  }
  const reading = structuralReading(campaign);
  let changed = 0;
  for (let start = 0; start < ids.length; start += BATCH) {
    if (start > 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const id of ids.slice(start, start + BATCH)) {
      if (rereadMessage(campaign, id, reading)) {
        changed += 1;
      }
    }
  }
  return changed;
}

declare global {
  var __odmSpeechBackfilled: Set<string> | undefined;
}

// The whole transcript read again, once a server start, when the table is
// first opened: an upgraded server's older messages, and any a reading since
// improved on, find the speakers the table now knows.
export function scheduleSpeakerBackfill(campaignId: string): void {
  const done = (globalThis.__odmSpeechBackfilled ??= new Set<string>());
  if (done.has(campaignId)) {
    return;
  }
  done.add(campaignId);
  setImmediate(() => {
    rereadSpeakers(campaignId)
      .then((changed) => {
        if (changed) {
          console.log(`[speech] ${campaignId}: ${changed} earlier message(s) found their speakers`);
        }
      })
      .catch((error: unknown) => {
        console.error(`[speech] ${campaignId}: the transcript was not read again (${error instanceof Error ? error.message : "error"})`);
      });
  });
}
