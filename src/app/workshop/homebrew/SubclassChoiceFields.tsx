"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ContentPick } from "@/components/ui/ContentPick";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { SelectField, TextArea, TextField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { ChipList } from "@/app/workshop/plugin/fields";
import { list } from "@/app/workshop/homebrew/MechGroup";
import { ChoiceOptionList } from "@/app/workshop/homebrew/ChoiceOptionList";
import { withField } from "@/app/workshop/homebrew/SpeciesChoiceFields";
import { addChip } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";
import { LANGUAGES } from "@/lib/workshop/pickers";
import { SKILL_IDS } from "@/lib/homebrew/item-magic-schema";
import { DAMAGE_TYPES } from "@/lib/dm/damage-logic";
import { textKey } from "@/lib/language/text-logic";
import { SUBCLASS_CHOICE_LIMITS } from "@/lib/homebrew/subclass-choice-check";
import { subclassChoiceSummary, type SubclassChoiceOption } from "@/lib/content/subclass-choices";
import { uniqueVariantId } from "@/lib/content/species-variants";

// A subclass whose player picks one of several options at a class level: a
// bloodline, an elemental affinity (issue #833). Hidden behind one button
// until the author asks for it, since most subclasses offer none. The rows
// are the species choice's (ChoiceOptionList.tsx), with what a subclass's
// option can give: the element it deals in (which Elemental Affinity, if
// the subclass borrows it, reads), resistances, skills, languages and spells
// from a class level. The save checks it whole (src/lib/homebrew/
// subclass-choice-check.ts) and refuses a label the engines would read as a
// feature of their own.

const L = SUBCLASS_CHOICE_LIMITS;
const SKILL_LABELS = Object.fromEntries(SKILL_IDS.map((id) => [id, id.replace(/_/g, " ")])) as Record<(typeof SKILL_IDS)[number], string>;

// An option as the draft holds it, read for its summary line.
function readOption(raw: Data): SubclassChoiceOption {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    ...(raw.damageType ? { damageType: String(raw.damageType) } : {}),
    resistances: list(raw.resistances),
    skills: list(raw.skills),
    languages: list(raw.languages),
    spells: (raw.spells ?? {}) as Record<string, string[]>,
  };
}

// The search a species spell row makes too (SpeciesSpellFields.tsx).
const SRD_SPELLS = { srd: "1" };

// The option's spells by the class level they arrive at, picked from the
// SRD's and the author's own (ContentPick), as the subclass's own are.
function OptionSpells({ option, put }: { option: Data; put: (spells: Record<string, string[]> | undefined) => void }) {
  const spells = (option.spells ?? {}) as Record<string, string[]>;
  const rows = Object.entries(spells).sort(([a], [b]) => Number(a) - Number(b));
  const [level, setLevel] = useState(1);
  const write = (next: Record<string, string[]>) => put(Object.keys(next).length ? next : undefined);
  const atLevel = spells[String(level)] ?? [];
  const levelsFull = rows.length >= L.spellLevels && !spells[String(level)];
  return (
    <div className="col-span-2 space-y-1 sm:col-span-4" data-subclass-option-spells>
      <span className="text-[11px] text-stone-400">Spells it always has prepared</span>
      {rows.map(([at, names]) => (
        <div key={at} className="live-in flex flex-wrap items-center gap-1.5 text-xs">
          <span className="w-20 shrink-0 text-stone-400">Level {at}</span>
          {names.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-1.5 py-0.5 text-stone-200">
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => {
                  const left = names.filter((entry) => entry !== name);
                  const next = { ...spells };
                  if (left.length) next[at] = left;
                  else delete next[at];
                  write(next);
                }}
                className="-my-2 inline-flex size-10 items-center justify-center text-stone-500 hover:text-red-300 sm:my-0 sm:size-6"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[11px] text-stone-400">
          From class level
          <NumberStepper size="sm" label="Class level the spell arrives at" min={1} max={20} value={level} onChange={setLevel} />
        </span>
        {atLevel.length < L.spellsPerLevel && !levelsFull ? (
          <ContentPick
            kind="spells"
            // With no content pack the bundled SRD's spells answer too
            // (srd=1, issue #833), so a bare server offers them here as it
            // does for the subclass's own spells just above.
            extraParams={SRD_SPELLS}
            label="Find a spell this option always has prepared"
            placeholder="Add a spell..."
            className="min-w-48 flex-1"
            onPick={(entry) => {
              if (atLevel.some((name) => textKey(name) === textKey(entry.name))) return;
              write({ ...spells, [String(level)]: [...atLevel, entry.name] });
            }}
          />
        ) : (
          <span role="status" className="live-in text-[11px] text-stone-400">
            {levelsFull ? `An option grants spells at ${L.spellLevels} levels at most.` : `Level ${level} holds ${L.spellsPerLevel}, the most a level keeps.`}
          </span>
        )}
      </div>
    </div>
  );
}

function OptionFields({ option, put }: { option: Data; put: (next: Data) => void }) {
  const field = (key: string, value: unknown) => put(withField(option, key, value));
  return (
    <>
      <TextField label="Option name" value={String(option.name ?? "")} onChange={(name) => put({ ...option, name })} maxLength={L.name} className="col-span-2" />
      <SelectField
        label="Its element"
        value={String(option.damageType ?? "")}
        options={[{ value: "", label: "none" }, ...DAMAGE_TYPES.map((type) => ({ value: type, label: type }))]}
        onChange={(damageType) => field("damageType", damageType || undefined)}
        className="col-span-2"
        hint="The damage type this option deals in. Elemental Affinity, if the subclass has it, adds to and resists this type."
      />
      <div className="col-span-2 sm:col-span-4">
        <TextArea
          label="What it says"
          value={String(option.description ?? "")}
          onChange={(description) => field("description", description)}
          maxLength={L.description}
          rows={3}
          hint="The player reads this; the table runs only the grants below."
        />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Damage it resists</span>
        <ToggleChips options={DAMAGE_TYPES} selected={list(option.resistances)} max={L.resistances} onChange={(next) => field("resistances", next)} />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Skills it is proficient in</span>
        <ToggleChips options={SKILL_IDS} labels={SKILL_LABELS} selected={list(option.skills)} max={L.skills} onChange={(next) => field("skills", next)} />
      </div>
      <div className="col-span-2 space-y-1">
        <span className="text-[11px] text-stone-400">Languages it speaks</span>
        <ChipList items={list(option.languages)} onChange={(next) => field("languages", next)} options={LANGUAGES} prompt="Add a language" max={L.languages} />
      </div>
      <OptionSpells option={option} put={(spells) => field("spells", spells)} />
    </>
  );
}

export function SubclassChoiceFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const choices = Array.isArray(data.choices) ? (data.choices as Data[]) : [];
  const putChoices = (next: Data[]) => set({ choices: next.length ? next : undefined });
  // Each choice keeps an id from when it is made: a sheet's pick holds it,
  // and the rows are keyed by it, so a removed choice takes its own row.
  const add = () =>
    putChoices([...choices, { id: uniqueVariantId("choice", choices.map((choice) => String(choice.id ?? "")).filter(Boolean)), label: "", level: 1, options: [] }]);
  if (!choices.length) {
    return (
      <div className="space-y-1.5 text-sm" data-subclass-choice>
        <SectionHead title="The player's choice" glyph="tab-characters" className="mb-1" />
        <p className="text-[11px] text-stone-400">
          For a subclass whose players each pick one of several options at a level: a bloodline, an element, a
          patron&apos;s aspect, each with its own element, resistances, training or spells.
        </p>
        <button type="button" onClick={add} className={cn(ui.btnSmall, addChip)}>
          <Plus className="size-3" /> Let the player choose (bloodline, element)
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm" data-subclass-choice>
      <SectionHead title="The player's choice" glyph="tab-characters" className="mb-1" />
      {choices.map((choice, index) => {
        const putChoice = (patch: Data) => putChoices(choices.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
        const options = Array.isArray(choice.options) ? (choice.options as Data[]) : [];
        const label = String(choice.label ?? "").trim() || `Choice ${index + 1}`;
        return (
          <div key={String(choice.id ?? "") || `at-${index}`} className="live-in space-y-2 rounded-lg border border-stone-800 p-2" role="group" aria-label={label}>
            <div className="flex flex-wrap items-end gap-2">
              <TextField
                label="What the player chooses"
                value={String(choice.label ?? "")}
                onChange={(next) => putChoice({ label: next })}
                placeholder="Bloodline, Element"
                maxLength={L.label}
                className="min-w-48 grow"
                hint="The builder asks for it under this name, and the sheet records the pick as it."
              />
              <span className="flex items-center gap-1 pb-1 text-[11px] text-stone-400">
                Chosen at class level
                <NumberStepper label={`Class level ${label} is chosen at`} min={1} max={20} value={Number(choice.level ?? 1) || 1} onChange={(level) => putChoice({ level })} />
              </span>
            </div>
            <ChoiceOptionList
              options={options}
              putOptions={(next) => putChoice({ options: next })}
              renderFields={(option, put) => <OptionFields option={option} put={put} />}
              summary={(option) => subclassChoiceSummary(readOption(option))}
              attr="subclass"
              limits={{ options: L.options, minOptions: L.minOptions, name: L.name }}
              placeholder="Storm"
            />
            <button type="button" onClick={() => putChoices(choices.filter((_, at) => at !== index))} className={cn(ui.btnSmall, addChip, "hover:text-red-300")}>
              <X className="size-3" /> Remove {label}
            </button>
          </div>
        );
      })}
      {choices.length < L.choices ? (
        <button type="button" onClick={add} className={cn(ui.btnSmall, addChip)}>
          <Plus className="size-3" /> Add another choice
        </button>
      ) : null}
    </div>
  );
}
