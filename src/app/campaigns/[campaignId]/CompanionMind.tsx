"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// The model and reasoning effort a companion's own mind thinks with (ticket
// 09, src/lib/dm/npc-mind-model.ts), beside the companion where the
// adventure is prepared and on its card in play. Only whoever runs the story
// sees it, and only at a table whose minds run on the server's agent
// program: elsewhere there is nothing to choose. Blank is the table's.
type Offer = {
  models: Array<{ id: string; label: string; efforts: string[] }>;
  tableModel: string;
  tableEffort: string;
};
type Choice = { model: string; effort: string };

export function CompanionMind({ campaignId, characterId, name }: { campaignId: string; characterId: string; name: string }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [choice, setChoice] = useState<Choice>({ model: "", effort: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/campaigns/${campaignId}/companions/${characterId}/mind`;

  useEffect(() => {
    let live = true;
    fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { choice: Choice | null; offer: Offer | null } | null) => {
        if (live && data) {
          setOffer(data.offer);
          setChoice(data.choice ?? { model: "", effort: "" });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);

  if (!offer) {
    return null;
  }
  const tableLabel = offer.models.find((model) => model.id === offer.tableModel)?.label ?? offer.tableModel;
  const efforts = offer.models.find((model) => model.id === (choice.model || offer.tableModel))?.efforts ?? [];

  async function save(next: Choice) {
    setSending(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await response.json().catch(() => ({}))) as { choice?: Choice | null; error?: string };
      if (!response.ok) {
        setError(data.error || "Could not change how they think.");
        return;
      }
      setChoice(data.choice ?? { model: "", effort: "" });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-2 space-y-1" data-companion-mind={characterId}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`What ${name}'s mind thinks with`}>
        <span className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Thinks with</span>
        <select
          aria-label={`${name}'s model`}
          className={cn(ui.input, "min-h-10 w-auto py-1 text-xs sm:min-h-8")}
          value={choice.model}
          disabled={sending}
          // A model that does not offer the effort chosen drops it.
          onChange={(event) => {
            const model = event.target.value;
            const offered = offer.models.find((entry) => entry.id === (model || offer.tableModel))?.efforts ?? [];
            void save({ model, effort: offered.includes(choice.effort) ? choice.effort : "" });
          }}
        >
          <option value="">The table&apos;s ({tableLabel})</option>
          {offer.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        {efforts.length ? (
          <select
            aria-label={`${name}'s reasoning effort`}
            className={cn(ui.input, "min-h-10 w-auto py-1 text-xs sm:min-h-8")}
            value={choice.effort}
            disabled={sending}
            onChange={(event) => void save({ model: choice.model, effort: event.target.value })}
          >
            <option value="">Default effort{offer.tableEffort && !choice.model ? ` (${offer.tableEffort})` : ""}</option>
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="motion-shake text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
