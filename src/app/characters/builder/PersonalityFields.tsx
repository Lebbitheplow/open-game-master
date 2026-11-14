"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import {
  PERSONA_HINTS,
  PERSONA_KEYS,
  PERSONA_LABELS,
  type PersonaKey,
  type PersonaLists,
} from "@/lib/backgrounds/persona-logic";
import { PERSONA_ENTRY_MAX, type Persona } from "@/lib/schemas/sheet";
import { ui } from "@/lib/ui";
import OptionPicker, { type PickerGroup } from "./OptionPicker";

// The two ids the picker holds that are not suggestions.
const OWN = "__own";
const NONE = "__none";

// The four personality lines (trait, ideal, bond, flaw), each a pick from
// the background's suggestions or a line of the player's own, all optional.
// Used by the builder's Identity step and by the sheet in play
// (src/app/campaigns/[campaignId]/SheetPersonality.tsx), so both ask the
// same way. A line not among the suggestions (typed, or a pack's old line)
// shows in the box it was written in.
export function PersonalityFields({
  value,
  onChange,
  suggestions,
  backgroundName,
}: {
  value: Persona;
  onChange: (next: Persona) => void;
  suggestions: { lists: PersonaLists; fromBackground: boolean };
  backgroundName?: string;
}) {
  const baseId = useId();
  // Lines the player chose to write, kept open while still blank.
  const [writing, setWriting] = useState<Partial<Record<PersonaKey, boolean>>>({});
  const set = (key: PersonaKey, text: string) => onChange({ ...value, [key]: text });

  return (
    <div className="grid grid-cols-1 gap-4">
      {PERSONA_KEYS.map((key) => {
        const list = suggestions.lists[key];
        const current = value[key] ?? "";
        const own = writing[key] || (current !== "" && !list.includes(current));
        const captionId = `${baseId}-${key}`;
        const groups: PickerGroup[] = [
          {
            label: suggestions.fromBackground && backgroundName ? `Suggested for ${backgroundName}` : "Suggestions",
            options: list.map((line) => ({ id: line, name: line })),
          },
          {
            label: null,
            options: [
              { id: OWN, name: "Write my own" },
              ...(current || own ? [{ id: NONE, name: "Leave it blank" }] : []),
            ],
          },
        ];
        return (
          <div key={key} role="group" aria-labelledby={captionId} className="min-w-0">
            <span id={captionId} className="block text-sm font-medium text-stone-200">
              {PERSONA_LABELS[key]}
            </span>
            <span className="mb-1.5 block text-xs text-stone-500">{PERSONA_HINTS[key]}</span>
            <OptionPicker
              value={own ? OWN : current}
              groups={groups}
              labelledBy={captionId}
              placeholder="Pick one, or write your own"
              className={cn(ui.input, "min-h-10")}
              onChange={(picked) => {
                if (picked === OWN) {
                  setWriting((open) => ({ ...open, [key]: true }));
                  return;
                }
                setWriting((open) => ({ ...open, [key]: false }));
                set(key, picked === NONE ? "" : picked);
              }}
            />
            {own ? (
              <input
                value={current}
                onChange={(event) => set(key, event.target.value)}
                maxLength={PERSONA_ENTRY_MAX}
                autoFocus={writing[key] && current === ""}
                placeholder={list[0] ?? ""}
                aria-label={`${PERSONA_LABELS[key]}, in your own words`}
                className={cn(ui.input, "reveal mt-2 min-h-10 w-full")}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// The four lines as the sheet shows them, read-only; nothing when none was
// given.
export function PersonaLines({ persona }: { persona?: Partial<Persona> | null }) {
  const given = PERSONA_KEYS.filter((key) => (persona?.[key] ?? "").trim());
  if (!given.length) {
    return null;
  }
  return (
    <dl className="space-y-1.5 text-sm">
      {given.map((key) => (
        <div key={key}>
          <dt className="text-xs uppercase tracking-wide text-stone-500">{PERSONA_LABELS[key]}</dt>
          <dd className="font-serif leading-relaxed text-stone-300">{persona?.[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
