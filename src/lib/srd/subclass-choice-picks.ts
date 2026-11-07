// A workshop subclass's own choices on a character (issue #833): which are
// open at the character's class levels, which option each holds, and what
// that option grants. The choices themselves are the workshop's
// (src/lib/content/subclass-choices.ts), read through the table's subclass
// extras (src/lib/srd/subclass-tables.ts): the server passes the table's own,
// the browser reads what it registered.
//
// The pick is a "choice" feature, "Bloodline (Storm)", holding the ids of
// its choice and option (SheetFeature.optionId): it is found by those first,
// so the author's rename of either keeps it, and by its name only before the
// regrant has stamped them. The regrant (src/lib/srd/features.ts
// populateFeaturesForClasses) keeps one per choice while the subclass offers
// it at the class's level, writes it under the option's current name, and
// writes the option's damage type and resistances beside it as class
// features; the training (src/lib/srd/subclass-training.ts) gives its skills
// and languages; the subclass's spells (features.ts subclassSpellsFor) its
// spells. Only a "choice" feature is a pick: a story feature of the same
// name, which a file may carry, grants nothing. Pure.

import type { SheetFeature } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import {
  parsePickOptionId,
  parseSubclassChoicePick,
  pickOptionId,
  subclassChoiceFeatureNames,
  subclassChoicePickName,
  subclassChoiceSpellsAt,
  subclassChoiceSummary,
  type SubclassChoice,
  type SubclassChoiceOption,
} from "@/lib/content/subclass-choices";
import { browserSubclassExtras, type ExtraSubclass, type SubclassExtras } from "@/lib/srd/subclass-tables";
import { subclassNamedBare, subclassNamedExactly } from "@/lib/srd/subclass-name";

type Entry = { id: string; subclass?: string | null; level: number };
// A feature as the readers below take it.
export type PickFeature = { name: string; source?: string; optionId?: string };
type Picks = ReadonlyArray<PickFeature>;

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
  choiceId: string;
  label: string;
  // The class level it is chosen at.
  level: number;
  options: SubclassChoiceOption[];
  chosen: SubclassChoiceOption | null;
};

const sameLabel = (choice: SubclassChoice, label: string) => textKey(choice.label) === textKey(label);
const optionNamed = (choice: SubclassChoice, name: string) =>
  choice.options.find((option) => textKey(option.name) === textKey(name)) ?? null;

// The option of this choice a feature picks: by the ids it keeps, else by
// its "Label (Option)" name. Undefined when it is no pick of this choice,
// null when it picks one the choice no longer offers (deleted, or a name
// it never offered).
function optionOfPick(choice: SubclassChoice, feature: PickFeature): SubclassChoiceOption | null | undefined {
  if (feature.source !== "choice") {
    return undefined;
  }
  const ids = parsePickOptionId(feature.optionId);
  if (ids) {
    return ids.choice === choice.id ? (choice.options.find((option) => option.id === ids.option) ?? null) : undefined;
  }
  const parsed = parseSubclassChoicePick(feature.name);
  if (!parsed || !sameLabel(choice, parsed.label)) {
    return undefined;
  }
  return optionNamed(choice, parsed.option);
}

// The option a sheet's features hold for a choice: the first pick of it
// that names one it offers.
function heldOption(choice: SubclassChoice, features: Picks): SubclassChoiceOption | null {
  for (const feature of features) {
    const option = optionOfPick(choice, feature);
    if (option) {
      return option;
    }
  }
  return null;
}

// Every workshop choice open at the classes' levels, with the option held.
export function subclassChoiceSlots(classes: Entry[], features: Picks, extras?: SubclassExtras): SubclassChoiceSlot[] {
  const slots: SubclassChoiceSlot[] = [];
  for (const entry of classes) {
    const stored = (entry.subclass ?? "").trim();
    const extra = stored ? extraSubclassFor(entry.id, stored, extras) : null;
    for (const choice of extra?.choices ?? []) {
      if (choice.level <= entry.level) {
        slots.push({
          classId: entry.id,
          subclass: extra!.name,
          choiceId: choice.id,
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
export function subclassChoiceGrantedFeatures(classes: Entry[], features: Picks, extras?: SubclassExtras): SheetFeature[] {
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

const asPick = (feature: PickFeature | string): PickFeature => (typeof feature === "string" ? { name: feature, source: "choice" } : feature);

// Whether any subclass in the extras offers this pick.
export function isSubclassChoicePick(feature: PickFeature | string, extras?: SubclassExtras): boolean {
  const pick = asPick(feature);
  return Object.values(extras ?? browserSubclassExtras()).some((tables) =>
    tables.some((table) => (table.choices ?? []).some((choice) => Boolean(optionOfPick(choice, pick)))),
  );
}

// How the regrant keeps a "choice" feature that is a workshop pick: the
// feature under its option's current name with its ids stamped (the first
// pick of a choice the class's subclass offers at its level), null to drop
// it (a second pick, one made early, an option the choice no longer
// offers, or a pick of a subclass the sheet no longer holds), undefined
// when it is no workshop pick these extras know, so a path that reads no
// extras leaves it as it is.
export function subclassChoicePickKept<T extends PickFeature>(
  feature: T,
  classes: Entry[],
  extras: SubclassExtras | undefined,
  taken: Set<string>,
): T | null | undefined {
  for (const entry of classes) {
    const stored = (entry.subclass ?? "").trim();
    for (const choice of (stored ? extraSubclassFor(entry.id, stored, extras)?.choices : undefined) ?? []) {
      const option = optionOfPick(choice, feature);
      if (option === undefined) {
        continue;
      }
      const key = `${entry.id}|${choice.id}`;
      if (option === null || choice.level > entry.level || taken.has(key)) {
        return null;
      }
      taken.add(key);
      return { ...feature, name: subclassChoicePickName(choice.label, option), optionId: pickOptionId(choice, option) };
    }
  }
  // A pick of a choice these extras know, on a sheet whose subclass no
  // longer offers it, or of an option gone from it.
  const known = Object.values(extras ?? browserSubclassExtras()).some((tables) =>
    tables.some((table) => (table.choices ?? []).some((choice) => optionOfPick(choice, feature) !== undefined)),
  );
  return known ? null : undefined;
}

// Why the picks a request sends cannot be made, in plain words: an option
// the choice does not offer, one chosen before its level, or two for one
// choice. Empty when they can. Only what the request makes is judged: a
// stored pick gone stale (its option deleted) is the regrant's to drop and
// never blocks a save or a level.
export function subclassChoicePickProblems(sent: Picks, classes: Entry[], extras?: SubclassExtras): string[] {
  const problems: string[] = [];
  const made = new Map<string, string>();
  for (const feature of sent) {
    if (feature.source !== "choice") {
      continue;
    }
    for (const entry of classes) {
      const stored = (entry.subclass ?? "").trim();
      const extra = stored ? extraSubclassFor(entry.id, stored, extras) : null;
      const choice = (extra?.choices ?? []).find((held) => optionOfPick(held, feature) !== undefined);
      if (!extra || !choice) {
        continue;
      }
      const option = optionOfPick(choice, feature);
      if (!option) {
        const named = parseSubclassChoicePick(feature.name)?.option ?? feature.name;
        problems.push(`"${named}" is not one of ${extra.name}'s ${choice.label} options; pick one of ${choice.options.map((entry) => entry.name).join(", ")}.`);
      } else if (choice.level > entry.level) {
        problems.push(`${extra.name}'s ${choice.label} is chosen at class level ${choice.level}; this character is level ${entry.level} in that class.`);
      } else {
        const key = `${entry.id}|${choice.id}`;
        const before = made.get(key);
        if (before && before !== option.name) {
          problems.push(`${extra.name}'s ${choice.label} is one pick; ${before} and ${option.name} were both chosen.`);
        }
        made.set(key, before ?? option.name);
      }
      break;
    }
  }
  return problems;
}

// What the held options train the character in, one grant per choice,
// named for it (its replacement picks are kept under that name): its skills
// and languages, at the level the choice is made.
export type SubclassChoiceTraining = {
  name: string;
  choiceId: string;
  classId: string;
  subclass: string;
  level: number;
  skills: string[];
  languages: string[];
};

export function subclassChoiceTraining(classes: Entry[], features: Picks, extras?: SubclassExtras): SubclassChoiceTraining[] {
  return subclassChoiceSlots(classes, features, extras).flatMap((slot) =>
    slot.chosen && (slot.chosen.skills?.length || slot.chosen.languages?.length)
      ? [
          {
            name: slot.label,
            choiceId: slot.choiceId,
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
export function subclassChoiceSpells(classId: string, subclass: string, level: number, features: Picks | undefined, extras?: SubclassExtras): string[] {
  return subclassChoiceSlots([{ id: classId, subclass, level }], features ?? [], extras).flatMap((slot) =>
    slot.chosen ? subclassChoiceSpellsAt(slot.chosen, level) : [],
  );
}

// One line for a pick on a sheet, for the help and the GM's prompt: the
// option's words and what it gives. Null when no subclass offers it.
export function subclassChoicePickDescription(feature: PickFeature | string, extras?: SubclassExtras): string | null {
  const pick = asPick(feature);
  for (const tables of Object.values(extras ?? browserSubclassExtras())) {
    for (const table of tables) {
      for (const choice of table.choices ?? []) {
        const option = optionOfPick(choice, pick);
        if (option) {
          return [option.description, `${table.name}'s ${choice.label}: ${subclassChoiceSummary(option)}.`].filter(Boolean).join(" ");
        }
      }
    }
  }
  return null;
}

// A request's picks with the ids the stored character's same picks keep:
// the builder sends a pick by its name alone, and a name an author has since
// renamed is found again only by the ids its stored pick holds.
export function withHeldPickIds<T extends PickFeature>(sent: readonly T[], held: Picks | undefined): T[] {
  const ids = new Map((held ?? []).filter((feature) => feature.source === "choice" && feature.optionId).map((feature) => [textKey(feature.name), feature.optionId!]));
  return sent.map((feature) => (feature.source === "choice" && !feature.optionId && ids.has(textKey(feature.name)) ? { ...feature, optionId: ids.get(textKey(feature.name)) } : feature));
}

// The builder's option picks (feature names) as "choice" features, with the
// ids the character's stored picks held (by name).
export function subclassPickFeatures(picks: readonly string[], ids: Readonly<Record<string, string>> | undefined): PickFeature[] {
  return picks.map((name) => {
    const optionId = ids?.[textKey(name)];
    return { name, source: "choice", ...(optionId ? { optionId } : {}) };
  });
}
