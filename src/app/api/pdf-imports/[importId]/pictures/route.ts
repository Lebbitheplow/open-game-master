import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { getPdfImportForUser, importDir, pendingImportRefusal, readPictures, savePictures } from "@/lib/db/pdf-imports";
import { sniffImage } from "@/lib/addons/sniff";
import { MAX_IMPORT_IMAGE_BYTES, MAX_IMPORT_IMAGES, MAX_IMPORT_PAGES, pictureSchema } from "@/lib/pdf-import/reading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One picture the page kept from the book: where it sat (reading.ts), its
// pixel size, the grid the page found on it, and the picture itself. Kept
// in the import's own folder under data/ (never served to anyone but its
// importer) until the import lands, when the bundle import writes the ones
// kept into uploads like any other picture.

const bodySchema = z.object({
  picture: pictureSchema,
  page: z.number().int().min(1).max(MAX_IMPORT_PAGES),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  grid: z
    .object({ cell: z.number().min(4).max(2_000), offsetX: z.number().min(0).max(2_000), offsetY: z.number().min(0).max(2_000), confidence: z.number().min(0).max(1) })
    .nullable()
    .default(null),
  dataUrl: z.string().max(Math.ceil((MAX_IMPORT_IMAGE_BYTES * 4) / 3) + 64),
});

const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" } as const;

export async function POST(request: Request, { params }: { params: Promise<{ importId: string }> }) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { importId } = await params;
  const item = getPdfImportForUser(importId, user.id);
  if (!item) return Response.json({ error: "That import is gone. Pick the PDF again." }, { status: 404 });
  if (item.state !== "reading" && item.state !== "failed") return Response.json({ error: "This import has its pictures already." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "That picture could not be read." }, { status: 400 });
  const { dataUrl, ...meta } = parsed.data;
  if (meta.page > item.pageCount) return Response.json({ error: "A picture past the end of the book arrived." }, { status: 400 });
  const comma = dataUrl.indexOf(",");
  const bytes = Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : "", "base64");
  if (!bytes.length || bytes.length > MAX_IMPORT_IMAGE_BYTES) return Response.json({ error: "That picture is empty or over 8 MB." }, { status: 413 });
  const type = sniffImage(bytes);
  if (!type) return Response.json({ error: "That picture is not a PNG, JPEG or WebP." }, { status: 415 });
  const pictures = readPictures(item.id).filter((known) => known.picture.id !== meta.picture.id);
  if (pictures.length >= MAX_IMPORT_IMAGES) {
    return Response.json({ error: `An import keeps up to ${MAX_IMPORT_IMAGES} pictures; the rest of this book's are left out.` }, { status: 413 });
  }
  const refusal = pendingImportRefusal(user.id, bytes.length);
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });
  // A picture sent again in another format replaces the first.
  for (const ext of Object.values(EXT)) if (ext !== EXT[type]) rmSync(path.join(/*turbopackIgnore: true*/ importDir(item.id), `${meta.picture.id}.${ext}`), { force: true });
  writeFileSync(path.join(/*turbopackIgnore: true*/ importDir(item.id), `${meta.picture.id}.${EXT[type]}`), bytes);
  pictures.push(meta);
  savePictures(item.id, pictures);
  return Response.json({ kept: pictures.length });
}
