"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { BackendProbe } from "@/app/admin/BackendProbe";
import { HarnessTestPanel } from "@/app/admin/HarnessTestPanel";
import type { Capabilities } from "@/lib/capabilities";
import type { Draft } from "@/app/setup/draft";
import { Lamp, type Tone } from "@/app/setup/SetupParts";
import { useT } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";

type Row = { key: string; title: string; tone: Tone; text: string; step: number };

const SIGNUP_KEYS: Record<Draft["signupMode"], MessageKey> = {
  invite: "Accounts by invite code",
  open: "Anyone with the address can make an account",
  closed: "No new accounts",
};

const STT_KEYS: Record<string, MessageKey> = {
  whisper: "Dictation by the Whisper server",
  builtin: "Dictation by the built-in engine",
  openai: "Dictation by OpenAI, on the key",
};

// Each row's line, keyed into the dictionaries; a fresh row list on every
// ask, so a change of state re-renders its words.
function rows(
  t: (key: string, vars?: Record<string, string | number>) => string,
  input: {
    draft: Draft;
    caps: Capabilities | null;
    address: string;
    agentConnected: boolean;
    steps: Record<string, number>;
  },
): Row[] {
  const { draft, caps, steps } = input;
  const wait = !caps;
  const row = (key: string, titleKey: MessageKey, tone: Tone, text: string, step: number): Row => ({
    key,
    title: t(titleKey),
    tone,
    text,
    step,
  });
  const asking = t("Asking…");
  const story: Row =
    draft.story === "none"
      ? row("story", "Storyteller", "off", t("A person narrates. No AI storyteller."), steps.story)
      : wait
        ? row("story", "Storyteller", "wait", t("Asking the storyteller…"), steps.story)
        : caps.story.configured && caps.story.reachable
          ? row("story", "Storyteller", "ok", caps.story.model ? t("Answering · {model}", { model: caps.story.model }) : t("Answering"), steps.story)
          : row(
              "story",
              "Storyteller",
              "bad",
              draft.story === "agent"
                ? t("Saved, but the program is not ready: install it or sign it in, then check again.")
                : t("Saved, but not answering yet: start the model server, then check again."),
              steps.story,
            );
  const pictures: Row =
    draft.pictures === "none"
      ? row("pictures", "Pictures", "off", t("Painted placeholders"), steps.pictures)
      : draft.pictures === ""
        ? // Skipped: nothing was saved, and a ComfyUI found on its own still counts.
          wait
          ? row("pictures", "Pictures", "wait", asking, steps.pictures)
          : caps.images.configured && caps.images.reachable
            ? row("pictures", "Pictures", "ok", t("Found on this computer, and painting"), steps.pictures)
            : row("pictures", "Pictures", "off", t("Not set up yet. Tables use painted placeholders until it is."), steps.pictures)
      : wait
        ? row("pictures", "Pictures", "wait", asking, steps.pictures)
        : caps.images.configured && caps.images.reachable
          ? row("pictures", "Pictures", "ok", draft.pictures === "comfyui" ? t("ComfyUI paints them") : draft.pictures === "openai" ? t("OpenAI paints them, on the key") : t("The agent paints them"), steps.pictures)
          : caps.images.needsModel
            ? row("pictures", "Pictures", "warn", t("Saved, but no model is picked, so nothing is painted until one is."), steps.pictures)
            : row("pictures", "Pictures", "warn", t("Saved, but not answering yet. Tables use placeholders until it does."), steps.pictures);
  const narration: Row =
    draft.narration === "off"
      ? row("narration", "Narration", "off", t("Text only"), steps.voice)
      : draft.narration === ""
        ? wait
          ? row("narration", "Narration", "wait", asking, steps.voice)
          : caps.tts.configured && caps.tts.reachable
            ? row("narration", "Narration", "ok", t("Found on this computer, and reading aloud"), steps.voice)
            : row("narration", "Narration", "off", t("Not set up yet. The story is read on screen until it is."), steps.voice)
      : wait
        ? row("narration", "Narration", "wait", asking, steps.voice)
        : caps.tts.configured && caps.tts.reachable
          ? row("narration", "Narration", "ok", draft.narration === "kokoro" ? t("Kokoro reads it aloud") : t("OpenAI reads it aloud, on the key"), steps.voice)
          : caps.tts.needsModel
            ? row("narration", "Narration", "warn", t("Saved, but no model is picked, so nothing is read aloud until one is."), steps.voice)
            : row("narration", "Narration", "warn", t("Saved, but not answering yet."), steps.voice);
  const dictation: Row = wait
    ? row("dictation", "Dictation", "wait", asking, steps.voice)
    : caps.stt.configured
      ? row("dictation", "Dictation", "ok", STT_KEYS[caps.stt.backend] ? t(STT_KEYS[caps.stt.backend]) : t("Ready", { context: "setup.ready.ready" }), steps.voice)
      : row("dictation", "Dictation", "off", t("Off. The Voice step can download the built-in engine."), steps.voice);
  const players: Row = {
    key: "players",
    title: t("Players"),
    tone: "ok",
    text: `${t(SIGNUP_KEYS[draft.signupMode])}${input.address ? ` · ${input.address}` : ""}`,
    step: steps.players,
  };
  const agent: Row = input.agentConnected
    ? row("agent", "Your agent", "ok", t("Connection made"), steps.agent)
    : row("agent", "Your agent", "off", t("Not connected (optional)"), steps.agent);
  return [story, pictures, narration, dictation, players, agent];
}

// The last step: what the server can do now, asked live, each line with a
// way back to the step that sets it, and one real test of the storyteller.
export function ReadyStep({
  active,
  draft,
  address,
  agentConnected,
  steps,
  onJump,
}: {
  active: boolean;
  draft: Draft;
  address: string;
  agentConnected: boolean;
  steps: Record<string, number>;
  onJump: (step: number) => void;
}) {
  const t = useT();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [checking, setChecking] = useState(false);

  const ask = useCallback(
    () =>
      fetch("/api/capabilities")
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null)
        .then((data) => {
          setCaps(data as Capabilities | null);
          setChecking(false);
        }),
    [],
  );

  // Asked on each arrival (the wizard remounts this step with a new key):
  // the steps before it have just saved.
  useEffect(() => {
    if (active) void ask();
  }, [active, ask]);

  function check() {
    setChecking(true);
    setCaps(null);
    void ask();
  }

  const list = rows(t, { draft, caps, address, agentConnected, steps });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-stone-400">{t("What this server can do now")}</span>
        <button type="button" className={ui.btnSmall} onClick={check} disabled={checking} aria-busy={checking}>
          <RefreshCw className={checking ? "size-3.5 animate-spin" : "size-3.5"} /> {t("Check again")}
        </button>
      </div>
      <ul className="stagger space-y-2" aria-live="polite">
        {list.map((row) => (
          <li key={row.key} className="su-row">
            <Lamp tone={row.tone} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-stone-100">{row.title}</span>
              <span key={row.text} className="live-in block text-xs text-stone-400">
                {row.text}
              </span>
            </span>
            <button type="button" className={ui.btnSmall} onClick={() => onJump(row.step)}>
              {t("Change", { context: "setup.ready.change" })}
            </button>
          </li>
        ))}
      </ul>

      {draft.story === "local" || draft.story === "key" ? (
        <div className="su-row flex-col items-stretch">
          <span className="text-sm text-stone-200">{t("Try the storyteller the way a table will")}</span>
          <BackendProbe which="story" baseUrl="" model="" />
        </div>
      ) : draft.story === "agent" && draft.agent.id ? (
        <div className="su-row flex-col items-stretch">
          <span className="text-sm text-stone-200">{t("Try the agent with one tiny real turn")}</span>
          <HarnessTestPanel saved paints={false} picturesVerified={false} onVerified={check} />
        </div>
      ) : null}
    </div>
  );
}
