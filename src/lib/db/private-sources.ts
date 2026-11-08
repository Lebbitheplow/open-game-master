import { getDatabase, nowIso } from "@/lib/db/core";

// Workshops built from a GM's own copy of a published book (an adventure
// PDF import). Their words and pictures belong to the book's publisher and
// are the GM's to use at their own table: they are never compiled into a
// world pack, pulled into the plugin creator or installed for everyone on
// the server. The mark follows the workshop through Duplicate, a bundle
// file and a WorldForge file, so a copy is as private as the original. The
// book's creatures, items and spells on the GM's shelf carry it too: a
// bundle of any other workshop that takes one along is marked with it.

export const PRIVATE_SOURCE_REFUSAL =
  "This workshop was imported from a published book for your own table, so it cannot become a world pack or be installed for others. Its words and pictures belong to the book's publisher.";

export function markPrivateSource(campaignId: string, source: string): void {
  getDatabase()
    .prepare(`INSERT INTO private_sources (campaign_id, source, created_at) VALUES (?, ?, ?) ON CONFLICT(campaign_id) DO UPDATE SET source = excluded.source`)
    .run(campaignId, source.slice(0, 200), nowIso());
}

export function privateSourceOf(campaignId: string): string {
  const row = getDatabase().prepare(`SELECT source FROM private_sources WHERE campaign_id = ?`).get(campaignId) as { source: string } | undefined;
  return row?.source ?? "";
}

export function copyPrivateSource(fromId: string, toId: string): void {
  const source = privateSourceOf(fromId);
  if (source) markPrivateSource(toId, source);
}

// Shelf entries (homebrew_entries ids) that came from a published book.
export function markPrivateEntries(entryIds: Array<string | null | undefined>, source: string): void {
  const insert = getDatabase().prepare(
    `INSERT INTO private_homebrew (entry_id, source, created_at) VALUES (?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET source = excluded.source`,
  );
  const at = nowIso();
  for (const id of new Set(entryIds)) if (id) insert.run(id, source.slice(0, 200), at);
}

// The book any of these shelf entries came from, or "" for none.
export function privateSourceOfEntries(entryIds: string[]): string {
  if (!entryIds.length) return "";
  const select = getDatabase().prepare(`SELECT source FROM private_homebrew WHERE entry_id = ?`);
  for (const id of entryIds) {
    const row = select.get(id) as { source: string } | undefined;
    if (row) return row.source;
  }
  return "";
}

// Each bundle monster and entry where it landed on the shelf, marked.
export function markShelfArrivals(
  bundle: { monsters: Array<{ name: string }>; homebrew: Array<{ kind: string; name: string }> },
  entryFor: (kind: string, name: string) => string | null,
  source: string,
): void {
  markPrivateEntries([...bundle.monsters.map((monster) => entryFor("monster", monster.name)), ...bundle.homebrew.map((entry) => entryFor(entry.kind, entry.name))], source);
}
