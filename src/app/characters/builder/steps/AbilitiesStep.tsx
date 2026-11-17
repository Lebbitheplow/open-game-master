"use client";

import { ui } from "@/lib/ui";
import { useLocale, useT, useTp } from "@/lib/locale";
import type { Locale } from "@/lib/messages-logic";
import { contentName } from "@/lib/content/names";
import { scoresFromSlots } from "../abilityDice";
import AbilityEditor, { STANDARD_ARRAY } from "../AbilityEditor";
import { abilityPriority, keyAbilities, poolSlotsFor, standardFor } from "../classAbilities";
import type { HpExplainerInput } from "../AbilityExplainers";
import AsiFeatEditor from "../AsiFeatEditor";
import { knownTraining } from "../FeatChoicesFields";
import type { ClassOption, RaceOption } from "../useBuilderOptions";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { PickForMe } from "./shared";

// An ability key as its name in the reader's language (sheet.ability.*).
const ABILITY_WORDS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
} as const;

// What the health explainer works from, shared with the Max HP line on the
// last step: both read derived.hp (builderHp.ts), the figure the server
// saves. Null until the class and all six scores are known.
export function hpExplainerInput(
  derived: BuilderDerived,
  klass: ClassOption | undefined,
  locale: Locale = "en",
): HpExplainerInput | null {
  if (!klass || !derived.shownAbilities || !derived.hp) {
    return null;
  }
  return {
    // The explainer's sentences name the class, so it reads in the reader's
    // language (contentName).
    className: contentName("classes", klass.name, locale),
    // The Constitution the sheet will hold, a half-feat's point included.
    con: derived.shownAbilities.con,
    level: derived.effectiveLevel,
    hp: derived.hp,
  };
}

// "A fighter leans on Strength or Dexterity, then Constitution", and a button
// that lays the standard array (or a thrown pool) on the abilities in that
// order. A first-time player otherwise spreads the 15 at random and plays a
// fighter who cannot hit. Point buy is left to the player: it is chosen by
// people who want the shape themselves.
function PlaceForClass({ state, klass }: { state: BuilderState; klass: ClassOption }) {
  const t = useT();
  const tp = useTp();
  const locale = useLocale();
  const pool = state.rollPool;
  if (state.method === "pointbuy" || (state.method === "roll" && !pool)) {
    return null;
  }
  const words = (ability: string) => t(ABILITY_WORDS[ability as keyof typeof ABILITY_WORDS] ?? ability);
  const keys = keyAbilities(klass);
  const named = new Set(keys.flat());
  const then = abilityPriority(klass).find((ability) => !named.has(ability));
  const needs = keys.map((group) => group.map(words).join(` ${t("and")} `)).join(` ${t("or")} `);
  const className = contentName("classes", klass.name, locale);
  const article = /^[aeiou]/i.test(klass.name) ? "An" : "A";
  function place() {
    if (state.method === "standard") {
      state.setScores(standardFor(klass, STANDARD_ARRAY));
    } else if (pool) {
      const slots = poolSlotsFor(klass, pool.map((entry) => entry.total));
      state.setRollSlots(slots);
      state.setScores(scoresFromSlots(slots, pool));
    }
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2 text-xs text-stone-300">
      <span className="min-w-0 flex-1">
        {t("{article} {class} leans on {needs}{then}.", {
          article,
          class: className.toLowerCase(),
          needs,
          then: then ? t(", then {ability}", { ability: words(then) }) : "",
        })}
      </span>
      <button type="button" onClick={place} className={ui.btnSmall}>
        {t("Place them for {article} {class}", { article: article.toLowerCase(), class: className })}
      </button>
    </div>
  );
}

// Step 4: the six scores by standard array, point buy or 4d6, then one card
// per ability score improvement the level has earned. Hit points are derived
// on the last step, never typed; the explainer under the summary
// only shows how that number comes about.
export function AbilitiesStep({
  state,
  derived,
  race,
  klass,
  onPickForMe,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  // "Pick for me" on the improvements the level brings (quickBuild.ts):
  // the cards stay blank until it is pressed.
  onPickForMe?: (target: "asi") => void;
}) {
  const t = useT();
  const tp = useTp();
  const locale = useLocale();
  const { asiSlotLevels, activeAsiChoices, asiTakenInPlay, asiBaseAbilities, effectiveLevel } = derived;
  const asiToPick = asiTakenInPlay.filter((taken) => !taken).length;
  const asiOpen = activeAsiChoices.filter((choice, index) => choice === null && !asiTakenInPlay[index]).length;
  return (
    <div className="space-y-4">
      <div data-builder-target="scores">
      {klass ? <PlaceForClass state={state} klass={klass} /> : null}
      <AbilityEditor
        method={state.method}
        onMethodChange={state.setMethod}
        scores={state.scores}
        onScoresChange={state.setScores}
        pool={state.rollPool}
        onPoolChange={state.setRollPool}
        slots={state.rollSlots}
        onSlotsChange={state.setRollSlots}
        // The race's bumps (the half-elf's chosen ones too) and what the
        // improvements, half-feats and Primal Champion add after them, so
        // "Final" here is the number the sheet will carry (issue #149).
        racialBonus={derived.racialBonus}
        gains={derived.abilityGains}
        asiCount={asiToPick}
        who={
          race && klass
            ? `${contentName("species", race.name, locale)} ${contentName("classes", klass.name, locale)}`.toLowerCase()
            : ""
        }
        hp={hpExplainerInput(derived, klass, locale)}
      />
      </div>
      {asiSlotLevels.length ? (
        <div data-builder-target="asi">
        {onPickForMe && asiOpen > 0 ? (
          <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-400">
            <span className="grow">
              {t(asiOpen === 1 ? "One improvement is still to choose. Pick for me adds the points to {scores} main scores, never a feat." : "{count} improvements are still to choose. Pick for me adds the points to {scores} main scores, never a feat.", {
                count: asiOpen,
                scores: klass ? t("a {class}'s", { class: klass.name.toLowerCase() }) : t("the"),
              })}
            </span>
            <PickForMe what={tp("the improvement", "the improvements", { count: asiOpen })} onPick={() => onPickForMe("asi")} />
          </p>
        ) : null}
        <AsiFeatEditor
          level={effectiveLevel}
          slotLevels={asiSlotLevels}
          // A variant human's feat point is in from the first card on.
          baseScores={asiBaseAbilities}
          choices={activeAsiChoices}
          takenInPlay={asiTakenInPlay}
          featSpecOf={derived.featSpecOf}
          featDescOf={derived.featDescOf}
          featChoices={state.featChoices}
          onFeatPicks={state.setFeatPicks}
          known={knownTraining(derived)}
          onChange={(next) =>
            state.setAsiChoices((current) => {
              const merged = [...current];
              next.forEach((choice, index) => {
                merged[index] = choice;
              });
              return merged;
            })
          }
        />
        </div>
      ) : null}
    </div>
  );
}
