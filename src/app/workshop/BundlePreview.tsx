"use client";

import { Check, Loader2 } from "lucide-react";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { chip, chipOn, chipRow } from "@/app/workshop/kit";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { BUNDLE_KIND_LABELS, type BundleDependency } from "@/lib/workshop/bundle";
import { useT } from "@/lib/locale";
import type { MessageVars } from "@/lib/messages-logic";
import { pluralOf } from "@/lib/messages-logic";

// What a bundle holds, shown before it becomes a workshop: the card both a
// bundle file (ImportBundleButton) and an addon's import (AddonImportButton)
// end on, so a rulebook an addon read is agreed to the same way as a file a
// friend sent.
//
// The ticks say what an untick costs: a card that picks an NPC loses that
// pick when the NPCs stay behind, and the preview says so for whatever is
// ticked right now (#158). A chapter bundle offers to link its shared
// records to the importer's own copy of the shared workshop (#159).

export type SharedHome = { id: string; title: string; found: number; total: number };

export type BundlePreviewData = {
  manifest: { name: string; blurb: string; author: string; inspiredBy: string; rightsHolder: string };
  counts: Record<string, number>;
  houseRules?: boolean;
  plugin?: boolean;
  overworld?: boolean;
  dependencies?: BundleDependency[];
  dependsOn?: { name: string } | null;
  sharedHomes?: SharedHome[];
  warnings: string[];
};

// The kinds a preview offers, in the order the counts came: every kind with
// something in it, then the house rules, the region map and the world pack
// draft when the bundle carries them.
export function kindsOf(preview: BundlePreviewData): string[] {
  const kinds = Object.entries(preview.counts)
    .filter(([, count]) => count > 0)
    .map(([kind]) => kind);
  return [
    ...kinds,
    ...(preview.houseRules ? ["rules"] : []),
    ...(preview.overworld ? ["overworld"] : []),
    ...(preview.plugin ? ["plugin"] : []),
  ];
}

// What the current ticks drop: every link from a ticked kind into an
// unticked one.
function droppedLinks(preview: BundlePreviewData, kinds: string[], t: (key: string, vars?: MessageVars) => string): string[] {
  const tp = pluralOf(t);
  return (preview.dependencies ?? [])
    .filter((dependency) => kinds.includes(dependency.from) && !kinds.includes(dependency.to))
    .map((dependency) =>
      // A name leans on a monster or a Homebrew entry: left behind, it names
      // the importer's own of that name, or nothing (workshop/bundle.ts).
      dependency.to === "monsters" || dependency.to === "homebrew"
        ? t("{from}: {count} name {to} from this bundle. Left behind, they name your own of that name, or nothing.", {
            from: BUNDLE_KIND_LABELS[dependency.from] ?? dependency.from,
            count: dependency.count,
            to: BUNDLE_KIND_LABELS[dependency.to] ?? dependency.to,
          })
        : tp("{count} link from {from} to {to} is dropped while those stay behind.", "{count} links from {from} to {to} are dropped while those stay behind.", {
            count: dependency.count,
            from: BUNDLE_KIND_LABELS[dependency.from] ?? dependency.from,
            to: BUNDLE_KIND_LABELS[dependency.to] ?? dependency.to,
          }),
    );
}

export function BundlePreview({
  preview,
  kinds,
  onKinds,
  sharedWorkshopId,
  onSharedWorkshopId,
  busy,
  onConfirm,
  onCancel,
  notes = [],
}: {
  preview: BundlePreviewData;
  kinds: string[];
  onKinds: (kinds: string[]) => void;
  sharedWorkshopId: string;
  onSharedWorkshopId: (id: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // What the addon that made the bundle wants the DM to know.
  notes?: string[];
}) {
  const offered = kindsOf(preview);
  const t = useT();
  const dropped = droppedLinks(preview, kinds, t);
  return (
    <div className={`${ui.card} reveal mt-3 p-4`}>
      <SectionHead title={preview.manifest.name} glyph="system-share" />
      <p className="text-sm text-stone-400">{preview.manifest.blurb}</p>
      {preview.manifest.author ? <p className="reveal mt-0.5 text-xs text-stone-500">{t("by {name}", { name: preview.manifest.author, context: "workshop.bundle.by" })}</p> : null}

      {/* Each kind is a tick: a DM who only wants the monsters takes the
          monsters. Unticking every one leaves an empty workshop, which the
          button below says out loud. */}
      <ul className={cn("stagger mt-3", chipRow)}>
        {offered.map((kind) => {
          const ticked = kinds.includes(kind);
          return (
            <li key={kind}>
              <button
                type="button"
                role="checkbox"
                aria-checked={ticked}
                onClick={() => onKinds(ticked ? kinds.filter((entry) => entry !== kind) : [...kinds, kind])}
                className={cn(ui.btnSmall, chip, "rounded-full normal-case", ticked ? chipOn : "text-stone-500")}
              >
                <Check className={cn("size-3.5", ticked ? "text-amber-300" : "opacity-20")} aria-hidden="true" />
                {preview.counts[kind] === undefined ? "" : `${preview.counts[kind]} `}
                {BUNDLE_KIND_LABELS[kind] ?? kind}
              </button>
            </li>
          );
        })}
      </ul>

      {dropped.length ? (
        <ul className="stagger mt-2 space-y-1">
          {dropped.map((line) => (
            <li key={line} className="reveal text-xs text-amber-300/90">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {preview.dependsOn ? (
        <div className="reveal mt-3">
          {preview.sharedHomes?.length ? (
            <>
              <p className="mb-1 text-xs text-stone-400">{t("The records its cards pick from \"{name}\":", { name: preview.dependsOn.name })}</p>
              <Select
                label={t("Shared records")}
                value={sharedWorkshopId}
                onChange={onSharedWorkshopId}
                options={[
                  ...preview.sharedHomes.map((home) => ({
                    value: home.id,
                    label: t("Link to my \"{title}\"", { title: home.title }),
                    hint: t("{found} of {total} found there; the rest land here.", { found: home.found, total: home.total }),
                  })),
                  { value: "", label: t("Bring them in as this workshop's own") },
                ]}
              />
            </>
          ) : (
            <p className="text-xs text-stone-400">
              {t("Its records from \"{name}\" land as this workshop's own. Import that workshop's bundle first to link them to it instead.", { name: preview.dependsOn.name })}
            </p>
          )}
        </div>
      ) : null}

      <UnofficialPackNotice rightsHolder={preview.manifest.rightsHolder} inspiredBy={preview.manifest.inspiredBy} className="mt-3" />

      {[...notes, ...preview.warnings].length ? (
        <ul className="stagger mt-3 space-y-1">
          {[...notes, ...preview.warnings].map((warning) => (
            <li key={warning} className="text-xs text-amber-200/80">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-xs text-stone-500">
        {t("This creates a new workshop of your own. Nothing is written into any campaign you already have.")}
      </p>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onConfirm} disabled={busy} className={ui.btnPrimary}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
          {kinds.length === 0
            ? t("Import an empty workshop")
            : kinds.length === offered.length
              ? t("Import it")
              : t("Import {count} of {total} kinds", { count: kinds.length, total: offered.length })}
        </button>
        <button type="button" onClick={onCancel} className={ui.btnSecondary}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
