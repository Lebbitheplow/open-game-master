import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { getDatabase, nowIso } from "@/lib/db/core";
import { diskRefusal } from "@/lib/upload-budget";
import type { Draft } from "@/lib/pdf-import/draft-logic";
import type { PictureUpload } from "@/lib/pdf-import/picture-logic";
import type { OutlineItem, ReadFont, ReadPage } from "@/lib/pdf-import/reading";

// Adventure PDF imports (src/lib/pdf-import/*): one row per book being
// brought in, its pages as the page read them, its kept pictures as files
// in a private folder (never under public/, never served), and the draft
// the job builds. The row's life:
//
//   reading -> ready -> working -> review -> imported
//                 \-> failed (with the reason)      \-> (deleted)
//
// "reading" while the page sends pages and pictures; "ready" once it has
// sent them all; "working" while the job reads the layout and, with a
// model, the book; "review" while the GM looks the draft over. A server
// that restarts mid-"working" picks the job up where its last finished
// piece left it (src/lib/pdf-import/job.ts).

export type PdfImportState = "reading" | "ready" | "working" | "review" | "imported" | "failed";

export type PdfImport = {
  id: string;
  userId: string;
  // The workshop an import begun in WorldForge goes into, or null for a new
  // workshop.
  campaignId: string | null;
  fileName: string;
  title: string;
  pageCount: number;
  state: PdfImportState;
  step: string;
  done: number;
  total: number;
  useModel: boolean;
  reason: string;
  workshopId: string | null;
  boot: string;
  createdAt: string;
  updatedAt: string;
  pagesReceived: number;
};

type Row = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  file_name: string;
  title: string;
  page_count: number;
  state: string;
  step: string;
  done: number;
  total: number;
  use_model: number;
  reason: string;
  workshop_id: string | null;
  boot: string;
  created_at: string;
  updated_at: string;
  pages_received?: number;
};

// Imports left unfinished this long are let go, files and all.
export const STALE_IMPORT_MS = 14 * 24 * 60 * 60 * 1000;
// One person's imports at once: a book in review and one being read is the
// most anyone needs, and each holds a book's pictures on disk.
export const MAX_OPEN_IMPORTS = 3;

// What one account's unfinished imports may hold on disk at once (their
// pages and pictures), however many times they are discarded and begun
// again: a big illustrated book is well under it.
export const MAX_PENDING_IMPORT_BYTES = 512 * 1024 * 1024;

function fromRow(row: Row): PdfImport {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    fileName: row.file_name,
    title: row.title,
    pageCount: row.page_count,
    state: row.state as PdfImportState,
    step: row.step,
    done: row.done,
    total: row.total,
    useModel: row.use_model === 1,
    reason: row.reason,
    workshopId: row.workshop_id,
    boot: row.boot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pagesReceived: row.pages_received ?? 0,
  };
}

const SELECT = `SELECT i.*, (SELECT COUNT(*) FROM pdf_import_pages p WHERE p.import_id = i.id) AS pages_received FROM pdf_imports i`;

export function importsDir(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "pdf-imports");
}

export function importDir(id: string): string {
  // Ids are uuids this file made; anything else never reaches the disk.
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Not an import id.");
  return path.join(/*turbopackIgnore: true*/ importsDir(), id);
}

const pack = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)));
const unpack = <T>(blob: Buffer | null | undefined, fallback: T): T => {
  if (!blob) return fallback;
  try {
    return JSON.parse(gunzipSync(blob).toString("utf8")) as T;
  } catch {
    return fallback;
  }
};

export function createPdfImport(input: { userId: string; campaignId: string | null; fileName: string; title: string; pageCount: number; outline: OutlineItem[] }): PdfImport {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO pdf_imports (id, user_id, campaign_id, file_name, title, page_count, state, outline_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'reading', ?, ?, ?)`,
    )
    .run(id, input.userId, input.campaignId, input.fileName, input.title, input.pageCount, JSON.stringify(input.outline), now, now);
  mkdirSync(importDir(id), { recursive: true });
  return getPdfImport(id)!;
}

export function getPdfImport(id: string): PdfImport | null {
  const row = getDatabase().prepare(`${SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function getPdfImportForUser(id: string, userId: string): PdfImport | null {
  const found = getPdfImport(id);
  return found && found.userId === userId ? found : null;
}

export function listPdfImports(userId: string): PdfImport[] {
  return (getDatabase().prepare(`${SELECT} WHERE i.user_id = ? AND i.state != 'imported' ORDER BY i.updated_at DESC`).all(userId) as Row[]).map(fromRow);
}

export function openImportCount(userId: string): number {
  return (getDatabase().prepare(`SELECT COUNT(*) AS n FROM pdf_imports WHERE user_id = ? AND state != 'imported'`).get(userId) as { n: number }).n;
}

// The bytes an account's unfinished imports hold: their pages in the
// database and their pictures in data/pdf-imports.
export function pendingImportBytes(userId: string): number {
  const db = getDatabase();
  const open = db.prepare(`SELECT id FROM pdf_imports WHERE user_id = ? AND state <> 'imported'`).all(userId) as Array<{ id: string }>;
  let bytes = 0;
  const pageBytes = db.prepare(`SELECT COALESCE(SUM(LENGTH(page_blob)), 0) AS n FROM pdf_import_pages WHERE import_id = ?`);
  const draftBytes = db.prepare(`SELECT COALESCE(LENGTH(draft_blob), 0) + COALESCE(LENGTH(model_blob), 0) AS n FROM pdf_imports WHERE id = ?`);
  for (const { id } of open) {
    bytes += Number((pageBytes.get(id) as { n: number }).n) || 0;
    bytes += Number((draftBytes.get(id) as { n: number } | undefined)?.n) || 0;
    const dir = path.join(/*turbopackIgnore: true*/ importsDir(), id);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      try {
        bytes += statSync(path.join(dir, name)).size;
      } catch {
        // gone between the listing and the look
      }
    }
  }
  return bytes;
}

// Why `bytes` more may not be kept for this account's imports, or null.
export function pendingImportRefusal(userId: string, bytes: number): { error: string; status: 413 | 507 } | null {
  // Where import data lives: the pictures' folder and the database
  // beside it under data/, which may be another volume than uploads.
  const disk = diskRefusal(bytes, importsDir());
  if (disk) return { error: disk.error, status: 507 };
  if (pendingImportBytes(userId) + bytes > MAX_PENDING_IMPORT_BYTES) {
    return { error: "Your unfinished book imports hold as much as they may. Finish or discard one to make room.", status: 413 };
  }
  return null;
}

// The text runs an import holds, leaving out the pages about to be sent
// again (a page sent twice counts once).
export function importRuns(id: string, except: number[] = []): number {
  const rows = getDatabase().prepare(`SELECT n, runs FROM pdf_import_pages WHERE import_id = ?`).all(id) as Array<{ n: number; runs: number }>;
  const skip = new Set(except);
  return rows.reduce((sum, row) => (skip.has(row.n) ? sum : sum + row.runs), 0);
}

export function savePages(id: string, fonts: ReadFont[], pages: ReadPage[]): void {
  const db = getDatabase();
  const insert = db.prepare(`INSERT OR REPLACE INTO pdf_import_pages (import_id, n, page_blob, runs) VALUES (?, ?, ?, ?)`);
  db.transaction(() => {
    for (const page of pages) insert.run(id, page.n, pack(page), page.runs.length);
    db.prepare(`UPDATE pdf_imports SET fonts_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(fonts), nowIso(), id);
  })();
}

export function readPages(id: string): ReadPage[] {
  const rows = getDatabase().prepare(`SELECT page_blob FROM pdf_import_pages WHERE import_id = ? ORDER BY n`).all(id) as Array<{ page_blob: Buffer }>;
  return rows.map((row) => unpack<ReadPage | null>(row.page_blob, null)).filter((page): page is ReadPage => Boolean(page));
}

export function readFonts(id: string): ReadFont[] {
  const row = getDatabase().prepare(`SELECT fonts_json FROM pdf_imports WHERE id = ?`).get(id) as { fonts_json: string } | undefined;
  try {
    return row ? (JSON.parse(row.fonts_json) as ReadFont[]) : [];
  } catch {
    return [];
  }
}

export function readOutline(id: string): OutlineItem[] {
  const row = getDatabase().prepare(`SELECT outline_json FROM pdf_imports WHERE id = ?`).get(id) as { outline_json: string } | undefined;
  try {
    return row ? (JSON.parse(row.outline_json) as OutlineItem[]) : [];
  } catch {
    return [];
  }
}

export function readPictures(id: string): PictureUpload[] {
  const row = getDatabase().prepare(`SELECT pictures_json FROM pdf_imports WHERE id = ?`).get(id) as { pictures_json: string } | undefined;
  try {
    return row ? (JSON.parse(row.pictures_json) as PictureUpload[]) : [];
  } catch {
    return [];
  }
}

export function savePictures(id: string, pictures: PictureUpload[]): void {
  getDatabase().prepare(`UPDATE pdf_imports SET pictures_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(pictures), nowIso(), id);
}

export function readDraft(id: string): Draft | null {
  const row = getDatabase().prepare(`SELECT draft_blob FROM pdf_imports WHERE id = ?`).get(id) as { draft_blob: Buffer | null } | undefined;
  return unpack<Draft | null>(row?.draft_blob, null);
}

export function saveDraft(id: string, draft: Draft): void {
  getDatabase().prepare(`UPDATE pdf_imports SET draft_blob = ?, updated_at = ? WHERE id = ?`).run(pack(draft), nowIso(), id);
}

// The model's answers so far, by piece index, so a restarted job asks
// only for the pieces it has not got.
export function readModelAnswers(id: string): Record<string, unknown> {
  const row = getDatabase().prepare(`SELECT model_blob FROM pdf_imports WHERE id = ?`).get(id) as { model_blob: Buffer | null } | undefined;
  return unpack<Record<string, unknown>>(row?.model_blob, {});
}

export function saveModelAnswers(id: string, answers: Record<string, unknown>): void {
  getDatabase().prepare(`UPDATE pdf_imports SET model_blob = ?, updated_at = ? WHERE id = ?`).run(pack(answers), nowIso(), id);
}

export function setImportState(
  id: string,
  patch: Partial<{ state: PdfImportState; step: string; done: number; total: number; useModel: boolean; reason: string; workshopId: string; boot: string; title: string }>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  const column: Record<string, string> = { state: "state", step: "step", done: "done", total: "total", useModel: "use_model", reason: "reason", workshopId: "workshop_id", boot: "boot", title: "title" };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${column[key]} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  values.push(nowIso(), id);
  getDatabase().prepare(`UPDATE pdf_imports SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

// The pages and pictures are only needed until the import lands; after
// that the row stays as a short record (which workshop it became) and the
// files go.
export function releaseImportFiles(id: string): void {
  getDatabase().prepare(`DELETE FROM pdf_import_pages WHERE import_id = ?`).run(id);
  getDatabase().prepare(`UPDATE pdf_imports SET draft_blob = NULL, model_blob = NULL WHERE id = ?`).run(id);
  rmSync(importDir(id), { recursive: true, force: true });
}

// Every import of an account and its files, for erasing the account: the
// rows would cascade, but the pictures in data/pdf-imports would wait for
// the daily tidy.
export function deleteAccountImports(userId: string): void {
  const ids = getDatabase().prepare(`SELECT id FROM pdf_imports WHERE user_id = ?`).all(userId) as Array<{ id: string }>;
  for (const { id } of ids) deletePdfImport(id);
}

export function deletePdfImport(id: string): void {
  getDatabase().prepare(`DELETE FROM pdf_imports WHERE id = ?`).run(id);
  rmSync(importDir(id), { recursive: true, force: true });
}

// Unfinished imports nobody touched in two weeks, and folders whose row is
// gone (an account deleted, a row removed by hand). From the daily tidy.
export function sweepPdfImports(now = Date.now()): number {
  const db = getDatabase();
  const cutoff = new Date(now - STALE_IMPORT_MS).toISOString();
  const stale = db.prepare(`SELECT id FROM pdf_imports WHERE state != 'imported' AND updated_at < ?`).all(cutoff) as Array<{ id: string }>;
  for (const { id } of stale) deletePdfImport(id);
  let removed = stale.length;
  const dir = importsDir();
  if (existsSync(dir)) {
    const known = new Set((db.prepare(`SELECT id FROM pdf_imports`).all() as Array<{ id: string }>).map((row) => row.id));
    for (const name of readdirSync(dir)) {
      if (/^[0-9a-f-]{36}$/.test(name) && !known.has(name)) {
        rmSync(path.join(/*turbopackIgnore: true*/ dir, name), { recursive: true, force: true });
        removed += 1;
      }
    }
  }
  return removed;
}
