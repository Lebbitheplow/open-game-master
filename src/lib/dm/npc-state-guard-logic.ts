// The narration held to the NPC state sheet (src/lib/dm/npc-state-logic.ts).
// The roster tells the narrator who is a prisoner, bound or down,
// and a rule asks it to call npc_state the moment that changes; a narrator
// can still forget both, which is how a prisoner was carried off in the prose
// while the record left him at the mill. So after a reply that names tracked
// NPCs, one utility read compares the prose with the record: a line the
// record makes impossible (a bound man swinging an axe, the unconscious
// answering, the party walking off without its prisoner) and a change the
// prose shows that no npc_state recorded. Either sends the narrator back once;
// a second answer stands, and a reader that fails finds nothing, so the guard
// never stops play.
//
// Dependency-free so scripts/test-npc-state.mjs can drive it.

import { containsPhrase, textKey } from "../language/text-logic.ts";

export type GuardPerson = { name: string; aliases: readonly string[]; record: string };

export type StateClash = { name: string; quote: string; problem: string };
export type StateUnrecorded = { name: string; change: string };
export type StateReading = { clashes: StateClash[]; unrecorded: StateUnrecorded[] };

// Words that show a body changing on screen, in the table languages the
// sheet's users play in. Only a prefilter: a narration with none of them and
// nobody already held or down costs no reader call.
const CHANGE_WORDS = [
  "legat", "slegat", " lega ", " lego ", "legò", "lega al", "stende", "catene", "catena", "incaten", "prigion", "cattur", "arrest", "svenut", "tramortit", "mort", "uccis",
  "liberat", "ferit", "disarm", "ammanett", "rinchius",
  "tied", "untie", "bound", "chain", "captive", "prisoner", "captur", "unconscious", "knocked out", "dead", "kill", "slain",
  "freed", "release", "wounded", "locked up", "shackle",
];

export function showsStateChange(narration: string): boolean {
  const text = ` ${textKey(narration)} `;
  return CHANGE_WORDS.some((word) => text.includes(word));
}

// The tracked people the narration names, by whole name or alias.
export function peopleNamed<T extends { name: string; aliases: readonly string[] }>(narration: string, people: readonly T[]): T[] {
  return people.filter((person) => [person.name, ...person.aliases].some((name) => name && containsPhrase(narration, name)));
}

// Whether the read is worth a call: someone named whose record is not the
// default, or a change shown in the prose, or the party on the move while it
// holds anyone.
export function stateGuardDue(input: { named: readonly GuardPerson[]; narration: string; partyMoved: boolean; partyHolds: boolean }): boolean {
  if (!input.named.length && !(input.partyMoved && input.partyHolds)) {
    return false;
  }
  return input.named.some((person) => person.record) || showsStateChange(input.narration) || (input.partyMoved && input.partyHolds);
}

export function stateReading(input: {
  narration: string;
  people: readonly GuardPerson[];
  calls: readonly string[];
  heroes: readonly string[];
}): { role: "system" | "user"; content: string }[] {
  const system = [
    "You compare a game master's narration with the server's record of each character's body. You never judge the story, the style or the rules.",
    "Report two things, only when they are clear:",
    "1. clashes: a passage where a person does what their record makes impossible: someone bound, chained or locked up using their hands, fighting or walking off freely; someone unconscious or dead speaking, hearing or acting; a prisoner of the party left behind when the party leaves, unless the narration says plainly that they are left. A description of them as the record says is no clash.",
    "2. unrecorded: a person whose body changes on screen in this narration (taken prisoner, tied, chained, locked up, freed, knocked out, killed, badly wounded, disarmed, setting out with the party or parting from it) when neither their record nor this turn's npc_state calls already say so.",
    "Player characters are never reported.",
    'Reply with JSON only: {"clashes":[{"name":"who","quote":"the exact words from the narration","problem":"what the record says, in a few words"}],"unrecorded":[{"name":"who","change":"what changed, in a few words"}]}. Nothing to report: {"clashes":[],"unrecorded":[]}.',
  ].join("\n");
  const user = [
    input.heroes.length ? `Player characters (never reported): ${input.heroes.join(", ")}` : "",
    `The record, for the people the narration names:\n${input.people.map((person) => `- ${person.name}: ${person.record || "free, on their feet"}`).join("\n")}`,
    input.calls.length ? `npc_state calls already made this turn:\n${input.calls.map((call) => `- ${call}`).join("\n")}` : "",
    `The narration to check:\n${input.narration}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// The reply, held to the people it was asked about and, for a clash, to
// words that are really in the narration. null when it cannot be read.
export function parseStateReading(reply: string, narration: string, people: readonly GuardPerson[]): StateReading | null {
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
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  if (!record || !Array.isArray(record.clashes) || !Array.isArray(record.unrecorded)) {
    return null;
  }
  const personOf = (name: unknown) =>
    typeof name === "string" ? people.find((person) => [person.name, ...person.aliases].some((known) => textKey(known) === textKey(name))) : undefined;
  const text = textKey(narration);
  const clashes: StateClash[] = [];
  for (const entry of record.clashes as unknown[]) {
    const { name, quote, problem } = (entry ?? {}) as Record<string, unknown>;
    const person = personOf(name);
    if (!person || typeof quote !== "string" || typeof problem !== "string" || textKey(quote).length < 3 || !text.includes(textKey(quote))) {
      continue;
    }
    clashes.push({ name: person.name, quote: quote.trim().slice(0, 200), problem: problem.trim().slice(0, 160) });
  }
  const unrecorded: StateUnrecorded[] = [];
  for (const entry of record.unrecorded as unknown[]) {
    const { name, change } = (entry ?? {}) as Record<string, unknown>;
    const person = personOf(name);
    if (!person || typeof change !== "string" || !change.trim() || unrecorded.some((seen) => seen.name === person.name)) {
      continue;
    }
    unrecorded.push({ name: person.name, change: change.trim().slice(0, 160) });
  }
  return { clashes: clashes.slice(0, 4), unrecorded: unrecorded.slice(0, 4) };
}

// The note that sends the narrator back once. A clash takes the narration
// back to be told again, corrected; a change alone keeps it and asks only for
// the calls.
export function stateGuardPrompt(reading: StateReading): string {
  const changes = reading.unrecorded.map((entry) => `- ${entry.name}: ${entry.change}`).join("\n");
  const clashes = reading.clashes.map((entry) => `- ${entry.name} (${entry.problem}). You wrote: "${entry.quote}"`).join("\n");
  return [
    "[Table note] The server's record of who is a prisoner, bound or down does not match your narration.",
    changes ? `The narration shows these changes, which no npc_state call recorded. Call npc_state for each now, with what really happened:\n${changes}` : "",
    clashes
      ? `These passages contradict the record:\n${clashes}\nIf the record is out of date because the story changed it, call npc_state to set it right. Then narrate this moment again in full, consistent with the record; your previous narration of it has been withdrawn.`
      : "Your narration stands: do not narrate it again.",
    "Do not mention this note.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
