"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { PLAY_EFFECT, type PlayCandidate, type PlayField } from "@/lib/worldforge/play-fields";
import type { WorldEntity } from "@/lib/db/world-forge";
import { useT } from "@/lib/locale";

// "In play": a Cast member's faction and home, as play reads them, beside
// the World links that say something about them (audit finding WF-12). A
// link changes play only when the author applies it here; a false belief
// is never offered, and a hidden truth only as the truth.

const TITLE_KEYS: Record<PlayField, string> = { faction: "Faction in play", home: "Home in play" };
const EFFECT_KEYS: Record<PlayField, string> = { faction: "The party's standing with this faction makes social checks with them easier or harder.", home: "The narrator places them here, and lists them among the people at this place." };

export function PlayFields({ campaignId, entity, onChanged }: { campaignId: string; entity: WorldEntity; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (entity.shelf !== "npc" || !entity.inPlay.length) return null;

  async function apply(field: PlayField, candidate: PlayCandidate) {
    setBusy(candidate.linkId);
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}/world/entities/${encodeURIComponent(entity.ref)}/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, link: candidate.linkId, truth: candidate.veracity === "hidden" }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy("");
    if (!response?.ok) {
      setError(data?.error ?? t("That could not be changed."));
      return;
    }
    onChanged();
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t("In play", { context: "workshop.world.play.aria" })} data-testid="world-in-play">
      <h4 className="eyebrow text-[10px] text-amber-400/80">{t("In play", { context: "workshop.world.play.title" })}</h4>
      {entity.inPlay.map((adapter) => (
        <div key={adapter.field} className="flex flex-col gap-1.5 rounded-lg border border-stone-700/60 p-2" data-testid={`world-in-play-${adapter.field}`}>
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-stone-400">{t(TITLE_KEYS[adapter.field])}</span>
            <span className="text-stone-100" data-testid="world-in-play-current">{adapter.current?.name || t("None", { context: "workshop.world.play.none" })}</span>
          </div>
          <p className="text-[11px] text-stone-500">{t(EFFECT_KEYS[adapter.field])}</p>
          {adapter.candidates.map((candidate) => (
            <div key={candidate.linkId} className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="world-in-play-link" data-state={candidate.state}>
              <span className="text-stone-300">
                {t("The World link says")} <span className="text-amber-100">{candidate.name}</span>
                {candidate.rank ? <span className="text-stone-500"> ({candidate.rank})</span> : null}
                {candidate.veracity === "hidden" ? <span className="text-red-300"> {t("as a hidden truth")}</span> : null}
              </span>
              {candidate.state === "same" ? (
                <span className="flex items-center gap-1 text-emerald-300">
                  <Check className="size-3.5" /> {t("Play agrees")}
                </span>
              ) : candidate.state === "false" ? (
                <span className="text-stone-500">{t("A false belief: play does not take it.")}</span>
              ) : (
                <>
                  {candidate.state === "differs" ? <span className="text-amber-300">{t("Play says {name} until you choose.", { name: adapter.current?.name ?? t("None", { context: "workshop.world.play.none" }) })}</span> : null}
                  <KitButton tone="small" busy={busy === candidate.linkId} disabled={Boolean(busy)} onClick={() => void apply(adapter.field, candidate)}>
                    {candidate.veracity === "hidden" ? t("Use the truth in play: {name}", { name: candidate.name }) : t("Use {name} in play", { name: candidate.name })}
                  </KitButton>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
      {error ? <PanelError>{error}</PanelError> : null}
    </section>
  );
}
