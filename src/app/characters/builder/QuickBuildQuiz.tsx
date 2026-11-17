"use client";

import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { textKey } from "@/lib/language/text-logic";
import { ui } from "@/lib/ui";
import { useT } from "@/lib/locale";
import { classRoles } from "@/lib/srd/class-roles";
import type { PlaystyleId } from "./playstyles";
import { abilityPriority } from "./classAbilities";
import {
  QUIZ_METHODS,
  QUIZ_OUTSIDE,
  QUIZ_ROLES,
  QUIZ_SOURCES,
  asksSource,
  suggestBuilds,
  type BuildSeed,
  type QuizAnswers,
} from "./quickBuild";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";

// "Help me build": four questions, then one suggested character and a
// second choice (brainstorms/2026-10-14-character-builder/
// quick-build-design.md). Choosing one fills the builder with it; every
// part is then the player's to change before saving. The DM's quick
// companion asks the first question about the party.

export type QuizVoice = "player" | "party";

type Question = {
  key: keyof QuizAnswers;
  title: string;
  // A job's gamer word, printed in bold brackets after it ("(Tank)").
  options: ReadonlyArray<{ id: string; label: string; tag?: string }>;
};

// The questions read in the reader's language (builder.quiz.*); the option
// ids stay the quiz's.
function questions(t: (key: string, vars?: Record<string, string | number>) => string, voice: QuizVoice, method: QuizAnswers["method"] | undefined): Question[] {
  return [
    {
      key: "role",
      title: voice === "party" ? t("What does the party need?") : t("In a fight, what's your job?"),
      options: QUIZ_ROLES,
    },
    { key: "method", title: voice === "party" ? t("How do they do it?") : t("How do you do it?"), options: QUIZ_METHODS },
    ...(asksSource(method)
      ? [{ key: "source" as const, title: voice === "party" ? t("Where does their power come from?") : t("Where does your power come from?"), options: QUIZ_SOURCES }]
      : []),
    {
      key: "outside",
      title: voice === "party" ? t("Outside a fight, they're the one who…") : t("Outside a fight, you're the one who…"),
      options: QUIZ_OUTSIDE,
    },
  ];
}

export function QuickBuildQuiz({
  voice = "player",
  classes,
  races,
  backgrounds,
  recommended,
  initial,
  onChoose,
  onCancel,
}: {
  voice?: QuizVoice;
  // What this builder offers, in its pickers' order and words.
  classes: ClassOption[];
  races: RaceOption[];
  backgrounds: BackgroundOption[];
  recommended?: ReadonlySet<string>;
  // A job already picked on the first step: the quiz opens on question 2.
  initial?: Partial<QuizAnswers>;
  onChoose: (seed: BuildSeed, answers: QuizAnswers) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<Partial<QuizAnswers>>(initial ?? {});
  const [page, setPage] = useState(initial?.role ? 1 : 0);
  const asked = questions(t, voice, answers.method);
  const done = page >= asked.length;
  // The source question counts until the second answer rules it out, so
  // the count never grows partway through.
  const total = answers.method ? asked.length : asked.length + 1;
  const question = asked[page];

  function answer(key: keyof QuizAnswers, id: string) {
    const next = { ...answers, [key]: id };
    // A source only means something for magic.
    if (key === "method" && !asksSource(id as QuizAnswers["method"])) {
      delete next.source;
    }
    setAnswers(next);
    setPage(page + 1);
  }

  const complete = done && answers.role && answers.method && answers.outside ? (answers as QuizAnswers) : null;
  const seeds = complete ? suggestBuilds(complete, { classes, races, backgrounds, recommended }) : [];

  return (
    <div data-quick-quiz="" className="reveal flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => (page > 0 ? setPage(page - 1) : onCancel())}
          aria-label={page > 0 ? t("Back to the last question") : t("Back to building")}
          className="-m-2 p-2 text-stone-500 hover:text-stone-300"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <h2 className="font-display text-lg tracking-wide text-amber-50">
          {done ? (voice === "party" ? t("A companion for your party") : t("Your character")) : t("Help me build")}
        </h2>
        {!done ? (
          <span className="ml-auto text-xs text-stone-500">
            {t("Question {page} of {total}", { page: page + 1, total })}
          </span>
        ) : null}
      </div>

      {!done && question ? (
        <fieldset key={question.key} className="reveal space-y-2">
          <legend className="mb-2 text-sm text-stone-200">{question.title}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {question.options.map((option) => {
              const picked = answers[question.key] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => answer(question.key, option.id)}
                  className={cn(
                    "motion-press rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                    picked ? "border-amber-400/60 bg-amber-400/10 text-amber-50" : "border-stone-800 bg-stone-950/50 text-stone-200 hover:border-amber-500/40",
                  )}
                >
                  {optionWords(question.key, option.id, t).label}
                  {optionWords(question.key, option.id, t).tag ? (
                    <strong className="font-semibold"> ({optionWords(question.key, option.id, t).tag})</strong>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {done ? (
        <div className="space-y-3">
          {seeds.length ? (
            <>
              <p className="text-xs text-stone-400">
                {t("Pick one to start from. Everything else is filled in for you, and you can change any part before you save.")}
              </p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {seeds.map((seed, index) => (
                  <li key={seed.classId}>
                    <SeedCard
                      seed={seed}
                      title={index === 0 ? t("Suggested", { context: "builder.quiz.suggested" }) : t("Second choice")}
                      klass={classes.find((entry) => entry.id === seed.classId)}
                      race={races.find((entry) => entry.id === seed.raceId)}
                      background={backgrounds.find((entry) => entry.id === seed.backgroundId)}
                      onChoose={() => complete && onChoose(seed, complete)}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-stone-400">{t("Nothing this table offers fits those answers. Every class is still in the builder.")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAnswers({});
                setPage(0);
              }}
              className={ui.btnSmall}
            >
              {t("Answer again")}
            </button>
            <button type="button" onClick={onCancel} className={cn(ui.btnSmall, "text-stone-400")}>
              {t("Choose everything myself")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SeedCard({
  seed,
  title,
  klass,
  race,
  background,
  onChoose,
}: {
  seed: BuildSeed;
  title: string;
  klass: ClassOption | undefined;
  race: RaceOption | undefined;
  background: BackgroundOption | undefined;
  onChoose: () => void;
}) {
  if (!klass) {
    return null;
  }
  const reading = classRoles(klass);
  const [first, second] = abilityPriority(klass);
  const name = [race?.name, klass.name].filter(Boolean).join(" ");
  const t = useT();
  return (
    <div className="panel flex h-full flex-col gap-2 rounded-xl p-3" data-quick-seed={seed.classId}>
      <p className="eyebrow text-[0.875rem] text-amber-400/80">{title}</p>
      <div className="flex items-center gap-2">
        <GameIcon icon={{ kind: "family", key: `class-${klass.id}` }} size="size-9" className="shrink-0" />
        <div className="min-w-0">
          <p className="font-display text-base tracking-wide text-amber-50">{name}</p>
          <p className="text-sm text-stone-500">
            {t("{roles} · plays like {like}", {
              roles: reading.roles.map((role) => ({ "tank": t("Tank"), "dps": t("DPS"), "healer": t("Healer"), "support": t("Support"), "control": t("Control"), "utility": t("Utility") } as Record<string, string>)[textKey(role)] ?? role).join(" / "),
              like: reading.playsLike,
            })}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-stone-500">{t("Race")}</dt>
        <dd className="text-stone-200">{race?.name ?? seed.raceId}</dd>
        <dt className="text-stone-500">{t("Background", { context: "builder.quiz.background" })}</dt>
        <dd className="text-stone-200">{background?.name ?? seed.backgroundId}</dd>
        <dt className="text-stone-500">{t("Best at")}</dt>
        <dd className="text-stone-200">
          {abilityWord(first, t)}, {t("then {ability}", { ability: abilityWord(second, t) })}
        </dd>
      </dl>
      <button type="button" onClick={onChoose} className={cn(ui.btnPrimary, "mt-auto")} aria-label={t("Build the {name}", { name })}>
        {t("Build this one")}
      </button>
    </div>
  );
}

// An ability key as its name in the reader's language (sheet.ability.*).
function abilityWord(ability: string, t: (key: string) => string): string {
  const key = ({
    str: "Strength",
    dex: "Dexterity",
    con: "Constitution",
    int: "Intelligence",
    wis: "Wisdom",
    cha: "Charisma",
  } as Record<string, string>)[ability];
  return key ? t(key) : ability;
}

// The quiz's option words, in the reader's language, by question and id.
function optionWords(
  key: keyof QuizAnswers,
  id: string,
  t: (key: string, vars?: Record<string, string | number> & { context?: string }) => string,
): { label: string; tag?: string } {
  if (key === "role") {
    const style = id as PlaystyleId;
    return { label: ({ "tank": t("Hold the line, take the hits"), "dps": t("Deal the damage"), "healer": t("Keep everyone alive"), "support": t("Help the team, control the battlefield"), "utility": t("Scout, sneak, solve problems") } as Record<string, string>)[style] ?? String(style), tag: ({ "tank": t("Tank"), "dps": t("DPS"), "healer": t("Healer"), "support": t("Support / Control"), "utility": t("Utility") } as Record<string, string>)[style] ?? String(style) };
  }
  if (key === "method") {
    return { label: ({ "weapons": t("Weapons", { context: "builder.quiz.method.weapons" }), "magic": t("Magic", { context: "builder.quiz.method.magic" }), "mix": t("A mix") } as Record<string, string>)[id] ?? String(id) };
  }
  if (key === "source") {
    return { label: ({ "study": t("Study"), "faith": t("Faith"), "nature": t("Nature"), "born": t("Born with it"), "bargain": t("A bargain"), "music": t("Music and charm") } as Record<string, string>)[id] ?? String(id) };
  }
  return { label: ({ "talk": t("Talks their way through"), "explore": t("Explores and tracks"), "lore": t("Knows the lore"), "door": t("Kicks the door in") } as Record<string, string>)[id] ?? String(id) };
}
