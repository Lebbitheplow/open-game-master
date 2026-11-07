"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { ContentPick } from "@/components/ui/ContentPick";
import { CheckField, SelectField } from "@/app/workshop/homebrew/fields";
import { num, sub } from "@/app/workshop/homebrew/MechGroup";
import { rowIcon } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";
import { textKey } from "@/lib/language/text-logic";
import {
  DEFAULT_SPECIES_SPELL_ABILITY,
  SPECIES_SPELL_ABILITIES,
  SPECIES_SPELL_LIMITS,
  speciesSpellAbilityWord,
  speciesSpellUsesWords,
  type SpeciesSpellAbility,
  type SpeciesSpellRest,
} from "@/lib/content/species-spells";

// The spells a workshop species gives, or one option of its player's
// choice (issue #833): a Topaz ancestry's Mage Hand at 1st level, Detect
// Thoughts at 3rd and Misty Step at 5th. Each spell is picked from the
// catalog (the published spells and the author's own), with the character
// level it arrives at; a spell of 1st level or higher also with how often
// it is cast without a slot and whether spell slots cast it too. One
// spellcasting ability answers for the group, as an SRD trait names one.
// The defaults are the SRD's racial spells': from 1st level, once a long
// rest, no slots, Charisma.

const L = SPECIES_SPELL_LIMITS;

// How often a levelled spell is cast without a slot, as one pick: "once a
// long rest", "2 times a short rest". Its value is "<uses>-<rest>".
const USE_OPTIONS = (["long", "short"] as const).flatMap((rest) =>
  Array.from({ length: L.uses }, (_, at) => ({ value: `${at + 1}-${rest}`, label: speciesSpellUsesWords({ uses: at + 1, rest }) })),
);

const SRD_SPELLS = { srd: "1" };

const ABILITY_OPTIONS = SPECIES_SPELL_ABILITIES.map((ability) => ({ value: ability, label: speciesSpellAbilityWord(ability) }));

// A row as the draft holds it; a level the catalog gave is kept with it, so
// a cantrip shows no uses before the save names it.
function SpellRow({ row, put, remove }: { row: Data; put: (next: Data) => void; remove: () => void }) {
  const name = String(row.spell ?? "");
  const circle = typeof row.circle === "number" ? row.circle : null;
  const cantrip = circle === 0;
  const uses = Math.max(1, num(row.uses, 1));
  const rest: SpeciesSpellRest = row.rest === "short" ? "short" : "long";
  const field = (key: string, value: unknown) => {
    const next: Data = { ...row, [key]: value };
    if (value === undefined) delete next[key];
    put(next);
  };
  return (
    <li className="live-in flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-stone-800/70 pt-1.5 first:border-t-0 first:pt-0" data-species-spell={name}>
      <span className="min-w-32 text-xs text-stone-200">
        {name}
        <span className="ml-1.5 text-[11px] text-stone-500">{cantrip ? "cantrip, at will" : circle ? `level ${circle} spell` : "spell"}</span>
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-stone-400">
        From character level
        <NumberStepper size="sm" label={`Character level ${name} arrives at`} value={num(row.level, 1)} min={1} max={20} onChange={(level) => field("level", level)} />
      </span>
      {cantrip ? null : (
        <>
          <span className="w-48">
            <Select<string>
              label={`How often ${name} is cast without a spell slot`}
              value={`${uses}-${rest}`}
              options={USE_OPTIONS}
              onChange={(value) => {
                const [count, back] = value.split("-");
                put({ ...row, uses: Number(count), rest: back });
              }}
            />
          </span>
          <CheckField label="Spell slots cast it too" checked={row.slots === true} onChange={(on) => field("slots", on || undefined)} />
        </>
      )}
      <button type="button" aria-label={`Remove ${name}`} onClick={remove} className={cn(ui.iconAction, rowIcon, "ml-auto hover:text-red-300")}>
        <X className="size-3.5" />
      </button>
    </li>
  );
}

export function SpeciesSpellFields({
  value,
  put,
  title,
  hint,
  pickLabel,
}: {
  value: unknown;
  put: (next: Data | undefined) => void;
  title: string;
  hint: string;
  // The search box's name for a screen reader: "Find a spell Topaz gives".
  pickLabel: string;
}) {
  const group = sub(value);
  const rows = Array.isArray(group.spells) ? (group.spells as Data[]) : [];
  const ability = (SPECIES_SPELL_ABILITIES as readonly unknown[]).includes(group.ability) ? (group.ability as SpeciesSpellAbility) : DEFAULT_SPECIES_SPELL_ABILITY;
  // A group with no spell left is no group: the species holds none.
  const write = (next: Data[], nextAbility: SpeciesSpellAbility = ability) => put(next.length ? { ability: nextAbility, spells: next } : undefined);
  return (
    <div className="col-span-2 space-y-1.5 sm:col-span-4" data-species-spells>
      <span className="text-[11px] text-stone-400">{title}</span>
      <p className="text-[11px] text-stone-500">{hint}</p>
      {rows.length ? (
        <ul className="space-y-1.5" aria-label={title}>
          {rows.map((row, index) => (
            <SpellRow
              key={`${String(row.spell ?? "")}-${index}`}
              row={row}
              put={(next) => write(rows.map((entry, at) => (at === index ? next : entry)))}
              remove={() => write(rows.filter((_, at) => at !== index))}
            />
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        {rows.length < L.spells ? (
          <ContentPick
            kind="spells"
            label={pickLabel}
            placeholder="Add a spell..."
            className="min-w-48 flex-1"
            // The SRD's spells answer on a server with no content pack too.
            extraParams={SRD_SPELLS}
            onPick={(entry) => {
              if (rows.some((row) => textKey(String(row.spell ?? "")) === textKey(entry.name))) return;
              write([...rows, { spell: entry.name, level: 1, ...(typeof entry.level === "number" ? { circle: entry.level } : {}) }]);
            }}
          />
        ) : (
          <span role="status" className="live-in text-[11px] text-stone-400">
            {L.spells} spells, the most it gives.
          </span>
        )}
        {rows.length ? (
          <SelectField<SpeciesSpellAbility>
            label="Spellcasting ability"
            value={ability}
            options={ABILITY_OPTIONS}
            onChange={(next) => write(rows, next)}
            className="w-44"
            hint="Sets their save DC and spell attack."
          />
        ) : null}
      </div>
    </div>
  );
}
