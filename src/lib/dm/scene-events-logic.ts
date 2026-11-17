// Scene events (docs/specs/ogm-npc-perception.md §5): what happened in a
// scene, as fields the server can reason over, so who perceived it is
// decided by rules and not by the narrator's prose. Pure; the store is
// src/lib/db/scene-events.ts and the senses src/lib/dm/senses-logic.ts.
//
// On the observer Zattera (2026-11-17) every mind was handed the narrator's
// retelling and nothing else, and the first of seven to act never learned
// what the other six did.
import { clipText, textKey } from "@/lib/language/text-logic";

export const SCENE_VERBS = [
  "speak",
  "whisper",
  "shout",
  "move",
  "take",
  "give",
  "put_down",
  "eat",
  "drink",
  "push",
  "grab",
  "strike",
  "touch",
  "embrace",
  "bind",
  "free",
  "steal",
  "hide",
  "watch",
  "sleep",
  "wake",
  "flee",
  "threaten",
  "help",
  "heal",
  "other",
] as const;
export type SceneVerb = (typeof SCENE_VERBS)[number];

export const SCENE_VOLUMES = ["silent", "whisper", "normal", "shout", "noise"] as const;
export type SceneVolume = (typeof SCENE_VOLUMES)[number];

// Verbs that reach a target's body: felt, even asleep (§7).
export const PHYSICAL_VERBS: ReadonlySet<SceneVerb> = new Set(["push", "grab", "strike", "touch", "embrace", "bind", "free", "heal", "give"]);

// The structured part of what an action did, as the referee states it.
export type EventShape = {
  verb: SceneVerb;
  targets: string[];
  object: string;
  zoneTo: string;
  volume: SceneVolume;
  covert: boolean;
};

export type SceneEvent = EventShape & {
  seq: number;
  turnId: string;
  instant: number;
  place: string;
  actor: string;
  zoneFrom: string;
  stealth: number | null;
  success: boolean;
  speech: string;
  outcome: string;
  // A hero's line in their own words: what they attempt, not how it ended.
  ownWords?: boolean;
};

export type SenseChannel = "sight" | "hearing" | "touch";

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value.trim().toLowerCase()) ? (value.trim().toLowerCase() as T) : fallback;
}

// The shape read from a referee branch, every field checked: a target must be
// one of the people here, anything unknown reads as a plain, open action.
export function readEventShape(record: Record<string, unknown>, people: readonly string[], speech = ""): EventShape {
  const known = new Map(people.map((name) => [textKey(name), name]));
  const targets = (Array.isArray(record.targets) ? record.targets : [])
    .map((entry) => (typeof entry === "string" ? known.get(textKey(entry)) : undefined))
    .filter((name): name is string => Boolean(name));
  const verb = oneOf(SCENE_VERBS, record.verb, speech ? "speak" : "other");
  const fallbackVolume: SceneVolume = verb === "whisper" ? "whisper" : verb === "shout" || verb === "strike" ? "shout" : "normal";
  return {
    verb,
    targets: [...new Set(targets)].slice(0, 6),
    object: typeof record.object === "string" ? clipText(record.object.trim(), 120) : "",
    zoneTo: typeof record.zoneTo === "string" ? clipText(record.zoneTo.trim(), 60) : "",
    volume: oneOf(SCENE_VOLUMES, record.volume, fallbackVolume),
    covert: record.covert === true,
  };
}

// One event as the observer took it in, in the second person when it was
// theirs or done to them. Only the channels it reached are told: seen
// without being heard, the words stay out; heard without being seen, the
// deed does.
export function perceivedLine(event: Pick<SceneEvent, "actor" | "targets" | "speech" | "outcome" | "verb" | "ownWords"> & { volume?: SceneEvent["volume"]; covert?: boolean }, observer: string, channels: readonly SenseChannel[]): string {
  if (event.ownWords && !channels.includes("hearing")) {
    // Seen but not heard: the words stay with who was near enough.
    return channels.includes("sight") ? `You saw ${event.actor} ${event.volume === "whisper" ? "whisper to someone" : "do and say something"}, too far to make out the words.` : "";
  }
  if (event.ownWords) {
    return channels.includes("hearing")
      ? `${event.actor}, a hero, in their own words (what they attempt; how it ended is told elsewhere, or is yours to answer if it was asked of you or done to you or your things): ${clipText(event.outcome, 500)}`
      : "";
  }
  const mine = textKey(event.actor) === textKey(observer);
  const onMe = event.targets.some((name) => textKey(name) === textKey(observer));
  const sees = channels.includes("sight");
  const hears = channels.includes("hearing");
  const feels = channels.includes("touch");
  const words = event.speech ? `«${clipText(event.speech, 300)}»` : "";
  if (mine) {
    return sentences([words ? `You said ${words}` : "", event.outcome ? `You did: ${event.outcome}` : ""]);
  }
  const parts: string[] = [];
  if (sees && event.outcome) {
    parts.push(`${event.covert ? `You caught${onMe ? " it done to you" : ""}, though it was done so as not to be noticed` : onMe ? "Done to you, you saw" : "You saw"}: ${event.outcome}`);
  } else if (feels && onMe && event.outcome) {
    parts.push(`You felt it on your body: ${event.outcome}`);
  }
  if (words && hears) {
    parts.push(sees || feels ? `${event.actor} said ${words}` : `You heard ${event.actor}'s voice say ${words}`);
  } else if (words && sees) {
    parts.push(`${event.actor} spoke, but you could not make out the words`);
  } else if (!sees && hears && !words && event.verb !== "other") {
    parts.push(`You heard ${event.verb === "strike" ? "a blow" : "a sound"} from ${event.actor}'s direction`);
  }
  return sentences(parts);
}

// Each part closed by its own stop, so "...il bordo." is not followed by another.
function sentences(parts: readonly string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => (/[.!?…»"]$/.test(part.trim()) ? part.trim() : `${part.trim()}.`))
    .join(" ");
}

// The volume of a hero's own line, from its words: a whisper or a shout is
// said so, in the table's language or English.
export function heroLineVolume(text: string): SceneVolume {
  const words = textKey(text);
  if (/\b(sussurr|bisbigli|mormor|whisper|murmur)/.test(words)) {
    return "whisper";
  }
  if (/\b(grid|url|strill|shout|yell|scream)/.test(words)) {
    return "shout";
  }
  return "normal";
}
