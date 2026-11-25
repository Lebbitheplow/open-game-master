"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckFrame } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { pendingReason, rollKindLabel } from "@/lib/roll-labels";
import { AFTER_ROLL_SECONDS } from "@/lib/dm/after-roll-logic";
import { useT } from "@/lib/locale";
import { textKey } from "@/lib/language/text-logic";
import { afterRollRow } from "@/lib/dm/after-roll-table";

const STEP_IN_AFTER_MS = 3 * 60 * 1000;

// A finger-sized target (40px, the kit's own) with a ring for the keyboard.
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";
const OPTION = `motion-press inline-flex min-h-10 items-center rounded-full border border-amber-300/60 px-3 py-1 text-xs font-semibold disabled:opacity-50 ${RING}`;
const PLAIN = `motion-press inline-flex min-h-10 items-center px-1 text-xs underline decoration-dotted underline-offset-2 disabled:opacity-50 ${RING}`;

const WHAT_KEY: Record<string, string> = {
  "saving throw": "saving throw",
  "ability check": "ability check",
  "attack roll": "attack roll",
  roll: "roll",
};

function afterRollText(option: { id: string; label: string; note: string; by?: string }, t: ReturnType<typeof useT>) {
  const what = (raw: string | undefined) => {
    const k = textKey(raw ?? "") || "roll";
    return t(WHAT_KEY[k] ?? "roll");
  };
  const paren = (s: string) => s.match(/\(([^)]+)\)/)?.[1] ?? "";
  const num = (s: string) => s.match(/([+-]?\d+)/)?.[1] ?? "";
  switch (option.id) {
    case "lucky":
      return { label: t("Lucky: roll another d20"), note: t("Spend a luck point: roll another d20, then choose which die counts.") };
    case "bardic": {
      const die = paren(option.label);
      return { label: t("Add Bardic Inspiration ({die})", { die }), note: t("Spend your Bardic Inspiration die: add 1{die} to this roll.", { die }) };
    }
    case "own_luck": {
      const die = paren(option.label);
      return { label: t("Add Dark One's Own Luck ({die})", { die }), note: t("Add 1{die} to this check or save.", { die }) };
    }
    case "chronal_shift": {
      if (option.by) {
        const m = option.note.match(/:\s*(.+?)\s+rolls this (.+?) again/);
        const who = m?.[1] ?? option.label.match(/make (.+?) roll/)?.[1] ?? "";
        return { label: t("Chronal Shift: make {who} roll again", { who }), note: t("Spend a use of Chronal Shift and your reaction: {who} rolls this {what} again, and the new roll stands.", { who, what: what(m?.[2]) }) };
      }
      const m = option.note.match(/:\s*roll this (.+?) again/);
      return { label: t("Chronal Shift: roll it again"), note: t("Spend a use of Chronal Shift and your reaction: roll this {what} again, and the new roll stands.", { what: what(m?.[1]) }) };
    }
    case "guided_strike": {
      const bonus = num(option.label);
      return { label: t("Guided Strike: add {bonus}", { bonus }), note: t("Spend a use of Channel Divinity: add {bonus} to this attack roll.", { bonus }) };
    }
    case "master_duelist":
      return { label: t("Master Duelist: roll again with advantage"), note: t("Spend your use of Master Duelist: roll this attack again with advantage, and the new roll stands.") };
    case "favored_by_the_gods": {
      const dice = option.label.match(/(\d+d\d+)/)?.[1] ?? "2d4";
      const m = option.note.match(/to this ([^.]+)\./);
      return { label: t("Favored by the Gods: add {dice}", { dice }), note: t("Spend your use of Favored by the Gods: add {dice} to this {what}.", { dice, what: what(m?.[1]) }) };
    }
    case "war_gods_blessing": {
      const bonus = num(option.label);
      return { label: t("War God's Blessing: add {bonus}", { bonus }), note: t("Use your reaction and a use of Channel Divinity: add {bonus} to this attack roll.", { bonus }) };
    }
    case "flash_of_genius": {
      const bonus = num(option.label);
      return { label: t("Flash of Genius: add {bonus}", { bonus }), note: t("Use your reaction and a use of Flash of Genius: add {bonus} to this roll.", { bonus }) };
    }
    case "touch_of_death": {
      const damage = num(option.label);
      return { label: t("Touch of Death: add {damage} necrotic", { damage }), note: t("Spend a use of Channel Divinity: this hit deals {damage} extra necrotic damage.", { damage }) };
    }
    case "destructive_wrath":
      return { label: t("Destructive Wrath: maximum lightning and thunder"), note: t("Spend a use of Channel Divinity: this hit's lightning and thunder dice are dealt at their maximum instead of rolled.") };
    default:
      return { label: option.label, note: option.note };
  }
}

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
  const t = useT();
  // This card has no title that says what the roll is: its reason does, in
  // the reader's language where the roll's parts make its words.
  const reason = pendingReason(t, pending, false);
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
        setError(data.error || t("Could not send your choice."));
      }
    } catch {
      setError(t("Could not reach the server.", { context: "creator.error.unreachable" }));
    } finally {
      setBusy(false);
    }
  }

  // One of my characters' choices on this roll: Chronal Shift, War God's
  // Blessing or Flash of Genius (after-roll.ts allyChoicesFor).
  const mine = new Set(sheets.filter((sheet) => sheet.userId === meUserId).map((sheet) => sheet.id));
  const myShifts = thrown.options.filter((option) => option.by && mine.has(option.by));
  const waitingOn = [...new Set(thrown.options.filter((option) => option.by && !mine.has(option.by)).map((option) => sheets.find((sheet) => sheet.id === option.by)?.name ?? t("An ally")))];
  const onlyShifts = thrown.options.filter((option) => option.by).every((option) => option.id === "chronal_shift");
  const myHelpers = [...new Set(myShifts.map((option) => option.by))];
  const hits = thrown.options.some((option) => afterRollRow(option.id).when === "hit");
  const standing = pending.kind === "attack" ? (hits ? t("and hits") : t("and misses as it stands")) : pending.dc !== null ? t("and fails against Difficulty Class {dc} as it stands", { dc: pending.dc }) : t("and may still fail");
  const clock = left !== null ? <span id={clockId} className="check-dim text-xs" aria-live="off">{t("The roll stands in {left}s", { left })}</span> : null;
  const helpLabel = character?.name
    ? onlyShifts
      ? t("Use Chronal Shift on {name}'s roll, or let it stand", { name: character.name })
      : t("Help {name}'s roll, or let it stand", { name: character.name })
    : onlyShifts
      ? t("Use Chronal Shift on this roll, or let it stand")
      : t("Help this roll, or let it stand");
  const letItStand = myHelpers.map((helper) => (
    <button key={`leave-${helper}`} type="button" disabled={busy} aria-describedby={timed} onClick={() => void choose({ decline: true, by: helper })} className={`${PLAIN} check-dim`}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : myHelpers.length > 1 ? t("Let it stand ({name})", { name: String(sheets.find((sheet) => sheet.id === helper)?.name) }) : t("Let it stand")}
    </button>
  ));

  if (pending.userId !== meUserId && myShifts.length) {
    // The helper's own screen: the ally's roll, and whether to answer it.
    return (
      <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
        <p className="text-sm">
          {character?.name ?? t("An ally")} {t("rolled")} <strong>{thrown.outcome.total}</strong>
          {thrown.outcome.natural !== undefined ? ` ${t("(the die shows {value})", { value: thrown.outcome.natural })}` : ""} {standing}.
        </p>
        {reason ? <p className="check-dim mt-0.5 text-xs">{reason}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={helpLabel}>
          {myShifts.map((option) => {
            const text = afterRollText(option, t);
            return (
              <button key={`${option.id}:${option.by}`} type="button" disabled={busy} aria-describedby={timed} title={text.note} onClick={() => void choose({ use: option.id, by: option.by })} className={OPTION}>
                {text.label}
              </button>
            );
          })}
          {letItStand}
          {clock}
        </div>
        {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
      </CheckFrame>
    );
  }

  if (pending.userId !== meUserId) {
    // Whom the kept roll waits on, named in a list: the joiner is the
    // dictionaries' word for and.
    const helpers = waitingOn.join(t(" and ", { context: "table.hand.join.and" }));
    const deciding = thrown.kept && waitingOn.length
      ? t(
          waitingOn.length > 1
            ? onlyShifts ? "and {who} are deciding whether to use Chronal Shift" : "and {who} are deciding whether to help"
            : onlyShifts ? "and {who} is deciding whether to use Chronal Shift" : "and {who} is deciding whether to help",
          { who: helpers },
        )
      : t("and is deciding what to do with it");
    return (
      <CheckFrame className="mb-2 flex animate-fade-up items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="min-w-0" role="status">
          {character?.name ?? t("A player")} {t("rolled")} {thrown.outcome.total} {deciding}.
          {left !== null ? <span className="check-dim"> {t("The roll stands in {left}s.", { left })}</span> : null}
        </span>
        {steersStory && stale ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose({ keep: true })}
            className={`${PLAIN} shrink-0 font-medium`}
          >
            {t("Keep the roll for them")}
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
          {rollKindLabel(t, pending.kind)}
        </span>
        {pending.dc !== null ? (
          <span className="check-well check-dim px-2 py-0.5 font-mono text-[11px]">{t("Difficulty Class: {dc}", { dc: pending.dc })}</span>
        ) : null}
      </div>
      <p className="mt-1 text-sm">
        {character?.name ? `${character.name} ${t("rolled")}` : t("You rolled")} <strong>{thrown.outcome.total}</strong>
        {thrown.outcome.natural !== undefined ? ` ${t("(the die shows {value})", { value: thrown.outcome.natural })}` : ""}.{" "}
        {thrown.choosing
          ? t("Choose which die counts.")
          : thrown.kept
            ? t("You kept this roll.")
            : pending.kind === "attack"
              // An attack waits on a miss, or on a hit for Touch of Death,
              // Orcish Fury or Destructive Wrath (after-roll-logic.ts
              // afterAttackOptions). With nothing of their own to press, only
              // the helpers can change a miss.
              ? thrown.options.some((option) => option.id === "touch_of_death" || option.id === "combat_inspiration" || option.id === "orcish_fury")
                ? t("The attack hits. You can add to its damage.")
                : thrown.options.some((option) => option.id === "destructive_wrath")
                  ? t("The attack hits. You can deal its lightning and thunder at their maximum.")
                  : hits
                    ? t("The attack hits. Someone may still add to its damage.")
                    : t("As it stands, the attack misses.{still}", { still: own.length ? ` ${t("You can still change that.")}` : "" })
              : own.length
                ? t("Before the game says what happens, you can still change it.")
                : t("Before the game says what happens, someone may still help.")}
      </p>
      {reason ? <p className="check-dim mt-0.5 text-xs">{reason}</p> : null}
      {waitingOn.length ? (
        <p className="check-dim mt-0.5 text-xs" role="status">
          {onlyShifts
            ? t("{who} can still make you roll it again with Chronal Shift.", { who: waitingOn.join(t(" and ", { context: "table.hand.join.and" })) })
            : t("{who} can still help with this roll.", { who: waitingOn.join(t(" and ", { context: "table.hand.join.and" })) })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={thrown.choosing ? t("Choose which die counts") : thrown.kept && myHelpers.length ? helpLabel : t("Change this roll, or keep it")}>
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
                {t("Use the {value} (total {total})", { value: die.value, total: die.value + others })}
              </button>
            ))
          : [...own, ...myShifts].map((option) => {
              const text = afterRollText(option, t);
              return (
                <button
                  key={`${option.id}:${option.by ?? ""}`}
                  type="button"
                  disabled={busy}
                  title={text.note}
                  aria-describedby={timed}
                  onClick={() => void choose(option.by ? { use: option.id, by: option.by } : { use: option.id })}
                  className={OPTION}
                >
                  {text.label}
                </button>
              );
            })}
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
            {busy ? <Loader2 className="size-4 animate-spin" /> : t("Keep this roll")}
          </button>
        )}
        {left !== null ? (
          // Read once by a screen reader with the card, not every second.
          <span id={clockId} className="check-dim text-xs" aria-live="off">
            {thrown.choosing ? t("The higher die counts in {left}s", { left }) : t("The roll stands in {left}s", { left })}
          </span>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </CheckFrame>
  );
}
