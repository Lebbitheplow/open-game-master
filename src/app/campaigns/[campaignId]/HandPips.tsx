"use client";

import { useT, useTp } from "@/lib/locale";
import type { TurnPip } from "@/lib/battlemap/hand-table";
import { costShort } from "@/app/campaigns/[campaignId]/HandCardFace";

// The Hand's turn pips, the engine's count (src/lib/battlemap/hand-table.ts
// turnPips), and the Flurry of Blows strikes bought and not yet made (the
// engine's flurryStrikes), played with the Unarmed strike card. Split from
// Hand.tsx.
//
// Each pip wears its cost's colour and shape, the same as the cost tag and
// the corner notch of every card it would pay for (issue 529, hand.css).
export function HandPips({
  pips,
  flurryStrikes,
}: {
  pips: TurnPip[];
  flurryStrikes?: number;
}) {
  const t = useT();
  const tp = useTp();
  return (
    <>
      {pips.map((pip) => (
        <span
          key={pip.label}
          data-cost={pip.cost}
          data-used={pip.used ? "true" : undefined}
          // The strike through a spent pip is drawn by hand-motion.css, which eases it in.
          className="hand-pip rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider"
          aria-label={t(pip.used ? "{label} spent" : "{label} available", { label: costShort(t, pip.cost) })}
        >
          {/* The engine's pip labels are data ("Reaction"); the reader's word
              comes from the cost keys, the same one the card corner wears. */}
          {costShort(t, pip.cost)}
        </span>
      ))}
      {flurryStrikes ? (
        <span
          key={`flurry-${flurryStrikes}`}
          className="hand-pip motion-pop rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-200"
          aria-label={tp("{count} Flurry of Blows strike left", "{count} Flurry of Blows strikes left", { count: flurryStrikes })}
        >
          {t("Flurry {count}", { count: flurryStrikes })}
        </span>
      ) : null}
    </>
  );
}
