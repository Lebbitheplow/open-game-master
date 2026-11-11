// Inspiring Leader's rally, the part the counter alone did not hold: "Each
// gains temporary hit points equal to your level plus your Charisma modifier,
// and cannot benefit again until it finishes a rest." The six uses and the
// ten minutes (out of a fight only) are the counter's row
// (src/lib/srd/class-resources.ts inspiring_leader); this file is the mark a
// rallied creature carries until it rests, read by use_resource before the
// use is spent (src/lib/dm/resource-tools.ts) and cleared by the rest
// (src/lib/dm/rest-logic.ts), as a Healer's "tended" mark is.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

export const RALLIED = "rallied by an inspiring leader";
const RALLY_COUNTER = "inspiring_leader";

const isRallied = (target: Pick<CharacterSheet, "conditions">) => target.conditions.some((entry) => entry.toLowerCase() === RALLIED);

// The refusal for a creature already rallied since its last rest, or null:
// asked before anything is spent.
export function rallyRefusal(counterId: string, target: Pick<CharacterSheet, "name" | "conditions">): ToolError | null {
  if (counterId !== RALLY_COUNTER || !isRallied(target)) {
    return null;
  }
  return {
    error: `${target.name} has already been rallied since their last rest; Inspiring Leader's temporary hit points come to a creature once until it finishes a rest. Nothing was spent.`,
    refused: "rules",
  };
}

// What the rally adds to the patch that gives the temporary hit points.
export function rallyMark(counterId: string, target: Pick<CharacterSheet, "conditions">): { conditions?: string[] } {
  return counterId === RALLY_COUNTER && !isRallied(target) ? { conditions: [...target.conditions, RALLIED] } : {};
}
