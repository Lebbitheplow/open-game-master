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
