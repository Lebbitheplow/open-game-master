// One answer for every model picker: what the configured backend lists
// right now, what the catalog knows of each row, whether each can do what
// the role needs, what the admin's own tests found, and the model already
// chosen, which is always on the list whether or not the backend still
// lists it. Nothing here changes a setting: a model that went missing is
// flagged, never swapped. The one a form recommends for a blank field is
// named, so a pick saves a real name and nothing is guessed when a request
// goes out.

import { probeHarness } from "@/lib/harness/status";
import { isHarnessId, type HarnessId } from "@/lib/harness/types";
import { assessModel, findCatalogModel, isSpeechModelId, providerForBaseUrl, type CatalogModel, type ModelRole, type ModelVerdict } from "./catalog-logic";
import { catalogStatus, harnessCatalogProvider, modelCatalog, recommendListed, type CatalogStatus } from "./catalog";
import { listCustomModels, listImageModels, listOllamaModels, listSpeechModels, ollamaBaseUrl, ollamaModelInfo } from "./discovery";
import { isOllamaChatModel } from "./discovery-logic";
import { describeMachine, machine, memoryBudgetGb, type Machine } from "./hardware";
import { probeRecordFor, type ProbeRecord } from "./probes";

export type RegistryProvider = "local" | "custom" | "harness" | "images" | "speech";

export type RegistryModel = {
  id: string;
  label: string;
  // Whether the backend lists it now; null when the backend could not be
  // asked (unreachable, or a kind that keeps no list).
  listed: boolean | null;
  selected: boolean;
  catalog: CatalogModel | null;
  verdict: ModelVerdict;
  tested: ProbeRecord | null;
  // The window the prompt would be packed against, 0 when nobody knows.
  contextTokens: number;
  // A word from the backend itself: Ollama's size and quantisation, an
  // agent program's "cheap".
  note: string;
};

export type ModelChoices = {
  role: ModelRole;
  provider: RegistryProvider;
  baseUrl: string;
  // Whether the backend answered; null for one that was not asked.
  reachable: boolean | null;
  error: string;
  needsKey: boolean;
  models: RegistryModel[];
  // The listed model a picture or speech form recommends for a blank field
  // (the guided setup fills it in): the catalog's pick for pictures; for
  // speech, the server's only model (what a blank Whisper field runs,
  // src/lib/stt.ts), else the one model that reads as a speech model of the
  // role's kind; "" when there is no obvious one, and always "" for the
  // storyteller's roles.
  recommended: string;
  catalog: CatalogStatus;
  // This machine, for the local provider: what the weights have to fit in.
  hardware: { summary: string; budgetGb: number } | null;
};

export type ModelChoicesInput = {
  role: ModelRole;
  provider: RegistryProvider;
  baseUrl?: string;
  apiKey?: string;
  selected: string;
  harnessId?: string;
};

type Found = { id: string; label?: string; contextTokens?: number; note?: string; tools?: boolean | null; sizeGb?: number };

// Ollama resolves tags without regard to case ("Gemma4:31b" serves
// gemma4:31b), so the local provider matches the same way.
function sameId(provider: RegistryProvider, a: string, b: string): boolean {
  return provider === "local" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function row(
  input: { role: ModelRole; provider: RegistryProvider; providerHint: string; selected: string; baseUrl: string; machine?: Machine | null },
  found: Found,
  listed: boolean | null,
): RegistryModel {
  const catalog = findCatalogModel(modelCatalog().providers, found.id, input.providerHint);
  const local = input.provider === "local";
  const memory = local && input.machine && found.sizeGb ? { sizeGb: found.sizeGb, budgetGb: memoryBudgetGb(input.machine) } : null;
  // The server's own word on the window outranks the catalog row's, as in
  // fitListedModels (catalog.ts): the row is the model's usual size, the
  // server says what it was launched with. A helper served at 262,144 was
  // reported as "a 33K window is small for a campaign" (issue #925).
  const judged = catalog && found.contextTokens ? { ...catalog, contextTokens: found.contextTokens } : catalog;
  return {
    id: found.id,
    label: found.label || found.id,
    listed,
    selected: sameId(input.provider, found.id, input.selected),
    catalog,
    verdict: assessModel({ role: input.role, id: found.id, catalog: judged, listed, local, tools: found.tools ?? null, memory, contextTokens: found.contextTokens }),
    tested: input.provider === "harness" ? null : probeRecordFor(input.baseUrl, found.id),
    contextTokens: found.contextTokens || catalog?.contextTokens || 0,
    note: found.note ?? "",
  };
}

// The chosen model joins the list when the backend did not name it: as
// "not listed" when the backend answered, as merely unlisted when it did not.
function withSelected(
  provider: RegistryProvider,
  models: RegistryModel[],
  make: (found: Found, listed: boolean | null) => RegistryModel,
  selected: string,
  reachable: boolean | null,
): RegistryModel[] {
  const id = selected.trim();
  if (!id || models.some((model) => sameId(provider, model.id, id))) return models;
  return [make({ id }, reachable === true ? false : null), ...models];
}

export async function modelChoices(input: ModelChoicesInput): Promise<ModelChoices> {
  const selected = input.selected.trim();
  const base = {
    role: input.role,
    provider: input.provider,
    error: "",
    needsKey: false,
    recommended: "",
    catalog: catalogStatus(),
    hardware: null,
  };

  if (input.provider === "local") {
    const baseUrl = input.baseUrl?.trim() || ollamaBaseUrl();
    const [listing, here] = await Promise.all([listOllamaModels(baseUrl), machine()]);
    const hardware = { summary: describeMachine(here), budgetGb: memoryBudgetGb(here) };
    const make = (found: Found, listed: boolean | null) => row({ ...input, providerHint: "", selected, baseUrl, machine: here }, found, listed);
    if (!listing.ok) {
      return { ...base, hardware, baseUrl, reachable: false, error: listing.error, models: withSelected("local", [], make, selected, false) };
    }
    // Each model's own window and abilities, from Ollama itself (asked once
    // per process): the prompt packs against the window, and Ollama's word
    // on tool calls outranks a catalog row for the same weights elsewhere.
    const infos = await Promise.all(listing.models.map((model) => ollamaModelInfo(model.id, baseUrl)));
    const models = listing.models
      .map((model, index) => ({ model, info: infos[index] }))
      .filter(({ model, info }) => isOllamaChatModel(model, info))
      .map(({ model, info }) =>
        make(
          {
            id: model.id,
            contextTokens: info?.contextTokens,
            note: [model.parameters, model.quantization, model.sizeGb ? `${model.sizeGb} GB` : ""].filter(Boolean).join(" · "),
            tools: info?.capabilities.length ? info.capabilities.includes("tools") : null,
            sizeGb: model.sizeGb,
          },
          true,
        ),
      );
    return { ...base, hardware, baseUrl, reachable: true, models: withSelected("local", models, make, selected, true) };
  }

  if (input.provider === "custom") {
    const baseUrl = input.baseUrl?.trim() ?? "";
    const hint = providerForBaseUrl(baseUrl, modelCatalog().providers);
    const make = (found: Found, listed: boolean | null) => row({ ...input, providerHint: hint, selected, baseUrl }, found, listed);
    const listing = await listCustomModels(baseUrl, input.apiKey ?? "");
    if (!listing.ok) {
      return {
        ...base,
        baseUrl: listing.baseUrl,
        reachable: false,
        error: listing.error,
        needsKey: Boolean(listing.needsKey),
        models: withSelected("custom", [], make, selected, false),
      };
    }
    const models = listing.models.map((model) => make({ id: model.id, label: model.label, contextTokens: model.context }, true));
    return { ...base, baseUrl: listing.baseUrl, reachable: true, models: withSelected("custom", models, make, selected, true) };
  }

  if (input.provider === "images") {
    const baseUrl = input.baseUrl?.trim() || "https://api.openai.com/v1";
    const providers = modelCatalog().providers;
    const hint = providerForBaseUrl(baseUrl, providers);
    const make = (found: Found, listed: boolean | null) => row({ ...input, providerHint: hint, selected, baseUrl }, found, listed);
    const paints = (id: string): boolean | null => {
      const found = findCatalogModel(providers, id, hint);
      return found ? found.output.includes("image") : null;
    };
    const listing = await listImageModels(baseUrl, input.apiKey ?? "", paints);
    if (!listing.ok) {
      return {
        ...base,
        baseUrl: listing.baseUrl,
        reachable: false,
        error: listing.error,
        needsKey: Boolean(listing.needsKey),
        models: withSelected("images", [], make, selected, false),
      };
    }
    const models = listing.models.map((id) => make({ id }, true));
    const recommended = recommendListed(listing.baseUrl, listing.models.map((id) => ({ id, label: id })), "image");
    return { ...base, baseUrl: listing.baseUrl, reachable: true, recommended, models: withSelected("images", models, make, selected, true) };
  }

  if (input.provider === "speech") {
    const baseUrl = input.baseUrl?.trim() ?? "";
    const hint = providerForBaseUrl(baseUrl, modelCatalog().providers);
    const make = (found: Found, listed: boolean | null) => row({ ...input, providerHint: hint, selected, baseUrl }, found, listed);
    const listing = await listSpeechModels(baseUrl, input.apiKey ?? "");
    if (!listing.ok) {
      return {
        ...base,
        baseUrl: listing.baseUrl,
        reachable: false,
        error: listing.error,
        needsKey: Boolean(listing.needsKey),
        models: withSelected("speech", [], make, selected, false),
      };
    }
    const role = input.role === "narration" || input.role === "dictation" ? input.role : null;
    const named = role ? listing.models.filter((id) => isSpeechModelId(id, role)) : [];
    const models = listing.models.map((id) => make({ id }, true));
    return {
      ...base,
      baseUrl: listing.baseUrl,
      reachable: true,
      recommended: listing.models.length === 1 ? listing.models[0] : named.length === 1 ? named[0] : "",
      models: withSelected("speech", models, make, selected, true),
    };
  }

  // The agent program's own list, from its own discovery (model/list, the
  // `models` command, or the documented aliases). Its vendor's rows are the
  // catalog's word on each.
  const harnessId: HarnessId | null = isHarnessId(input.harnessId) ? input.harnessId : null;
  const make = (found: Found, listed: boolean | null) =>
    row({ ...input, providerHint: harnessId ? harnessCatalogProvider(harnessId, found.id) : "", selected, baseUrl: "" }, found, listed);
  if (!harnessId) {
    return { ...base, baseUrl: "", reachable: null, error: "No agent program is chosen.", models: withSelected("harness", [], make, selected, null) };
  }
  const status = await probeHarness(harnessId);
  const ready = status.installed && status.auth.state === "ready";
  const models = status.models.map((model) =>
    make({ id: model.id, label: model.label, contextTokens: model.contextTokens, note: model.cheap ? "cheap" : "" }, true),
  );
  return {
    ...base,
    baseUrl: "",
    reachable: ready,
    error: ready ? "" : status.message || `${status.label} is not ready.`,
    models: withSelected("harness", models, make, selected, ready ? true : null),
  };
}
