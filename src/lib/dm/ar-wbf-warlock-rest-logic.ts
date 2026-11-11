// Who a rest's shared temporary hit points reach when the feature says "up to
// N creatures of your choice" and more than N rested beside its holder
// (Celestial Resilience: "up to five creatures of your choice you can see").
//
// The ruling (maintainer's delegate, /tmp/odm-gapstudy/AR-SPLIT.md): take_rest
// gains no field for the choice. With more than N others resting, the N with
// the fewest hit points gain them, ties broken by rest order, and the rest's
// result names who gained them and who went without, so the table can ask the
// GM to change it. With N or fewer others, every one of them gains them.
//
// Read by src/lib/dm/authored-turns.ts authoredRestTempHp, the one door a
// rest's temporary hit points pass.
//
// Pure.

export type Rested = { id: string; name: string; currentHp: number };

export function restAlliesChosen<T extends Rested>(others: T[], count: number): { chosen: T[]; passedOver: T[] } {
  if (others.length <= count) {
    return { chosen: others, passedOver: [] };
  }
  // Fewest hit points first; the sort keeps rest order between equals.
  const ranked = others.map((entry, order) => ({ entry, order })).sort((a, b) => a.entry.currentHp - b.entry.currentHp || a.order - b.order);
  const picked = new Set(ranked.slice(0, count).map(({ entry }) => entry.id));
  return { chosen: others.filter((entry) => picked.has(entry.id)), passedOver: others.filter((entry) => !picked.has(entry.id)) };
}

// The line a rest's result carries when somebody went without.
export function passedOverLine(feature: string, holder: string, count: number, chosen: Rested[], passedOver: Rested[]): string | null {
  if (!passedOver.length) {
    return null;
  }
  const names = (list: Rested[]) => list.map((entry) => entry.name).join(", ");
  return `${feature}: more than ${count} creatures rested beside ${holder}, so the ${count} with the fewest hit points gain the temporary hit points (${names(chosen)}); ${names(passedOver)} went without. The choice is ${holder}'s: if they name others, the GM moves the temporary hit points.`;
}
