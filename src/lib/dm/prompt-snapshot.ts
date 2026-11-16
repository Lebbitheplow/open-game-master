// A narrator's first messages, kept on its own disk and put back instead of
// read again.
//
// A turn's first message holds the rules and the tools, and llama.cpp reads
// the whole prompt again when it changes (src/lib/dm/turn-warmup.ts): a
// fight's start and end, the first turn after the server or the app starts,
// another table taking the slot. On a BC-250 that is 33K to 42K tokens, 80
// to 125 seconds each, and more than half of all the time its narrator spent
// in a measured session (2026-11-14). llama-server can keep what it read:
// in memory when it has memory to spare (--cache-ram, on by default), and on
// disk for a server that has none, which is what this module drives. Started
// with --slot-save-path, the server saves a slot's prompt to a file and
// restores it in a few seconds, so each first message is read once and
// restored from then on.
//
// What the app does for such a server, and for no other:
//   - a table's turns go to one slot (id_slot), and everything else sent to
//     the same server goes to another when it has one, so a helper call never
//     takes the turn's prompt;
//   - before a call whose first message the slot does not hold, its snapshot
//     is restored when there is one;
//   - after a turn or a warm-up, a first message with no snapshot is saved.
// A server that does not offer it is asked once and left alone.
import { createHash } from "node:crypto";
import { getAppSetting, setAppSetting } from "@/lib/db/app-settings";
import { normalizeBaseUrl } from "@/lib/dm/context-probe-logic";
import {
  fileToWrite,
  helperSlotFor,
  slotActionsOffered,
  slotIsEmpty,
  turnSlotFor,
  withEntry,
  withoutFile,
  type SnapshotEntry,
} from "@/lib/dm/prompt-snapshot-logic";
import { endpointKind } from "@/lib/dm/sampling-logic";
import { backendKeyFor } from "@/lib/model-client";
import { serverEnv } from "@/lib/server-env";

// A server that offers snapshots is asked again after half an hour (it may
// have been restarted without them), one that does not after five minutes.
const OFFERED_TTL_MS = 30 * 60_000;
const REFUSED_TTL_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 2_000;
// A save or a restore waits for the slot to finish what it is doing, then
// moves about a gigabyte.
const ACTION_TIMEOUT_MS = 180_000;
const STORE_SETTING = "promptSnapshots";
// A call that reused less than this of a restored prompt restored the wrong
// one: the file is forgotten and written again.
const REUSED_AT_LEAST_TOKENS = 1_000;

type Narrator = {
  id: string;
  base: string;
  auth: string;
  // The names of this narrator's files on its disk.
  prefix: string;
  offered: boolean;
  totalSlots: number;
  checkedAt: number;
  // What each slot was last sent as a first message, as far as the app
  // knows; null after a call that may have taken it.
  holds: Map<number, string | null>;
  // The tables, in the order they first called.
  tables: string[];
  saving: Set<string>;
  // The file restored for the call a slot is about to take.
  restored: Map<number, string>;
};

declare global {
  var __odmSnapshotNarrators: Map<string, Narrator> | undefined;
  var __odmSnapshotProbes: Map<string, Promise<Narrator | null>> | undefined;
}

function narrators() {
  return (globalThis.__odmSnapshotNarrators ??= new Map<string, Narrator>());
}

export type NarratorAddress = { baseUrl: string; model: string; apiKey?: string };

function narratorId(address: NarratorAddress): string {
  return `${normalizeBaseUrl(address.baseUrl)}|${address.model.trim()}`;
}

// One key per narrator, model, first message and tool list: two that match
// render the same prompt start.
export function promptHeadKey(address: NarratorAddress, first: string, tools: readonly unknown[] | undefined): string {
  return createHash("sha1")
    .update(JSON.stringify([(address.baseUrl || "").trim(), address.model, first, tools ?? []]))
    .digest("hex");
}

function asked(address: NarratorAddress): boolean {
  return (
    serverEnv("DM_PROMPT_SNAPSHOTS") !== "0" &&
    Boolean(address.model.trim()) &&
    Boolean(normalizeBaseUrl(address.baseUrl)) &&
    endpointKind(address.baseUrl) === "local"
  );
}

function headers(narrator: Pick<Narrator, "auth">, json: boolean): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(narrator.auth ? { Authorization: `Bearer ${narrator.auth}` } : {}),
  };
}

// Never redirected: the address is a campaign's (see model-client's
// fetchBackend).
async function post(narrator: Pick<Narrator, "base" | "auth">, path: string, body: unknown, timeoutMs: number) {
  const response = await fetch(`${narrator.base}${path}`, {
    method: "POST",
    headers: headers(narrator, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  return { status: response.status, text: (await response.text()).slice(0, 2_000) };
}

async function getJson(narrator: Pick<Narrator, "base" | "auth">, path: string): Promise<unknown> {
  try {
    const response = await fetch(`${narrator.base}${path}`, {
      headers: headers(narrator, false),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "error",
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}

// Asks the server whether it saves slots, and how many it has. An action it
// does not know is refused by name only when slot actions are on, and touches
// no slot (a restore of a file that is not there would clear one).
async function probe(address: NarratorAddress): Promise<Narrator | null> {
  const id = narratorId(address);
  const base = normalizeBaseUrl(address.baseUrl);
  const auth = backendKeyFor(address.baseUrl.trim(), address.apiKey ?? "");
  const known = narrators().get(id);
  const narrator: Narrator = known ?? {
    id,
    base,
    auth,
    prefix: `ogm-${createHash("sha1").update(id).digest("hex").slice(0, 8)}`,
    offered: false,
    totalSlots: 1,
    checkedAt: 0,
    holds: new Map(),
    tables: [],
    saving: new Set(),
    restored: new Map(),
  };
  narrator.auth = auth;
  try {
    const answer = await post(narrator, "/slots/0?action=probe", {}, PROBE_TIMEOUT_MS);
    narrator.offered = slotActionsOffered(answer.status, answer.text);
    if (narrator.offered) {
      // How many slots: /props says, and the slots themselves when it does not.
      const props = (await getJson(narrator, `/props?model=${encodeURIComponent(address.model)}`)) as { total_slots?: unknown } | null;
      const slots = Number(props?.total_slots) >= 1 ? null : await getJson(narrator, "/slots");
      const total = Number(props?.total_slots) >= 1 ? Number(props?.total_slots) : Array.isArray(slots) ? slots.length : 1;
      narrator.totalSlots = Math.max(1, Math.floor(total));
    }
  } catch {
    // Not listening, or not a llama-server: nothing is offered.
    narrator.offered = false;
  }
  if (!narrator.offered) {
    narrator.holds.clear();
    narrator.restored.clear();
  }
  narrator.checkedAt = Date.now();
  narrators().set(id, narrator);
  return narrator.offered ? narrator : null;
}

async function narratorFor(address: NarratorAddress): Promise<Narrator | null> {
  if (!asked(address)) {
    return null;
  }
  const id = narratorId(address);
  const known = narrators().get(id);
  if (known && Date.now() - known.checkedAt < (known.offered ? OFFERED_TTL_MS : REFUSED_TTL_MS)) {
    return known.offered ? known : null;
  }
  const probes = (globalThis.__odmSnapshotProbes ??= new Map());
  const running = probes.get(id);
  if (running) {
    return running;
  }
  const next = probe(address).finally(() => probes.delete(id));
  probes.set(id, next);
  return next;
}

// The narrator as last asked, without asking: null until a turn has.
function knownNarrator(address: NarratorAddress): Narrator | null {
  if (!asked(address)) {
    return null;
  }
  const known = narrators().get(narratorId(address));
  return known?.offered ? known : null;
}

function readEntries(narrator: Narrator): SnapshotEntry[] {
  const stored = getAppSetting<Record<string, unknown>>(STORE_SETTING, {});
  const list = stored && typeof stored === "object" ? stored[narrator.id] : null;
  return Array.isArray(list)
    ? list.filter(
        (entry): entry is SnapshotEntry =>
          Boolean(entry) && typeof entry.file === "string" && entry.file.startsWith(`${narrator.prefix}-`) && typeof entry.key === "string" && typeof entry.at === "number",
      )
    : [];
}

function writeEntries(narrator: Narrator, entries: SnapshotEntry[]): void {
  try {
    const stored = getAppSetting<Record<string, unknown>>(STORE_SETTING, {});
    setAppSetting(STORE_SETTING, { ...(stored && typeof stored === "object" ? stored : {}), [narrator.id]: entries });
  } catch (error) {
    console.warn("[dm] could not record the narrator's prompt snapshots", error);
  }
}

async function slotAction(narrator: Narrator, slot: number, action: "save" | "restore", file: string): Promise<boolean> {
  const started = Date.now();
  try {
    const answer = await post(narrator, `/slots/${slot}?action=${action}`, { filename: file }, ACTION_TIMEOUT_MS);
    if (answer.status !== 200) {
      console.warn(`[dm] the narrator could not ${action} a prompt snapshot (${answer.status}): ${answer.text.slice(0, 200)}`);
      return false;
    }
    if (serverEnv("DM_DEBUG") === "1") {
      console.log(`[dm-debug] prompt snapshot ${action} slot ${slot} ${file}: ${Date.now() - started} ms ${answer.text.slice(0, 160)}`);
    }
    return true;
  } catch (error) {
    console.warn(`[dm] the narrator did not answer a prompt snapshot ${action}`, error);
    return false;
  }
}

function tableSlot(narrator: Narrator, campaignId: string): number {
  let ordinal = narrator.tables.indexOf(campaignId);
  if (ordinal < 0) {
    ordinal = narrator.tables.push(campaignId) - 1;
  }
  return turnSlotFor(narrator.totalSlots, ordinal);
}

async function restartedSince(narrator: Narrator, slot: number): Promise<boolean> {
  return slotIsEmpty(await getJson(narrator, "/slots"), slot);
}

// Before a table's call whose first message is `key`: the slot the call goes
// to, with that first message restored when the slot holds another and a
// snapshot of it exists. Undefined for a narrator that offers no snapshots,
// whose calls go as they always did. `check` asks the server first whether
// the slot still holds anything (a turn's first call: the server may have
// been restarted since the last).
export async function readyPromptHead(address: NarratorAddress, campaignId: string, key: string, check = false): Promise<number | undefined> {
  const narrator = await narratorFor(address);
  if (!narrator) {
    return undefined;
  }
  const slot = tableSlot(narrator, campaignId);
  let held = narrator.holds.get(slot) ?? null;
  if (held === key && check && (await restartedSince(narrator, slot))) {
    held = null;
  }
  narrator.restored.delete(slot);
  if (held !== key) {
    const entry = readEntries(narrator).find((candidate) => candidate.key === key);
    if (entry) {
      if (await slotAction(narrator, slot, "restore", entry.file)) {
        narrator.restored.set(slot, entry.file);
        writeEntries(narrator, withEntry(readEntries(narrator), { ...entry, at: Date.now() }));
      } else {
        // Gone, or written by another model: the call reads the prompt, and
        // the first message is saved again after it.
        writeEntries(narrator, withoutFile(readEntries(narrator), entry.file));
      }
    }
  }
  narrator.holds.set(slot, key);
  return slot;
}

// After the call readyPromptHead prepared: what it reused says whether the
// snapshot restored for it was the right one.
export function notePromptReuse(address: NarratorAddress, campaignId: string, cachedTokens: number | undefined): void {
  const narrator = knownNarrator(address);
  if (!narrator) {
    return;
  }
  const slot = tableSlot(narrator, campaignId);
  const file = narrator.restored.get(slot);
  narrator.restored.delete(slot);
  if (file && cachedTokens !== undefined && cachedTokens < REUSED_AT_LEAST_TOKENS) {
    console.warn(`[dm] a restored prompt snapshot (${file}) was not reused; it will be written again`);
    writeEntries(narrator, withoutFile(readEntries(narrator), file));
  }
}

// Whether this narrator was found to keep prompt snapshots (a turn has asked).
export function keepsPromptSnapshots(address: NarratorAddress): boolean {
  return knownNarrator(address) !== null;
}

// Saves the first message the table's slot holds when no snapshot of it
// exists. Resolves true once one does. Never throws.
export async function keepPromptHead(address: NarratorAddress, campaignId: string, key: string): Promise<boolean> {
  try {
    const narrator = knownNarrator(address);
    if (!narrator) {
      return false;
    }
    const slot = tableSlot(narrator, campaignId);
    if (narrator.holds.get(slot) !== key) {
      return false;
    }
    if (readEntries(narrator).some((entry) => entry.key === key)) {
      return true;
    }
    if (narrator.saving.has(key)) {
      return false;
    }
    narrator.saving.add(key);
    try {
      const file = fileToWrite(readEntries(narrator), key, narrator.prefix);
      // The file is being written over: it holds nothing known until done.
      writeEntries(narrator, withoutFile(readEntries(narrator), file));
      const saved = await slotAction(narrator, slot, "save", file);
      // The server saves when the slot is free. A call with another first
      // message that reached it first is what the file holds now: unknown.
      if (!saved || narrator.holds.get(slot) !== key) {
        return false;
      }
      writeEntries(narrator, withEntry(readEntries(narrator), { file, key, at: Date.now() }));
      return true;
    } finally {
      narrator.saving.delete(key);
    }
  } catch (error) {
    console.warn("[dm] could not save a prompt snapshot", error);
    return false;
  }
}

// Where a call that is not a table's turn goes on a narrator that keeps
// snapshots: the slot that holds its first message (a turn's rescue, the
// guard's rewrite, an out-of-character answer: the turn's own prompt), else
// the helper slot. On a server with one slot the call takes the turn's, and
// what that slot held is forgotten, so the next turn restores it. Undefined
// for any other narrator.
export function slotForOtherCall(address: NarratorAddress, first: unknown, tools: readonly unknown[] | undefined): number | undefined {
  const narrator = knownNarrator(address);
  if (!narrator) {
    return undefined;
  }
  if (typeof first === "string" && tools?.length) {
    const key = promptHeadKey(address, first, tools);
    for (const [slot, held] of narrator.holds) {
      if (held === key) {
        return slot;
      }
    }
  }
  const helper = helperSlotFor(narrator.totalSlots);
  if (helper === null) {
    narrator.holds.clear();
    return undefined;
  }
  return helper;
}
