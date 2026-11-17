"use client";

import { Check, Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { SttStatus } from "@/lib/stt-backend";
import { ui } from "@/lib/ui";
import { useT } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

// whisper and openai arrive from servers newer than 0.26.4; the apps draw
// this card for older hosts too, which send neither.
type Status = Omit<SttStatus, "whisper" | "openai"> & Partial<Pick<SttStatus, "whisper" | "openai">> & {
  builtin: {
    model: string;
    downloadMb: number;
    installed: boolean;
    status: "idle" | "installing" | "ready" | "error";
    progress: number;
    error: string;
  };
};

// Which engine dictation uses, said in the table's language.
const ACTIVE_KEYS: Record<Status["active"], MessageKey> = {
  whisper: "the Whisper service",
  builtin: "the built-in engine",
  openai: "OpenAI, on this server's key",
  // The Android app's game screens still dictate with the phone's own
  // recognizer (useDictation's native engine), so their mics stay.
  none: "nothing yet, so the mic buttons are hidden (the Android app uses the phone's own recognizer)",
};

// Which "no model is picked" lines the card shows. A host older than these
// fields sends neither, and the card says nothing of them rather than fail.
export function modelNotes(status: Partial<Pick<Status, "whisper" | "openai">> | null): { whisper: boolean; openai: boolean } {
  return { whisper: Boolean(status?.whisper?.needsModel), openai: Boolean(status?.openai?.needsModel) };
}

// The engine's state, or a sentence saying why it could not be read.
async function request(t: (key: string) => string, method: "GET" | "POST"): Promise<Status | string> {
  try {
    const response = await fetch("/api/admin/speech", { method, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return response.ok ? (data as Status) : data.error || t("Could not read the speech engine's state.");
  } catch {
    return t("Could not reach this server.");
  }
}

// The built-in speech engine in the admin panel: one button that downloads
// Whisper into this server (src/lib/stt-builtin.ts), a bar while it comes
// down, and a line saying which engine dictation uses right now.
export function BuiltinSpeechCard() {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  const apply = useCallback((result: Status | string) => {
    if (typeof result === "string") {
      setError(result);
    } else {
      setError("");
      setStatus(result);
    }
  }, []);

  useEffect(() => {
    void request(t, "GET").then(apply);
  }, [apply]);

  const installing = status?.builtin.status === "installing";
  useEffect(() => {
    if (!installing) {
      return;
    }
    const timer = window.setInterval(() => void request(t, "GET").then(apply), 1000);
    return () => window.clearInterval(timer);
  }, [installing, apply, t]);

  const builtin = status?.builtin;
  const percent = Math.round((builtin?.progress ?? 0) * 100);
  const notes = modelNotes(status);

  return (
    <div className="panel rounded-xl p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm tracking-wide text-amber-100">{t("Built-in speech recognition")}</p>
          <p className="mt-0.5 text-xs leading-5 text-stone-400">
            {t("Runs Whisper inside this server on the CPU, so dictation and push-to-talk work without a separate speech service. Downloads {mb} MB once. A Whisper service, when one answers, still comes first.", { mb: builtin?.downloadMb ?? 76 })}
          </p>
        </div>
        {builtin?.installed && !installing ? (
          <span className="speech-installed reveal-pop inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-200">
            <Check className="tick-in size-3.5" /> {t("Installed", { context: "admin.builtin.installed" })}
          </span>
        ) : (
          <button
            type="button"
            disabled={!status || installing}
            onClick={() => void request(t, "POST").then(apply)}
            className={cn(ui.btnSecondary, "h-9 text-[12px]")}
          >
            {installing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : builtin?.status === "error" ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Download className="size-3.5" />
            )}
            {installing ? t("Installing") : builtin?.status === "error" ? t("Try again", { context: "admin.builtin.tryAgain" }) : t("Install")}
          </button>
        )}
      </div>

      {installing ? (
        <div className="reveal mt-2" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
            <div className="bar-ease h-full rounded-full bg-amber-400/80" style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-stone-400">
            {percent
              ? t("Downloading {model}: {percent}%", { model: builtin?.model ?? "", percent })
              : t("Starting the download of {model}...", { model: builtin?.model ?? "" })}
          </p>
        </div>
      ) : null}

      {builtin?.status === "error" && builtin.error ? (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {t("The install failed: {error}", { error: builtin.error })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}

      {status ? (
        <p className="mt-2 border-t border-stone-800 pt-2 text-[11px] text-stone-400">
          {t("Dictation is using {engine}.", { engine: t(ACTIVE_KEYS[status.active]) })}
        </p>
      ) : null}
      {notes.whisper ? (
        <p role="status" className="mt-1 text-[11px] text-amber-300">
          {t("A Whisper service answers, but no model is picked for it and it doesn't list exactly one, so dictation skips it. Pick its model in the Whisper model field.")}
        </p>
      ) : null}
      {notes.openai ? (
        <p role="status" className="mt-1 text-[11px] text-amber-300">
          {t("An OpenAI key is saved, but no transcription model is picked, so nothing is heard until you pick one under OpenAI transcription in Admin > Speech.")}
        </p>
      ) : null}
    </div>
  );
}
