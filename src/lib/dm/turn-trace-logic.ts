// The turn trace of a test fight (issue 685, gap 6): every call a GM turn
// made, read from the turn's stored conversation, with who made it, whom it
// names, what the engine answered, and the notes the engine sent the model
// back with. The bench report read "the swing was never rolled" off the
// chronicle alone; the calls say why (the attack that came back for a retry
// and was never sent again, the card the engine played before the model was
// asked, the correction the model answered with another tool).
//
// Shown at a test table only, and only to the person who started it
// (src/app/api/campaigns/[campaignId]/turn-trace/route.ts): its author holds
// every seat and every secret there, so nothing here needs the cuts that
// keep a live table's lead from the storyteller's own section
// (context-trace route).
//
// Pure: no database, no model.
import { argsOf, modelCallsIn, resultOf, textOf, type StoredMessage } from "@/lib/dm/card-score-logic";
import { DIRECT_CALL_ID_PREFIX, INTENT_CORRECTION_MARK } from "@/lib/dm/intent-logic";
import { AGENT_MARK, UNBUILT_TURN_MARK } from "@/lib/dm/agent-mark";

// A person's call at a test table, kept on their turn in the conversation's
// own shape (src/lib/dm/invoke.ts), so it reads like any other call here.
export const PERSON_CALL_ID_PREFIX = "person_";

// Who made a call. The model's calls carry the backend's own ids; the calls
// the engine writes itself carry ids of its own making, by the code that
// writes them.
export type TraceSource = "model" | "card" | "guard" | "story" | "agent" | "person";

const ENGINE_IDS: ReadonlyArray<readonly [string, TraceSource]> = [
  // A card from the Hand the engine plays before the model is asked
  // (turn.ts cardReply).
  [DIRECT_CALL_ID_PREFIX, "card"],
  // A spell the prose cast that its player had asked for in words, cast by
  // the guard (turn.ts castSlotlessFor).
  ["slotless_", "guard"],
  // A relationship beat the story showed, recorded by the engine
  // (story-moves-settle.ts recordFromStory).
  ["story_", "story"],
  // An agent program in the GM seat (agent-turn.ts recordAgentCall).
  ["agent_", "agent"],
  [PERSON_CALL_ID_PREFIX, "person"],
];

function sourceOf(id: string): TraceSource {
  for (const [prefix, source] of ENGINE_IDS) {
    if (id.startsWith(prefix)) {
      return source;
    }
  }
  return "model";
}

// What the engine answered a call: done; refused by the game ("rules" or
// "limit", tool-errors.ts); sent back as a mistake in the call (retry: true),
// so nothing happened; parked on a player's dice; or never answered.
export type TraceOutcome = "ok" | "refused" | "retry" | "waiting" | "unanswered";

export type TraceCall = {
  kind: "call";
  tool: string;
  source: TraceSource;
  // Made after the engine sent the model back to a card nobody resolved
  // (intent-logic.ts intentCorrection): the model's answer to the
  // correction, not its own first choice.
  afterCorrection: boolean;
  // The characters, enemies and cast members the arguments name.
  names: string[];
  // A few of the arguments on one line, ids read as names.
  summary: string;
  // Every argument, ids read as names, for the row opened.
  args: string;
  outcome: TraceOutcome;
  refusal: "rules" | "limit" | null;
  // The engine's sentence for a refusal or a retry; empty otherwise.
  sentence: string;
  // A refused or returned call the turn made again later (the same tool).
  calledAgain: boolean;
  // The engine's whole answer, cut short.
  answer: string;
};

// A note the engine put in front of the model mid-turn: the correction that
// sends it back to a card, the guard holding back a hit only the prose
// landed, a fresh map after a roll came in.
export type TraceNote = { kind: "note"; correction: boolean; text: string };

// Words the model wrote beside its calls. The narration the table read is
// the trace's own field.
export type TraceReply = { kind: "reply"; text: string };

export type TraceRow = TraceCall | TraceNote | TraceReply;

export type TraceStatus = "running" | "waiting" | "done" | "halted";

export type TurnTrace = {
  id: string;
  // The AI GM, an agent program in its seat, or a person (the console, a
  // card at a table a person runs, the test's own set-up).
  by: "ai" | "agent" | "person";
  status: TraceStatus;
  startedAt: string;
  updatedAt: string;
  durationMs: number | null;
  // The table's lines the turn answered, newest last.
  answered: string[];
  rows: TraceRow[];
  narration: string;
  modelCalls: number;
  rolls: number;
  // When the lead reverted the turn ("Revert this turn"): its calls stay
  // listed as they were made, read as taken back, as the event log strikes
  // its rows and the chronicle keeps its lines. Null while it stands.
  revertedAt: string | null;
};

// A stored turn as the trace reads it: a DmTurn (src/lib/db/dm-turns.ts)
// fits as it is.
export type TraceTurnInput = {
  id: string;
  actor: "ai" | "human_dm";
  status: "running" | "awaiting_rolls" | "done" | "failed";
  callIndex: number;
  conversation: readonly StoredMessage[];
  narrationParts: readonly string[];
  rollIds: readonly string[];
  contextTrace: { shape?: { historyStart: number; historyEnd: number; promptMessages: number } } | null;
  createdAt: string;
  updatedAt: string;
  revertedAt?: string | null;
};

const SUMMARY_FIELDS = 5;
const SUMMARY_VALUE = 48;
const ARGS_TEXT = 2400;
const ANSWER_TEXT = 900;
const NOTE_TEXT = 600;
const REPLY_TEXT = 900;
const LINE_TEXT = 400;
const ANSWERED_LINES = 4;
const NARRATION_TEXT = 4000;

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

function isMark(message: StoredMessage): boolean {
  const text = textOf(message.content);
  return message.role === "user" && (text === AGENT_MARK || text === UNBUILT_TURN_MARK);
}

// Where the turn's own messages start: after the prompt. The prompt's
// history holds the table's lines and the GM's past narration, never a
// call, so a turn stored before the prompt's size was kept is read from its
// first call, and its notes and words before that are left out rather than
// taking the transcript for them.
function ownStart(turn: TraceTurnInput): number {
  const known = turn.contextTrace?.shape?.promptMessages;
  if (typeof known === "number" && known > 0) {
    return known;
  }
  const first = turn.conversation[0];
  if (!first) {
    return 0;
  }
  if (isMark(first)) {
    return 1;
  }
  if (first.role !== "system") {
    return 0;
  }
  const call = turn.conversation.findIndex(
    (message) => message.role === "tool" || (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0),
  );
  return call < 0 ? turn.conversation.length : call;
}

// The table's lines since the GM last spoke, as the prompt carried them.
function answeredLines(turn: TraceTurnInput): string[] {
  const shape = turn.contextTrace?.shape;
  if (!shape || shape.historyEnd <= shape.historyStart) {
    return [];
  }
  const history = turn.conversation.slice(shape.historyStart, shape.historyEnd);
  let from = 0;
  history.forEach((message, index) => {
    if (message.role === "assistant") {
      from = index + 1;
    }
  });
  return history
    .slice(from)
    .filter((message) => message.role === "user")
    .map((message) => clip(textOf(message.content), LINE_TEXT))
    .filter(Boolean)
    .slice(-ANSWERED_LINES);
}

function nameFor(value: string, names: ReadonlyMap<string, string>): string | null {
  return names.get(value) ?? null;
}

// Every known id the arguments hold, as names, each once.
function namesIn(value: unknown, names: ReadonlyMap<string, string>, found: string[], depth = 0): void {
  if (depth > 4) {
    return;
  }
  if (typeof value === "string") {
    const name = nameFor(value, names);
    if (name && !found.includes(name)) {
      found.push(name);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      namesIn(entry, names, found, depth + 1);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      namesIn(entry, names, found, depth + 1);
    }
  }
}

// The arguments with every known id read as its name, the id kept short
// beside it for the author who goes looking for the row.
function named(value: unknown, names: ReadonlyMap<string, string>, depth = 0): unknown {
  if (typeof value === "string") {
    const name = nameFor(value, names);
    return name ? `${name} (${value.slice(0, 8)})` : value;
  }
  if (depth > 6) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => named(entry, names, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, named(entry, names, depth + 1)]));
  }
  return value;
}

function summaryValue(value: unknown, names: ReadonlyMap<string, string>): string | null {
  if (typeof value === "string") {
    return value.trim() ? clip(nameFor(value, names) ?? value, SUMMARY_VALUE) : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.length && value.every((entry) => typeof entry === "string" || typeof entry === "number")) {
    return clip(value.map((entry) => (typeof entry === "string" ? nameFor(entry, names) ?? entry : String(entry))).join(", "), SUMMARY_VALUE);
  }
  return null;
}

function summaryOf(args: Record<string, unknown>, names: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const shown = summaryValue(value, names);
    if (shown !== null) {
      parts.push(`${key}: ${shown}`);
    }
    if (parts.length >= SUMMARY_FIELDS) {
      break;
    }
  }
  return parts.join("; ");
}

function stringify(value: unknown, max: number, pretty = false): string {
  try {
    return clip(JSON.stringify(value, null, pretty ? 2 : undefined) ?? "", max);
  } catch {
    return "";
  }
}

type OpenCall = { id: string; row: TraceCall; answered: boolean };

function outcomeOf(result: Record<string, unknown> | null, parked: boolean): Pick<TraceCall, "outcome" | "refusal" | "sentence"> {
  if (!result) {
    return { outcome: parked ? "waiting" : "unanswered", refusal: null, sentence: "" };
  }
  if (typeof result.error === "string") {
    const refusal = result.refused === "rules" || result.refused === "limit" ? result.refused : null;
    return { outcome: result.retry === true ? "retry" : "refused", refusal, sentence: clip(result.error, NOTE_TEXT) };
  }
  return { outcome: "ok", refusal: null, sentence: "" };
}

// The roll markers the server writes into narration ("[roll:<id>]") are the
// chronicle's own and read as noise here.
function plainNarration(parts: readonly string[]): string {
  return clip(parts.join("\n\n").replace(/\[roll:[^\]]*\]\s*/g, ""), NARRATION_TEXT);
}

export function traceTurn(
  turn: TraceTurnInput,
  options: { names?: ReadonlyMap<string, string>; durationMs?: number | null } = {},
): TurnTrace {
  const names = options.names ?? new Map<string, string>();
  const agent = turn.actor === "ai" && turn.conversation[0] !== undefined && textOf(turn.conversation[0].content) === AGENT_MARK;
  const unbuilt = turn.conversation.length === 1 && textOf(turn.conversation[0]?.content) === UNBUILT_TURN_MARK;
  const parked = turn.status === "awaiting_rolls";
  const rows: TraceRow[] = [];
  const open: OpenCall[] = [];
  let corrected = false;

  for (const message of turn.conversation.slice(ownStart(turn))) {
    if (message.role === "assistant") {
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const ids = calls.map((raw) => {
        const id = (raw as { id?: unknown })?.id;
        return typeof id === "string" ? id : "";
      });
      // The engine writes no prose of its own: words in an assistant
      // message are the model's.
      const text = clip(textOf(message.content), REPLY_TEXT);
      if (text) {
        rows.push({ kind: "reply", text });
      }
      calls.forEach((raw, index) => {
        const call = raw as { function?: { name?: unknown; arguments?: unknown } };
        const tool = typeof call?.function?.name === "string" ? call.function.name : "";
        if (!tool) {
          return;
        }
        const args = argsOf(call.function?.arguments);
        const found: string[] = [];
        namesIn(args, names, found);
        const row: TraceCall = {
          kind: "call",
          tool,
          source: sourceOf(ids[index]),
          afterCorrection: corrected,
          names: found,
          summary: summaryOf(args, names),
          args: stringify(named(args, names), ARGS_TEXT, true),
          outcome: "unanswered",
          refusal: null,
          sentence: "",
          calledAgain: false,
          answer: "",
        };
        rows.push(row);
        open.push({ id: ids[index], row, answered: false });
      });
      continue;
    }
    if (message.role === "tool") {
      // The answer goes to the first unanswered call with its id: a local
      // model that numbers every reply's calls from zero reuses ids within
      // one turn, and the later answer belongs to the later call.
      const id = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      const target = open.find((entry) => !entry.answered && (id === "" || entry.id === id));
      if (!target) {
        continue;
      }
      target.answered = true;
      const result = resultOf(message.content);
      // An answer that is not an object (plain words) carried no error.
      Object.assign(
        target.row,
        result ? outcomeOf(result, parked) : { outcome: "ok", refusal: null, sentence: "" },
        { answer: result ? stringify(result, ANSWER_TEXT) : clip(textOf(message.content), ANSWER_TEXT) },
      );
      continue;
    }
    if (message.role === "user" && !isMark(message)) {
      const text = textOf(message.content);
      const correction = text.includes(INTENT_CORRECTION_MARK);
      corrected = corrected || correction;
      if (text.trim()) {
        rows.push({ kind: "note", correction, text: clip(text, NOTE_TEXT) });
      }
    }
  }

  for (const entry of open) {
    if (!entry.answered) {
      Object.assign(entry.row, outcomeOf(null, parked));
    }
  }
  const calls = rows.filter((row): row is TraceCall => row.kind === "call");
  calls.forEach((row, index) => {
    if (row.outcome === "refused" || row.outcome === "retry") {
      row.calledAgain = calls.slice(index + 1).some((later) => later.tool === row.tool);
    }
  });

  const by = turn.actor === "human_dm" ? "person" : agent ? "agent" : "ai";
  return {
    id: turn.id,
    by,
    status: unbuilt || turn.status === "failed" ? "halted" : parked ? "waiting" : turn.status === "running" ? "running" : "done",
    startedAt: turn.createdAt,
    updatedAt: turn.updatedAt,
    durationMs: typeof options.durationMs === "number" ? options.durationMs : null,
    answered: by === "ai" ? answeredLines(turn) : [],
    rows,
    narration: plainNarration(turn.narrationParts),
    modelCalls: by === "ai" ? modelCallsIn(turn.conversation, turn.callIndex) : 0,
    rolls: turn.rollIds.length,
    revertedAt: turn.revertedAt ?? null,
  };
}

// A turn with nothing to show: a person's turn the engine opened and closed
// with no call and no roll on it.
export function isQuietTrace(trace: TurnTrace): boolean {
  return trace.status === "done" && !trace.rows.length && !trace.narration && !trace.rolls && !trace.answered.length;
}

// What a person's call leaves on their turn at a test table (invoke.ts): the
// engine's answer as the conversation keeps a tool result, the refusal and
// its kind alone for a "no", and an answer too long to keep said so.
export function keptAnswer(result: Record<string, unknown>): string {
  if (typeof result.error === "string") {
    return JSON.stringify({
      error: result.error,
      ...(result.retry === true ? { retry: true } : {}),
      ...(result.refused === "rules" || result.refused === "limit" ? { refused: result.refused } : {}),
    });
  }
  const whole = JSON.stringify(result) ?? "{}";
  return whole.length > 6000 ? JSON.stringify({ ok: true, kept: "The engine's answer was too long to keep here." }) : whole;
}
