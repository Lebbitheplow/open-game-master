"use client";

import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import type { OptionField, SettingField } from "@/lib/addons/manifest";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// The controls an addon's manifest asks for: its settings on the admin's
// card, a contribution's options where it runs (the importer, the map
// generator). Drawn from the field list, so an addon never ships UI for this
// and every addon's fields look like the rest of the app.

export type FieldValues = Record<string, string | number | boolean>;

// A setting (which may be required) or an option.
type Field = SettingField | OptionField;

export function fieldDefaults(fields: Field[]): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    if (field.type !== "secret") values[field.key] = field.default;
  }
  return values;
}

export function AddonFields({
  fields,
  values,
  onChange,
  secretsSet = [],
  idPrefix,
}: {
  fields: Field[];
  values: FieldValues;
  onChange: (key: string, value: string | number | boolean) => void;
  // Secrets already stored: the field says so and a blank keeps it.
  secretsSet?: string[];
  idPrefix: string;
}) {
  if (!fields.length) return null;
  return (
    <div className="stagger space-y-3">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const value = values[field.key];
        const help = field.help ? (
          <span id={`${id}-help`} className="block text-[11px] leading-4 text-stone-500">
            {field.help}
          </span>
        ) : null;
        const required = "required" in field && field.required;
        const label = (
          <>
            {field.label}
            {required ? <span className="text-amber-300/90"> (required)</span> : null}
          </>
        );
        if (field.type === "boolean") {
          return (
            <div key={field.key} className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-xs text-stone-300">
                {label}
                {help}
              </span>
              <Switch on={value === true} onChange={(next) => onChange(field.key, next)} label={field.label} />
            </div>
          );
        }
        if (field.type === "select") {
          return (
            <div key={field.key} className="space-y-1">
              <span className="block text-xs text-stone-300">{label}</span>
              <Select
                label={field.label}
                value={typeof value === "string" ? value : field.default}
                onChange={(next) => onChange(field.key, next)}
                options={field.choices.map((choice) => ({ value: choice.value, label: choice.label }))}
                size="sm"
              />
              {help}
            </div>
          );
        }
        return (
          <label key={field.key} htmlFor={id} className="block space-y-1">
            <span className="block text-xs text-stone-300">{label}</span>
            {field.type === "textarea" ? (
              <textarea
                id={id}
                value={typeof value === "string" ? value : ""}
                maxLength={field.maxLength}
                rows={3}
                onChange={(event) => onChange(field.key, event.target.value)}
                aria-describedby={field.help ? `${id}-help` : undefined}
                className={cn(ui.input, "text-xs")}
              />
            ) : (
              <input
                id={id}
                type={field.type === "number" ? "number" : field.type === "secret" ? "password" : "text"}
                aria-required={required || undefined}
                value={String(value ?? "")}
                min={field.type === "number" ? field.min : undefined}
                max={field.type === "number" ? field.max : undefined}
                step={field.type === "number" ? field.step : undefined}
                maxLength={field.type === "text" ? field.maxLength : 500}
                autoComplete={field.type === "secret" ? "new-password" : "off"}
                spellCheck={false}
                placeholder={
                  field.type === "secret"
                    ? secretsSet.includes(field.key)
                      ? "Saved. Leave blank to keep it."
                      : "Not set"
                    : field.type === "path"
                      ? "Blank looks for it on this computer"
                      : undefined
                }
                onChange={(event) =>
                  onChange(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)
                }
                aria-describedby={field.help ? `${id}-help` : undefined}
                className={cn(ui.input, "text-xs", (field.type === "path" || field.type === "secret") && "font-code")}
              />
            )}
            {help}
          </label>
        );
      })}
    </div>
  );
}
