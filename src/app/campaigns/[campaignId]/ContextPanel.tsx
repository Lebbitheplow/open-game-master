"use client";

import { EmptyState } from "@/components/EmptyState";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useT } from "@/lib/locale";
import type { BlockKind, ContextTrace } from "@/lib/dm/context-budget";

// "What the DM was actually sent." Lead only, because the underlying prompt
// carries DM-only facts and the secret story arc; see the route for why even
// the token counts stay behind that gate.
//
// The point of this panel is answering one question after a bad turn: was the
// thing the DM forgot even in the prompt? A dropped block with a reason is a
// far better answer than guessing at the model. The human framing reads the
// dictionaries (table.context.*); the protocol identifiers — tool names, the
// server's group names, finish reasons, more_tools — stay as it wrote them,
// as do the trace's own English lines.

const KIND_KEY: Record<BlockKind, string> = {
  safety: "Lines and veils",
  contract: "Engine boundary",
  rules: "Rules",
  sky: "Sky and hour",
  state: "Game state",
  factions: "Factions",
  quests: "Quests",
  shop: "Shop",
  retrieval: "Lore and house rules",
  chapters: "Chapters",
  history: "Transcript",
  tools: "Tool definitions",
};

// Palette is stone, amber and ember only (src/app/globals.css remaps the
// Tailwind names); anything outside it renders as raw Tailwind and clashes
// with the indigo-and-gold theme.
const KIND_COLOR: Record<BlockKind, string> = {
  safety: "text-ember-300",
  contract: "text-amber-300",
  rules: "text-stone-300",
  sky: "text-stone-300",
  state: "text-amber-200",
  factions: "text-amber-200",
  quests: "text-amber-200",
  shop: "text-amber-200",
  retrieval: "text-ember-300",
  chapters: "text-ember-400",
  history: "text-stone-200",
  tools: "text-stone-400",
};

type Translate = (english: string, vars?: Record<string, string | number>) => string;

function translateBlockReason(t: Translate, reason: string): string {
  const exact = t(reason);
  if (exact !== reason) return exact;
  if (reason.includes("; ")) {
    const parts = reason.split("; ").map((part) => translateBlockReason(t, part));
    return parts.join(" ; ");
  }
  let m = /^kept (\d+) of (\d+) messages$/.exec(reason);
  if (m) return t("kept {kept} of {total} messages", { kept: m[1], total: m[2] });
  m = /^(\d+) covered by the summaries left out$/.exec(reason);
  if (m) return t("{count} covered by the summaries left out", { count: m[1] });
  m = /^(\d+) older dropped over the history budget$/.exec(reason);
  if (m) return t("{count} older dropped over the history budget", { count: m[1] });
  m = /^all (\d+) messages fit$/.exec(reason);
  if (m) return t("all {count} messages fit", { count: m[1] });
  return reason;
}

function translateArcReason(t: Translate, reason: string): string {
  if (reason.includes("; ")) {
    return reason.split("; ").map((part) => translateArcReason(t, part)).join(" ; ");
  }
  if (reason === "no act hint") return t("no act hint");
  let m = /^hinted at act (\d+), (due|ahead)$/.exec(reason);
  if (m) {
    return m[2] === "due"
      ? t("hinted at act {act}, due", { act: m[1] })
      : t("hinted at act {act}, ahead", { act: m[1] });
  }
  m = /^matches the scene \((.+)\)$/.exec(reason);
  if (m) return t("matches the scene ({terms})", { terms: m[1] });
  m = /^held back: (.+)$/.exec(reason);
  if (m) return t("held back ({reason})", { reason: translateArcReason(t, m[1]) });
  m = /^(\d+) events already shown(?:, though it matches the scene \((.+)\))?$/.exec(reason);
  if (m) {
    const base = t("{count} events already shown", { count: m[1] });
    return m[2] ? `${base}, ${t("though it matches the scene ({terms})", { terms: m[2] })}` : base;
  }
  m = /^over the (\d+)-character event budget(?:, though it matches the scene \((.+)\))?$/.exec(reason);
  if (m) {
    const base = t("over the {budget}-character event budget", { budget: m[1] });
    return m[2] ? `${base}, ${t("though it matches the scene ({terms})", { terms: m[2] })}` : base;
  }
  return reason;
}

export function ContextPanel({ campaignId }: { campaignId: string }) {
  const [trace, setTrace] = useState<ContextTrace | null>(null);
  const [at, setAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const t = useT();

  // Every state write happens after the await, never synchronously while the
  // effect is running. `reload` is a counter rather than a direct call so the
  // refresh button re-runs the same effect instead of duplicating its logic.
  const [reload, setReload] = useState(0);
  const load = useCallback(() => setReload((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/context-trace`);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(response.status === 403 ? t("Party lead only.") : t("Could not load the context."));
          setLoading(false);
          return;
        }
        const data = (await response.json()) as { trace: ContextTrace | null; at?: string };
        if (cancelled) {
          return;
        }
        setError("");
        setTrace(data.trace);
        setAt(data.at ?? "");
      } catch {
        if (!cancelled) {
          setError(t("Could not load the context."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload, t]);

  const pct = trace ? Math.min(100, Math.round((trace.promptTokens / trace.limitTokens) * 100)) : 0;
  const over = trace ? trace.promptTokens > trace.limitTokens : false;

  return (
    <div className="space-y-3 p-3">
      <SectionHead
        title={t("What the GM was sent")}
        glyph="tab-context"
        aside={
          <button type="button" onClick={load} className={cn(ui.iconAction, "pk-tap pk-always -my-1 inline-flex items-center justify-center")} aria-label={t("Refresh", { context: "table.context.refresh" })}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        }
      />
      <p className="-mt-1 text-xs text-stone-500">
        {t("Last turn{at}. Token counts are estimates.", { at: at ? `, ${new Date(at).toLocaleTimeString()}` : "" })}
      </p>

      {error ? <p className="motion-shake text-xs text-red-400">{error}</p> : null}

      {!error && !loading && !trace ? (
        <EmptyState size="sm" art="scrolls" title={t("No turn has been taken yet. Play a round and this will show every block the GM received, what it cost, and anything the budget cut.")} />
      ) : null}

      {trace ? (
        <>
          <div>
            <div className="mb-1 flex justify-between font-code text-[11px] text-stone-400">
              <span>
                {trace.promptTokens.toLocaleString()} / {trace.limitTokens.toLocaleString()} {t("tokens")}
              </span>
              <span className={over ? "text-red-400" : "text-stone-500"}>{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
              <div
                className={cn("bar-ease h-full rounded-full", over ? "bg-red-500" : "bg-amber-500/70")}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </div>

          {trace.tuning?.length ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="tuning-trace">
              <span className="whitespace-nowrap font-medium text-amber-200">{t("Fitted to this model")}</span>
              <ul className="mt-1 space-y-0.5">
                {trace.tuning.map((line) => (
                  <li key={line} className="text-[11px] text-stone-400">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trace.profile && trace.profile.name !== "full" ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="profile-trace">
              <span className="whitespace-nowrap font-medium text-amber-200">
                {trace.profile.name === "compact" ? t("Compact tool set") : t("Trimmed tool set")}
              </span>
              {trace.profile.name === "compact" ? (
                <p className="mt-0.5 text-[11px] text-stone-400">
                  {t("Groups offered: {groups}", {
                    groups: trace.profile.groups?.length ? trace.profile.groups.join(", ") : t("the core only"),
                  })}
                  {trace.profile.opened?.length ? t("; opened during the turn: {groups}", { groups: trace.profile.opened.join(", ") }) : ""}
                  {t(". The rest are one more_tools call away.")}
                </p>
              ) : null}
            </div>
          ) : null}

          {trace.calls?.length ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="calls-trace">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="whitespace-nowrap font-medium text-amber-200">{t("Calls")}</span>
                {trace.prefix ? (
                  <span className="shrink-0 font-code text-[11px] text-stone-400" title={t("How much of this turn's prompt matched the last turn's from its start: the most a prompt cache could reuse.")}>
                    {t("{shared}/{prompt} shared with the last turn", {
                      shared: trace.prefix.sharedTokens.toLocaleString(),
                      prompt: trace.prefix.promptTokens.toLocaleString(),
                    })}
                  </span>
                ) : null}
              </div>
              <ul className="mt-1 space-y-0.5">
                {trace.calls.map((call, index) => (
                  <li key={`${index}-${call.task}`} className={cn("text-[11px]", call.error ? "text-red-300/90" : "text-stone-400")}>
                    <span className="font-code text-stone-500">{t(call.task)}</span>{" "}
                    {call.windowTokens
                      ? call.windowAssumed
                        ? t("about {sent} sent past an assumed {window} window (the endpoint reports none), reply uncapped", {
                            sent: call.promptTokens.toLocaleString(),
                            window: call.windowTokens.toLocaleString(),
                          })
                        : t("{sent}/{window} sent", {
                            sent: call.promptTokens.toLocaleString(),
                            window: call.windowTokens.toLocaleString(),
                          })
                      : t("sent unmeasured")}
                    {call.toolCount ? t(", {count} tools", { count: call.toolCount }) : ""}
                    {call.windowTokens && !call.windowAssumed ? t(", reply up to {count}", { count: call.outputTokens.toLocaleString() }) : ""}
                    {call.reportedInputTokens !== undefined ? t("; backend counted {count} in", { count: call.reportedInputTokens.toLocaleString() }) : ""}
                    {call.cachedInputTokens !== undefined ? t(" ({count} cached)", { count: call.cachedInputTokens.toLocaleString() }) : ""}
                    {call.outputTokensUsed !== undefined ? t(", {count} out", { count: call.outputTokensUsed.toLocaleString() }) : ""}
                    {call.reasoningTokens !== undefined ? t(" ({count} reasoning)", { count: call.reasoningTokens.toLocaleString() }) : ""}
                    {call.durationMs !== undefined ? `, ${(call.durationMs / 1000).toFixed(1)}s` : ""}
                    {call.firstTokenMs !== undefined ? t(" (first words {seconds}s)", { seconds: (call.firstTokenMs / 1000).toFixed(1) }) : ""}
                    {call.dropped || call.clipped ? t("; fitted: {dropped} older line(s) left out, {clipped} cut short", { dropped: call.dropped, clipped: call.clipped }) : ""}
                    {call.finishReason && call.finishReason !== "stop" && call.finishReason !== "tool_calls" ? t("; ended: {reason}", { reason: call.finishReason }) : ""}
                    {call.error ? t("; failed: {reason}", { reason: call.error }) : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trace.houseRules ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="house-rules-trace">
              <span className="whitespace-nowrap font-medium text-amber-200">{t("House rules", { context: "table.rules.house" })}</span>
              <p className="mt-0.5 text-[11px] text-stone-400">
                {trace.houseRules.shown.length ? t("Shown: {list}.", { list: trace.houseRules.shown.join("; ") }) : t("None shown.")}
              </p>
              {trace.houseRules.omitted.length ? (
                <p className="mt-0.5 text-[11px] text-red-300/90">{t("Left out for room (named to the GM): {list}.", { list: trace.houseRules.omitted.join("; ") })}</p>
              ) : null}
            </div>
          ) : null}

          {trace.arc ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="arc-trace">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="whitespace-nowrap font-medium text-amber-200">{t("Story arc")}</span>
                <span className="shrink-0 font-code text-[11px] text-stone-400">
                  {t("{shown}/{total} beats, {chars}/{budget} event chars", {
                    shown: trace.arc.beats.shown,
                    total: trace.arc.beats.total,
                    chars: trace.arc.chars.toLocaleString(),
                    budget: trace.arc.budgetChars.toLocaleString(),
                  })}
                </span>
              </div>
              {trace.arc.events.length ? (
                <ul className="mt-1 space-y-0.5">
                  {trace.arc.events.map((pick) => (
                    <li key={pick.id} className={cn("text-[11px]", pick.included ? "text-stone-400" : "text-red-300/90")}>
                      <span className="font-code text-stone-500">{pick.id}</span> {pick.name}
                      <span className="text-stone-500">: {translateArcReason(t, pick.reason)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-[11px] text-stone-500">{t("No planned events pending.")}</p>
              )}
            </div>
          ) : null}

          {trace.lore ? (
            <div className="panel rounded-lg px-2.5 py-1.5 text-xs" data-testid="lore-trace">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="whitespace-nowrap font-medium text-amber-200">{t("World lore")}</span>
                <span className="shrink-0 font-code text-[11px] text-stone-400">
                  {t("{kept}/{total} entries, {chars}/{budget} chars", {
                    kept: trace.lore.picks.filter((pick) => pick.included).length,
                    total: trace.lore.picks.filter((pick) => !pick.weak).length,
                    chars: trace.lore.chars.toLocaleString(),
                    budget: trace.lore.budgetChars.toLocaleString(),
                  })}
                </span>
              </div>
              {trace.lore.picks.length ? (
                <ul className="mt-1 space-y-0.5">
                  {trace.lore.picks.map((pick) => (
                    <li
                      key={pick.id}
                      title={pick.id}
                      data-lore-pick={pick.included ? "kept" : pick.weak ? "near" : "held"}
                      className={cn("text-[11px]", pick.included ? "text-stone-400" : pick.weak ? "text-stone-500" : "text-red-300/90")}
                    >
                      {pick.title}
                      {pick.secret ? <span className="text-ember-300">{t(" (secret)")}</span> : null}
                      <span className="text-stone-500">: {pick.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-[11px] text-stone-500">{t("No entry matched this moment.")}</p>
              )}
            </div>
          ) : null}

          <ul className="stagger space-y-1">
            {trace.blocks.map((block) => (
              <li
                key={`${block.position}-${block.id}`}
                className={cn(
                  "panel rounded-lg px-2.5 py-1.5 text-xs",
                  !block.included && "border-red-900/50 bg-red-950/20",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("font-medium", KIND_COLOR[block.kind])}>
                    {t(KIND_KEY[block.kind])}
                    <span className="ml-1 font-normal text-stone-500">{block.id}</span>
                  </span>
                  <span className="shrink-0 font-code text-[11px] text-stone-400">
                    {block.tokens.toLocaleString()}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-[11px]",
                    block.included ? "text-stone-500" : "text-red-300",
                  )}
                >
                  {block.included ? translateBlockReason(t, block.reason) : t("dropped: {reason}", { reason: translateBlockReason(t, block.reason) })}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
