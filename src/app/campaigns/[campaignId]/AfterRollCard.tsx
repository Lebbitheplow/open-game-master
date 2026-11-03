"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckFrame } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { ROLL_KIND_LABELS } from "@/lib/roll-labels";

const STEP_IN_AFTER_MS = 3 * 60 * 1000;

const OPTION = "motion-press inline-flex min-h-9 items-center rounded-full border border-amber-300/60 px-3 py-1 text-xs font-semibold disabled:opacity-50";

// The dice have landed and the game has not yet said what they did: the roller
// may spend something on them (src/lib/dm/after-roll-logic.ts). Everyone else
// sees who the table is waiting on, and whoever runs the story can keep the
// dice for a player who has stepped away.
export function AfterRollCard({
  campaignId,
  pending,
  sheets,
  meUserId,
  steersStory,
}: {
  campaignId: string;
  pending: PendingRoll;
  sheets: CharacterSheet[];
  meUserId: string;
  steersStory: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A card already open when the wait runs long has to notice by itself: the
  // table is stalled on it, and nothing else redraws it.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const left = new Date(pending.createdAt).getTime() + STEP_IN_AFTER_MS - Date.now();
    const timer = setTimeout(() => setStale(true), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [pending.createdAt]);
  const thrown = pending.thrown;
  if (!thrown) {
    return null;
  }
  const character = sheets.find((sheet) => sheet.id === pending.characterId);
  const lead = thrown.outcome.terms[0];
  const d20s = lead?.kind === "dice" ? lead.dice : [];
  // The rest of the roll, for a die the player is choosing.
  const others = thrown.outcome.total - (lead?.kind === "dice" ? lead.subtotal : 0);

  async function choose(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}/after-roll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not send your choice.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (pending.userId !== meUserId) {
    return (
      <CheckFrame className="mb-2 flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="min-w-0">
          {character?.name ?? "A player"} rolled {thrown.outcome.total} and is deciding what to do with it.
        </span>
        {steersStory && stale ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose({ keep: true })}
            className="motion-press shrink-0 font-medium underline decoration-dotted underline-offset-2 disabled:opacity-50"
          >
            Keep the roll for them
          </button>
        ) : null}
      </CheckFrame>
    );
  }

  return (
    <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="check-well px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em]">
          {ROLL_KIND_LABELS[pending.kind] ?? "Roll"}
        </span>
        {pending.dc !== null ? (
          <span className="check-well check-dim px-2 py-0.5 font-mono text-[11px]">Difficulty Class: {pending.dc}</span>
        ) : null}
      </div>
      <p className="mt-1 text-sm">
        {character?.name ?? "You"} rolled <strong>{thrown.outcome.total}</strong>
        {thrown.outcome.natural !== undefined ? ` (the die shows ${thrown.outcome.natural})` : ""}.{" "}
        {thrown.choosing ? "Choose which die counts." : "Before the game says what happens, you can still change it."}
      </p>
      {pending.reason ? <p className="check-dim mt-0.5 text-xs">{pending.reason}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {thrown.choosing
          ? d20s.map((die, index) => (
              <button
                key={index}
                type="button"
                disabled={busy}
                onClick={() => void choose({ die: index })}
                title={`Use this die: a total of ${die.value + others}.`}
                className={OPTION}
              >
                {die.value}
              </button>
            ))
          : thrown.options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                onClick={() => void choose({ use: option.id })}
                title={option.note}
                className={OPTION}
              >
                {option.label}
              </button>
            ))}
        {thrown.choosing ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose({ keep: true })}
            className="check-dim text-xs hover:underline disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Keep this roll"}
          </button>
        )}
      </div>
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </CheckFrame>
  );
}
