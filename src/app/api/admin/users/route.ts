import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { listUsers } from "@/lib/db/users";
import { deviceWorldHostId } from "@/lib/setup-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const hostId = deviceWorldHostId();
  return Response.json({
    users: listUsers().map((user) => ({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
      hasDiscord: user.hasDiscord,
      hasPassword: user.hasPassword,
      campaignCount: user.campaignCount,
      createdAt: user.createdAt,
      deletionDueAt: user.deletionDueAt,
      // The host of a world one of the apps runs, whose demote, reset and
      // delete only the host may use (src/lib/setup-code.ts).
      isHost: user.id === hostId,
    })),
  });
}
