// The training an option of an authored subclass feature gives once it is
// chosen: Aspect of the Beast's Tiger ("Tiger makes you proficient in two of
// Athletics, Acrobatics, Stealth and Survival"). The option is chosen in play
// (use_resource Aspect of the Beast), so the pick is owed from then on, as a
// pick that may wait is (subclass-training.ts `optional`). Read by
// subclass-training.ts subclassGrants. Pure.
import { textKey } from "@/lib/language/text-logic";

export type OptionTraining = { name: string; classId: string; subclass: string; level: number; pickSkills: number; skillsFrom: string[] };

const TABLE: Array<Omit<OptionTraining, "name"> & { feature: string; option: string }> = [
  { classId: "barbarian", subclass: "Path of the Totem Warrior", level: 6, feature: "Aspect of the Beast", option: "Tiger", pickSkills: 2, skillsFrom: ["athletics", "acrobatics", "stealth", "survival"] },
];

export function optionTraining(
  classes: ReadonlyArray<{ id: string; level: number; subclass?: string | null }>,
  features: ReadonlyArray<{ name: string }>,
): OptionTraining[] {
  const held = new Set(features.map((feature) => textKey(feature.name)));
  return TABLE.filter(
    (row) =>
      classes.some((entry) => textKey(entry.id) === row.classId && textKey(entry.subclass ?? "") === textKey(row.subclass) && entry.level >= row.level) &&
      held.has(textKey(`${row.feature} (${row.option})`)),
  ).map(({ feature, option, ...rest }) => ({ ...rest, name: `${feature} (${option})` }));
}
