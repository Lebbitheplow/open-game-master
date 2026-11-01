import { nextRomanceStage, ROMANCE_STAGES, type RelationshipStatus, type RomanceStage } from "./relationship-logic.ts";
import { clipText } from "../language/text-logic.ts";

// A romantic step asked in the middle of a fight, held for its answer after
// it (issue 640). The romance tool stays out of fights (issue 503), and a
// companion asked "I want us to be together" under fire said "let me answer
// when we're safe", and the step never came back: nothing recorded that it
// was asked. Now the engine holds it on the bond, and when the fight ends the
// GM is told to have them answer (a director note at an AI table, the
// console's Waiting on you at a person's). The answer is still the engine's:
// the consent roll runs when it is asked again, not now. Pure: the database
// side is romance-held.ts.

export type HeldRung = Exclude<RomanceStage, "none">;

export type HeldStep = {
  to: HeldRung;
  // The asker's words, for the answer to pick up.
  note: string;
  // Who held it: a romance_advance call made mid-fight, or a step the claims
  // reader found in the fight's narration (issue 641, which builds on this).
  source: "call" | "claim";
  heldAt: string;
  // The table's AI turns (campaigns.ai_turns) when the fight ended, or null
  // while it runs: the answer is owed from then.
  releasedAt: number | null;
};

// AI turns a held step is owed for once the fight is over. A GM who lets it
// pass that long has let the moment go; the note stops rather than nag every
// turn for the rest of the story. A person's console shows it until they
// answer.
export const ANSWER_TURNS = 6;

const NOTE_CHARS = 200;

const HELD_RUNGS = ROMANCE_STAGES.filter((stage): stage is HeldRung => stage !== "none");

export function parseHeldStep(raw: string | null | undefined): HeldStep | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const to = HELD_RUNGS.find((stage) => stage === parsed?.to);
    if (!parsed || !to) {
      return null;
    }
    return {
      to,
      note: typeof parsed.note === "string" ? clipText(parsed.note, NOTE_CHARS) : "",
      source: parsed.source === "claim" ? "claim" : "call",
      heldAt: typeof parsed.heldAt === "string" ? parsed.heldAt : "",
      releasedAt: typeof parsed.releasedAt === "number" && Number.isFinite(parsed.releasedAt) ? parsed.releasedAt : null,
    };
  } catch {
    return null;
  }
}

export function serializeHeldStep(step: HeldStep | null): string {
  return step ? JSON.stringify({ ...step, note: clipText(step.note, NOTE_CHARS) }) : "";
}

// The ask in words, as a refused step is worded (relationship-logic.ts
// refusedStepText): "asked to be partners", not "asked for together".
export const ASK_WORDS: Record<HeldRung, string> = {
  interested: "to return their interest",
  courting: "to court them",
  together: "to be partners",
  betrothed: "to be betrothed",
  married: "to marry them",
};

// Whether a held step still asks something: the bond is open and the step
// is still its next rung. One the story moved past (answered another way, a
// slip, a break-up) has nothing left to answer.
export function heldStepStands(step: HeldStep, bond: { romance: RomanceStage; status: RelationshipStatus }): boolean {
  return bond.status === "active" && nextRomanceStage(bond.romance) === step.to;
}

// Whether the GM is owed the reminder now: no fight on, and not past its
// turns. One held before the fight's end stamped it is owed from now.
export function heldStepDue(step: HeldStep, fighting: boolean, aiTurns: number): boolean {
  return !fighting && (step.releasedAt === null || aiTurns - step.releasedAt < ANSWER_TURNS);
}

// The romance tool's result when it holds a step: said in the RESULT, not
// its description, so the lean tool set grows by nothing (a fight never
// offers the tool; a console, an agent program or a model that calls it
// anyway reads this).
export function heldStepNote(character: string, subject: string, to: HeldRung, atConsole: boolean): string {
  return `Held: a fight is on, so ${subject} does not answer ${character}'s ask ${ASK_WORDS[to]} yet, and nothing is rolled. Narrate ${subject} putting it off until they are safe, in their own voice, neither yes nor no. When the fight ends ${atConsole ? "the console shows the ask under Waiting on you, to answer with Romance" : "you are told to have them answer it"}.`;
}

// The GM's reminder once the fight is over: in the end of the fight's result
// and as a director note on the turns after it.
export function heldStepCue(character: string, characterId: string, subject: string, step: Pick<HeldStep, "to" | "note">): string {
  const words = step.note ? ` ("${step.note}")` : "";
  return `In the fight, ${character} asked ${subject} ${ASK_WORDS[step.to]}${words}, and ${subject} said they would answer when it was safe. The fight is over: have ${subject} bring it up and answer now. Call romance_advance (characterId ${characterId}, subject ${subject}, to ${step.to}) before narrating the answer; the server decides it.`;
}
