import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import {
  StorageError,
  compactDatabase,
  removeOrphanFiles,
  runRetention,
  scanOrphanFiles,
  storageStats,
} from "@/lib/ops/retention";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storageSchema = z.object({ action: z.enum(["tidy", "compact", "remove-orphans"]) });

// What the database and the media folders weigh, what the daily tidy last
// did, and the stored files no row names (src/lib/ops/retention.ts).
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const [stats, orphans] = await Promise.all([storageStats(), scanOrphanFiles()]);
  return Response.json({ stats, orphans: summary(orphans) });
}

function summary(scan: Awaited<ReturnType<typeof scanOrphanFiles>>) {
  return {
    pictures: scan.pictures.length,
    audio: scan.audio.length,
    bytes: scan.bytes,
    sample: [...scan.pictures, ...scan.audio].slice(0, 8).map((file) => file.url),
    scannedAt: scan.scannedAt,
  };
}

// { action: "tidy" } runs the daily pass now, "compact" rewrites the
// database without its free pages, "remove-orphans" deletes the files no
// row names (scanned again here, not taken from the page).
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = storageSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const { action } = parsed.data;
  try {
    if (action === "tidy") {
      const report = await runRetention();
      return Response.json({ report, stats: await storageStats() });
    }
    if (action === "compact") {
      const compacted = await compactDatabase();
      return Response.json({ compacted, stats: await storageStats() });
    }
    if (action === "remove-orphans") {
      const removed = await removeOrphanFiles();
      return Response.json({ removed, orphans: summary(await scanOrphanFiles()) });
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Storage action failed." },
      { status: error instanceof StorageError ? error.status : 500 },
    );
  }
}
