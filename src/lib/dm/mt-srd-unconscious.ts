// What ends as its holder falls unconscious (SRD 5.1):
//
//   Rage: "It ends early if you are knocked unconscious".
//   Wild Shape: "You automatically revert if you fall unconscious, drop to 0
//   hit points, or die." The fall to 0 in the form is the damage path's
//   (pc-damage.ts, with the excess carried over); fellUnconscious is what
//   patchSheet asks for the sleep or the poison that drops a druid in a
//   beast's shape.
//   Sacred Weapon (Oath of Devotion): "If you are no longer holding or
//   carrying this weapon, or if you fall unconscious, this effect ends."
//   endedByLosingWeapon reads the weapon the effect names in its meta.
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

import { textKey } from "@/lib/language/text-logic";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";

const UNCONSCIOUS = "unconscious";

// Conditions by their engine names ("sacred weapon (+3)" is a sacred weapon).
const ENDS = ["raging", "sacred weapon"];

const holds = (conditions: readonly string[], name: string) => conditions.some((entry) => isConditionNamed(entry, name));

// Whether this write is the one that knocks the sheet out.
export function fellUnconscious(before: readonly string[], after: readonly string[]): boolean {
  return holds(after, UNCONSCIOUS) && !holds(before, UNCONSCIOUS);
}

// The conditions that go as the sheet falls unconscious: empty unless this
// write is the one that knocks them out.
export function endedByFallingUnconscious(before: readonly string[], after: readonly string[]): string[] {
  if (!fellUnconscious(before, after)) {
    return [];
  }
  return after.filter((entry) => isConditionNamed(entry, ...ENDS));
}

const SET_ASIDE: Array<[string, string]> = [
  ["frightened", "fear held off by rage"],
  ["charmed", "charm held off by rage"],
];

type Settled = { conditions: string[]; conditionMeta: Record<string, unknown> };

// The sheet's conditions with a Mindless Rage's suspension applied or lifted,
// or null when nothing moves.
export function rageSuspension(sheet: { conditions: string[]; conditionMeta?: unknown; features: Array<{ name: string }> }): Settled | null {
  const raging = holds(sheet.conditions, "raging") && holdsFeature(sheet, "mindless rage");
  let conditions = sheet.conditions;
  let meta = (sheet.conditionMeta ?? {}) as Record<string, unknown>;
  let moved = false;
  for (const [plain, aside] of SET_ASIDE) {
    const [from, to] = raging ? [plain, aside] : [aside, plain];
    const held = conditions.find((entry) => isConditionNamed(entry, from));
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

// The conditions that rode a weapon the sheet no longer carries.
// A row with no count written is one of it, as everywhere a sheet is read.
export function endedByLosingWeapon(sheet: { conditions: string[]; conditionMeta?: unknown; equipment: Array<{ name: string; qty?: number }> }): string[] {
  const meta = (sheet.conditionMeta ?? {}) as Record<string, { weapon?: string } | undefined>;
  return sheet.conditions.filter((entry) => {
    const weapon = meta[entry]?.weapon;
    return Boolean(weapon) && !sheet.equipment.some((item) => textKey(item.name) === textKey(weapon ?? "") && (item.qty ?? 1) > 0);
  });
}
