"use client";

import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { HandAim } from "@/lib/battlemap/hand-play";
import type { MonsterAdvantage } from "@/lib/battlemap/monster-hand";
import type { ResultLine } from "@/lib/dm/catalog-result";

// The monsters' hand's aim bar and result (MonsterHand.tsx): what a raised
// card asks of the GM (its targets, the square a move or a jump goes to, the
// spell it casts, how an attack is rolled) and what the engine said when it
// was played. Split from MonsterHand.tsx, which holds the state.

const COLLAPSED_KEY = "odm:monster-hand-collapsed";
const STORE_EVENT = "odm-monster-hand-store";

export function subscribeStore(callback: () => void) {
  window.addEventListener(STORE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(STORE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsed(on: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, on ? "1" : "0");
  } catch {
    // Storage can be denied; the choice then lasts as long as the page.
  }
  window.dispatchEvent(new Event(STORE_EVENT));
}

// row: an enemy's row, not a sheet (an attack or an area reaches it).
export type PartyChip = HandAim & { note: string; row?: boolean };

const ADVANTAGE: Array<[MonsterAdvantage, string]> = [
  ["none", "Straight"],
  ["advantage", "Advantage"],
  ["disadvantage", "Disadvantage"],
];

// What the raised card asks: each part only when the card needs it (chips
// null for a card with no target, square null without a move or a jump,
// spells null without a spell, advantage null for a card that rolls no
// attack).
export function MonsterAimControls({
  chips,
  targetIds,
  onToggle,
  square,
  column,
  row,
  onColumn,
  onRow,
  spells,
  spell,
  onSpell,
  advantage,
  onAdvantage,
}: {
  chips: PartyChip[] | null;
  targetIds: string[];
  onToggle: (id: string) => void;
  square: { feet: number; optional?: boolean } | null;
  column: string;
  row: string;
  onColumn: (value: string) => void;
  onRow: (value: string) => void;
  spells: string[] | null;
  spell: string;
  onSpell: (value: string) => void;
  advantage: MonsterAdvantage | null;
  onAdvantage: (value: MonsterAdvantage) => void;
}) {
  return (
    <>
      {chips ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Targets">
          {chips.length ? (
            chips.map((chip, index) => (
              <button
                key={chip.id}
                type="button"
                style={{ "--i": index } as CSSProperties}
                aria-pressed={targetIds.includes(chip.id)}
                onClick={() => onToggle(chip.id)}
                className={cn(ui.btnSmall, "hand-target min-h-11 flex-col items-start gap-0 px-3 py-1 text-left sm:min-h-9")}
              >
                <span className="text-[13px] leading-tight text-stone-200">{chip.name}</span>
                <span className="font-mono text-[10px] leading-tight text-stone-500">{chip.note}</span>
              </button>
            ))
          ) : (
            <span className="text-xs text-stone-500">Nobody is standing to be attacked.</span>
          )}
        </div>
      ) : null}

      {square ? (
        <div className="mt-2 flex flex-wrap items-end gap-2" role="group" aria-label="Where it goes">
          <label className="flex flex-col text-[11px] uppercase tracking-wider text-stone-500">
            To column
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={column}
              onChange={(event) => onColumn(event.target.value)}
              className={cn(ui.input, "mt-0.5 h-11 w-24 text-sm normal-case tracking-normal sm:h-9")}
            />
          </label>
          <label className="flex flex-col text-[11px] uppercase tracking-wider text-stone-500">
            To row
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={row}
              onChange={(event) => onRow(event.target.value)}
              className={cn(ui.input, "mt-0.5 h-11 w-24 text-sm normal-case tracking-normal sm:h-9")}
            />
          </label>
          <span className="pb-2 text-xs text-stone-400">
            {square.optional ? `Optional: up to ${square.feet} ft, or leave it where it is.` : `Up to ${square.feet} ft.`}
          </span>
        </div>
      ) : null}

      {spells ? (
        <label className="mt-2 flex flex-col text-[11px] uppercase tracking-wider text-stone-500">
          Spell
          <select
            value={spell}
            onChange={(event) => onSpell(event.target.value)}
            className={cn(ui.input, "mt-0.5 h-11 text-sm normal-case tracking-normal sm:h-9")}
          >
            <option value="">Pick one from its list</option>
            {spells.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {advantage !== null ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-pill-group="">
          <span className="text-[11px] uppercase tracking-wider text-stone-500">Roll</span>
          {ADVANTAGE.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-on={advantage === value ? "" : undefined}
              aria-pressed={advantage === value}
              onClick={() => onAdvantage(value)}
              className={cn(
                "hand-option inline-flex min-h-9 items-center rounded-full border px-3 text-xs sm:min-h-8",
                advantage === value
                  ? "border-ember-400/70 bg-ember-500/20 text-orange-100"
                  : "border-stone-600 text-stone-300 hover:border-amber-500/60",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

// What the engine said when the card was played.
export function MonsterResultLines({ name, lines, onDismiss }: { name: string; lines: ResultLine[]; onDismiss: () => void }) {
  return (
    <div role="status" className="live-in mt-1 rounded-lg border border-amber-500/30 bg-stone-950/80 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="gold-title font-display text-[11px] uppercase tracking-[0.14em]">{name}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the result"
          className="motion-press flex size-7 items-center justify-center rounded-md text-stone-500 hover:text-amber-200"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="stagger mt-1 space-y-0.5">
        {lines.map((line, index) => (
          <li
            key={`${index}-${line.text}`}
            className={cn(line.tone === "bad" ? "text-ember-300" : line.tone === "good" ? "text-emerald-300" : "text-stone-200")}
          >
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
