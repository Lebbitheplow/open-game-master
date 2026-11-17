"use client";

import { LoadFailed } from "@/app/campaigns/[campaignId]/PanelKit";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import { BrushCleaning, Check, HardDrive, Loader2, Minimize2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { useT, useTp } from "@/lib/locale";

// What the server keeps and what it weighs (src/lib/ops/retention.ts). The
// story stays forever; once a day the server clears what nothing reads back
// and hands the space to the disk. Files no row names are only listed here,
// for the admin to remove.
type Report = {
  at: string;
  eventsRemoved: number;
  tracesCleared: number;
  usageRowsMerged: number;
  bytesReclaimed: number;
};

type Stats = {
  databaseBytes: number;
  freePageBytes: number;
  incremental: boolean;
  diskFreeBytes: number;
  eventRows: number;
  usageRows: number;
  traceBytes: number;
  running: boolean;
  report: Report | null;
  nextAt: string | null;
};

type Orphans = { pictures: number; audio: number; bytes: number; sample: string[] };

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024))} KB`;
}

// "{value} live updates", keyed by noun so the table's language speaks:
// count(t, 3, "admin.storage.liveUpdate"). The key is a plural base
// (…_one/…_other), which translate() resolves at run time.
const count = (t: (key: string, vars?: Record<string, string | number>) => string, value: number, key: string) =>
  t(key, { count: value });

export function AdminStorageSection() {
  const t = useT();
  const tp = useTp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [orphans, setOrphans] = useState<Orphans | null>(null);
  const { loadError, settle } = useLoadStatus();
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState<"" | "tidy" | "compact" | "remove-orphans">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    readLoad<{ stats?: Stats; orphans?: Orphans }>(t, fetch("/api/admin/storage"), t("Storage", { context: "load.label.storage" })).then((outcome) => {
      settle(outcome);
      if (outcome.payload) {
        setStats(outcome.payload.stats ?? null);
        setOrphans(outcome.payload.orphans ?? null);
      }
    });
  }, [ reloads, settle, t ]);
  async function act(action: "tidy" | "compact" | "remove-orphans") {
    setBusy(action);
    setError("");
    setDone("");
    try {
      const response = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || t("The server could not do that."));
        return;
      }
      if (data.stats) setStats(data.stats);
      if (data.orphans) setOrphans(data.orphans);
      if (action === "compact" && data.compacted) {
        setDone(t("Compacted: {before} to {after}.", { before: formatSize(data.compacted.before), after: formatSize(data.compacted.after) }));
      } else if (action === "remove-orphans" && data.removed) {
        setDone(tp("Removed {count} file, {size}.", "Removed {count} files, {size}.", { count: data.removed.removed, size: formatSize(data.removed.bytes) }));
      } else if (action === "tidy") {
        setDone(t("Tidied."));
      }
    } catch {
      setError(t("Could not reach the server.", { context: "admin.worlds.unreachable" }));
    } finally {
      setBusy("");
    }
  }

  async function compact() {
    const sure = await appConfirm(t("Compact the database? It is rewritten without its free space, and play pauses while that runs: a second or two for most servers. Afterwards the daily tidy hands freed space back by itself."), {
      title: t("Compact the database?"),
      actionLabel: t("Compact"),
    });
    if (sure) await act("compact");
  }

  async function removeOrphans() {
    if (!orphans) return;
    const sure = await appConfirm(
      t("Remove {count} ({size}) that no campaign, account or setting names? A backup taken before now still holds them.", { count: orphans.pictures + orphans.audio, size: formatSize(orphans.bytes) }),
      { title: t("Remove unused files?"), actionLabel: t("Remove", { context: "action.remove" }), tone: "danger" },
    );
    if (sure) await act("remove-orphans");
  }

  if (stats === null && loadError) {
    return <LoadFailed error={loadError} onRetry={() => setReloads((current) => current + 1)} />;
  }

  if (stats === null) {
    return <div className="skeleton-block mt-3 h-16 rounded-xl" aria-label={t("Loading storage")} />;
  }

  const report = stats.report;
  const orphanCount = orphans ? orphans.pictures + orphans.audio : 0;
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        {t("The story is kept forever: every message, roll, note, sheet, chapter snapshot and GM conversation. Once a day the server clears what nothing reads back (live updates older than a reconnecting page replays, prompt traces past a week, usage rows past 90 days merged by month with the same totals) and hands the space to the disk.")}
      </p>
      <ul className="stagger space-y-2">
        <li className="plate-row flex-wrap gap-2">
          <HardDrive className="size-4 text-stone-400" />
          <span className="text-sm text-stone-300">{t("Database")}</span>
          <span className="text-xs tabular-nums text-stone-500">{formatSize(stats.databaseBytes)}</span>
          {stats.freePageBytes > 0 ? (
            <span className="text-xs tabular-nums text-stone-500">{t("{size} free inside", { size: formatSize(stats.freePageBytes) })}</span>
          ) : null}
          <span className={cn("text-xs", stats.incremental ? "text-emerald-400" : "text-amber-300")}>
            {stats.incremental ? t("returns space daily") : t("compact once to return space daily")}
          </span>
          {stats.diskFreeBytes >= 0 ? (
            <span className="ml-auto text-xs tabular-nums text-stone-500">{t("{size} free on disk", { size: formatSize(stats.diskFreeBytes) })}</span>
          ) : null}
        </li>
        <li className="plate-row flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-stone-500">
          <span>{count(t, stats.eventRows, "admin.storage.liveUpdate")}</span>
          <span>{count(t, stats.usageRows, "admin.storage.usageRow")}</span>
          <span>{t("{size} of prompt traces", { size: formatSize(stats.traceBytes) })}</span>
        </li>
        <li className="plate-row flex-wrap gap-2 text-xs text-stone-500">
          {stats.running || busy === "tidy" ? (
            <span className="live-in inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> {t("Tidying…")}
            </span>
          ) : report ? (
            <span key={report.at} className="live-in">
              {t("Last tidy {date}: {events} cleared, {traces} dropped, {merged} merged, {space} returned.", {
                date: new Date(report.at).toLocaleString(),
                events: count(t, report.eventsRemoved, "admin.storage.update"),
                traces: count(t, report.tracesCleared, "admin.storage.trace"),
                merged: count(t, report.usageRowsMerged, "admin.storage.usageRow"),
                space: formatSize(report.bytesReclaimed),
              })}
            </span>
          ) : (
            <span>{t("No tidy since the server started{next}.", { next: stats.nextAt ? t("; the first runs at {time}", { time: new Date(stats.nextAt).toLocaleTimeString() }) : "" })}</span>
          )}
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => act("tidy")} disabled={Boolean(busy) || stats.running} aria-busy={busy === "tidy"} className={ui.btnSmall}>
          {busy === "tidy" ? <Loader2 className="size-4 animate-spin" /> : <BrushCleaning className="size-4" />}
          {t("Tidy now")}
        </button>
        <button type="button" onClick={compact} disabled={Boolean(busy) || stats.running} aria-busy={busy === "compact"} className={ui.btnSmall}>
          {busy === "compact" ? <Loader2 className="size-4 animate-spin" /> : <Minimize2 className="size-4" />}
          {t("Compact database")}
        </button>
        {done ? (
          <span key={done} role="status" className="live-in inline-flex items-center gap-1 text-xs text-emerald-400">
            <Check className="size-3.5" /> {done}
          </span>
        ) : null}
      </div>
      {error ? <p role="alert" className="motion-shake text-sm text-red-400">{error}</p> : null}
      {orphans ? (
        orphanCount > 0 ? (
          <div className="live-in space-y-2">
            <div className="plate-row flex-wrap gap-2">
              <span className="text-sm text-stone-300">
                {tp("{count} file no campaign, account or setting names", "{count} files no campaign, account or setting names", { count: orphanCount })}
              </span>
              <span className="text-xs tabular-nums text-stone-500">{formatSize(orphans.bytes)}</span>
              <button
                type="button"
                onClick={removeOrphans}
                disabled={Boolean(busy)}
                aria-busy={busy === "remove-orphans"}
                className={cn(ui.btnSmall, "ml-auto hover:border-red-500/50 hover:text-red-400")}
              >
                {busy === "remove-orphans" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {t("Remove", { context: "action.remove" })}
              </button>
            </div>
            <ul className="stagger space-y-1 pl-1">
              {orphans.sample.map((url) => (
                <li key={url} className="truncate font-code text-[11px] text-stone-600" title={url}>
                  {url}
                </li>
              ))}
              {orphanCount > orphans.sample.length ? (
                <li className="text-[11px] text-stone-600">{t("{count} more", { count: orphanCount - orphans.sample.length })}</li>
              ) : null}
            </ul>
          </div>
        ) : (
          <p className="live-in text-xs text-stone-500">{t("Every stored picture, document and narration clip is still in use.")}</p>
        )
      ) : null}
    </div>
  );
}
