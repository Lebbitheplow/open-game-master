import { z } from "zod";
import { textKey } from "@/lib/language/text-logic";

// The dice script of a test table (issue 685): a seed, so a fight played
// twice rolls the same faces, and a queue of faces forced on the rolls they
// are aimed at ("the next enemy attack's d20 is a 20", "the next death save
// is a 1"), so an author can walk their fight into the moment they want to
// see. Only a test table (campaigns.kind 'playtest') ever reads one: the
// server's dice are honest everywhere else by construction
// (src/lib/db/dice-scripts.ts asks the table's kind before every die).
//
// Pure: the rules of matching, seeding and describing, with no database.

export const DICE_ROLLERS = ["any", "enemy", "hero"] as const;
export type DiceRoller = (typeof DICE_ROLLERS)[number];

// What a forced face is aimed at. Every kind but damage is a roll of the
// d20; "any" is any d20 roll at all (an attack, a save, a check, a death
// save, an initiative, or a d20 the engine rolls for itself).
export const DICE_KINDS = ["any", "attack", "damage", "save", "death_save", "initiative", "check"] as const;
export type DiceKind = (typeof DICE_KINDS)[number];

// What a roll site can say it rolls: one of the kinds, never "any".
export type RollKindTag = Exclude<DiceKind, "any">;

export type ForcedFace = {
  roller: DiceRoller;
  kind: DiceKind;
  face: number;
  // The creature the roll must be for, by its name on the table (a hero's
  // sheet name, an enemy's numbered name such as "Goblin 2"), matched whole
  // by textKey: "Goblin" never takes "Goblin 2"'s roll, so a face aimed at
  // one goblin of three lands on that goblin. Absent: anyone the roller and
  // kind allow.
  who?: string;
};

export type DiceScript = { seed: number | null; queue: ForcedFace[] };

// A face the script spent, for the table to read back ("used: an enemy's
// attack roll, d20 = 20 (Goblin 1)").
export type UsedFace = {
  roller: "enemy" | "hero" | null;
  kind: RollKindTag | null;
  who: string | null;
  sides: number;
  face: number;
  at: string;
};

// What a roll site says about the die it is rolling. `who` is every
// creature the roll is for: one name, or a group's names when one roll
// stands for all of them (a group's initiative, SRD 5.1).
export type RollTag = {
  roller: "enemy" | "hero";
  kind: RollKindTag;
  who?: string | readonly string[];
};

export type RollPurpose = Partial<RollTag> & { sides: number };

// A stored roll's kind (src/lib/db/rolls.ts RollKind) as the script aims at
// it; a custom roll is aimed at by nothing but "any".
const STORED_KINDS: Record<string, RollKindTag> = {
  attack: "attack",
  damage: "damage",
  saving_throw: "save",
  ability_check: "check",
  skill_check: "check",
  initiative: "initiative",
};

// A hero's roll of a stored kind, for the sites that roll whatever kind
// they were asked (request_roll, a parked roll rolled for its player).
export function heroRollTag(kind: string, who?: string): RollTag | undefined {
  const tagged = STORED_KINDS[kind];
  if (!tagged) {
    return undefined;
  }
  return who ? { roller: "hero", kind: tagged, who } : { roller: "hero", kind: tagged };
}

export const DICE_SCRIPT_LIMITS = {
  // A test is a few rounds: forty forced faces is far past any one fight,
  // and a short list keeps the sheet that edits it readable on a phone.
  queue: 40,
  // The faces spent, newest kept.
  used: 40,
  who: 80,
  face: { min: 1, max: 100 },
  // mulberry32 takes a 32-bit state.
  seed: { min: 0, max: 4_294_967_295 },
} as const;

const D20 = 20;

export const forcedFaceSchema = z
  .object({
    roller: z.enum(DICE_ROLLERS),
    kind: z.enum(DICE_KINDS),
    // Up to a d100's faces; whether the die rolled can show it is decided as
    // it is rolled (forcedFits), since the same aim can meet a d6 or a d20.
    face: z.number().int().min(DICE_SCRIPT_LIMITS.face.min).max(DICE_SCRIPT_LIMITS.face.max),
    who: z.string().trim().max(DICE_SCRIPT_LIMITS.who).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (forcesWholeD20(value.kind) && value.face > D20) {
      context.addIssue({ code: "custom", path: ["face"], message: "Only a damage die can show more than 20: pick a face from 1 to 20 for a d20 roll." });
    }
  })
  .transform((value): ForcedFace => (value.who ? value : { roller: value.roller, kind: value.kind, face: value.face }));

export const diceScriptSchema = z
  .object({
    seed: z.number().int().min(DICE_SCRIPT_LIMITS.seed.min).max(DICE_SCRIPT_LIMITS.seed.max).nullable(),
    queue: z.array(forcedFaceSchema).max(DICE_SCRIPT_LIMITS.queue),
  })
  .strict();

function namesOf(who: RollPurpose["who"]): readonly string[] {
  if (who === undefined) {
    return [];
  }
  return typeof who === "string" ? [who] : who;
}

// Does this forced face fit the die being rolled now? A face is never put on
// a die that cannot show it (a 20 on a d8). Every kind but damage is a d20,
// and damage never takes a d20 kind's face.
export function forcedFits(forced: ForcedFace, purpose: RollPurpose): boolean {
  if (forced.face > purpose.sides) {
    return false;
  }
  if (forced.kind === "damage") {
    if (purpose.kind !== "damage") {
      return false;
    }
  } else {
    if (purpose.sides !== D20 || purpose.kind === "damage") {
      return false;
    }
    if (forced.kind !== "any" && purpose.kind !== forced.kind) {
      return false;
    }
  }
  if (forced.roller !== "any" && purpose.roller !== forced.roller) {
    return false;
  }
  if (forced.who) {
    const aim = textKey(forced.who);
    return namesOf(purpose.who).some((name) => textKey(name) === aim);
  }
  return true;
}

// The first queued face this die takes, or -1. A face waits in the queue
// until a roll it fits comes, so "the next death save is a 1" stays put
// through the attacks rolled before it.
export function matchForced(queue: readonly ForcedFace[], purpose: RollPurpose): number {
  return queue.findIndex((forced) => forcedFits(forced, purpose));
}

// A kind whose forced face is the face the roll keeps: with advantage or
// disadvantage both d20s show it (src/lib/dice.ts rollExpression), so a
// forced 20 is a natural 20 whatever the second die would have been.
export function forcesWholeD20(kind: DiceKind): boolean {
  return kind !== "damage";
}

// ---- the seed ----
//
// mulberry32, as scripts/lib/enforce-world.mjs seedDice uses: small, fast,
// and the same sequence on every machine. Its whole state is one 32-bit
// number, stored after every die, so the sequence carries on across calls
// and across a restart of the server instead of starting over.

export function seedState(seed: number): number {
  return seed >>> 0;
}

export function seededFace(state: number, sides: number): { face: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { face: 1 + Math.floor(unit * sides), state: next };
}

// A spent face as the table reads it back. A group's roll names everyone
// it stood for.
export function usedFace(forced: ForcedFace, purpose: RollPurpose, at: string): UsedFace {
  const names = namesOf(purpose.who);
  const who = forced.who ?? (names.length ? names.join(", ") : null);
  return {
    roller: purpose.roller ?? null,
    kind: purpose.kind ?? null,
    who: who ? who.slice(0, DICE_SCRIPT_LIMITS.who) : null,
    sides: purpose.sides,
    face: forced.face,
    at,
  };
}

// The newest spent faces, capped.
export function withUsed(used: readonly UsedFace[], entry: UsedFace): UsedFace[] {
  return [...used, entry].slice(-DICE_SCRIPT_LIMITS.used);
}

// ---- a revert ----
//
// "Revert this turn" gives back what the turn spent of the script (issue
// 685), so the turn played again rolls what it rolled: each forced face goes
// back where it stood in the queue and off the spent list, and the seed goes
// back to where the turn found it.

export type SpentFace = { forced: ForcedFace; position: number; used: UsedFace };

// The faces come oldest first, as the turn spent them; they go back newest
// first, so each lands where it stood when it was taken.
export function giveBackFaces(
  queue: readonly ForcedFace[],
  used: readonly UsedFace[],
  spent: readonly SpentFace[],
): { queue: ForcedFace[]; used: UsedFace[] } {
  const nextQueue = [...queue];
  const nextUsed = [...used];
  for (const face of [...spent].reverse()) {
    nextQueue.splice(Math.min(Math.max(0, face.position), nextQueue.length), 0, face.forced);
    // The spent line it wrote: the same die, face and moment.
    const at = nextUsed.findLastIndex((entry) => entry.at === face.used.at && entry.sides === face.used.sides && entry.face === face.used.face);
    if (at >= 0) {
      nextUsed.splice(at, 1);
    }
  }
  return { queue: nextQueue.slice(0, DICE_SCRIPT_LIMITS.queue), used: nextUsed };
}

// How far one turn ran the seed: its state and count as the turn found them
// and as it left them.
export type SeedRun = { seed: number; from: { state: number; rolls: number }; to: { state: number; rolls: number } };

// The seed back where the turn found it, or null when it has rolled on since
// (another turn's dice) or another seed was set: it carries on from where it
// is, as the clock stays where a later turn moved it.
export function rewindSeed(
  current: { seed: number | null; state: number | null; rolls: number },
  run: SeedRun,
): { state: number; rolls: number } | null {
  if (current.seed !== run.seed) {
    return null;
  }
  return (current.state ?? seedState(run.seed)) === run.to.state ? run.from : null;
}

// ---- words ----

const KIND_LABELS: Record<DiceKind, { word: string; title: string }> = {
  any: { word: "d20 roll", title: "Any d20 roll" },
  attack: { word: "attack roll", title: "Attack roll" },
  damage: { word: "damage die", title: "Damage die" },
  save: { word: "saving throw", title: "Saving throw" },
  death_save: { word: "death save", title: "Death save" },
  initiative: { word: "initiative roll", title: "Initiative roll" },
  check: { word: "ability check", title: "Ability check" },
};

// "attack roll", inside a sentence.
export function kindLabel(kind: DiceKind): string {
  return KIND_LABELS[kind].word;
}

// "Attack roll", at the head of a line or a picker's row.
export function kindTitle(kind: DiceKind): string {
  return KIND_LABELS[kind].title;
}

export function rollerLabel(roller: DiceRoller): string {
  return roller === "enemy" ? "an enemy's" : roller === "hero" ? "a hero's" : "the next";
}

// "Goblin 2's attack roll: 20", "an enemy's damage die: 6", "the next death
// save: 1".
export function describeForced(forced: ForcedFace): string {
  const whose = forced.who ? `${forced.who}'s` : rollerLabel(forced.roller);
  return `${whose} ${kindLabel(forced.kind)}: ${forced.face}`;
}

// "Enemy attack roll, d20 = 20 (Goblin 1)".
export function describeUsed(used: UsedFace): string {
  const kind = used.kind ? kindLabel(used.kind) : "roll";
  const lead = used.roller === "enemy" ? `Enemy ${kind}` : used.roller === "hero" ? `Hero ${kind}` : used.kind ? kindTitle(used.kind) : "A roll";
  return `${lead}, d${used.sides} = ${used.face}${used.who ? ` (${used.who})` : ""}`;
}

// The script in a line, for the test table's banner and a set-up's summary.
export function describeDiceScript(script: DiceScript): string {
  const parts: string[] = [];
  if (script.seed !== null) {
    parts.push(`Seed ${script.seed}: the same dice each time the fight is played the same way.`);
  }
  if (script.queue.length) {
    parts.push(`Forced next: ${script.queue.map(describeForced).join("; ")}.`);
  }
  return parts.length ? parts.join(" ") : "Ordinary dice: no seed and nothing forced.";
}
