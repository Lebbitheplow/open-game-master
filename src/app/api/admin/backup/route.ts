import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { BackupError, backupDir, createBackup, currentBackupJob, listBackups } from "@/lib/ops/backup";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const backupSchema = z.object({ includeModels: z.boolean().optional() });

// Lists the verified archives in the backup directory (ODM_BACKUP_DIR, by
// default ~/odm-backups, the same place scripts/odm-backup.mjs writes).
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({ backups: listBackups(), dir: backupDir(), job: currentBackupJob() });
}

// A point-in-time snapshot of the campaign state: the encrypted database
// (VACUUM INTO, so it is consistent even mid-game) plus uploads, generated
// media and .env.server, and the downloaded models only when
// { includeModels: true } asks (they are fetched again on first use). The
// archive contains the database encryption key; treat it as a secret.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = backupSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Send includeModels as true or false." }, { status: 400 });
  }
  try {
    const backup = await createBackup({ includeModels: parsed.data.includeModels === true });
    return Response.json({ backup });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Backup failed." },
      { status: error instanceof BackupError ? error.status : 500 },
    );
  }
}
