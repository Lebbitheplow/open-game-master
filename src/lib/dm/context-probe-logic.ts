// Reading a context window out of an OpenAI-compatible endpoint's /props.
//
// Split out of model-client.ts so it can be tested directly: the shape of
// this response is the fragile part, it varies by llama.cpp version and by
// whether the server is running as a single model or as a --models-preset
// router, and getting it wrong fails silently as an under-budgeted prompt
// rather than as an error.
//
// Dependency-free so scripts/test-context-probe.mjs can import it directly.

export function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

// A --models-preset router serves several models from one port, each launched
// with its own -c. Without the model query it answers for the ROUTER, which
// reports n_ctx 0 and model "none": indistinguishable from a miss, and it
// would quietly drop the budget to the conservative default.
export function buildPropsUrl(baseUrl: string, model: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    return "";
  }
  return model ? `${base}/props?model=${encodeURIComponent(model)}` : `${base}/props`;
}

export type PropsShape = {
  n_ctx?: unknown;
  default_generation_settings?: { n_ctx?: unknown } | null;
  chat_template?: unknown;
};

// How the model's chat template is told to think less, from the template
// llama-server reports on /props: "effort" for one that reads
// reasoning_effort and has no thinking switch (gpt-oss's Harmony template,
// which ignores enable_thinking and reasons at "medium" whatever it is
// sent), "switch" for one with enable_thinking (Qwen, Gemma), null when it
// says neither or the server sent no template.
export function readReasoningKnob(props: PropsShape | null | undefined): "effort" | "switch" | null {
  const template = props && typeof props.chat_template === "string" ? props.chat_template : "";
  if (template.includes("enable_thinking")) {
    return "switch";
  }
  return template.includes("reasoning_effort") ? "effort" : null;
}

// Newer llama.cpp exposes n_ctx at the top level; older builds and the router
// nest it under default_generation_settings. Zero means "the server did not
// really answer for a model", so it is treated as absent rather than as a
// context window of zero.
export function readContextWindow(props: PropsShape | null | undefined): number | null {
  if (!props || typeof props !== "object") {
    return null;
  }
  const candidates = [props.n_ctx, props.default_generation_settings?.n_ctx];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return null;
}

// How many parameters the model behind an OpenAI-compatible endpoint has, from
// its /v1/models listing: llama-server reports meta.n_params for each model it
// has loaded. The entry is the one named (by id or alias), or the only one
// listed when none is named or the name matches none (a single-model server
// answers to any name). Null when the listing says nothing.
export function readModelParams(listing: unknown, model: string): number | null {
  const data = listing && typeof listing === "object" ? (listing as { data?: unknown }).data : null;
  if (!Array.isArray(data)) {
    return null;
  }
  const entries = data.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  const wanted = (model ?? "").trim().toLowerCase();
  const named = (entry: Record<string, unknown>) =>
    [entry.id, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].some(
      (name) => typeof name === "string" && name.trim().toLowerCase() === wanted,
    );
  const entry = (wanted ? entries.find(named) : null) ?? (entries.length === 1 ? entries[0] : null);
  const meta = entry?.meta && typeof entry.meta === "object" ? (entry.meta as { n_params?: unknown }) : null;
  const count = meta?.n_params;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : null;
}

// The size a model's name states ("qwen3.5-9b", "gemma4:12b-it", "Qwen3-30B-A3B"
// reads 30: the first figure is the whole model), for a server that reports
// none. Not a list of models: the convention every release names its size by.
// Null when the name carries no such figure.
export function paramsFromModelName(model: string): number | null {
  const match = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(model ?? "");
  const billions = match ? Number.parseFloat(match[1]) : Number.NaN;
  return Number.isFinite(billions) && billions > 0 ? Math.round(billions * 1e9) : null;
}

// OpenAI reports no window on any endpoint. Every chat model it still sells
// has at least 128K of room; the newer lines have far more, but the prompt
// is billed by the token on this backend, so the floor they all share is
// also the ceiling worth paying for. The retired small-window models are
// sized by the model catalog (src/lib/model-registry), not by a table here.
export const OPENAI_CONTEXT_TOKENS = 128_000;

export function contextCacheKey(baseUrl: string, model: string): string {
  return `${normalizeBaseUrl(baseUrl)}::${model ?? ""}`;
}

// A window an endpoint reported once, kept across restarts (issue #925). The
// app's own llama-server starts after the world does, so the first turn
// after an update probed a server that was not listening yet, packed the
// prompt against the 16K stand-in on a 64K server, and left the scene out.
export type RememberedWindow = { window: number; at: number };

// What the prompt is packed against, in order: a window learned in this
// process (a probe or a refusal that named it), else the one this endpoint
// and model last reported, else nothing (the caller's default). A server
// restarted with a smaller -c since then refuses the first request as too
// big, and that refusal teaches the real window (model.ts).
export function knownContextWindow(fresh: { window: number } | undefined, saved: RememberedWindow | undefined): number | null {
  if (fresh && fresh.window > 0) {
    return fresh.window;
  }
  return saved && saved.window > 0 ? saved.window : null;
}

// The most endpoints remembered: a table switching models now and then
// needs a handful, and the row is read on every turn.
export const REMEMBERED_WINDOWS_MAX = 32;

// The saved row as stored, with anything malformed left out: it is a
// cache, and a bad entry is only a probe the next turn makes again.
export function readRememberedWindows(value: unknown): Record<string, RememberedWindow> {
  const out: Record<string, RememberedWindow> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const window = (entry as { window?: unknown } | null)?.window;
    const at = (entry as { at?: unknown } | null)?.at;
    if (typeof window === "number" && Number.isFinite(window) && window > 0 && typeof at === "number" && Number.isFinite(at)) {
      out[key] = { window: Math.floor(window), at };
    }
  }
  return out;
}

// The saved row with one endpoint's window set (or, with window 0, taken
// out), the oldest dropped past the cap. Null when nothing changes, so a
// probe that heard the same number again writes nothing.
export function rememberWindow(
  saved: Record<string, RememberedWindow>,
  key: string,
  window: number,
  at: number,
): Record<string, RememberedWindow> | null {
  const known = saved[key];
  if (window > 0 ? known?.window === Math.floor(window) : !known) {
    return null;
  }
  const next = { ...saved };
  if (window > 0) {
    next[key] = { window: Math.floor(window), at };
  } else {
    delete next[key];
  }
  const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at);
  for (const old of keys.slice(REMEMBERED_WINDOWS_MAX)) {
    delete next[old];
  }
  return next;
}

// Whether a failed probe means the server is not up: nothing listening
// (fetch itself rejected) or llama-server's 503 while it loads the model.
// A timeout, a 404 from a server that is not llama.cpp, or a body that
// would not parse all mean the server answered in some way, and a turn
// still goes ahead on the stand-in window as before.
export function probeMissUnreachable(miss: { status?: number; error?: unknown }): boolean {
  if (typeof miss.status === "number") {
    return miss.status === 503;
  }
  const name = (miss.error as { name?: unknown } | null)?.name;
  return Boolean(miss.error) && name !== "TimeoutError" && name !== "AbortError";
}
