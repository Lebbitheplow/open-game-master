// The disk half of uploads: writing bytes into public/uploads under a fresh
// uuid, and reading one of our own files back. src/lib/uploads.ts stays a
// pure path check because client bundles import it through the battlemap
// backdrop; this module is Node-only and is what /api/upload and the
// character export/import routes call.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { scheduleImageVariants } from "@/lib/image-variants";
import { isUploadedImagePath, isUploadedPdfPath } from "@/lib/uploads";
import { recordMediaFile } from "@/lib/media-access";
import { pdfTextDir } from "@/lib/pdf-text-files";

// The one size cap for anything that lands in public/uploads, whether it
// arrives by upload form or inside a character bundle.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
// A PDF page set is bigger than a picture; 25 MB holds a sourcebook.
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export const UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

export function isUploadMimeType(value: unknown): value is UploadMimeType {
  return (UPLOAD_MIME_TYPES as readonly unknown[]).includes(value);
}

export function uploadExtension(type: UploadMimeType): "png" | "jpg" | "webp" {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

function mimeForExtension(extension: string): UploadMimeType {
  return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
}

function uploadsDir(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");
}

// Names the file itself, so every stored path has the shape
// isUploadedImagePath accepts. Callers validate size and type first.
export async function writeUploadedImage(
  bytes: Uint8Array,
  type: UploadMimeType,
): Promise<{ id: string; url: string }> {
  const id = crypto.randomUUID();
  const filename = `${id}.${uploadExtension(type)}`;
  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  const saved = path.join(/*turbopackIgnore: true*/ dir, filename);
  await writeFile(saved, bytes);
  // Smaller WebP copies beside it, written after this returns and never
  // fatal (src/lib/image-variants.ts); covers the upload route and the
  // character bundle import alike.
  scheduleImageVariants(saved);
  recordMediaFile(`/uploads/${filename}`);
  return { id, url: `/uploads/${filename}` };
}

// A PDF under its own cap, named the same way. `text` is the PDF's words as
// the page read them with pdf.js (src/lib/pdf-import/book-text.ts), kept
// beside it under data/ for the rules search: the server's own reader
// (src/lib/pdf/text.ts) cannot read a book whose fonts are subset with
// their own codes, which is most published books.
export async function writeUploadedPdf(bytes: Uint8Array, text = ""): Promise<{ id: string; url: string }> {
  const id = crypto.randomUUID();
  const filename = `${id}.pdf`;
  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, filename), bytes);
  recordMediaFile(`/uploads/${filename}`);
  if (text.trim()) await writeUploadedPdfText(`/uploads/${filename}`, text);
  return { id, url: `/uploads/${filename}` };
}

// The reading sent with the upload is the uploader's (`<id>.txt`, written
// once with a fresh id); a reading given later for an older attachment is
// one campaign's (`<id>.<campaign>.txt`), so whoever else attaches the same
// PDF elsewhere cannot change what this campaign's rules search reads.
function pdfTextFile(url: string, campaignId?: string): string | null {
  if (!isUploadedPdfPath(url)) return null;
  if (campaignId !== undefined && !/^[A-Za-z0-9-]{1,64}$/.test(campaignId)) return null;
  const id = url.slice("/uploads/".length, -".pdf".length);
  return path.join(/*turbopackIgnore: true*/ pdfTextDir(), campaignId ? `${id}.${campaignId}.txt` : `${id}.txt`);
}

export async function writeUploadedPdfText(url: string, text: string, campaignId?: string): Promise<boolean> {
  const file = pdfTextFile(url, campaignId);
  if (!file) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

// The page's reading of an uploaded PDF (the campaign's own first, then
// the uploader's), or null when none was sent (an older app, or a PDF
// uploaded before the page read them).
export async function readUploadedPdfText(url: unknown, campaignId?: string): Promise<string | null> {
  if (typeof url !== "string") return null;
  for (const file of [campaignId ? pdfTextFile(url, campaignId) : null, pdfTextFile(url)]) {
    if (!file) continue;
    try {
      return await readFile(file, "utf8");
    } catch {
      // not this one
    }
  }
  return null;
}

export async function readUploadedPdf(url: unknown): Promise<Buffer | null> {
  if (!isUploadedPdfPath(url)) {
    return null;
  }
  try {
    return await readFile(path.join(/*turbopackIgnore: true*/ uploadsDir(), url.slice("/uploads/".length)));
  } catch {
    return null;
  }
}

// Reads back a file this app wrote. Anything that is not a /uploads/<id>.<ext>
// path is refused before the filesystem is consulted, which is the whole
// traversal guard: the path never reaches path.join unless it already
// matches the shape we generate.
export async function readUploadedImage(
  url: unknown,
): Promise<{ bytes: Buffer; type: UploadMimeType } | null> {
  if (!isUploadedImagePath(url)) {
    return null;
  }
  const filename = url.slice("/uploads/".length);
  const extension = filename.split(".").pop() ?? "";
  try {
    const bytes = await readFile(path.join(/*turbopackIgnore: true*/ uploadsDir(), filename));
    return { bytes, type: mimeForExtension(extension === "jpeg" ? "jpg" : extension) };
  } catch {
    return null;
  }
}
