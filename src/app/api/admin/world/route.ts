import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import {
  WorldArchiveError,
  commitWorldImport,
  currentWorldJob,
  discardWorldTransfer,
  startWorldCheck,
  startWorldExport,
  worldTransferDir,
} from "@/lib/ops/world-archive";
import { isDeviceWorld } from "@/lib/server-env";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const worldSchema = z.object({
  action: z.enum(["export", "check", "commit", "discard"]),
  name: z.string().optional(),
  ownerPassword: z.string().optional(),
});

// A device world in one file and back (src/lib/ops/world-archive.ts),
// asked for by the apps' Settings. Only the apps' own worlds have it: a
// server keeps its backups (/api/admin/backup).
async function gate(): Promise<Response | null> {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return isDeviceWorld() ? null : Response.json({ error: "Not found." }, { status: 404 });
}

// What the export or the check is doing now, and its outcome once done.
export async function GET() {
  const refused = await gate();
  if (refused) {
    return refused;
  }
  return Response.json({ job: currentWorldJob(), dir: worldTransferDir() });
}

// { action: "export" } packs the world into world-transfer/; "check" with
// the name of a file the app put there unpacks and verifies it; "commit"
// with that name and the password the app keeps for the owner swaps it in;
// "discard" drops whatever is staged.
export async function POST(request: Request) {
  const refused = await gate();
  if (refused) {
    return refused;
  }
  const parsed = worldSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const body = parsed.data;
  try {
    if (body.action === "export") {
      return Response.json({ job: startWorldExport() }, { status: 202 });
    }
    if (body.action === "check" && typeof body.name === "string") {
      return Response.json({ job: startWorldCheck(body.name) }, { status: 202 });
    }
    if (body.action === "commit" && typeof body.name === "string") {
      const committed = await commitWorldImport(body.name, typeof body.ownerPassword === "string" ? body.ownerPassword : "");
      return Response.json({ ...committed, restart: true });
    }
    if (body.action === "discard") {
      await discardWorldTransfer();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The world transfer failed." },
      { status: error instanceof WorldArchiveError ? error.status : 500 },
    );
  }
}
