"use client";

import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { CloseForm } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { DmActionForm } from "@/app/campaigns/[campaignId]/DmActionForm";
import type { BondView } from "@/app/campaigns/[campaignId]/CompanionBondLine";
import type { CatalogEntry } from "@/lib/dm/invoke-catalog";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { ASK_WORDS } from "@/lib/dm/romance-held-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The romantic steps asked in a fight that is now over, on the console's
// Waiting on you (issue 640): at a table a person runs, this is where the
// GM is told the companion owes an answer. "Have them answer" opens the
// console's own Romance form with the ask filled in, since the server holds
// the character, the companion and the rung already; the GM still presses
// Run, and the engine still rolls the answer. The form stays open after the
// answer clears the ask, so the GM reads how it went.

export type HeldAsk = BondView & { heldStep: NonNullable<BondView["heldStep"]> };

export function heldAsksOf(bonds: readonly BondView[]): HeldAsk[] {
  return bonds.filter((bond): bond is HeldAsk => Boolean(bond.heldStep) && bond.status === "active");
}

export function HeldAsks({
  campaignId,
  asks,
  answering,
  onAnswer,
  entry,
  sheets,
  encounter,
}: {
  campaignId: string;
  asks: readonly HeldAsk[];
  // The ask whose form is open, kept while the answer clears it from `asks`.
  answering: HeldAsk | null;
  onAnswer: (ask: HeldAsk | null) => void;
  entry: CatalogEntry | null;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
}) {
  const shown = answering && !asks.some((ask) => ask.id === answering.id) ? [...asks, answering] : asks;
  if (!shown.length) {
    return null;
  }
  return (
    <ul className="stagger mt-1.5 space-y-1.5">
      {shown.map((ask) => (
        <li key={ask.id} className="rounded-lg border border-rose-500/25 bg-stone-950/50 px-2.5 py-2" data-held-ask={ask.subjectName}>
          <p className="font-display text-[11px] tracking-[0.12em] text-rose-200/90">Asked in the fight</p>
          <p className="text-sm text-stone-200">
            {ask.characterName} asked {ask.subjectName} {ASK_WORDS[ask.heldStep.to]}. {ask.subjectName} has not answered yet.
          </p>
          {answering?.id === ask.id && entry ? (
            <div className="reveal mt-1.5 space-y-1.5">
              <DmActionForm
                campaignId={campaignId}
                entry={entry}
                sheets={sheets}
                encounter={encounter}
                glyph="tab-bonds"
                initialArgs={{ characterId: ask.characterId, subject: ask.subjectName, to: ask.heldStep.to, initiator: "player" }}
              />
              <CloseForm onClick={() => onAnswer(null)} />
            </div>
          ) : entry ? (
            <button type="button" onClick={() => onAnswer(ask)} className={cn(ui.btnSmall, "mt-1.5 min-h-10 px-2 py-1 text-xs")}>
              <GameIcon icon={{ kind: "glyph", key: "tab-bonds" }} size="size-5" />
              Have {ask.subjectName} answer
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
