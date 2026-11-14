// Which of a narrator's slots a table's turns use, and which of a few files
// holds each first message it has read (src/lib/dm/prompt-snapshot.ts).
//
// Dependency-free so scripts/test-enforce-prompt-snapshot.mjs can import it directly.

// How many snapshots one narrator keeps on its disk. llama-server offers no
// way to delete one, so the names are a fixed set written over, oldest use
// first: three tables' rules in and out of a fight fit, and a first message
// that changed (a sheet, a setting, a new version's rules) takes the place
// of the one nobody restores any more. A gpt-oss-20b snapshot of a 37K-token
// prompt is 490 MB (BC-250, 2026-11-14), so about 3 GB in all.
export const SNAPSHOT_FILES = 6;

export type SnapshotEntry = {
  file: string;
  // The first message the file holds (turnHeadKey).
  key: string;
  // When it was last written or restored.
  at: number;
};

// The slot a table's turns are pinned to. A server's last slot is left to
// everything else sent to it (the claims reader, summaries, another table's
// helper calls) when it has more than one: a helper call that took the turn's
// slot threw its prompt away. The tables share the others in the order they
// arrived.
export function turnSlotFor(totalSlots: number, ordinal: number): number {
  const turnSlots = Math.max(1, Math.floor(totalSlots) - 1);
  return Math.abs(Math.floor(ordinal)) % turnSlots;
}

// The slot everything that is not a turn goes to, or null on a server with
// one slot, where it shares the turn's.
export function helperSlotFor(totalSlots: number): number | null {
  return totalSlots >= 2 ? Math.floor(totalSlots) - 1 : null;
}

export function snapshotFileName(prefix: string, index: number): string {
  return `${prefix}-${index}.bin`;
}

// The file a first message is saved to: the one that already holds it, else
// a name not used yet, else the one used longest ago.
export function fileToWrite(entries: readonly SnapshotEntry[], key: string, prefix: string, files = SNAPSHOT_FILES): string {
  const own = entries.find((entry) => entry.key === key);
  if (own) {
    return own.file;
  }
  for (let index = 0; index < files; index += 1) {
    const name = snapshotFileName(prefix, index);
    if (!entries.some((entry) => entry.file === name)) {
      return name;
    }
  }
  return [...entries].sort((a, b) => a.at - b.at)[0].file;
}

// The entries after a file was written or restored: one entry per file and
// per first message, newest use recorded.
export function withEntry(entries: readonly SnapshotEntry[], entry: SnapshotEntry): SnapshotEntry[] {
  return [...entries.filter((other) => other.file !== entry.file && other.key !== entry.key), entry];
}

export function withoutFile(entries: readonly SnapshotEntry[], file: string): SnapshotEntry[] {
  return entries.filter((entry) => entry.file !== file);
}

// What the server's answer to an action it does not know says about it:
// a llama-server started with --slot-save-path refuses the action by name
// (400, "Invalid action"), one started without it says so (501), and
// anything else is not a llama-server that keeps slots.
export function slotActionsOffered(status: number, body: string): boolean {
  return status === 400 && /invalid action/i.test(body);
}

// A slot that has read nothing since its server started: whatever the app
// believed it held is gone (the server was restarted).
export function slotIsEmpty(slots: unknown, slot: number): boolean {
  if (!Array.isArray(slots)) {
    return false;
  }
  const row = slots.find((entry) => entry && typeof entry === "object" && Number((entry as { id?: unknown }).id) === slot) as
    | { id_task?: unknown; n_prompt_tokens?: unknown }
    | undefined;
  if (!row) {
    return false;
  }
  return Number(row.id_task) === -1 || Number(row.n_prompt_tokens) === 0;
}
