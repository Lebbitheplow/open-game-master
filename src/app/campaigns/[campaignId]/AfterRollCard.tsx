"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckFrame } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { ROLL_KIND_LABELS } from "@/lib/roll-labels";
import { AFTER_ROLL_SECONDS } from "@/lib/dm/after-roll-logic";
import { afterRollRow } from "@/lib/dm/after-roll-table";

const STEP_IN_AFTER_MS = 3 * 60 * 1000;

// A finger-sized target (40px, the kit's own) with a ring for the keyboard.
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";
const OPTION = `motion-press inline-flex min-h-10 items-center rounded-full border border-amber-300/60 px-3 py-1 text-xs font-semibold disabled:opacity-50 ${RING}`;
const PLAIN = `motion-press inline-flex min-h-10 items-center px-1 text-xs underline decoration-dotted underline-offset-2 disabled:opacity-50 ${RING}`;

// The dice have landed and the game has not yet said what they did: the roller
// may spend something on them (src/lib/dm/after-roll-logic.ts), and a
// Chronurgy wizard beside them may make them roll it again, on the wizard's
// own screen (src/lib/dm/chronal-shift.ts). Everyone else sees who the table
// is waiting on, and whoever runs the story can keep the dice for a player
// who has stepped away.
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
  // The seconds left before the server keeps the dice as they lie
  // (src/lib/dm/after-roll-timer.ts). A roll parked before there was a
  // deadline has none to show.
  const deadline = pending.thrown?.deadline;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [deadline]);
  // The clock ticks once a second, so a fresh deadline can briefly read long.
  const left = deadline ? Math.min(AFTER_ROLL_SECONDS, Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000))) : null;
  // The clock is not a live region (it would speak every second): each
  // button names it as its description, so a keyboard or screen reader user
  // hears the time left as they reach a choice.
  const clockId = useId();
  const timed = left !== null ? clockId : undefined;
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

  // One of my characters' choices on this roll: Chronal Shift, War God's
  // Blessing or Flash of Genius (after-roll.ts allyChoicesFor).
  const mine = new Set(sheets.filter((sheet) => sheet.userId === meUserId).map((sheet) => sheet.id));
  const myShifts = thrown.options.filter((option) => option.by && mine.has(option.by));
  const waitingOn = [...new Set(thrown.options.filter((option) => option.by && !mine.has(option.by)).map((option) => sheets.find((sheet) => sheet.id === option.by)?.name ?? "An ally"))];
  const onlyShifts = thrown.options.filter((option) => option.by).every((option) => option.id === "chronal_shift");
  const myHelpers = [...new Set(myShifts.map((option) => option.by))];
  // A hit waits on the choices that ride one (after-roll-table.ts `when: "hit"`):
  // Touch of Death, Destructive Wrath, an ally's Violent Attraction.
  const hits = thrown.options.some((option) => afterRollRow(option.id).when === "hit");
  const standing = pending.kind === "attack" ? (hits ? "hits" : "misses as it stands") : pending.dc !== null ? `fails against Difficulty Class ${pending.dc} as it stands` : "may still fail";
  const clock = left !== null ? <span id={clockId} className="check-dim text-xs" aria-live="off">The roll stands in {left}s</span> : null;
  const helpLabel = `${onlyShifts ? "Use Chronal Shift on" : "Help"} ${character?.name ? `${character.name}'s` : "this"} roll, or let it stand`;
  const letItStand = myHelpers.map((helper) => (
    <button key={`leave-${helper}`} type="button" disabled={busy} aria-describedby={timed} onClick={() => void choose({ decline: true, by: helper })} className={`${PLAIN} check-dim`}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : myHelpers.length > 1 ? `Let it stand (${sheets.find((sheet) => sheet.id === helper)?.name})` : "Let it stand"}
    </button>
  ));

  if (pending.userId !== meUserId && myShifts.length) {
    // The helper's own screen: the ally's roll, and whether to answer it.
    return (
      <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
        <p className="text-sm">
          {character?.name ?? "An ally"} rolled <strong>{thrown.outcome.total}</strong>
          {thrown.outcome.natural !== undefined ? ` (the die shows ${thrown.outcome.natural})` : ""} and {standing}.
        </p>
        {pending.reason ? <p className="check-dim mt-0.5 text-xs">{pending.reason}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={helpLabel}>
          {myShifts.map((option) => (
            <button key={`${option.id}:${option.by}`} type="button" disabled={busy} aria-describedby={timed} title={option.note} onClick={() => void choose({ use: option.id, by: option.by })} className={OPTION}>
              {option.label}
            </button>
          ))}
          {letItStand}
          {clock}
        </div>
        {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
      </CheckFrame>
    );
  }

  if (pending.userId !== meUserId) {
    return (
      <CheckFrame className="mb-2 flex animate-fade-up items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="min-w-0" role="status">
          {character?.name ?? "A player"} rolled {thrown.outcome.total} and {thrown.kept && waitingOn.length ? `${waitingOn.join(" and ")} ${waitingOn.length > 1 ? "are" : "is"} deciding whether to ${onlyShifts ? "use Chronal Shift" : "help"}` : "is deciding what to do with it"}.
          {left !== null ? <span className="check-dim"> The roll stands in {left}s.</span> : null}
        </span>
        {steersStory && stale ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose({ keep: true })}
            className={`${PLAIN} shrink-0 font-medium`}
          >
            Keep the roll for them
          </button>
        ) : null}
      </CheckFrame>
    );
  }

  const own = thrown.options.filter((option) => !option.by);
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
        {thrown.choosing
          ? "Choose which die counts."
          : thrown.kept
            ? "You kept this roll."
            : pending.kind === "attack"
              // An attack waits on a miss, or on a hit for Touch of Death or
              // Destructive Wrath (after-roll-logic.ts afterAttackOptions). With
              // nothing of their own to press, only the helpers can change a miss.
              ? thrown.options.some((option) => option.id === "touch_of_death" || option.id === "combat_inspiration")
                ? "The attack hits. You can add to its damage."
                : thrown.options.some((option) => option.id === "destructive_wrath")
                  ? "The attack hits. You can deal its lightning and thunder at their maximum."
                  : hits
                    ? "The attack hits. Someone may still add to its damage."
                    : `As it stands, the attack misses.${own.length ? " You can still change that." : ""}`
              : own.length
                ? "Before the game says what happens, you can still change it."
                : "Before the game says what happens, someone may still help."}
      </p>
      {pending.reason ? <p className="check-dim mt-0.5 text-xs">{pending.reason}</p> : null}
      {waitingOn.length ? (
        <p className="check-dim mt-0.5 text-xs" role="status">
          {waitingOn.join(" and ")} {onlyShifts ? "can still make you roll it again with Chronal Shift." : "can still help with this roll."}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={thrown.choosing ? "Choose which die counts" : thrown.kept && myHelpers.length ? helpLabel : "Change this roll, or keep it"}>
        {thrown.choosing
          ? d20s.map((die, index) => (
              <button
                key={index}
                type="button"
                disabled={busy}
                aria-describedby={timed}
                onClick={() => void choose({ die: index })}
                className={OPTION}
              >
                Use the {die.value} (total {die.value + others})
              </button>
            ))
          : [...own, ...myShifts].map((option) => (
              <button
                key={`${option.id}:${option.by ?? ""}`}
                type="button"
                disabled={busy}
                title={option.note}
                aria-describedby={timed}
                onClick={() => void choose(option.by ? { use: option.id, by: option.by } : { use: option.id })}
                className={OPTION}
              >
                {option.label}
              </button>
            ))}
        {thrown.choosing ? null : thrown.kept ? (
          // One account holds the roller and the helper (a player with two
          // characters, a test fight): the kept roll waits on that helper,
          // and only this screen can answer it, so it needs the helper's
          // way out as well as the helper's reroll (play-test 2026-11-09).
          letItStand
        ) : (
          <button
            type="button"
            disabled={busy}
            aria-describedby={timed}
            onClick={() => void choose({ keep: true })}
            className={`${PLAIN} check-dim`}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Keep this roll"}
          </button>
        )}
        {left !== null ? (
          // Read once by a screen reader with the card, not every second.
          <span id={clockId} className="check-dim text-xs" aria-live="off">
            {thrown.choosing ? "The higher die counts" : "The roll stands"} in {left}s
          </span>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </CheckFrame>
  );
}
