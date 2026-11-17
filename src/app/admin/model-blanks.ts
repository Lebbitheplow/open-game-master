import { isSpeechModelId } from "@/lib/model-registry/catalog-logic";
import type { ModelChoices } from "@/lib/model-registry/registry";

// What a model picker's blank entry says, one pattern for Admin and the
// guided setup, by what a blank runs:
//   - a name known now: the name, with where it comes from ("large-v3 (from
//     STT_MODEL)", "large-v3 (the server's only model)");
//   - a model chosen elsewhere: "Not chosen (the story model)";
//   - nothing of the kind: "None (no narration)".
// No model is ever named here: a blank that runs one names what the server
// or the environment says.

// A translator, as the components receive one from useT() and the tests
// build one from messages-logic.ts.
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function fromEnv(t: Translate, value: string, variable: string): string {
  return t("{value} (from {variable})", { value, variable });
}

// The blank's role word, keyed so it follows the table's language: what a
// blank of this picker would leave unrun.
export type BlankRole = "storyteller" | "pictures" | "narration" | "whisper" | "paidDictation";
export type BlankRun = "story" | "program" | "sole";

const ROLE_KEYS: Record<BlankRole, string> = {
  storyteller: "storyteller",
  pictures: "pictures",
  narration: "narration",
  whisper: "Whisper dictation",
  paidDictation: "paid dictation",
};

const RUN_KEYS: Record<BlankRun, string> = {
  story: "the story model",
  program: "the program's own default",
  sole: "the server's only model, once it answers",
};

export function noneLabel(t: Translate, role: BlankRole): string {
  return t("None (no {role})", { role: t(ROLE_KEYS[role]) });
}

export function notChosen(t: Translate, runs: BlankRun): string {
  return t("Not chosen ({runs})", { runs: t(RUN_KEYS[runs]) });
}

// A blank that runs the server's only model (the storyteller, #273's rule
// in src/lib/model-registry/discovery.ts; a Whisper service,
// src/lib/stt.ts; a narration server that is not OpenAI,
// src/lib/tts-backend.ts): named, so the admin sees what is sent, and left
// blank, so it follows the server when its model changes. Until the server
// answers, nobody knows whether it has just one.
export function soleModelBlank(t: Translate, otherwise: string): (choices: ModelChoices | null) => string {
  return (choices) => {
    if (choices?.reachable !== true) return notChosen(t, "sole");
    const listed = choices.models.filter((model) => model.listed);
    return listed.length === 1 ? t("{name} (the server's only model)", { name: listed[0].label }) : otherwise;
  };
}

// A Whisper service with no model is skipped for the next engine, so
// dictation itself may still run.
export function blanks(t: Translate) {
  return {
    story: soleModelBlank(t, noneLabel(t, "storyteller")),
    utility: notChosen(t, "story"),
    picture: noneLabel(t, "pictures"),
    checkpoint: noneLabel(t, "pictures"),
    narration: noneLabel(t, "narration"),
    // A narration server of the host's own runs its only model for a blank,
    // as a Whisper service does (src/lib/tts-backend.ts narrationModel).
    narrationServer: soleModelBlank(t, noneLabel(t, "narration")),
    whisper: soleModelBlank(t, noneLabel(t, "whisper")),
    transcription: noneLabel(t, "paidDictation"),
    // The agent program's own choice, which only the program knows.
    programDefault: notChosen(t, "program"),
  };
}

// What a speech picker shows first, the rest one click away (a display
// filter, never what is sent).
export const SPEECH_MODELS = {
  narration: { keep: (id: string) => isSpeechModelId(id, "narration"), kind: "narration models" },
  dictation: { keep: (id: string) => isSpeechModelId(id, "dictation"), kind: "transcription models" },
};
