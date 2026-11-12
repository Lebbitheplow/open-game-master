// How many conditions a creature's row keeps, and which go when there are
// more. The cap keeps a runaway list (a model naming a mark every line)
// from growing without end; it used to cut the list's tail, so the
// condition just written was the one lost. A creature already carrying ten
// marks spent its reaction on Shield and the +5 AC was never kept
// (L822-shield-lost-to-condition-cap; SRD 5.1 Shield: "Until the start of
// your next turn, you have a +5 bonus to AC").
//
// What goes first is the oldest mark nothing laid with a lifetime or a
// source (no conditionMeta entry: a free mark of the story's, "muddy",
// "singed"); what the engine laid (a spell's restraint, Shield until the
// turn's start, a reaction readied) is kept ahead of them, newest first
// among themselves. Every writer of an enemy's conditions goes through
// keptConditions (src/lib/db/encounters.ts).

export const MAX_CREATURE_CONDITIONS = 10;

export function keptConditions(conditions: readonly string[], meta: Readonly<Record<string, unknown>> | null | undefined): string[] {
  if (conditions.length <= MAX_CREATURE_CONDITIONS) {
    return [...conditions];
  }
  const laid = new Set(conditions.filter((name) => meta && meta[name] !== undefined));
  const keptLaid = conditions.filter((name) => laid.has(name)).slice(-MAX_CREATURE_CONDITIONS);
  const room = MAX_CREATURE_CONDITIONS - keptLaid.length;
  const keptFree = room > 0 ? conditions.filter((name) => !laid.has(name)).slice(-room) : [];
  const keep = new Set([...keptLaid, ...keptFree]);
  return conditions.filter((name) => keep.has(name));
}
