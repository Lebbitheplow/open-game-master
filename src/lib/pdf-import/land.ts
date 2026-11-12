import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { importDir, readDraft, releaseImportFiles, setImportState, type PdfImport } from "@/lib/db/pdf-imports";
import { importWorkshopBundle } from "@/lib/db/workshop-bundle";
import { writeShelfArrivals } from "@/lib/db/workshop-bundle-shelf";
import { importWorldForge } from "@/lib/db/world-forge-io";
import { markPrivateSource, markShelfArrivals } from "@/lib/db/private-sources";
import { readBundle, workshopBundleSchema } from "@/lib/workshop/bundle";
import { MAX_ADDON_BUNDLE_BYTES } from "@/lib/workshop/bundle-schema";
import type { UploadRefusal } from "@/lib/upload-budget";
import { draftToBundle, draftToWorldForge, takenRecords } from "@/lib/pdf-import/bundle-logic";
import { unconfirmed } from "@/lib/pdf-import/match-logic";

// The reviewed draft, landed: as a new workshop through the bundle import
// (every check a bundle file gets), or, for an import begun in WorldForge,
// into that world through the WorldForge import, its creatures and items
// onto the GM's own shelf. Either way the result is marked as the GM's
// private copy of a published book.

export const PICTURE_TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" };

export function pictureFile(importId: string, pictureId: string): { file: string; type: string } | null {
  if (!/^[a-z0-9_-]{1,40}$/i.test(pictureId)) return null;
  for (const [ext, type] of Object.entries(PICTURE_TYPES)) {
    const file = path.join(/*turbopackIgnore: true*/ importDir(importId), `${pictureId}.${ext}`);
    if (existsSync(file)) return { file, type };
  }
  return null;
}

function pictureLookup(importId: string): (pictureId: string) => string {
  return (pictureId) => {
    const found = pictureId ? pictureFile(importId, pictureId) : null;
    return found ? `data:${found.type};base64,${readFileSync(found.file).toString("base64")}` : "";
  };
}

export type Landed =
  | { workshopId: string; shelf?: { renamed: string[]; refused: string[] } }
  | { error: string; status: number; refusal?: UploadRefusal };

export function landImport(item: PdfImport, account: { id: string; isAdmin: boolean }, destination: "workshop" | "world"): Landed {
  const draft = readDraft(item.id);
  if (!draft || item.state !== "review") return { error: "This import is not ready to bring in yet.", status: 409 };
  // A guess is never played unconfirmed: every creature the import could
  // not match by name waits for the GM's yes in the review.
  const taken = new Set(takenRecords(draft).map((record) => record.key));
  const waiting = unconfirmed(draft.matches, (key) => taken.has(key));
  if (waiting) return { error: `Confirm the SRD 5.1 match for ${waiting === 1 ? "one creature" : `${waiting} creatures`} first.`, status: 409 };
  const source = `${draft.title || item.fileName} (${item.fileName})`.slice(0, 200);
  const pictures = pictureLookup(item.id);

  if (destination === "world") {
    if (!item.campaignId) return { error: "This import was not started in a WorldForge.", status: 400 };
    const world = importWorldForge(item.campaignId, account, draftToWorldForge(draft, item.fileName, pictures));
    if ("error" in world) return { error: world.error, status: 400, ...(world.refusal ? { refusal: world.refusal } : {}) };
    // The creatures and items go on the GM's shelf, where this workshop's
    // fights and the Cast find them.
    const full = draftToBundle(draft, item.fileName, pictures);
    const shelfOnly = workshopBundleSchema.safeParse({ ...full, lore: [], locations: [], npcs: [], factions: [], encounters: [], tables: [], maps: [], storyboard: [], world: null });
    let shelf: { renamed: string[]; refused: string[] } | undefined;
    if (shelfOnly.success && (shelfOnly.data.monsters.length || shelfOnly.data.homebrew.length)) {
      const landed = writeShelfArrivals(account.id, item.campaignId, shelfOnly.data);
      markShelfArrivals(shelfOnly.data, landed.entryFor, source);
      shelf = { renamed: landed.renamed, refused: landed.refused };
    }
    markPrivateSource(item.campaignId, source);
    finish(item.id, item.campaignId);
    return { workshopId: item.campaignId, ...(shelf ? { shelf } : {}) };
  }

  const bundle = { ...draftToBundle(draft, item.fileName, pictures), privateSource: source };
  const read = readBundle(JSON.stringify(bundle), { maxBytes: MAX_ADDON_BUNDLE_BYTES });
  if ("error" in read) return { error: `The import could not be written as a workshop: ${read.error}`, status: 400 };
  const result = importWorkshopBundle(account.id, read.bundle, { isAdmin: account.isAdmin });
  if ("error" in result) return { error: result.error, status: result.refusal ? 413 : 400, ...(result.refusal ? { refusal: result.refusal } : {}) };
  markPrivateSource(result.workshopId, source);
  finish(item.id, result.workshopId);
  return { workshopId: result.workshopId, shelf: { renamed: result.shelf.renamed, refused: result.shelf.refused } };
}

function finish(importId: string, workshopId: string): void {
  setImportState(importId, { state: "imported", workshopId, step: "" });
  releaseImportFiles(importId);
}
