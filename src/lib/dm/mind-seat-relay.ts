import { randomUUID } from "node:crypto";

// Hands a mind's question to the person playing it from a mind seat and waits
// for their answer (docs/specs/ogm-mind-seats.md). In memory on purpose: a
// question lives only while the turn that asked it waits, and a restart
// ends that turn anyway. Whoever does not answer in time is replaced, for
// that one answer, by the server's own mind.

export type MindQuestion = {
  requestId: string;
  campaignId: string;
  seatId: string;
  character: string;
  instructions: string;
  prompt: string;
  askedAt: string;
};

export type MindAnswer = { speech: string; intent: string; conclusion: string; lie: boolean };

type Pending = MindQuestion & { userId: string; settle: (answer: MindAnswer | null) => void };

type Relay = { pending: Map<string, Pending>; waiters: Map<string, Set<() => void>> };

declare global {
  var __odmMindSeatRelay: Relay | undefined;
}

function relay(): Relay {
  globalThis.__odmMindSeatRelay ??= { pending: new Map(), waiters: new Map() };
  return globalThis.__odmMindSeatRelay;
}

export const MIND_SEAT_TIMEOUT_MS = () => {
  const seconds = Number(process.env.MIND_SEAT_TIMEOUT_SEC);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 90) * 1000;
};

function wake(userId: string) {
  const waiting = relay().waiters.get(userId);
  relay().waiters.delete(userId);
  for (const resume of waiting ?? []) {
    resume();
  }
}

// Asks the seat's holder; null when they do not answer in time.
export function askSeatHolder(
  question: Omit<MindQuestion, "requestId" | "askedAt"> & { userId: string },
  timeoutMs = MIND_SEAT_TIMEOUT_MS(),
): Promise<MindAnswer | null> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      relay().pending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    relay().pending.set(requestId, {
      ...question,
      requestId,
      askedAt: new Date().toISOString(),
      settle: (answer) => {
        clearTimeout(timer);
        relay().pending.delete(requestId);
        resolve(answer);
      },
    });
    wake(question.userId);
  });
}

export function questionsFor(userId: string): MindQuestion[] {
  return [...relay().pending.values()]
    .filter((entry) => entry.userId === userId)
    .map(({ requestId, campaignId, seatId, character, instructions, prompt, askedAt }) => ({
      requestId,
      campaignId,
      seatId,
      character,
      instructions,
      prompt,
      askedAt,
    }));
}

// Waits up to waitMs for a question to reach this user.
export async function waitForQuestions(userId: string, waitMs: number): Promise<MindQuestion[]> {
  const ready = questionsFor(userId);
  if (ready.length || waitMs <= 0) {
    return ready;
  }
  await new Promise<void>((resume) => {
    const waiting = relay().waiters.get(userId) ?? new Set<() => void>();
    const done = () => {
      clearTimeout(timer);
      waiting.delete(done);
      resume();
    };
    const timer = setTimeout(done, waitMs);
    waiting.add(done);
    relay().waiters.set(userId, waiting);
  });
  return questionsFor(userId);
}

// Settles a question with its holder's answer; false if it is not theirs
// or has already been answered or replaced.
export function answerQuestion(userId: string, requestId: string, answer: MindAnswer): boolean {
  const entry = relay().pending.get(requestId);
  if (!entry || entry.userId !== userId) {
    return false;
  }
  entry.settle(answer);
  return true;
}

// Every question waiting on a seat that was just taken back is answered by
// the server's mind instead.
export function dropSeatQuestions(seatId: string) {
  for (const entry of [...relay().pending.values()]) {
    if (entry.seatId === seatId) {
      entry.settle(null);
    }
  }
}
