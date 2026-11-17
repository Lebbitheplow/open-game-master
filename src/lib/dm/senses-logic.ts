// The senses (docs/specs/ogm-npc-perception.md §7): which of the people in a
// place took in an event, and by which channel. Rules over the event and the
// observer's state; no model reads prose to decide who noticed. Pure.
//
// Distance by zone (zones-logic), light and weather narrow sight and hearing;
// a body touched always feels it. Stealth against each watcher comes later.
import { PHYSICAL_VERBS, type SceneEvent, type SenseChannel } from "@/lib/dm/scene-events-logic";
import { distance, type Distance, type PlaceZones } from "@/lib/dm/zones-logic";
import { textKey } from "@/lib/language/text-logic";

export type Observer = {
  id: string;
  name: string;
  // up, wounded, unconscious, dead (npc-state-logic NpcCondition)
  condition: string;
  asleep?: boolean;
  // Where they stand in the place; "" when not known.
  zone?: string;
  // Passive Perception (10 + Wisdom + proficiency, −5 when the body or the
  // dark would give disadvantage), read only against a covert act.
  passive?: number;
};

// What the place lets through: its zones, where the event happened, how far
// the weather lets one see (0 the same zone, 1 next to it, 2 the whole
// place), whether it is dark with no light, and how much wind and rain
// cover voices (each step takes a zone off what a voice reaches).
export type SenseScene = { zones: PlaceZones | null; eventZone: string; sightRange: Distance; dark: boolean; noise: 0 | 1 };

const OPEN_SCENE: SenseScene = { zones: null, eventZone: "", sightRange: 2, dark: false, noise: 0 };

const VOICE_REACH: Record<string, number> = { silent: -1, whisper: 0, normal: 1, shout: 2, noise: 2 };

// The farthest zone a sound of this volume reaches through this weather; a
// whisper still reaches the one leaning in.
export function voiceReach(volume: string, noise: 0 | 1): number {
  const reach = VOICE_REACH[volume] ?? 1;
  return reach <= 0 ? reach : Math.max(0, reach - noise);
}

export type Perception = { observerId: string; channels: SenseChannel[] };

export function perceive(event: Pick<SceneEvent, "actor" | "verb" | "targets" | "volume" | "covert"> & { stealth?: number | null }, observers: readonly Observer[], scene: SenseScene = OPEN_SCENE): Perception[] {
  const out: Perception[] = [];
  for (const observer of observers) {
    if (observer.condition === "dead") {
      continue;
    }
    const isActor = textKey(observer.name) === textKey(event.actor);
    const onMe = event.targets.some((name) => textKey(name) === textKey(observer.name));
    if (isActor) {
      out.push({ observerId: observer.id, channels: ["sight", "hearing", "touch"] });
      continue;
    }
    const channels: SenseChannel[] = [];
    const awake = observer.condition !== "unconscious" && !observer.asleep;
    if (onMe && PHYSICAL_VERBS.has(event.verb) && observer.condition !== "unconscious") {
      channels.push("touch");
    }
    // A covert act escapes whoever's passive Perception falls short of the
    // actor's Stealth roll (§7), its target too unless a hand was laid on
    // them (a purse lifted is not felt); with no roll it escapes all of them.
    const touched = onMe && PHYSICAL_VERBS.has(event.verb);
    const hidden = event.covert && !touched && !(typeof event.stealth === "number" && (observer.passive ?? 10) >= event.stealth);
    const far = observer.zone && scene.eventZone ? distance(scene.zones, observer.zone, scene.eventZone) : 0;
    const seen = far <= scene.sightRange && (!scene.dark || far === 0);
    const heard = far <= voiceReach(event.volume, scene.noise);
    if (awake && seen && !hidden) {
      channels.push("sight");
    }
    if (hidden) {
      // Nothing heard of it either: done so as not to be noticed.
    } else if ((awake && heard) || (observer.asleep && observer.condition !== "unconscious" && heard && (event.volume === "shout" || event.volume === "noise"))) {
      channels.push("hearing");
    }
    if (channels.length) {
      out.push({ observerId: observer.id, channels });
    }
  }
  return out;
}
