"use client";

import { Brush, Check, History, RotateCw, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import type { WorldEntity } from "@/lib/db/world-forge";
import type { PaintJob, PaintStatus } from "@/lib/db/world-paint-jobs";
import { useT, useTp } from "@/lib/locale";
import type { MessageVars } from "@/lib/messages-logic";

// Paint on an entry's page (audit WF-16), from the jobs the server keeps
// (src/lib/db/world-paint-jobs.ts): read when the page opens and again
// every few seconds while a picture is queued or being painted, for as long
// as that takes, so a reload or a return to the entry finds it where it
// was. A finished picture waits beside the entry's own until the DM keeps
// it or turns it down; a failure says why and offers Retry; one waiting for
// the queue can be cancelled. The pictures the entry had before can be put
// back.

type PaintView = PaintStatus & { queue: { painting: number; waiting: number } };

const POLL_MS = 4_000;

export type PaintState = {
  status: PaintView | null;
  // A job queued or being painted.
  running: PaintJob | null;
  // What the panel's last request was refused with, when no job says it.
  error: string;
  // The action in flight ("paint", or a job id).
  busy: string | null;
  start: () => Promise<void>;
  decide: (action: "accept" | "reject" | "cancel", job: PaintJob) => Promise<void>;
  reuse: (picture: string) => Promise<void>;
};

export function usePaintJobs(campaignId: string, ref: string, portrait: string, onPictureChanged: () => void): PaintState {
  const t = useT();
  const base = `/api/campaigns/${campaignId}/world/entities/${encodeURIComponent(ref)}/paint`;
  const [status, setStatus] = useState<PaintView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const reread = useCallback(() => setReads((count) => count + 1), []);

  // Read on open, when the entry's picture changes (an accept here or in
  // another tab), and on each poll.
  useEffect(() => {
    let cancelled = false;
    void fetch(base)
      .then((response) => (response.ok ? (response.json() as Promise<PaintView>) : null))
      .then((view) => {
        if (!cancelled && view && view.ref === ref) setStatus(view);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, ref, portrait, reads]);

  const running = status?.jobs.find((job) => job.state === "queued" || job.state === "working") ?? null;
  const waitingOn = running ? `${running.id}:${running.state}` : "";
  useEffect(() => {
    if (!waitingOn) return;
    const timer = window.setInterval(reread, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waitingOn, reread]);

  const start = useCallback(async () => {
    setBusy("paint");
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/world/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "paint", ref }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: unknown; job?: unknown };
      // A refusal the server kept as a failed job shows as that job.
      if (!response.ok && !payload.job) setError(typeof payload.error === "string" ? payload.error : t("Paint did not start."));
    } catch {
      setError(t("The server could not be reached.", { context: "workshop.world.paint.unreachable" }));
    } finally {
      setBusy(null);
      reread();
    }
  }, [campaignId, ref, reread, t]);

  const send = useCallback(
    async (body: Record<string, unknown>, key: string): Promise<{ ok: boolean; payload: Record<string, unknown> }> => {
      setBusy(key);
      setError("");
      try {
        const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (response.ok && payload.status) setStatus(payload.status as PaintView);
        return { ok: response.ok, payload };
      } catch {
        return { ok: false, payload: { error: t("The server could not be reached.", { context: "workshop.world.paint.unreachable" }) } };
      } finally {
        setBusy(null);
      }
    },
    [base, t],
  );

  const decide = useCallback(
    async (action: "accept" | "reject" | "cancel", job: PaintJob) => {
      let answer = await send({ action, job: job.id }, job.id);
      // The entry's picture changed after this one was asked for: replacing
      // that newer choice is the DM's to confirm, never a late result's.
      if (!answer.ok && action === "accept" && answer.payload.stale) {
        const ok = await appConfirm(t("This entry's picture was changed after this one was asked for. Use this one anyway, in place of the newer picture?"), {
          title: t("Replace the newer picture?"),
          actionLabel: t("Use this one"),
        });
        if (!ok) {
          reread();
          return;
        }
        answer = await send({ action, job: job.id, replace: true }, job.id);
      }
      if (!answer.ok) {
        setError(typeof answer.payload.error === "string" ? answer.payload.error : t("That did not work.", { context: "load.write.fallback" }));
        reread();
        return;
      }
      if (action === "accept") onPictureChanged();
    },
    [send, reread, onPictureChanged, t],
  );

  const reuse = useCallback(
    async (picture: string) => {
      const answer = await send({ action: "reuse", picture }, picture);
      if (!answer.ok) {
        setError(typeof answer.payload.error === "string" ? answer.payload.error : t("That did not work.", { context: "load.write.fallback" }));
        return;
      }
      onPictureChanged();
    },
    [send, onPictureChanged, t],
  );

  return { status, running, error, busy, start, decide, reuse };
}

// " (1 being painted, 3 waiting with this one)", or nothing when the
// queue says nothing useful.
function queueWords({ painting, waiting }: PaintView["queue"], t: (key: string, vars?: MessageVars) => string): string {
  const parts = [painting ? t("{count} being painted", { count: painting }) : "", waiting > 1 ? t("{count} waiting with this one", { count: waiting }) : ""].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function Picture({ src, alt, wide }: { src: string; alt: string; wide: boolean }) {
  const t = useT();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={cn("w-full rounded-lg border border-stone-700/70 object-cover", wide ? "aspect-video" : "aspect-square")} />
  ) : (
    <span className={cn("grid w-full place-items-center rounded-lg border border-dashed border-stone-700/70 text-xs text-stone-500", wide ? "aspect-video" : "aspect-square")}>{t("No picture yet")}</span>
  );
}

export function PaintPanel({ entity, paint, canPaint }: { entity: WorldEntity; paint: PaintState; canPaint: boolean }) {
  const t = useT();
  const tp = useTp();
  const { status, running, error, busy } = paint;
  if (!status) return error ? <p className="text-xs text-ember-300" role="alert">{error}</p> : null;
  const wide = entity.shelf === "location";
  const ready = status.jobs.filter((job) => job.state === "ready");
  // A failure shows until anything newer is asked for.
  const failed = status.jobs[0]?.state === "failed" ? status.jobs[0] : null;
  const shown = Boolean(running || ready.length || failed || status.earlier.length || error);
  if (!shown) return null;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-stone-700/70 bg-stone-900/40 p-3" aria-label={t("Paint")} data-testid="world-paint">
      <h4 className="eyebrow flex items-center gap-1 text-[10px] text-amber-400/80">
        <Brush className="size-3" aria-hidden="true" /> {t("Paint")}
      </h4>
      <div role="status" className="flex flex-col gap-1 text-xs text-stone-300">
        {running?.state === "queued" ? (
          running.longQueued ? (
            <p data-paint-state="long-queued">
              {t("Still waiting for the server's picture queue, which every table on this server shares")}
              {queueWords(status.queue, t)}. {t("You can cancel this one and paint later.")}
            </p>
          ) : (
            <p data-paint-state="queued">{t("Waiting for its turn on the picture queue.")}</p>
          )
        ) : null}
        {running?.state === "working" ? (
          <p data-paint-state="working">
            {t("Painting. The new picture will wait here for you to keep or turn down;")} {entity.portrait ? t("the entry keeps its picture until then") : t("nothing changes until then.")} {t("A picture being painted cannot be stopped.")}
          </p>
        ) : null}
        {ready.length ? (
          <p data-paint-state="ready">
            {tp("A new picture is ready.", "{count} new pictures are ready.", { count: ready.length })} {entity.portrait ? t("The entry keeps its own until you choose.") : t("Nothing changes until you choose.")}
          </p>
        ) : null}
      </div>
      {running?.state === "queued" ? (
        <div>
          <KitButton tone="small" busy={busy === running.id} disabled={busy !== null} onClick={() => paint.decide("cancel", running)}>
            {busy === running.id ? null : <X className="size-3.5" aria-hidden="true" />} {t("Cancel this picture")}
          </KitButton>
        </div>
      ) : null}

      {ready.map((job) => (
        <div key={job.id} className="flex flex-col gap-2" data-paint-job={job.id}>
          {job.stale ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-300" data-paint-stale>
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {t("This entry's picture was changed after this one was asked for. Using it replaces the newer picture.")}
            </p>
          ) : null}
          <div className="grid max-w-md grid-cols-2 gap-2">
            <figure className="flex flex-col gap-1">
              <Picture src={entity.portrait} alt={t("{name}, the picture it has now", { name: entity.name })} wide={wide} />
              <figcaption className="text-[11px] text-stone-500">{t("Now", { context: "workshop.world.paint.now" })}</figcaption>
            </figure>
            <figure className="flex flex-col gap-1">
              <Picture src={job.result} alt={t("{name}, the new picture", { name: entity.name })} wide={wide} />
              <figcaption className="text-[11px] text-stone-500">{t("New", { context: "workshop.world.paint.new" })}</figcaption>
            </figure>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <KitButton tone="small" busy={busy === job.id} disabled={busy !== null} onClick={() => paint.decide("accept", job)}>
              {busy === job.id ? null : <Check className="size-3.5" aria-hidden="true" />} {t("Use the new picture")}
            </KitButton>
            <KitButton tone="small" disabled={busy !== null} onClick={() => paint.decide("reject", job)}>
              <X className="size-3.5" aria-hidden="true" /> {t("Keep the current one")}
            </KitButton>
          </div>
        </div>
      ))}

      {failed ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-ember-600/40 bg-ember-500/10 px-2.5 py-2" role="alert" data-paint-state="failed">
          <p className="flex items-start gap-1.5 text-xs leading-5 text-stone-200">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-ember-500" aria-hidden="true" />
            <span>
              {t("Not painted.")} {failed.reason}
            </span>
          </p>
          {canPaint ? (
            <div>
              <KitButton tone="small" busy={busy === "paint"} disabled={busy !== null || running !== null} onClick={paint.start}>
                {busy === "paint" ? null : <RotateCw className="size-3.5" aria-hidden="true" />} {t("Retry")}
              </KitButton>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="text-xs text-ember-300" role="alert">{error}</p> : null}

      {status.earlier.length ? (
        <details className="rounded-md border border-stone-800/80 bg-stone-950/40" data-testid="world-paint-earlier">
          <summary className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40">
            <History className="size-3.5 text-stone-500" aria-hidden="true" />
            <span className="flex-1">{t("Earlier pictures")}</span>
            <span className="text-[11px] text-stone-500">{status.earlier.length}</span>
          </summary>
          <ul className="grid grid-cols-3 gap-2 px-2.5 pb-2.5 @lg:grid-cols-4">
            {status.earlier.map((picture, index) => (
              <li key={picture} className="flex flex-col gap-1">
                <Picture src={picture} alt={t("{name}, earlier picture {index}", { name: entity.name, index: index + 1 })} wide={wide} />
                <KitButton tone="small" className="justify-center" busy={busy === picture} disabled={busy !== null} onClick={() => paint.reuse(picture)} aria-label={t("Use earlier picture {index} again", { index: index + 1 })}>
                  {t("Use again")}
                </KitButton>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
