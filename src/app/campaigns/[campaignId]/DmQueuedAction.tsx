"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import type { CampaignMessage } from "@/lib/db/messages";

// One row of the GM console's "Waiting on you" list: a player's action the
// GM has not answered yet. A row whose card the engine can take whole offers
// "Resolve as played" (issue 685, src/lib/dm/resolve-card.ts), which runs
// the card exactly as it was played, as the GM, the same calls the GM's own
// card makes at once; before it the GM read the sentence and entered it all
// again from the console's forms. A row with no card, or a card that needs
// the GM's ruling, shows no button: the server says which rows can be.

// The waiting messages whose cards the engine can resolve now, asked again
// when the waiting cards change or a fight starts or ends (a fight decides
// whether an attack can be made at all).
export function useResolvableCards(campaignId: string, messageIds: readonly string[], fightKey: string, offered: boolean): ReadonlySet<string> {
  const query = offered ? messageIds.map((id) => `id=${encodeURIComponent(id)}`).join("&") : "";
  // The answer is kept with the question it answers, so a list that changed
  // since shows no button until the server has said again.
  const [answer, setAnswer] = useState<{ query: string; ids: ReadonlySet<string> }>({ query: "", ids: NONE });
  useEffect(() => {
    if (!query) return;
    let live = true;
    fetch(`/api/campaigns/${campaignId}/dm/resolve-card?${query}`)
      .then((response) => (response.ok ? response.json() : { resolvable: [] }))
      .then((data: { resolvable?: string[] }) => {
        if (live) setAnswer({ query, ids: new Set(data.resolvable ?? []) });
      })
      // Unreachable for a moment: no button rather than a broken one.
      .catch(() => {
        if (live) setAnswer({ query, ids: NONE });
      });
    return () => {
      live = false;
    };
  }, [campaignId, query, fightKey]);
  return query && answer.query === query ? answer.ids : NONE;
}

const NONE: ReadonlySet<string> = new Set();

export function QueuedAction({
  campaignId,
  name,
  message,
  resolvable,
  onAsk,
}: {
  campaignId: string;
  name: string;
  message: CampaignMessage;
  resolvable: boolean;
  // "What should I press?": the player's words to the console's assist.
  onAsk: (words: string) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const hintId = useId();

  const resolve = async () => {
    if (state !== "idle") return;
    setState("sending");
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/resolve-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      if (!response.ok) {
        // The engine's own refusal (no slot left, out of reach), shown here
        // so the GM knows why the card still waits.
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "The card could not be resolved.");
        setState("idle");
        return;
      }
      // The row leaves the list when every seat hears the card was answered
      // (message_updated); until then it says so.
      setState("done");
    } catch {
      setError("Could not reach the table.");
      setState("idle");
    }
  };

  return (
    <>
      <p className="font-display text-[11px] tracking-[0.12em] text-amber-200/90">{name}</p>
      <p className="whitespace-pre-wrap text-sm text-stone-200">{message.content}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAsk(message.content)}
          className={cn(ui.btnSmall, "min-h-10 px-2 py-1 text-xs")}
        >
          <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-5" />
          What should I press?
        </button>
        {resolvable && state !== "done" ? (
          <button
            type="button"
            onClick={() => void resolve()}
            disabled={state === "sending"}
            aria-describedby={hintId}
            title="The engine resolves the card as the player played it: its rolls, its slot, its effect."
            className={cn(ui.btnSmall, "motion-press min-h-10 px-2 py-1 text-xs")}
          >
            {state === "sending" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <GameIcon icon={{ kind: "glyph", key: "tab-dice" }} size="size-5" />}
            Resolve as played
          </button>
        ) : null}
        {state === "done" ? (
          <span role="status" className="motion-pop text-xs text-stone-400">
            Resolved.
          </span>
        ) : null}
      </div>
      {resolvable ? (
        <span id={hintId} className="sr-only">
          The engine resolves the card as the player played it: its rolls, its slot, its effect.
        </span>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </>
  );
}
