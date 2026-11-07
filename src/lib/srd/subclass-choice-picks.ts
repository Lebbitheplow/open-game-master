// A workshop subclass's own choices on a character (issue #833): which are
// open at the character's class levels, which option each holds, and what
// that option grants. The choices themselves are the workshop's
// (src/lib/content/subclass-choices.ts), read through the table's subclass
// extras (src/lib/srd/subclass-tables.ts): the server passes the table's own,
// the browser reads what it registered.
//
// The pick is a "choice" feature, "Bloodline (Storm)". The regrant
// (src/lib/srd/features.ts populateFeaturesForClasses) keeps one per choice
// while the subclass offers it at the class's level, and writes the option's
// damage type and resistances beside it as class features; the training
// (src/lib/srd/subclass-training.ts) gives its skills and languages; the
// subclass's spells (features.ts subclassSpellsFor) its spells. Pure.

import type { SheetFeature } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import {
  parseSubclassChoicePick,
  subclassChoiceFeatureNames,
  subclassChoiceSpellsAt,
  subclassChoiceSummary,
  type SubclassChoice,
  type SubclassChoiceOption,
} from "@/lib/content/subclass-choices";
import { browserSubclassExtras, type ExtraSubclass, type SubclassExtras } from "@/lib/srd/subclass-tables";
import { subclassNamedBare, subclassNamedExactly } from "@/lib/srd/subclass-name";

type Entry = { id: string; subclass?: string | null; level: number };
type Named = ReadonlyArray<{ name: string }>;

// The workshop or pack subclass a sheet's subclass string names, from the
// extras given, else the browser's registered ones.
export function extraSubclassFor(classId: string, stored: string, extras?: SubclassExtras): ExtraSubclass | null {
  const list = (extras ?? browserSubclassExtras())[classId] ?? [];
  return (
    list.find((entry) => subclassNamedExactly(stored, entry.name)) ??
    list.find((entry) => subclassNamedBare(stored, entry.name)) ??
    null
  );
}

export type SubclassChoiceSlot = {
  classId: string;
  // The workshop subclass's own name.
  subclass: string;
  label: string;
  // The class level it is chosen at.
  level: number;
  options: SubclassChoiceOption[];
  chosen: SubclassChoiceOption | null;
};

const sameLabel = (choice: SubclassChoice, label: string) => textKey(choice.label) === textKey(label);
const optionNamed = (choice: SubclassChoice, name: string) =>
  choice.options.find((option) => textKey(option.name) === textKey(name)) ?? null;

// The option a sheet's features hold for a choice: the first "Label
// (Option)" naming one it offers.
function heldOption(choice: SubclassChoice, features: Named): SubclassChoiceOption | null {
  for (const feature of features) {
    const parsed = parseSubclassChoicePick(feature.name);
    const option = parsed && sameLabel(choice, parsed.label) ? optionNamed(choice, parsed.option) : null;
    if (option) {
      return option;
    }
  }
  return null;
}

// Every workshop choice open at the classes' levels, with the option held.
export function subclassChoiceSlots(classes: Entry[], features: Named, extras?: SubclassExtras): SubclassChoiceSlot[] {
  const slots: SubclassChoiceSlot[] = [];
  for (const entry of classes) {
    const stored = (entry.subclass ?? "").trim();
    const extra = stored ? extraSubclassFor(entry.id, stored, extras) : null;
    for (const choice of extra?.choices ?? []) {
      if (choice.level <= entry.level) {
        slots.push({
          classId: entry.id,
          subclass: extra!.name,
          label: choice.label,
          level: choice.level,
          options: choice.options,
          chosen: heldOption(choice, features),
        });
      }
    }
  }
  return slots;
}

// The class features the held options grant: their damage types and
// resistances, tagged with the class that grants them.
export function subclassChoiceGrantedFeatures(classes: Entry[], features: Named, extras?: SubclassExtras): SheetFeature[] {
  return subclassChoiceSlots(classes, features, extras).flatMap((slot) =>
    slot.chosen
      ? subclassChoiceFeatureNames(slot.label, slot.chosen).map((name) => ({
          name,
          source: "class" as const,
          level: slot.level,
          classId: slot.classId,
        }))
      : [],
  );
}

// Whether any subclass in the extras offers this pick.
export function isSubclassChoicePick(name: string, extras?: SubclassExtras): boolean {
  const parsed = parseSubclassChoicePick(name);
  if (!parsed) {
    return false;
  }
  return Object.values(extras ?? browserSubclassExtras()).some((tables) =>
    tables.some((table) => (table.choices ?? []).some((choice) => sameLabel(choice, parsed.label) && optionNamed(choice, parsed.option))),
  );
}

// Whether the regrant keeps a "choice" feature as a workshop pick: true to
// keep it (the first pick of a choice the class's subclass offers at its
// level), false to drop it (a second pick, one made early, an option the
// choice no longer offers, or a pick of a subclass the sheet no longer
// holds), undefined when it is no workshop pick these extras know, so a path
// that reads no extras leaves it as it is.
export function subclassChoicePickKept(
  name: string,
  classes: Entry[],
  extras: SubclassExtras | undefined,
  taken: Set<string>,
): boolean | undefined {
  const parsed = parseSubclassChoicePick(name);
  if (!parsed) {
    return undefined;
  }
  for (const entry of classes) {
    const stored = (entry.subclass ?? "").trim();
    const choice = stored ? extraSubclassFor(entry.id, stored, extras)?.choices?.find((held) => sameLabel(held, parsed.label)) : undefined;
    if (!choice) {
      continue;
    }
    const key = `${entry.id}|${textKey(choice.label)}`;
    if (choice.level > entry.level || !optionNamed(choice, parsed.option) || taken.has(key)) {
      return false;
    }
    taken.add(key);
    return true;
  }
  return isSubclassChoicePick(name, extras) ? false : undefined;
}

// Why the picks a request sends cannot be made, in plain words: an option
// the choice does not offer, one chosen before its level, or two for one
// choice. Empty when they can.
export function subclassChoicePickProblems(sent: Named, classes: Entry[], extras?: SubclassExtras): string[] {
  const problems: string[] = [];
  const made = new Map<string, string>();
  for (const feature of sent) {
    const parsed = parseSubclassChoicePick(feature.name);
    if (!parsed) {
      continue;
    }
    for (const entry of classes) {
      const stored = (entry.subclass ?? "").trim();
      const extra = stored ? extraSubclassFor(entry.id, stored, extras) : null;
      const choice = extra?.choices?.find((held) => sameLabel(held, parsed.label));
      if (!extra || !choice) {
        continue;
      }
      const option = optionNamed(choice, parsed.option);
      if (!option) {
        problems.push(
          `"${parsed.option}" is not one of ${extra.name}'s ${choice.label} options; pick one of ${choice.options.map((entry) => entry.name).join(", ")}.`,
        );
      } else if (choice.level > entry.level) {
        problems.push(`${extra.name}'s ${choice.label} is chosen at class level ${choice.level}; this character is level ${entry.level} in that class.`);
      } else {
        const key = `${entry.id}|${textKey(choice.label)}`;
        const before = made.get(key);
        if (before && textKey(before) !== textKey(option.name)) {
          problems.push(`${extra.name}'s ${choice.label} is one pick; ${before} and ${option.name} were both chosen.`);
        }
        made.set(key, before ?? option.name);
      }
      break;
    }
  }
  return problems;
}

// What the held options train the character in, one grant per pick: its
// skills and languages, at the level the choice is made.
export type SubclassChoiceTraining = {
  name: string;
  classId: string;
  subclass: string;
  level: number;
  skills: string[];
  languages: string[];
};

export function subclassChoiceTraining(classes: Entry[], features: Named, extras?: SubclassExtras): SubclassChoiceTraining[] {
  return subclassChoiceSlots(classes, features, extras).flatMap((slot) =>
    slot.chosen && (slot.chosen.skills?.length || slot.chosen.languages?.length)
      ? [
          {
            name: `${slot.label} (${slot.chosen.name})`,
            classId: slot.classId,
            subclass: slot.subclass,
            level: slot.level,
            skills: slot.chosen.skills ?? [],
            languages: slot.chosen.languages ?? [],
          },
        ]
      : [],
  );
}

// The spells the held options grant by a class level, always prepared.
export function subclassChoiceSpells(classId: string, subclass: string, level: number, features: Named | undefined, extras?: SubclassExtras): string[] {
  return subclassChoiceSlots([{ id: classId, subclass, level }], features ?? [], extras).flatMap((slot) =>
    slot.chosen ? subclassChoiceSpellsAt(slot.chosen, level) : [],
  );
}

// The skills and languages a stored character's old picks gave, taken off
// its training when an edit picks another option (or the subclass changes):
// the stored training is kept while the class stays, so without this a
// swapped option's skill stayed for good. What a new pick also gives stays.
export function withoutOldSubclassChoices<T extends { skills: string[]; languages: string[] }>(
  held: T,
  before: { classes: Entry[]; features: Named },
  after: { classes: Entry[]; features: Named },
  extras?: SubclassExtras,
): T {
  const gave = subclassChoiceTraining(before.classes, before.features, extras);
  if (!gave.length) {
    return held;
  }
  const gives = subclassChoiceTraining(after.classes, after.features, extras);
  const keep = (kind: "skills" | "languages") => new Set(gives.flatMap((grant) => grant[kind]).map(textKey));
  const off = (kind: "skills" | "languages") => {
    const kept = keep(kind);
    return new Set(gave.flatMap((grant) => grant[kind]).map(textKey).filter((entry) => !kept.has(entry)));
  };
  const skills = off("skills");
  const languages = off("languages");
  return {
    ...held,
    skills: held.skills.filter((skill) => !skills.has(textKey(skill))),
    languages: held.languages.filter((language) => !languages.has(textKey(language))),
  };
}

// One line for a pick on a sheet, for the help and the GM's prompt: the
// option's words and what it gives. Null when no subclass offers it.
export function subclassChoicePickDescription(name: string, extras?: SubclassExtras): string | null {
  const parsed = parseSubclassChoicePick(name);
  if (!parsed) {
    return null;
  }
  for (const tables of Object.values(extras ?? browserSubclassExtras())) {
    for (const table of tables) {
      const choice = (table.choices ?? []).find((held) => sameLabel(held, parsed.label));
      const option = choice ? optionNamed(choice, parsed.option) : null;
      if (option) {
        const gives = subclassChoiceSummary(option);
        return [option.description, `${table.name}'s ${choice!.label}: ${gives}.`].filter(Boolean).join(" ");
      }
    }
  }
  return null;
}
