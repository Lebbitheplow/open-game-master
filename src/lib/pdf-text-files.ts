import fs from "node:fs";
import path from "node:path";
import { isUploadedPdfPath } from "@/lib/uploads";

// Where the page's readings of uploaded rules PDFs are kept
// (src/lib/uploads-store.ts): `<id>.txt` for the uploader's, and
// `<id>.<campaign>.txt` for one campaign's. They go when their PDF goes.

export const pdfTextDir = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "pdf-text");
const uploadsDir = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");

const READING = /^([0-9a-f-]{36})(\.[A-Za-z0-9-]+)?\.txt$/;

// Every reading kept for an uploaded PDF, for removing with it.
export function pdfTextFilesOf(url: string): string[] {
  if (!isUploadedPdfPath(url)) return [];
  const id = url.slice("/uploads/".length, -".pdf".length);
  try {
    return fs
      .readdirSync(pdfTextDir())
      .filter((name) => READING.exec(name)?.[1] === id)
      .map((name) => path.join(/*turbopackIgnore: true*/ pdfTextDir(), name));
  } catch {
    return [];
  }
}

// Readings whose PDF is gone (removed before readings were removed with
// it, or by hand), for the daily tidy.
// `campaignExists` says whether a campaign's own reading still has its
// campaign; one whose campaign is gone goes too.
export function sweepPdfTexts(campaignExists: (campaignId: string) => boolean = () => true): number {
  let names: string[] = [];
  try {
    names = fs.readdirSync(pdfTextDir());
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const found = READING.exec(name);
    const id = found?.[1];
    if (!id) continue;
    const campaign = found?.[2]?.slice(1);
    if (fs.existsSync(path.join(/*turbopackIgnore: true*/ uploadsDir(), `${id}.pdf`)) && (!campaign || campaignExists(campaign))) continue;
    fs.rmSync(path.join(/*turbopackIgnore: true*/ pdfTextDir(), name), { force: true });
    removed += 1;
  }
  return removed;
}
