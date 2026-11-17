// The mood of a first-tier mind (docs/specs/ogm-npc-perception.md §9, after
// The Sims' moodlets): emotions with a weight, a cause, someone they are
// toward, and an end, born by a fixed table from what the mind took in and
// from its body, shaped by its temperament, fading as they age. The words a
// mind reads of them come from here too. Pure.
import type { Moodles } from "@/lib/dm/body-logic";
import type { SceneEvent, SenseChannel } from "@/lib/dm/scene-events-logic";
import { textKey } from "@/lib/language/text-logic";

export const EMOTIONS = ["fear", "anger", "sadness", "shame", "gratitude", "hope", "disgust", "relief", "boredom", "panic", "affection", "jealousy"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export type Moodlet = { emotion: Emotion; weight: number; source: string; toward: string; startedAt: number; expiresAt: number };

export type Temperament = { boldness: number; warmth: number; composure: number };

const HOUR = 60;

type Born = { emotion: Emotion; weight: number; hours: number; atActor?: boolean };

// Done to the observer.
const TO_ME: Partial<Record<SceneEvent["verb"], Born[]>> = {
  strike: [{ emotion: "fear", weight: 30, hours: 4, atActor: true }, { emotion: "anger", weight: 30, hours: 4, atActor: true }],
  push: [{ emotion: "anger", weight: 15, hours: 2, atActor: true }],
  grab: [{ emotion: "fear", weight: 10, hours: 2, atActor: true }, { emotion: "anger", weight: 10, hours: 2, atActor: true }],
  steal: [{ emotion: "anger", weight: 35, hours: 6, atActor: true }],
  bind: [{ emotion: "fear", weight: 40, hours: 6, atActor: true }, { emotion: "anger", weight: 30, hours: 6, atActor: true }],
  threaten: [{ emotion: "fear", weight: 25, hours: 3, atActor: true }],
  give: [{ emotion: "gratitude", weight: 30, hours: 12, atActor: true }],
  heal: [{ emotion: "gratitude", weight: 30, hours: 12, atActor: true }, { emotion: "relief", weight: 20, hours: 4 }],
  help: [{ emotion: "gratitude", weight: 20, hours: 8, atActor: true }],
  free: [{ emotion: "gratitude", weight: 30, hours: 12, atActor: true }, { emotion: "relief", weight: 30, hours: 4 }],
  embrace: [{ emotion: "affection", weight: 10, hours: 4, atActor: true }],
};

// Seen done to someone dear to the observer.
const TO_DEAR: Partial<Record<SceneEvent["verb"], Born[]>> = {
  strike: [{ emotion: "anger", weight: 20, hours: 4, atActor: true }],
  steal: [{ emotion: "anger", weight: 15, hours: 4, atActor: true }],
  bind: [{ emotion: "anger", weight: 20, hours: 4, atActor: true }],
  give: [{ emotion: "affection", weight: 5, hours: 4, atActor: true }],
  heal: [{ emotion: "affection", weight: 5, hours: 4, atActor: true }],
};

// Seen done to anyone else.
const TO_OTHER: Partial<Record<SceneEvent["verb"], Born[]>> = {
  strike: [{ emotion: "fear", weight: 10, hours: 2, atActor: true }],
  steal: [{ emotion: "disgust", weight: 10, hours: 2, atActor: true }],
  bind: [{ emotion: "fear", weight: 10, hours: 2, atActor: true }],
  threaten: [{ emotion: "fear", weight: 10, hours: 2, atActor: true }],
};

const DEAR = 20;

const PAST: Partial<Record<SceneEvent["verb"], string>> = {
  strike: "struck",
  push: "shoved",
  grab: "grabbed",
  steal: "stole from",
  bind: "tied up",
  threaten: "threatened",
  give: "gave something to",
  heal: "tended",
  help: "helped",
  free: "freed",
  embrace: "embraced",
};

// What an event the observer took in stirs in it (§9.2.1). Seen eating or
// drinking while it starves stirs jealousy by how hungry or thirsty it is.
export function appraise(
  event: Pick<SceneEvent, "actor" | "verb" | "targets" | "object" | "instant"> & { success?: boolean },
  observer: string,
  channels: readonly SenseChannel[],
  context: { careToward: (name: string) => number; body: Moodles | null },
): Moodlet[] {
  if (!event.actor || textKey(event.actor) === textKey(observer)) {
    return [];
  }
  const seen = channels.includes("sight") || channels.includes("touch") || (event.verb === "threaten" && channels.includes("hearing"));
  if (!seen) {
    return [];
  }
  const thing = event.object ? ` (${event.object})` : "";
  const toMe = event.targets.some((target) => textKey(target) === textKey(observer));
  const victim = event.targets[0] ?? "";
  let born: Born[] = [];
  let cause = "";
  const did = `${event.success === false ? "tried: " : ""}${PAST[event.verb] ?? event.verb}`;
  if (toMe) {
    born = TO_ME[event.verb] ?? [];
    cause = `${event.actor} ${did} you${thing}`;
  } else if (victim) {
    born = (context.careToward(victim) >= DEAR ? TO_DEAR[event.verb] : TO_OTHER[event.verb]) ?? [];
    cause = `${event.actor} ${did} ${victim}${thing}`;
  }
  if ((event.verb === "eat" || event.verb === "drink") && context.body) {
    const need = event.verb === "eat" ? context.body.hunger : context.body.thirst;
    if (need >= 2) {
      born = [{ emotion: "jealousy", weight: 10 * need, hours: 2, atActor: true }];
      cause = `${event.actor} ${event.verb === "eat" ? "ate" : "drank"}${thing} in front of you while you go ${event.verb === "eat" ? "hungry" : "thirsty"}`;
    }
  }
  return born.map((entry) => ({
    emotion: entry.emotion,
    weight: entry.weight,
    source: cause,
    toward: entry.atActor ? event.actor : "",
    startedAt: event.instant,
    expiresAt: event.instant + entry.hours * HOUR,
  }));
}

// The body's own weight on the mood (§9.2.2), lasting the hour it is counted.
export function bodyMoods(levels: Moodles, stormy: boolean, now: number): Moodlet[] {
  const out: Array<[Emotion, string, boolean]> = [
    ["anger", "the hunger gnawing at you", levels.hunger >= 3],
    ["panic", "the cold in your bones", levels.cold >= 3],
    ["sadness", "the exhaustion", levels.sleep >= 3],
    ["fear", "the storm", stormy],
  ];
  return out.filter(([, , on]) => on).map(([emotion, source]) => ({ emotion, weight: 10, source, toward: "", startedAt: now, expiresAt: now + HOUR }));
}

// The temperament shapes what is born (§9.2.4): the unflappable feel half,
// the volatile half again as much; the bold turn half their fear to anger,
// the timid half their anger to fear; the warm feel thanks and fondness more.
export function shapeByTemperament(moodlets: readonly Moodlet[], temperament: Temperament | null): Moodlet[] {
  if (!temperament) {
    return [...moodlets];
  }
  const scale = temperament.composure >= 2 ? 0.5 : temperament.composure <= -2 ? 1.5 : 1;
  const out: Moodlet[] = [];
  for (const moodlet of moodlets) {
    let weight = moodlet.weight * scale;
    if (temperament.warmth >= 2 && (moodlet.emotion === "gratitude" || moodlet.emotion === "affection")) {
      weight *= 1.5;
    }
    const turn = temperament.boldness >= 2 && moodlet.emotion === "fear" ? "anger" : temperament.boldness <= -2 && moodlet.emotion === "anger" ? "fear" : null;
    if (turn) {
      out.push({ ...moodlet, weight: Math.round(weight / 2) });
      out.push({ ...moodlet, emotion: turn, weight: Math.round(weight / 2) });
    } else {
      out.push({ ...moodlet, weight: Math.round(weight) });
    }
  }
  return out.filter((moodlet) => moodlet.weight > 0);
}

export function sameMoodlet(a: Moodlet, b: Moodlet): boolean {
  return a.emotion === b.emotion && textKey(a.toward) === textKey(b.toward) && a.source === b.source;
}

// The same cause toward the same person does not add up: it is renewed and
// keeps the greater weight (no spirals).
export function renew(existing: Moodlet, born: Moodlet): Moodlet {
  return { ...born, weight: Math.max(existing.weight, born.weight), expiresAt: Math.max(existing.expiresAt, born.expiresAt) };
}

// The weight now, fading straight down to nothing at its end.
export function weightNow(moodlet: Moodlet, now: number): number {
  if (now >= moodlet.expiresAt) {
    return 0;
  }
  const span = Math.max(1, moodlet.expiresAt - moodlet.startedAt);
  return Math.round(moodlet.weight * Math.min(1, (moodlet.expiresAt - now) / span));
}

const WORDS: Record<Emotion, [mild: string, plain: string, strong: string]> = {
  fear: ["uneasy", "afraid", "terrified"],
  anger: ["irritated", "angry", "furious"],
  sadness: ["low", "sad", "grief-stricken"],
  shame: ["awkward", "ashamed", "mortified"],
  gratitude: ["thankful", "grateful", "deeply grateful"],
  hope: ["hopeful", "hopeful", "full of hope"],
  disgust: ["put off", "disgusted", "revolted"],
  relief: ["relieved", "relieved", "flooded with relief"],
  boredom: ["bored", "bored", "bored stiff"],
  panic: ["jittery", "panicky", "in a blind panic"],
  affection: ["warm", "fond", "full of love"],
  jealousy: ["envious", "jealous", "seething with envy"],
};

const TOWARD: Partial<Record<Emotion, string>> = { anger: "with", fear: "of", gratitude: "to", disgust: "by", affection: "toward", jealousy: "of" };

// The mood in words: the strongest feeling if it reaches 15, then the next
// two, each with its cause. "" when calm.
export function moodWords(moodlets: readonly Moodlet[], now: number): string {
  const live = moodlets.map((moodlet) => ({ moodlet, weight: weightNow(moodlet, now) })).filter((entry) => entry.weight >= 5);
  live.sort((a, b) => b.weight - a.weight);
  if (!live.length || live[0].weight < 15) {
    return "";
  }
  return live
    .slice(0, 3)
    .map(({ moodlet, weight }) => {
      const word = WORDS[moodlet.emotion][weight >= 50 ? 2 : weight >= 25 ? 1 : 0];
      const at = moodlet.toward ? ` ${TOWARD[moodlet.emotion] ?? "about"} ${moodlet.toward}` : "";
      return `You are ${word}${at}${moodlet.source ? ` (${moodlet.source})` : ""}.`;
    })
    .join(" ");
}

// Whether a feeling is strong enough that the mind cannot stay still (§9.3).
export function moodPresses(moodlets: readonly Moodlet[], now: number): Moodlet | null {
  return moodlets.find((moodlet) => (moodlet.emotion === "panic" || moodlet.emotion === "anger" || moodlet.emotion === "fear") && weightNow(moodlet, now) >= 60) ?? null;
}

// Words said to or about the mind, read by a model into a closed list
// (§9.2.3); anything else is nothing.
export const WORD_KINDS = ["insult", "threat", "flattery", "request", "promise", "lie_caught", "comfort", "mockery", "nothing"] as const;
export type WordKind = (typeof WORD_KINDS)[number];

const WORD_BORN: Record<WordKind, Born[]> = {
  insult: [{ emotion: "anger", weight: 15, hours: 3, atActor: true }],
  threat: [{ emotion: "fear", weight: 20, hours: 3, atActor: true }],
  flattery: [{ emotion: "affection", weight: 5, hours: 2, atActor: true }],
  request: [],
  promise: [{ emotion: "hope", weight: 10, hours: 6, atActor: true }],
  lie_caught: [{ emotion: "anger", weight: 20, hours: 6, atActor: true }, { emotion: "disgust", weight: 10, hours: 6, atActor: true }],
  comfort: [{ emotion: "relief", weight: 10, hours: 2 }, { emotion: "gratitude", weight: 10, hours: 4, atActor: true }],
  mockery: [{ emotion: "anger", weight: 10, hours: 2, atActor: true }, { emotion: "shame", weight: 10, hours: 2 }],
  nothing: [],
};

export function appraiseWords(reading: { kind: WordKind; intensity: 1 | 2 | 3 }, speaker: string, words: string, now: number): Moodlet[] {
  return WORD_BORN[reading.kind].map((entry) => ({
    emotion: entry.emotion,
    weight: entry.weight * reading.intensity,
    source: `${speaker} said: «${words.slice(0, 80)}»`,
    toward: entry.atActor ? speaker : "",
    startedAt: now,
    expiresAt: now + entry.hours * HOUR,
  }));
}

export function parseWordReading(raw: unknown): { kind: WordKind; intensity: 1 | 2 | 3 } {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = (WORD_KINDS as readonly string[]).includes(String(record.kind)) ? (record.kind as WordKind) : "nothing";
  const level = Number(record.intensity);
  return { kind, intensity: level === 3 ? 3 : level === 2 ? 2 : 1 };
}
