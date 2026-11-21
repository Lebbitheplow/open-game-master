"use client";

import { useId } from "react";
import { featAbilityIncrease } from "@/lib/srd/feat-effects";
import type { FeatChoices, FeatGrantSpec, FeatPicks } from "@/lib/srd/feat-grants";
import FeatChoicesFields, { type KnownTraining } from "./FeatChoicesFields";
import { X } from "lucide-react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { useLocale, useT, useTp } from "@/lib/locale";
import { contentName } from "@/lib/content/names";
import { contentSlug } from "@/lib/help";
import { abilityMod, formatModifier } from "@/lib/srd";
import { ABILITY_SCORE_CAP, applyAsiChoices } from "@/lib/srd/asi";
import { halfFeatPicks, scoresWithHalfFeats } from "@/lib/srd/legality/half-feats";
import type { Ability, AbilityScores, AsiChoice } from "@/lib/schemas/sheet";
import type { PrerequisiteCheck } from "@/lib/srd/legality/features";
import { ABILITY_LABELS } from "./AbilityEditor";
import CatalogBrowser from "./CatalogBrowser";
import ContentPicker from "./ContentPicker";
import { judgeEntry, prerequisiteNote, useFeatJudge } from "./featPrereqs";
import { featChoice as featPicksOf } from "@/lib/schemas/sheet";

const ABILITY_KEYS = Object.keys(ABILITY_LABELS) as Ability[];

// The three ways an improvement goes, keyed (builder.asi.mode.*); the
// reader's words come at render.
const MODES = ["plus2", "plus1x2", "feat"] as const;
const MODE_LABELS: Record<(typeof MODES)[number], string> = {
  plus2: "+2 one ability",
  plus1x2: "+1 two abilities",
  feat: "Feat",
};

// One card per earned Ability Score Improvement (levels 4/8/12/16/19).
// Choices apply in order, so each card's selects reflect the scores after
// every earlier card; abilities already at the 20 cap are disabled.
export default function AsiFeatEditor({
  level,
  slotLevels,
  baseScores,
  choices,
  takenInPlay = [],
  onChange,
  featSpecOf,
  featDescOf,
  featChoices,
  onFeatPicks,
  known,
}: {
  // Character level for the builder's "Level N: X earned" heading; absent in
  // the level-up dialog, which introduces the section with its own copy.
  level?: number;
  slotLevels: number[];
  baseScores: AbilityScores | null;
  choices: Array<AsiChoice | null>;
  // Slots an edited character took at the table: already in the scores, so
  // shown as settled rather than asked for again (asiSlotsTakenInPlay).
  takenInPlay?: boolean[];
  onChange: (choices: Array<AsiChoice | null>) => void;
  // What a feat grants beyond its point and the picks it leaves open
  // (src/lib/srd/feat-grants.ts), picked under the feat's chip.
  featSpecOf?: (name: string) => FeatGrantSpec;
  // The feat's text where known, for a content pack half-feat's score.
  featDescOf?: (name: string) => string;
  featChoices?: FeatChoices;
  onFeatPicks?: (feat: string, picks: FeatPicks) => void;
  known?: KnownTraining;
}) {
  function setChoice(index: number, choice: AsiChoice | null) {
    const next = slotLevels.map((_, slot) => choices[slot] ?? null);
    next[index] = choice;
    onChange(next);
  }

  // The builder's prerequisite check (featPrereqs.ts); absent in the
  // level-up dialog, whose server answer names an unmet requirement.
  const judge = useFeatJudge();
  const noteId = useId();
  const t = useT();
  const tp = useTp();
  const locale = useLocale();
  // A stored feat name as the reader reads it (the official maps); the pick
  // itself, the reference lookups and the data-* attributes stay English.
  const featName = (feat: string) => contentName("feats", feat, locale);
  // An ability key as its name in the reader's language (sheet.ability.*).
  const abilityWord = (ability: Ability) =>
    t(
      ({
        str: "Strength",
        dex: "Dexterity",
        con: "Constitution",
        int: "Intelligence",
        wis: "Wisdom",
        cha: "Charisma",
      } as Record<Ability, string>)[ability] ?? ability,
    );

  const unresolved = slotLevels.filter((_, index) => !choices[index] && !takenInPlay[index]).length;

  return (
    <section className="panel ornate rounded-xl border-amber-500/30 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="eyebrow text-xs text-amber-200/90">
          {level
            ? tp("Level {level}: {count} ability score improvement earned", "Level {level}: {count} ability score improvements earned", { level, count: slotLevels.length })
            : t("Ability score improvements")}
        </h2>
        {unresolved > 0 ? (
          <span className="rounded-full border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[0.875rem] text-amber-200">
            {t("{count} to pick", { count: unresolved })}
          </span>
        ) : (
          <span className="rounded-full border border-stone-700 bg-stone-900 px-2 py-0.5 text-[0.875rem] text-stone-400">
            {t("All picked")}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-stone-500">
        {t("This is how higher-level characters raise their stats. Each earned level grants +2 to one {abilityScore}, +1 to two of them, or a feat. Scores cap at {cap}.", { abilityScore: t("Ability scores", { context: "builder.dice.abilityScores" }), cap: ABILITY_SCORE_CAP })}
      </p>
      {!baseScores ? (
        <p className="rounded-md border border-stone-800 bg-stone-900/60 p-3 text-xs text-stone-400">
          {t("Assign all six ability scores first.")}
        </p>
      ) : (
        <div className="space-y-3">
          {slotLevels.map((slotLevel, index) => {
            const choice = choices[index] ?? null;
            // Scores as they stand entering this slot: base plus all
            // earlier choices, a half-feat's point among them.
            const current = scoresEntering(baseScores, choices.slice(0, index), featDescOf);
            if (takenInPlay[index]) {
              return (
                <div
                  key={slotLevel}
                  className="reveal rounded-lg border border-stone-800 bg-stone-950/60 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-stone-300">{t("Level {level} improvement", { level: slotLevel })}</span>
                    <span className="rounded-full border border-stone-700 bg-stone-900 px-2 py-0.5 text-[0.875rem] text-stone-400">
                      {t("Taken in play")}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    {t("Chosen at the table when this character levelled up, so it is already in the scores above. A feat taken with it stays in the feats list.")}
                  </p>
                </div>
              );
            }
            return (
              <div
                key={slotLevel}
                className="rounded-lg border border-stone-800 bg-stone-950/60 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-stone-300">{t("Level {level} improvement", { level: slotLevel })}</span>
                  <div className="flex rounded-md border border-stone-700 p-0.5 text-xs">
                    {MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (mode === "feat") {
                            // Clears back to the feat search; picking a feat resolves it.
                            setChoice(index, null);
                          } else if (mode === "plus2") {
                            // A score the whole +2 fits under the cap first, so
                            // the default never throws a point away.
                            setChoice(index, { mode: "plus2", ability: firstOpenAbility(current, undefined, 2) });
                          } else {
                            const first = firstOpenAbility(current);
                            const second = firstOpenAbility(current, first);
                            setChoice(index, { mode: "plus1x2", abilities: [first, second] });
                          }
                        }}
                        className={cn(
                          "rounded px-2.5 py-1",
                          choice?.mode === mode
                            ? "bg-amber-900/60 text-amber-200"
                            : "text-stone-400 hover:text-stone-200",
                        )}
                      >
                        {t(MODE_LABELS[mode])}
                      </button>
                    ))}
                  </div>
                </div>

                {choice?.mode === "plus2" ? (
                  <label className="block sm:w-64">
                    <span className="mb-1 block text-xs text-stone-500">{t("+2 to")}</span>
                    <Select<Ability>
                      value={choice.ability}
                      onChange={(ability) => setChoice(index, { mode: "plus2", ability })}
                      label={t("+2 to")}
                      className="w-full"
                      options={ABILITY_KEYS.map((ability) => ({
                        value: ability,
                        label: `${abilityWord(ability)} (${current[ability]}${current[ability] >= ABILITY_SCORE_CAP ? t(", at cap") : ""})`,
                        disabled: current[ability] >= ABILITY_SCORE_CAP && ability !== choice.ability,
                      }))}
                    />
                  </label>
                ) : null}

                {choice?.mode === "plus1x2" ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {([0, 1] as const).map((half) => (
                      <label key={half} className="block">
                        <span className="mb-1 block text-xs text-stone-500">
                          {half === 0 ? t("First +1") : t("Second +1")}
                        </span>
                        <Select<Ability>
                          value={choice.abilities[half]}
                          onChange={(picked) => {
                            const abilities = [...choice.abilities] as [Ability, Ability];
                            abilities[half] = picked;
                            setChoice(index, { mode: "plus1x2", abilities });
                          }}
                          label={half === 0 ? t("First +1") : t("Second +1")}
                          className="w-full"
                          options={ABILITY_KEYS.map((ability) => ({
                            value: ability,
                            label: `${abilityWord(ability)} (${current[ability]}${current[ability] >= ABILITY_SCORE_CAP ? t(", at cap") : ""})`,
                            disabled:
                              (current[ability] >= ABILITY_SCORE_CAP && ability !== choice.abilities[half]) ||
                              ability === choice.abilities[half === 0 ? 1 : 0],
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                {choice === null || choice.mode === "feat" ? (
                  <div>
                    {choice?.mode === "feat" ? (
                      <>
                      <span
                        className={cn(
                          "mb-2 inline-flex items-center gap-1 rounded-full border bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200",
                          judge?.checkFeat(choice.feat)?.state === "unmet" ? "border-red-500/70" : "border-amber-800",
                        )}
                      >
                        {featName(choice.feat)}
                        <InfoButton
                          label={featName(choice.feat)}
                          reference={{
                            kind: "feats",
                            slug: contentSlug(choice.feat),
                            name: choice.feat,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setChoice(index, null)}
                          aria-label={t("Remove {feat}", { feat: featName(choice.feat) })}
                          aria-describedby={(judge?.checkFeat(choice.feat)?.state ?? "none") !== "none" ? `${noteId}-${index}` : undefined}
                          className="text-stone-500 hover:text-red-400"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                      <SelectedPrerequisite id={`${noteId}-${index}`} check={judge?.checkFeat(choice.feat) ?? null} />
                      </>
                    ) : (
                      <>
                        <ContentPicker
                          kind="feats"
                          placeholder={t("Search feats (e.g. alert, tough)")}
                          judge={judge ? (entry) => judgeEntry(judge, entry, true) : undefined}
                          onPick={(entry) => setChoice(index, featChoice(entry.name, featDescOf?.(entry.name)))}
                        />
                        {/* Nobody picks a feat they cannot name; the list is
                            here, with what each one does on every row. */}
                        <CatalogBrowser
                          kind="feats"
                          buttonLabel={t("Browse every feat")}
                          selectedNames={[]}
                          judge={judge ? (entry) => judgeEntry(judge, entry, true) : undefined}
                          onPick={(entry) => setChoice(index, featChoice(entry.name))}
                          sections={[{ key: "feats:all", label: t("All feats") }]}
                        />
                      </>
                    )}
                  </div>
                ) : null}

                {choice?.mode === "feat" && (featAbilityIncrease(choice.feat, featDescOf?.(choice.feat))?.from.length ?? 0) > 1 ? (
                  // A half-feat that offers a choice of score (Resilient,
                  // Athlete) asks which one it raises.
                  <label className="mt-2 block sm:w-64">
                    <span className="mb-1 block text-xs text-stone-500">{t("{feat} raises by 1", { feat: featName(choice.feat) })}</span>
                    <Select<Ability>
                      value={choice.ability ?? featAbilityIncrease(choice.feat, featDescOf?.(choice.feat))!.from[0]}
                      onChange={(ability) => setChoice(index, { ...choice, ability })}
                      label={t("{feat} raises", { feat: featName(choice.feat) })}
                      className="w-full"
                      options={featAbilityIncrease(choice.feat, featDescOf?.(choice.feat))!.from.map((ability) => ({
                        value: ability,
                        label: `${abilityWord(ability)} (${current[ability]})`,
                        disabled: current[ability] >= ABILITY_SCORE_CAP && ability !== choice.ability,
                      }))}
                    />
                  </label>
                ) : null}

                {choice?.mode === "feat" && featSpecOf && onFeatPicks && known ? (
                  <FeatChoicesFields
                    feat={choice.feat}
                    desc={featDescOf?.(choice.feat)}
                    spec={featSpecOf(choice.feat)}
                    picks={featPicksOf(featChoices, choice.feat)}
                    known={known}
                    onChange={(picks) => onFeatPicks(choice.feat, picks)}
                  />
                ) : null}

                {choice ? (
                  <p className="mt-2 text-xs text-stone-500">
                    {choice.mode === "feat"
                      ? t("Feat: {feat}{raise}", { feat: featName(choice.feat), raise: featRaise(current, choice, featDescOf, abilityWord) })
                      : summarizeChoice(current, choice, abilityWord)}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-stone-500">
                    {t("Pick +2, two +1s, or search a feat above.")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// A picked feat's prerequisite, rechecked as the choices it depends on
// change. One a later choice broke is flagged here and at Continue, and
// left on the sheet: the player decides what to change.
export function SelectedPrerequisite({ id, check }: { id: string; check: PrerequisiteCheck | null }) {
  const t = useT();
  if (!check || check.state === "none") {
    return null;
  }
  return (
    <p
      id={id}
      className={cn(
        "mb-2 text-xs",
        check.state === "unmet" ? "text-red-300" : check.state === "waiting" ? "text-amber-200/80" : "text-stone-500",
      )}
    >
      {check.state === "unmet" ? t("Requirement not met: ") : t("Requires: ")}
      {prerequisiteNote(check)}
      {check.state === "unmet" ? t(". Pick another feat, or change what it depends on.") : ""}
    </p>
  );
}

// A feat pick, with the first score a choosing half-feat offers already set
// so the choice is never left blank.
function featChoice(feat: string, desc?: string): AsiChoice {
  const increase = featAbilityIncrease(feat, desc);
  return increase && increase.from.length > 1
    ? { mode: "feat", feat, ability: increase.from[0] }
    : { mode: "feat", feat };
}

// The scores after these choices, with each half-feat's point added the way
// the server adds it (src/lib/srd/legality/half-feats.ts).
function scoresEntering(base: AbilityScores, earlier: Array<AsiChoice | null>, descOf?: (name: string) => string): AbilityScores {
  const picks = earlier.filter((choice): choice is AsiChoice => choice !== null);
  return scoresWithHalfFeats(applyAsiChoices(base, picks), halfFeatPicks({ asiChoices: picks }, 0, descOf)).abilities;
}

// ", Charisma 15 to 16 (+3)" for a half-feat, nothing for any other feat.
function featRaise(
  current: AbilityScores,
  choice: AsiChoice,
  descOf: ((name: string) => string) | undefined,
  abilityWord: (ability: Ability) => string,
): string {
  if (choice.mode !== "feat") {
    return "";
  }
  const after = scoresEntering(current, [choice], descOf);
  const raised = ABILITY_KEYS.find((ability) => after[ability] > current[ability]);
  return raised
    ? `, ${abilityWord(raised)} ${current[raised]} → ${after[raised]} (${formatModifier(abilityMod(after[raised]))})`
    : "";
}

function firstOpenAbility(scores: AbilityScores, skip?: Ability, room = 1): Ability {
  const fits = (need: number) =>
    ABILITY_KEYS.find((ability) => ability !== skip && scores[ability] + need <= ABILITY_SCORE_CAP);
  return fits(room) ?? fits(1) ?? ABILITY_KEYS.find((ability) => ability !== skip) ?? "str";
}

function summarizeChoice(current: AbilityScores, choice: AsiChoice, abilityWord: (ability: Ability) => string): string {
  const after = applyAsiChoices(current, [choice]);
  const touched =
    choice.mode === "plus2" ? [choice.ability] : choice.mode === "plus1x2" ? choice.abilities : [];
  return touched
    .map(
      (ability) =>
        `${abilityWord(ability)} ${current[ability]} → ${after[ability]} (${formatModifier(abilityMod(after[ability]))})`,
    )
    .join(", ");
}
