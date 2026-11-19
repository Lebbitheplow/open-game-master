"use client";

import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { DEFAULT_WINDOW, storyNeeds, windowLabel } from "@/lib/story-window";
import { BackendProbe } from "@/app/admin/BackendProbe";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AgentPanel } from "@/app/setup/AgentPanel";
import { StartHints } from "@/app/setup/StartHints";
import { NO_LIST, type Draft, type ModelList } from "@/app/setup/draft";
import { ChoiceCard, ChoiceCards, FoundRow, ModelPicker, ScanMark, host, type ScanResult } from "@/app/setup/SetupParts";
import { useT, useTp } from "@/lib/locale";
import {
  KEY_PROVIDERS,
  keyForListing,
  keyProvider,
  normalizeBaseUrl,
  providerForKey,
  type KeyProviderId,
  type ListedModel,
} from "@/lib/setup/discovery-logic";

type Update = (change: (draft: Draft) => Draft) => void;

type Listing =
  | { ok: true; baseUrl: string; models: ListedModel[]; recommended: string }
  | { ok: false; baseUrl: string; error: string; needsKey?: boolean };

async function askForModels(body: Record<string, string>): Promise<Listing> {
  try {
    const response = await fetch("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "models", ...body }),
    });
    const data = await response.json().catch(() => null);
    return data ?? { ok: false, baseUrl: "", error: "The server did not answer." };
  } catch {
    return { ok: false, baseUrl: "", error: "Could not reach this server." };
  }
}

function listFrom(result: Listing): ModelList {
  return result.ok
    ? { state: "ok", models: result.models, recommended: result.recommended, error: "", needsKey: false }
    : { state: "failed", models: [], recommended: "", error: result.error, needsKey: Boolean(result.needsKey) };
}

export function StorytellerStep({
  draft,
  update,
  scan,
  scanning,
  onRescan,
  savedKeyFor,
  savedKeyBase,
  inContainer,
}: {
  draft: Draft;
  update: Update;
  scan: ScanResult | null;
  scanning: boolean;
  onRescan: () => void;
  // Which hosted provider the saved key belongs to, if any; a blank key
  // field keeps it.
  savedKeyFor: KeyProviderId | null;
  // The address a saved key belongs to, when a key is saved at all.
  savedKeyBase: string;
  inContainer: boolean;
}) {
  const t = useT();
  const tp = useTp();
  const found = scan?.text ?? [];
  const pick = (story: Draft["story"]) => update((current) => ({ ...current, story }));
  return (
    <div className="space-y-4">
      <ChoiceCards label={t("Who tells the story")}>
        <ChoiceCard
          picked={draft.story === "local"}
          onPick={() => pick("local")}
          glyph="ui-ai"
          title={t("A model on this computer")}
          sub={t("llama.cpp recommended; Ollama, LM Studio, vLLM and other servers work too. Free to play and private; needs at least 16 GB of graphics memory.")}
          badge={scanning ? { text: t("Looking…"), tone: "off" } : found.length ? { text: tp("Found {count}", "Found {count}", { count: found.length }), tone: "ready" } : null}
        />
        <ChoiceCard
          picked={draft.story === "key"}
          onPick={() => pick("key")}
          glyph="tab-admin"
          title={t("An API key")}
          sub={t("OpenAI, OpenRouter or another provider. No GPU needed; each turn is billed to the key.")}
        />
        <ChoiceCard
          picked={draft.story === "agent"}
          onPick={() => pick("agent")}
          glyph="system-share"
          title={t("An agent you already pay for")}
          sub={t("Claude Code, Codex, opencode, Grok Build, Pi or the Antigravity CLI, signed in on this computer, narrating on its own plan.")}
        />
        <ChoiceCard
          picked={draft.story === "none"}
          onPick={() => pick("none")}
          glyph="tab-characters"
          title={t("A person at the table")}
          sub={t("No AI. Someone narrates, usually over voice chat, and the app keeps the sheets, dice and maps.")}
        />
      </ChoiceCards>

      {draft.story === "local" ? (
        <div key="local" className="reveal-height">
          <LocalPanel
            draft={draft}
            update={update}
            found={found}
            scanning={scanning}
            onRescan={onRescan}
            savedKeyBase={savedKeyBase}
            inContainer={inContainer}
            machine={scan?.machine ?? null}
          />
        </div>
      ) : draft.story === "key" ? (
        <div key="key" className="reveal-height">
          <KeyPanel draft={draft} update={update} savedKeyFor={savedKeyFor} />
        </div>
      ) : draft.story === "agent" ? (
        <div key="agent" className="reveal-height">
          <AgentPanel draft={draft} update={update} />
        </div>
      ) : draft.story === "none" ? (
        <p key="none" className="reveal su-note">
          {t("Tables on this server will have a person in the Game Master's seat. The app still rolls the dice, keeps every sheet and map, and can step in for the monsters or a read-aloud when the GM asks. You can add an AI storyteller here later.")}
        </p>
      ) : null}
    </div>
  );
}

function LocalPanel({
  draft,
  update,
  found,
  scanning,
  onRescan,
  savedKeyBase,
  inContainer,
  machine,
}: {
  draft: Draft;
  update: Update;
  found: ScanResult["text"];
  scanning: boolean;
  onRescan: () => void;
  savedKeyBase: string;
  inContainer: boolean;
  machine: ScanResult["machine"] | null;
}) {
  const t = useT();
  const tp = useTp();
  const local = draft.local;
  const [looking, setLooking] = useState(false);
  const setLocal = (patch: Partial<Draft["local"]>) => update((current) => ({ ...current, local: { ...current.local, ...patch } }));
  const chosenFound = !local.typed ? found.find((entry) => entry.baseUrl === normalizeBaseUrl(local.baseUrl)) : undefined;
  // The key saved on this server belongs to this very server: a blank key
  // field keeps it, and the server lists the models with it.
  const keySavedHere = Boolean(savedKeyBase) && keyForListing({ typed: "", savedKey: "saved", savedBaseUrl: savedKeyBase, baseUrl: local.baseUrl }) === "saved";

  async function look() {
    setLooking(true);
    setLocal({ list: { ...NO_LIST, state: "busy" } });
    const result = await askForModels({ baseUrl: local.baseUrl, apiKey: local.apiKey });
    setLooking(false);
    const list = listFrom(result);
    update((current) => ({
      ...current,
      local: {
        ...current.local,
        baseUrl: result.baseUrl || current.local.baseUrl,
        list,
        model: list.models.some((model) => model.id === current.local.model) ? current.local.model : list.recommended || current.local.model,
      },
    }));
  }

  // Running the wizard again: the scan saw the server want its key, and
  // that key is already saved, so the models are listed with it unasked.
  const listedSaved = useRef("");
  useEffect(() => {
    if (local.list.needsKey && keySavedHere && !local.apiKey && listedSaved.current !== local.baseUrl) {
      listedSaved.current = local.baseUrl;
      void look();
    }
    // Only when the chosen server is one the saved key belongs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.list.needsKey, keySavedHere, local.baseUrl]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-stone-400">
          <ScanMark scanning={scanning} found={found.length > 0} />
          {scanning
            ? t("Looking for model servers on this computer…")
            : found.length
              ? t("Found on this computer")
              : t("Nothing is answering on this computer yet")}
        </span>
        <button type="button" className={ui.btnSmall} onClick={onRescan} disabled={scanning} aria-busy={scanning}>
          <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} /> {t("Look again", { context: "setup.local.lookAgain" })}
        </button>
      </div>

      <div role="radiogroup" aria-label={t("Model servers")} className="stagger space-y-2">
        {found.map((entry) => (
          <FoundRow
            key={entry.baseUrl}
            picked={Boolean(chosenFound && chosenFound.baseUrl === entry.baseUrl)}
            onPick={() =>
              setLocal({
                baseUrl: entry.baseUrl,
                typed: false,
                model: entry.recommended,
                list: entry.needsKey
                  ? { ...NO_LIST, state: "failed", needsKey: true, error: t("{host} wants its API key.", { host: host(entry.baseUrl) }) }
                  : { state: "ok", models: entry.models, recommended: entry.recommended, error: "", needsKey: false },
              })
            }
            title={`${entry.label} · ${host(entry.baseUrl)}`}
            detail={entry.needsKey
              ? t("Wants its API key")
              : `${tp("1 model", "{count} models", { count: entry.models.length })}${entry.recommended ? `, ${entry.recommended}` : ""}`}
            tone={entry.needsKey ? "warn" : "ok"}
          />
        ))}
        <FoundRow
          picked={local.typed}
          onPick={() => setLocal({ typed: true, list: NO_LIST })}
          title={t("Somewhere else")}
          detail={t("Another port, or another computer on your network")}
          tone="off"
        />
      </div>

      {!scanning && !found.length ? <StartHints inContainer={inContainer} machine={machine} /> : null}

      {local.typed ? (
        <div key="typed" className="reveal flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-stone-400">{t("Server address")}</span>
            <input
              className={ui.input}
              value={local.baseUrl}
              onChange={(event) => setLocal({ baseUrl: event.target.value, list: NO_LIST })}
              placeholder="http://192.168.1.20:8080"
            />
          </label>
          <button type="button" className={ui.btnSecondary} onClick={look} disabled={looking || !local.baseUrl.trim()} aria-busy={looking}>
            {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} {t("Look", { context: "setup.local.look" })}
          </button>
        </div>
      ) : null}

      {local.list.needsKey || local.apiKey ? (
        <div key="key" className="reveal flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-stone-400">{t("The server's API key")}</span>
            <input
              type="password"
              className={ui.input}
              value={local.apiKey}
              onChange={(event) => setLocal({ apiKey: event.target.value })}
              placeholder={keySavedHere ? t("•••••••• (saved, leave blank to keep it)") : t("The --api-key it was started with")}
              autoComplete="off"
            />
          </label>
          <button type="button" className={ui.btnSecondary} onClick={look} disabled={looking || (!local.apiKey.trim() && !keySavedHere)} aria-busy={looking}>
            {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} {t("Look again", { context: "setup.local.lookAgain" })}
          </button>
        </div>
      ) : null}

      {local.list.state === "failed" && local.list.error ? (
        <p key={local.list.error} role="alert" className="motion-shake text-sm text-red-400">
          {local.list.error}
        </p>
      ) : null}

      {local.list.models.length ? (
        <ModelPicker
          label={t("Model")}
          models={local.list.models}
          value={local.model}
          recommended={local.list.recommended}
          onChange={(model) => setLocal({ model })}
        />
      ) : local.typed || local.baseUrl ? (
        <label className="reveal block">
          <span className="mb-1 block text-xs font-medium text-stone-400">{t("Model name")}</span>
          <input className={ui.input} value={local.model} onChange={(event) => setLocal({ model: event.target.value })} placeholder={t("A model the server lists")} />
          <span className="mt-1 block text-[11px] text-stone-500">{t("The name the server knows it by. Look fills this in once the server answers.")}</span>
        </label>
      ) : null}

      {local.baseUrl && local.model ? (
        <BackendProbe
          which="story"
          baseUrl={normalizeBaseUrl(local.baseUrl)}
          model={local.model}
          apiKey={local.apiKey}
          provider={chosenFound?.ollamaNative ? "local" : "custom"}
        />
      ) : null}
      <p className="text-[11px] leading-4 text-stone-500">
        {storyNeeds(t)}{" "}
        {chosenFound?.ollamaNative
          ? t("The app asks this Ollama for up to {window} itself.", { window: windowLabel(DEFAULT_WINDOW) })
          : chosenFound?.kind === "ollama"
            ? t("Ollama runs a model at its own context length, 4K on a card under 24 GB: start it with OLLAMA_CONTEXT_LENGTH={window}.", { window: DEFAULT_WINDOW })
            : t("The server sets it (llama-server's -c).")}
      </p>
    </div>
  );
}

function KeyPanel({ draft, update, savedKeyFor }: { draft: Draft; update: Update; savedKeyFor: KeyProviderId | null }) {
  const t = useT();
  const tp = useTp();
  const key = draft.key;
  const provider = keyProvider(key.provider);
  const [checking, setChecking] = useState(false);
  const [switched, setSwitched] = useState("");
  const keptKey = savedKeyFor === key.provider && !key.apiKey.trim();
  const setKey = (patch: Partial<Draft["key"]>) => update((current) => ({ ...current, key: { ...current.key, ...patch } }));

  async function check(next: Draft["key"] = key) {
    setChecking(true);
    setKey({ list: { ...NO_LIST, state: "busy" } });
    const result = await askForModels({
      provider: next.provider,
      baseUrl: next.provider === "other" ? next.baseUrl : "",
      apiKey: next.apiKey,
    });
    setChecking(false);
    const list = listFrom(result);
    update((current) => ({
      ...current,
      key: {
        ...current.key,
        list,
        model: list.models.some((model) => model.id === current.key.model) ? current.key.model : list.recommended,
      },
    }));
  }

  // A saved key lists its models on arrival, so running the wizard again
  // needs no pasting.
  const listedSaved = useRef(false);
  useEffect(() => {
    if (keptKey && key.list.state === "idle" && !listedSaved.current) {
      listedSaved.current = true;
      void check();
    }
    // Only on arrival with a saved key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptKey]);

  function typeKey(value: string) {
    const guess = providerForKey(value);
    if (guess && guess !== key.provider && key.provider !== "other") {
      setSwitched(t("That looks like an {provider} key, so {provider} is chosen.", { provider: keyProvider(guess).label }));
      setKey({ apiKey: value, provider: guess, list: NO_LIST, model: "" });
      return;
    }
    setKey({ apiKey: value, list: NO_LIST });
  }

  return (
    <div className="space-y-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <SegmentedControl
          options={KEY_PROVIDERS.map((entry) => ({ value: entry.id, label: entry.label }))}
          value={key.provider}
          onChange={(next) => {
            setSwitched("");
            setKey({ provider: next, list: NO_LIST, model: "" });
          }}
          label={t("Provider")}
          className="w-max"
        />
      </div>
      {switched ? (
        <p key={switched} role="status" className="reveal text-xs text-amber-200">
          {switched}
        </p>
      ) : null}
      {key.provider === "other" ? (
        <label key="base" className="reveal block">
          <span className="mb-1 block text-xs font-medium text-stone-400">{t("The provider's OpenAI-compatible address")}</span>
          <input
            className={ui.input}
            value={key.baseUrl}
            onChange={(event) => setKey({ baseUrl: event.target.value, list: NO_LIST })}
            placeholder="https://api.example.com/v1"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1">
          <span className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-stone-400">
            {t("API key", { context: "admin.text.apiKey" })}
            {provider.keyUrl ? (
              <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-200 hover:text-amber-100">
                {t("Get a {provider} key", { provider: provider.label })} <ExternalLink className="size-3" />
              </a>
            ) : null}
          </span>
          <input
            type="password"
            className={ui.input}
            value={key.apiKey}
            onChange={(event) => typeKey(event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text").trim();
              if (pasted) {
                event.preventDefault();
                typeKey(pasted);
              }
            }}
            placeholder={keptKey ? t("•••••••• (saved, leave blank to keep it)") : provider.keyPlaceholder}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className={ui.btnSecondary}
          onClick={() => void check()}
          disabled={checking || (!key.apiKey.trim() && !keptKey) || (key.provider === "other" && !key.baseUrl.trim())}
          aria-busy={checking}
        >
          {checking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} {t("Check the key")}
        </button>
      </div>
      <p className="text-[11px] leading-4 text-stone-500">
        {t("Saved on this server and never shown again, to anyone. Every table on the server narrates on it, so the Players step can keep strangers out.")}
      </p>
      {key.list.state === "failed" ? (
        <p key={key.list.error} role="alert" className="motion-shake text-sm text-red-400">
          {key.list.error}
        </p>
      ) : null}
      {key.list.models.length ? (
        <ModelPicker label={t("Model")} models={key.list.models} value={key.model} recommended={key.list.recommended} onChange={(model) => setKey({ model })} />
      ) : null}
      {provider.coversMedia ? (
        <p className="su-note">
          {t("One OpenAI key also paints the pictures, reads the story aloud and takes dictation. The next two steps can use it with nothing more to paste.")}
        </p>
      ) : null}
      {key.model && key.list.state === "ok" ? (
        <BackendProbe
          which="story"
          baseUrl={normalizeBaseUrl(provider.baseUrl || key.baseUrl)}
          model={key.model}
          apiKey={key.apiKey}
        />
      ) : null}
    </div>
  );
}
