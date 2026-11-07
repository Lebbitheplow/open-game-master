import { choiceDamageTypeFeatureName } from "@/lib/srd/chosen-element";

// A workshop subclass whose player picks one of several options at a class
// level: a bloodline, an elemental affinity, a patron's aspect (issue #833).
// The SRD's own picks (a Draconic sorcerer's dragon, a Hunter's prey) are
// pick-lists of src/lib/srd/options.ts, which a workshop subclass could only
// open by borrowing the published feature's name; a choice of the author's
// own was dropped by every check, since only options.json named picks.
//
// Each option gives only what the engines already run: a damage type (the
// element Elemental Affinity reads, src/lib/srd/chosen-element.ts),
// resistances, skills, languages, and spells always prepared from a class
// level the way subclass spells are, plus words the player reads. The pick
// is kept on the sheet as a "choice" feature, "<label> (<option>)", the form
// the authored "choose" spends and the per-choice spells already read
// (src/lib/srd/features.ts featureChoiceOf). Beside it the regrant writes
// what the option grants as class features ("Lightning Resistance",
// "Bloodline damage type: Lightning"), so an option given up leaves nothing
// behind (src/lib/srd/subclass-choice-picks.ts).
//
// Pure and light: the builder, the campaign page and the engines read these
// shapes and names. The save's checker is src/lib/homebrew/
// subclass-choice-check.ts, which holds the choice to the species choice's
// limits and words (src/lib/content/species-variants.ts, issue #538).

export type SubclassChoiceOption = {
  // Fixed when the option is made, so a rename keeps nothing stale.
  id: string;
  name: string;
  description?: string;
  // The element the option deals in, read by Elemental Affinity.
  damageType?: string;
  resistances?: string[];
  // Skill ids as the sheet keeps them ("sleight_of_hand").
  skills?: string[];
  languages?: string[];
  // Always prepared (or known) from a class level, by that level.
  spells?: Record<string, string[]>;
};

export type SubclassChoice = {
  // Fixed when the choice is made, as an option's is: a pick keeps it
  // (pickOptionId), so a renamed choice or option keeps every sheet's pick.
  id: string;
  label: string;
  // The class level the choice is made at.
  level: number;
  options: SubclassChoiceOption[];
};

// ---- what the sheet carries ----

const listed = (items: readonly string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : (items[0] ?? "");
const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

// The pick's record on the sheet: "Bloodline (Storm)".
export function subclassChoicePickName(label: string, option: Pick<SubclassChoiceOption, "name">): string {
  return `${label.trim()} (${option.name.trim()})`;
}

// What a pick keeps on its feature beside its name (SheetFeature.optionId):
// the choice's id and the option's, so a pick is found again after the
// author renames either, and an option deleted is known as gone, never
// mistaken for a new one of the same name (issue #833 review).
export function pickOptionId(choice: Pick<SubclassChoice, "id">, option: Pick<SubclassChoiceOption, "id">): string {
  return `${choice.id}/${option.id}`;
}

export function parsePickOptionId(value: string | undefined): { choice: string; option: string } | null {
  const found = /^([a-z0-9-]+)\/([a-z0-9-]+)$/.exec((value ?? "").trim());
  return found ? { choice: found[1], option: found[2] } : null;
}

// The record of what a pick trained its character in, kept in the sheet's
// featChoices under this key: the skills and languages the option gave and
// the character did not hold before. Every edit takes the recorded ones off
// first (src/lib/srd/feat-grants.ts withoutFeatPicks) and the live option
// gives back only what it still grants, so an option swapped, edited or
// deleted leaves nothing behind.
export const SUBCLASS_CHOICE_RECORD = "subclass choice ";

export function subclassChoiceRecordKey(choice: Pick<SubclassChoice, "id">): string {
  return `${SUBCLASS_CHOICE_RECORD}${choice.id}`;
}

// The label and the option a "Label (Option)" name holds, or null.
export function parseSubclassChoicePick(name: string): { label: string; option: string } | null {
  const found = /^([^()]+?)\s*\(([^()]+)\)\s*$/.exec(name.trim());
  return found ? { label: found[1].trim(), option: found[2].trim() } : null;
}

// The class features an option is written as, beside its pick: its damage
// type, read by Elemental Affinity, and a "Fire Resistance" per type, which
// the damage engine reads by name (src/lib/dm/pc-defenses.ts).
export function subclassChoiceFeatureNames(label: string, option: SubclassChoiceOption): string[] {
  return [
    ...(option.damageType ? [choiceDamageTypeFeatureName(label, option.damageType)] : []),
    ...(option.resistances ?? []).map((type) => `${capital(type)} Resistance`),
  ];
}

// The option's spells arrived by this class level.
export function subclassChoiceSpellsAt(option: SubclassChoiceOption, level: number): string[] {
  return Object.entries(option.spells ?? {})
    .filter(([at]) => Number(at) <= level)
    .flatMap(([, names]) => names);
}

const skillName = (id: string) =>
  id
    .split("_")
    .map((word, index) => (index && word === "of" ? word : capital(word)))
    .join(" ");

// What an option gives, in one plain line, for the builder, the editor, the
// help and the GM's prompt: "lightning; resists lightning damage; proficient
// in Arcana; Shocking Grasp from level 1, Thunderwave from level 3".
export function subclassChoiceSummary(option: SubclassChoiceOption): string {
  const parts: string[] = [];
  if (option.damageType) parts.push(`${option.damageType} is its element`);
  if (option.resistances?.length) parts.push(`resists ${listed(option.resistances)} damage`);
  if (option.skills?.length) parts.push(`proficient in ${listed(option.skills.map(skillName))}`);
  if (option.languages?.length) parts.push(`speaks ${listed(option.languages)}`);
  const spells = Object.entries(option.spells ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([level, names]) => `${listed(names)} from level ${level}`);
  if (spells.length) parts.push(`always prepared: ${spells.join("; ")}`);
  return parts.length ? parts.join("; ") : "nothing beyond its words";
}

// Stored choices read back by shape alone, for the subclass tables the
// builder and the campaign page register: the save held them to every limit
// (src/lib/homebrew/subclass-choice-check.ts), and that checker's tables of
// damage types and skills stay out of those pages. A row that is not a
// choice is passed over.
export function storedSubclassChoices(raw: unknown): SubclassChoice[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  return raw.flatMap((row) => {
    const choice = (row ?? {}) as Record<string, unknown>;
    const label = typeof choice.label === "string" ? choice.label.trim() : "";
    const options = (Array.isArray(choice.options) ? choice.options : []).flatMap((entry) => {
      const option = (entry ?? {}) as Record<string, unknown>;
      const name = typeof option.name === "string" ? option.name.trim() : "";
      if (!name) {
        return [];
      }
      const spells = Object.fromEntries(
        Object.entries((option.spells ?? {}) as Record<string, unknown>).map(([level, names]) => [level, strings(names)]),
      );
      return [
        {
          id: typeof option.id === "string" ? option.id : name,
          name,
          ...(typeof option.description === "string" && option.description ? { description: option.description } : {}),
          ...(typeof option.damageType === "string" && option.damageType ? { damageType: option.damageType } : {}),
          ...(strings(option.resistances).length ? { resistances: strings(option.resistances) } : {}),
          ...(strings(option.skills).length ? { skills: strings(option.skills) } : {}),
          ...(strings(option.languages).length ? { languages: strings(option.languages) } : {}),
          ...(Object.keys(spells).length ? { spells } : {}),
        },
      ];
    });
    const level = Number(choice.level ?? 1);
    const id = typeof choice.id === "string" && choice.id ? choice.id : label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "choice";
    return label && options.length ? [{ id, label, level: Number.isInteger(level) && level >= 1 && level <= 20 ? level : 1, options }] : [];
  });
}
