// The stage (docs/specs/ogm-npc-ego.md): the server gives every first-tier
// mind in the scene its turn, tells it what it perceives, and has each action
// judged at once by a referee with one small task. The narrator then only
// tells what was decided. Pure rules; npc-stage.ts runs them.
//
// One narrator doing all of it chose two or three of seven castaways a turn,
// left their actions "about to happen" and never said who drank (the raft
// sandbox, 2026-11-16).
import { clipText, compareNames, textKey } from "@/lib/language/text-logic";
import { replyJsonObject } from "@/lib/reply-json-logic";
import { SCENE_VERBS } from "@/lib/dm/scene-events-logic";

// Who goes first rotates with the turn, so the same mind does not always
// act on a scene the others have not touched yet.
export function stageOrder<T extends { name: string }>(minds: readonly T[], turnCount: number): T[] {
  const sorted = [...minds].sort((a, b) => compareNames(a.name, b.name));
  if (!sorted.length) {
    return sorted;
  }
  const start = ((turnCount % sorted.length) + sorted.length) % sorted.length;
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

// What the players said and did this turn, in their own words: the stage's
// first input. The narrator's prose is its retelling, and a retelling can
// leave out a hero's deed, or call a request still pending, and then nobody
// on stage ever answers it (the rum Brakk asked of Mairon, 2026-11-16).
export type HeroLine = { name: string; text: string };

function heroLinesBlock(lines: readonly HeroLine[], heading: string): string {
  const kept = lines.filter((line) => line.name.trim() && line.text.trim());
  return kept.length ? `${heading}\n${kept.map((line) => `- ${line.name}: ${clipText(line.text, 500)}`).join("\n")}` : "";
}

// What a mind perceives at its turn: what the heroes did and asked, what the
// table was just told, and what the minds before it did, as it ended.
export function stageSenses(narration: string, facts: readonly string[], heroes: readonly HeroLine[] = []): string {
  return [
    heroLinesBlock(
      heroes,
      "What the heroes just did and said, in their own words (what they attempt; how it ended is told below, or is yours to answer if it was asked of you or done to you or your things):",
    ),
    narration ? `What just happened around you:\n${clipText(narration, heroes.length ? 1000 : 1200)}` : "",
    facts.length ? `Since then, in this same moment (it already happened):\n${facts.map((fact) => `- ${fact}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1990);
}

export type StagePerson = { name: string; state: string; carries: string[]; hero?: boolean };

export const STAGE_REFEREE_SYSTEM = [
  "You are the referee of one action in a tabletop role-playing game. One character attempts something; you decide what it takes and what happens either way. The server rolls the die and picks the branch: you never choose the result.",
  "You are not an author and not a censor: violence, theft, threats and cruelty are judged like anything else. Do not soften an action and do not add events nobody attempted.",
  "uncertain: false when nothing opposes the action and it cannot fail (drinking from an open barrel, speaking, handing over one's own thing, opening a lock with its key). True when someone resists or it is hard (taking a thing from a person, forcing a lock, striking, hiding something under watching eyes).",
  "dc: 5 easy, 10 moderate, 15 hard, 20 very hard; against a person, set it by how able and ready they are. modifier: -2 to 4, how apt this character is at this action, weakened by thirst, hunger or wounds.",
  "outcome: one or two short sentences in the action's language, saying what happened as a fact, complete: who did what to whom and how it ended. Never 'about to', never 'tries'.",
  "changes: only what the outcome plainly did to a body, for the people listed: drank or ate (a real drink, a real meal), condition wounded or unconscious. Never dead. Nothing changes for a hero's body.",
  "Things: the outcome says plainly what this character gave, took, put down, found or used up, with the thing's words as listed (the record of who holds what is kept from the story, not by you). A hero's thing passes to this character only when that hero gave or offered it in their own words this turn. Any other action aimed at a hero's body or belongings sets hero to that hero's name, and its outcome says only what the character attempts on them (the table resolves it).",
  "A thing that nobody listed has and that is not lying here does not exist in this moment (thrown away, eaten, lost, or never there): an action that uses it does nothing, and the outcome says plainly that it is not there (no 'tries to drink from it'). On the Zattera a vial thrown into the sea was drunk from a day later.",
  "When a hero asked something of this character or reached for their things this turn, the outcome says how this character's action answers it.",
  "A character who agrees to give, lend or hand over their own thing hands it over now, in the outcome: never a promise or a gesture of holding it out. Only a condition this character states in their own words keeps it in their hands.",
  `event, for each branch: what the action was, as fields the senses read. verb: one of ${SCENE_VERBS.join(", ")}. targets: the names of the people it was done to or said to (as listed), [] if none. object: the thing's words as listed, or "". volume: silent, whisper, normal, shout or noise (a blow, a fall, a splash is noise). covert: true only when the character does it so as not to be noticed.`,
  'Answer with ONE JSON object and nothing else: {"uncertain": true|false, "dc": number, "modifier": number, "hero": "" or the hero\'s name, "success": {"outcome": "...", "changes": [{"name": "...", "drank": true, "ate": true, "condition": "wounded"}], "event": {"verb": "take", "targets": [], "object": "Galletta", "volume": "normal", "covert": false}}, "failure": {"outcome": "...", "changes": [], "event": {"verb": "...", "targets": [], "object": "", "volume": "normal", "covert": false}}}. In changes give only the fields that changed. With uncertain false, failure may be empty.',
].join("\n");

export function renderRefereePrompt(input: {
  actor: string;
  intent: string;
  speech: string;
  people: readonly StagePerson[];
  ground?: readonly string[];
  place?: string;
  scene: string;
  facts: readonly string[];
  heroLines?: readonly HeroLine[];
}): string {
  const people = input.people.map(
    (person) => `- ${person.name}${person.hero ? " (a hero)" : ""}${person.state ? `: ${person.state}` : ""}${person.carries.length ? `; has: ${person.carries.join(", ")}` : ""}`,
  );
  return [
    input.place ? `Where this happens: ${input.place}` : "",
    `Who is here:\n${people.join("\n")}`,
    input.ground?.length ? `Lying here, nobody's, for anyone to take: ${input.ground.join("; ")}` : "",
    heroLinesBlock(input.heroLines ?? [], "What the heroes did and said this turn, in their own words:"),
    input.scene ? `The scene as last told:\n${clipText(input.scene, 1200)}` : "",
    input.facts.length ? `Already happened in this same moment:\n${input.facts.map((fact) => `- ${fact}`).join("\n")}` : "",
    `${input.actor} now attempts: ${input.intent}${input.speech ? `\nWhile saying: «${clipText(input.speech, 300)}»` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type StageChange = { name: string; drank: boolean; ate: boolean; condition: "" | "wounded" | "unconscious" };
export type StageBranch = { outcome: string; changes: StageChange[]; event: Record<string, unknown> };
export type StageRuling = { uncertain: boolean; dc: number; modifier: number; hero: string; success: StageBranch; failure: StageBranch };

function branchOf(value: unknown): StageBranch {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const changes = (Array.isArray(record.changes) ? record.changes : [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string")
    .slice(0, 6)
    .map((entry): StageChange => ({
      name: String(entry.name).trim(),
      drank: entry.drank === true,
      ate: entry.ate === true,
      condition: entry.condition === "wounded" || entry.condition === "unconscious" ? entry.condition : "",
    }));
  const event = record.event && typeof record.event === "object" && !Array.isArray(record.event) ? (record.event as Record<string, unknown>) : {};
  return { outcome: typeof record.outcome === "string" ? record.outcome.trim().slice(0, 500) : "", changes, event };
}

export function parseRuling(text: string): { ok: true; ruling: StageRuling } | { ok: false; error: string } {
  const parsed = replyJsonObject(text);
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!record) {
    return { ok: false, error: "the referee's reply was not a JSON object" };
  }
  const success = branchOf(record.success);
  if (!success.outcome) {
    return { ok: false, error: "the referee gave no outcome" };
  }
  const failure = branchOf(record.failure);
  const number = (value: unknown, low: number, high: number, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.max(low, Math.min(high, Math.round(value))) : fallback);
  return {
    ok: true,
    ruling: {
      uncertain: record.uncertain === true && Boolean(failure.outcome),
      dc: number(record.dc, 5, 25, 10),
      modifier: number(record.modifier, -2, 4, 0),
      hero: typeof record.hero === "string" ? record.hero.trim().slice(0, 80) : "",
      success,
      failure,
    },
  };
}

// The branch the die picks, and how it reads.
export function settleRuling(ruling: StageRuling, die: number): { branch: StageBranch; succeeded: boolean; roll: string } {
  if (!ruling.uncertain) {
    return { branch: ruling.success, succeeded: true, roll: "" };
  }
  const total = die + ruling.modifier;
  const succeeded = total >= ruling.dc;
  return { branch: succeeded ? ruling.success : ruling.failure, succeeded, roll: `${total} against ${ruling.dc}` };
}

// A thing's key without its leading article, so "la bottiglia di rum" the
// referee writes is the "una bottiglia di rum" the record holds. The caller
// passes the table language's rule (withoutLeadingStopWords); bare textKey
// otherwise.
export type ThingKey = (thing: string) => string;

// The line in someone's things a referee's words name: exact, then by key
// either way round ("bottiglia di rum" names "una bottiglia di rum"). Null
// when nothing or more than one line fits.
export function thingNamed(things: readonly string[], words: string, keyOf: ThingKey = textKey): string | null {
  const key = keyOf(words);
  if (!key) {
    return null;
  }
  const exact = things.filter((thing) => keyOf(thing) === key);
  if (exact.length) {
    return exact[0];
  }
  const near = things.filter((thing) => {
    const held = keyOf(thing);
    return held && (held.includes(key) || key.includes(held));
  });
  return near.length === 1 ? near[0] : null;
}

export type StageFact = { actor: string; speech: string; outcome: string; roll: string; hero: string };

export function factLine(fact: StageFact): string {
  return `${fact.actor}${fact.speech ? ` says: «${fact.speech}»` : ""}${fact.speech ? " and " : " "}${fact.outcome ? `→ ${fact.outcome}` : "does nothing"}`;
}

// What the narrator is handed: facts, already decided.
export function stageNote(facts: readonly StageFact[], silent: readonly string[]): string {
  return [
    "[Table note] After the players, every character on stage took their own turn, each from their own mind, and the engine's referee already decided how each action ended (who drank or ate is recorded; who holds which thing is recorded from your narration when the turn ends).",
    "These are facts now. Narrate them in this order, each one complete, as it ended:",
    ...facts.map((fact, index) => `${index + 1}. ${factLine(fact)}${fact.roll ? ` (the die: ${fact.roll})` : ""}${fact.hero ? ` [aimed at ${fact.hero}: an attempt on a hero; resolve it with your tools now, then narrate how it ends]` : ""}`),
    silent.length ? `${silent.join(", ")} did not answer this turn: say nothing for them.` : "",
    "Voice the words between «» exactly as given. Leave none of these out, change no outcome, add no other deed or word for these characters, and never write one as about to happen or still undecided. Do not call npc_speak or npc_state for them: it is done.",
    "A thing new to the world in these outcomes (a fish caught, something found) is made now with grant_item, to whoever holds it (a first-tier character is named by name). Things that only changed hands, fell or were used up you narrate, plainly and as they ended: they are recorded from your words.",
    "The narration so far stands: tell only what these turns add. If it left out something a hero did or said this turn, tell that first, as done.",
  ]
    .filter(Boolean)
    .join("\n");
}

// The line the narrator's rules carry at a staged table.
export const STAGE_RULES =
  "This table runs a stage: after the players' action the engine itself gives every first-tier character present their turn and decides how it ends. So do NOT call npc_speak for a first-tier character who is in the scene with the party: resolve the players' action with your tools, narrate its outcome only, and stop; their turns reach you as decided facts to narrate. A players' action that needs one of those characters to decide (handing over their own things, agreeing, answering a question or a demand) is not yours to decide and not yours to leave pending: narrate what the hero does and says, as done; that character hears the hero's own words and answers on the stage, and the engine records what changes hands. A hero giving their own thing is the hero's deed, not a request: narrate it as done. Who holds which thing is recorded from your narration when the turn ends, so never call handle_item \"hand\" or remove_item here: tell plainly who gave what to whom, what was put down, what was eaten or thrown away. A thing new to the world (loot, a reward, a fish caught) is still grant_item, a thing used up by the rules still use_item. A taker who does not want it gives it back on the stage. A grab, a shove or a threat is a contest, not a fight: start an encounter only when blows are really being traded.";

// What a mind perceives at its turn on the stage (docs/specs/ogm-npc-perception.md
// §12): the time since its last turn, what it took in since then by its own
// senses (the other minds' deeds among them), what the heroes did this turn
// in their own words, and at most a line of the narrator's telling, marked
// as an impression. The narrator's prose is no longer the source of what a
// mind knows happened.
export const ATMOSPHERE_CHARS = 300;

export function stageFrame(input: { heroes: readonly HeroLine[]; perceived: readonly string[]; elapsed: string; atmosphere: string }): string {
  return [
    input.elapsed ? `Since your last turn: ${input.elapsed}.` : "",
    input.perceived.length ? `What you took in with your own senses since your last turn (it already happened):\n${input.perceived.map((line) => `- ${line}`).join("\n")}` : "",
    heroLinesBlock(
      input.heroes,
      "What the heroes just did and said, in their own words (what they attempt; how it ended is told below, or is yours to answer if it was asked of you or done to you or your things):",
    ),
    input.atmosphere ? `The mood of the moment, as the narrator tells it (an impression, not a fact you witnessed): ${clipText(input.atmosphere, ATMOSPHERE_CHARS)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1990);
}
