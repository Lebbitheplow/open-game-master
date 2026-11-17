"use client";

import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";
import type { ComfyModelReport, ComfyStatus } from "@/lib/comfyui";
import { CHECKPOINT_PRESET, comfyModel } from "@/lib/image-models/catalog";
import { checkpointModel, obviousComfyChoice, paintsHere } from "@/lib/image-models/curate";
import { listWords, measuredLine } from "@/lib/image-models/describe";
import { honoursNegative } from "@/lib/image-models/workflow";
import { ComfyModelCatalog } from "@/app/admin/ComfyModelCatalog";
import { ModelChoiceField } from "@/app/admin/ModelChoice";
import { blanks, fromEnv } from "@/app/admin/model-blanks";
import { useT } from "@/lib/locale";
import type { MessageKey } from "@/lib/messages-logic";
import {
  Field,
  SECRET_KEPT,
  SecretField,
  SelectField,
  type EnvDefaults,
  type MaskedConfig,
  inheritedHint,
} from "@/app/admin/AdminSettingsFields";

// Image generation. The picker names the backend new campaigns start on; a
// campaign may still pick any backend that is set up here, so each backend
// keeps its own block of fields (address, model, key), the chosen one open
// and first, the rest folded away under it (issue 89: the fields used to sit
// in one flat grid, and nothing said which belonged to which backend).

type Images = MaskedConfig["images"];
type Group = "comfyui" | "flux" | "openai";
const PRESET_PREFIX = "preset:";
const CHECKPOINT_PREFIX = "checkpoint:";

// What the last check of this ComfyUI found (src/lib/comfyui.ts comfyStatus).
export type ComfyDiscovery = Pick<ComfyStatus, "checkpoints" | "models" | "hardware" | "device"> & { error: string | null };

type Discovery = ComfyDiscovery & { url: string; revision: number };

const fileName = (name: string) => name.split(/[\\/]/).pop() || name;

// A catalog model loaded from a checkpoint is offered as that checkpoint;
// the others as models of their own.
const loadsCheckpoint = (id: string) => {
  const model = comfyModel(id);
  return Boolean(model && "checkpoint" in model.graph.load);
};

// The picker: "None", the catalog models this ComfyUI has every file for
// (measured ones first), then its picture checkpoints, the obvious one marked
// recommended (never picked for the admin). The saved choice stays listed
// when the check no longer finds it. `discovery` is null until a check has
// answered.
export function comfyModelOptions(
  t: (key: string, vars?: Record<string, string | number>) => string,
  saved: { checkpoint: string; preset: string },
  discovery: ComfyDiscovery | null,
) {
  const BLANK = blanks(t);
  const succeeded = Boolean(discovery && !discovery.error);
  const hardware = discovery?.hardware?.label ?? null;
  const reports = discovery?.models ?? [];
  const checkpoints = discovery?.checkpoints ?? [];
  // The picker offers what runs here; the saved model stays whatever its
  // verdict, flagged, never swapped.
  const installed = reports.filter((report) => !report.missing.length && !loadsCheckpoint(report.id) && (paintsHere(report) || report.id === saved.preset));
  const savedModel = saved.preset !== CHECKPOINT_PRESET ? comfyModel(saved.preset) : undefined;
  const models = [
    ...installed.map((report) => ({ id: report.id, report })),
    ...(savedModel && !installed.some((report) => report.id === savedModel.id) ? [{ id: savedModel.id, report: null }] : []),
  ];
  const checkpointHint = (name: string) => {
    if (name === saved.checkpoint && succeeded && !checkpoints.includes(name)) return t("Saved selection; not reported by this ComfyUI.");
    const known = checkpointModel(name);
    if (!known) return undefined;
    const report = reports.find((entry) => entry.id === known.id);
    return report?.verified ? `${known.label}. ${measuredLine(t, report, hardware)}` : t("{name} settings.", { name: known.label });
  };
  const unpicked = saved.preset === CHECKPOINT_PRESET && !saved.checkpoint;
  const obvious = unpicked && discovery && succeeded ? obviousComfyChoice(discovery) : null;
  const recommended = (label: string, isIt: boolean) => (isIt ? `${label}${t(" (recommended)")}` : label);
  return [
    // Nothing is painted in checkpoint mode until a checkpoint is picked:
    // no file is named in code, and none is taken from ComfyUI's list.
    { value: CHECKPOINT_PREFIX, label: BLANK.checkpoint },
    ...models.map(({ id, report }) => ({
      value: `${PRESET_PREFIX}${id}`,
      label: recommended(comfyModel(id)?.label ?? id, obvious?.preset === id),
      group: t("Models"),
      ...(report ? { hint: measuredLine(t, report, hardware) } : succeeded ? { hint: t("Its files are not all on this ComfyUI.") } : {}),
    })),
    ...[saved.checkpoint, ...checkpoints]
      .filter((name, index, names) => name && names.indexOf(name) === index)
      .map((name) => {
        const hint = checkpointHint(name);
        return { value: `${CHECKPOINT_PREFIX}${name}`, label: recommended(name, obvious?.checkpoint === name), group: t("Checkpoints"), ...(hint ? { hint } : {}) };
      }),
  ];
}

export function comfyModelPatch(value: string, options: ReturnType<typeof comfyModelOptions>): Partial<Images> | null {
  if (!options.some((option) => option.value === value)) return null;
  if (value.startsWith(PRESET_PREFIX)) return { comfyWorkflowPreset: value.slice(PRESET_PREFIX.length) };
  if (value.startsWith(CHECKPOINT_PREFIX)) {
    return { comfyWorkflowPreset: CHECKPOINT_PRESET, comfyCheckpoint: value.slice(CHECKPOINT_PREFIX.length) };
  }
  return null;
}

export async function fetchComfyModels(
  t: (key: string, vars?: Record<string, string | number>) => string,
  url: string,
  signal: AbortSignal,
): Promise<ComfyDiscovery> {
  const response = await fetch("/api/comfy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  const result = (await response.json()) as Partial<ComfyStatus>;
  if (!response.ok || !result.ok) {
    return { checkpoints: [], models: [], hardware: null, device: null, error: result.error || t("Could not check ComfyUI.") };
  }
  return {
    checkpoints: Array.isArray(result.checkpoints) ? result.checkpoints.filter((name): name is string => typeof name === "string") : [],
    models: Array.isArray(result.models) ? result.models.filter((entry): entry is ComfyModelReport => Boolean(entry && typeof entry.id === "string")) : [],
    hardware: result.hardware ?? null,
    device: result.device ?? null,
    error: null,
  };
}

// The line under the picker: what the check found for the model chosen.
export function comfyModelStatus(
  t: (key: string, vars?: Record<string, string | number>) => string,
  discovery: ComfyDiscovery | null,
  preset: string,
) {
  if (!discovery) return t("Checking installed models…");
  if (discovery.error) return discovery.error;
  const model = preset === CHECKPOINT_PRESET ? undefined : comfyModel(preset);
  if (!model) {
    return discovery.checkpoints.length
      ? t("Installed checkpoints from ComfyUI.")
      : t("No checkpoints reported by ComfyUI.");
  }
  const report = discovery.models.find((entry) => entry.id === model.id);
  if (!report || report.missing.length) {
    // No report to list from: the named-model variant says it whole.
    return report
      ? t("This ComfyUI is missing {list}.", { list: listWords(t, report.missing.map((file) => file.what)) })
      : t("This ComfyUI is missing the {model} files.", { model: model.label });
  }
  const files = listWords(t, Object.values(report.files).map(fileName));
  return t("Paints every campaign's ComfyUI pictures with {files}.{negative}", {
    files,
    negative: honoursNegative(model) ? "" : t(" It runs without a negative prompt, so a table's boundary cannot keep anything out of its pictures."),
  });
}

// Said under a picture backend whose model is blank. No model is named in
// code, so it paints nothing until one is picked; an upgrade from a version
// that named one lands here.
function NoPictureModel() {
  const t = useT();
  return (
    <p role="status" className="text-[11px] leading-4 text-amber-300 sm:col-span-2" data-needs-model>
      {t("No model is picked, so nothing is painted until you pick one.")}
    </p>
  );
}

function ComfyModelField({
  images,
  env,
  onChange,
}: {
  images: Images;
  env: EnvDefaults;
  onChange: (patch: Partial<Images>) => void;
}) {
  const t = useT();
  const url = images.comfyUrl || env.comfyUrl;
  const [revision, setRevision] = useState(0);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await fetchComfyModels(t, url, controller.signal);
        if (!controller.signal.aborted) setDiscovery({ url, revision, ...result });
      } catch {
        if (!controller.signal.aborted) {
          setDiscovery({ url, revision, checkpoints: [], models: [], hardware: null, device: null, error: t("Could not check ComfyUI. Check the server URL.") });
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, revision]);

  const current = discovery?.url === url && discovery.revision === revision ? discovery : null;
  const preset = images.comfyWorkflowPreset;
  const options = comfyModelOptions(t, { checkpoint: images.comfyCheckpoint, preset }, current);
  const selected = preset !== CHECKPOINT_PRESET ? `${PRESET_PREFIX}${preset}` : `${CHECKPOINT_PREFIX}${images.comfyCheckpoint}`;
  const report = current?.models.find((entry) => entry.id === preset);
  const missing = Boolean(current && !current.error && preset !== CHECKPOINT_PRESET && (!report || report.missing.length));
  // Said once ComfyUI has answered, when there is something to pick from.
  const unpicked = Boolean(current && !current.error) && preset === CHECKPOINT_PRESET && !images.comfyCheckpoint.trim();

  // The picker sits beside the address; the catalog spans the row under both.
  return (
    <>
      <div>
        <SelectField<string>
          label={t("Image model")}
          value={selected}
          onChange={(value) => {
            const patch = comfyModelPatch(value, options);
            if (patch) onChange(patch);
          }}
          options={options}
        />
        <div className="mt-1 flex items-start justify-between gap-2">
          <p role={current?.error || missing ? "alert" : "status"} className="text-[11px] leading-4 text-stone-500">
            {comfyModelStatus(t, current, preset)}
          </p>
          <button type="button" className="shrink-0 text-[11px] text-amber-300 hover:text-amber-200" onClick={() => setRevision((value) => value + 1)}>
            {t("Refresh", { context: "admin.images.refresh" })}
          </button>
        </div>
      </div>
      {unpicked ? <NoPictureModel /> : null}
      {current && !current.error ? (
        <div className="sm:col-span-2">
          <ComfyModelCatalog discovery={current} preset={preset} checkpoint={images.comfyCheckpoint} onPick={onChange} />
        </div>
      ) : null}
    </>
  );
}

function groupOf(backend: string): Group | null {
  if (backend === "comfyui") return "comfyui";
  if (backend === "mflux-hs" || backend === "sdnq-hs") return "flux";
  if (backend === "openai") return "openai";
  return null;
}

// The group titles, by backend group.
const GROUP_KEYS: Record<Group, MessageKey> = {
  comfyui: "ComfyUI",
  flux: "FLUX worker",
  openai: "OpenAI-compatible images API",
};

export function AdminImagesSection({
  images,
  env,
  harness,
  phoneWorld,
  openaiKey,
  onImages,
  onOpenaiKey,
}: {
  images: Images;
  env: EnvDefaults;
  harness: MaskedConfig["harness"];
  // A phone cannot run ComfyUI or a FLUX worker.
  phoneWorld: boolean;
  openaiKey: string;
  onImages: (images: Images) => void;
  onOpenaiKey: (value: string) => void;
}) {
  const t = useT();
  const BLANK = blanks(t);
  const set = (patch: Partial<Images>) => onImages({ ...images, ...patch });
  // The backend "Auto" resolves to, so its fields are the ones shown open.
  const effective = images.defaultBackend || env.imageBackend || "comfyui";
  const active = groupOf(effective);

  const blocks: Record<Group, React.ReactNode> = {
    comfyui: (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Server URL")} hint={inheritedHint(t, images.comfyUrl, env.comfyUrl)}>
          <input
            className={ui.input}
            value={images.comfyUrl}
            onChange={(event) => set({ comfyUrl: event.target.value })}
            placeholder={env.comfyUrl}
          />
        </Field>
        <ComfyModelField images={images} env={env} onChange={set} />
      </div>
    ),
    flux: (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Worker URL")} hint={inheritedHint(t, images.fluxWorkerUrl, env.fluxWorkerUrl, t("The worker loads its own FLUX model."))}>
          <input
            className={ui.input}
            value={images.fluxWorkerUrl}
            onChange={(event) => set({ fluxWorkerUrl: event.target.value })}
            placeholder={env.fluxWorkerUrl}
          />
        </Field>
      </div>
    ),
    openai: (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t("Server base URL")}
          hint={t("OpenAI itself, or any server with OpenAI's /v1/images/generations. Blank = api.openai.com.")}
        >
          <input
            className={ui.input}
            value={images.openaiBaseUrl}
            onChange={(event) => set({ openaiBaseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
        <ModelChoiceField
          label={t("Model")}
          hint={t("The picture models the server lists.")}
          role="image"
          provider="images"
          baseUrl={images.openaiBaseUrl}
          apiKey={openaiKey === SECRET_KEPT ? "" : openaiKey}
          value={images.openaiModel}
          onChange={(openaiModel) => set({ openaiModel })}
          blankLabel={env.openaiImageModel ? fromEnv(t, env.openaiImageModel, "OPENAI_IMAGE_MODEL") : BLANK.picture}
        />
        <SecretField
          label={t("API key", { context: "admin.images.apiKey" })}
          isSet={images.hasOpenaiApiKey}
          value={openaiKey}
          onChange={onOpenaiKey}
          hint={
            env.hasOpenaiImageApiKey
              ? t("An env-var key is also set; this one wins when filled.")
              : t("Billed to whoever owns the key. Used only when a campaign's backend is this API.")
          }
        />
        {!images.openaiModel.trim() && !env.openaiImageModel ? <NoPictureModel /> : null}
      </div>
    ),
  };

  const offered = (["comfyui", "flux", "openai"] as Group[]).filter((group) => !phoneWorld || group === "openai");
  const others = offered.filter((group) => group !== active);
  // A folded backend's fields are drawn once it is opened, so its pickers
  // do not ask a server (with the saved key) the admin is not using.
  const [opened, setOpened] = useState<Group[]>([]);

  return (
    <PageSection id="admin-images" heading={t("Image generation")} glyph="ui-paint">
      <div className="mb-3">
        <SelectField<Images["defaultBackend"]>
          label={t("Default backend")}
          hint={
            phoneWorld
              ? t("For new campaigns. The OpenAI-compatible API renders on another machine with the key below and needs no GPU here.")
              : t("For new campaigns; a campaign can pick any backend that is set up below. ComfyUI and the FLUX workers run on this machine; an OpenAI-compatible API renders wherever its address points.")
          }
          value={images.defaultBackend}
          onChange={(defaultBackend) => set({ defaultBackend })}
          options={[
            { value: "", label: t("Auto ({name})", { name: env.imageBackend || "ComfyUI" }) },
            ...(phoneWorld ? [] : [{ value: "comfyui" as const, label: t("ComfyUI (local)") }]),
            { value: "openai", label: t("OpenAI-compatible images API") },
            ...(phoneWorld
              ? []
              : [
                  { value: "mflux-hs" as const, label: t("FLUX worker: mflux (Apple Silicon)") },
                  { value: "sdnq-hs" as const, label: t("FLUX worker: sdnq (CUDA/ROCm)") },
                ]),
            // Only once the agent program has painted a real test picture.
            ...(harness?.images === "native" && harness.imagesVerifiedAt
              ? [{ value: "harness" as const, label: t("The agent program's own pictures") }]
              : []),
          ]}
        />
      </div>
      {active && offered.includes(active) ? (
        // Keyed, so picking another backend brings its block in.
        <div key={active} className="reveal">
          <h3 className="mb-2 text-sm font-medium text-stone-200">{t(GROUP_KEYS[active])}</h3>
          {blocks[active]}
        </div>
      ) : effective === "harness" ? (
        <p className="reveal text-xs text-stone-500">
          {t("Pictures come from the agent program set up in the Agent section; it has no address or key of its own.")}
        </p>
      ) : null}
      {others.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-stone-500">{t("Other backends a campaign can pick:")}</p>
          {others.map((group) => (
            <details
              key={group}
              className="rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2"
              onToggle={(event) => {
                if (event.currentTarget.open && !opened.includes(group)) setOpened([...opened, group]);
              }}
            >
              <summary className="cursor-pointer text-sm text-stone-300">{t(GROUP_KEYS[group])}</summary>
              {opened.includes(group) ? <div className="mt-3">{blocks[group]}</div> : null}
            </details>
          ))}
        </div>
      ) : null}
    </PageSection>
  );
}
