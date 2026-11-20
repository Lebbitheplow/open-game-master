"use client";

import { asiPickAmount, asiPickWords } from "@/lib/srd/race-asi";
import { useId } from "react";
import CatalogBrowser from "@/app/characters/builder/CatalogBrowser";
import ContentPicker from "@/app/characters/builder/ContentPicker";
import type { RaceOption } from "@/app/characters/builder/useBuilderOptions";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { KNOWN_TOOLS } from "@/lib/srd/feat-grant-text";
import { toolLabel, toolPickOptions } from "@/lib/srd/tool-choices";
import { contentSlug, describeSkill, glossaryTerm } from "@/lib/help";
import { ABILITIES, type Ability } from "@/lib/schemas/sheet";
import { featAbilityIncrease } from "@/lib/srd/feat-effects";
import type { FeatChoices, FeatGrantSpec, FeatPicks } from "@/lib/srd/feat-grants";
import FeatChoicesFields, { type KnownTraining } from "./FeatChoicesFields";
import { SelectedPrerequisite } from "./AsiFeatEditor";
import { judgeEntry, useFeatJudge } from "./featPrereqs";
import { racialFeatCount } from "@/lib/srd/race-id";
import { DRACONIC_ANCESTRIES, takesDraconicAncestry } from "@/lib/srd/racial-grants";
import { variantGivesAnything, variantShort, variantSummary } from "@/lib/content/species-variants";
import { Chip } from "./steps/shared";
import { RacialCantripPicker } from "./RacialCantripPicker";
import { featChoice } from "@/lib/schemas/sheet";
import { skillLabel } from "@/lib/srd";
import { useLocale, useT, useTp } from "@/lib/locale";
import { contentName } from "@/lib/content/names";

// An ability key as its name in the reader's language (sheet.ability.*).
const ABILITY_LABEL_KEYS: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};



// The picks a race offers instead of fixing: half-elf's two +1 ability
// bumps and two skills, high elf's wizard cantrip, hill dwarf's tool, the
// variant human's feat. Until these existed the grants were silently
// dropped, leaving those characters weaker than the rules allow.
export function RacialChoicesSection({
  race,
  grantedSkills,
  asi,
  onAsiChange,
  skills,
  onSkillsChange,
  cantrips,
  onCantripsChange,
  tool,
  onToolChange,
  weapons = [],
  onWeaponsChange,
  training = [],
  onTrainingChange,
  expertise = "",
  onExpertiseChange,
  ancestry = "",
  onAncestryChange,
  variant = "",
  onVariantChange,
  repeated = [],
  repeatSkills = [],
  onRepeatChange,
  feats = [],
  onFeatsChange,
  featAbility = "",
  onFeatAbilityChange,
  featSpecOf,
  featDescOf,
  featChoices,
  onFeatPicks,
  known,
}: {
  race: RaceOption;
  // Skills already granted by class and background, so they are not offered
  // twice (a duplicate pick would waste the racial choice).
  grantedSkills: string[];
  asi: Array<Ability | "">;
  onAsiChange: (index: number, ability: Ability | "") => void;
  skills: string[];
  onSkillsChange: (index: number, skill: string) => void;
  cantrips: string[];
  onCantripsChange: (cantrips: string[]) => void;
  tool: string;
  onToolChange: (tool: string) => void;
  // The weapons the race lets the player name (a hobgoblin's two martial
  // weapons), slot by slot.
  weapons?: string[];
  onWeaponsChange?: (index: number, weapon: string) => void;
  // Skills or tools in any mix (a human chassis's Adaptable Acumen), slot by
  // slot, and the skill its expertise doubles.
  training?: string[];
  onTrainingChange?: (index: number, pick: string) => void;
  expertise?: string;
  onExpertiseChange?: (skill: string) => void;
  // A dragonborn's draconic ancestry, by id.
  ancestry?: string;
  onAncestryChange?: (ancestry: string) => void;
  // The option of a workshop species' choice (a Half-Dragon's ancestry), by
  // id, for a race that offers one.
  variant?: string;
  onVariantChange?: (variant: string) => void;
  // Skills the race and the background both give, and the ones chosen in
  // their place.
  repeated?: string[];
  repeatSkills?: string[];
  onRepeatChange?: (index: number, skill: string) => void;
  // The variant human's feat, picked here with the race's other choices
  // (issue #124: it sat four steps away and no gate asked for it), and the
  // score a half-feat raises where it offers one (Resilient, Athlete).
  feats?: string[];
  onFeatsChange?: (feats: string[]) => void;
  featAbility?: Ability | "";
  onFeatAbilityChange?: (ability: Ability | "") => void;
  // What the feat grants beyond its point and the picks it leaves open
  // (src/lib/srd/feat-grants.ts), picked right under the feat.
  featSpecOf?: (name: string) => FeatGrantSpec;
  // The feat's text where known, for a content pack half-feat's score.
  featDescOf?: (name: string) => string;
  featChoices?: FeatChoices;
  onFeatPicks?: (feat: string, picks: FeatPicks) => void;
  known?: KnownTraining;
  inputClass: string;
}) {
  const t = useT();
  const tp = useTp();
  const locale = useLocale();
  const draconic = takesDraconicAncestry(race.id);
  const racialFeats = onFeatsChange ? racialFeatCount(race.id) : 0;
  const hasChoices = Boolean(
    race.asiChoice || race.skillChoice || race.cantripChoice || race.toolChoice || race.weaponChoice || race.trainingChoice || race.expertiseChoice || draconic || race.variants || repeated.length || racialFeats,
  );
  const chosen = race.variants?.options.find((option) => option.id === variant) ?? null;
  // The half-feat's choice of score, offered once the feat is picked.
  const featScores = racialFeats ? (featAbilityIncrease(feats[0] ?? "", featDescOf?.(feats[0] ?? ""))?.from ?? []) : [];
  // The builder's prerequisite check (featPrereqs.ts): read off each row,
  // and rechecked on the feat once picked.
  const judge = useFeatJudge();
  const noteId = useId();
  const abilityWord = (ability: Ability | string) => t(ABILITY_LABEL_KEYS[ability as Ability] ?? String(ability));
  const pickFeat = (name: string) => {
    if (!onFeatsChange || feats.includes(name) || feats.length >= racialFeats) {
      return;
    }
    onFeatsChange([...feats, name]);
  };
  if (!hasChoices) {
    return null;
  }

  // A half-elf's +1s go to abilities other than the one the race already
  // raises, per the SRD.
  const fixedAbilities = new Set(Object.keys(race.asi) as Ability[]);
  // An either-or increase ("Strength or Dexterity") offers only its two.
  const asiFrom = race.asiChoice?.from;

  return (
    <div className="space-y-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
      <p className="text-xs text-amber-200/90">{t("{race} choices", { race: race.name })}</p>

      {/* First: what it gives changes what the picks below may be. */}
      {race.variants && onVariantChange ? (
        <div data-builder-target="variant">
          <label className="block">
            <span className="mb-1 block text-stone-400">
              {t("{label}: it changes what your {species} gets", { label: race.variants.label, species: race.name })}
            </span>
            <Select<string>
              value={variant}
              onChange={onVariantChange}
              className="w-full"
              label={race.variants.label}
              placeholder={t("Choose one...")}
              options={[
                { value: "", label: t("Choose one...") },
                ...race.variants.options.map((option) => ({
                  value: option.id,
                  label: variantGivesAnything(option) ? `${option.name} (${variantShort(option)})` : option.name,
                })),
              ]}
            />
          </label>
          {/* What the pick gives, when its own fields give anything: a pick
              the species' rules read from itself (a size, an ability) says
              nothing more than its name. */}
          {chosen && (variantGivesAnything(chosen) || chosen.description) ? (
            <p className="live-in mt-1 whitespace-pre-line text-xs text-stone-400" data-variant-summary>
              {[variantGivesAnything(chosen) ? variantSummary(chosen) : "", chosen.description ?? ""].filter(Boolean).join("\n")}
            </p>
          ) : null}
        </div>
      ) : null}

      {race.asiChoice ? (
        <div data-builder-target="racialAsi">
          <span className="mb-1 block text-stone-400">
            <GameTerm id="ability_score">Ability</GameTerm>{" "}
            {race.asiChoice.amounts
              ? `increases (${asiPickWords(race.asiChoice)} to ${asiFrom ? asiFrom.map((ability) => abilityWord(ability)).join(" or ") : `${race.asiChoice.count} abilities of your choice`})`
              : t(" increases (+{amount} to {from})", {
                  amount: race.asiChoice.amount,
                  from: asiFrom
                    ? t("{from} or {count} abilities of your choice", {
                        from: asiFrom.map((ability) => abilityWord(ability)).join(" or "),
                        count: race.asiChoice.count,
                      })
                    : "",
                })}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.asiChoice.count }, (_, index) => (
              <span key={index} className="flex items-center gap-1">
                <Select<Ability | "">
                  value={asi[index] ?? ""}
                  onChange={(next) => onAsiChange(index, next)}
                  className="min-w-0 grow"
                  label={race.asiChoice!.amounts ? `Ability increase ${index + 1} (+${asiPickAmount(race.asiChoice!, index)})` : t("Ability increase {n}", { n: index + 1 })}
                  placeholder={t("Choose an ability...")}
                  options={[
                    // Still a row of its own, so a pick can be taken back.
                    { value: "" as const, label: t("Choose an ability...") },
                    ...ABILITIES.filter(
                      (ability) =>
                        !fixedAbilities.has(ability) &&
                        (!asiFrom || asiFrom.includes(ability)) &&
                        (asi[index] === ability || !asi.includes(ability)),
                    ).map((ability) => ({ value: ability, label: abilityWord(ability) })),
                  ]}
                />
                {/* The ability's glossary entry as the skills' ⓘ: the words
                    "what is this?" squeezed the pick beside them to two
                    letters on a phone. */}
                {asi[index] ? <AbilityInfo ability={asi[index] as Ability} /> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {race.skillChoice ? (
        <div data-builder-target="racialSkills">
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
            <GameTerm id="skill">Skill</GameTerm>
            {t(" proficiencies ({count} of your choice)", { count: race.skillChoice.count })}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.skillChoice.count }, (_, index) => (
              <span key={index} className="flex items-center gap-1">
                <Select<string>
                  value={skills[index] ?? ""}
                  onChange={(next) => onSkillsChange(index, next)}
                  className="min-w-0 grow"
                  label={t("Skill proficiency {n}", { n: index + 1 })}
                  placeholder={t("Choose a skill...")}
                  options={[
                    { value: "", label: t("Choose a skill...") },
                    ...(race.skillChoice?.from?.length ? race.skillChoice.from : ALL_SKILLS).filter(
                      (skill) => skills[index] === skill || (!skills.includes(skill) && !grantedSkills.includes(skill)),
                    ).map((skill) => ({ value: skill as string, label: skillLabel(skill, locale) })),
                  ]}
                />
                {skills[index] ? (
                  <InfoButton
                    label={skillLabel(skills[index], locale)}
                    text={describeSkill(t, skills[index], locale)}
                  />
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {draconic && onAncestryChange ? (
        <label className="block" data-builder-target="ancestry">
          <span className="mb-1 block text-stone-400">
            {t("Draconic ancestry: your breath weapon's damage and save, and the damage you resist")}
          </span>
          <Select<string>
            value={ancestry}
            onChange={onAncestryChange}
            className="w-full"
            label={t("Draconic ancestry")}
            placeholder={t("Choose a dragon...")}
            options={[
              { value: "", label: t("Choose a dragon...") },
              ...DRACONIC_ANCESTRIES.map((entry) => ({
                value: entry.id,
                label: t("{dragon} ({type}, {area}, {save} save)", {
                  dragon: t(entry.dragon),
                  type: t(entry.damageType),
                  area: t(entry.area),
                  save: t(entry.save.toUpperCase()),
                }),
              })),
            ]}
          />
        </label>
      ) : null}

      {repeated.length && onRepeatChange ? (
        <div data-builder-target="repeatSkills">
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
            {t("Your race and background both give {list}; choose {choice} in its place", {
              list: repeated.map((id) => skillLabel(id, locale)).join(" and "),
              choice: tp("another skill", "{count} other skills", { count: repeated.length }),
            })}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {repeated.map((_, index) => (
              <span key={index} className="flex items-center gap-1">
                <Select<string>
                  value={repeatSkills[index] ?? ""}
                  onChange={(next) => onRepeatChange(index, next)}
                  className="min-w-0 grow"
                  label={t("Skill in place of a repeated one {n}", { n: index + 1 })}
                  placeholder={t("Choose a skill...")}
                  options={[
                    { value: "", label: t("Choose a skill...") },
                    ...ALL_SKILLS.filter(
                      (skill) =>
                        repeatSkills[index] === skill ||
                        (!repeatSkills.includes(skill) && !grantedSkills.includes(skill) && !skills.includes(skill)),
                    ).map((skill) => ({ value: skill as string, label: skillLabel(skill, locale) })),
                  ]}
                />
                {repeatSkills[index] ? (
                  <InfoButton label={skillLabel(repeatSkills[index], locale)} text={describeSkill(t, repeatSkills[index], locale)} />
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {racialFeats > 0 && onFeatsChange ? (
        <div data-builder-target="racialFeat">
          <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
            {t("Feat ({count} of your choice)", { count: racialFeats })}
          </span>
          <p className="mb-1.5 text-xs text-stone-500">
            {t("A feat is a talent other characters only earn with an ability score improvement; {race} starts with one. Browse the list (tap ⓘ to read what each does), or search by name if you already have one in mind.", { race: race.name })}
          </p>
          {feats.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {feats.map((feat) => (
                <Chip
                  key={feat}
                  label={contentName("feats", feat, locale)}
                  info={{ reference: { kind: "feats", slug: contentSlug(feat), name: feat } }}
                  onRemove={() => onFeatsChange(feats.filter((entry) => entry !== feat))}
                />
              ))}
            </div>
          ) : null}
          {feats.map((feat, index) => (
            <SelectedPrerequisite key={feat} id={`${noteId}-${index}`} check={judge?.checkFeat(feat) ?? null} />
          ))}
          {feats.length < racialFeats ? (
            <>
              <CatalogBrowser
                kind="feats"
                buttonLabel={t("Browse every feat")}
                selectedNames={feats}
                judge={judge ? (entry) => judgeEntry(judge, entry) : undefined}
                onPick={(entry) => pickFeat(entry.name)}
                onUnpick={(featName) => onFeatsChange(feats.filter((entry) => entry !== featName))}
                sections={[{ key: "feats:all", label: t("All feats") }]}
              />
              <p className="mt-2 mb-1 text-xs text-stone-500">{t("Or search by name:")}</p>
              <ContentPicker
                kind="feats"
                placeholder={t("Search feats (e.g. alert, tough)")}
                judge={judge ? (entry) => judgeEntry(judge, entry) : undefined}
                onPick={(entry) => pickFeat(entry.name)}
              />
            </>
          ) : null}
          {featSpecOf && onFeatPicks && known
            ? feats.slice(0, racialFeats).map((feat) => (
                <FeatChoicesFields
                  key={feat}
                  feat={feat}
                  desc={featDescOf?.(feat)}
                  spec={featSpecOf(feat)}
                  picks={featChoice(featChoices, feat)}
                  known={known}
                  onChange={(picks) => onFeatPicks(feat, picks)}
                />
              ))
            : null}
          {featScores.length > 1 && onFeatAbilityChange ? (
            <label className="mt-2 block sm:w-64">
              <span className="mb-1 block text-xs text-stone-500">{t("{feat} raises by 1", { feat: contentName("feats", feats[0], locale) })}</span>
              <Select<Ability>
                value={featScores.includes(featAbility as Ability) ? (featAbility as Ability) : featScores[0]}
                onChange={(ability) => onFeatAbilityChange(ability)}
                label={t("{feat} raises", { feat: contentName("feats", feats[0], locale) })}
                className="w-full"
                options={featScores.map((ability) => ({ value: ability, label: abilityWord(ability) }))}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {race.toolChoice ? (
        <label className="block" data-builder-target="racialTool">
          <span className="mb-1 block text-stone-400">{t("Tool proficiency")}</span>
          <Select<string>
            value={tool}
            onChange={onToolChange}
            className="w-full"
            label={t("Tool proficiency")}
            placeholder={t("Choose a tool...")}
            options={[{ value: "", label: t("Choose a tool...") }, ...toolPickOptions(race.toolChoice.from, t)]}
          />
        </label>
      ) : null}

      {race.weaponChoice && onWeaponsChange ? (
        <div data-builder-target="racialWeapons">
          <span className="mb-1 block text-stone-400">
            Weapon proficiencies ({race.weaponChoice.count} of your choice)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.weaponChoice.count }, (_, index) => (
              <Select<string>
                key={index}
                value={weapons[index] ?? ""}
                onChange={(next) => onWeaponsChange(index, next)}
                className="min-w-0"
                label={`Weapon proficiency ${index + 1}`}
                placeholder="Choose a weapon..."
                options={[
                  { value: "", label: "Choose a weapon..." },
                  ...race.weaponChoice!.from
                    .filter((weapon) => weapons[index] === weapon || !weapons.includes(weapon))
                    .map((weapon) => ({ value: weapon, label: weapon })),
                ]}
              />
            ))}
          </div>
        </div>
      ) : null}

      {race.trainingChoice && onTrainingChange ? (
        <div data-builder-target="racialTraining">
          <span className="mb-1 block text-stone-400">
            <GameTerm id="skill">Skill</GameTerm> or tool proficiencies ({race.trainingChoice.count} of your choice, in any mix)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: race.trainingChoice.count }, (_, index) => (
              <Select<string>
                key={index}
                value={training[index] ?? ""}
                onChange={(next) => onTrainingChange(index, next)}
                className="min-w-0"
                label={`Skill or tool proficiency ${index + 1}`}
                placeholder="Choose a skill or tool..."
                options={[
                  { value: "", label: "Choose a skill or tool..." },
                  ...ALL_SKILLS.filter((skill) => training[index] === skill || (!training.includes(skill) && !grantedSkills.includes(skill) && !skills.includes(skill))).map(
                    (skill) => ({ value: skill as string, label: skillLabel(skill, locale) }),
                  ),
                  ...toolPickOptions(KNOWN_TOOLS.filter((tool) => training[index] === tool || !training.includes(tool)), t),
                ]}
              />
            ))}
          </div>
        </div>
      ) : null}

      {race.expertiseChoice && onExpertiseChange ? (
        <label className="block" data-builder-target="racialExpertise">
          <span className="mb-1 block text-stone-400">
            Expertise: a skill or tool you are proficient in, its proficiency bonus doubled
          </span>
          <Select<string>
            value={expertise}
            onChange={onExpertiseChange}
            className="w-full"
            label="Expertise"
            placeholder="Choose a skill or tool..."
            options={[
              { value: "", label: "Choose a skill or tool..." },
              ...[...new Set([...grantedSkills, ...skills.filter(Boolean), ...training.filter((pick) => (ALL_SKILLS as readonly string[]).includes(pick))])].map((skill) => ({
                value: skill,
                label: skillLabel(skill, locale),
              })),
              // The tools the lineage trains (Adaptable Acumen's picks, its own list).
              ...[...new Set([...(race.tools ?? []), ...(tool ? [tool] : []), ...training.filter((pick) => KNOWN_TOOLS.includes(pick))])].map((held) => ({
                value: held,
                label: toolLabel(held, t),
              })),
            ]}
          />
        </label>
      ) : null}

      <RacialCantripPicker race={race} cantrips={cantrips} onChange={onCantripsChange} />
    </div>
  );
}

// An ability's glossary entry behind an ⓘ, as a skill pick's is.
function AbilityInfo({ ability }: { ability: Ability }) {
  const entry = glossaryTerm(ability);
  return entry ? <InfoButton label={entry.term} text={[entry.short, entry.long].filter(Boolean).join("\n\n")} /> : null;
}
