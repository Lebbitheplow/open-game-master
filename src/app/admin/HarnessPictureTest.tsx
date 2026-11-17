"use client";

import { Check, ImageIcon, Loader2, Minus, Wand2, X } from "lucide-react";
import { useState } from "react";
import { ui } from "@/lib/ui";
import { useT, useTp } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

// The agent program's picture test, painted the way the tables paint
// (src/lib/harness/picture-test.ts): the tables' own picture door and queue,
// a landscape location map, the saved file, then the campaigns themselves.
// A pass offers the one step that makes it paint for them: on, the default,
// and the campaigns stranded on a backend that cannot paint moved onto it.

type Stage = { id: string; ok: boolean | null; detail?: string };
type CampaignRow = { id: string; title: string; kind: string; backend: string; picturesOn: boolean; canPaint: boolean };
type Result = { image?: { url: string }; stages?: Stage[]; campaigns?: CampaignRow[]; wouldMove?: number; error?: string };
type Moved = { id: string; title: string; from: string; mapsTurnedOn: boolean };

const STAGE_KEYS: Record<string, MessageKey> = {
  painted: "Painted a location map through the tables' picture queue",
  saved: "Saved where the table is sent it",
  shape: "Came back in the map's landscape shape",
};
const STAGE_ORDER = ["painted", "saved", "shape"];

// Backend names that need the table's language; ComfyUI and OpenAI are the
// same words everywhere.
const BACKEND_KEYS: Record<string, MessageKey> = {
  "mflux-hs": "the FLUX worker",
  "sdnq-hs": "the FLUX worker",
  harness: "the agent",
};

function backendName(t: (key: string) => string, backend: string): string {
  return BACKEND_KEYS[backend] ? t(BACKEND_KEYS[backend]) : backend;
}

function names(t: (key: string, vars?: Record<string, string | number>) => string, rows: Array<{ title: string }>): string {
  const titles = rows.map((row) => row.title);
  return titles.length > 3 ? t("{list} and {count} more", { list: titles.slice(0, 3).join(", "), count: titles.length - 3 }) : titles.join(", ");
}

export function HarnessPictureTest({
  saved,
  picturesVerified,
  picturesForTables,
  offerAdopt = true,
  onVerified,
  onAdopted,
}: {
  saved: boolean;
  picturesVerified: boolean;
  // Already the tables' picture backend, switched on.
  picturesForTables: boolean;
  // The guided setup saves the choice on its own Continue instead.
  offerAdopt?: boolean;
  onVerified: () => void;
  onAdopted?: () => void;
}) {
  const t = useT();
  const tp = useTp();
  const [painting, setPainting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [moved, setMoved] = useState<Moved[] | null>(null);
  const [adoptError, setAdoptError] = useState("");

  async function paint() {
    setPainting(true);
    setResult(null);
    setMoved(null);
    try {
      const response = await fetch("/api/admin/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "picture" }),
      });
      const data = (await response.json().catch(() => ({}))) as Result;
      setResult(response.ok && data.image ? data : { ...data, error: data.error ?? t("No picture came back.") });
      if (response.ok && data.image) {
        onVerified();
      }
    } catch {
      setResult({ error: t("Could not reach this server.") });
    } finally {
      setPainting(false);
    }
  }

  async function adopt() {
    setAdopting(true);
    setAdoptError("");
    try {
      const response = await fetch("/api/admin/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adopt" }),
      });
      const data = (await response.json().catch(() => ({}))) as { moved?: Moved[]; error?: string };
      if (!response.ok) {
        setAdoptError(data.error ?? t("Could not switch the tables over."));
        return;
      }
      setMoved(data.moved ?? []);
      onAdopted?.();
    } catch {
      setAdoptError(t("Could not reach this server."));
    } finally {
      setAdopting(false);
    }
  }

  const stages: Stage[] = painting
    ? STAGE_ORDER.map((id) => ({ id, ok: null }))
    : (result?.stages ?? []);
  const passed = Boolean(result?.image);
  const campaigns = (result?.campaigns ?? []).filter((row) => row.kind === "campaign" && row.picturesOn);
  const onAgent = campaigns.filter((row) => row.backend === "harness");
  const stranded = campaigns.filter((row) => row.backend !== "harness" && !row.canPaint);
  const keeping = campaigns.filter((row) => row.backend !== "harness" && row.canPaint);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={ui.btnSmall} onClick={paint} disabled={!saved || painting} aria-busy={painting}>
          {painting ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
          {picturesVerified ? t("Paint another test picture") : t("Paint a test picture")}
        </button>
        <span className="text-xs text-stone-500">
          {t("Paints one location map exactly the way a table asks for one, then checks which campaigns will use it. About a minute.")}
        </span>
      </div>

      {stages.length ? (
        <ol className="hx-stages" aria-live="polite">
          {stages.map((stage, index) => {
            const state = stage.ok === null ? (painting ? "wait" : "skip") : stage.ok ? "ok" : "bad";
            return (
              <li key={stage.id} className="hx-stage live-in" data-state={state} style={{ animationDelay: `${index * 60}ms` }}>
                <span className="hx-stage-mark mt-0.5">
                  {state === "ok" ? (
                    <Check key="ok" className="tick-in size-4 text-emerald-400" />
                  ) : state === "bad" ? (
                    <X key="bad" className="tick-in size-4 text-red-400" />
                  ) : state === "wait" ? (
                    <Loader2 className="size-4 animate-spin text-stone-500" />
                  ) : (
                    <Minus className="size-4 text-stone-600" />
                  )}
                </span>
                <span>
                  <span className={state === "bad" ? "text-red-300" : state === "ok" ? "text-stone-200" : "text-stone-500"}>
                    {STAGE_KEYS[stage.id] ? t(STAGE_KEYS[stage.id]) : stage.id}
                  </span>
                  {stage.detail ? <span className="block text-xs text-stone-500">{stage.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {painting ? (
        <div className="hx-picture breathe aspect-[3/2] bg-stone-900" aria-label={t("Painting")} />
      ) : result?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={result.image.url} src={result.image.url} alt={t("The test map")} className="hx-picture aspect-[3/2]" />
      ) : null}

      {result && !passed && result.error ? (
        <p role="alert" className="motion-shake text-sm text-red-400">
          {result.error}
        </p>
      ) : null}

      {passed ? (
        <div className="live-in space-y-2 text-sm">
          {moved ? (
            <p role="status" className="flex items-start gap-1.5 text-emerald-400">
              <Check className="tick-in mt-0.5 size-4 shrink-0" />
              <span>
                {t("It paints the way the tables ask.")}
                {moved.length
                  ? tp(" Moved {count} campaign off a backend that could not paint: {list}{maps}.", " Moved {count} campaigns off a backend that could not paint: {list}{maps}.", {
                      count: moved.length,
                      list: names(t, moved),
                      maps: moved.some((row) => row.mapsTurnedOn) ? t(", with their area maps switched back on") : "",
                    })
                  : ""}
              </span>
            </p>
          ) : !offerAdopt ? (
            <p className="text-stone-300">
              {t("It paints the way the tables ask.")}
              {stranded.length
                ? tp(" Continue, and the campaign on a backend that cannot paint right now ({list}) moves to it too.", " Continue, and the {count} campaigns on a backend that cannot paint right now ({list}) move to it too.", { count: stranded.length, list: names(t, stranded) })
                : t(" Continue to use it for the tables' pictures.")}
            </p>
          ) : picturesForTables ? (
            <p className="text-stone-300">
              {t("The tables already paint with it{list}.", {
                list: onAgent.length ? tp(": {count} campaign", ": {count} campaigns", { count: onAgent.length }) : "",
              })}
            </p>
          ) : (
            <div className="su-note space-y-2">
              <p>
                {t("It paints, but no table uses it yet.")}
                {stranded.length
                  ? tp(" {count} campaign is on a backend that cannot paint right now ({list}); it moves to the agent too.", " {count} campaigns are on a backend that cannot paint right now ({list}); they move to the agent too.", { count: stranded.length, list: names(t, stranded) })
                  : ""}
              </p>
              <button type="button" className={ui.btnSecondary} onClick={adopt} disabled={adopting} aria-busy={adopting}>
                {adopting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} {t("Paint the tables' pictures with it")}
              </button>
            </div>
          )}
          {keeping.length ? (
            <p className="text-xs text-stone-500">
              {tp("1 campaign keeps its own working backend ({list}); a lead can switch in the campaign's Settings tab, under Story AI.", "{count} campaigns keep their own working backends ({list}); a lead can switch in the campaign's Settings tab, under Story AI.", {
                count: keeping.length,
                list: [...new Set(keeping.map((row) => backendName(t, row.backend)))].join(", "),
              })}
            </p>
          ) : null}
          {adoptError ? (
            <p role="alert" className="motion-shake text-sm text-red-400">
              {adoptError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
