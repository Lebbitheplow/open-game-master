// The picks a character's levels have earned and no level-up offered: the
// pick-lists of src/lib/srd/options.ts (a dragon ancestor, invocations,
// favored enemies, a Land druid's terrain, Spell Mastery), the fighting
// styles, and a pick a class's own training leaves open (a ranger's Favored
// Enemy language). Issue #833: a sorcerer saved before Dragon Ancestor became
// a pick, a level 20 character, or one whose next level goes to another
// class was never offered it, since only a level-up of that class did.
//
// owedChoices (owed-choices.ts) names them on the sheet and the join
// confirmation; POST /api/campaigns/[id]/sheet/owed takes them from the
// sheet's owed picks (src/components/sheet/OwedPicks.tsx) through
// applyOwedPicks below, the same legality the level-up keeps: a pick the
// slots allow, of an option the list holds, kept by the regrant.
//
// Pure: the sheet comes in as a value.

import type { CharacterSheet, Proficiencies, SheetFeature } from "@/lib/schemas/sheet";
import { featChoice, withFeatChoice } from "@/lib/schemas/sheet";
import type { FeatChoices } from "@/lib/srd/feat-grants";
import { featPicksOwed } from "@/lib/srd/feat-grants";
import {
  chosenFightingStyles,
  fightingStyleChoices,
  fightingStyleFeatureName,
  fightingStyleSlots,
  FIGHTING_STYLES,
} from "@/lib/srd/feature-effects";
import { populateFeaturesForClasses } from "@/lib/srd/features";
import { classListFor } from "@/lib/srd/multiclass";
import {
  findOptionByFeatureName,
  openOptionSlots,
  optionFeatureName,
  remainingWords,
  slotTakes,
  type OptionSlot,
} from "@/lib/srd/options";
import { applySubclassTraining, grantsForHeldTraining, subclassGrants, type SubclassGrant } from "@/lib/srd/subclass-training";
import { textKey } from "@/lib/language/text-logic";

export type OwedSheet = Pick<CharacterSheet, "class" | "subclass" | "level" | "classes" | "features" | "proficiencies"> &
  Partial<Pick<CharacterSheet, "name" | "feats" | "spellcasting" | "featChoices" | "race">>;

export type OwedPickSlots = {
  // The pick-lists with picks left, merged across classes as the builder
  // merges them.
  options: OptionSlot[];
  // Fighting styles earned and not chosen, and the styles the slots allow.
  styles: { count: number; choices: typeof FIGHTING_STYLES };
  // Class training picks that may wait and were not made.
  training: SubclassGrant[];
};

// Every spell a wizard's spellbook holds, whichever list carries it.
export function spellbookOf(sheet: Pick<OwedSheet, "spellcasting">): string[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  return [...(casting.spellbook ?? []), ...(casting.casters ?? []).flatMap((caster) => caster.spellbook ?? [])];
}

export function owedPickSlots(stated: OwedSheet): OwedPickSlots {
  const classes = classListFor(stated);
  // The features as the class tables grant them, whatever the sheet lists:
  // a join's preview reads a sheet the regrant has not written yet, and owed
  // what the seated sheet then owes (src/lib/characters/join-changes.ts).
  const sheet = {
    ...stated,
    features: populateFeaturesForClasses(
      stated.features,
      classes.map((entry) => ({ id: entry.id, subclass: entry.subclass ?? "", level: entry.level })),
      stated.race ?? "",
      stated.feats,
    ),
  };
  const spellbook = spellbookOf(sheet);
  const slots = classes.flatMap((entry, index) =>
    openOptionSlots({
      classId: entry.id,
      subclass: entry.subclass ?? "",
      level: entry.level,
      features: sheet.features,
      // A feat's own picks are counted once, with the first class.
      feats: index === 0 ? sheet.feats : [],
      ...(spellbook.length ? { spellbook } : {}),
    }),
  );
  const options = slots
    .reduce<OptionSlot[]>((merged, slot) => {
      const held = merged.find((entry) => entry.kind === slot.kind);
      if (!held) {
        return [...merged, slot];
      }
      const total = held.total + slot.total;
      const spent = held.total - held.remaining;
      return merged.map((entry) => (entry === held ? { ...held, total, remaining: Math.max(0, total - spent) } : entry));
    }, [])
    .filter((slot) => slot.remaining > 0 && slot.options.some((option) => slotTakes(slot, option)));
  const styleSlots = fightingStyleSlots(sheet.features);
  const chosenStyles = chosenFightingStyles(sheet.features).map(textKey);
  const styleChoices = fightingStyleChoices(sheet.features, sheet.class).filter((style) => !chosenStyles.includes(textKey(style.name)));
  const styleCount = styleChoices.length ? Math.max(0, styleSlots - chosenStyles.length) : 0;
  const training = grantsForHeldTraining(subclassGrants(classes), sheet.proficiencies).filter(
    (grant) => grant.optional && featPicksOwed(grant.name, grant.spec, featChoice(sheet.featChoices ?? {}, grant.name)) !== null,
  );
  return { options, styles: { count: styleCount, choices: styleChoices }, training };
}

// The owed picks in words, for the sheet's and the join's "Earned and not
// yet made" line.
export function owedPickLines(sheet: OwedSheet): string[] {
  const owed = owedPickSlots(sheet);
  const lines = owed.options.map((slot) => {
    const words = remainingWords(slot);
    return `${slot.label}: ${words.replace(" still to choose", " to choose")}`;
  });
  if (owed.styles.count > 0) {
    lines.push(owed.styles.count === 1 ? "a fighting style" : `${owed.styles.count} fighting styles`);
  }
  for (const grant of owed.training) {
    lines.push(`${grant.name}: ${grant.spec.languages === 1 ? "a language" : `${grant.spec.languages} languages`}`);
  }
  return lines;
}

export type OwedPicksRequest = { features?: string[]; featChoices?: FeatChoices };

export type OwedPicksApplied =
  | { ok: true; features: SheetFeature[]; proficiencies?: Proficiencies; featChoices?: FeatChoices; made: string[] }
  | { ok: false; error: string };

// The sheet with the picks made, or why one cannot be. Each pick is judged
// against what is owed after the ones before it, so two picks of one list
// cannot both take its last slot.
export function applyOwedPicks(sheet: OwedSheet, request: OwedPicksRequest): OwedPicksApplied {
  const asked = request.features ?? [];
  const choices = request.featChoices ?? {};
  if (!asked.length && !Object.keys(choices).length) {
    return { ok: false, error: "Name a pick to make: an owed option by its feature name, or a language for an owed grant." };
  }
  let features: SheetFeature[] = [...sheet.features];
  const made: string[] = [];
  for (const raw of asked) {
    const name = raw.trim();
    const option = findOptionByFeatureName(name);
    if (option) {
      const slot = owedPickSlots({ ...sheet, features }).options.find((entry) => entry.kind === option.k);
      if (!slot) {
        return { ok: false, error: `${sheet.name ?? "This character"} owes no ${option.k.replace(/_/g, " ")} pick: none of their classes has one left at its level.` };
      }
      if (slot.chosen.some((chosen) => textKey(chosen) === textKey(option.n))) {
        return { ok: false, error: `${option.n} is already chosen for ${slot.label}.` };
      }
      if (!slot.options.some((entry) => textKey(entry.n) === textKey(option.n))) {
        return { ok: false, error: `${option.n} is not one of the ${slot.label} choices open to this character${slot.kind.startsWith("spell_") || slot.kind === "signature_spell" ? ": it must be a spell of that level in their spellbook" : ""}.` };
      }
      if (!slotTakes(slot, option)) {
        return { ok: false, error: `${slot.label} has only half a pick left, which takes one more humanoid race.` };
      }
      const feature = optionFeatureName(option.k, option.n);
      features = [...features, { name: feature, source: "choice" }];
      made.push(feature);
      continue;
    }
    const [style] = chosenFightingStyles([{ name }]);
    const known = style ? FIGHTING_STYLES.find((entry) => textKey(entry.name) === textKey(style)) : undefined;
    if (known) {
      const owed = owedPickSlots({ ...sheet, features }).styles;
      if (owed.count <= 0) {
        return { ok: false, error: "No fighting style is owed: every slot this character's classes give is chosen." };
      }
      if (!owed.choices.some((entry) => entry.id === known.id)) {
        return { ok: false, error: `${known.name} is not a fighting style this character's class offers; pick one of ${owed.choices.map((entry) => entry.name).join(", ")}.` };
      }
      const feature = fightingStyleFeatureName(known.id);
      features = [...features, { name: feature, source: "choice" }];
      made.push(feature);
      continue;
    }
    return { ok: false, error: `"${name}" is not a pick this server knows. Send an owed option as its feature name ("Dragon Ancestor: Red", "Fighting Style: Defense").` };
  }
  // The regrant keeps what the slots allow (features.ts pruneChoiceFeatures);
  // a pick it would drop is refused rather than lost.
  if (made.length) {
    const classes = classListFor(sheet).map((entry) => ({ id: entry.id, subclass: entry.subclass ?? "", level: entry.level }));
    const kept = populateFeaturesForClasses(features, classes, sheet.race ?? "", sheet.feats);
    const dropped = made.find((name) => !kept.some((feature) => textKey(feature.name) === textKey(name)));
    if (dropped) {
      return { ok: false, error: `${dropped} is not a pick this character's classes have room for.` };
    }
    features = kept;
  }
  let proficiencies: Proficiencies | undefined;
  let featChoices: FeatChoices | undefined;
  const keys = Object.keys(choices);
  if (keys.length) {
    const owed = owedPickSlots(sheet).training;
    let merged: FeatChoices = { ...(sheet.featChoices ?? {}) };
    const grants: SubclassGrant[] = [];
    for (const key of keys) {
      const grant = owed.find((entry) => textKey(entry.name) === textKey(key));
      if (!grant) {
        return { ok: false, error: `Nothing owed is called "${key}"; the owed training picks are ${owed.map((entry) => entry.name).join(", ") || "none"}.` };
      }
      // Keyed as the schema keys them, or as written by a caller that did not
      // go through it.
      const picks = featChoice(choices, key) ?? choices[key];
      if (picks) {
        merged = withFeatChoice(merged, grant.name, picks);
      }
      // Named here, the pick is held to the grant like any other.
      grants.push({ name: grant.name, classId: grant.classId, subclass: grant.subclass, level: grant.level, spec: grant.spec });
    }
    const trained = applySubclassTraining({ proficiencies: sheet.proficiencies, grants, choices: merged, strict: true });
    if (trained.problems.length) {
      return { ok: false, error: trained.problems[0] };
    }
    proficiencies = trained.proficiencies;
    featChoices = merged;
    made.push(...grants.map((grant) => grant.name));
  }
  return { ok: true, features, made, ...(proficiencies ? { proficiencies } : {}), ...(featChoices ? { featChoices } : {}) };
}
