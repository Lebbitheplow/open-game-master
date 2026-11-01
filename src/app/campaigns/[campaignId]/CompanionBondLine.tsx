"use client";

import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { FriendshipTier, RomanceStage } from "@/lib/dm/relationship-logic";
import { textKey } from "@/lib/language/text-logic";
import { ROMANCE_WORD, TIER_STYLES, TIER_WORD } from "./BondsPanel";

// Where a companion's romances stand, on its Party card (issue 640): after a
// wedding the card said nothing of it, and a player who never opened the
// Bonds tab could not tell where a romance stood. Read from the Bonds route,
// so every seat reads here exactly what its own Bonds tab reads: the rung
// and the standing's word for everyone, the number for the party lead, and
// the warmth an act shows until it is seen through.

export type BondView = {
  id: string;
  characterId: string;
  characterName: string;
  subjectName: string;
  subjectKind: "npc" | "companion";
  tier: FriendshipTier;
  tierLabel: string;
  romance: RomanceStage;
  status: "active" | "parted" | "ended";
  approval?: number;
  // A step asked in a fight now over, waiting for its answer (romance-held.ts).
  heldStep?: { to: Exclude<RomanceStage, "none"> };
};

// The table's bonds, read again whenever the stream says they changed. Empty
// while bonds or romance are off, or `wanted` is false (no companion at the
// table, no console open).
export function useRomanceBonds(campaignId: string, refreshKey: number, wanted: boolean): BondView[] {
  const [bonds, setBonds] = useState<BondView[]>([]);
  useEffect(() => {
    if (!campaignId || !wanted) {
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/relationships`);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        const usable = data.enabled !== false && data.romanceEnabled !== false && Array.isArray(data.relationships);
        if (live) {
          setBonds(usable ? data.relationships : []);
        }
      } catch {
        // Unreachable for a moment: the card shows what it last read.
      }
    })();
    return () => {
      live = false;
    };
  }, [campaignId, refreshKey, wanted]);
  return wanted ? bonds : [];
}

// One line per character this companion has a romance with: who, the
// standing's chip and the rung's, styled as the Bonds row styles them.
export function CompanionBondLine({ name, bonds }: { name: string; bonds: readonly BondView[] }) {
  const key = textKey(name);
  const romances = bonds.filter(
    (bond) => bond.subjectKind === "companion" && bond.status === "active" && bond.romance !== "none" && textKey(bond.subjectName) === key,
  );
  if (!romances.length) {
    return null;
  }
  return (
    <ul className="mt-1.5 space-y-1" data-companion-bonds={name}>
      {romances.map((bond) => (
        <li key={bond.id} className="flex flex-wrap items-center gap-1.5 text-[11px]" data-companion-bond={bond.characterName}>
          <span className="sr-only">Romance with</span>
          <span className="min-w-0 break-words text-stone-300">{bond.characterName}</span>
          <span className={cn("shrink-0 rounded-full border px-2 py-0.5", TIER_STYLES[bond.tier])} title={bond.tierLabel}>
            {TIER_WORD[bond.tier]}
            {bond.approval === undefined ? "" : ` ${bond.approval > 0 ? "+" : ""}${bond.approval}`}
          </span>
          <span
            className="flex shrink-0 items-center gap-1 rounded-full border border-rose-900/60 bg-rose-950/30 px-2 py-0.5 text-rose-200"
            title={`Romance: ${ROMANCE_WORD[bond.romance]}`}
            data-companion-stage={bond.romance}
          >
            <Heart className="size-2.5" aria-hidden />
            {ROMANCE_WORD[bond.romance]}
          </span>
        </li>
      ))}
    </ul>
  );
}
