// The classes a lineage suits, by the abilities it raises: a race whose +2
// lands on Strength suits the classes that lean on Strength. Read from the
// multiclass table's key abilities (src/lib/srd/multiclass.ts), so it is the
// same rule the game already holds a class to. Only the core classes are
// named; a lineage whose bumps are all the player's to place suits any.
import type { Ability } from "@/lib/schemas/sheet";
import { SRD_CLASSES } from "@/lib/srd";
import { multiclassPrereq } from "@/lib/srd/multiclass";
import { compareNames } from "@/lib/language/text-logic";

export type LineageFit = { kind: "any" } | { kind: "classes"; names: string[] };

export function lineageFits(
  entry: { asi: Partial<Record<Ability, number>>; asiChoice?: { count: number; amount: number; amounts?: number[] } },
  limit = 4,
): LineageFit | null {
  const raised = Object.values(entry.asi).filter((bonus) => (bonus ?? 0) > 0).length;
  if (!raised) {
    return entry.asiChoice ? { kind: "any" } : null;
  }
  // Every score up at once (a human's +1 to all six) favours none.
  if (raised >= 6) {
    return { kind: "any" };
  }
  const scored = SRD_CLASSES.flatMap((klass) => {
    // The best way the class qualifies: the race's bonus on each of its key
    // abilities, summed ("Strength and Charisma" for a paladin).
    const score = Math.max(
      0,
      ...(multiclassPrereq(klass.id) ?? []).map((group) =>
        group.reduce((sum, ability) => sum + (entry.asi[ability] ?? 0), 0),
      ),
    );
    return score > 0 ? [{ name: klass.name, score }] : [];
  });
  if (!scored.length) {
    return entry.asiChoice ? { kind: "any" } : null;
  }
  // The classes the main bump suits; a lineage whose +2 is Constitution
  // (which no class leans on first) is read by its smaller bump instead.
  const best = Math.max(...scored.map((fit) => fit.score));
  const floor = best >= 2 ? 2 : 1;
  scored.splice(0, scored.length, ...scored.filter((fit) => fit.score >= floor));
  scored.sort((a, b) => b.score - a.score || compareNames(a.name, b.name));
  return { kind: "classes", names: scored.slice(0, limit).map((fit) => fit.name) };
}
