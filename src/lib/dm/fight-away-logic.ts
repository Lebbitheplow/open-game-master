import { textKey, words } from "@/lib/language/text-logic";

// Who a fight goes on without (issue 740). start_encounter's `absent` names
// the party characters too far off to reach the fight within a few rounds, or
// unaware of it. They roll no initiative, take no slot in the order and stand
// on no token until an initiative roll brings them in. "Away" here so it does
// not read as encounter-summary.ts absentFighters, who fought and have left
// the party since.

type Named = { id: string; name: string };

export type AwayNames = { ids: string[] } | { error: string };

// A whole name (or a sheet's id) first, so "Alice" still names Alice beside
// an Alice Smith. Only then one word of a name.
function namedBy(asked: string, roster: readonly Named[]): Named[] {
  const key = textKey(asked);
  if (!key) {
    return [];
  }
  const whole = roster.filter((sheet) => sheet.id === asked || textKey(sheet.name) === key);
  return whole.length ? whole : roster.filter((sheet) => words(sheet.name).some((word) => textKey(word) === key));
}

// The sheets `absent` names, or what is wrong with it. Who leaves a fight is
// never guessed: a name that fits nobody or several refuses the whole call.
// One entry may hold several names ("Alice, Bob"), unless it is a whole name
// that has the comma in it ("Alice, the Brave").
export function resolveAwayNames(asked: readonly string[], roster: readonly Named[]): AwayNames {
  const ids = new Set<string>();
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  for (const entry of asked) {
    const names = namedBy(entry, roster).length ? [entry] : entry.split(/[,;]/).map((name) => name.trim()).filter(Boolean);
    for (const name of names) {
      const matches = namedBy(name, roster);
      if (matches.length === 1) {
        ids.add(matches[0].id);
      } else if (matches.length) {
        ambiguous.push(`"${name}" could be ${matches.map((sheet) => sheet.name).join(" or ")}`);
      } else {
        unknown.push(name);
      }
    }
  }
  const refusals = [
    ...(unknown.length ? [`No party character is called ${unknown.map((name) => `"${name}"`).join(", ")}. The party is: ${roster.map((sheet) => sheet.name).join(", ")}.`] : []),
    ...(ambiguous.length ? [`In absent, ${ambiguous.join("; ")}: send the whole name.`] : []),
  ];
  return refusals.length ? { error: `${refusals.join(" ")} No fight was started.` } : { ids: [...ids] };
}

// The sheets at the fight. The caller already holds the encounter, so asking
// costs no read, which is why this is not inside fieldedSheets: most of its
// callers ask about the party outside any fight, and each would pay for a
// lookup and answer a question it did not ask.
export function atTheFight<T extends { id: string }>(encounter: { awayIds: readonly string[] }, sheets: T[]): T[] {
  return encounter.awayIds.length ? sheets.filter((sheet) => !encounter.awayIds.includes(sheet.id)) : sheets;
}

// A creature a spell made goes where its maker goes: left at the fight it
// would roll, stand on the board and act for someone who is not there.
export function withFollowers(ids: readonly string[], sheets: ReadonlyArray<{ id: string; summon?: { casterId: string } | null }>): string[] {
  return [...new Set([...ids, ...sheets.filter((sheet) => sheet.summon && ids.includes(sheet.summon.casterId)).map((sheet) => sheet.id)])];
}

// What a call reaches: who does it, who it lands on, and whether it comes
// from or lands on the fight itself (an enemy, the board).
type Reach = { actor: string; marks: string[]; fight: boolean };

const refs = (...values: unknown[]): string[] =>
  values.flatMap((value) => (typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap((entry) => refs(entry && typeof entry === "object" ? (entry as { characterId?: unknown }).characterId : entry)) : [])).filter(Boolean);
const said = (value: unknown): string => (typeof value === "string" ? value : "");

function reachOf(name: string, args: Record<string, unknown>): Reach | null {
  switch (name) {
    case "aoe_damage": {
      const actor = said(args.casterCharacterId);
      const enemies = refs(args.enemyIds);
      const marks = [...refs(args.characterIds), ...said(args.targets).split(",").map((part) => part.trim()).filter(Boolean), ...enemies];
      return { actor, marks, fight: !actor || enemies.length > 0 || !marks.length };
    }
    case "legendary_action":
      return { actor: "", marks: refs(args.targetCharacterId), fight: true };
    case "declare_intent":
      return { actor: "", marks: refs(args.target), fight: true };
    case "cast_at_player":
      // With no enemy behind it, it is a hazard, and one can be where they are.
      return args.casterEnemyId ? { actor: "", marks: refs(args.characterId), fight: true } : null;
    case "set_condition":
      return args.sourceEnemyId || args.sourceCharacterId ? { actor: said(args.sourceCharacterId), marks: refs(args.characterId), fight: Boolean(args.sourceEnemyId) } : null;
    case "cast_buff":
      return { actor: said(args.characterId), marks: refs(args.targetCharacterIds), fight: Boolean(args.targetEnemyId) };
    case "heal":
      return { actor: said(args.casterId), marks: refs(args.characterId, args.targets), fight: false };
    case "stabilize":
      return { actor: said(args.healerId), marks: refs(args.characterId), fight: false };
    case "use_item":
    case "use_resource":
    case "take_action":
    case "use_reaction":
      return { actor: said(args.characterId), marks: refs(args.targetCharacterId), fight: Boolean(args.targetEnemyId) };
    case "handle_item":
      return { actor: said(args.characterId), marks: refs(args.toCharacterId), fight: false };
    case "pc_attack":
    case "cast_at_enemy":
    case "pet_attack":
      return { actor: said(args.characterId), marks: [], fight: true };
    default:
      return null;
  }
}

// Whether this tool can cross between the fight and someone away, asked first
// so the rest of the tools pay for no read of the encounter.
export function canCrossAway(name: string, args: Record<string, unknown>): boolean {
  return reachOf(name, args) !== null;
}

// No token means no reach for the engine to measure, so a call naming someone
// away landed as if they stood there: a blast, a hold, a touch from across
// the map. Reach does not cross the edge of the fight, either way. Two who are
// away may be together, and what the story does where they are (apply_damage,
// apply_hazard, afflict, a condition or effect with nobody at the fight behind
// it) is no reach from the fight, so it stays the GM's.
export function awayRefusal(name: string, args: Record<string, unknown>, away: readonly Named[]): string | null {
  const reach = reachOf(name, args);
  const named = (ref: string) => away.find((sheet) => sheet.id === ref || textKey(sheet.name) === textKey(ref));
  if (!reach || !away.length) {
    return null;
  }
  const bring = "Bring them in first with their initiative roll (request_roll kind=initiative) if the story has brought them here.";
  const actor = named(reach.actor);
  if (actor) {
    return reach.fight || reach.marks.some((mark) => !named(mark)) ? `${actor.name} is not at this fight, so this cannot reach it. ${bring} Nothing was rolled or spent.` : null;
  }
  const marks = [...new Set(reach.marks.flatMap((mark) => named(mark)?.name ?? []))];
  return marks.length && (reach.fight || reach.actor) ? `${marks.join(" and ")} ${marks.length === 1 ? "is" : "are"} not at this fight, so this cannot reach them. Name someone who is. ${bring} Nothing was rolled or spent.` : null;
}
