"use client";

import { useEffect, useId, useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckFrame } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { TokenFace } from "@/app/campaigns/[campaignId]/BoardChrome";
import { askLine, smiteChoiceLine, waitLine } from "@/lib/dm/opportunity-ask-logic";

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
// taken. A paladin's card also offers Divine Smite on the swing, at the slot
// the Hand's smite card would spend, paid only if it hits.
//
// A mount walking out of reach with a rider on its back (issue 1055, ruling
// 5): "the attacker can target you or the mount". The card then has no plain
// Strike: it offers the two by face and name, and the player picks one.
export function OpportunityCard({
  campaignId,
  pending,
  sheets,
  meUserId,
  steersStory,
  smiteOffered = false,
  faceOf,
}: {
  campaignId: string;
  pending: PendingRoll;
  sheets: CharacterSheet[];
  meUserId: string;
  steersStory: boolean;
  // The host takes `smite` on the answer (capabilities.ts opportunitySmite).
  smiteOffered?: boolean;
  // An enemy's face by its id, for the two of a mounted pair.
  faceOf?: (enemyId: string) => Array<string | null | undefined>;
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

  async function answer(strike: boolean, smite = false, target?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}/opportunity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strike, ...(smite ? { smite } : {}), ...(target ? { target } : {}) }),
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
    <CheckFrame className="opportunity-ask mb-2 animate-fade-up px-3 py-2.5">
      <p id={lineId} className="text-sm">{askLine(ask)}</p>
      <div role="group" aria-labelledby={lineId} className="mt-2 flex flex-wrap items-center gap-2">
        {(ask.rider ? [ask.rider, { id: ask.walkerId, name: ask.walker }] : [{ id: "", name: ask.walker }]).map((foe) => (
          <span key={foe.id} className="contents">
            <button
              type="button"
              disabled={busy}
              aria-describedby={left !== null ? clockId : undefined}
              onClick={() => void answer(true, false, foe.id || undefined)}
              title={`Swing your ${ask.weapon} at ${foe.name}. Your reaction is spent until your next turn.`}
              className={`${STRIKE} ${foe.id ? "gap-1.5 pl-1" : ""}`}
            >
              {foe.id ? <TokenFace candidates={faceOf?.(foe.id) ?? []} name={foe.name} enemy className="size-8 rounded-full border border-amber-400/60" /> : null}
              {foe.id ? `Strike ${foe.name}` : "Strike"}
            </button>
            {smiteOffered && ask.smiteSlot ? (
              <button
                type="button"
                disabled={busy}
                aria-describedby={left !== null ? clockId : undefined}
                onClick={() => void answer(true, true, foe.id || undefined)}
                title={`Swing your ${ask.weapon} at ${foe.name} and, if it hits, spend a level ${ask.smiteSlot} spell slot on Divine Smite for extra radiant damage. A miss keeps the slot.`}
                className={STRIKE}
              >
                {smiteChoiceLine(ask.smiteSlot, foe.id ? foe.name : undefined)}
              </button>
            ) : null}
          </span>
        ))}
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
