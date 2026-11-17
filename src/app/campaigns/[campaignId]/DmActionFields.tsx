"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select, type SelectOption } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Switch } from "@/components/ui/Switch";
import { OptionalNumber } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import type { CatalogField } from "@/lib/dm/invoke-catalog";
import { fieldShown } from "@/lib/dm/catalog-types";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { DictateField } from "@/components/DictateField";
import { appendDictation } from "@/lib/dictation";
import { useT } from "@/lib/locale";
import { HandSummonPick, PillChoice } from "@/app/campaigns/[campaignId]/HandSummonPick";
import { mixRecord, stepMix, summonKindLabel, summonMix, summonPick } from "@/lib/battlemap/hand-summon";
import type { SummonCatalogue } from "@/lib/srd/summon-spells";
import { petFormOptions, petFormTyped, type PetFormCatalogue } from "@/lib/dm/pet-form-logic";

// The translator's shape, for the label helpers below: `t` comes in first
// (src/lib/story-window.ts).
type T = (key: string, vars?: Record<string, string | number>) => string;

// The inputs one console form is built from, one per catalog field kind
// (src/lib/dm/catalog-types.ts FieldKind). Split out of DmActionForm.tsx so
// the form stays about running an action and this file about asking for its
// arguments. Every value a picker produces is the handler's own shape, so
// nothing between here and the engine has to guess.

export type ShareRow = { enemyId?: string; characterId?: string; share: string };
export type DiceRow = { characterId: string; dice: number };
export type MixRow = { variant: string; count: number };
export type Value = string | number | boolean | string[] | ShareRow[] | DiceRow[] | MixRow[];
export type Enemy = NonNullable<PublicEncounter["enemies"]>[number];

// The Select's own marker for "type it instead"; never sent.
const OTHER = "__other";

export function initialValue(field: CatalogField): Value {
  if (field.kind === "boolean") {
    return field.default === true;
  }
  if (field.kind === "characters" || field.kind === "enemies" || field.kind === "shares" || field.kind === "hitDice" || field.kind === "summonMix") {
    return [];
  }
  return "";
}

// The shares' words by value; the keys live with the console group.
const SHARE_KEYS = {
  full: "Full",
  half: "Half",
  double: "Double",
  none: "None",
} as const;

function sharesOf(t: T): Array<{ value: string; label: string }> {
  return (Object.keys(SHARE_KEYS) as Array<keyof typeof SHARE_KEYS>).map((value) => ({ value, label: t(SHARE_KEYS[value]) }));
}

function hitDiceLeft(sheet: CharacterSheet): number {
  if (sheet.hitDicePools?.length) {
    return sheet.hitDicePools.reduce((sum, pool) => sum + Math.max(0, pool.total - pool.spent), 0);
  }
  return Math.max(0, sheet.hitDice.total - sheet.hitDice.spent);
}

function enemyLabel(enemy: Enemy): string {
  return `${enemy.name}${enemy.currentHp !== undefined ? ` (${enemy.currentHp}/${enemy.maxHp})` : ""}`;
}

// A pick from a list that may also be typed: the SRD conditions plus a
// story one, or a combatant plus a piece on the board by name.
function PickOrType({
  field,
  value,
  onChange,
  options,
  placeholder,
}: {
  field: CatalogField;
  value: string;
  onChange: (value: Value) => void;
  options: SelectOption<string>[];
  placeholder: string;
}) {
  const known = options.some((option) => option.value === value);
  const [typing, setTyping] = useState(Boolean(value) && !known);
  const other = field.other;
  const all: SelectOption<string>[] = [
    { value: "", label: placeholder },
    ...options,
    ...(other ? [{ value: OTHER, label: `${other.label}...` }] : []),
  ];

  return (
    <div className="space-y-1.5">
      <Select
        value={typing ? OTHER : value}
        onChange={(next) => {
          if (next === OTHER) {
            setTyping(true);
            onChange("");
            return;
          }
          setTyping(false);
          onChange(next);
        }}
        options={all}
        label={field.label}
        placeholder={placeholder}
      />
      {typing && other ? (
        <input
          type="text"
          value={value}
          autoFocus
          placeholder={other.placeholder}
          aria-label={other.label}
          onChange={(event) => onChange(event.target.value)}
          className={cn(ui.input, "reveal")}
        />
      ) : null}
    </div>
  );
}

function ShareRows({
  field,
  value,
  onChange,
  sheets,
  enemies,
}: {
  field: CatalogField;
  value: ShareRow[];
  onChange: (value: Value) => void;
  sheets: CharacterSheet[];
  enemies: Enemy[];
}) {
  const t = useT();
  const refOf = (row: ShareRow) => (row.enemyId ? `enemy:${row.enemyId}` : `character:${row.characterId}`);
  const taken = new Set(value.map(refOf));
  const choices: SelectOption<string>[] = [
    ...enemies.map((enemy) => ({
      value: `enemy:${enemy.id}`,
      label: enemyLabel(enemy),
      icon: { kind: "glyph" as const, key: "system-bestiary" },
      group: t("Enemies"),
    })),
    ...sheets.map((sheet) => ({
      value: `character:${sheet.id}`,
      label: sheet.name,
      icon: { kind: "glyph" as const, key: "tab-characters" },
      group: t("Characters"),
    })),
  ];
  const nameOf = (ref: string) => choices.find((choice) => choice.value === ref)?.label ?? ref;
  const add = (ref: string) => {
    if (!ref || taken.has(ref)) {
      return;
    }
    const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
    onChange([...value, kind === "enemy" ? { enemyId: id, share: "full" } : { characterId: id, share: "full" }]);
  };
  return (
    <div className="space-y-1.5" role="group" aria-label={field.label}>
      <ul className="stagger space-y-1.5">
        {value.map((row, index) => (
          <li key={refOf(row)} className="live-in flex flex-wrap items-center gap-2 rounded-lg border border-stone-700/50 bg-stone-950/40 px-2 py-1.5">
            <span className="min-w-0 grow truncate text-sm text-stone-200">{nameOf(refOf(row))}</span>
            <SegmentedControl
              size="sm"
              label={t("Share for {name}", { name: nameOf(refOf(row)) })}
              options={sharesOf(t)}
              value={row.share}
              onChange={(share) => onChange(value.map((entry, at) => (at === index ? { ...entry, share } : entry)))}
            />
            <button
              type="button"
              aria-label={t("Take {name} off", { name: nameOf(refOf(row)) })}
              onClick={() => onChange(value.filter((_, at) => at !== index))}
              className={cn(ui.btnSmall, "min-h-9 px-2")}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <Select
        value=""
        onChange={add}
        options={[
          { value: "", label: t("Add a creature") },
          ...choices.map((choice) => ({ ...choice, disabled: taken.has(choice.value) })),
        ]}
        label={t("Add to {label}", { label: field.label })}
        placeholder={t("Add a creature")}
      />
    </div>
  );
}

function HitDiceRows({
  value,
  onChange,
  sheets,
}: {
  value: DiceRow[];
  onChange: (value: Value) => void;
  sheets: CharacterSheet[];
}) {
  const t = useT();
  const diceFor = (id: string) => value.find((row) => row.characterId === id)?.dice ?? 0;
  const set = (id: string, dice: number) =>
    onChange([...value.filter((row) => row.characterId !== id), ...(dice > 0 ? [{ characterId: id, dice }] : [])]);
  return (
    <ul className="stagger space-y-1.5">
      {sheets.map((sheet) => {
        const left = hitDiceLeft(sheet);
        return (
          <li key={sheet.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-700/50 bg-stone-950/40 px-2 py-1.5">
            <span className="min-w-0 grow">
              <span className="block truncate text-sm text-stone-200">{sheet.name}</span>
              <span className="block text-[11px] text-stone-500">
                {left ? t("{left} left, {die}", { left, die: sheet.hitDice.die }) : t("No hit dice left")}
              </span>
            </span>
            <NumberStepper
              size="sm"
              value={diceFor(sheet.id)}
              min={0}
              max={Math.min(20, left)}
              disabled={left === 0}
              label={t("Hit dice for {name}", { name: sheet.name })}
              onChange={(dice) => set(sheet.id, dice)}
            />
          </li>
        );
      })}
    </ul>
  );
}

// Several chips, each a creature: pressed ones are in.
function ChipPicks({
  label,
  picked,
  choices,
  onChange,
  empty,
}: {
  label: string;
  picked: string[];
  choices: Array<{ id: string; name: string }>;
  onChange: (value: Value) => void;
  empty: string;
}) {
  return (
    <div className="stagger-pop flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {choices.map((choice) => {
        const on = picked.includes(choice.id);
        return (
          <button
            key={choice.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? picked.filter((id) => id !== choice.id) : [...picked, choice.id])}
            className={cn(
              ui.btnSmall,
              "min-h-10 px-2.5 py-1 text-xs sm:min-h-9",
              on && "border-amber-500/70 bg-amber-400/10 text-amber-100 shadow-glow-gold",
            )}
          >
            {choice.name}
          </button>
        );
      })}
      {choices.length === 0 ? <span className="text-xs text-stone-500">{empty}</span> : null}
    </div>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
  sheets,
  enemies,
  summon,
  pets,
}: {
  field: CatalogField;
  value: Value;
  onChange: (value: Value) => void;
  sheets: CharacterSheet[];
  enemies: Enemy[];
  // The engine's catalogue for the spell the form names, and the slot it is
  // cast from, for the summon fields (DmActionForm.tsx).
  summon?: { catalogue: SummonCatalogue | null; slotLevel: number };
  // Summon a pet's creatures, and the kind of pet the form holds.
  pets?: { catalogue: PetFormCatalogue | null; kind: string };
}) {
  const t = useT();
  switch (field.kind) {
    case "petForm":
      // The creatures the engine takes for this kind of pet; only a story pet
      // may be one the lists do not hold, typed behind "Not in the list".
      return (
        <PickOrType
          key={pets?.kind ?? ""}
          field={{ ...field, other: petFormTyped(pets?.kind ?? "") ? { label: t("Not in the list"), placeholder: t("clockwork crow") } : undefined }}
          value={String(value ?? "")}
          onChange={onChange}
          options={petFormOptions(pets?.kind ?? "", pets?.catalogue ?? null)}
          placeholder={pets?.kind ? t("Pick a creature") : t("Pick the kind first")}
        />
      );
    case "summonKind": {
      const kinds = summon?.catalogue?.kinds ?? [];
      return (
        <PillChoice
          label={field.label}
          values={kinds}
          chosen={kinds.includes(String(value)) ? String(value) : (kinds[0] ?? null)}
          show={(kind) => summonKindLabel(kind, t)}
          onPick={(kind) => onChange(kind)}
        />
      );
    }
    case "summonMix": {
      const pick = summon?.catalogue ? summonPick(summon.catalogue, summon.slotLevel, t) : null;
      if (!pick?.summon.mix) return null;
      // Named for the spell, as the Hand's card is: the steppers' group reads
      // "Each target's form for Animate Dead" to a screen reader, not the
      // field's own label twice over.
      const card = { name: summon?.catalogue?.spell ?? field.label, summon: pick.summon, choice: pick.choice };
      const rows = Array.isArray(value) ? (value as MixRow[]) : [];
      const picked = mixRecord(rows);
      return (
        <HandSummonPick
          card={card}
          choices={{ mix: picked }}
          onStep={(form, delta) => onChange(summonMix(card, stepMix(card, picked, form, delta)))}
        />
      );
    }
    case "character": {
      // The empty row stays in the list, as it did in the browser's own
      // select, so a picked target can be unpicked.
      const options: SelectOption<string>[] = [
        { value: "", label: t("Pick a character") },
        ...sheets.map((sheet) => ({
          value: sheet.id,
          label: sheet.name,
          icon: { kind: "glyph" as const, key: "tab-characters" },
        })),
      ];
      return <Select value={String(value ?? "")} onChange={onChange} options={options} label={field.label} placeholder={t("Pick a character")} />;
    }
    case "characters":
      return (
        <ChipPicks
          label={field.label}
          picked={Array.isArray(value) ? (value as string[]) : []}
          choices={sheets.map((sheet) => ({ id: sheet.id, name: sheet.name }))}
          onChange={onChange}
          empty={t("Nobody has a character yet.")}
        />
      );
    case "enemies":
      return (
        <ChipPicks
          label={field.label}
          picked={Array.isArray(value) ? (value as string[]) : []}
          choices={enemies.map((enemy) => ({ id: enemy.id, name: enemyLabel(enemy) }))}
          onChange={onChange}
          empty={t("No enemy is standing.")}
        />
      );
    case "enemy": {
      const options: SelectOption<string>[] = [
        { value: "", label: t("Pick an enemy") },
        ...enemies.map((enemy) => ({
          value: enemy.id,
          label: enemyLabel(enemy),
          icon: { kind: "glyph" as const, key: "system-bestiary" },
        })),
      ];
      return <Select value={String(value ?? "")} onChange={onChange} options={options} label={field.label} placeholder={t("Pick an enemy")} />;
    }
    case "combatant":
      return (
        <PickOrType
          field={field}
          value={String(value ?? "")}
          onChange={onChange}
          placeholder={t("Pick who")}
          options={[
            ...sheets.map((sheet) => ({
              value: sheet.id,
              label: sheet.name,
              icon: { kind: "glyph" as const, key: "tab-characters" },
              group: t("Characters"),
            })),
            ...enemies.map((enemy) => ({
              value: enemy.id,
              label: enemyLabel(enemy),
              icon: { kind: "glyph" as const, key: "system-bestiary" },
              group: t("Enemies"),
            })),
          ]}
        />
      );
    case "shares":
      return (
        <ShareRows
          field={field}
          value={Array.isArray(value) ? (value as ShareRow[]) : []}
          onChange={onChange}
          sheets={sheets}
          enemies={enemies}
        />
      );
    case "hitDice":
      return <HitDiceRows value={Array.isArray(value) ? (value as DiceRow[]) : []} onChange={onChange} sheets={sheets} />;
    case "select": {
      const options = (field.options ?? []).map((option) => ({ value: option.value, label: option.label }));
      if (field.other) {
        return <PickOrType field={field} value={String(value ?? "")} onChange={onChange} options={options} placeholder={t("Not set", { context: "dm.action.notSet" })} />;
      }
      return (
        <Select
          value={String(value ?? "")}
          onChange={onChange}
          options={[{ value: "", label: t("Not set", { context: "dm.action.notSet" }) }, ...options]}
          label={field.label}
          placeholder={t("Not set", { context: "dm.action.notSet" })}
        />
      );
    }
    case "boolean":
      return <Switch on={Boolean(value)} onChange={onChange} label={field.label} />;
    case "number":
      return (
        <OptionalNumber
          value={value === "" || value === undefined ? "" : Number(value)}
          min={field.min}
          max={field.max}
          onChange={onChange}
          label={field.label}
          emptyHint={t("Not set", { context: "dm.action.notSet" })}
        />
      );
    case "longtext":
      return (
        <DictateField label={field.label} onTranscript={(text) => onChange(appendDictation(String(value ?? ""), text))}>
          <textarea
            value={String(value ?? "")}
            rows={3}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            aria-label={field.label}
            onChange={(event) => onChange(event.target.value)}
            className={cn(ui.input, "resize-y")}
          />
        </DictateField>
      );
    default: {
      const input = (
        <input
          type="text"
          value={String(value ?? "")}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          aria-label={field.label}
          onChange={(event) => onChange(event.target.value)}
          className={ui.input}
        />
      );
      return field.dictate ? (
        <DictateField single label={field.label} onTranscript={(text) => onChange(appendDictation(String(value ?? ""), text))}>
          {input}
        </DictateField>
      ) : (
        input
      );
    }
  }
}

// What the form sends: the values as the handler reads them. A typed list
// becomes a list; everything else already has its shape.
export function argsFor(fields: CatalogField[], values: Record<string, Value>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    // A field the form hides (a drake's essence for an owl) sends nothing.
    if (!fieldShown(field, values)) {
      continue;
    }
    const value = values[field.name];
    if (field.kind === "list" && typeof value === "string") {
      const list = value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
      if (list.length) {
        out[field.name] = list;
      }
      continue;
    }
    out[field.name] = value;
  }
  return out;
}
