"use client";

import { useEffect, useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckFrame } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { foretoldLeft } from "@/lib/dm/foretold-logic";

// A finger-sized target (40px, the kit's own) with a ring for the keyboard.
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";
const NUMBER = `motion-press inline-flex min-h-10 items-center justify-center rounded-full border border-amber-400/60 px-3 py-1 text-xs font-semibold disabled:opacity-50 ${RING}`;
const PLAIN = `motion-press inline-flex min-h-10 items-center px-1 text-xs font-medium underline decoration-dotted underline-offset-2 disabled:opacity-50 ${RING}`;

// The stop before a watched roll (src/lib/dm/foresight.ts): the watcher may put
// a foretold number on it, or set a Chronal Shift to roll it again if it goes
// the wrong way, picking whose roll first when an area holds several; and
// everyone else sees why the table has paused.
export function WatchCard({
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
  const deadline = pending.watch ? new Date(pending.watch.deadline).getTime() : 0;
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const timer = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const watcher = sheets.find((sheet) => sheet.id === pending.characterId);
  const power = pending.watch?.power ?? "portent";
  const feature = power === "portent" ? "Portent" : "Chronal Shift";
  const choices = pending.watch?.choices ?? [];
  // Whose roll, when there is more than one to answer (an area's saves).
  const [picked, setPicked] = useState<number | null>(null);
  const asking = choices.length > 1;
  const pick = asking ? picked : 0;

  async function answer(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}/watch`, {
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
          {pending.reason} {watcher?.name ?? "A wizard"} is deciding whether to use {feature}.
        </span>
        {steersStory || left === 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer({ pass: true })}
            className={`${PLAIN} shrink-0`}
          >
            Go ahead
          </button>
        ) : null}
        {error ? <span role="alert" className="text-red-400">{error}</span> : null}
      </CheckFrame>
    );
  }

  const numbers = watcher ? [...new Set(foretoldLeft(watcher))] : [];
  const choice = asking && pick !== null ? { choice: pick } : {};
  const when = choices[pick ?? 0]?.when ?? "";
  return (
    <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
      <p className="text-sm">{pending.reason}</p>
      {asking ? (
        <div role="radiogroup" aria-label="Whose roll it answers" className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs">Whose roll:</span>
          {choices.map((entry, index) => (
            <button
              key={`${entry.name}:${index}`}
              type="button"
              role="radio"
              aria-checked={picked === index}
              disabled={busy}
              onClick={() => setPicked(index)}
              className={`${NUMBER} ${picked === index ? "bg-amber-500/25" : ""}`}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}
      <div role="group" aria-label={power === "portent" ? "Use a number Portent foretold, or let it roll" : "Use Chronal Shift on this roll, or let it roll"} className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs">{feature}:</span>
        {power === "portent"
          ? numbers.map((value) => (
              <button
                key={value}
                type="button"
                disabled={busy || pick === null}
                onClick={() => void answer({ value, ...choice })}
                title={`Use the foretold ${value} as ${asking && pick !== null ? `${choices[pick].name}'s` : "this roll's"} d20. It is gone until your next long rest.`}
                className={NUMBER}
              >
                Use the {value}
              </button>
            ))
          : (
              <button
                type="button"
                disabled={busy || pick === null}
                onClick={() => void answer({ shift: true, ...choice })}
                title="Spend a use of Chronal Shift and your reaction only if the roll goes that way: it is rolled again and the new roll stands."
                className={NUMBER}
              >
                Roll it again {when}
              </button>
            )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer({ pass: true })}
          className={PLAIN}
        >
          Let it roll
        </button>
        <span className="check-dim text-xs" aria-live="off">{left}s</span>
      </div>
      {asking && picked === null ? <p className="check-dim mt-1 text-xs">Choose whose roll first.</p> : null}
      {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </CheckFrame>
  );
}

// The button: only a character who holds a number or a Chronal Shift, only in
// a fight.
export function WatchToggle({
  campaignId,
  sheet,
  encounterId,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  encounterId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const on = sheet.watchingEncounterId === encounterId;
  // A diviner watches with numbers, a chronurgist with Chronal Shift.
  const feature = foretoldLeft(sheet).length > 0 ? "Portent" : "Chronal Shift";
  const what = feature === "Portent" ? "use a foretold number" : "use Chronal Shift on it";

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/foresight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !on, characterId: sheet.id }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not change that.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={on}
        disabled={busy}
        onClick={() => void toggle()}
        title={on ? `The game stops before each roll you can see, so you can ${what}. It turns off when the fight ends.` : `Stop the game before each roll you can see, so you can ${what}. Only turn it on when it matters: every stop holds up the table.`}
        className={`motion-press inline-flex min-h-10 items-center rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${RING} ${on ? "border-amber-400 bg-amber-500/20" : "border-amber-400/60"}`}
      >
        {on ? `Watching for ${feature}` : `Watch for ${feature}`}
      </button>
      {error ? <span role="alert" className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
