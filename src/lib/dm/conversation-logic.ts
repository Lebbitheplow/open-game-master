// A conversation in flight: someone in the scene spoke to the party in the
// last reply, and a player answered in words this turn. While it lasts the
// reply belongs to that exchange: the person answers what was asked, nothing
// cuts in (no fight, no arrival somewhere new, no director note), and the
// arc's open steps wait for a pause. A table asked an elder where the blight
// came from and got a monster through the door instead; that is what this
// stops. The story still moves on its own when play stalls (world-tick-logic.ts,
// the stall spark), never over somebody's question.
//
// Who spoke last is only a guess at who is being spoken to. A player who turned
// from a companion to a stranger ("Hey, you, what's your business here?") got
// the companion's answer, turn after turn, because the note said so; so the
// players' own words decide, and the last voice is what is left when they
// name nobody. Pure.

import { QUOTE, quotedText } from "./speech-prose.ts";

// What this module reads of a message and of its attributed lines
// (src/lib/db/messages.ts, src/lib/dm/speech.ts).
export type TalkSpeaker = { kind: string; id: string; name: string };
export type TalkMessage = {
  authorType: string;
  content: string;
  characterId?: string | null;
  speech?: ReadonlyArray<{ line: string; speaker: TalkSpeaker }>;
};

export type Conversation = {
  // Who spoke to the party last: a tracked NPC or an AI companion, or null
  // when the reply's last line is nobody the table has on record.
  with: string | null;
  // The characters whose players answered this turn, by name.
  answering: string[];
};

// Words said aloud or a question asked, in any table language: a quotation
// mark of any script, or a question mark.
const QUOTE_MARKS = /["“”„«»「」『』‹›]/u;
const QUESTION_MARKS = /[?？¿؟]/u;

export function spokenWords(text: string): boolean {
  return QUOTE_MARKS.test(text) || QUESTION_MARKS.test(text);
}

// The conversation the newest player lines continue, or null. `history` is
// oldest first; `companionIds` are the AI companions' sheet ids (a companion
// speaks as a `pc`, and is someone the party talks with); `names` maps a
// player's character id to the name the note gives them.
export function conversationInFlight(input: {
  history: readonly TalkMessage[];
  inEncounter: boolean;
  companionIds: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
}): Conversation | null {
  if (input.inEncounter) {
    return null;
  }
  let lastDm = -1;
  for (let index = input.history.length - 1; index >= 0; index -= 1) {
    if (input.history[index].authorType === "dm") {
      lastDm = index;
      break;
    }
  }
  if (lastDm < 0) {
    return null;
  }
  const lines = input.history.slice(lastDm + 1).filter((message) => message.authorType === "player");
  if (!lines.some((message) => spokenWords(message.content))) {
    return null;
  }
  // The reply's quoted lines in the order it says them, each with its stored
  // speaker. The stored lines cannot give the order: they run the reader's
  // first, then the structural reading's, and a reroll's hold every take
  // (mergeLines). A line nobody is on record for stays in the list: dropping
  // it made the person before it "who spoke last", so a stranger with no row
  // yet had their question answered by the companion they had just spoken over.
  const dm = input.history[lastDm];
  const speakers = new Map((dm.speech ?? []).map((line) => [line.line, line.speaker]));
  const voiceName = (speaker: TalkSpeaker | undefined) =>
    speaker && (speaker.kind === "npc" || (speaker.kind === "pc" && input.companionIds.has(speaker.id))) ? speaker.name : "";
  const said = [...dm.content.matchAll(QUOTE)]
    .map((match) => speakers.get(quotedText(match)))
    // A player's own character is no other side of the talk.
    .filter((speaker) => speaker?.kind !== "pc" || input.companionIds.has(speaker.id));
  if (!said.some(voiceName)) {
    return null;
  }
  const answering = [
    ...new Set(lines.map((message) => input.names.get(message.characterId ?? "") ?? "").filter(Boolean)),
  ];
  return { with: voiceName(said.at(-1)) || null, answering };
}

// The GAME STATE line for it.
export function conversationNote(conversation: Conversation): string {
  const who = conversation.answering.length ? conversation.answering.join(" and ") : "A player";
  const verb = conversation.answering.length > 1 ? "are" : "is";
  const other = conversation.with;
  const answer = "in their own voice: what they know, think or will do, said plainly";
  // "Whoever they name answers" read alone hands the GM a player's character
  // when one player speaks to another ("Bram, cover the door"): that answer
  // is the other player's to give, so the note says so where it says who.
  const notPlayers = "A player's character answers only through their own player: never write their reply.";
  const opening = other
    ? `IN CONVERSATION: ${who} ${verb} talking, and ${other} spoke last. ` +
      `Read the players' words first: whoever they name or call to answers first, not ${other}, and if they turn to something else, answer that. ` +
      `${notPlayers} ` +
      `If they turn to nobody else, this reply is ${other}'s answer, ${answer}. `
    : `IN CONVERSATION: ${who} ${verb} talking with someone in the scene. ` +
      `This reply is the answer of whoever the players' words are for, ${answer}. ` +
      `${notPlayers} `;
  // Said plainly that telling is no check: a note asking for "something the
  // party did not know" had both local models roll History for an elder's
  // memory and Persuasion for a companion asked to come along.
  return (
    opening +
    `What the one answering knows, thinks or will do is not a check: roll only for a player's own attempt, such as swaying someone unwilling or reading a lie. ` +
    `No fight starts and nobody arrives somewhere new in this reply unless the players' own words make it happen; if they set out, end on the way there. ` +
    `The arc's open waypoints wait for a pause in the talk.`
  );
}
