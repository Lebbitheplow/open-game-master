"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { textKey } from "@/lib/language/text-logic";
import { parseSubclassChoicePick, subclassChoiceSummary } from "@/lib/content/subclass-choices";
import type { SubclassChoiceSlot } from "@/lib/srd/subclass-choice-picks";

// A workshop subclass's own choice in the level-up's options step (issue
// #833): a bloodline, an element. One option, its card saying what it gives,
// in the same rows as the class's pick-lists beside it.
export function SubclassChoicePick({
  slot,
  picked,
  onPick,
}: {
  slot: SubclassChoiceSlot;
  // The pick made here, as its feature name ("Bloodline (Storm)").
  picked: string | undefined;
  onPick: (name: string) => void;
}) {
  const chosen = picked ? parseSubclassChoicePick(picked)?.option : undefined;
  return (
    <div role="group" aria-label={`${slot.subclass}: ${slot.label}`}>
      <p className="mb-1 mt-2 text-xs uppercase tracking-wide text-amber-200/80">
        {slot.label}: {chosen ? 1 : 0}/1 chosen
      </p>
      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {slot.options.map((option) => {
          const on = Boolean(chosen) && textKey(chosen!) === textKey(option.name);
          const gives = subclassChoiceSummary(option);
          return (
            <div
              key={option.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                on ? "border-amber-600 bg-stone-900 text-amber-100" : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
              )}
            >
              <button type="button" aria-pressed={on} onClick={() => onPick(option.name)} className="min-h-[40px] grow text-left">
                <span className="block">{option.name}</span>
                <span className="block text-[11px] text-stone-500">
                  {option.description ? `${option.description} ` : ""}
                  {gives}
                </span>
              </button>
              <InfoButton label={option.name} meta={slot.subclass} text={[option.description, gives].filter(Boolean).join(" ")} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
