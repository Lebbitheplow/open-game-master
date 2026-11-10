// What ends as its holder falls unconscious (SRD 5.1):
//
//   Rage: "It ends early if you are knocked unconscious".
//   Sacred Weapon (Oath of Devotion): "if you fall unconscious, this effect
//   ends."
//
// A character is knocked out by many routes (damage to 0 hit points, a Sleep
// spell, a drow's poison through set_condition, an attack's rider), so the
// rule sits at the one door every route writes through: patchSheet
// (src/lib/db/sheets.ts) asks endedByFallingUnconscious as the unconscious
// condition lands. A condition that ends with consciousness is added to ENDS
// here, not at the routes.
//
//
// Mindless Rage (Path of the Berserker): "If you are charmed or frightened
// when you enter your rage, the effect is suspended for the duration of the
// rage." A rage begins at one door and ends at many, so the suspension is
// settled at the same write: rageSuspension sets a raging Berserker's charm
// and fear aside under names no rule reads, their clocks still running, and
// gives them back with whatever write ends the rage.
//
// Pure.

const UNCONSCIOUS = "unconscious";

const ENDS = [/^raging$/i, /^sacred weapon\b/i];

const holds = (conditions: readonly string[], name: string) => conditions.some((entry) => entry.trim().toLowerCase() === name);

// The conditions that go as the sheet falls unconscious: empty unless this
// write is the one that knocks them out.
export function endedByFallingUnconscious(before: readonly string[], after: readonly string[]): string[] {
  if (!holds(after, UNCONSCIOUS) || holds(before, UNCONSCIOUS)) {
    return [];
  }
  return after.filter((entry) => ENDS.some((pattern) => pattern.test(entry.trim())));
}

const SET_ASIDE: Array<[string, string]> = [
  ["frightened", "fear held off by rage"],
  ["charmed", "charm held off by rage"],
];

type Settled = { conditions: string[]; conditionMeta: Record<string, unknown> };

// The sheet's conditions with a Mindless Rage's suspension applied or lifted,
// or null when nothing moves.
export function rageSuspension(sheet: { conditions: string[]; conditionMeta?: unknown; features: Array<{ name: string }> }): Settled | null {
  const raging = holds(sheet.conditions, "raging") && sheet.features.some((feature) => /^mindless rage\b/i.test(feature.name.trim()));
  let conditions = sheet.conditions;
  let meta = (sheet.conditionMeta ?? {}) as Record<string, unknown>;
  let moved = false;
  for (const [plain, aside] of SET_ASIDE) {
    const [from, to] = raging ? [plain, aside] : [aside, plain];
    const held = conditions.find((entry) => entry.trim().toLowerCase() === from);
    if (!held) {
      continue;
    }
    moved = true;
    const rest = { ...meta };
    const carried = rest[held];
    delete rest[held];
    // Already there under the other name (a fear laid before this one was
    // given back): the one coming over is dropped.
    if (holds(conditions, to)) {
      conditions = conditions.filter((entry) => entry !== held);
      meta = rest;
      continue;
    }
    conditions = conditions.map((entry) => (entry === held ? to : entry));
    meta = carried === undefined ? rest : { ...rest, [to]: carried };
  }
  return moved ? { conditions, conditionMeta: meta } : null;
}
