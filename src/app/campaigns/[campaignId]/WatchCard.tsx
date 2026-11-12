"use client";

import { useEffect, useId, useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckFrame } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { amountWords, stopPower, WATCH_FEATURES, WATCH_HINTS, watchRow, watchWords, type WatchPower } from "@/lib/dm/after-roll-table";
import { OMEN_SIDES, OMEN_WORDS, TABLE_WATCH, watchFeatureOf } from "@/lib/dm/before-roll-logic";

// A finger-sized target (40px, the kit's own) with a ring for the keyboard.
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";
const NUMBER = `motion-press inline-flex min-h-10 items-center justify-center rounded-full border border-amber-400/60 px-3 py-1 text-xs font-semibold disabled:opacity-50 ${RING}`;
const PLAIN = `motion-press inline-flex min-h-10 items-center px-1 text-xs font-medium underline decoration-dotted underline-offset-2 disabled:opacity-50 ${RING}`;

type Power = WatchPower;
const FEATURES = WATCH_FEATURES;

// The feature a character watches with (before-roll-logic.ts).
export { watchFeatureOf };

// What watching lets the player do, on the button's hint.
const WATCH_FOR = WATCH_HINTS;

// The Intelligence modifier Flash of Genius adds, as the sheet's score gives it.
const intModifier = (sheet: CharacterSheet | undefined) => Math.floor(((sheet?.abilities?.int ?? 10) - 10) / 2);

// The stop before a watched roll (src/lib/dm/foresight.ts): the watcher may put
// a foretold number on it, set a Chronal Shift to roll it again if it goes
// the wrong way, or set Flash of Genius or Favored by the Gods to add to a
// save that fails, picking whose roll first when an area holds several; and
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
  // Not a live region (it would speak every second): the watcher's buttons
  // name it as their description, so the time left is heard at each choice.
  const clockId = useId();
  const watcher = sheets.find((sheet) => sheet.id === pending.characterId);
  const power: Power = pending.watch?.power ?? "portent";
  const feature = FEATURES[power] ?? "Portent";
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
          {pending.reason} {watcher?.name ?? "A player"} is deciding whether to use {feature}.
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
  const row = watchRow(power);
  // What the row adds, in the button's words: Flash of Genius's modifier,
  // Favored by the Gods' 2d4, the omen the druid read at their last rest.
  const omen = power === "cosmic_omen" ? (watcher?.omen ?? null) : null;
  const amount = omen
    ? `${OMEN_WORDS[omen]}: ${omen === "weal" ? "add" : "take off"} 1d${OMEN_SIDES}`
    : row?.amount?.kind === "ability" ? String(intModifier(watcher)) : row ? amountWords(row) : "";
  const choice = asking && pick !== null ? { choice: pick } : {};
  const when = choices[pick ?? 0]?.when ?? "";
  // The creature a Cloud Rune turns the hit onto, once one is picked: the
  // button named the first of them while none was, and could be read as the pick.
  const onto = pick !== null ? (choices[pick]?.name ?? null) : null;
  // The button's words and the card's, from the table (after-roll-table.ts):
  // the watch row's, or the stop power's own (a hit's "Let it land").
  const words = watchWords(power);
  const own = stopPower(power)?.words;
  const fill = (template: string, pickWord: string) => template.replace("{amount}", amount).replace("{when}", when).replace("{pick}", pickWord);
  return (
    <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
      <p className="text-sm">{pending.reason}</p>
      {asking ? (
        <div role="radiogroup" aria-label={own?.pickGroup ?? "Whose roll it answers"} className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs">{own?.pickPrompt ?? "Whose roll:"}</span>
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
      <div role="group" aria-label={own?.group ?? `Use ${feature} on this roll, or let it roll`} className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs">{feature}:</span>
        {power === "portent"
          ? numbers.map((value) => (
              <button
                key={value}
                type="button"
                disabled={busy || pick === null}
                aria-describedby={clockId}
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
                aria-describedby={clockId}
                onClick={() => void answer({ shift: true, ...choice })}
                title={fill(words.title, onto ?? "the creature you pick")}
                className={NUMBER}
              >
                {fill(words.button, onto ?? "them")}
              </button>
            )}
        <button
          type="button"
          disabled={busy}
          aria-describedby={clockId}
          onClick={() => void answer({ pass: true })}
          className={PLAIN}
        >
          {own?.pass ?? "Let it roll"}
        </button>
        <span id={clockId} className="check-dim text-xs" aria-live="off"><span className="sr-only">{own?.passing ?? "It rolls on its own in "}</span>{left}s</span>
      </div>
      {asking && picked === null ? <p className="check-dim mt-1 text-xs">{own?.pickFirst ?? "Choose whose roll first."}</p> : null}
      {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </CheckFrame>
  );
}

// The button: only a character who holds a feature the stop answers with. In
// a fight, every one of them; out of one (`encounterId` TABLE_WATCH), only a
// before-the-roll feature (Portent, Cosmic Omen, Restore Balance), and the
// stops are for an ally's check or save (foresight-before.ts).
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
  const table = encounterId === TABLE_WATCH;
  const power = watchFeatureOf(sheet, table) ?? "portent";
  const rolls = table ? "each check or save an ally makes" : "each roll you can see";
  const feature = FEATURES[power];
  const what = WATCH_FOR[power];

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
        title={on ? `The game stops before ${rolls}, so you can ${what}. ${table ? "It stays on until you turn it off." : "It turns off when the fight ends."}` : `Stop the game before ${rolls}, so you can ${what}. Only turn it on when it matters: every stop holds up the table.`}
        className={`motion-press inline-flex min-h-10 items-center rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${RING} ${on ? "border-amber-400 bg-amber-500/20" : "border-amber-400/60"}`}
      >
        {on ? `Watching for ${feature}` : `Watch for ${feature}`}
      </button>
      {error ? <span role="alert" className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
