"use client";

import { AlignLeft, Bot, Image as ImageIcon, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { artStyleLabel, artStyleNote } from "@/lib/art-direction";
import { cn } from "@/lib/cn";
import { ImagesNote } from "@/app/campaigns/[campaignId]/NarrationNote";
import { commitValue, draftsFrom, editDraft, followSaved, inStep } from "@/app/campaigns/[campaignId]/settingDrafts";
import { ModelNote } from "@/components/ModelNote";
import { Select } from "@/components/ui/Select";
import type { MaskedStorySettings } from "@/lib/db/settings";
import type { HarnessOffer } from "@/lib/harness/policy";
import { endpointKind } from "@/lib/dm/sampling-logic";
import { shellHost } from "@/lib/shell-host";
import type { TextProvider } from "@/lib/text-models";
import { useT } from "@/lib/locale";

// The translator's shape, for the label helpers below: `t` comes in first
// (src/lib/story-window.ts).
type T = (key: string, vars?: Record<string, string | number>) => string;
import {
  ART_STYLE_TEXT_MAX,
  ART_STYLES,
  PROSE_SIZE_VALUES,
  type ArtStyle,
  type ImageBackend,
  type StorySettings,
} from "@/lib/types";

// A secret field never receives its stored value; SECRET_KEPT means "leave it
// as is" and the field is simply omitted from the PATCH. Same contract as the
// admin settings panel.
const SECRET_KEPT = "\u0000keep";

// The text settings typed in place.
type TextField = "customBaseUrl" | "customModel" | "utilityBaseUrl" | "utilityModel" | "artStyleMap" | "artStyleScene";

// In the order the pickers offer them: llama.cpp (or another
// OpenAI-compatible server) is the one ODM sets up and recommends. The
// words are keys read through t(); ComfyUI, OpenAI and Ollama keep their
// names.
const PROVIDER_LABEL_KEYS: Record<TextProvider, string> = {
  custom: "llama.cpp or compatible server",
  local: "Ollama",
  none: "No AI storyteller",
  harness: "The server's agent",
};

function providerLabel(t: T, provider: TextProvider): string {
  return provider === "harness" ? t("The server's agent") : t(PROVIDER_LABEL_KEYS[provider]);
}

function backendLabel(t: T, backend: ImageBackend): string {
  switch (backend) {
    case "comfyui": return "ComfyUI";
    case "openai": return t("OpenAI-compatible");
    case "mflux-hs": return t("MFLUX (home server)");
    case "sdnq-hs": return t("SDNQ (home server)");
    case "harness": return t("The server's agent");
  }
}

// Per-campaign AI settings for the Settings tab. The values render from the
// campaign snapshot (kept live by campaign_updated over SSE); only the
// key-existence booleans come from the story-settings GET, because the
// snapshot is scrubbed of keys for everyone.
export function StoryAiPanel({
  campaignId,
  settings,
  steersStory,
}: {
  campaignId: string;
  settings: StorySettings;
  steersStory: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  // Every control renders the server's settings, so a refused PATCH changes
  // nothing on screen; without this line it changes nothing silently.
  const [error, setError] = useState("");
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const [hasUtilityKey, setHasUtilityKey] = useState(false);
  // Defaults to true so the warning never flashes while the answer is in
  // flight on servers that are fine.
  const [imagesConfigured, setImagesConfigured] = useState(true);
  // This campaign's own backend, which for a table on its own OpenAI key is
  // ready even when the server has no image backend of its own.
  const [imagesReady, setImagesReady] = useState(true);
  // Its backend is there but has no model picked, so it paints nothing
  // (src/lib/db/settings.ts); the server's own ComfyUI said the same.
  const [imagesNeedModel, setImagesNeedModel] = useState(false);
  // The model a blank campaign model falls back to: the server's storyteller.
  const [serverModel, setServerModel] = useState("");
  const [serverImagesNeedModel, setServerImagesNeedModel] = useState(false);
  // A world an app hosts: the backend is chosen once for the device and every
  // campaign follows it, so this panel shows it instead of editing it. null
  // until the answer lands, so the editable rows never flash on a device.
  const [deviceManaged, setDeviceManaged] = useState<boolean | null>(null);
  // Only an admin points the server at an address or holds its keys, so for
  // anyone else the URL and key fields are left out and the campaign runs on
  // the server's own backends (src/lib/db/settings.ts).
  const [serverManaged, setServerManaged] = useState(false);
  // Whether the server's agent program may narrate (and paint for) this
  // campaign; the admin decides (src/lib/harness/policy.ts). Hidden until
  // the answer lands, so the choice never flashes on and off.
  const [harness, setHarness] = useState<HarnessOffer | null>(null);
  // Text fields commit on blur or Enter, so a half-typed URL never PATCHes.
  // Each follows the saved settings until the player types into it
  // (settingDrafts.ts): a change saved in another window shows here, and a
  // field that still showed the old value is not saved back over it.
  const savedText: Record<TextField, string> = {
    customBaseUrl: settings.customBaseUrl,
    customModel: settings.customModel,
    utilityBaseUrl: settings.utilityBaseUrl,
    utilityModel: settings.utilityModel,
    artStyleMap: settings.artStyleMap,
    artStyleScene: settings.artStyleScene,
  };
  const [text, setText] = useState(() => draftsFrom(savedText));
  if (!inStep(text, savedText)) {
    setText(followSaved(text, savedText));
  }
  const setDraft = (field: TextField, value: string) => setText((prev) => editDraft(prev, field, value));
  const [keys, setKeys] = useState({ customApiKey: SECRET_KEPT, utilityApiKey: SECRET_KEPT });
  const drafts = { ...text.drafts, ...keys };

  useEffect(() => {
    if (!steersStory) {
      return;
    }
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/story-settings`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { settings?: MaskedStorySettings; harness?: HarnessOffer } | null) => {
        if (!cancelled && data?.settings) {
          setHasCustomKey(data.settings.hasCustomApiKey);
          setHasUtilityKey(data.settings.hasUtilityApiKey);
          setImagesReady(data.settings.imagesReady);
          setImagesNeedModel(data.settings.imagesNeedModel === true);
          setServerManaged(data.settings.serverManaged === true);
        }
        if (!cancelled && data?.harness) {
          setHarness(data.harness);
        }
        if (!cancelled) {
          // A server older than this field, or a failed read, edits as before.
          setDeviceManaged(data?.settings?.deviceManaged === true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeviceManaged(false);
        }
      });
    void fetch("/api/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { images?: { configured?: boolean; needsModel?: boolean }; story?: { model?: string } } | null) => {
        if (!cancelled && data?.images) {
          setImagesConfigured(data.images.configured !== false);
          setServerImagesNeedModel(data.images.needsModel === true);
        }
        if (!cancelled && data?.story?.model) {
          setServerModel(data.story.model);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [steersStory, campaignId]);

  async function patch(update: Partial<StorySettings>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/story-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        settings?: MaskedStorySettings;
        harness?: HarnessOffer;
      };
      if (!response.ok) {
        setError(data.error ?? t("That change was not saved."));
        return;
      }
      if (data.settings) {
        setHasCustomKey(data.settings.hasCustomApiKey);
        setHasUtilityKey(data.settings.hasUtilityApiKey);
        setImagesReady(data.settings.imagesReady);
        setImagesNeedModel(data.settings.imagesNeedModel === true);
      }
      if (data.harness) {
        setHarness(data.harness);
      }
      if (update.customApiKey !== undefined) {
        setKeys((prev) => ({ ...prev, customApiKey: SECRET_KEPT }));
      }
      if (update.utilityApiKey !== undefined) {
        setKeys((prev) => ({ ...prev, utilityApiKey: SECRET_KEPT }));
      }
    } catch {
      setError(t("Could not reach the server.", { context: "creator.error.unreachable" }));
    } finally {
      setBusy(false);
    }
  }

  function commitText(field: TextField) {
    const value = commitValue(text, savedText, field);
    if (value !== null) {
      void patch({ [field]: value });
    }
  }

  function commitKey(field: "customApiKey" | "utilityApiKey") {
    const value = drafts[field];
    if (value !== SECRET_KEPT) {
      void patch({ [field]: value.trim() });
    }
  }

  const harnessName = harness?.label
    ? `${t("The server's {label}", { label: harness.label })}${harness.model ? t(" ({model})", { model: harness.model }) : ""}`
    : t("The server's agent");
  // A blank model is the server's, said with its name and where it comes
  // from rather than left for the reader to infer.
  const inheritedModel = serverModel ? t("{model} · the server's model", { model: serverModel }) : t("the server's model");
  const storytellerSummary =
    settings.textProvider === "custom"
      ? settings.customModel || inheritedModel
      : settings.textProvider === "harness"
        ? harnessName
        : providerLabel(t, settings.textProvider);
  const imagesSummary = settings.imageGenerationEnabled
    ? `${backendLabel(t, settings.imageBackend)}${settings.autoImages ? t(", automatic") : ""}${
        settings.artStyle === "setting" ? "" : t(", {style} style", { style: artStyleLabel(t, settings.artStyle).toLowerCase() })
      }`
    : t("off", { context: "ai.off" });

  if (!steersStory) {
    return (
      <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-1 text-sm font-medium text-stone-300">{t("Story AI", { context: "ai.title" })}</h2>
        <p className="mb-2 text-xs text-stone-500">{t("The AI services this campaign plays with, chosen by whoever runs the story.")}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-400">
          <span className="flex items-center gap-1.5">
            <Bot className="size-3.5 text-amber-200" />
            {t("Storyteller: {summary}", { summary: storytellerSummary })}
          </span>
          <span className="flex items-center gap-1.5">
            <Wrench className="size-3.5 text-amber-200" />
            {t("Utility model: {model}", { model: settings.utilityModel || t("off", { context: "ai.off" }) })}
          </span>
          <span className="flex items-center gap-1.5">
            <ImageIcon className="size-3.5 text-amber-200" />
            {t("Images: {summary}", { summary: imagesSummary })}
          </span>
          <span className="flex items-center gap-1.5">
            <AlignLeft className="size-3.5 text-amber-200" />
            {t("Passage length: {size}", { size: settings.proseSize })}
          </span>
        </div>
      </section>
    );
  }

  const shell = shellHost();
  const backendName = { openai: "OpenAI", openrouter: "OpenRouter", local: t("local model") }[
    endpointKind(settings.customBaseUrl)
  ];
  const deviceStoryteller =
    settings.textProvider === "custom"
      ? `${settings.customModel || t("custom backend")} (${backendName})`
      : settings.textProvider === "harness"
        ? harnessName
        : providerLabel(t, settings.textProvider);
  // The agent is offered only where the admin allows it, but a campaign that
  // already chose it keeps seeing its own choice.
  const providerChoices = (Object.keys(PROVIDER_LABEL_KEYS) as TextProvider[]).filter(
    (provider) => provider !== "harness" || harness?.offered || settings.textProvider === "harness",
  );

  const selectClass =
    "rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600";
  const inputClass = cn(selectClass, "w-64 max-w-full");
  const labelClass = "w-20 shrink-0 text-stone-500";
  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
      <h2 className="mb-1 text-sm font-medium text-stone-300">{t("Story AI", { context: "ai.title" })}</h2>
      <p className="mb-3 text-xs text-stone-500">
        {t("Which AI services this campaign uses: who tells the story, the helper model, and pictures. It changes this campaign only, as soon as you pick; ")}
        {deviceManaged ? t("the device's own choice is set from the app's home screen.") : t("the server's defaults live in the admin panel.")}
      </p>
      {error ? <p className="motion-shake mb-2 text-xs text-red-400">{error}</p> : null}
      <div className={cn("space-y-3 text-xs", busy && "opacity-70")}>
        {deviceManaged === null ? null : deviceManaged ? (
          <div className="reveal space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>{t("Storyteller")}</span>
              <span className="text-stone-300">{deviceStoryteller}</span>
            </div>
            {settings.textProvider !== "none" && settings.utilityModel ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className={labelClass}>{t("Utility")}</span>
                <span className="text-stone-300">{settings.utilityModel}</span>
              </div>
            ) : null}
            <p className="text-stone-500">
              {t("Story AI is chosen once for this device, and every campaign here follows it. ")}
              {shell ? t("Change it from Story AI on the app's home screen.") : t("Change it in the app that hosts this world.")}
            </p>
            {shell ? (
              <button
                type="button"
                onClick={() => shell.showServers()}
                className="motion-press rounded-md border border-stone-700 px-2 py-1 text-stone-300 hover:border-amber-700 hover:text-amber-200"
              >
                {t("App home")}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="reveal space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>{t("Storyteller")}</span>
              <Select
                value={settings.textProvider}
                onChange={(textProvider) => patch({ textProvider })}
                options={providerChoices.map((provider) => ({
                  value: provider,
                  label: provider === "harness" ? harnessName : providerLabel(t, provider),
                }))}
                label={t("Storyteller")}
                size="sm"
              />
            </div>
            {settings.textProvider === "harness" ? (
              <p className="reveal text-stone-500">
                {t("Narrated by an agent program on this server's own sign-in, turn by turn, under the same rules and caps as the built-in storyteller. It has none of its own tools.")}
              </p>
            ) : null}
            {settings.textProvider === "custom" && serverManaged ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={labelClass}>{t("Model")}</span>
                  <input
                    aria-label={t("Model")}
                    value={drafts.customModel}
                    onChange={(event) =>
                      setDraft("customModel", event.target.value)
                    }
                    onBlur={() => commitText("customModel")}
                    onKeyDown={blurOnEnter}
                    className={inputClass}
                  />
                </div>
                <ModelNote role="story" baseUrl="" model={settings.customModel} />
                <p className="text-stone-500">
                  {settings.customModel
                    ? t("Runs on this server's backend. Clear the model to use the server's own again.")
                    : t("In use: {model}. Type a model name to choose another for this campaign.", { model: inheritedModel })}{" "}
                  {t("Only an admin can change where it points.")}
                </p>
              </>
            ) : settings.textProvider === "custom" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={labelClass}>{t("Base URL")}</span>
                  <input
                    aria-label={t("Base URL")}
                    value={drafts.customBaseUrl}
                    onChange={(event) =>
                      setDraft("customBaseUrl", event.target.value)
                    }
                    onBlur={() => commitText("customBaseUrl")}
                    onKeyDown={blurOnEnter}
                    placeholder="http://127.0.0.1:8080/v1"
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={labelClass}>{t("Model")}</span>
                  <input
                    aria-label={t("Model")}
                    value={drafts.customModel}
                    onChange={(event) =>
                      setDraft("customModel", event.target.value)
                    }
                    onBlur={() => commitText("customModel")}
                    onKeyDown={blurOnEnter}
                    className={inputClass}
                  />
                </div>
                <ModelNote role="story" baseUrl={settings.customBaseUrl} model={settings.customModel} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className={labelClass}>{t("API key", { context: "ai.apiKey" })}</span>
                  <input
                    type="password"
                    aria-label={t("API key", { context: "ai.apiKey" })}
                    value={drafts.customApiKey === SECRET_KEPT ? "" : drafts.customApiKey}
                    onChange={(event) =>
                      setKeys((prev) => ({ ...prev, customApiKey: event.target.value }))
                    }
                    onBlur={() => commitKey("customApiKey")}
                    onKeyDown={blurOnEnter}
                    placeholder={hasCustomKey ? t("•••••••• (set)", { context: "ai.keySet" }) : t("Not set", { context: "ai.keyNotSet" })}
                    className={inputClass}
                  />
                  {hasCustomKey ? (
                    <button
                      type="button"
                      onClick={() => patch({ customApiKey: "" })}
                      className="rounded-md border border-stone-700 px-2 py-1 text-stone-400 hover:text-red-400"
                    >
                      {t("Clear", { context: "action.clear" })}
                    </button>
                  ) : null}
                </div>
                <p className="text-stone-500">{t("Blank fields fall back to the server's settings.")}</p>
              </>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-stone-800/60 pt-3">
              <span className={labelClass}>{t("Utility")}</span>
              <Select
                value={settings.utilityProvider}
                onChange={(utilityProvider) => patch({ utilityProvider })}
                options={(["custom", "local"] as TextProvider[]).map((provider) => ({ value: provider, label: providerLabel(t, provider) }))}
                label={t("Utility model provider")}
                size="sm"
              />
              <input
                aria-label={t("Utility model")}
                value={drafts.utilityModel}
                onChange={(event) =>
                  setDraft("utilityModel", event.target.value)
                }
                onBlur={() => commitText("utilityModel")}
                onKeyDown={blurOnEnter}
                placeholder={t("Model (blank keeps everything on the storyteller)")}
                className={inputClass}
              />
            </div>
            {settings.utilityModel ? (
              <ModelNote role="utility" baseUrl={settings.utilityProvider === "custom" ? settings.utilityBaseUrl || settings.customBaseUrl : ""} model={settings.utilityModel} />
            ) : null}
            {settings.utilityProvider === "custom" && settings.utilityModel && !serverManaged ? (
              <div className="reveal flex flex-wrap items-center gap-2">
                <span className={labelClass}>{t("Utility URL")}</span>
                <input
                  aria-label={t("Utility URL")}
                  value={drafts.utilityBaseUrl}
                  onChange={(event) =>
                    setDraft("utilityBaseUrl", event.target.value)
                  }
                  onBlur={() => commitText("utilityBaseUrl")}
                  onKeyDown={blurOnEnter}
                  placeholder={t("Blank: the storyteller's server")}
                  className={inputClass}
                />
                <input
                  type="password"
                  aria-label={t("API key", { context: "ai.apiKey" })}
                  value={drafts.utilityApiKey === SECRET_KEPT ? "" : drafts.utilityApiKey}
                  onChange={(event) =>
                    setKeys((prev) => ({ ...prev, utilityApiKey: event.target.value }))
                  }
                  onBlur={() => commitKey("utilityApiKey")}
                  onKeyDown={blurOnEnter}
                  placeholder={hasUtilityKey ? t("•••••••• (set)", { context: "ai.keySet" }) : t("API key (optional)")}
                  className={cn(selectClass, "w-40")}
                />
                {hasUtilityKey ? (
                  <button
                    type="button"
                    onClick={() => patch({ utilityApiKey: "" })}
                    className="rounded-md border border-stone-700 px-2 py-1 text-stone-400 hover:text-red-400"
                  >
                    {t("Clear", { context: "action.clear" })}
                  </button>
                ) : null}
              </div>
            ) : null}

          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-800/60 pt-3">
          <span className={labelClass}>{t("Images")}</span>
          <Select<ImageBackend | "off">
            value={settings.imageGenerationEnabled ? settings.imageBackend : "off"}
            label={t("Images")}
            size="sm"
            options={[
              { value: "off", label: t("Off", { context: "ai.imagesOff" }) },
              // On a device the backend follows the device; only on and off
              // are this campaign's to choose.
              ...(deviceManaged
                ? [settings.imageBackend]
                : (["comfyui", "openai", "mflux-hs", "sdnq-hs", "harness"] as ImageBackend[]).filter(
                    (backend) => backend !== "harness" || harness?.pictures || settings.imageBackend === "harness",
                  )
              ).map((backend) => ({ value: backend, label: backendLabel(t, backend) })),
            ]}
            onChange={(value) => {
              // "Off" is imageGenerationEnabled, not a backend: picking a
              // backend again switches images back on in the same PATCH.
              void patch(
                value === "off"
                  ? { imageGenerationEnabled: false }
                  : { imageBackend: value, imageGenerationEnabled: true },
              );
            }}
          />
          {settings.imageGenerationEnabled ? (
            <>
              <Select<StorySettings["aspect"]>
                value={settings.aspect}
                onChange={(aspect) => patch({ aspect })}
                options={[
                  { value: "square", label: t("Square") },
                  { value: "portrait", label: t("Portrait") },
                  { value: "landscape", label: t("Landscape") },
                ]}
                label={t("Picture shape")}
                size="sm"
              />
              <Select<StorySettings["imageMode"]>
                value={settings.imageMode}
                onChange={(imageMode) => patch({ imageMode })}
                options={[
                  { value: "fast", label: t("Fast") },
                  { value: "slow", label: t("Slow (higher quality)") },
                ]}
                label={t("Picture speed")}
                size="sm"
              />
              <button
                type="button"
                onClick={() => patch({ autoImages: !settings.autoImages })}
                className={cn(
                  "rounded-md border px-2 py-1",
                  settings.autoImages
                    ? "border-amber-700 bg-amber-950/50 text-amber-200"
                    : "border-stone-700 text-stone-400",
                )}
              >
                {t("Auto scenes")}
              </button>
            </>
          ) : null}
        </div>
        {settings.imageGenerationEnabled &&
        imagesNeedModel &&
        (settings.imageBackend === "openai" || (settings.imageBackend === "comfyui" && serverImagesNeedModel)) ? (
          <p className="reveal text-amber-400/90">
            {deviceManaged && settings.imageBackend === "openai"
              ? t("No picture model is saved on this device, so nothing is painted. Save your key again from Story AI on the app's home screen, which picks one from the key's list, or pick one in Admin > Image generation.")
              : serverManaged
                ? t("No picture model is picked on this server, so nothing is painted. An admin picks one in Admin > Image generation.")
                : t("No picture model is picked, so nothing is painted until one is. Pick it in Admin > Image generation.")}
          </p>
        ) : settings.imageGenerationEnabled && settings.imageBackend === "openai" && !imagesReady ? (
          <p className="reveal text-amber-400/90">
            {deviceManaged
              ? t("No OpenAI API key is saved on this device. Add one from Story AI on the app's home screen and it covers narration and pictures in every campaign.")
              : serverManaged
                ? t("The OpenAI picture backend has no API key. An admin adds one in Admin > Image generation.")
                : t("The OpenAI picture backend has no API key. Add one in Admin > Image generation, or point this story's text model at OpenAI so its key covers pictures too.")}
          </p>
        ) : settings.imageGenerationEnabled && !imagesConfigured && imagesReady ? (
          <p className="reveal text-amber-400/90">
            {t("The server has no image backend configured; these settings will not take effect until it does.")}
          </p>
        ) : settings.imageGenerationEnabled && !deviceManaged ? (
          <ImagesNote backend={settings.imageBackend} />
        ) : null}
        {settings.imageGenerationEnabled ? (
          <div className="reveal space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>{t("Art style")}</span>
              <Select<ArtStyle>
                value={settings.artStyle}
                onChange={(artStyle) => patch({ artStyle })}
                options={ART_STYLES.map((style) => ({ value: style, label: artStyleLabel(t, style) }))}
                label={t("Art style")}
                size="sm"
              />
              <span key={settings.artStyle} className="reveal text-stone-500">
                {artStyleNote(t, settings.artStyle)}
              </span>
            </div>
            {settings.artStyle === "custom" ? (
              <div className="reveal space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={labelClass}>{t("Maps")}</span>
                  <input
                    value={drafts.artStyleMap}
                    onChange={(event) => setDraft("artStyleMap", event.target.value)}
                    onBlur={() => commitText("artStyleMap")}
                    onKeyDown={blurOnEnter}
                    maxLength={ART_STYLE_TEXT_MAX}
                    placeholder="Realistic terrain from above, clear paths"
                    aria-label={t("Map style")}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={labelClass}>{t("Scenes")}</span>
                  <input
                    value={drafts.artStyleScene}
                    onChange={(event) => setDraft("artStyleScene", event.target.value)}
                    onBlur={() => commitText("artStyleScene")}
                    onKeyDown={blurOnEnter}
                    maxLength={ART_STYLE_TEXT_MAX}
                    placeholder="Photorealistic, cinematic light"
                    aria-label={t("Scene style")}
                    className={inputClass}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-800/60 pt-3">
          <span className={labelClass}>{t("Passages")}</span>
          <Select<StorySettings["proseSize"]>
            value={settings.proseSize}
            onChange={(proseSize) => patch({ proseSize })}
            options={PROSE_SIZE_VALUES.map((size) => ({ value: size, label: ({ "tiny": t("Tiny", { context: "art.prose.tiny" }), "xsmall": t("Very short"), "small": t("Short"), "medium": t("Medium", { context: "art.prose.medium" }), "large": t("Long"), "xlarge": t("Very long"), "xxlarge": t("Huge"), "huge": t("Vast", { context: "art.prose.huge" }), "giant": t("Epic") } as Record<string, string>)[size] ?? String(size) }))}
            label={t("Passages")}
            size="sm"
          />
          <span className="text-stone-500">{t("How long each narrated passage runs.")}</span>
        </div>
      </div>
    </section>
  );
}
