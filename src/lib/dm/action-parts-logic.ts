// A player's declaration as one call: the pure half.
//
// An agent program in the DM seat calls a tool and waits for its answer, so
// every part of an action that was its own call (each swing of Extra Attack,
// each Flurry of Blows strike, each Eldritch Blast beam, each creature of a
// Whirlwind Attack) cost one of the turn's three tool-bearing model calls,
// and a monk's Attack and Flurry or a fighter's Action Surge never fit. The
// call now carries the whole declaration, `attacks`, one part per attack, and
// the engine resolves the parts in order, each exactly as its own call was
// (src/lib/dm/pc-attack-parts.ts). This module reads the parts and names
// what each is made with.
//
// A part names the feature it is made with by the feature's name, the way
// use_resource names a resource, so one field carries what five did
// (whirlwind, volley, offHand, hordeBreaker, bonusAttack). The flat shape a
// call had before, one attack with those fields, is still read: stored turns,
// the engine's own attacks and agent programs that learned it send it.
//
// The same holds out of a fight: grant_item and purchase take every item of
// a chest or a shopping list (items), and heal every creature one healing
// spell reaches (targets), resolved one by one as the one-entry call each
// was (listedCalls).
//
// No "@/" imports, so the test scripts load it directly.

import { textKey } from "../language/text-logic.ts";
import type { ToolResult } from "./tool-errors.ts";

// The most parts one call takes. Scorching Ray from a 9th-level slot is ten
// rays; a fighter 20's Attack action and Action Surge are eight swings;
// Whirlwind Attack against a ring of eight. Room above the largest for the
// swings a feature adds, and for a chest's items.
export const MAX_PARTS = 20;

// What a part is made with, as the single-attack engine reads it.
export type AttackFeatureKind =
  | "flurry"
  | "martial arts"
  | "frenzy"
  | "off-hand"
  | "horde breaker"
  | "whirlwind"
  | "volley"
  | "action surge"
  // A swing of the Attack action, Extra Attack's own: nothing more.
  | "attack"
  // Any other feature's or feat's bonus-action attack (War Magic, Polearm
  // Master, Crossbow Expert, Pistol and Blade...): the engine finds which.
  | "feature";

// The names a part's `feature` takes, by the SRD's own words. The off-hand
// attack is the rules' Two-Weapon Fighting, not a feature anyone holds.
const NAMED: ReadonlyArray<[string, AttackFeatureKind]> = [
  ["flurry of blows", "flurry"],
  ["martial arts", "martial arts"],
  ["frenzy", "frenzy"],
  ["two weapon fighting", "off-hand"],
  ["off hand", "off-hand"],
  ["horde breaker", "horde breaker"],
  ["whirlwind attack", "whirlwind"],
  ["whirlwind", "whirlwind"],
  ["volley", "volley"],
  ["action surge", "action surge"],
  ["extra attack", "attack"],
  // Haste's extra action buys one weapon attack, and the budget spends it
  // once the Attack action's swings are gone: named, it was sent back as no
  // feature of theirs, and the declared attack cost another model call.
  ["haste", "attack"],
  // A spell's bonus attacks (an authored spell held as a condition).
  ["swift quiver", "feature"],
];

// The names the description and a refusal offer.
export const ATTACK_FEATURE_NAMES = [
  "Flurry of Blows",
  "Martial Arts",
  "Frenzy",
  "Two-Weapon Fighting",
  "Horde Breaker",
  "Whirlwind Attack",
  "Volley",
  "Action Surge",
  "Swift Quiver",
] as const;

// The kind a named feature is, or null for a name none of the rules' own
// features carries (a subclass's or feat's bonus attack, or a mistake: the
// caller asks the sheet which).
export function namedFeatureKind(name: string): AttackFeatureKind | null {
  const key = textKey(name);
  return NAMED.find(([named]) => named === key)?.[1] ?? null;
}

// The single attack a part is, in the flat shape the engine reads: the
// character's id, the part's own fields, and the feature as the fields it
// stands for. A Flurry of Blows strike and a Martial Arts strike are unarmed
// strikes when the part names no weapon (one naming a weapon:
// src/lib/dm/pc-attack-parts.ts).
export function partAttackArgs(
  characterId: string,
  part: Record<string, unknown>,
  kind: AttackFeatureKind | null,
): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(part).filter(([key]) => key !== "feature"));
  const unarmed = rest.weapon === undefined ? { weapon: "unarmed strike" } : {};
  const fields: Record<string, unknown> =
    kind === "flurry"
      ? { ...unarmed, flurryStrike: true }
      : kind === "martial arts"
        ? { ...unarmed, bonusAttack: "martial arts" }
        : kind === "frenzy"
          ? { bonusAttack: "frenzy" }
          : kind === "feature"
            ? { bonusAttack: "feature" }
            : kind === "off-hand"
              ? { offHand: true }
              : kind === "horde breaker"
                ? { hordeBreaker: true }
                : kind === "whirlwind"
                  ? { whirlwind: true }
                  : kind === "volley"
                    ? { volley: true }
                    : {};
  return { ...rest, ...fields, characterId };
}

// The list a call carrying a declaration's parts holds them in, by tool, and
// the field a bare entry stands for (["rope"] is item "rope").
export const PART_LISTS: Readonly<Record<string, { key: string; bare: string }>> = {
  pc_attack: { key: "attacks", bare: "targetEnemyId" },
  cast_at_enemy: { key: "targets", bare: "targetEnemyId" },
  grant_item: { key: "items", bare: "item" },
  purchase: { key: "items", bare: "item" },
  heal: { key: "targets", bare: "characterId" },
};

// The tools whose list the caller resolves entry by entry (the model's turn
// loop, src/lib/dm/turn.ts; the shared dispatch, invoke-dispatch.ts), each
// entry the one-entry call it always was, routed, gated, offered and capped
// as that call: a chest's items, a shopping list, every creature one healing
// spell reaches. pc_attack and cast_at_enemy resolve their own parts.
const LISTED_CALLS: ReadonlySet<string> = new Set(["grant_item", "purchase", "heal"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const without = (record: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

// One part as the one-part call it stands for: what the call says beside the
// list (characterId, the trade's action, a shop, the spell) goes with every
// part, and a list inside a part is no part of it (lists do not nest).
function partArgs(shared: Record<string, unknown>, entry: unknown, list: { key: string; bare: string }): Record<string, unknown> {
  return isRecord(entry) ? { ...shared, ...without(entry, list.key) } : { ...shared, [list.bare]: entry };
}

// The one-entry calls a listed call stands for, or null for a tool that
// lists nothing, a call that names one (the flat shape), or arguments that
// are no object (its handler refuses them).
export function listedCalls(name: string, rawArguments: string): Record<string, unknown>[] | null {
  const list = LISTED_CALLS.has(name) ? PART_LISTS[name] : undefined;
  if (!list) {
    return null;
  }
  let args: unknown;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const entries = isRecord(args) ? args[list.key] : undefined;
  if (!isRecord(args) || !Array.isArray(entries)) {
    return null;
  }
  const shared = without(args, list.key);
  return entries.map((entry: unknown) => partArgs(shared, entry, list));
}

// heal's targets under one healing spell are one casting (SRD 5.1: Mass
// Healing Word, "up to six creatures of your choice"), in a fight and out of
// one alike. Its first entry pays for every creature listed, or for Mass
// Heal's hit points they share, and `left` of those bound the later entries,
// which spend nothing (src/lib/dm/heal-spell.ts). An open cast holds a
// casting across calls in a fight only: out of one, each entry spent a slot.
export type OneCasting = {
  spell: string;
  creatures: number;
  hitPoints: number;
  paid: Record<string, unknown> | null;
  left: number;
};

// The casting a heal list shares, or undefined: no spell named, or entries
// naming different spells or casters (each its own casting).
export function oneCasting(name: string, each: readonly Record<string, unknown>[]): OneCasting | undefined {
  const spell = each[0]?.spell;
  if (name !== "heal" || typeof spell !== "string" || !spell.trim()) {
    return undefined;
  }
  if (!each.every((entry) => entry.spell === spell && entry.casterId === each[0].casterId)) {
    return undefined;
  }
  // An amount sent as "30" is 30, as heal's own schema reads it: counted as
  // none, Mass Heal's later entries found nothing left of the 700.
  const hitPoints = each.reduce((sum, entry) => {
    const amount = Number(entry.amount);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
  return { spell, creatures: each.length, hitPoints, paid: null, left: 0 };
}

// The refusal of a list longer than a call takes, or null.
export function listRefusal(name: string, each: readonly unknown[]): ToolResult | null {
  if (each.length < 1 || each.length > MAX_PARTS) {
    return { error: `${name}: ${PART_LISTS[name].key} lists 1 to ${MAX_PARTS} entries, one each. Nothing changed.`, retry: true };
  }
  // Several creatures under one healing spell are one casting by one caster.
  // With no casterId each entry's creature was its own caster: the first one
  // paid, and the rest rode that slot with their own modifier, or none.
  const uncast = (entry: unknown) => isRecord(entry) && typeof entry.spell === "string" && entry.spell.trim() !== "" && typeof entry.casterId !== "string";
  if (name === "heal" && each.length > 1 && each.some(uncast)) {
    return { error: "heal: targets under a spell are one casting; send casterId, the characterId of the one who casts it. Nothing changed.", retry: true };
  }
  return null;
}

// A call and its answer as the one-part calls its parts stand for, each with
// its own answer: the entry at its place in the answer's list, the answer
// itself for a lone part (partsResult) and for a refusal before any part
// ran. A call with no list is itself. Readers of what a turn's calls did
// (src/lib/dm/engine-boundary.ts) read every part as the call it was.
export function splitParts(
  name: string,
  args: Record<string, unknown>,
  result: Record<string, unknown> | null,
): Array<{ args: Record<string, unknown>; result: Record<string, unknown> | null }> {
  const list = PART_LISTS[name] as { key: string; bare: string } | undefined;
  const entries = list ? args[list.key] : undefined;
  if (!list || !Array.isArray(entries)) {
    return [{ args, result }];
  }
  const shared = without(args, list.key);
  const answers = result && Array.isArray(result[list.key]) ? (result[list.key] as unknown[]) : null;
  return entries.map((entry: unknown, index) => {
    const answer = answers ? answers[index] : result;
    return { args: partArgs(shared, entry, list), result: isRecord(answer) ? answer : null };
  });
}

// Magic Missile's darts over a list of creatures: an entry that names none
// takes an even share of what the entries naming theirs leave, the first
// ones one more. Read alone it took "every dart left", so the first of the
// creatures listed took all of them and the rest were refused. A lone
// creature still takes every dart.
export function spreadDarts<T extends { darts?: number }>(targets: readonly T[], total: number): T[] {
  const open = targets.filter((target) => target.darts === undefined).length;
  if (targets.length < 2 || !open) {
    return [...targets];
  }
  const left = Math.max(0, total - targets.reduce((sum, target) => sum + (target.darts ?? 0), 0));
  let place = 0;
  return targets.map((target) => {
    if (target.darts !== undefined) {
      return target;
    }
    const share = Math.floor(left / open) + (place < left % open ? 1 : 0);
    place += 1;
    return share > 0 ? { ...target, darts: share } : target;
  });
}

// A call's arguments as the entries that resolved, for what credits a call
// with what it did (the waypoint ticks, src/lib/dm/waypoint-tick.ts): a list
// partly refused names only its done entries, so a refused Sun Blade ticks
// no "Recover the Sun Blade". Any other call is itself.
export function doneParts(name: string, rawArguments: string, result: Record<string, unknown>): string {
  const list = PART_LISTS[name] as { key: string; bare: string } | undefined;
  const answers = list ? result[list.key] : undefined;
  if (!list || typeof result.partial !== "string" || !Array.isArray(answers)) {
    return rawArguments;
  }
  let args: unknown;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return rawArguments;
  }
  const entries = isRecord(args) ? args[list.key] : undefined;
  if (!isRecord(args) || !Array.isArray(entries)) {
    return rawArguments;
  }
  const done = entries.filter((_, index) => !(isRecord(answers[index]) && typeof (answers[index] as Record<string, unknown>).error === "string"));
  return JSON.stringify({ ...args, [list.key]: done });
}

// What a person who played a card is told when part of its share was
// refused and the rest landed (the actions route, where the GM at a table
// they run plays a hero's card): each refused entry's reason, in plain
// words, or null when none was. The card is spent, since the others are
// done; refused whole, the call is a refusal of its own.
export function refusedPartsLine(result: Record<string, unknown>): string | null {
  if (typeof result.partial !== "string") {
    return null;
  }
  const answers = Object.values(PART_LISTS)
    .map((list) => result[list.key])
    .find((value): value is unknown[] => Array.isArray(value));
  const reasons = (answers ?? []).flatMap((answer) => (isRecord(answer) && typeof answer.error === "string" ? [answer.error] : []));
  return reasons.length ? `Not all of it landed. ${reasons.join(" ")} The rest is done.` : null;
}

// One answer for a call's parts, under `key`: a lone part's own answer; an
// error when every part was refused, with each one's reason (the call did
// nothing); otherwise every part's answer, the refused among them, and
// which those were.
export function partsResult(outcomes: Record<string, unknown>[], key: string): ToolResult {
  if (outcomes.length === 1) {
    return outcomes[0] as ToolResult;
  }
  const refusals = outcomes.filter((outcome) => typeof outcome.error === "string");
  if (refusals.length === outcomes.length) {
    const [first] = refusals;
    return first.retry === true
      ? { error: String(first.error), retry: true, [key]: outcomes }
      : { error: String(first.error), refused: first.refused === "limit" ? "limit" : "rules", [key]: outcomes };
  }
  if (!refusals.length) {
    return { [key]: outcomes };
  }
  // Which entries are done is said once: a list sent again whole after some
  // were refused bought its bedroll three times (live).
  const refused = outcomes.flatMap((outcome, index) => (typeof outcome.error === "string" ? [index + 1] : []));
  return {
    [key]: outcomes,
    partial: `Entr${refused.length === 1 ? "y" : "ies"} ${refused.join(", ")} of ${outcomes.length} refused; the others are done. A call again sends only what was refused.`,
  };
}
