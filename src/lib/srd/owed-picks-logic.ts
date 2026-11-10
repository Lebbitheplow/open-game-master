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
import { featChoice, keyedFeatChoices, withFeatChoice } from "@/lib/schemas/sheet";
import type { FeatChoices } from "@/lib/srd/feat-grants";
import { applyFeatGrants, featPicksOwed } from "@/lib/srd/feat-grants";
import {
  chosenFightingStyles,
  fightingStyleFeatureName,
  FIGHTING_STYLES,
} from "@/lib/srd/feature-effects";
import { expertiseAllowed, isThievesTools, populateFeaturesForClasses, THIEVES_TOOLS } from "@/lib/srd/features";
import { classListFor } from "@/lib/srd/multiclass";
import { openStyleSlots } from "@/lib/srd/style-slots";
import {
  findOptionByFeatureName,
  openOptionSlots,
  optionFeatureName,
  optionReqProblem,
  remainingWords,
  slotTakes,
  type OptionSlot,
} from "@/lib/srd/options";
import { applySubclassTraining, autoSubclassPicks, grantsForHeldTraining, subclassGrants, withSubclassChoiceRecords, type SubclassGrant } from "@/lib/srd/subclass-training";
import { textKey } from "@/lib/language/text-logic";
import { dedupeNames, spellbookOf } from "@/lib/srd/spell-prep";
import { featsAsRun } from "@/lib/srd/feat-effects";
import { parseSubclassChoicePick, pickOptionId, subclassChoicePickName } from "@/lib/content/subclass-choices";
import { isSubclassChoicePick, subclassChoiceSlots, type SubclassChoiceSlot } from "@/lib/srd/subclass-choice-picks";
import type { SubclassExtras } from "@/lib/srd/subclass-tables";

export type OwedSheet = Pick<CharacterSheet, "class" | "subclass" | "level" | "classes" | "features" | "proficiencies"> &
  Partial<Pick<CharacterSheet, "name" | "feats" | "spellcasting" | "featChoices" | "race" | "campaignId">>;

export type OwedPickSlots = {
  // The pick-lists with picks left, merged across classes as the builder
  // merges them.
  options: OptionSlot[];
  // A workshop subclass's own choices due and not made (issue #833): a
  // character saved before its author added the choice, or one whose level
  // went to another class.
  choices: SubclassChoiceSlot[];
  // Fighting styles earned and not chosen, and the styles the slots allow.
  styles: { count: number; choices: typeof FIGHTING_STYLES };
  // Class training picks that may wait and were not made.
  training: SubclassGrant[];
};

// Every spell a wizard's spellbook holds, whichever list carries it: the
// book, and what is prepared or waiting from it (spell-prep.ts spellbookOf,
// the one reading every path shares). A Shield only in the prepared list is
// in the book (issue #833 review).
export function sheetSpellbook(sheet: Pick<OwedSheet, "spellcasting">): string[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  const lists = casting.casters?.length ? casting.casters : [casting];
  return dedupeNames(
    lists.flatMap((list) => spellbookOf({ spellbook: list.spellbook ?? [], prepared: list.prepared ?? [], pending: list.pending ?? [] })),
  );
}

// Every cantrip the sheet knows, whichever list holds it (an invocation's
// "Eldritch Blast cantrip" prerequisite).
export function sheetCantrips(sheet: Pick<OwedSheet, "spellcasting">): string[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  return dedupeNames([...(casting.cantrips ?? []), ...(casting.casters ?? []).flatMap((caster) => caster.cantrips ?? [])]);
}

// The table's own catalog where the sheet's picks read it: its workshop and
// pack subclasses (whose features open picks, and which the regrant must
// keep), and the workshop feats run as the feats they copy (Martial Adept's
// maneuvers). Without them the server regranted a workshop subclass bare.
export type OwedContext = { extras?: SubclassExtras; campaignId?: string | null };

export function owedPickSlots(stated: OwedSheet, context: OwedContext = {}): OwedPickSlots {
  const classes = classListFor(stated);
  const feats = featsAsRun(stated.feats, context.campaignId ?? stated.campaignId);
  // The features as the class tables grant them, whatever the sheet lists:
  // a join's preview reads a sheet the regrant has not written yet, and owed
  // what the seated sheet then owes (src/lib/characters/join-changes.ts).
  const sheet = {
    ...stated,
    features: populateFeaturesForClasses(
      stated.features,
      classes.map((entry) => ({ id: entry.id, subclass: entry.subclass ?? "", level: entry.level })),
      stated.race ?? "",
      feats,
      context.extras,
    ),
  };
  const spellbook = sheetSpellbook(sheet);
  const slots = classes.flatMap((entry, index) =>
    openOptionSlots({
      classId: entry.id,
      subclass: entry.subclass ?? "",
      level: entry.level,
      features: sheet.features,
      // A feat's own picks are counted once, with the first class.
      feats: index === 0 ? feats : [],
      spellbook,
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
  // Each class's Fighting Style is a slot of its own (a paladin 2 / ranger 2
  // has two), though the sheet lists the feature once by name.
  // (src/lib/srd/style-slots.ts, the count the level-up offers by too).
  const { count: styleCount, choices: styleChoices } = openStyleSlots(classes, sheet.features, context.extras);
  const training = grantsForHeldTraining(subclassGrants(classes, context.extras), sheet.proficiencies).filter(
    (grant) => grant.optional && featPicksOwed(grant.name, grant.spec, featChoice(sheet.featChoices ?? {}, grant.name)) !== null,
  );
  const choices = subclassChoiceSlots(classes, sheet.features, context.extras).filter((slot) => !slot.chosen);
  return { options, choices, styles: { count: styleCount, choices: styleChoices }, training };
}

// The owed picks in words, for the sheet's and the join's "Earned and not
// yet made" line.
export function owedPickLines(sheet: OwedSheet, context: OwedContext = {}): string[] {
  const owed = owedPickSlots(sheet, context);
  const lines = owed.options.map((slot) => {
    const words = remainingWords(slot);
    return `${slot.label}: ${words.replace(" still to choose", " to choose")}`;
  });
  for (const slot of owed.choices) {
    lines.push(`${slot.subclass}'s ${slot.label}: 1 to choose`);
  }
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
export function applyOwedPicks(sheet: OwedSheet, request: OwedPicksRequest, context: OwedContext = {}): OwedPicksApplied {
  const asked = request.features ?? [];
  const choices: FeatChoices = { ...(request.featChoices ?? {}) };
  if (!asked.length && !Object.keys(choices).length) {
    return { ok: false, error: "Name a pick to make: an owed option by its feature name, or a language for an owed grant." };
  }
  let features: SheetFeature[] = [...sheet.features];
  const made: string[] = [];
  // The workshop choices picked here (issue #833), by id: what their
  // options train the character in is added below.
  const madeChoices: string[] = [];
  for (const raw of asked) {
    const name = raw.trim();
    const parsed = isSubclassChoicePick(name, context.extras) ? parseSubclassChoicePick(name) : null;
    if (parsed) {
      // A workshop subclass's own choice (issue #833), held to the choices
      // owed: due at the class's level and not made.
      const slot = owedPickSlots({ ...sheet, features }, context).choices.find((entry) => textKey(entry.label) === textKey(parsed.label));
      const option = slot?.options.find((entry) => textKey(entry.name) === textKey(parsed.option));
      if (!slot || !option) {
        return { ok: false, error: `${sheet.name ?? "This character"} owes no ${parsed.label} pick of ${parsed.option}: none of their subclasses has that choice open at its level.` };
      }
      const feature = subclassChoicePickName(slot.label, option);
      features = [...features, { name: feature, source: "choice", optionId: pickOptionId({ id: slot.choiceId }, option) }];
      made.push(feature);
      madeChoices.push(slot.choiceId);
      continue;
    }
    const option = findOptionByFeatureName(name);
    if (option) {
      const slot = owedPickSlots({ ...sheet, features }, context).options.find((entry) => entry.kind === option.k);
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
      // Its prerequisite, as the level-up holds it (options.ts optionReqProblem).
      const unmet = optionReqProblem(option, {
        classLevel: (classId) => classListFor(sheet).find((entry) => textKey(entry.id) === textKey(classId))?.level ?? 0,
        features,
        cantrips: sheetCantrips(sheet),
      });
      if (unmet) {
        return { ok: false, error: unmet };
      }
      const feature = optionFeatureName(option.k, option.n);
      features = [...features, { name: feature, source: "choice" }];
      made.push(feature);
      continue;
    }
    const [style] = chosenFightingStyles([{ name }]);
    const known = style ? FIGHTING_STYLES.find((entry) => textKey(entry.name) === textKey(style)) : undefined;
    if (known) {
      const owed = owedPickSlots({ ...sheet, features }, context).styles;
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
    return { ok: false, error: `"${name}" is not a pick this server knows. Send an owed option as its feature name ("Dragon Ancestor: Red", "Fighting Style: Defense", "Bloodline (Storm)").` };
  }
  // A workshop choice's option trains in its skills and languages, a skill
  // or language held already turned into a pick of another as the level-up
  // and the builder turn it (subclass-training.ts grantsForHeldTraining):
  // named in featChoices under the choice's name, else the first not held.
  const choiceGrants = madeChoices.length
    ? grantsForHeldTraining(
        subclassGrants(classListFor(sheet), context.extras, features).filter((grant) => grant.choiceId && madeChoices.includes(grant.choiceId)),
        sheet.proficiencies,
      )
    : [];
  let trainedBy: Proficiencies | undefined;
  let choiceRecords: FeatChoices | undefined;
  if (choiceGrants.length) {
    const named = Object.fromEntries(Object.entries(choices).filter(([key]) => choiceGrants.some((grant) => textKey(grant.name) === textKey(key))));
    const picks = autoSubclassPicks(choiceGrants, sheet.proficiencies, keyedFeatChoices(named));
    const trained = applySubclassTraining({ proficiencies: sheet.proficiencies, grants: choiceGrants, choices: picks, strict: true });
    if (trained.problems.length) {
      return { ok: false, error: trained.problems[0] };
    }
    trainedBy = trained.proficiencies;
    choiceRecords = withSubclassChoiceRecords(
      { ...(sheet.featChoices ?? {}), ...Object.fromEntries(choiceGrants.flatMap((grant) => (featChoice(picks, grant.name) ? [[textKey(grant.name), featChoice(picks, grant.name)!]] : []))) },
      choiceGrants,
    );
    for (const grant of choiceGrants) {
      delete choices[textKey(grant.name)];
      delete choices[grant.name];
    }
  }
  // The regrant keeps what the slots allow (features.ts pruneChoiceFeatures);
  // a pick it would drop is refused rather than lost.
  if (made.length) {
    const classes = classListFor(sheet).map((entry) => ({ id: entry.id, subclass: entry.subclass ?? "", level: entry.level }));
    const kept = populateFeaturesForClasses(features, classes, sheet.race ?? "", featsAsRun(sheet.feats, context.campaignId ?? sheet.campaignId), context.extras);
    const dropped = made.find((name) => !kept.some((feature) => textKey(feature.name) === textKey(name)));
    if (dropped) {
      return { ok: false, error: `${dropped} is not a pick this character's classes have room for.` };
    }
    features = kept;
  }
  let proficiencies: Proficiencies | undefined = trainedBy;
  let featChoices: FeatChoices | undefined = choiceRecords;
  const keys = Object.keys(choices);
  if (keys.length) {
    const owed = owedPickSlots(sheet, context).training;
    let merged: FeatChoices = { ...(choiceRecords ?? sheet.featChoices ?? {}) };
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
    const trained = applySubclassTraining({ proficiencies: trainedBy ?? sheet.proficiencies, grants, choices: merged, strict: true });
    if (trained.problems.length) {
      return { ok: false, error: trained.problems[0] };
    }
    proficiencies = trained.proficiencies;
    featChoices = merged;
    made.push(...grants.map((grant) => grant.name));
  }
  return { ok: true, features, made, ...(proficiencies ? { proficiencies } : {}), ...(featChoices ? { featChoices } : {}) };
}

// What this level's expertise may double: every skill held once the level
// is taken (SRD 5.1, Bard and Rogue: "choose two of your skill
// proficiencies"), as src/lib/srd/level-up.ts and the seat's picks
// (src/lib/characters/seat-picks.ts) apply the training before they judge
// the picks. A Lore bard at 3rd gains its college's three skills and
// its expertise at once; a rogue taken now, its one skill and thieves'
// tools. Read from the sheet alone, neither could be doubled at the level
// that gave it.
export function expertiseOptionsAfter(input: {
  sheet: Pick<CharacterSheet, "proficiencies">;
  classesAfter: Array<{ id: string; level: number }>;
  // The skill and tools a class taken with this level brings.
  newClass?: { skill?: string; tools: string[] };
  // The feats taken with this level, the subclass training arriving with
  // it, and the picks made for both (keyed by name, as the request sends them).
  feats: Array<{ name: string; desc: string }>;
  training: SubclassGrant[];
  choices: FeatChoices;
}): string[] {
  const held = input.sheet.proficiencies;
  const skill = (input.newClass?.skill ?? "").trim();
  const heldSkills = new Set(held.skills.map(textKey));
  const heldTools = new Set(held.tools.map(textKey));
  let proficiencies = {
    ...held,
    skills: skill && !heldSkills.has(textKey(skill)) ? [...held.skills, skill] : held.skills,
    tools: [...held.tools, ...(input.newClass?.tools ?? []).filter((tool) => !heldTools.has(textKey(tool)))],
  };
  proficiencies = applyFeatGrants({ proficiencies, feats: input.feats, choices: input.choices, strict: false }).proficiencies;
  proficiencies = applySubclassTraining({ proficiencies, grants: input.training, choices: input.choices, strict: false }).proficiencies;
  const expert = new Set((proficiencies.expertise ?? []).map(textKey));
  const tool =
    expertiseAllowed(THIEVES_TOOLS, [], input.classesAfter.map((entry) => entry.id)) && proficiencies.tools.some(isThievesTools) && !(held.expertise ?? []).some(isThievesTools)
      ? [THIEVES_TOOLS]
      : [];
  const seen = new Set<string>();
  const skills = proficiencies.skills.filter((entry) => {
    const key = textKey(entry);
    const fresh = !expert.has(key) && !seen.has(key);
    seen.add(key);
    return fresh;
  });
  return [...skills, ...tool];
}
