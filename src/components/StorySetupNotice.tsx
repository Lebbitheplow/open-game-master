"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useT } from "@/lib/locale";

// The warning that AI Story Setup will meet the story the table brought in
// (issue 249), with the two ways on: turn the setting off, or keep it on on
// purpose. Drawn by the creation wizard beside "Bring in prep" and by the
// lobby beside the import and above Begin. It never changes the setting by
// itself; whoever holds it decides.
export function StorySetupNotice({
  text,
  busy = false,
  error = "",
  onTurnOff,
  onKeep,
  className,
}: {
  text: string;
  busy?: boolean;
  error?: string;
  onTurnOff: () => void;
  onKeep: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      data-story-setup-warning
      className={cn("reveal rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-100", className)}
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
        <span>{text}</span>
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onTurnOff} disabled={busy} className={ui.btnSmall} data-story-setup-off>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t("Turn off AI Story Setup")}
        </button>
        <button
          type="button"
          onClick={onKeep}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-stone-300 underline-offset-2 transition-colors hover:text-amber-100 hover:underline disabled:opacity-50"
          data-story-setup-keep
        >
          {t("Keep it on")}
        </button>
        {error ? <span className="text-red-300">{error}</span> : null}
      </div>
    </div>
  );
}
