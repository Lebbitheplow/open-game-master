// The body of a first-tier NPC as levels the server holds
// (docs/specs/ogm-npc-perception.md §8, after Project Zomboid's moodles):
// thirst, hunger and sleep read from when they last drank, ate and slept;
// wetness and cold carried in the state and moved by the weather, hour by
// hour; pain from the wound. Things that ease a need advertise it, so a mind
// that is cold is told of the blanket on the deck. Pure.
import type { Temperature, Wind } from "@/lib/scene/state";
import { textKey } from "@/lib/language/text-logic";

export type Level = 0 | 1 | 2 | 3 | 4;
export type Moodle = "thirst" | "hunger" | "sleep" | "cold" | "wet" | "pain";
export type Moodles = Record<Moodle, Level>;

export type BodyState = {
  drankAt?: number;
  ateAt?: number;
  sleptAt?: number;
  wet?: number;
  cold?: number;
  condition: string;
};

const HOURS: Record<"thirst" | "hunger" | "sleep", readonly number[]> = {
  thirst: [8, 16, 24, 36],
  hunger: [12, 24, 48, 72],
  sleep: [16, 20, 24, 36],
};

function level(value: number): Level {
  return Math.max(0, Math.min(4, Math.round(value))) as Level;
}

function sinceLevel(at: number | undefined, now: number, steps: readonly number[]): Level {
  if (at === undefined) {
    return 0;
  }
  const hours = (now - at) / 60;
  return steps.filter((step) => hours >= step).length as Level;
}

export function moodles(body: BodyState, now: number): Moodles {
  const none: Moodles = { thirst: 0, hunger: 0, sleep: 0, cold: 0, wet: 0, pain: 0 };
  if (body.condition === "dead") {
    return none;
  }
  return {
    thirst: sinceLevel(body.drankAt, now, HOURS.thirst),
    hunger: sinceLevel(body.ateAt, now, HOURS.hunger),
    sleep: sinceLevel(body.sleptAt, now, HOURS.sleep),
    cold: level(body.cold ?? 0),
    wet: level(body.wet ?? 0),
    pain: body.condition === "wounded" ? 2 : 0,
  };
}

// The weather where the body is, and what keeps it off.
export type Exposure = { temperature: Temperature; wind: Wind; precipitation: 0 | 1 | 2 | 3; sheltered: boolean; covered: boolean };

const BASE_COLD: Record<Temperature, number> = { frigid: 3, cold: 2, mild: 0, warm: 0, hot: 0 };

// The cold a body settles toward in this weather, being this wet.
export function coldTarget(exposure: Exposure, wet: number): Level {
  const chilly = exposure.temperature !== "warm" && exposure.temperature !== "hot";
  let target = BASE_COLD[exposure.temperature];
  if (!exposure.sheltered && (exposure.wind === "gale" || (exposure.wind === "breeze" && wet >= 2))) {
    target += 1;
  }
  if (chilly && wet >= 2) {
    target += 1;
  }
  if (exposure.covered) {
    target -= 1;
  }
  if (exposure.sheltered) {
    target -= 1;
  }
  return level(target);
}

// `hours` whole hours of this weather on the body: rain soaks it one level an
// hour up to how hard it falls, dry air dries it a level every two hours (each
// hour when warm), and the cold moves one level an hour toward what the
// weather, the wind and the wet make it. At most three days are counted.
export function tickBody(body: { wet: number; cold: number }, hours: number, exposure: Exposure): { wet: Level; cold: Level } {
  let wet = level(body.wet);
  let cold = level(body.cold);
  const warm = exposure.temperature === "warm" || exposure.temperature === "hot";
  for (let hour = 1; hour <= Math.min(72, Math.floor(hours)); hour += 1) {
    const soaking = exposure.precipitation > 0 && !exposure.sheltered ? Math.min(4, exposure.precipitation + 1) : 0;
    if (wet < soaking) {
      wet = level(wet + 1);
    } else if (!soaking && wet > 0 && (warm || hour % 2 === 0)) {
      wet = level(wet - 1);
    }
    const target = coldTarget(exposure, wet);
    cold = level(cold + Math.sign(target - cold));
  }
  return { wet, cold };
}

// What the worst of it costs at every check (−1, −2, −3, −5).
const PENALTY = [0, 1, 2, 3, 5] as const;

export function bodyPenalty(levels: Moodles): number {
  return PENALTY[Math.max(...Object.values(levels)) as Level];
}

const WORDS: Record<Moodle, readonly string[]> = {
  thirst: ["", "thirsty", "parched", "badly dehydrated", "dying of thirst"],
  hunger: ["", "peckish", "hungry", "weak with hunger", "starving"],
  sleep: ["", "tired", "drowsy", "struggling to stay awake", "about to collapse asleep"],
  cold: ["", "chilly", "cold", "shivering hard, hands numb", "freezing: hypothermia"],
  wet: ["", "damp", "wet", "soaked", "drenched to the bone"],
  pain: ["", "sore", "in pain", "in great pain", "in agony"],
};

// The levels a mind feels, in plain words; thirst and hunger are left to the
// words that already count the hours (npc-state-logic needsWords).
export function bodyWords(levels: Moodles, skip: readonly Moodle[] = ["thirst", "hunger"]): string {
  return (Object.keys(levels) as Moodle[])
    .filter((moodle) => !skip.includes(moodle) && levels[moodle] > 0)
    .map((moodle) => WORDS[moodle][levels[moodle]])
    .join(", ");
}

// For the referee: how the body weighs on what they try.
export function bodyRefereeWords(levels: Moodles): string {
  const felt = bodyWords(levels, []);
  const penalty = bodyPenalty(levels);
  return felt ? `${felt}${penalty ? ` (body: −${penalty} to checks)` : ""}` : "";
}

// Which needs a thing eases, by its words (the Sims' advertising objects).
const SERVES: Array<[RegExp, Moodle]> = [
  [/\b(acqua|water|barile|botte|borraccia|otre|canteen|waterskin|barrel|rum|vino|wine|birra|ale)\b/, "thirst"],
  [/\b(galletta|gallette|biscott|biscuit|pane|bread|pesce|fish|carne|meat|razion|ration|cibo|food|frutta|fruit|formaggio|cheese|zuppa|stew)/, "hunger"],
  [/\b(coperta|blanket|mantello|cloak|telo|tarp|pelliccia|fur|vela|sail|fuoco|fire|braciere)/, "cold"],
  [/\b(coperta|blanket|giaciglio|bedroll|amaca|hammock)/, "sleep"],
  [/\b(benda|bende|bandage|pozione|potion|unguento|salve|erbe|herbs|kit)/, "pain"],
];

export function serves(thing: string): Moodle[] {
  const words = textKey(thing);
  return [...new Set(SERVES.filter(([pattern]) => pattern.test(words)).map(([, moodle]) => moodle))];
}

export type Visible = { name: string; owner: string; zone?: string };

const WANT: Partial<Record<Moodle, string>> = { thirst: "thirst", hunger: "hunger", cold: "cold", sleep: "tiredness", pain: "pain" };

// For each need at level 2 or more, the things in sight that would ease it,
// whose they are and where: "nobody's" lies free for anyone.
export function adsWords(levels: Moodles, things: readonly Visible[], self: string): string {
  return (Object.keys(WANT) as Moodle[])
    .filter((moodle) => levels[moodle] >= 2)
    .map((moodle) => {
      const easing = things.filter((thing) => serves(thing.name).includes(moodle));
      if (!easing.length) {
        return `Nothing in sight would ease your ${WANT[moodle]}.`;
      }
      const list = easing
        .slice(0, 6)
        .map((thing) => `${thing.name} (${textKey(thing.owner) === textKey(self) ? "yours" : thing.owner ? `${thing.owner}'s` : "nobody's, free to take"}${thing.zone ? `, at ${thing.zone}` : ""})`);
      return `What could ease your ${WANT[moodle]}: ${list.join("; ")}.`;
    })
    .join(" ");
}

export function isCovering(things: readonly string[]): boolean {
  return things.some((thing) => /\b(coperta|blanket|mantello|cloak|pelliccia|fur|telo|tarp)/.test(textKey(thing)));
}
