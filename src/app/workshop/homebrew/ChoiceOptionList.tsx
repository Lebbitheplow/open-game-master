"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { TextField } from "@/app/workshop/homebrew/fields";
import { MechGroup } from "@/app/workshop/homebrew/MechGroup";
import { addChip, rowIcon } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";
import { uniqueVariantId } from "@/lib/content/species-variants";

// The options of a "Let the player choose" section, one row each: its name
// and grants folded under a header that says what it gives, moved up and
// down, removed, and a new one added by name. A species' choice (issue #538)
// and a subclass's (issue #833) hold the same rows, so an author meets one
// control for one idea; each passes the fields its options carry.
//
// `attr` names the rows for the browser checks: data-<attr>-choice on the
// list, data-<attr>-option="<id>" on each row.
export function ChoiceOptionList({
  options,
  putOptions,
  renderFields,
  summary,
  attr,
  limits,
  placeholder,
}: {
  options: Data[];
  putOptions: (next: Data[]) => void;
  renderFields: (option: Data, put: (next: Data) => void) => ReactNode;
  summary: (option: Data) => string;
  attr: string;
  limits: { options: number; minOptions: number; name: number };
  placeholder: string;
}) {
  const [newName, setNewName] = useState("");
  // The option just added opens, ready for its grants.
  const [fresh, setFresh] = useState<string | null>(null);
  const move = (index: number, by: number) => {
    const next = [...options];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    putOptions(next);
  };
  const name = newName.trim();
  const full = options.length >= limits.options;
  const add = () => {
    if (!name || full) return;
    // The id is made once, here, and a rename keeps it.
    const id = uniqueVariantId(name, options.map((option) => String(option.id ?? "")).filter(Boolean));
    putOptions([...options, { id, name }]);
    setFresh(id);
    setNewName("");
    return id;
  };
  const rowAttr = (id: string) => ({ [`data-${attr}-option`]: id });
  return (
    <div className="space-y-2" {...{ [`data-${attr}-list`]: "" }}>
      <ul className="space-y-1.5" aria-label="Options">
        {options.map((option, index) => {
          const optionName = String(option.name ?? "").trim() || `Option ${index + 1}`;
          const key = String(option.id ?? "") || `at-${index}`;
          return (
            <li key={key} className="live-in flex items-start gap-1" {...rowAttr(String(option.id ?? ""))}>
              <div className="min-w-0 grow">
                <MechGroup title={optionName} summary={summary(option)} open={fresh === option.id}>
                  {renderFields(option, (next) => putOptions(options.map((entry, at) => (at === index ? next : entry))))}
                </MechGroup>
              </div>
              <button
                type="button"
                aria-label={`Move ${optionName} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className={cn(ui.iconAction, rowIcon, "disabled:opacity-40")}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${optionName} down`}
                disabled={index === options.length - 1}
                onClick={() => move(index, 1)}
                className={cn(ui.iconAction, rowIcon, "disabled:opacity-40")}
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${optionName}`}
                onClick={() => putOptions(options.filter((_, at) => at !== index))}
                className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}
              >
                <X className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="New option's name" value={newName} onChange={setNewName} placeholder={placeholder} maxLength={limits.name} className="min-w-48 grow sm:grow-0" />
        <button
          type="button"
          onClick={(event) => {
            if (event.detail !== 0) return void add();
            // Add turns itself off as the name clears, which drops the focus to
            // the page. A keyboard goes on to the option it just opened; a tap
            // stays put, as nothing there needs a phone's keyboard.
            const list = event.currentTarget.closest(`[data-${attr}-list]`);
            const id = flushSync(add);
            list?.querySelector<HTMLElement>(`[data-${attr}-option="${CSS.escape(id ?? "")}"] button`)?.focus();
          }}
          disabled={!name || full}
          className={cn(ui.btnSmall, addChip)}
        >
          <Plus className="size-3" /> Add option
        </button>
        <span className="pb-2 text-[11px] text-stone-400" {...{ [`data-${attr}-option-count`]: "" }}>
          {options.length} of {limits.options}
          {options.length < limits.minOptions ? `: a choice needs ${limits.minOptions}` : ""}
        </span>
      </div>
    </div>
  );
}
