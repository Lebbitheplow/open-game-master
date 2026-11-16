"use client";

import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SectionHead } from "@/components/ui/SectionHead";
import { downloadBlob } from "@/lib/download";
import type { NarratorQualityOverview } from "@/lib/narrator-quality-server";
import type { QualityGroup } from "@/lib/narrator-quality";
import type { DmMode } from "@/lib/dm/viewer";
import { ui } from "@/lib/ui";
import { useT } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

// Admin > Usage > Narrator quality (issue #460): how the AI's turns ended
// and what tables had to fix, one row per backend class and DM mode. Rates
// are only compared within a row: the people who send these lean towards
// those who know the rules, and a table that trusts the AI looks cleaner
// than it is. The export is read before a beta is promoted to stable
// (docs/releases.md).


const BACKEND_KEYS: Record<QualityGroup["backendClass"], MessageKey> = {
  local: "Local backend",
  api: "Hosted API",
  agent: "Agent program",
  unknown: "Not known",
};

const MODE_KEYS: Record<DmMode, MessageKey> = {
  ai: "AI GM",
  steered: "Steered",
  human: "Human GM",
  assisted: "Assisted",
};

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

function count(value: number): string {
  return value ? String(value) : "–";
}

function exportName(now = new Date()): string {
  return `odm-narrator-quality-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
}

export function AdminNarratorQualityCard() {
  const t = useT();
  const [overview, setOverview] = useState<NarratorQualityOverview | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/narrator-quality")
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as (NarratorQualityOverview & { error?: string }) | null;
        if (cancelled) return;
        if (!response.ok || !data) {
          setError(data?.error || t("Could not load narrator quality."));
          return;
        }
        setOverview(data);
      })
      .catch(() => {
        if (!cancelled) setError(t("Could not reach this server."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const exportRows = async () => {
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/narrator-quality?export=1");
      if (!response.ok) {
        setError(t("Could not export narrator quality."));
        return;
      }
      const text = `${JSON.stringify(await response.json(), null, 2)}\n`;
      downloadBlob(exportName(), new Blob([text], { type: "application/json" }));
    } catch {
      setError(t("Could not reach this server."));
    } finally {
      setExporting(false);
    }
  };

  const groups = overview?.groups ?? [];

  return (
    <section className="panel texture-noise rounded-xl p-5" data-narrator-quality="">
      <SectionHead
        level="h2"
        title={t("Narrator quality")}
        glyph="tab-context"
        aside={<span className="count-pop tabular-nums">{overview?.turns ?? 0}</span>}
      />
      <p className="mb-3 text-xs text-stone-400">
        {t("How the AI's turns ended and what tables fixed, one row per kind of backend and GM mode. Compare rates within a row, never across: it counts only the mistakes someone noticed.")}
      </p>
      {error ? <p role="alert" className="mb-2 text-sm text-red-400">{error}</p> : null}
      {overview && !groups.length ? (
        <p className="text-sm text-stone-400" data-narrator-quality-empty="">
          {t("No AI turn has ended since this server began keeping these.")}
        </p>
      ) : null}
      {groups.length ? (
        // One block per backend and DM mode, its figures in a grid that
        // wraps: a twelve-column table only scrolled sideways on a phone.
        <ul className="space-y-3">
          {groups.map((group) => {
            const figures: Array<{ label: string; value: string; hint?: string; clean?: boolean }> = [
              { label: t("Turns"), value: String(group.turns) },
              { label: t("Clean"), value: percent(group.clean, group.turns), clean: true },
              { label: t("Failed", { context: "admin.quality.failed" }), value: count(group.failed) },
              { label: t("Tool refused"), value: count(group.refused) },
              { label: t("Hit a cap"), value: count(group.capped) },
              { label: t("Guard acted"), value: count(group.guardFired) },
              { label: t("Not checked"), value: count(group.unchecked), hint: t("The prose reader failed, or the table turned the outcome check off") },
              { label: t("Corrected"), value: group.correctionsCounted ? percent(group.corrected, group.turns) : t("not counted") },
              { label: t("Rewound"), value: count(group.rolledBack) },
            ];
            return (
              <li
                key={`${group.backendClass}:${group.dmMode}`}
                className="rounded-lg border border-stone-700/50 bg-stone-950/30 p-3"
                data-quality-group={`${group.backendClass}:${group.dmMode}`}
              >
                <p className="mb-2 text-sm text-stone-100">
                  {t(BACKEND_KEYS[group.backendClass])}
                  <span className="text-stone-500"> &middot; </span>
                  <span className="text-stone-300">{t(MODE_KEYS[group.dmMode])}</span>
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-5">
                  {figures.map((figure) => (
                    <div key={figure.label} className="flex items-baseline justify-between gap-2 sm:block" title={figure.hint}>
                      <dt className="text-[11px] uppercase tracking-wide text-stone-500">{figure.label}</dt>
                      <dd className="tabular-nums text-stone-200" {...(figure.clean ? { "data-quality-clean": "" } : {})}>
                        {figure.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-stone-400">
                  <span className="text-[11px] uppercase tracking-wide text-stone-500">{t("Most corrected ")}</span>
                  <span className="text-stone-200" data-quality-tools="">
                    {group.tools.length
                      ? group.tools.map((tool) => `${tool.tool.replaceAll("_", " ")} (${tool.corrections})`).join(", ")
                      : t("none", { context: "admin.quality.none" })}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="mt-2 text-[11px] text-stone-500">
        {overview?.rule ?? ""}
        {t(" Corrected and the tools leave out fixes marked “changed my mind”. At a table a person runs, fixes are running the table and are not counted.")}
        {overview?.earlierCorrections ? t(" {count} fixes belong to turns that ended before this was kept.", { count: overview.earlierCorrections }) : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={ui.btnSmall} onClick={exportRows} disabled={exporting} data-narrator-quality-export="">
          {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} {t("Export narrator quality")}
        </button>
        <span className="text-[11px] text-stone-500">
          {t("One file of these rows, with every id hashed and no names, prompts or story text. Saved here, never sent.")}
        </span>
      </div>
    </section>
  );
}
