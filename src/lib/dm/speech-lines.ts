// Who speaks each quoted line of a DM message, decided when the message is
// written and stored with it (src/lib/dm/speech.ts SpokenLine). Text a person
// wrote is read from its structure, with English pronouns at an English
// table; text a model wrote is read by the claims reader first
// (src/lib/dm/claims.ts), in any language, and from its structure for the
// lines the reader leaves out. Every read here happens outside any
// transaction.

import type { Campaign } from "@/lib/db/campaigns";
import { listRecentMessages } from "@/lib/db/messages";
import { getNpcByName, standsBehindLiveCompanion } from "@/lib/db/npcs";
import { registerSpeakingNpc } from "@/lib/dm/social-tools";
import { listSheets } from "@/lib/db/sheets";
import { guardOutcomes } from "@/lib/dm/engine-boundary";
import { liveStateFor, readClaims, speakerRoster } from "@/lib/dm/claims";
import { commonWords, textKey } from "@/lib/language/text-logic";
import { attributeSpeech, confirmedNewcomer, hasQuotedLine, linesOf, mergeLines, storedSpeaker, unlistedSpeakerLines, type Speaker, type SpokenLine } from "@/lib/dm/speech";
import { keyOf } from "@/lib/dm/speech-prose";

// How many of the latest messages commonWords reads: a fixed window, so its
// cost never grows with the campaign.
const COMMON_WORDS_MESSAGES = 80;

// The table a passage is read for: the story plan rides along when the caller
// has it, so its cast may speak before they are registered (claims.ts
// speakerRoster).
type Table = Pick<Campaign, "id" | "gameSettings"> & Partial<Pick<Campaign, "storyArc">>;

// Who may speak at the table and the words its story uses, as the
// structural reading reads them. Built once for a run of passages (a re-read,
// src/lib/dm/speech-reread.ts), since it reads the sheets, the fight and the
// recent story.
export type StructuralReading = ReturnType<typeof structuralReading>;

export function structuralReading(campaign: Table) {
  const sheets = listSheets(campaign.id);
  const creatures = new Map([...guardOutcomes([], liveStateFor(campaign.id), campaign.gameSettings.tableLanguage).creatures].map(([ref, fact]) => [ref, fact.display]));
  const recent = listRecentMessages(campaign.id, COMMON_WORDS_MESSAGES)
    .filter((message) => message.authorType === "dm")
    .map((message) => message.content);
  return {
    speakers: [...speakerRoster(campaign.id, sheets, creatures, [], campaign.storyArc ?? null).values()],
    options: { common: commonWords(recent), englishPronouns: campaign.gameSettings.tableLanguage === "english" },
  };
}

// Every line's speaker as stored: an id-less NPC (a name the reply registered,
// one of the story plan's cast, or a newcomer the prose confirmed) is found by
// name now that the reply's tools have run, and a planned cast member or a
// confirmed newcomer nobody registered is registered here, as set_npc would
// have: without a row the line had a name and nothing else, no face, no voice,
// no place among the people (issue 1027). Any other id-less speaker stays as
// read.
export function seated(campaign: Table, lines: readonly SpokenLine[]): SpokenLine[] {
  return lines.map((entry) => {
    const { speaker } = entry;
    if (speaker.kind !== "npc" || speaker.id) {
      return entry;
    }
    const found = getNpcByName(campaign.id, speaker.name);
    if (found) {
      return standsBehindLiveCompanion(found) ? { line: entry.line, speaker: storedSpeaker(speaker) } : { line: entry.line, speaker: { kind: "npc", id: found.id, name: found.name } };
    }
    const planned = campaign.storyArc?.cast.some((cast) => cast.status !== "gone" && textKey(cast.name) === textKey(speaker.name));
    if (!planned && !speaker.proposed) {
      return entry;
    }
    const npc = registerSpeakingNpc({ id: campaign.id, storyArc: campaign.storyArc ?? null }, speaker.name);
    return { line: entry.line, speaker: { kind: "npc", id: npc.id, name: npc.name } };
  });
}

// The lines the structural reading finds, before anyone is seated.
export function readLines(campaign: Table, text: string, reading?: StructuralReading): SpokenLine[] {
  if (!hasQuotedLine(text)) {
    return [];
  }
  const { speakers, options } = reading ?? structuralReading(campaign);
  return linesOf(attributeSpeech(text, speakers, options));
}

// Person-written text: the human DM's narration, a beat, an edit, an
// accepted rewrite. No model call.
export function personLines(campaign: Table, text: string): SpokenLine[] {
  return seated(campaign, readLines(campaign, text));
}

// Model-written text outside a turn (a reroll, a continued scene, an
// expanded beat): one read asking only who speaks, made only when the text
// quotes somebody.
export async function modelLines(campaign: Campaign, text: string, label: string): Promise<SpokenLine[]> {
  if (!hasQuotedLine(text)) {
    return [];
  }
  const claims = await readClaims(campaign, {
    label,
    text,
    kinds: ["speaker"],
    outcomes: guardOutcomes([], liveStateFor(campaign.id), campaign.gameSettings.tableLanguage),
    sheets: listSheets(campaign.id),
  });
  return modelTextLines(
    campaign,
    text,
    claims.flatMap((claim) => (claim.kind === "speaker" ? [{ line: claim.line, speaker: claim.speaker }] : [])),
  );
}

// The lines of model-written text as stored: the reader's speakers, then
// the structural reading for any line the reader left out (a line its tag
// splits in two, say), which also stands in when the read failed. The
// structural reading never gives a model's line to a party character: the
// DM does not speak for one (src/lib/dm/prompt.ts), and on recorded
// narration nearly every line it gave the wrong person went to a party
// character named beside the speaker. The reader did the same with a newcomer
// who had no row yet: offered only the player they were talking to, it put
// the newcomer's line under that player's name. So it gives a player's
// character a line only where the words around it say so too; an AI companion,
// who does speak, needs no such check. A speaker the reply itself registered
// had no row when it was read, and is found by name now that its tools have
// run.
export function modelTextLines(campaign: Table, text: string, read: readonly SpokenLine[]): SpokenLine[] {
  const sheets = listSheets(campaign.id);
  // Seated once, below, so nobody is registered for a line the reader gave
  // to someone else.
  const fromWords = readLines(campaign, text);
  // A line the prose gives to someone the table does not list is the
  // reader's to give only to a person its paragraph names: offered a scene
  // with a companion in it, the reader put "The heir. Give us the fragment"
  // on him, after "The lead cultist raises a hand" (issue 965).
  const reading = read.length && hasQuotedLine(text) ? structuralReading(campaign) : null;
  // A newcomer the reader named is theirs only once the prose agrees
  // (speech.ts confirmedNewcomer). The check above is not asked of them: it
  // keeps a stranger's line off a listed person, and a newcomer the prose
  // confirmed is that stranger.
  const confirmed = (entry: SpokenLine) =>
    reading !== null && confirmedNewcomer(text, entry.line, entry.speaker.name, reading.speakers, reading.options);
  const strangers = reading ? unlistedSpeakerLines(text, reading.speakers, reading.options) : new Map<string, Set<string>>();
  const guessed = (entry: SpokenLine) => {
    const named = strangers.get(entry.line);
    return named !== undefined && !named.has(keyOf(entry.speaker)) && !named.has(textKey(entry.speaker.name));
  };
  const mayTake = (sheetId: string, line: string) =>
    sheets.some((sheet) => sheet.id === sheetId && sheet.isCompanion) ||
    fromWords.some((entry) => entry.line === line && entry.speaker.id === sheetId);
  const resolved = read.flatMap(({ line, speaker }): SpokenLine[] => {
    if (speaker.proposed) {
      return confirmed({ line, speaker }) ? [{ line, speaker: { ...storedSpeaker(speaker), proposed: true } }] : [];
    }
    if (speaker.kind === "pc") {
      return mayTake(speaker.id, line) ? [{ line, speaker: storedSpeaker(speaker) }] : [];
    }
    if (speaker.kind !== "npc" || speaker.id) {
      return [{ line, speaker: storedSpeaker(speaker) }];
    }
    // A companion in the party speaks as their sheet, never as their row.
    const found = getNpcByName(campaign.id, speaker.name);
    const npc = found && !standsBehindLiveCompanion(found) ? found : null;
    if (npc) {
      return [{ line, speaker: { kind: "npc", id: npc.id, name: npc.name } }];
    }
    const sheet = sheets.find((entry) => textKey(entry.name) === textKey(speaker.name));
    if (sheet && !mayTake(sheet.id, line)) {
      return [];
    }
    return [{ line, speaker: sheet ? { kind: "pc", id: sheet.id, name: sheet.name } : storedSpeaker(speaker) }];
  }).filter((entry) => entry.speaker.proposed || !guessed(entry));
  // A confirmed newcomer's other lines, the ones the prose carries on to them
  // ("...," says Tomas. He nods. "..."), read with them known, so every line
  // of theirs lands with their face and voice.
  const newcomers = [...new Map(resolved.filter((entry) => entry.speaker.proposed).map((entry) => [textKey(entry.speaker.name), entry.speaker])).values()];
  const theirs =
    reading && newcomers.length
      ? linesOf(attributeSpeech(text, [...reading.speakers, ...newcomers], reading.options)).filter((entry) => newcomers.some((newcomer) => textKey(newcomer.name) === textKey(entry.speaker.name)))
      : [];
  return seated(
    campaign,
    mergeLines(
      mergeLines(resolved, theirs.map((entry) => ({ line: entry.line, speaker: { ...entry.speaker, proposed: true } }))),
      fromWords.filter((entry) => entry.speaker.kind !== "pc"),
    ),
  );
}

// The lines of a passage the human DM or an agent program narrates: none
// when it is spoken as one person, who has no lines of anyone else's; the
// reader's for an agent program's prose; a person's prose read from its
// words.
export function narratedLines(
  campaign: Table,
  text: string,
  from: { speaker: Speaker | null; agentLines: SpokenLine[] | null },
): SpokenLine[] {
  if (from.speaker) {
    return [];
  }
  return from.agentLines ?? personLines(campaign, text);
}
