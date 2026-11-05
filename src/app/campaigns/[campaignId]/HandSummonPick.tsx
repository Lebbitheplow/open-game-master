"use client";

import { Minus, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { HandCard } from "@/lib/battlemap/hand";
import { mixLeft, summonCount, summonKind, type SummonChoices } from "@/lib/battlemap/hand-summon";

const PILL = "hand-option motion-press inline-flex min-h-8 min-w-8 items-center justify-center rounded-full border px-2.5 text-xs pointer-coarse:min-h-10 pointer-coarse:min-w-10";
// The chosen pill reads as chosen in both themes: at a fifth of amber on the
// day's parchment the picked number looked like the others.
const PILL_ON = "border-amber-400 bg-amber-500/30 font-semibold text-amber-100 shadow-[0_0_0_1px_var(--color-amber-400)]";
const PILL_OFF = "border-stone-600 text-stone-300 hover:border-amber-500/60";
const LABEL = "text-[11px] uppercase tracking-wider text-stone-500";

// A row of pills that picks one value (a number, a kind). The console's
// summon Kind uses it too (DmActionFields.tsx).
export function PillChoice<T extends string | number>({ label, values, chosen, show, onPick }: { label: string; values: T[]; chosen: T | null; show: (value: T) => string; onPick: (value: T) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={LABEL} aria-hidden="true">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label} data-pill-group>
        {values.map((value, index) => {
          const on = value === chosen;
          return (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={on}
              data-on={on ? "" : undefined}
              style={{ "--i": index } as CSSProperties}
              onClick={() => onPick(value)}
              className={cn(PILL, on ? PILL_ON : PILL_OFF)}
            >
              {show(value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// What a summoning spell brings (issue 685, src/lib/battlemap/hand-summon.ts),
// on the Hand's card and on the sheet's summoning door. Shown only for a
// spell with something to choose. The creature is a list, not a row of
// chips: Conjure Animals alone calls dozens of beasts, so it is the kit's
// select, listed under challenge ratings with each one's statistics beside
// it, a letter jumping to a name as in a native select. The number is
// offered only where the spell lets its caster choose it (Conjure Animals'
// one, two, four or eight), starting at the most, which is what the engine
// brings when nobody picks; the kind (Find Steed's celestial, fey or fiend)
// starts at the engine's own. A spell whose targets each take their own form
// (Animate Dead, Animate Objects) gives each form a stepper instead, within
// the slot's budget.
export function HandSummonPick({
  card,
  choices,
  onForm,
  onCount,
  onKind,
  onStep,
}: {
  card: Pick<HandCard, "name" | "summon" | "choice">;
  choices: SummonChoices;
  onForm?: (value: string) => void;
  onCount?: (value: number) => void;
  onKind?: (value: string) => void;
  onStep?: (form: string, delta: 1 | -1) => void;
}) {
  const summon = card.summon;
  if (!summon) return null;
  const options = card.choice?.options ?? [];
  if (summon.mix) {
    const left = mixLeft(card, choices.mix);
    return (
      <div className="hand-choice mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Each target's form for ${card.name}`}>
        <span className={LABEL}>Each target</span>
        {options.map((option, index) => {
          const now = choices.mix?.[option.value] ?? 0;
          const cost = summon.mix!.cost[option.value] ?? 1;
          return (
            <span key={option.value} style={{ "--i": index } as CSSProperties} className="hand-option inline-flex items-center gap-1 rounded-full border border-stone-600 py-0.5 pl-3 pr-1 text-xs text-stone-300">
              <span title={option.note}>{option.label}</span>
              <button type="button" aria-label={`One fewer ${option.label}`} disabled={now === 0} onClick={() => onStep?.(option.value, -1)} className={cn(PILL, PILL_OFF, "px-1.5 disabled:opacity-40")}>
                <Minus className="size-3" />
              </button>
              <span className="w-4 text-center tabular-nums text-amber-100" aria-live="polite">
                {now}
              </span>
              <button type="button" aria-label={`One more ${option.label}`} disabled={left < cost} onClick={() => onStep?.(option.value, 1)} className={cn(PILL, PILL_OFF, "px-1.5 disabled:opacity-40")}>
                <Plus className="size-3" />
              </button>
            </span>
          );
        })}
        <span className="text-xs text-stone-400">{left} left</span>
      </div>
    );
  }
  const forms = summon.forms;
  const picked = choices.form && forms[choices.form] ? choices.form : "";
  const selectOptions: SelectOption<string>[] = options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.note ? { hint: option.note } : {}),
    ...(forms[option.value]?.group ? { group: forms[option.value].group } : {}),
  }));
  const counts = picked ? forms[picked].counts : [];
  const kinds = summon.kinds ?? [];
  return (
    <div className="hand-choice mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {options.length > 1 ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={LABEL} aria-hidden="true">
            Creature
          </span>
          <Select
            value={picked}
            onChange={(value) => onForm?.(value)}
            options={selectOptions}
            label={`Creature for ${card.name}`}
            placeholder="Choose a creature"
            size="sm"
            className="max-w-[16rem]"
          />
        </div>
      ) : null}
      {kinds.length > 1 ? (
        <PillChoice
          label="Kind"
          values={kinds.map((kind) => kind.value)}
          chosen={summonKind(card, choices.kind)}
          show={(value) => kinds.find((kind) => kind.value === value)?.label ?? value}
          onPick={(value) => onKind?.(value)}
        />
      ) : null}
      {counts.length > 1 ? (
        <PillChoice label="Number" values={counts} chosen={summonCount(card, picked, choices.count)} show={String} onPick={(value) => onCount?.(value)} />
      ) : null}
    </div>
  );
}
