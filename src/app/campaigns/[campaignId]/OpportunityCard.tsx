"use client";

import { useEffect, useId, useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckFrame } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { askLine, waitLine } from "@/lib/dm/opportunity-ask-logic";

// A finger-sized target (40px, the kit's own) with a ring for the keyboard.
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";
const STRIKE = `motion-press inline-flex min-h-10 min-w-20 items-center justify-center rounded-full border border-amber-400/70 bg-amber-500/15 px-4 py-1 text-sm font-semibold disabled:opacity-50 ${RING}`;
const LET_GO = `motion-press inline-flex min-h-10 min-w-20 items-center justify-center rounded-full border border-stone-400/50 px-4 py-1 text-sm font-medium disabled:opacity-50 ${RING}`;
const PLAIN = `motion-press inline-flex min-h-10 items-center px-1 text-xs font-medium underline decoration-dotted underline-offset-2 disabled:opacity-50 ${RING}`;

// The ask before a character's opportunity attack (src/lib/dm/opportunity-ask.ts):
// a creature is walking out of their reach, and their player decides whether
// to spend the reaction on a swing. The walk waits on the answer. Everyone
// else sees why the table has paused; whoever runs the story may send it on,
// and so may anyone once its time is up, as the clock would: the swing is
// taken.
export function OpportunityCard({
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
  const ask = pending.carry?.ask ?? null;
  const deadline = ask?.deadline ? new Date(ask.deadline).getTime() : null;
  const [left, setLeft] = useState(() => (deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null));
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  // Not a live region (it would speak every second): the buttons name it as
  // their description, so the time left is heard at each choice.
  const clockId = useId();
  const lineId = useId();

  async function answer(strike: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}/opportunity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strike }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not send your answer.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!ask) {
    return null;
  }
  const name = sheets.find((sheet) => sheet.id === pending.characterId)?.name ?? "A player";
  const clock = left !== null ? (
    <span id={clockId} className="check-dim text-xs tabular-nums" aria-live="off">
      <span className="sr-only">If nobody answers, the attack is taken in </span>
      {left}s
    </span>
  ) : null;

  if (pending.userId !== meUserId) {
    return (
      <CheckFrame className="mb-2 flex animate-fade-up flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="min-w-0">{waitLine(ask, name)}</span>
        <span className="flex items-center gap-2">
          {clock}
          {steersStory || left === 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer(true)}
              title={`Take ${name}'s opportunity attack for them, as the clock would.`}
              className={`${PLAIN} shrink-0`}
            >
              Take it for them
            </button>
          ) : null}
        </span>
        {error ? <span role="alert" className="w-full text-red-400">{error}</span> : null}
      </CheckFrame>
    );
  }

  return (
    <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
      <p id={lineId} className="text-sm">{askLine(ask)}</p>
      <div role="group" aria-labelledby={lineId} className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          aria-describedby={left !== null ? clockId : undefined}
          onClick={() => void answer(true)}
          title={`Swing your ${ask.weapon} at ${ask.walker}. Your reaction is spent until your next turn.`}
          className={STRIKE}
        >
          Strike
        </button>
        <button
          type="button"
          disabled={busy}
          aria-describedby={left !== null ? clockId : undefined}
          onClick={() => void answer(false)}
          title="No attack, and you keep your reaction for something else."
          className={LET_GO}
        >
          Let it go
        </button>
        {clock}
      </div>
      {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </CheckFrame>
  );
}
