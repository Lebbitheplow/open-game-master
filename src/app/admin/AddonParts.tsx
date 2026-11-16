"use client";

import { Switch } from "@/components/ui/Switch";
import type { AddonCredit } from "@/lib/addons/credits";
import { modifiesLabel, type AddonModifies } from "@/lib/addons/manifest-parts";
import { cn } from "@/lib/cn";

// Pieces of Admin > Addons shared by the downloader list and an installed
// addon's card: who made it (credited with links to their GitHub), what it
// changes in the app, and the picker for its parts.
//
// The parts picker is the one new control here. Without it, an addon that
// ships a library per campaign setting (3D models and sounds for high
// fantasy, dark fantasy, sci-fi) would download every setting's gigabytes on
// every server, whichever setting its tables play. Its default is what the
// author marked (the core setting), so most admins never touch it; it shows
// only for an addon that has parts, and is changed later on the addon's card.

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function CreditLine({ credit, className }: { credit: AddonCredit | undefined; className?: string }) {
  if (!credit || (!credit.author && !credit.repo)) return null;
  const owner = credit.repo.split("/")[0];
  return (
    <p className={cn("text-[11px] leading-4 text-stone-500", className)}>
      {credit.author ? <>by {credit.author}</> : null}
      {owner ? (
        <>
          {credit.author ? " (" : "by "}
          <a href={credit.profile} target="_blank" rel="noreferrer" className="text-amber-200/80 hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-300">
            @{owner}
          </a>
          {credit.author ? ")" : ""}
          {" · "}
          <a href={credit.url} target="_blank" rel="noreferrer" className="text-amber-200/80 hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-300">
            {credit.repo}
          </a>
        </>
      ) : credit.url ? (
        <>
          {" · "}
          <a href={credit.url} target="_blank" rel="noreferrer" className="text-amber-200/80 hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-300">
            Its page
          </a>
        </>
      ) : null}
      {credit.also.length ? (
        <>
          {" · parts from "}
          {credit.also.map((repo, index) => (
            <span key={repo}>
              {index ? ", " : ""}
              <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" className="text-amber-200/80 hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-300">
                {repo}
              </a>
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

export function ModifiesLine({ modifies, className }: { modifies: AddonModifies[] | undefined; className?: string }) {
  if (!modifies?.length) return null;
  return (
    <p className={cn("text-[11px] leading-4 text-stone-500", className)}>
      Changes:{" "}
      {modifies.map((entry) => `${modifiesLabel(entry.what)} (${entry.how === "replace" ? "replaces them" : "adds to them"})`).join("; ")}.
    </p>
  );
}

export type PickablePart = {
  id: string;
  title: string;
  description: string;
  bytes: number;
  available?: boolean;
  reason?: string;
};

export function PartsPicker({
  idPrefix,
  parts,
  chosen,
  onChange,
  disabled = false,
  upTo = false,
}: {
  idPrefix: string;
  parts: PickablePart[];
  chosen: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  // Sizes from the list, before install: the most a part can take.
  upTo?: boolean;
}) {
  if (!parts.length) return null;
  const picked = parts.filter((part) => chosen.includes(part.id));
  const total = picked.reduce((sum, part) => sum + part.bytes, 0);
  return (
    <fieldset className="mt-2 rounded-lg border border-stone-800/80 bg-stone-950/40 p-2.5">
      <legend className="px-1 text-[11px] text-stone-300">Parts to download</legend>
      <p className="text-[11px] leading-4 text-stone-500">
        Each part downloads on its own: pick the ones your tables play. You can change this later on its card.
      </p>
      <ul className="mt-1.5 divide-y divide-stone-800/70">
        {parts.map((part) => {
          const on = chosen.includes(part.id);
          const unavailable = part.available === false;
          const labelId = `${idPrefix}-part-${part.id}`;
          return (
            <li key={part.id} className="flex min-h-10 items-center justify-between gap-3 py-1.5">
              <span id={labelId} className={cn("min-w-0 text-xs", unavailable ? "text-stone-500" : "text-stone-200")}>
                {part.title}
                <span className="ml-1.5 text-[10px] text-stone-500 tabular-nums">
                  {part.bytes ? `${upTo ? "up to " : ""}${formatBytes(part.bytes)}` : ""}
                </span>
                {part.description ? <span className="block text-[11px] leading-4 text-stone-500">{part.description}</span> : null}
                {unavailable && part.reason ? <span className="block text-[11px] leading-4 text-amber-300/90">{part.reason}</span> : null}
              </span>
              <Switch
                on={on && !unavailable}
                onChange={(next) => onChange(next ? [...chosen, part.id] : chosen.filter((id) => id !== part.id))}
                label={`Download ${part.title}`}
                disabled={disabled || unavailable}
              />
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-stone-500" role="status">
        {picked.length
          ? `${picked.length} of ${parts.length} chosen, ${upTo ? "up to " : "about "}${formatBytes(total)}.`
          : `None of its ${parts.length} parts chosen.`}
      </p>
    </fieldset>
  );
}
