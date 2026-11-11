"use client";

// One held choice a level-up may change (src/lib/srd/level-up-changes.ts):
// Storm Aura's environment, or an invocation given up for another. Keeping
// what is held is the default; nothing is sent until a new option is picked.

import { cn } from "@/lib/cn";
import type { ChangeOffer, LevelUpChange } from "@/lib/srd/level-up-changes";

const CHIP = "min-h-10 rounded-full border px-3 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400";

function Chip({ picked, label, onClick }: { picked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onClick}
      className={cn(CHIP, picked ? "border-amber-600 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-300 hover:border-amber-800 hover:bg-stone-900")}
    >
      {label}
    </button>
  );
}

export function LevelUpChangePick({ offer, change, onChange }: { offer: ChangeOffer; change: LevelUpChange | null; onChange: (next: LevelUpChange | null) => void }) {
  const from = offer.kind === "choice" ? offer.from : change?.from ?? "";
  const shown = (name: string) => offer.shown[name] ?? name;
  return (
    <div role="group" aria-label={`Change ${offer.label}`} className="reveal mt-3">
      <p className="mb-1 text-xs uppercase tracking-wide text-amber-200/80">
        {offer.kind === "choice" ? `${offer.label}: keep ${shown(offer.from)}, or change it with this level` : `${offer.label}: keep them all, or give one up for another`}
      </p>
      {offer.kind === "replace" ? (
        <div className="stagger-pop mb-1.5 flex flex-wrap gap-1.5">
          <Chip picked={!change} label="Keep all" onClick={() => onChange(null)} />
          {offer.froms.map((name) => (
            <Chip key={name} picked={change?.from === name} label={`Give up ${shown(name)}`} onClick={() => onChange(change?.from === name ? null : { from: name, to: "" })} />
          ))}
        </div>
      ) : null}
      {offer.kind === "choice" || change ? (
        <div className="stagger-pop flex max-h-56 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {offer.kind === "choice" ? <Chip picked={!change} label={`Keep ${shown(offer.from)}`} onClick={() => onChange(null)} /> : null}
          {offer.options.map((name) => (
            <Chip key={name} picked={change?.to === name} label={shown(name)} onClick={() => onChange({ from, to: name })} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
