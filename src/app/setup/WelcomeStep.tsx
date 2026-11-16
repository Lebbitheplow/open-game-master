"use client";

import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { LanguageSelect } from "@/components/LanguageSelect";
import type { Draft } from "@/app/setup/draft";
import { Lamp, ScanMark, host, type ScanResult } from "@/app/setup/SetupParts";
import { useT, useTp } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

type Update = (change: (draft: Draft) => Draft) => void;

// The five stops the wizard will make, keyed into the dictionaries.
const STOPS: Array<{ glyph: string; title: MessageKey; line: MessageKey }> = [
  { glyph: "ui-ai", title: "The storyteller", line: "A model on this computer, an API key, an agent you already pay for, or a person." },
  { glyph: "ui-paint", title: "Pictures", line: "Portraits, scene art and battle maps. Optional." },
  { glyph: "tab-ambience", title: "Voice", line: "Narration read aloud, and push-to-talk dictation. Optional." },
  { glyph: "tab-characters", title: "Players", line: "The address to share, and who may make an account." },
  { glyph: "system-share", title: "Your own agent", line: "Claude Code, Codex or opencode working here as you. Optional." },
];

// The first step: a name, what the wizard is about to ask, and what the scan
// has already found on this computer while the admin reads.
export function WelcomeStep({
  draft,
  update,
  scan,
  scanning,
}: {
  draft: Draft;
  update: Update;
  scan: ScanResult | null;
  scanning: boolean;
}) {
  const t = useT();
  const tp = useTp();
  const found: Array<{ key: string; text: string }> = [
    ...(scan?.text ?? []).map((entry) => ({
      key: entry.baseUrl,
      text:
        t("{label} at {host}", { label: entry.label, host: host(entry.baseUrl) }) +
        (entry.models.length ? ` (${tp("{count} model", "{count} models", { count: entry.models.length })})` : ""),
    })),
    ...(scan?.comfyui ? [{ key: "comfy", text: t("ComfyUI at {host}", { host: host(scan.comfyui.url) }) }] : []),
    ...(scan?.kokoro ? [{ key: "kokoro", text: t("Kokoro voices at {host}", { host: host(scan.kokoro.url) }) }] : []),
    ...(scan?.whisper ? [{ key: "whisper", text: t("Whisper dictation at {host}", { host: host(scan.whisper.url) }) }] : []),
  ];
  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-stone-400">{t("Name your server")}</span>
        <input
          className={ui.input}
          value={draft.serverName}
          maxLength={100}
          onChange={(event) => update((current) => ({ ...current, serverName: event.target.value }))}
          placeholder="Open Game Master"
        />
        <span className="mt-1 block text-[11px] text-stone-500">{t("Shown on the sign-in page and in the apps' server lists.")}</span>
      </label>

      {draft.serverLanguage ? (
        <div>
          <span id="setup-language-label" className="mb-1 block text-xs font-medium text-stone-400">
            The language your tables play in
          </span>
          <LanguageSelect
            value={draft.serverLanguage}
            onChange={(serverLanguage) => update((current) => ({ ...current, serverLanguage }))}
            label="The language your tables play in"
            className="w-full sm:max-w-xs"
          />
          <span className="mt-1 block text-[11px] text-stone-500">
            {draft.serverLanguage === "english"
              ? "New campaigns start in it. Each campaign can still pick another."
              : "New campaigns start in it, and the Game Master's memory switches to a model that reads it (downloaded once, about 120 MB). Each campaign can still pick another."}
          </span>
        </div>
      ) : null}

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-stone-200">{t("What we will set up")}</h4>
        <ul className="stagger space-y-1.5">
          {STOPS.map((stop) => (
            <li key={stop.title} className="flex items-start gap-3">
              <GameIcon icon={{ kind: "glyph", key: stop.glyph }} size="size-7" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="text-stone-100">{t(stop.title)}</span>
                <span className="block text-xs text-stone-500">{t(stop.line)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2" aria-live="polite">
        <h4 className="flex items-center gap-2 text-sm font-medium text-stone-200">
          <ScanMark scanning={scanning} found={found.length > 0} />
          {scanning
            ? t("Looking around this computer…")
            : found.length
              ? t("Already running on this computer")
              : t("Nothing running on this computer yet")}
        </h4>
        {found.length ? (
          <ul className="stagger flex flex-wrap gap-2">
            {found.map((entry) => (
              <li key={entry.key} className="hx-pill reveal-pop" data-tone="ready">
                <Lamp tone="ok" /> {entry.text}
              </li>
            ))}
          </ul>
        ) : !scanning ? (
          <p className="text-xs text-stone-500">
            {t("That is fine. The next step can use an API key or an agent program instead, or show you what to start.")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
