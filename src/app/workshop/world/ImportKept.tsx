"use client";

import { useRef, useState } from "react";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { describeValue } from "@/lib/worldforge/entry-merge";
import type { KeptImport } from "@/lib/worldforge/import-kept";
import { useT } from "@/lib/locale";
import type { MessageVars } from "@/lib/messages-logic";

// What a reimport kept as this campaign has it, on the entry's page
// (src/lib/worldforge/import-kept.ts). The same amber notice as an entry
// form's clash with another author (EntityEditor, #348), one line per
// value: the import's version shown whole, and the two ways out. Once the
// import's version is in use, the line says so and offers yours back.
// Only the DM reads the World, so players never see it.

type Choice = "use" | "restore" | "dismiss";

// A value as the reader reads it: a long text whole, in its own box; a
// type, a folder or links by the names the server gave them (`said`).
export function KeptValueText({ value, said }: { value: unknown; said?: string }) {
  if (said !== undefined) return <span className="text-stone-200">{said}</span>;
  if (typeof value === "string" && value.length > 60) {
    return <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-amber-800/40 bg-stone-950/50 px-2.5 py-1.5 text-xs leading-5 text-stone-200">{value}</blockquote>;
  }
  return <span className="text-stone-200">{describeValue(value)}</span>;
}

// What a choice did, in words, for the polite announcement.
function saidAfter(label: string, choice: Choice, now: KeptImport | undefined, t: (key: string, vars?: MessageVars) => string): string {
  if (choice === "dismiss") return t("{label}: the notice is gone; the entry stays as it is.", { label });
  if (choice === "restore") return t("{label}: this campaign's version is back.", { label });
  if (now?.landed === "not") return t("{label}: the import's version could not be written here. Nothing changed.", { label });
  if (now?.landed === "partly") return t("{label}: the import's version is in use, as far as this entry could take it.", { label });
  return t("{label}: the import's version is in use. Restore mine brings this campaign's back.", { label });
}

export function ImportKept({
  kept,
  onChoose,
}: {
  kept: KeptImport[];
  onChoose: (key: string, choice: Choice) => Promise<{ kept?: KeptImport[] } | null>;
}) {
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState("");
  const t = useT();
  const sectionRef = useRef<HTMLElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const choose = async (item: KeptImport, choice: Choice) => {
    setBusy(`${item.key} ${choice}`);
    try {
      const entity = await onChoose(item.key, choice);
      if (!entity) return;
      setSaid(saidAfter(item.label, choice, entity.kept?.find((entry) => entry.key === item.key), t));
      // The buttons pressed are gone: focus goes to the line's new ones, or
      // to the notice, or to the line that says the notice is done.
      requestAnimationFrame(() => {
        const line = sectionRef.current?.querySelector<HTMLElement>(`[data-kept="${CSS.escape(item.key)}"] button:not([disabled])`);
        (line ?? sectionRef.current ?? doneRef.current)?.focus({ preventScroll: true });
      });
    } finally {
      setBusy("");
    }
  };
  if (!kept.length) {
    return said ? (
      <p ref={doneRef} tabIndex={-1} className="rounded-md text-xs text-amber-200/80 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60" data-testid="import-kept-done">
        {said}
      </p>
    ) : null;
  }
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      data-testid="import-kept"
      aria-label={t("Kept when brought in again")}
    >
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
      <ul className="flex flex-col gap-3">
        {kept.map((item) => (
          <li key={item.key} className="flex flex-col gap-1.5" data-kept={item.key}>
            {item.taken ? (
              <>
                <p>
                  <strong>{item.label}</strong>{" "}
                  {item.landed === "partly"
                    ? t(": the import's version is in use, as far as this entry could take it. It holds now:")
                    : t(": the import's version is in use.")}
                </p>
                {item.landed === "partly" ? <KeptValueText value={item.now} said={item.shown?.now} /> : null}
                <p>{t("This campaign's version is kept, so you can go back to it:")}</p>
                <KeptValueText value={item.mine} said={item.shown?.mine} />
              </>
            ) : (
              <>
                <p>
                  <strong>{item.label}</strong>{" "}
                  {item.landed === "not"
                    ? t(": the import's version could not be written here, so nothing changed. It may name a folder, type or option this world no longer has. The import's version:")
                    : t(": this campaign's version was kept when it was brought in again; the import's version differs:")}
                </p>
                <KeptValueText value={item.theirs} said={item.shown?.theirs} />
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {item.taken ? (
                <>
                  <KitButton tone="small" busy={busy === `${item.key} restore`} disabled={Boolean(busy)} onClick={() => choose(item, "restore")} aria-label={t("Restore mine: {label}", { label: item.label })}>
                    {t("Restore mine")}
                  </KitButton>
                  <KitButton tone="small" busy={busy === `${item.key} dismiss`} disabled={Boolean(busy)} onClick={() => choose(item, "dismiss")} aria-label={t("Keep the import's: {label}", { label: item.label })}>
                    {t("Keep the import's")}
                  </KitButton>
                </>
              ) : (
                <>
                  {item.landed === "not" ? null : (
                    <KitButton tone="small" busy={busy === `${item.key} use`} disabled={Boolean(busy)} onClick={() => choose(item, "use")} aria-label={t("Use the import's version of the {label}", { label: item.label })}>
                      {t("Use the import's version")}
                    </KitButton>
                  )}
                  <KitButton tone="small" busy={busy === `${item.key} dismiss`} disabled={Boolean(busy)} onClick={() => choose(item, "dismiss")} aria-label={t("Keep mine: {label}", { label: item.label })}>
                    {t("Keep mine")}
                  </KitButton>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-200/80">{t("Players never see this.")}</p>
    </section>
  );
}
