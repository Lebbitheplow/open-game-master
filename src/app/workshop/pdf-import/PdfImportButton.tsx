"use client";

import { BookOpen, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { appNotice } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { navigateTo } from "@/lib/navigation";
import { hostOffers, offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import type { MatchOption } from "@/lib/pdf-import/match-logic";
import type { ImportView, ReviewView } from "@/lib/pdf-import/view";
import type { MatchChoice } from "./PdfMatches";
import { PdfReview } from "@/app/workshop/pdf-import/PdfReview";
import { sendBook, type SendProgress } from "@/app/workshop/pdf-import/send-book";

// "Import an adventure PDF": the GM picks their own copy of a book, the
// page reads it (src/lib/pdf-import/read-pdf.ts), the server reads what it
// says (and, with a story model, what it means), and the GM reviews the
// result before it becomes a workshop, or, from WorldForge, part of the
// world already open. An import half done (a closed tab, a phone that
// slept) waits on the server and is offered again here.
//
// No setting: the import does as much as the host can. Without a story
// model it reads the layout (the text, stat blocks, tables, maps, pictures
// and chapters) and says what a model would add.

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; progress: SendProgress; fileName: string }
  | { kind: "working"; item: ImportView }
  | { kind: "review"; item: ImportView; review: ReviewView; srd: MatchOption[] };

const POLL_MS = 2_000;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }).catch(() => {
    throw new Error("Could not reach the server. Nothing was lost; try again.");
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "That did not work. Try again.");
  return data;
}

function sendingLine(progress: SendProgress): string {
  if (progress.phase === "opening") return "Opening the book...";
  if (progress.phase === "pages") return `Reading page ${progress.done} of ${progress.total}`;
  if (progress.phase === "pictures") return `Keeping its pictures: ${progress.done} of ${progress.total}`;
  return "Starting the import...";
}

export function PdfImportButton({
  campaignId,
  label = "Import an adventure PDF",
  className = ui.btnSecondary,
  onImported,
}: {
  // Begun inside a workshop's WorldForge: the world it goes into.
  campaignId?: string;
  label?: string;
  className?: string;
  // From WorldForge: what to refresh once the book is in.
  onImported?: () => void;
}) {
  const capabilities = useCapabilities();
  const offered = hostOffers(capabilities, "pdfImport");
  const withModel = offersStoryModel(capabilities);
  const input = useRef<HTMLInputElement>(null);
  const signal = useRef({ cancelled: false });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [matchError, setMatchError] = useState("");
  const chosen = useRef(0);
  const [open, setOpen] = useState<ImportView[]>([]);
  const [continueId, setContinueId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const destination = campaignId ? "world" : "workshop";

  const mine = useCallback((item: ImportView) => (campaignId ? item.campaignId === campaignId : !item.campaignId), [campaignId]);

  const refreshOpen = useCallback(async () => {
    try {
      const data = await json<{ imports: ImportView[] }>("/api/pdf-imports");
      setOpen(data.imports.filter(mine));
    } catch {
      // The list is a convenience; the button works without it.
    }
  }, [mine]);

  useEffect(() => {
    if (!offered) return;
    let stopped = false;
    json<{ imports: ImportView[] }>("/api/pdf-imports")
      .then((data) => {
        if (!stopped) setOpen(data.imports.filter(mine));
      })
      .catch(() => {
        // The list is a convenience; the button works without it.
      });
    return () => {
      stopped = true;
    };
  }, [offered, mine]);

  const follow = useCallback(async (item: ImportView) => {
    if (item.state === "review") {
      const data = await json<{ import: ImportView; review?: ReviewView; srd?: MatchOption[] }>(`/api/pdf-imports/${item.id}`);
      if (data.review) setPhase({ kind: "review", item: data.import, review: data.review, srd: data.srd ?? [] });
      return;
    }
    setPhase({ kind: "working", item });
  }, []);

  // While the server reads, the card follows it.
  useEffect(() => {
    if (phase.kind !== "working") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const data = await json<{ import: ImportView; review?: ReviewView; srd?: MatchOption[] }>(`/api/pdf-imports/${phase.item.id}`);
        if (stopped) return;
        if (data.import.state === "review" && data.review) setPhase({ kind: "review", item: data.import, review: data.review, srd: data.srd ?? [] });
        else if (data.import.state === "failed") {
          setError(data.import.reason || "The import stopped.");
          setPhase({ kind: "idle" });
          void refreshOpen();
        } else setPhase({ kind: "working", item: data.import });
      } catch (thrown) {
        if (!stopped) setError(thrown instanceof Error ? thrown.message : "Lost touch with the import.");
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [phase, refreshOpen]);

  if (!offered) return null;

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    signal.current = { cancelled: false };
    setPhase({ kind: "sending", progress: { phase: "opening", done: 0, total: 0 }, fileName: file.name });
    try {
      const item = await sendBook(file, {
        campaignId,
        continueId: continueId || undefined,
        signal: signal.current,
        onProgress: (progress) => setPhase({ kind: "sending", progress, fileName: file.name }),
      });
      setContinueId("");
      await follow(item);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That PDF could not be read.");
      setPhase({ kind: "idle" });
      void refreshOpen();
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function discard(id: string) {
    setBusy(true);
    try {
      await json(`/api/pdf-imports/${id}`, { method: "DELETE" });
      setPhase({ kind: "idle" });
      await refreshOpen();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That import could not be discarded.");
    } finally {
      setBusy(false);
    }
  }

  // A creature's match, saved as it is made: the review comes back with
  // its records' notes brought up to date. Choices can follow each other
  // faster than the saves; only the latest reply is shown.
  async function choose(item: ImportView, srd: MatchOption[], choices: Record<string, MatchChoice>) {
    const mine = ++chosen.current;
    setMatchError("");
    try {
      const data = await json<{ import: ImportView; review: ReviewView }>(`/api/pdf-imports/${item.id}`, { method: "PATCH", body: JSON.stringify({ matches: choices }) });
      if (mine === chosen.current) setPhase({ kind: "review", item: data.import, review: data.review, srd });
    } catch (thrown) {
      if (mine === chosen.current) setMatchError(thrown instanceof Error ? thrown.message : "That match could not be saved. Try it again.");
    }
  }

  async function bringIn(item: ImportView, choices: { include: Record<string, boolean>; title: string; destination: "workshop" | "world" }) {
    setBusy(true);
    setError("");
    try {
      await json(`/api/pdf-imports/${item.id}`, { method: "PATCH", body: JSON.stringify({ include: choices.include, ...(choices.title ? { title: choices.title } : {}) }) });
      const done = await json<{ workshopId: string; shelf?: { renamed: string[]; refused: string[] } }>(`/api/pdf-imports/${item.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "import", destination: choices.destination }),
      });
      const renamed = (done.shelf?.renamed ?? []).filter(Boolean);
      const refused = (done.shelf?.refused ?? []).filter(Boolean);
      if (renamed.length || refused.length) {
        await appNotice([...renamed, ...refused].join(" "), "From the book");
      }
      setPhase({ kind: "idle" });
      if (choices.destination === "world" && campaignId) {
        onImported?.();
        await refreshOpen();
      } else navigateTo(`/workshop/${done.workshopId}`);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "The book could not be brought in.");
    } finally {
      setBusy(false);
    }
  }

  const sending = phase.kind === "sending";
  const working = phase.kind === "working";
  const percent =
    phase.kind === "sending" && phase.progress.total
      ? Math.round((phase.progress.done / phase.progress.total) * 100)
      : phase.kind === "working" && phase.item.total
        ? Math.round((phase.item.done / phase.item.total) * 100)
        : null;

  return (
    // It sits in a row of buttons: allowed to shrink to the row, and the
    // whole row once a book is being read or reviewed.
    <div data-testid="pdf-import" className={cn("min-w-0 max-w-full", phase.kind !== "idle" && "basis-full")}>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(event) => void pick(event.target.files?.[0])} />
      <button
        type="button"
        onClick={() => {
          setContinueId("");
          input.current?.click();
        }}
        disabled={sending || working || busy}
        className={className}
        title="Your own copy of an adventure book, read into a workshop"
      >
        {sending || working ? <Loader2 className="size-4 animate-spin" /> : <BookOpen className="size-4" />}
        {label}
      </button>

      {phase.kind === "idle" && open.length ? (
        <ul className="stagger mt-2 space-y-1" aria-label="Imports in progress">
          {open.map((item) => (
            <li key={item.id} className="reveal flex flex-wrap items-center gap-2 text-xs text-stone-400">
              <span className="text-stone-300">{item.title || item.fileName}</span>
              <span>
                {item.state === "review"
                  ? "is read and waiting for you"
                  : item.state === "working"
                    ? item.step || "is being read"
                    : item.state === "failed"
                      ? `stopped: ${item.reason}`
                      : `has ${item.pagesReceived} of ${item.pageCount} pages`}
              </span>
              {item.state === "review" || item.state === "working" ? (
                <button type="button" className={ui.btnSmall} onClick={() => void follow(item).catch((thrown) => setError(String(thrown?.message ?? thrown)))}>
                  {item.state === "review" ? "Review it" : "Follow it"}
                </button>
              ) : (
                <button
                  type="button"
                  className={ui.btnSmall}
                  onClick={() => {
                    setContinueId(item.state === "failed" && item.pagesReceived >= item.pageCount ? "" : item.id);
                    if (item.state === "failed" && item.pagesReceived >= item.pageCount) {
                      void json<{ import: ImportView }>(`/api/pdf-imports/${item.id}`, { method: "POST", body: JSON.stringify({ action: "start" }) })
                        .then((data) => follow(data.import))
                        .catch((thrown) => setError(thrown instanceof Error ? thrown.message : "It could not start again."));
                    } else input.current?.click();
                  }}
                >
                  {item.state === "failed" && item.pagesReceived >= item.pageCount ? "Try again" : "Pick the PDF again"}
                </button>
              )}
              <button type="button" className={ui.btnSmall} disabled={busy} onClick={() => void discard(item.id)}>
                Discard
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {sending || working ? (
        <div className={`${ui.card} reveal mt-3 p-4`} role="status" aria-live="polite">
          <p className="text-sm text-stone-200">{sending ? sendingLine(phase.progress) : phase.item.step || "Reading the book"}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-800" aria-hidden="true">
            <div
              className={cn("h-full rounded-full bg-amber-400/80 transition-[width] duration-500", percent === null && "w-1/3 animate-pulse")}
              style={percent === null ? undefined : { width: `${Math.max(3, percent)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-stone-500">
            {sending
              ? "The PDF stays on this device; only what it says and its pictures go to the server."
              : withModel
                ? "The story model is reading the book a piece at a time. A long book takes a while on a local model; you can leave this page and come back."
                : "Reading the book's layout. With a story model set up, an import also finds its people, places, factions, treasure and fights."}
          </p>
          {sending ? (
            <button type="button" className={cn(ui.btnSmall, "mt-2")} onClick={() => (signal.current.cancelled = true)}>
              Stop
            </button>
          ) : (
            <button type="button" className={cn(ui.btnSmall, "mt-2")} disabled={busy} onClick={() => void discard(phase.item.id)}>
              Stop and discard
            </button>
          )}
        </div>
      ) : null}

      {phase.kind === "review" ? (
        <PdfReview
          importId={phase.item.id}
          review={phase.review}
          destination={destination}
          busy={busy}
          error={error}
          matchError={matchError}
          srd={phase.srd}
          onChoose={(choices) => void choose(phase.item, phase.srd, choices)}
          onReread={() =>
            void json<{ import: ImportView }>(`/api/pdf-imports/${phase.item.id}`, { method: "POST", body: JSON.stringify({ action: "start" }) })
              .then((data) => follow(data.import))
              .catch((thrown) => setError(thrown instanceof Error ? thrown.message : "It could not start again."))
          }
          onImport={(choices) => void bringIn(phase.item, choices)}
          onDiscard={() => void discard(phase.item.id)}
        />
      ) : null}

      {error && phase.kind !== "review" ? (
        <p role="alert" className="motion-shake mt-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
