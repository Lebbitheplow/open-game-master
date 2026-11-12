"use client";

import { Dices, Loader2, Smartphone, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CampaignMember } from "@/lib/campaign-types";
import { cn } from "@/lib/cn";
import { FaceInputs, useFaceEntry } from "@/components/dice/FaceEntry";
import { buzz, onShake, supportsShake, useShakeToRoll } from "@/lib/dice/shake-to-roll";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckDie, CheckFrame, ModifierBreakdown } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { findSkill } from "@/lib/srd";
import { heldInspiration } from "@/lib/dm/roll-riders";
import { INSPIRED_KINDS } from "@/lib/dm/pending-inspiration";
import { canWaitOnRoll } from "@/lib/dm/after-roll-logic";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { ownBeforeRollChoices } from "@/lib/dm/before-roll-logic";
import { ROLL_KIND_LABELS } from "@/lib/roll-labels";

const ABILITY_NAMES: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const OWNER_FALLBACK_AFTER_MS = 3 * 60 * 1000;

const SUBMIT_BUTTON = cn(
  "motion-press rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-950",
  "shadow-[0_1px_0_rgba(253,247,231,0.6)_inset] transition-all duration-150 ease-snap",
  "hover:-translate-y-px hover:shadow-glow-gold-strong active:translate-y-0 active:scale-95",
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none",
);

// A parked roll. For a physical-dice player the roller enters each die; for
// a player who holds their own rolls (shake to roll) the card waits for a
// shake or a tap and the server rolls. Everyone else sees a waiting card.
// The roller can always fall back to a digital roll; the owner can too once
// the card has sat unanswered for a few minutes.
//
// The presentation is the violet skill-check card (SkillCheckCard.tsx,
// docs/visual-overhaul-plan.md 5.4): the halo breathes while the roll is
// parked, the die tumbles once it has been sent, and the landing itself
// plays where the roll arrives, in the chronicle (RollCard.tsx). Every
// source and control is as it was. The dice themselves (a field for each,
// a Pixels die filling its own) are FaceEntry.tsx's, shared with the sheet.
export function PendingRollCard({
  campaignId,
  pending,
  sheets,
  members,
  meUserId,
  steersStory,
  beforeRoll = false,
  reactionsUsed = [],
}: {
  campaignId: string;
  pending: PendingRoll;
  sheets: CharacterSheet[];
  members: CampaignMember[];
  meUserId: string;
  steersStory: boolean;
  // The host answers the before-roll route (capabilities beforeRollWatch).
  beforeRoll?: boolean;
  // Who has spent their reaction this round, in a fight.
  reactionsUsed?: readonly string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Sampled once on mount; the fallback affordance appearing on the next
  // re-render after the threshold is fine for a courtesy button.
  const [mountedAt] = useState(() => Date.now());

  const mine = pending.userId === meUserId;
  // Held without real dice: no faces to type, the whole roll is digital
  // and released by the roller (a shake here, a tap anywhere).
  const roller = members.find((member) => member.userId === pending.userId);
  // A roll waiting on Portent is the server's to throw, as a held roll is.
  const foretelling = pending.parkedFor === "foretold";
  const heldOnly = foretelling || Boolean(roller?.holdRolls && !roller?.useRealDice);
  const shakeOn = useShakeToRoll();
  const [canShake] = useState(() => supportsShake());
  const shakeActive = mine && shakeOn && canShake;

  // The dice as the roller enters them; a Pixels die fills its own face on
  // the roller's screen only.
  const entry = useFaceEntry(pending.expression, mine);
  const { faces, rerollNotes, values, complete, fullyAutomatic, diceSummary, submissionDice } = entry;

  const character = sheets.find((sheet) => sheet.id === pending.characterId);
  const detailText = pending.detail.replaceAll("_", " ");
  const label = `${character?.name ?? "Someone"}: ${pending.kind.replaceAll("_", " ")}${
    detailText ? ` (${detailText})` : ""
  }`;
  // Enter raw die faces only; any flat bonus applies server-side.
  const flatModifier = entry.flatModifier;
  const modifierNote = flatModifier
    ? `Enter the bare die numbers; the ${flatModifier} is added for you.`
    : "";
  const advantageNote =
    pending.advantage === "advantage"
      ? "advantage: roll both, highest counts"
      : pending.advantage === "disadvantage"
        ? "disadvantage: roll both, lowest counts"
        : "";
  const stale = mountedAt - new Date(pending.createdAt).getTime() > OWNER_FALLBACK_AFTER_MS;
  async function submit(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/pending-rolls/${pending.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not submit the roll.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    // A held roll is the player's to release: never auto-submit it, even
    // when every die source is digital.
    if (!mine || heldOnly || !fullyAutomatic || autoSubmittedRef.current || busy || !complete) {
      return;
    }
    autoSubmittedRef.current = true;
    void submit({ dice: submissionDice() });
    // submit is stable enough for this one-shot guarded call; re-running only
    // matters to catch the transition to complete, which the deps below cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, heldOnly, fullyAutomatic, busy, complete, faces, values]);

  // A shake releases the roll: the typed and Pixels faces when they are all
  // in, otherwise a fully digital roll. One shake per card.
  const shakenRef = useRef(false);
  useEffect(() => {
    if (!shakeActive || busy) {
      return;
    }
    return onShake(() => {
      if (shakenRef.current) return;
      shakenRef.current = true;
      buzz();
      void submit(!heldOnly && complete ? { dice: submissionDice() } : { fallback: "digital" });
    });
    // submit and submissionDice read the latest values through closure;
    // the listener is rebound whenever the inputs it depends on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeActive, busy, heldOnly, complete, faces, values]);

  // Inspiration: advantage on this d20 before it is thrown (SRD 5.1). Offered
  // while the character holds it and the roll could use it; the route answers
  // with the rule's sentence when it cannot.
  const canInspire =
    Boolean(character && heldInspiration(character)) &&
    (INSPIRED_KINDS as readonly string[]).includes(pending.kind) &&
    pending.advantage !== "advantage";
  // Portent: a number foretold at the last long rest, instead of this d20.
  const foretold = character && canWaitOnRoll(pending.kind) && !pending.thrown ? [...new Set(foretoldLeft(character))] : [];
  async function foretell(value: number) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}/portent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not use your Portent.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // Cosmic Omen's Weal and Restore Balance on the character's own roll, before
  // it is thrown (before-roll-logic.ts, issue #908).
  const beforeChoices =
    beforeRoll && character && !pending.thrown
      ? ownBeforeRollChoices(character, { kind: pending.kind, expression: pending.expression, reactionFree: !reactionsUsed.includes(character.id), used: pending.carry?.before })
      : [];
  async function spendBefore(use: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}/before-roll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not use that.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function inspire() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}/inspiration`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not spend your Inspiration.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function stopHolding() {
    await fetch(`/api/campaigns/${campaignId}/members/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdRolls: false }),
    }).catch(() => undefined);
  }

  // What the card is about, for its head: the kind, the DC the table was
  // sent, and the ability behind a skill ("Athletics" is Strength).
  const title = ROLL_KIND_LABELS[pending.kind] ?? "Roll";
  const skillId = pending.detail.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const abilityId =
    pending.kind === "skill_check"
      ? findSkill(skillId)?.ability
      : pending.kind === "saving_throw" || pending.kind === "ability_check"
        ? skillId.slice(0, 3)
        : undefined;
  const abilityName = abilityId ? ABILITY_NAMES[abilityId] : undefined;

  if (!mine) {
    return (
      <CheckFrame className="mb-2 flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <CheckDie state="waiting" sides={faces[0] ?? 20} size="size-7" />
          <span className="min-w-0">
            Waiting for {character?.name ?? "a player"} to roll {pending.expression}
            {heldOnly ? "" : " with real dice"}
          </span>
        </span>
        {steersStory && stale ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ fallback: "digital" })}
            className="motion-press shrink-0 font-medium underline decoration-dotted underline-offset-2 disabled:opacity-50"
          >
            Roll digitally
          </button>
        ) : null}
      </CheckFrame>
    );
  }

  return (
    <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-3">
        {/* The die: resting under its halo, tumbling once the roll is sent. */}
        <CheckDie state={busy ? "waiting" : "idle"} sides={faces[0] ?? 20} halo={!busy} />
        <div className="min-w-0 flex-1 basis-52">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="check-well px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em]">
              {title}
            </span>
            {pending.dc !== null ? (
              <span className="check-well check-dim px-2 py-0.5 font-mono text-[11px]">Difficulty Class: {pending.dc}</span>
            ) : null}
            <ModifierBreakdown expression={pending.expression} caption={abilityName} />
          </div>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <Dices className="size-4 shrink-0" style={{ color: "var(--check-vine)" }} />
            <span className="min-w-0">Your roll: {label}</span>
          </p>
          {pending.reason ? <p className="check-dim mt-0.5 text-xs">{pending.reason}</p> : null}
          {canInspire ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void inspire()}
              title="Spend your Inspiration: advantage on this roll."
              className="motion-pop motion-press mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-amber-400/60 bg-amber-500/10 px-3 text-xs text-amber-100 transition-colors duration-150 hover:bg-amber-500/20 disabled:opacity-50 sm:min-h-8"
            >
              <Sparkles className="size-3.5" /> Spend Inspiration
            </button>
          ) : null}
          {beforeChoices.length ? (
            <div role="group" aria-label="Before you roll" className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs">Before you roll:</span>
              {beforeChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void spendBefore(choice.id)}
                  title={choice.note}
                  className="motion-press inline-flex min-h-10 items-center justify-center rounded-full border border-amber-400/60 px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:opacity-50"
                >
                  {choice.label}
                </button>
              ))}
            </div>
          ) : null}
          {foretold.length ? (
            <div role="group" aria-label="Use a number Portent foretold" className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs">Portent, instead of rolling:</span>
              {foretold.map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => void foretell(value)}
                  title={`The foretold ${value} becomes this roll's d20, and is gone until your next long rest.`}
                  className="motion-press inline-flex min-h-10 items-center justify-center rounded-full border border-amber-400/60 px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:opacity-50"
                >
                  Use the {value}
                </button>
              ))}
            </div>
          ) : null}
      {heldOnly ? (
        <>
          {advantageNote ? (
            <p className="check-dim mt-0.5 text-xs">{advantageNote}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {shakeActive ? (
              <span className="flex items-center gap-2 text-sm">
                <Smartphone className="size-5 animate-bounce" style={{ color: "var(--check-vine)" }} />
                Shake to roll {diceSummary}
              </span>
            ) : foretelling ? null : (
              <span className="text-xs">
                Your rolls wait for you{canShake ? "" : " (shake to roll is on on your phone)"}.
              </span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({ fallback: "digital" })}
              className={SUBMIT_BUTTON}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Roll now"}
            </button>
            {!shakeActive && !foretelling ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void stopHolding()}
                className="check-dim text-xs hover:underline disabled:opacity-50"
              >
                Stop holding my rolls
              </button>
            ) : null}
          </div>
          {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
        </>
      ) : null}
      {!heldOnly && diceSummary ? (
        <p className="mt-1 text-xs">
          {fullyAutomatic
            ? `Roll ${diceSummary}. Your assigned dice fill in on their own.`
            : `Roll ${diceSummary} at your table and enter each die below.${
                modifierNote ? ` ${modifierNote}` : ""
              } The game waits for your result.`}
        </p>
      ) : null}
      {!heldOnly && advantageNote ? (
        <p className="check-dim mt-0.5 text-xs">{advantageNote}</p>
      ) : null}
      {!heldOnly
        ? rerollNotes.map((note) => (
            <p key={note} className="check-dim mt-0.5 text-xs">
              {note}
            </p>
          ))
        : null}
      {!heldOnly && shakeActive ? (
        <p className="check-dim mt-0.5 flex items-center gap-1.5 text-xs">
          <Smartphone className="size-3.5" /> Or shake to roll it digitally.
        </p>
      ) : null}

      {heldOnly ? null : (
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <FaceInputs entry={entry} dimClass="check-dim" />
        <button
          type="button"
          disabled={busy || !complete}
          onClick={() => submit({ dice: submissionDice() })}
          className={SUBMIT_BUTTON}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Submit roll"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit({ fallback: "digital" })}
          className="check-dim text-xs hover:underline disabled:opacity-50"
        >
          Roll digitally instead
        </button>
      </div>
      )}
      {!heldOnly && error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
        </div>
      </div>
    </CheckFrame>
  );
}
