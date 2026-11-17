// The senses (docs/specs/ogm-npc-perception.md §7): which of the people in a
// place took in an event, and by which channel. Rules over the event and the
// observer's state; no model reads prose to decide who noticed. Pure.
//
// Distance by zone, light, weather and stealth narrow these channels in
// later slices; today everyone awake in the place sees and hears what is not
// done covertly, and a body touched always feels it.
import { PHYSICAL_VERBS, type SceneEvent, type SenseChannel } from "@/lib/dm/scene-events-logic";
import { textKey } from "@/lib/language/text-logic";

export type Observer = {
  id: string;
  name: string;
  // up, wounded, unconscious, dead (npc-state-logic NpcCondition)
  condition: string;
  asleep?: boolean;
};

export type Perception = { observerId: string; channels: SenseChannel[] };

export function perceive(event: Pick<SceneEvent, "actor" | "verb" | "targets" | "volume" | "covert">, observers: readonly Observer[]): Perception[] {
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
    // A covert act is seen by its target alone until stealth is rolled
    // against each watcher (slice 7).
    if (awake && (!event.covert || onMe)) {
      channels.push("sight");
      if (event.volume !== "silent") {
        channels.push("hearing");
      }
    } else if (observer.asleep && (event.volume === "shout" || event.volume === "noise")) {
      channels.push("hearing");
    }
    if (channels.length) {
      out.push({ observerId: observer.id, channels });
    }
  }
  return out;
}
