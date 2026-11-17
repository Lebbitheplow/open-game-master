import { getDatabase, nowIso } from "@/lib/db/core";
import {
  DEFAULT_GLOBAL_CONFIG,
  globalConfigSchema,
  type GlobalConfig,
} from "@/lib/schemas/global-config";
import { parseKeepingValid } from "@/lib/schemas/parse-keeping-valid";

const GLOBAL_CONFIG_KEY = "global_config";

export function getAppSetting<T>(key: string, fallback: T): T {
  const row = getDatabase()
    .prepare(`SELECT value_json FROM app_settings WHERE key = ?`)
    .get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setAppSetting(key: string, value: unknown) {
  getDatabase()
    .prepare(
      `
        INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `,
    )
    .run(key, JSON.stringify(value), nowIso());
}

const INSTANCE_ID_KEY = "instance_id";

// A world's identity across addresses. A device world gets a fresh tunnel
// hostname every share session; clients compare this id to recognize a known
// world at a new address instead of saving a duplicate server entry.
// INSERT OR IGNORE makes first-mint atomic under concurrent requests.
export function getInstanceId(): string {
  getDatabase()
    .prepare(`INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)`)
    .run(INSTANCE_ID_KEY, JSON.stringify(crypto.randomUUID()), nowIso());
  return getAppSetting<string>(INSTANCE_ID_KEY, "");
}

// Read on every call, so an admin edit (or any other write to the row) is
// live at once with no invalidation to forget. What is remembered is only
// the parse: the stored text is compared with the text the last parse read,
// and the validated object is reused while they match. The parse is the
// part a DM turn paid over and over (about 16 µs a call against 1 µs for the
// read). The object is shared, like DEFAULT_GLOBAL_CONFIG always was, so it
// is frozen outside production to catch any caller that writes to it.
let parsedConfig: { raw: string; config: GlobalConfig } | null = null;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function getGlobalConfig(): GlobalConfig {
  const row = getDatabase()
    .prepare(`SELECT value_json FROM app_settings WHERE key = ?`)
    .get(GLOBAL_CONFIG_KEY) as { value_json: string } | undefined;
  if (!row) return DEFAULT_GLOBAL_CONFIG;
  if (parsedConfig?.raw === row.value_json) return parsedConfig.config;
  let raw: unknown;
  try {
    raw = JSON.parse(row.value_json);
  } catch {
    return DEFAULT_GLOBAL_CONFIG;
  }
  const config = parseKeepingValid(globalConfigSchema, raw);
  parsedConfig = {
    raw: row.value_json,
    config: process.env.NODE_ENV === "production" ? config : deepFreeze(config),
  };
  return parsedConfig.config;
}

export type GlobalConfigPatch = {
  signupsEnabled?: boolean;
  signupMode?: GlobalConfig["signupMode"];
  serverName?: string;
  serverLanguage?: GlobalConfig["serverLanguage"];
  accountDeletionGraceDays?: number;
  abilityRerollBelow?: number;
  publicUrl?: string;
  worldRegistryUrl?: string;
  sampling?: Partial<GlobalConfig["sampling"]>;
  text?: Partial<GlobalConfig["text"]>;
  images?: Partial<GlobalConfig["images"]>;
  speech?: Partial<GlobalConfig["speech"]>;
  voiceChat?: Partial<GlobalConfig["voiceChat"]>;
  discord?: Partial<GlobalConfig["discord"]>;
  harness?: Partial<GlobalConfig["harness"]>;
  sharedHost?: Partial<GlobalConfig["sharedHost"]>;
};

// Merges a partial update over the stored config. Secret fields follow the
// same rule as everything else: undefined = keep, "" = clear, value = set.
// Every schema key must appear here: a key missing from this object is
// silently reset to its schema default on every save (that bug once ate the
// voice-chat settings), so the merged literal is typed to force completeness.
export function saveGlobalConfig(patch: GlobalConfigPatch): GlobalConfig {
  const current = getGlobalConfig();
  const signupMode = patch.signupMode ?? current.signupMode;
  const input: Record<keyof GlobalConfig, unknown> = {
    signupsEnabled:
      // Keep the legacy boolean agreeing with an explicit mode so anything
      // still reading it sees the policy the admin actually picked.
      signupMode !== ""
        ? signupMode !== "closed"
        : (patch.signupsEnabled ?? current.signupsEnabled),
    signupMode,
    serverName: patch.serverName ?? current.serverName,
    serverLanguage: patch.serverLanguage ?? current.serverLanguage,
    accountDeletionGraceDays:
      patch.accountDeletionGraceDays ?? current.accountDeletionGraceDays,
    abilityRerollBelow: patch.abilityRerollBelow ?? current.abilityRerollBelow,
    publicUrl: patch.publicUrl ?? current.publicUrl,
    worldRegistryUrl: patch.worldRegistryUrl ?? current.worldRegistryUrl,
    sampling: { ...current.sampling, ...patch.sampling },
    text: { ...current.text, ...patch.text },
    images: { ...current.images, ...patch.images },
    speech: { ...current.speech, ...patch.speech },
    voiceChat: { ...current.voiceChat, ...patch.voiceChat },
    sharedHost: { ...current.sharedHost, ...patch.sharedHost },
    discord: { ...current.discord, ...patch.discord },
    harness: { ...current.harness, ...patch.harness },
  };
  const merged = globalConfigSchema.parse(input);
  setAppSetting(GLOBAL_CONFIG_KEY, merged);
  return merged;
}
