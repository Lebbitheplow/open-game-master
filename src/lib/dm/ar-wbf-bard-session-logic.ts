// Spirit Session (College of Spirits 6): "you learn one divination or
// necromancy spell from any class's list, of a level you can cast and no
// higher than the number of creatures who took part; it counts as a bard
// spell, doesn't count against your spells known, and stays until you start a
// long rest." The spell sits in the bard's prepared list (their cantrips for
// a cantrip), never in the spells they know, under a mark that names it; the
// long rest takes both away. Pure: the rest patch reads it (rest-logic.ts).
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { textKey } from "@/lib/language/text-logic";

const MARK = /^spirit session \((.+)\)$/i;
export const SESSION_SCHOOLS = ["divination", "necromancy"];

export const sessionMark = (spell: string) => `spirit session (${spell.trim()})`;

// A use spent with no spell named waits for it under these marks, by counter
// (src/lib/dm/ar-wbf-doors.ts); a long rest clears one nobody answered.
export const UNSPOKEN: Record<string, string> = {
  sub_spirit_session: "spirit session unspoken",
  sub_limited_wish: "limited wish unspoken",
};
const UNSPOKEN_KEYS = new Set(Object.values(UNSPOKEN).map((entry) => textKey(entry)));

type Lists = { prepared?: string[]; cantrips?: string[] } & Record<string, unknown>;
type Rested = { conditions: string[]; conditionMeta?: unknown; spellcasting?: Lists | null };

// What a long rest adds to its patch for a bard still holding a session's
// spell: the lists without it, the conditions without its mark. Empty when
// there is none. `patch` is the rest's patch so far, read before the sheet.
export function sessionForgotten(sheet: Rested, patch: Partial<Rested>): Partial<Rested> {
  const conditions = patch.conditions ?? sheet.conditions;
  const marks = conditions.filter((entry) => MARK.test(entry.trim()) || UNSPOKEN_KEYS.has(textKey(entry)));
  if (!marks.length) {
    return {};
  }
  // A condition's name is kept in lower case: the spell is found by its key.
  const spells = new Set(marks.flatMap((entry) => { const named = MARK.exec(entry.trim()); return named ? [textKey(named[1])] : []; }));
  const meta = { ...((patch.conditionMeta ?? sheet.conditionMeta ?? {}) as ConditionMetaMap) };
  for (const mark of marks) {
    delete meta[mark];
  }
  const casting = patch.spellcasting ?? sheet.spellcasting;
  // The sheet's own lists and each class's view of them (a sheet keeps the
  // spell under both; one left in a view comes back into the list).
  const without = (names: string[] | undefined) => (names ?? []).filter((name) => !spells.has(textKey(name)));
  const strip = <T extends Lists>(lists: T): T => ({
    ...lists,
    ...(lists.prepared ? { prepared: without(lists.prepared) } : {}),
    ...(lists.cantrips ? { cantrips: without(lists.cantrips) } : {}),
  });
  const views = casting && Array.isArray(casting.casters) ? (casting.casters as Lists[]) : null;
  return {
    conditions: conditions.filter((entry) => !marks.includes(entry)),
    conditionMeta: meta,
    ...(casting ? { spellcasting: { ...strip(casting), ...(views ? { casters: views.map(strip) } : {}) } } : {}),
  };
}
