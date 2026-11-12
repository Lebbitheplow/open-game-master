"use client";

import { Check, ChevronDown, CircleHelp, Hourglass, RotateCcw, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { Listed } from "@/app/campaigns/[campaignId]/PanelKit";
import { cn } from "@/lib/cn";
import { DM_STATUS_EVENT, type DmStatusDetail } from "@/lib/dm-status-event";
import type { TraceCall, TraceOutcome, TraceRow, TraceSource, TurnTrace } from "@/lib/dm/turn-trace-logic";
import { ui } from "@/lib/ui";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// The test fight's turn trace (issue 685): every call the GM made at this
// table and what the engine answered, so its author can read why a swing
// "was never rolled" instead of guessing from the chronicle. On the test
// fight's banner only (TestFightBanner.tsx), and the route answers its author
// alone: at a test fight one person holds every seat and every secret.

const PAGE = 10;

// A person's turn is the author's own call, or the test's set-up: the
// prepared fight is deployed as a person even where the AI runs it.
const BY_LABEL: Record<TurnTrace["by"], string> = {
  ai: "The AI GM's turn",
  agent: "The agent program's turn",
  person: "Your call, or the test's set-up",
};

const STATUS_LABEL: Record<TurnTrace["status"], string> = {
  done: "Done",
  halted: "Halted before it finished",
  waiting: "Waiting on a roll",
  running: "Still running",
};

const SOURCE_LABEL: Record<TraceSource, string> = {
  model: "by the GM",
  card: "by the engine, from a card",
  guard: "by the engine, for a spell the player asked for",
  story: "by the engine, from the story",
  agent: "by the agent program",
  person: "by you",
};

// Each answer has its own word and mark, so none is told by colour alone.
const OUTCOME: Record<TraceOutcome, { label: string; icon: LucideIcon; tone: string }> = {
  ok: { label: "Done", icon: Check, tone: "text-stone-300" },
  refused: { label: "Refused", icon: X, tone: "text-ember-300" },
  retry: { label: "Sent back", icon: RotateCcw, tone: "text-ember-300" },
  waiting: { label: "Waiting on a roll", icon: Hourglass, tone: "text-amber-200" },
  unanswered: { label: "No answer", icon: CircleHelp, tone: "text-stone-400" },
};

function outcomeLabel(call: TraceCall): string {
  if (call.outcome === "refused" && call.refusal === "rules") {
    return "Refused by the rules";
  }
  if (call.outcome === "refused" && call.refusal === "limit") {
    return "Over the turn's limit";
  }
  return OUTCOME[call.outcome].label;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function factsOf(turn: TurnTrace): string {
  return [
    STATUS_LABEL[turn.status],
    turn.durationMs !== null ? `${(turn.durationMs / 1000).toFixed(1)} s` : "",
    turn.modelCalls ? plural(turn.modelCalls, "model call", "model calls") : "",
    turn.rolls ? plural(turn.rolls, "roll", "rolls") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// The newest page read again, with any earlier pages the author opened kept
// below it: a turn only ever joins at the top.
function withNewest(fresh: TurnTrace[], shown: TurnTrace[], keepEarlier: boolean): TurnTrace[] {
  if (!keepEarlier) {
    return fresh;
  }
  const ids = new Set(fresh.map((turn) => turn.id));
  return [...fresh, ...shown.filter((turn) => !ids.has(turn.id))];
}

export function TurnTraceButton({ campaignId }: { campaignId: string }) {
  const offered = hostOffers(useCapabilities(), "turnTrace");
  const [open, setOpen] = useState(false);
  if (!offered) {
    return null;
  }
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={cn(bannerButtonClass(), "pk-tap")}>
        Turn trace
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Turn trace">
        {open ? <TraceBody campaignId={campaignId} /> : null}
      </Sheet>
    </>
  );
}

type Page = { turns?: TurnTrace[]; before?: string | null; error?: string };

function TraceBody({ campaignId }: { campaignId: string }) {
  const [turns, setTurns] = useState<TurnTrace[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A counter, so a status change and Try again re-run the same read.
  const [reload, setReload] = useState(0);
  const earlier = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/turn-trace?limit=${PAGE}`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as Page;
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(data.error ?? "The turn trace could not be read.");
          return;
        }
        setError("");
        setTurns((shown) => withNewest(data.turns ?? [], shown, earlier.current));
        if (!earlier.current) {
          setBefore(data.before ?? null);
        }
        setLoaded(true);
      } catch {
        if (!cancelled) {
          setError("Could not reach the server, so the turn trace did not load.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload]);

  // Read again as the GM's turn runs, parks and ends, a moment after the
  // status settles.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onStatus = (event: Event) => {
      if ((event as CustomEvent<DmStatusDetail>).detail?.campaignId !== campaignId) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => setReload((count) => count + 1), 400);
    };
    window.addEventListener(DM_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener(DM_STATUS_EVENT, onStatus);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [campaignId]);

  async function showEarlier() {
    if (!before || busy) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/turn-trace?limit=${PAGE}&before=${encodeURIComponent(before)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Page;
      if (!response.ok) {
        setError(data.error ?? "The earlier turns could not be read.");
        return;
      }
      earlier.current = true;
      setError("");
      setTurns((shown) => {
        const ids = new Set(shown.map((turn) => turn.id));
        return [...shown, ...(data.turns ?? []).filter((turn) => !ids.has(turn.id))];
      });
      setBefore(data.before ?? null);
    } catch {
      setError("Could not reach the server, so the earlier turns did not load.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 pb-1">
      <p className="text-xs leading-5 text-stone-400">
        Every call the GM made at this test, newest turn first: whom it named, what the engine answered, and why a call was
        refused or sent back. Only you see this: at a test fight you hold every seat.
      </p>
      <Listed loaded={loaded} error={error} onRetry={() => setReload((count) => count + 1)} loading="Reading the turns...">
        {turns.length ? (
          <ol className="space-y-3">
            {turns.map((turn) => (
              <li key={turn.id}>
                <TurnCard turn={turn} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-stone-500">No GM turn yet. Play a round, and each call the GM makes shows here.</p>
        )}
        {before ? (
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void showEarlier()}
            className={cn(ui.btnSmall, "pk-tap mt-3 w-full justify-center text-xs")}
          >
            Show earlier turns
          </button>
        ) : null}
      </Listed>
    </div>
  );
}

function TurnCard({ turn }: { turn: TurnTrace }) {
  const heading = `trace-${turn.id}`;
  return (
    <section aria-labelledby={heading} className="animate-fade-up rounded-lg border border-stone-700/60 bg-stone-900/40 p-3">
      <h3 id={heading} className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-amber-100">
        <span>{BY_LABEL[turn.by]}</span>
        <span className="text-xs font-normal text-stone-400">{clock(turn.startedAt)}</span>
      </h3>
      <p className="mt-0.5 text-xs text-stone-400">{factsOf(turn)}</p>
      {turn.revertedAt ? (
        // Said in words, not only by the dimmed calls: the event log's
        // "Revert this turn" took back what these calls changed.
        <p className="mt-1 text-xs text-amber-200">
          <RotateCcw className="mr-1 inline size-3" aria-hidden="true" />
          Reverted {clock(turn.revertedAt)}: what this turn changed was taken back. Its calls stay listed as they were made.
        </p>
      ) : null}
      {turn.by === "ai" ? <Answered lines={turn.answered} /> : null}
      {turn.rows.length ? (
        <ol className={cn("mt-2 space-y-1.5", turn.revertedAt && "opacity-60")}>
          {turn.rows.map((row, index) => (
            <li key={index}>
              <Row row={row} id={`${heading}-${index}`} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-stone-500">
          {turn.by === "person"
            ? "The engine rolled here on its own, with no call to show: a save in an area, a strike out of turn, or the start of a creature's turn."
            : "The GM made no call this turn."}
        </p>
      )}
      {turn.narration ? <Narration text={turn.narration} id={`${heading}-said`} /> : null}
    </section>
  );
}

function Answered({ lines }: { lines: string[] }) {
  if (!lines.length) {
    return <p className="mt-2 text-xs text-stone-500">No new line from the table: the GM took this turn on its own (an opening, the enemies&apos; turns, a nudge).</p>;
  }
  return (
    <div className="mt-2">
      <p className={ui.sectionEyebrow}>It answered</p>
      <ul className="mt-1 space-y-1">
        {lines.map((line, index) => (
          <li key={index} className="whitespace-pre-wrap break-words border-l-2 border-amber-500/30 pl-2 text-xs text-stone-300">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ row, id }: { row: TraceRow; id: string }) {
  if (row.kind === "reply") {
    return (
      <p className="whitespace-pre-wrap break-words border-l-2 border-stone-600/60 pl-2 text-xs text-stone-300">
        <span className="text-stone-500">The GM wrote beside its calls: </span>
        {row.text}
      </p>
    );
  }
  if (row.kind === "note") {
    return (
      <p className="whitespace-pre-wrap break-words rounded-md border border-ember-600/30 bg-ember-500/10 px-2 py-1.5 text-xs text-stone-200">
        <span className="font-semibold text-ember-300">{row.correction ? "The engine sent the GM back to a card: " : "The engine told the GM: "}</span>
        {row.text}
      </p>
    );
  }
  return <CallRow call={row} id={id} />;
}

function CallRow({ call, id }: { call: TraceCall; id: string }) {
  const [open, setOpen] = useState(false);
  const mark = OUTCOME[call.outcome];
  const Icon = mark.icon;
  const no = call.outcome === "refused" || call.outcome === "retry";
  return (
    <div className={cn("rounded-md border", no ? "border-ember-600/40 bg-ember-500/5" : "border-stone-700/50")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="pk-tap flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      >
        <span className={cn("mt-px inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold", mark.tone)}>
          <Icon className="size-3.5" aria-hidden="true" />
          {outcomeLabel(call)}
        </span>
        <span className="min-w-0 flex-1 text-xs">
          <span className="break-all font-code text-amber-100">{call.tool}</span>
          <span className="text-stone-400"> {SOURCE_LABEL[call.source]}</span>
          {call.afterCorrection ? <span className="text-ember-300">, after the engine sent it back</span> : null}
          {call.summary || call.names.length ? (
            <span className="block break-words text-stone-400">{call.summary || call.names.join(", ")}</span>
          ) : null}
          {call.sentence ? <span className="block break-words text-stone-200">{call.sentence}</span> : null}
          {no ? <span className="block text-stone-500">{call.calledAgain ? "Called again later this turn." : "Not called again this turn."}</span> : null}
        </span>
        <ChevronDown className={cn("mt-px size-4 shrink-0 text-stone-500 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={id} hidden={!open} className="animate-fade-up space-y-1.5 border-t border-stone-700/50 px-2 py-2">
        <p className={ui.sectionEyebrow}>Sent with</p>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-950/60 p-2 font-code text-[11px] text-stone-300">
          {call.args || "{}"}
        </pre>
        {call.answer ? (
          <>
            <p className={ui.sectionEyebrow}>The engine answered</p>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-950/60 p-2 font-code text-[11px] text-stone-300">
              {call.answer}
            </pre>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Narration({ text, id }: { text: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="pk-tap inline-flex items-center gap-1 rounded-md py-1 text-xs text-stone-300 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        What the table read
      </button>
      <p id={id} hidden={!open} className="animate-fade-up mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-stone-300">
        {text}
      </p>
    </div>
  );
}
