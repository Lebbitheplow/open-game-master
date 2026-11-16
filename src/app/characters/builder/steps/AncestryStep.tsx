"use client";

import { repeatedGrants } from "@/lib/srd/racial-grants";
import { useMemo, useState, type ReactNode } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { describeRace } from "@/lib/help";
import type { Reskinned } from "@/lib/worlds/reskin-logic";
import { LineageCarousel, type LineageSlide } from "../LineageCarousel";
import { lineageCard } from "../cardFaces";
import { flattenGroups, lineageArt, srdRaceFor } from "../lineage";
import { lineageFits } from "../lineageFits";
import { SRD_CLASSES } from "@/lib/srd";
import { useLocale, useT, useTp } from "@/lib/locale";
import { textKey } from "@/lib/language/text-logic";
import type { CardFacet } from "../OptionCardGrid";
import type { Ability } from "@/lib/schemas/sheet";
import { OptionCardGrid, type OptionCardGroup } from "../OptionCardGrid";
import type { PickerGroup } from "../OptionPicker";
import { contentName } from "@/lib/content/names";
import { knownTraining } from "../FeatChoicesFields";
import { RacialChoicesSection } from "../RacialChoicesSection";
import type { BackgroundOption, RaceOption } from "../useBuilderOptions";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { bonusLanguageCount } from "../submit";
import { StepPanel, inputClass } from "./shared";

function languageHelp(t: (key: string, vars?: Record<string, string | number>) => string, race: RaceOption, background: BackgroundOption | undefined, locale: "en" | "fr" = "en"): string {
  const langs = race.languages.join(locale === "fr" ? " et " : " and ");
  const parts = [t("{race} speaks {langs}", { race: contentName("species", race.name, locale), langs })];
  const choice = race.languageChoice;
  const open = race.bonusLanguages - (choice?.count ?? 0);
  if (choice) {
    parts.push(t(choice.count === 1 ? "plus one of {from}" : "plus {count} of {from}", { count: choice.count, from: choice.from.join(", ") }));
  }
  if (open > 0) {
    parts.push(t("{join} {count} of your choice", { join: choice ? t("and") : t("plus"), count: open }));
  }
  if (background?.knownLanguages?.length) {
    parts.push(t("and {langs} from your {background} background", { langs: background.knownLanguages.join(" and "), background: background.name }));
  }
  if (background?.languages) {
    parts.push(
      t("{join} {count} more from your {background} background", {
        join: race.bonusLanguages > 0 ? t("and") : t("plus"),
        count: background.languages,
        background: background.name,
      }),
    );
  }
  return `${parts.join(" ")}.`;
}

// Step 2: where they are from. The lineage grid (every race the picker
// offered, in the picker's groups and order, the setting's peoples first and
// badged), the detail carousel behind each card's "?", then every choice the
// race leaves to the player: bonus languages, ability bumps, skills, tool,
// cantrip. The background sits beside it (backlog F4), right after the
// grid, so its languages join the list below.
export function AncestryStep({
  state,
  derived,
  race,
  background,
  races,
  raceGroups,
  listNote = null,
  backgroundSection = null,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  background: BackgroundOption | undefined;
  races: Array<Reskinned<RaceOption>>;
  raceGroups: PickerGroup[];
  // Why the list may be short (TableScopeNote).
  listNote?: ReactNode;
  // The background and its open picks (BackgroundPanel, ToolGrantPanels).
  backgroundSection?: ReactNode;
}) {
  // The race's bonus languages plus the background's (an acolyte or a sage
  // learns two more), which used to be loaded and never asked for.
  const languageCount = bonusLanguageCount(race, background);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const { gender } = state;
  const t = useT();
  const tp = useTp();
  const locale = useLocale();

  // One slide per picker row, in the picker's order, so the carousel walks
  // exactly what the grid shows.
  const slides = useMemo(() => lineageSlidesFor(raceGroups, races, gender), [raceGroups, races, gender]);

  const cardGroups = useMemo<OptionCardGroup[]>(
    () =>
      raceGroups.map((group) => ({
        label: group.label,
        recommended: group.recommended,
        options: group.options.flatMap((option) => {
          const slide = slides.find((candidate) => candidate.id === option.id);
          if (!slide) {
            return [];
          }
          return [lineageCard({ slide })];
        }),
      })),
    [raceGroups, slides],
  );
  const facets = useMemo(() => raceFacets(t, locale, slides), [t, locale, slides]);

  return (
    <div className="space-y-4">
      <StepPanel
        title={t("Where are they from?")}
        ornate
        anchor="race"
        help={race ? t("{race} is chosen. Every lineage grants its own ability bumps, senses and tongues: tap a card to choose it, or its ? to read what it hands you first.", { race: contentName("species", race.name, locale) }) : t("Tap a card to choose a lineage, or its ? to read what it hands you first.")}
      >
        {state.revisedSpecies ? (
          <p role="note" className="mb-3 rounded border border-amber-700/40 bg-amber-950/30 p-2 text-xs text-amber-100">
            {race ? (
              t("This character was made with the 2024 rules’ {race}. This server plays the 2014 rules, so they now have the 2014 {race}’s traits, and their ability scores stay as they were. Save to keep it, or choose another lineage.", { race: contentName("species", race.name, locale) })
            ) : (
              // A content pack that offers no such lineage: its id, written
              // as a name, and the pick it now owes.
              t("This character was made with the 2024 rules’ {species}. This server plays the 2014 rules and offers no 2014 {species} here, so choose a lineage below; their ability scores stay as they were.", { species: speciesWords(state.revisedSpecies) })
            )}
          </p>
        ) : null}
        {race?.note ? (
          <span className="mb-3 flex items-start gap-1 text-xs text-stone-500">
            <span className="line-clamp-2 grow">
              <span className="text-amber-200">{contentName("species", race.name, locale)}</span>
              {race.source ? <span className="font-mono text-[0.875rem] text-stone-500"> · {race.source}</span> : null}
              <span className="text-amber-200">: </span>
              {race.note}
            </span>
            <InfoButton
              label={contentName("species", race.name, locale)}
              text={describeRace(race.id) ?? race.note}
              reference={{ kind: "races", slug: race.slug ?? race.id }}
            />
          </span>
        ) : null}
        <OptionCardGrid
          groups={cardGroups}
          value={race?.id ?? ""}
          onChoose={state.changeRace}
          onDetails={(id) => setDetailIndex(slides.findIndex((slide) => slide.id === id))}
          noun="lineage"
          facets={facets}
        />
        {listNote}
        <LineageCarousel
          slides={slides}
          index={detailIndex !== null && detailIndex >= 0 ? detailIndex : null}
          onIndexChange={setDetailIndex}
          chosenId={race?.id ?? ""}
          onChoose={state.changeRace}
        />
      </StepPanel>

      {backgroundSection}

      {race && languageCount > 0 ? (
        <StepPanel
          title={
            <span className="flex items-center gap-1">
              {tp("Bonus language", "Bonus languages", { count: languageCount })}
              <InfoButton
                label={t("Languages")}
                text={t("A language you know is one you can speak, read and write. It decides who your character can talk to without help, and it comes up more than new players expect: half the trouble in a dungeon is written on a wall.\n\nCommon is the trade tongue everyone shares. The rest are the tongues of particular peoples: Dwarvish, Elvish, Orc, Draconic and so on. Pick whatever fits where your character grew up, or whoever you expect to be negotiating with.")}
              />
            </span>
          }
          help={languageHelp(t, race, background, locale)}
          anchor="languages"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: languageCount }, (_, index) => (
              <Select<string>
                key={index}
                value={state.bonusLanguages[index] ?? ""}
                onChange={(picked) =>
                  state.setBonusLanguages((current) => {
                    const next = [...current];
                    next[index] = picked;
                    return next;
                  })
                }
                className="w-full"
                label={t("Bonus language {n}", { n: index + 1 })}
                placeholder={t("Choose a language...", { context: "builder.ancestry.chooseLanguage" })}
                options={[
                  { value: "", label: t("Choose a language...", { context: "builder.ancestry.chooseLanguage" }) },
                  // A race that offers "your choice of Common or Undercommon"
                  // fills its first slots from that list only.
                  ...(race.languageChoice && index < race.languageChoice.count
                    ? race.languageChoice.from
                    : STANDARD_LANGUAGES
                  ).filter(
                    (language) =>
                      !race.languages.includes(language) &&
                      !(background?.knownLanguages ?? []).includes(language) &&
                      (state.bonusLanguages[index] === language || !state.bonusLanguages.includes(language)),
                  ).map((language) => ({ value: language as string, label: language as string })),
                ]}
              />
            ))}
          </div>
        </StepPanel>
      ) : null}

      {race ? (
        <RacialChoicesSection
          race={race}
          grantedSkills={[
            ...state.chosenSkills,
            ...(background?.skills ?? []),
            ...state.backgroundSkills,
            ...(race.skills ?? []),
          ]}
          asi={state.racialAsi}
          onAsiChange={(index, ability) =>
            state.setRacialAsi((current) => {
              const next = [...current];
              next[index] = ability;
              return next;
            })
          }
          skills={state.racialSkills}
          onSkillsChange={(index, skill) =>
            state.setRacialSkills((current) => {
              const next = [...current];
              next[index] = skill;
              return next;
            })
          }
          cantrips={state.racialCantrips}
          onCantripsChange={state.setRacialCantrips}
          tool={state.racialTool}
          onToolChange={state.setRacialTool}
          training={state.racialTraining}
          onTrainingChange={(index, pick) =>
            state.setRacialTraining((current) => {
              const next = [...current];
              next[index] = pick;
              return next;
            })
          }
          expertise={state.racialExpertise}
          onExpertiseChange={state.setRacialExpertise}
          weapons={state.racialWeapons}
          onWeaponsChange={(index, weapon) =>
            state.setRacialWeapons((current) => {
              const next = [...current];
              next[index] = weapon;
              return next;
            })
          }
          ancestry={state.racialAncestry}
          onAncestryChange={state.setRacialAncestry}
          variant={state.racialVariant}
          onVariantChange={state.chooseRacialVariant}
          repeated={repeatedGrants(background?.skills, race.skills)}
          repeatSkills={state.repeatSkills}
          onRepeatChange={(index, skill) =>
            state.setRepeatSkills((current) => {
              const next = [...current];
              next[index] = skill;
              return next;
            })
          }
          feats={state.feats}
          onFeatsChange={state.setFeats}
          featAbility={state.racialFeatAbility}
          onFeatAbilityChange={state.setRacialFeatAbility}
          featSpecOf={derived.featSpecOf}
          featDescOf={derived.featDescOf}
          featChoices={state.featChoices}
          onFeatPicks={state.setFeatPicks}
          known={knownTraining(derived)}
          inputClass={inputClass}
        />
      ) : null}
    </div>
  );
}

const ABILITY_WORDS: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

// The size facet's labels read the reader's language (LineageCarousel's
// sizeWords idiom): the stored values stay the English ids. A size the
// dictionary does not carry reads as it was spelled.
const SIZE_LABEL_KEYS: Record<string, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
};

function sizeLabel(t: (key: string, vars?: Record<string, string | number>) => string, size: string): string {
  const key = SIZE_LABEL_KEYS[textKey(size)];
  return key ? t(key) : size;
}

// The race grid's filters: what a lineage raises, which classes it suits,
// its size and its book. Each offers only the values some lineage has. A
// lineage whose bumps are the player's to place raises anything they like
// and suits any class.
function raceFacets(t: (key: string, vars?: Record<string, string | number>) => string, locale: "en" | "fr", slides: LineageSlide[]): CardFacet[] {
  const byId = new Map(slides.map((slide) => [slide.id, slide]));
  const sizeOf = (id: string) => srdRaceFor(id)?.size ?? "";
  const bookOf = (slide: LineageSlide) => slide.source || t("Core rules");
  const sizes = [...new Set(slides.map((slide) => sizeOf(slide.id)).filter(Boolean))].sort();
  const books = [...new Set(slides.map(bookOf))].sort();
  return [
    {
      key: "raises",
      label: t("Raises"),
      options: ABILITY_WORDS.map((value) => ({ value, label: ({ "str": t("Strength"), "dex": t("Dexterity"), "con": t("Constitution"), "int": t("Intelligence"), "wis": t("Wisdom"), "cha": t("Charisma") } as Record<string, string>)[value] ?? String(value) })),
      test: (id, ability) => {
        const slide = byId.get(id);
        return Boolean(slide && ((slide.asi[ability as Ability] ?? 0) > 0 || slide.asiChoice));
      },
    },
    {
      key: "suits",
      label: t("Good for"),
      // The class names read in the reader's language (BuildMathPanel's
      // contentName); the tested value stays the stored English name.
      options: SRD_CLASSES.map((klass) => ({ value: klass.name, label: contentName("classes", klass.name, locale) })),
      test: (id, className) => {
        const slide = byId.get(id);
        const fits = slide ? lineageFits(slide, 13) : null;
        return Boolean(fits && (fits.kind === "any" || fits.names.includes(className)));
      },
    },
    ...(sizes.length > 1
      ? [{ key: "size", label: t("Size"), options: sizes.map((size) => ({ value: size, label: sizeLabel(t, size) })), test: (id: string, size: string) => sizeOf(id) === size }]
      : []),
    ...(books.length > 1
      ? [{ key: "book", label: t("Book"), options: books.map((book) => ({ value: book, label: book })), test: (id: string, book: string) => { const slide = byId.get(id); return Boolean(slide && bookOf(slide) === book); } }]
      : []),
  ];
}

// A lineage id as a name, for one the table does not offer ("half_orc" is
// "Half Orc").
function speciesWords(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// One slide per picker row, in the picker's order: what the grid's cards,
// the carousel and the build math panel's picks all show of a lineage.
export function lineageSlidesFor(
  raceGroups: PickerGroup[],
  races: Array<Reskinned<RaceOption>>,
  gender: BuilderState["gender"],
): LineageSlide[] {
  return flattenGroups(raceGroups).flatMap(({ option, group, recommended }) => {
    const entry = races.find((candidate) => candidate.id === option.id);
    if (!entry) {
      return [];
    }
    return [
      {
        ...entry,
        // The name as the picker shows it, in the reader's language; the art
        // and the heritage reads keep the English entry name.
        name: option.name,
        art: lineageArt(entry.id, `${option.meta ?? ""} ${entry.name}`, gender),
        canonical: option.meta,
        // Named on the card only where the group heading is not the book.
        sourceOnCard: option.source,
        group,
        recommended,
        info: { text: option.infoText, reference: option.reference },
      },
    ];
  });
}
