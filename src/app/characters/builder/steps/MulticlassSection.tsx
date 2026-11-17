"use client";

import { useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { describeSkill } from "@/lib/help";
import { SRD_SKILLS } from "@/lib/srd";
import { subclassBlurb, subclassLevelFor, subclassNamesFor } from "@/lib/srd/features";
import { MULTICLASS_CAP, describeGrant, multiclassGrantsFor } from "@/lib/srd/multiclass";
import { textKey } from "@/lib/language/text-logic";
import { useLocale, useT, useTp } from "@/lib/locale";
import { skillLabel } from "@/lib/srd";
import { hitDieChip } from "../lineage";
import { CardText } from "../CardText";
import { classSplitWords, multiclassChoices } from "../multiclassBuild";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { useRovingGroup } from "../roving";
import { useArchetypeOptions, type ClassOption } from "../useBuilderOptions";
import type { BuilderDerived, ExtraClassRow } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { Field, PickPill, StepPanel, inputClass } from "./shared";

// The classes taken after the first (backlog F9), under the class pick and
// the level: each one's levels, its subclass once its own level reaches the
// pick, the skill its multiclass grant lets the player choose, what it adds
// and a way to take it off; then "Add a second class", which lists every
// class the character could add, the ones it may first, each refusal in
// words (the level-up dialog's list, LevelUpDialog.tsx). Offered from level
// 2 at a table that allows it, and always in the library, on a host that
// keeps a split made there (SERVER_FEATURES builderMulticlass).
export function MulticlassSection({
  state,
  derived,
  klass,
  classes,
  classGroups,
  allowed,
  numbers,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  klass: ClassOption;
  classes: ClassOption[];
  // The class grid's own groups for this table (usePickerGroups): the list
  // offers the same classes in the same order, the grid's first group up
  // front and the rest (other books, other settings) folded, as the level-up
  // dialog folds them.
  classGroups: PickerGroup[];
  // The table's multiclassing setting (useTableRules); true in the library.
  // False on a host that has no builderMulticlass flag.
  allowed: boolean;
  // "Show rules and numbers" (backlog F11): the hit die joins its words.
  numbers: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const t = useT();
  const tp = useTp();
  const listId = useId();
  const { extras, classList, primaryLevel, effectiveLevel } = derived;
  const nameOf = (id: string) => classes.find((entry) => entry.id === id)?.name ?? id;
  const { choices, first } = useMemo(() => {
    const ids = [...new Set(classGroups.flatMap((group) => group.options.map((option) => option.id)).filter(Boolean))];
    const rows = ids.flatMap((id) => classes.filter((row) => row.id === id).slice(0, 1));
    const up = new Set(classGroups.length > 1 ? classGroups[0].options.map((option) => option.id) : ids);
    return {
      choices: multiclassChoices({
        rows: rows.length ? rows : classes,
        classList,
        abilities: derived.shownAbilities,
        rowOf: (id) => classes.find((entry) => entry.id === id),
        t,
      }),
      first: up,
    };
  }, [classGroups, classes, classList, derived.shownAbilities]);
  const upFront = choices.filter((choice) => first.has(choice.row.id));
  const folded = choices.filter((choice) => !first.has(choice.row.id));
  // One tab stop for the list, the arrows between its classes (F16). A
  // class that may not be added still takes focus, so its reason is read.
  const shown = othersOpen ? [...upFront, ...folded] : upFront;
  const roving = useRovingGroup({ keys: shown.map((choice) => choice.row.id) });
  // A stored split shows at a table that turns multiclassing off (it keeps
  // what it has); a new class is offered only where the table allows it.
  const canAdd = allowed && extras.length < MULTICLASS_CAP - 1 && primaryLevel >= 2;
  if (!extras.length && (!allowed || effectiveLevel < 2)) {
    return null;
  }
  // The class the button adds: a second, or (with one already) a third.
  const next = extras.length === 0 ? "second" : "third";
  return (
    <StepPanel
      anchor="multiclass"
      title={extras.length ? t("Your classes: {list}", { list: classSplitWords(classList, nameOf) }) : t("More than one class")}
      help={t("Your levels can be split between classes (multiclassing). Your {class} takes level 1 and the levels the others leave it, and decides your saving throws and starting gear. Each class added brings some of its training and its own features at its own level. A class needs a score of 13 in its main ability, and so does the class you start in; the Abilities step checks your final scores.", { class: klass.name.toLowerCase() })}
    >
      {!allowed && extras.length && !classList.every((entry) => (state.storedClassIds ?? []).includes(entry.id)) ? (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {t("This table turns multiclassing off. Remove the classes below to make the character here.")}
        </p>
      ) : null}
      <p className="mb-3 text-xs text-stone-400">
        {t("{class}: {level} {levelWord} of {total}", {
          class: klass.name,
          level: primaryLevel,
          levelWord: t("level", { context: "builder.calling.levelWord" }),
          total: effectiveLevel,
        })}
        {extras.length ? t(", and the first levels you took.") : t(".", { context: "builder.multiclass.primaryTail" })}
      </p>
      {extras.map((entry) => (
        <ExtraClassCard
          key={entry.classId}
          state={state}
          derived={derived}
          entry={entry}
          index={state.extraClasses.findIndex((held) => held.classId === entry.classId)}
          numbers={numbers}
        />
      ))}
      {canAdd ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={adding}
            aria-controls={listId}
            onClick={() => setAdding((open) => !open)}
            data-add-class=""
            className="inline-flex min-h-11 items-center rounded-lg border border-amber-500/40 px-3 text-sm text-amber-200 transition-colors hover:bg-amber-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            {adding ? t("Close the class list") : t("Add a {ordinal} class", { ordinal: ({ "second": t("second"), "third": t("third") } as Record<string, string>)[next] ?? String(next) })}
          </button>
          <div id={listId} hidden={!adding} className="mt-2">
            <p className="mb-2 text-xs text-stone-500">
              {t("It takes one level from your {class}; set the split once it is added.", { class: klass.name.toLowerCase() })}
              {derived.shownAbilities ? "" : t(" Your scores are not set yet, so each class says what it needs.")}
            </p>
            <ul
              aria-label={t("Classes you could add as your {ordinal}", { ordinal: ({ "second": t("second"), "third": t("third") } as Record<string, string>)[next] ?? String(next) })}
              className="grid gap-1.5 sm:grid-cols-2"
              onKeyDown={roving.onKeyDown}
              onFocus={roving.onFocus}
            >
              {shown.map((choice) => (
                <li key={choice.row.id}>
                  <button
                    type="button"
                    aria-disabled={!choice.ok || undefined}
                    aria-describedby={`${listId}-${choice.row.id}`}
                    tabIndex={roving.tabIndex(choice.row.id)}
                    data-roving-item={choice.row.id}
                    onClick={() => {
                      if (!choice.ok) {
                        return;
                      }
                      state.addExtraClass(choice.row.id);
                      setAdding(false);
                    }}
                    className={cn(
                      "block min-h-11 w-full rounded-lg border px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400",
                      choice.ok
                        ? "border-stone-600/60 text-stone-200 hover:border-amber-500/40 hover:bg-stone-900/70"
                        : "cursor-not-allowed border-stone-800 text-stone-500",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span>{choice.row.name}</span>
                      <span className="text-xs text-stone-500"><CardText text={hitDieChip(classes.find((entry) => entry.id === choice.row.id)?.hitDie ?? 8, numbers)} /></span>
                    </span>
                    <span id={`${listId}-${choice.row.id}`} className="block text-xs">
                      {choice.ok ? t("Adds {grant}.", { grant: choice.grants }) : choice.reason}{" "}
                      <span className="text-stone-500">{t("Needs {needs}.", { needs: choice.needs })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {folded.length ? (
              <button
                type="button"
                aria-expanded={othersOpen}
                onClick={() => setOthersOpen((open) => !open)}
                data-add-class-more=""
                className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm text-sky-300 transition-colors hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
              >
                {othersOpen ? t("Show fewer classes") : t("Show {count} more from other books and settings", { count: folded.length })}
              </button>
            ) : null}
          </div>
        </div>
      ) : allowed && extras.length < MULTICLASS_CAP - 1 && extras.length ? (
        <p className="mt-3 text-xs text-stone-500">
          {t("Your {class} has one level left, so there is no level to give a {ordinal} class.", { class: klass.name.toLowerCase(), ordinal: ({ "second": t("second"), "third": t("third") } as Record<string, string>)[next] ?? String(next) })}
        </p>
      ) : null}
    </StepPanel>
  );
}

// One class taken after the first: its levels, its subclass, its skill pick,
// what it adds, its features at its level, and a way to take it off.
function ExtraClassCard({
  state,
  derived,
  entry,
  index,
  numbers,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  entry: ExtraClassRow;
  // Its place in state.extraClasses, which the actions take.
  index: number;
  numbers: boolean;
}) {
  const t = useT();
  const tp = useTp();
  const locale = useLocale();
  const row = entry.klass;
  const name = row.name;
  const lower = name.toLowerCase();
  // As many levels as it has plus all but one of the first class's.
  const most = entry.level + Math.max(0, derived.primaryLevel - 1);
  const grant = multiclassGrantsFor(row.id);
  const pickLevel = subclassLevelFor(row.id);
  const features = derived.featuresByClass.find((held) => held.classId === row.id)?.features ?? [];
  // The skills it may teach, greyed where the character already has one
  // from elsewhere.
  const skillPool = grant.skillChoice
    ? grant.skillChoice.from.length
      ? grant.skillChoice.from
      : SRD_SKILLS.map((skill) => skill.id)
    : [];
  const elsewhere = new Set(
    derived.proficientSkills.filter((skill) => !entry.skills.some((own) => textKey(own) === textKey(skill))).map(textKey),
  );
  return (
    <section
      aria-label={tp("{name}, {level} level", "{name}, {level} levels", { count: entry.level, name, level: entry.level })}
      className="mb-3 rounded-lg border border-stone-700/70 bg-stone-950/40 p-3"
      data-extra-class={row.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="grow text-sm text-amber-100">
          {name}{" "}
          <span className="text-xs text-stone-500">
            <CardText text={hitDieChip(row.hitDie, numbers)} />
          </span>
        </h3>
        <button
          type="button"
          onClick={() => state.removeExtraClass(index)}
          aria-label={t("Remove {label}", { label: name })}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          {t("Remove", { context: "action.remove" })}
        </button>
      </div>
      <Field label={t("{name} levels", { name })} className="mt-2">
        <Select<string>
          value={String(entry.level)}
          onChange={(value) => state.changeExtraLevel(index, Number(value))}
          label={t("{name} levels", { name })}
          className="w-full"
          options={Array.from({ length: Math.max(1, most) }, (_, at) => ({ value: String(at + 1), label: String(at + 1) }))}
        />
      </Field>
      <p className="mt-2 text-xs text-stone-400">{t("Adds {grant}. No saving throws: those are your first class's.", { grant: describeGrant(grant) })}</p>
      {pickLevel !== null ? (
        entry.level >= pickLevel ? (
          <ExtraSubclassField state={state} entry={entry} index={index} />
        ) : (
          <p className="mt-2 text-xs text-stone-500">
            {t("A {class} chooses a subclass at its level {level}; at {current} there is nothing to pick yet.", { class: lower, level: pickLevel, current: entry.level })}
          </p>
        )
      ) : null}
      {grant.skillChoice ? (
        <Field label={t("Skill from your {class} levels (pick {count})", { class: lower, count: grant.skillChoice.count })} className="mt-3">
          <div className="flex flex-wrap gap-2">
            {skillPool.map((skillId) => {
              const skill = SRD_SKILLS.find((candidate) => candidate.id === skillId);
              const selected = entry.skills.some((own) => textKey(own) === textKey(skillId));
              const taken = elsewhere.has(textKey(skillId));
              return (
                <PickPill
                  key={skillId}
                  label={skill?.name ?? skillId}
                  selected={selected}
                  disabled={taken}
                  info={{ text: taken ? t("{name} is already yours from elsewhere.", { name: skillLabel(skillId, locale) }) : describeSkill(t, skillId, locale) }}
                  onClick={() => {
                    const count = grant.skillChoice?.count ?? 1;
                    const next = selected
                      ? entry.skills.filter((own) => textKey(own) !== textKey(skillId))
                      : count === 1
                        ? [skillId]
                        : entry.skills.length < count
                          ? [...entry.skills, skillId]
                          : entry.skills;
                    state.changeExtraSkills(index, next);
                  }}
                >
                  {skill?.name ?? skillId}
                  {taken ? t(" (yours)") : ""}
                </PickPill>
              );
            })}
          </div>
        </Field>
      ) : null}
      {features.length ? (
        <p className="mt-3 text-xs text-stone-400">
          {t("At {class} level {level}: {list}.", { class: lower, level: entry.level, list: features.map((feature) => feature.name).join(", ") })}
        </p>
      ) : null}
    </section>
  );
}

// The subclass of a class taken after the first: the bundled tables first,
// then the workshop's and the content pack's, as the first class's picker
// offers them (usePickerGroups.ts).
function ExtraSubclassField({ state, entry, index }: { state: BuilderState; entry: ExtraClassRow; index: number }) {
  const t = useT();
  const tp = useTp();
  const { archetypes } = useArchetypeOptions(entry.klass.id);
  const groups = useMemo<PickerGroup[]>(() => {
    const builtIn = subclassNamesFor(entry.klass.id);
    const known = new Set(builtIn.map(textKey));
    const others = archetypes.filter((archetype) => !known.has(textKey(archetype.name)));
    return [
      { label: null, options: [{ id: "", name: t("None yet") }] },
      ...(builtIn.length
        ? [
            {
              label: t("Full features"),
              options: builtIn.map((subclassName) => ({
                id: subclassName,
                name: subclassName,
                infoText: subclassBlurb(entry.klass.id, subclassName) || undefined,
              })),
            },
          ]
        : []),
      ...(others.length
        ? [{ label: t("More subclasses"), options: others.map((archetype) => ({ id: archetype.name, name: archetype.name, infoText: archetype.desc })) }]
        : []),
    ];
  }, [entry.klass.id, archetypes, t]);
  const blurb = entry.subclass ? subclassBlurb(entry.klass.id, entry.subclass) : "";
  return (
    <Field label={t("{class} subclass", { class: entry.klass.name })} className="mt-3">
      <OptionPicker
        value={entry.subclass}
        groups={groups}
        placeholder={t("None yet")}
        className={inputClass}
        onChange={(name) => state.changeExtraSubclass(index, name)}
      />
      {entry.subclass ? (
        <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
          <span className="grow">{blurb || t("A specialization within the class.")}</span>
          {blurb ? <InfoButton label={entry.subclass} text={blurb} /> : null}
        </span>
      ) : (
        <span className="mt-1 block text-xs text-amber-300">{t("Still to choose.")}</span>
      )}
    </Field>
  );
}
