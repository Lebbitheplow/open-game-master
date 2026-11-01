"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { HandCard } from "@/lib/battlemap/hand";
import { summonCount } from "@/lib/battlemap/hand-summon";

// The creature a summoning spell's card brings, and how many (issue 685,
// src/lib/battlemap/hand-summon.ts). Shown only on a card whose spell calls
// more than one creature from its slot (Conjure Animals, Giant Insect,
// Animate Objects). The creature is a list, not a row of chips: Conjure
// Animals alone calls dozens of beasts, so it is the kit's select, listed
// under challenge ratings with each one's statistics beside it, a letter
// jumping to a name as in a native select. The number is offered only where
// the spell lets its caster choose it (Conjure Animals' one, two, four or
// eight wolves; Giant Insect's up to ten centipedes), starting at the most,
// which is what the engine brings when nobody picks.
export function HandSummonPick({
  card,
  choice,
  onChoice,
  count,
  onCount,
}: {
  card: HandCard;
  choice: string | null;
  onChoice?: (value: string) => void;
  count: number | null;
  onCount?: (value: number) => void;
}) {
  const forms = card.summon?.forms ?? {};
  const picked = choice && forms[choice] ? choice : "";
  const options: SelectOption<string>[] = (card.choice?.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.note ? { hint: option.note } : {}),
    ...(forms[option.value]?.group ? { group: forms[option.value].group } : {}),
  }));
  const counts = picked ? forms[picked].counts : [];
  const chosen = summonCount(card, picked, count ?? undefined);
  return (
    <div className="hand-choice mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-stone-500" aria-hidden="true">
          Creature
        </span>
        <Select
          value={picked}
          onChange={(value) => onChoice?.(value)}
          options={options}
          label={`Creature for ${card.name}`}
          placeholder="Choose a creature"
          size="sm"
          className="max-w-[16rem]"
        />
      </div>
      {counts.length > 1 ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-stone-500" aria-hidden="true">
            Number
          </span>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Number of creatures" data-pill-group>
            {counts.map((value, index) => {
              const on = value === chosen;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-on={on ? "" : undefined}
                  style={{ "--i": index } as CSSProperties}
                  onClick={() => onCount?.(value)}
                  className={cn(
                    "hand-option motion-press inline-flex min-h-8 min-w-8 items-center justify-center rounded-full border px-2.5 text-xs pointer-coarse:min-h-10 pointer-coarse:min-w-10",
                    on ? "border-amber-400/70 bg-amber-500/20 text-amber-100" : "border-stone-600 text-stone-300 hover:border-amber-500/60",
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
